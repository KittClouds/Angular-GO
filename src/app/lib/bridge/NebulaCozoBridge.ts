/**
 * NebulaCozoBridge - Unified data layer orchestrating NebulaDB ↔ CozoDB sync
 * 
 * Architecture:
 * - NebulaDB = fast client-facing store (UI reads/writes here)
 * - CozoDB = deep graph engine + persistence (OPFS snapshots)
 * - Bridge = keeps them in sync via batch operations
 * 
 * Sync Strategy:
 * - ALL writes go through lazy batch queue
 * - Flushes to Cozo during idle time
 * - Cozo persists to OPFS via its own snapshot/WAL mechanism
 */

import { Injectable, signal, computed } from '@angular/core';
import { nebulaDb, Note, Folder, Entity, Edge } from '../nebula/db';
import type { ICollection, Document } from '../nebula-db/packages/core/src/angular-exports';
import { cozoDb } from '../cozo/db';
import { SyncQueue, SyncOp, SyncTable } from './SyncQueue';
import { DexieToCozo, CozoQueries, CozoToDexie } from './CozoFieldMapper';

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
}

interface CozoQueryResult<T = unknown[]> {
    ok: boolean;
    rows?: T[];
    headers?: string[];
    took?: number;
    message?: string;
    display?: string;
}

// =============================================================================
// BRIDGE SERVICE
// =============================================================================

@Injectable({ providedIn: 'root' })
export class NebulaCozoBridge {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    private _status = signal<BridgeStatus>('uninitialized');
    private _lastError = signal<string | null>(null);
    private _syncInProgress = signal(false);

    readonly status = this._status.asReadonly();
    readonly lastError = this._lastError.asReadonly();
    readonly isReady = computed(() => this._status() === 'ready');
    readonly isSyncing = computed(() => this._syncInProgress());

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
     * Initialize the bridge. Call this after CozoDB is ready.
     */
    async init(): Promise<void> {
        if (this._status() !== 'uninitialized') {
            console.log('[NebulaBridge] Already initialized, skipping');
            return;
        }

        this._status.set('initializing');

        try {
            // Check if CozoDB is actually ready
            if (!cozoDb.isReady()) {
                throw new Error('CozoDB not ready');
            }

            // Set up lazy queue flush handler
            this.syncQueue.setFlushHandler((ops) => this.processQueuedOps(ops));

            // Hydrate NebulaDB from Cozo
            await this.hydrateFromCozo();

            this._status.set('ready');
            nebulaDb.setReady();
            console.log('[NebulaBridge] ✅ Bridge initialized');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this._lastError.set(message);
            this._status.set('error');
            console.error('[NebulaBridge] ❌ Initialization failed:', message);
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // Hydration (Cozo → Nebula)
    // -------------------------------------------------------------------------

    /**
     * Hydrate NebulaDB from CozoDB queries
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
        };

        console.log('[NebulaBridge] Hydrating from Cozo...');

        try {
            // Clear existing data
            await nebulaDb.clearAll();

            // Hydrate folders first
            const foldersResult = this.queryGraph<unknown[]>(`
                ?[id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, 
                  color, is_typed_root, is_subtype_root, collapsed, owner_id, created_at, 
                  updated_at, narrative_id, is_narrative_root, network_id, metadata] := 
                    *folders{id, world_id, name, parent_id, entity_kind, entity_subtype, 
                             entity_label, color, is_typed_root, is_subtype_root, collapsed, 
                             owner_id, created_at, updated_at, narrative_id, is_narrative_root,
                             network_id, metadata}
            `);
            if (foldersResult.length > 0) {
                const folders = foldersResult.map(row => this.mapFolderRow(row));
                await nebulaDb.hydrateCollection(nebulaDb.folders, folders);
                report.folders = folders.length;
            }

            // Hydrate notes
            const notesResult = this.queryGraph<unknown[]>(`
                ?[id, world_id, title, content, markdown_content, folder_id, entity_kind, 
                  entity_subtype, is_entity, is_pinned, favorite, owner_id, created_at, 
                  updated_at, narrative_id, order] := 
                    *notes{id, world_id, title, content, markdown_content, folder_id, 
                           entity_kind, entity_subtype, is_entity, is_pinned, favorite, 
                           owner_id, created_at, updated_at, narrative_id, order}
            `);
            if (notesResult.length > 0) {
                const notes = notesResult.map(row => CozoToDexie.note(row));
                await nebulaDb.hydrateCollection(nebulaDb.notes, notes);
                report.notes = notes.length;
            }

            // Hydrate entities
            const entitiesResult = this.queryGraph<unknown[]>(`
                ?[id, label, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] := 
                    *entities{id, label, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id}
            `);
            if (entitiesResult.length > 0) {
                const entities = entitiesResult.map(row => CozoToDexie.entity(row));
                await nebulaDb.hydrateCollection(nebulaDb.entities, entities);
                report.entities = entities.length;
            }

            // Hydrate edges
            const edgesResult = this.queryGraph<unknown[]>(`
                ?[id, source_id, target_id, edge_type, confidence] := 
                    *entity_edge{id, source_id, target_id, edge_type, confidence}
            `);
            if (edgesResult.length > 0) {
                const edges = edgesResult.map(row => CozoToDexie.edge(row));
                await nebulaDb.hydrateCollection(nebulaDb.edges, edges);
                report.edges = edges.length;
            }

            report.duration = Date.now() - startTime;
            console.log(`[NebulaBridge] ✅ Hydration complete in ${report.duration}ms`, report);
            return report;

        } catch (err) {
            console.error('[NebulaBridge] Hydration failed:', err);
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // Write Operations (Nebula → Queue → Cozo)
    // -------------------------------------------------------------------------

    /**
     * Sync a note - writes to Nebula immediately, queues to Cozo
     */
    async syncNote(note: Note): Promise<void> {
        // Write to Nebula immediately
        const existing = await nebulaDb.notes.findOne({ id: note.id });
        if (existing) {
            await nebulaDb.notes.update({ id: note.id }, { $set: note });
        } else {
            await nebulaDb.notes.insert(note);
        }

        // Queue for Cozo sync
        this.syncQueue.enqueueUpsert('notes', note.id, note);
    }

    /**
     * Sync a folder - writes to Nebula immediately, queues to Cozo
     */
    async syncFolder(folder: Folder): Promise<void> {
        const existing = await nebulaDb.folders.findOne({ id: folder.id });
        if (existing) {
            await nebulaDb.folders.update({ id: folder.id }, { $set: folder });
        } else {
            await nebulaDb.folders.insert(folder);
        }

        this.syncQueue.enqueueUpsert('folders', folder.id, folder);
    }

    /**
     * Sync an entity - writes to Nebula immediately, queues to Cozo
     */
    async syncEntity(entity: Entity): Promise<void> {
        const existing = await nebulaDb.entities.findOne({ id: entity.id });
        if (existing) {
            await nebulaDb.entities.update({ id: entity.id }, { $set: entity });
        } else {
            await nebulaDb.entities.insert(entity);
        }

        this.syncQueue.enqueueUpsert('entities', entity.id, entity);
    }

    /**
     * Sync an edge - writes to Nebula immediately, queues to Cozo
     */
    async syncEdge(edge: Edge): Promise<void> {
        const existing = await nebulaDb.edges.findOne({ id: edge.id });
        if (existing) {
            await nebulaDb.edges.update({ id: edge.id }, { $set: edge });
        } else {
            await nebulaDb.edges.insert(edge);
        }

        this.syncQueue.enqueueUpsert('edges', edge.id, edge);
    }

    // -------------------------------------------------------------------------
    // Delete Operations
    // -------------------------------------------------------------------------

    async deleteNote(noteId: string): Promise<void> {
        await nebulaDb.notes.delete({ id: noteId });
        this.syncQueue.enqueueDelete('notes', noteId);
    }

    async deleteFolder(folderId: string): Promise<void> {
        await nebulaDb.folders.delete({ id: folderId });
        this.syncQueue.enqueueDelete('folders', folderId);
    }

    async deleteEntity(entityId: string): Promise<void> {
        await nebulaDb.entities.delete({ id: entityId });
        this.syncQueue.enqueueDelete('entities', entityId);
    }

    async deleteEdge(edgeId: string): Promise<void> {
        await nebulaDb.edges.delete({ id: edgeId });
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
                        cozoDb.runMutation(CozoQueries.deleteEntity(op.id));
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
                    case 'entities': {
                        const cozoEntity = DexieToCozo.entity(op.data as Entity);
                        cozoDb.runMutation(CozoQueries.upsertEntity(cozoEntity));
                        break;
                    }
                    case 'edges': {
                        const cozoEdge = DexieToCozo.edge(op.data as Edge);
                        cozoDb.runMutation(CozoQueries.upsertEdge(cozoEdge));
                        break;
                    }
                }
            }
        } catch (err) {
            console.error(`[NebulaBridge] Sync failed for ${op.table}/${op.id}:`, err);
        }
    }

    /**
     * Force flush any pending sync operations
     */
    async flushQueue(): Promise<void> {
        await this.syncQueue.flush();
    }

    // -------------------------------------------------------------------------
    // Direct Cozo Access (Bypass Nebula for graph queries)
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
                console.error('[NebulaBridge] Query failed:', result.message || result.display);
                return [];
            }
            return result.rows || [];
        } catch (err) {
            console.error('[NebulaBridge] Query error:', err);
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
     * Map a Cozo folder row to Dexie Folder type
     * (CozoToDexie doesn't have folder mapper, so we do it here)
     */
    private mapFolderRow(row: unknown[]): Folder {
        return {
            id: row[0] as string,
            worldId: row[1] as string,
            name: row[2] as string,
            parentId: row[3] as string,
            entityKind: row[4] as string,
            entitySubtype: row[5] as string,
            entityLabel: row[6] as string,
            color: row[7] as string,
            isTypedRoot: row[8] as boolean,
            isSubtypeRoot: row[9] as boolean,
            collapsed: row[10] as boolean,
            ownerId: row[11] as string,
            createdAt: row[12] as number,
            updatedAt: row[13] as number,
            narrativeId: row[14] as string,
            isNarrativeRoot: row[15] as boolean,
            networkId: row[16] as string,
            metadata: JSON.parse((row[17] as string) || '{}'),
            order: 0,
        } as Folder;
    }

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
}
