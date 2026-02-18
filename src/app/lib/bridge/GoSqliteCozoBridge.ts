/**
 * GoSqliteCozoBridge - Unified data layer facade
 * 
 * Architecture (Data River):
 * - GoSQLite (Go WASM) = Source of truth for notes, entities, edges, folders
 * - OPFS = Durable cold storage (debounced whole-DB sync)
 * - Dexie = Boot cache only (warmed by write-back, read on cold start)
 * 
 * Write Flow:
 *   UI → GoSQLite → markDirty() → [debounce] → OPFS
 *                  → [fire-and-forget] → Dexie (boot cache warming)
 * 
 * Read Flow:
 *   Notes/Entities/Edges/Folders: GoSQLite (direct, fast)
 * 
 * Boot Flow:
 *   Dexie (instant) → GoSQLite → verify OPFS
 * 
 * [CozoDB REMOVED] - Phase 3 cleanup. All graph operations now use CentralRegistry.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { GoKittStoreService, StoreNote, StoreEntity, StoreEdge, StoreFolder } from '../../services/gokitt-store.service';
import { GoOpfsSyncService } from '../opfs/GoOpfsSyncService';
import { db } from '../dexie/db';
import type { Note, Folder, Entity, Edge } from '../dexie/db';

// =============================================================================
// TYPES
// =============================================================================

export type BridgeStatus = 'uninitialized' | 'initializing' | 'ready' | 'error';

export interface HydrationReport {
    notes: number;
    folders: number;
    entities: number;
    edges: number;
    duration: number;
    source: 'idb' | 'opfs' | 'fresh';
}

// =============================================================================
// BRIDGE SERVICE
// =============================================================================

@Injectable({ providedIn: 'root' })
export class GoSqliteCozoBridge {
    private goKittStore = inject(GoKittStoreService);
    private opfsSync = inject(GoOpfsSyncService);

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    private _status = signal<BridgeStatus>('uninitialized');
    private _lastError = signal<string | null>(null);
    private _bootReport = signal<HydrationReport | null>(null);

    readonly status = this._status.asReadonly();
    readonly lastError = this._lastError.asReadonly();
    readonly isReady = computed(() => this._status() === 'ready');
    readonly isSyncing = computed(() => this.opfsSync.status() === 'syncing');
    readonly bootReport = this._bootReport.asReadonly();

    /** Check if bridge is ready (non-signal version for sync access) */
    isReadySync(): boolean {
        return this._status() === 'ready';
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Initialize the bridge.
     * 
     * Boot sequence:
     * 1. Ensure GoKittStoreService is initialized
     * 2. Boot from fastest source (IDB → OPFS → fresh)
     * 3. Mark ready
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

            // Boot from fastest available source
            const startTime = Date.now();

            // [New Architecture] Persistence is handled by GoKittStoreService internally.
            // We just need to report status.
            let bootSource: 'idb' | 'opfs' | 'fresh' = 'opfs';

            // Check if store has data (loaded by GoKittStoreService)
            const count = await this.goKittStore.countNotes();
            if (count === 0) {
                bootSource = 'fresh';
                // If empty, try BootCache (Dexie warmup data)
                await this.tryBootCache();
            }


            // Build report
            const notes = await this.goKittStore.listNotes();
            const entities = await this.goKittStore.listEntities();
            const report: HydrationReport = {
                notes: notes.length,
                folders: 0,
                entities: entities.length,
                edges: 0,
                duration: Date.now() - startTime,
                source: bootSource,
            };
            this._bootReport.set(report);

            this._status.set('ready');
            console.log('[GoSqliteBridge] ✅ Bridge initialized', report);

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this._lastError.set(message);
            this._status.set('error');
            console.error('[GoSqliteBridge] ❌ Initialization failed:', message);
            throw err;
        }
    }

    /**
     * Try BootCache for cold start (pre-loaded from Dexie before Angular).
     */
    private async tryBootCache(): Promise<void> {
        try {
            const { getBootCache } = await import('../core/boot-cache');
            const bootData = getBootCache();

            if (bootData && (bootData.entities.length > 0 || bootData.edges.length > 0 || bootData.notes.length > 0)) {
                console.log(`[GoSqliteBridge] 🚀 BootCache: ${bootData.entities.length} entities, ${bootData.edges.length} edges, ${bootData.notes.length} notes, ${bootData.folders.length} folders`);

                const notePromises = bootData.notes.map((n: Note) =>
                    this.goKittStore.upsertNote(GoKittStoreService.fromDexieNote(n))
                );
                const entityPromises = bootData.entities.map((e: Entity) =>
                    this.goKittStore.upsertEntity(GoKittStoreService.fromDexieEntity(e))
                );
                const edgePromises = bootData.edges.map((e: Edge) =>
                    this.goKittStore.upsertEdge(GoKittStoreService.fromDexieEdge(e))
                );
                const folderPromises = bootData.folders.map((f: Folder) =>
                    this.goKittStore.upsertFolder(GoKittStoreService.fromDexieFolder(f))
                );

                await Promise.all([...notePromises, ...entityPromises, ...edgePromises, ...folderPromises]);

                // First data loaded — sync to OPFS
                // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL

            }
        } catch (err) {
            console.warn('[GoSqliteBridge] BootCache not available:', err);
        }
    }

    // -------------------------------------------------------------------------
    // Write Operations (GoSQLite → markDirty → OPFS, fire-and-forget → Dexie)
    // -------------------------------------------------------------------------

    /**
     * Best-effort Dexie write for boot cache warming.
     * Swallows all errors — this is non-critical cache warming.
     */
    private warmDexie<T>(table: { put: (obj: T) => Promise<unknown> }, obj: T): void {
        try {
            if (!(obj as any)?.id) return; // Key path requires id
            table.put(obj).catch(() => { });
        } catch {
            // Swallow synchronous errors too
        }
    }

    /**
     * Sync a note to GoSQLite, mark dirty for OPFS, and warm Dexie boot cache.
     */
    async syncNote(note: Note): Promise<void> {
        await this.goKittStore.upsertNote(GoKittStoreService.fromDexieNote(note));
        // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL
        this.warmDexie(db.notes, note);
    }


    /**
     * Sync a folder to GoSQLite.
     * Also warms Dexie boot cache.
     */
    async syncFolder(folder: Folder): Promise<void> {
        const storeFolder = GoKittStoreService.fromDexieFolder(folder);
        await this.goKittStore.upsertFolder(storeFolder);
        // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL

        this.warmDexie(db.folders, folder);
    }

    /**
     * Sync an entity to GoSQLite.
     * Note: GraphRegistry is the authoritative source for entities.
     */
    async syncEntity(entity: Entity): Promise<void> {
        await this.goKittStore.upsertEntity(GoKittStoreService.fromDexieEntity(entity));
        // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL

        this.warmDexie(db.entities, entity);
    }

    /**
     * Sync an edge to GoSQLite.
     */
    async syncEdge(edge: Edge): Promise<void> {
        await this.goKittStore.upsertEdge(GoKittStoreService.fromDexieEdge(edge));
        // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL

        this.warmDexie(db.edges, edge);
    }

    // -------------------------------------------------------------------------
    // Delete Operations
    // -------------------------------------------------------------------------

    async deleteNote(noteId: string): Promise<void> {
        await this.goKittStore.deleteNote(noteId);
        // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL
        // Fire-and-forget Dexie cleanup

        db.notes.delete(noteId).catch(() => { });
    }

    async deleteFolder(folderId: string): Promise<void> {
        await this.goKittStore.deleteFolder(folderId);
        // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL
        // Fire-and-forget Dexie cleanup
        db.folders.delete(folderId).catch(() => { });
    }

    async deleteEntity(entityId: string): Promise<void> {
        await this.goKittStore.deleteEntity(entityId);
        // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL

        // Fire-and-forget Dexie cleanup
        db.entities.delete(entityId).catch(() => { });
    }

    async deleteEdge(edgeId: string): Promise<void> {
        await this.goKittStore.deleteEdge(edgeId);
        // this.opfsSync.markDirty(); // [DISABLED] Handled by WAL

        // Fire-and-forget Dexie cleanup
        db.edges.delete(edgeId).catch(() => { });
    }

    // -------------------------------------------------------------------------
    // Read Operations (from GoSQLite)
    // -------------------------------------------------------------------------

    async getNote(id: string): Promise<StoreNote | null> {
        return this.goKittStore.getNote(id);
    }

    async getAllNotes(): Promise<StoreNote[]> {
        return this.goKittStore.listNotes();
    }

    async getNotesByFolder(folderId: string): Promise<StoreNote[]> {
        return this.goKittStore.listNotes(folderId);
    }

    async getEntity(id: string): Promise<StoreEntity | null> {
        return this.goKittStore.getEntity(id);
    }

    async getAllEntities(): Promise<StoreEntity[]> {
        return this.goKittStore.listEntities();
    }

    async getEdgesForEntity(entityId: string): Promise<StoreEdge[]> {
        return this.goKittStore.listEdgesForEntity(entityId);
    }

    async getFolder(id: string): Promise<StoreFolder | null> {
        return this.goKittStore.getFolder(id);
    }

    async getAllFolders(): Promise<StoreFolder[]> {
        return this.goKittStore.listFolders();
    }

    // -------------------------------------------------------------------------
    // Utility Methods
    // -------------------------------------------------------------------------

    async flushQueue(): Promise<void> {
        // await this.opfsSync.syncNow();
    }


    hasPendingSync(): boolean {
        // return this.opfsSync.isDirty();
        return false;
    }


    /** Get OPFS sync status */
    getSyncStatus() {
        return {
            status: this.opfsSync.status(),
            lastSync: this.opfsSync.lastSync(),
            isDirty: this.opfsSync.isDirty(),
        };
    }

    /** Cleanup when service is destroyed */
    destroy(): void {
        this._status.set('uninitialized');
    }
}
