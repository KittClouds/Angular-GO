/**
 * GoSqliteCozoBridge - Unified data layer orchestrating GoSQLite ↔ CozoDB sync
 * 
 * Architecture:
 * - GoSQLite (Go WASM) = fast in-memory store for UI reads/writes
 * - CozoDB = deep graph engine + durable persistence (OPFS snapshots)
 * - Bridge = keeps them in sync via batch operations
 * 
 * Smart Boot Strategy:
 * 1. GoSQLite loads from IndexedDB cache (instant boot)
 * 2. Background sync verifies against CozoDB (eventual consistency)
 * 3. Only hydrate from Cozo if cache is stale or missing
 * 
 * This replaces NebulaCozoBridge.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { GoKittStoreService, StoreNote, StoreEntity, StoreEdge } from '../../services/gokitt-store.service';
import { cozoDb } from '../cozo/db';
import { SyncQueue, SyncOp, SyncTable } from './SyncQueue';
import { DexieToCozo, CozoQueries, CozoToDexie } from './CozoFieldMapper';
import type { Note, Folder, Entity, Edge } from '../dexie/db';

// =============================================================================
// TYPES
// =============================================================================

export type BridgeStatus = 'uninitialized' | 'initializing' | 'hydrating' | 'ready' | 'syncing' | 'error';

export interface HydrationReport {
    notes: number;
    folders: number;
    entities: number;
    edges: number;
    duration: number;
    source: 'cache' | 'cozo' | 'none';
}

interface CozoQueryResult<T = unknown[]> {
    ok: boolean;
    rows?: T[];
    headers?: string[];
    took?: number;
    message?: string;
    display?: string;
}

// Version tracking for cache invalidation
interface CacheMetadata {
    version: number;
    lastSync: number;
    noteCount: number;
    folderCount: number;
}

// =============================================================================
// BRIDGE SERVICE
// =============================================================================

@Injectable({ providedIn: 'root' })
export class GoSqliteCozoBridge {
    private goKittStore = inject(GoKittStoreService);

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    private _status = signal<BridgeStatus>('uninitialized');
    private _lastError = signal<string | null>(null);
    private _syncInProgress = signal(false);
    private _cacheHit = signal(false);

    readonly status = this._status.asReadonly();
    readonly lastError = this._lastError.asReadonly();
    readonly isReady = computed(() => this._status() === 'ready');
    readonly isSyncing = computed(() => this._syncInProgress());
    readonly hadCacheHit = computed(() => this._cacheHit());

    /** Check if bridge is ready (non-signal version for sync access) */
    isReadySync(): boolean {
        return this._status() === 'ready';
    }

    // Lazy sync queue - ALL mutations go through here
    private syncQueue = new SyncQueue({
        batchSize: 50,
        flushIntervalMs: 1000,
        debug: false,
    });

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Initialize the bridge. Call this after GoKittStoreService is ready.
     * 
     * Smart boot sequence:
     * 1. Check if GoSQLite already has data (IndexedDB cache)
     * 2. If cached: mark ready immediately, sync in background
     * 3. If empty: hydrate from CozoDB
     */
    async init(): Promise<void> {
        if (this._status() !== 'uninitialized') {
            console.log('[GoSqliteBridge] Already initialized, skipping');
            return;
        }

        this._status.set('initializing');

        try {
            // Ensure GoKittStore is initialized
            if (!this.goKittStore.isReady) {
                await this.goKittStore.initialize();
            }

            // Check if CozoDB is ready
            if (!cozoDb.isReady()) {
                throw new Error('CozoDB not ready');
            }

            // Set up lazy queue flush handler
            this.syncQueue.setFlushHandler((ops) => this.processQueuedOps(ops));

            // Smart hydration: check cache first
            const report = await this.smartHydrate();

            this._status.set('ready');
            console.log('[GoSqliteBridge] ✅ Bridge initialized', report);

            // If we had cache hit, do background sync verification
            if (report.source === 'cache') {
                this.backgroundSyncVerify().catch(err =>
                    console.warn('[GoSqliteBridge] Background sync failed:', err)
                );
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this._lastError.set(message);
            this._status.set('error');
            console.error('[GoSqliteBridge] ❌ Initialization failed:', message);
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // Smart Hydration (Cache-first)
    // -------------------------------------------------------------------------

    /**
     * Smart hydration strategy:
     * 1. Check if GoSQLite has cached data (from IndexedDB via TinyGo)
     * 2. If not: use BootCache data (pre-loaded from Dexie before Angular)
     * 3. If nothing: hydrate from CozoDB (slowest, only on cold start)
     * 4. Background sync verification runs after
     */
    private async smartHydrate(): Promise<HydrationReport> {
        const startTime = Date.now();

        // Strategy 1: Check if GoSQLite already has data
        const cachedNotes = await this.goKittStore.listNotes();
        const cachedEntities = await this.goKittStore.listEntities();

        if (cachedNotes.length > 0 || cachedEntities.length > 0) {
            this._cacheHit.set(true);
            console.log(`[GoSqliteBridge] 🚀 GoSQLite cache hit: ${cachedNotes.length} notes, ${cachedEntities.length} entities`);
            return {
                notes: cachedNotes.length,
                folders: 0,
                entities: cachedEntities.length,
                edges: 0,
                duration: Date.now() - startTime,
                source: 'cache'
            };
        }

        // Strategy 2: Use BootCache (pre-loaded from Dexie before Angular)
        const { getBootCache } = await import('../core/boot-cache');
        const bootData = getBootCache();

        if (bootData && (bootData.entities.length > 0 || bootData.edges.length > 0 || bootData.notes.length > 0)) {
            console.log(`[GoSqliteBridge] 🚀 Using BootCache: ${bootData.entities.length} entities, ${bootData.edges.length} edges, ${bootData.notes.length} notes`);

            // Hydrate GoSQLite from BootCache in parallel (don't await each one)
            const notePromises = bootData.notes.map(n =>
                this.goKittStore.upsertNote(GoKittStoreService.fromDexieNote(n))
            );
            const entityPromises = bootData.entities.map(e =>
                this.goKittStore.upsertEntity(GoKittStoreService.fromDexieEntity(e))
            );
            const edgePromises = bootData.edges.map(e =>
                this.goKittStore.upsertEdge(GoKittStoreService.fromDexieEdge(e))
            );

            await Promise.all([...notePromises, ...entityPromises, ...edgePromises]);

            this._cacheHit.set(true);
            return {
                notes: bootData.notes.length,
                folders: 0,
                entities: bootData.entities.length,
                edges: bootData.edges.length,
                duration: Date.now() - startTime,
                source: 'cache'
            };
        }

        // Strategy 3: No cache - hydrate from Cozo (cold start only)
        console.log('[GoSqliteBridge] Cache miss, hydrating from Cozo...');
        return this.hydrateFromCozo();
    }

    /**
     * Full hydration from CozoDB (cold start or cache miss)
     */
    async hydrateFromCozo(): Promise<HydrationReport> {
        this._status.set('hydrating');
        const startTime = Date.now();
        const report: HydrationReport = {
            notes: 0,
            folders: 0,
            entities: 0,
            edges: 0,
            duration: 0,
            source: 'cozo'
        };

        console.log('[GoSqliteBridge] Hydrating from Cozo...');

        try {
            // Hydrate notes
            const notesResult = this.queryGraph<unknown[]>(`
                ?[id, world_id, title, content, markdown_content, folder_id, entity_kind, 
                  entity_subtype, is_entity, is_pinned, favorite, owner_id, created_at, 
                  updated_at, narrative_id, order] := 
                    *notes{id, world_id, title, content, markdown_content, folder_id, 
                           entity_kind, entity_subtype, is_entity, is_pinned, favorite, 
                           owner_id, created_at, updated_at, narrative_id, order}
            `);

            for (const row of notesResult) {
                const note = CozoToDexie.note(row) as Note;
                await this.goKittStore.upsertNote(GoKittStoreService.fromDexieNote(note));
                report.notes++;
            }

            // Skip entities - GraphRegistry is the source of truth for entities
            // This prevents entity accumulation bug
            report.entities = 0;

            // Hydrate edges
            const edgesResult = this.queryGraph<unknown[]>(`
                ?[id, source_id, target_id, edge_type, confidence] := 
                    *entity_edge{id, source_id, target_id, edge_type, confidence}
            `);

            for (const row of edgesResult) {
                const edge = CozoToDexie.edge(row) as Edge;
                await this.goKittStore.upsertEdge(GoKittStoreService.fromDexieEdge(edge));
                report.edges++;
            }

            report.duration = Date.now() - startTime;
            console.log(`[GoSqliteBridge] ✅ Hydration complete in ${report.duration}ms`, report);
            return report;

        } catch (err) {
            console.error('[GoSqliteBridge] Hydration failed:', err);
            throw err;
        }
    }

    /**
     * Background sync verification (runs after cache-based boot)
     * Checks if CozoDB has data that GoSQLite is missing
     * 
     * Note: GoSQLite having MORE notes than Cozo is normal (we sync TO Cozo).
     * Only warn if Cozo has MORE (means we missed data during cache boot).
     */
    private async backgroundSyncVerify(): Promise<void> {
        console.log('[GoSqliteBridge] 🔄 Background sync verification...');

        // Get counts from both stores
        const goNotes = await this.goKittStore.listNotes();
        const cozoNotesResult = this.queryGraph<unknown[]>(`?[count(id)] := *notes{id}`);
        const cozoNoteCount = cozoNotesResult.length > 0 ? (cozoNotesResult[0] as number[])[0] : 0;

        if (cozoNoteCount > goNotes.length) {
            // Cozo has more notes than GoSQLite - we're missing data!
            console.warn(`[GoSqliteBridge] ⚠️ Missing data: GoSQLite=${goNotes.length}, Cozo=${cozoNoteCount}. Consider re-syncing.`);
            // TODO: Pull missing notes from Cozo to GoSQLite
        } else if (goNotes.length > cozoNoteCount) {
            // GoSQLite has more - normal, will sync to Cozo on next write
            console.log(`[GoSqliteBridge] ✅ Sync OK: GoSQLite=${goNotes.length} (Cozo=${cozoNoteCount}, will sync on write)`);
        } else {
            console.log('[GoSqliteBridge] ✅ Sync verified: counts match');
        }
    }

    // -------------------------------------------------------------------------
    // Write Operations (GoSQLite → Queue → Cozo)
    // -------------------------------------------------------------------------

    /**
     * Sync a note - writes to GoSQLite immediately, queues to Cozo
     */
    async syncNote(note: Note): Promise<void> {
        // Write to GoSQLite immediately
        await this.goKittStore.upsertNote(GoKittStoreService.fromDexieNote(note));

        // Queue for Cozo sync
        this.syncQueue.enqueueUpsert('notes', note.id, note);
    }

    /**
     * Sync a folder - queues to Cozo (folders only in Cozo, not GoSQLite)
     */
    async syncFolder(folder: Folder): Promise<void> {
        // Folders are NOT in GoSQLite currently (schema limitation)
        // Just queue for Cozo sync
        this.syncQueue.enqueueUpsert('folders', folder.id, folder);
    }

    /**
     * Sync an entity - DEPRECATED
     * GraphRegistry is the single source of truth for entities.
     * This method is kept for API compatibility.
     */
    async syncEntity(entity: Entity): Promise<void> {
        // Write to GoSQLite for local reactivity
        await this.goKittStore.upsertEntity(GoKittStoreService.fromDexieEntity(entity));

        // IMPORTANT: Do NOT enqueue to Cozo - GraphRegistry is the source of truth
        console.warn('[GoSqliteBridge] syncEntity called - use GraphRegistry.registerEntity instead');
    }

    /**
     * Sync an edge - writes to GoSQLite immediately, queues to Cozo
     */
    async syncEdge(edge: Edge): Promise<void> {
        await this.goKittStore.upsertEdge(GoKittStoreService.fromDexieEdge(edge));
        this.syncQueue.enqueueUpsert('edges', edge.id, edge);
    }

    // -------------------------------------------------------------------------
    // Delete Operations
    // -------------------------------------------------------------------------

    async deleteNote(noteId: string): Promise<void> {
        await this.goKittStore.deleteNote(noteId);
        this.syncQueue.enqueueDelete('notes', noteId);
    }

    async deleteFolder(folderId: string): Promise<void> {
        // Folders only in Cozo
        this.syncQueue.enqueueDelete('folders', folderId);
    }

    async deleteEntity(entityId: string): Promise<void> {
        await this.goKittStore.deleteEntity(entityId);
        this.syncQueue.enqueueDelete('entities', entityId);
    }

    async deleteEdge(edgeId: string): Promise<void> {
        await this.goKittStore.deleteEdge(edgeId);
        this.syncQueue.enqueueDelete('edges', edgeId);
    }

    // -------------------------------------------------------------------------
    // Queue Processing
    // -------------------------------------------------------------------------

    /**
     * Process a batch of queued operations (flush to Cozo)
     */
    private async processQueuedOps(ops: SyncOp[]): Promise<void> {
        this._syncInProgress.set(true);

        try {
            for (const op of ops) {
                await this.processSingleOp(op);
            }
        } finally {
            this._syncInProgress.set(false);
        }
    }

    private async processSingleOp(op: SyncOp): Promise<void> {
        try {
            if (op.type === 'delete') {
                switch (op.table) {
                    case 'notes':
                        cozoDb.runMutation(CozoQueries.deleteNote(op.id));
                        break;
                    case 'folders':
                        cozoDb.runMutation(CozoQueries.deleteFolder(op.id));
                        break;
                    case 'entities':
                        // Skip - GraphRegistry handles entity persistence
                        break;
                    case 'edges':
                        cozoDb.runMutation(CozoQueries.deleteEdge(op.id));
                        break;
                }
            } else {
                // Upsert
                switch (op.table) {
                    case 'notes': {
                        const cozoNote = DexieToCozo.note(op.data as Note);
                        cozoDb.runMutation(CozoQueries.upsertNote(cozoNote));
                        break;
                    }
                    case 'folders': {
                        const cozoFolder = DexieToCozo.folder(op.data as Folder);
                        cozoDb.runMutation(CozoQueries.upsertFolder(cozoFolder));
                        break;
                    }
                    case 'entities':
                        // Skip - GraphRegistry handles entity persistence directly
                        break;
                    case 'edges': {
                        const cozoEdge = DexieToCozo.edge(op.data as Edge);
                        cozoDb.runMutation(CozoQueries.upsertEdge(cozoEdge));
                        break;
                    }
                }
            }
        } catch (err) {
            console.error(`[GoSqliteBridge] Sync failed for ${op.table}/${op.id}:`, err);
        }
    }

    /**
     * Force flush any pending sync operations
     */
    async flushQueue(): Promise<void> {
        await this.syncQueue.flush();
    }

    // -------------------------------------------------------------------------
    // Direct Cozo Access (Bypass GoSQLite for graph queries)
    // -------------------------------------------------------------------------

    /**
     * Run a Datalog query directly on CozoDB.
     * Use this for graph traversals, HNSW search, etc.
     */
    queryGraph<T = unknown[]>(
        script: string,
        params?: Record<string, unknown>
    ): T[] {
        try {
            const result = cozoDb.runQuery(script, params || {}) as CozoQueryResult<T>;
            if (!result.ok) {
                console.error('[GoSqliteBridge] Query failed:', result.message || result.display);
                return [];
            }
            return result.rows || [];
        } catch (err) {
            console.error('[GoSqliteBridge] Query error:', err);
            return [];
        }
    }

    /**
     * Run a Datalog query and return a single row
     */
    queryOne<T = unknown[]>(
        script: string,
        params?: Record<string, unknown>
    ): T | null {
        const results = this.queryGraph<T>(script, params);
        return results.length > 0 ? results[0] : null;
    }

    // -------------------------------------------------------------------------
    // Utility Methods
    // -------------------------------------------------------------------------

    /**
     * Get sync queue statistics
     */
    getQueueStats() {
        return this.syncQueue.getStats();
    }

    /**
     * Check if there are pending sync operations
     */
    hasPendingSync(): boolean {
        return this.syncQueue.length > 0;
    }

    /**
     * Cleanup when service is destroyed
     */
    destroy(): void {
        this.syncQueue.destroy();
        this._status.set('uninitialized');
    }

    // -------------------------------------------------------------------------
    // Read Operations (from GoSQLite)
    // -------------------------------------------------------------------------

    /**
     * Get a note by ID from GoSQLite
     */
    async getNote(id: string): Promise<StoreNote | null> {
        return this.goKittStore.getNote(id);
    }

    /**
     * Get all notes from GoSQLite
     */
    async getAllNotes(): Promise<StoreNote[]> {
        return this.goKittStore.listNotes();
    }

    /**
     * Get notes by folder from GoSQLite
     */
    async getNotesByFolder(folderId: string): Promise<StoreNote[]> {
        return this.goKittStore.listNotes(folderId);
    }

    /**
     * Get an entity by ID from GoSQLite
     */
    async getEntity(id: string): Promise<StoreEntity | null> {
        return this.goKittStore.getEntity(id);
    }

    /**
     * Get all entities from GoSQLite
     */
    async getAllEntities(): Promise<StoreEntity[]> {
        return this.goKittStore.listEntities();
    }

    /**
     * Get edges for an entity from GoSQLite
     */
    async getEdgesForEntity(entityId: string): Promise<StoreEdge[]> {
        return this.goKittStore.listEdgesForEntity(entityId);
    }
}
