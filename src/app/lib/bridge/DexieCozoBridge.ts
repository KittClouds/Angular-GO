/**
 * DexieCozoBridge - Unified data layer orchestrating Dexie ↔ CozoDB sync
 * 
 * Architecture:
 * - Dexie = fast client-facing store (UI reads/writes here)
 * - CozoDB = deep graph engine (Datalog queries, HNSW search)
 * - Bridge = keeps them in sync, provides direct Cozo access for graph queries
 * 
 * Sync Strategies:
 * - Write-Through: Notes, Folders (immediate sync)
 * - Lazy-Sync: Entities, Edges (batched, idle-time flush)
 * - Single-DB: Decorations (Dexie-only), Vectors (Cozo-only)
 */

import { Injectable, signal, computed } from '@angular/core';
import { db, Note, Folder, Entity, Edge } from '../dexie/db';
import { cozoDb } from '../cozo/db';
import { SyncQueue, SyncOp, SyncTable } from './SyncQueue';
import { DexieToCozo, CozoQueries } from './CozoFieldMapper';

// =============================================================================
// TYPES
// =============================================================================

export type SyncStatus = 'uninitialized' | 'initializing' | 'ready' | 'syncing' | 'error';

export interface SyncReport {
    notes: { synced: number; errors: number };
    folders: { synced: number; errors: number };
    entities: { synced: number; errors: number };
    edges: { synced: number; errors: number };
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
export class DexieCozoBridge {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    private _status = signal<SyncStatus>('uninitialized');
    private _lastError = signal<string | null>(null);
    private _syncInProgress = signal(false);
    private cozoEnabled = false; // Whether CozoDB is available for sync

    readonly status = this._status.asReadonly();
    readonly lastError = this._lastError.asReadonly();
    readonly isReady = computed(() => this._status() === 'ready');
    readonly isSyncing = computed(() => this._syncInProgress());
    readonly hasCozoSync = computed(() => this.cozoEnabled); // Expose for UI

    // Lazy sync queue for entities and edges
    private lazyQueue = new SyncQueue({
        batchSize: 50,
        flushIntervalMs: 1000,
        debug: false,
    });

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Initialize the bridge. Call this after CozoDB is ready.
     * If CozoDB is not enabled, the bridge will operate in Dexie-only mode.
     */
    async init(): Promise<void> {
        if (this._status() !== 'uninitialized') {
            console.log('[Bridge] Already initialized, skipping');
            return;
        }

        this._status.set('initializing');

        try {
            // Check if CozoDB is actually ready (it might be disabled)
            if (!cozoDb.isReady()) {
                // CozoDB disabled - bridge operates in Dexie-only mode (no sync, no graph queries)
                this.cozoEnabled = false;
                this._status.set('ready');
                return;
            }

            // CozoDB is ready - enable sync
            this.cozoEnabled = true;

            // Set up lazy queue flush handler
            this.lazyQueue.setFlushHandler((ops) => this.processLazyOps(ops));

            this._status.set('ready');
            console.log('[Bridge] ✅ Bridge initialized (CozoDB sync enabled)');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this._lastError.set(message);
            this._status.set('error');
            console.error('[Bridge] ❌ Initialization failed:', message);
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // Write-Through Sync (Immediate)
    // -------------------------------------------------------------------------

    /**
     * Sync a note to CozoDB immediately (write-through)
     */
    syncNote(note: Note): void {
        if (!this.cozoEnabled) return;

        try {
            const cozoNote = DexieToCozo.note(note);
            const script = CozoQueries.upsertNote(cozoNote);
            cozoDb.runMutation(script);
        } catch (err) {
            console.error('[Bridge] Note sync failed:', err);
        }
    }

    /**
     * Sync a folder to CozoDB immediately (write-through)
     */
    syncFolder(folder: Folder): void {
        if (!this.cozoEnabled) return;

        try {
            const cozoFolder = DexieToCozo.folder(folder);
            const script = CozoQueries.upsertFolder(cozoFolder);
            cozoDb.runMutation(script);
        } catch (err) {
            console.error('[Bridge] Folder sync failed:', err);
        }
    }

    /**
     * Delete a note from CozoDB
     */
    deleteNote(noteId: string): void {
        if (!this.cozoEnabled) return;

        try {
            const script = CozoQueries.deleteNote(noteId);
            cozoDb.runMutation(script);
        } catch (err) {
            console.error('[Bridge] Note delete failed:', err);
        }
    }

    /**
     * Delete a folder from CozoDB
     */
    deleteFolder(folderId: string): void {
        if (!this.cozoEnabled) return;

        try {
            const script = CozoQueries.deleteFolder(folderId);
            cozoDb.runMutation(script);
        } catch (err) {
            console.error('[Bridge] Folder delete failed:', err);
        }
    }

    // -------------------------------------------------------------------------
    // Lazy Sync (Batched)
    // -------------------------------------------------------------------------

    /**
     * Queue an entity for lazy sync
     */
    syncEntity(entity: Entity): void {
        if (!this.cozoEnabled) return;
        this.lazyQueue.enqueueUpsert('entities', entity.id, entity);
    }

    /**
     * Queue an edge for lazy sync
     */
    syncEdge(edge: Edge): void {
        if (!this.cozoEnabled) return;
        this.lazyQueue.enqueueUpsert('edges', edge.id, edge);
    }

    /**
     * Queue entity deletion
     */
    deleteEntity(entityId: string): void {
        if (!this.cozoEnabled) return;
        this.lazyQueue.enqueueDelete('entities', entityId);
    }

    /**
     * Queue edge deletion
     */
    deleteEdge(edgeId: string): void {
        if (!this.cozoEnabled) return;
        this.lazyQueue.enqueueDelete('edges', edgeId);
    }

    /**
     * Force flush any pending lazy sync operations
     */
    async flushLazyQueue(): Promise<void> {
        await this.lazyQueue.flush();
    }

    /**
     * Process a batch of lazy sync operations
     */
    private async processLazyOps(ops: SyncOp[]): Promise<void> {
        for (const op of ops) {
            try {
                if (op.type === 'delete') {
                    if (op.table === 'entities') {
                        cozoDb.runMutation(CozoQueries.deleteEntity(op.id));
                    } else if (op.table === 'edges') {
                        cozoDb.runMutation(CozoQueries.deleteEdge(op.id));
                    }
                } else {
                    if (op.table === 'entities') {
                        const cozoEntity = DexieToCozo.entity(op.data as Entity);
                        cozoDb.runMutation(CozoQueries.upsertEntity(cozoEntity));
                    } else if (op.table === 'edges') {
                        const cozoEdge = DexieToCozo.edge(op.data as Edge);
                        cozoDb.runMutation(CozoQueries.upsertEdge(cozoEdge));
                    }
                }
            } catch (err) {
                console.error(`[Bridge] Lazy sync failed for ${op.table}/${op.id}:`, err);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Full Sync (Initial Hydration)
    // -------------------------------------------------------------------------

    /**
     * Perform a full sync from Dexie to CozoDB.
     * Use this on first boot or after schema migrations.
     */
    async fullSync(): Promise<SyncReport> {
        if (!this.cozoEnabled) {
            throw new Error('[Bridge] CozoDB sync not enabled');
        }

        this._syncInProgress.set(true);
        const startTime = Date.now();
        const report: SyncReport = {
            notes: { synced: 0, errors: 0 },
            folders: { synced: 0, errors: 0 },
            entities: { synced: 0, errors: 0 },
            edges: { synced: 0, errors: 0 },
            duration: 0,
        };

        console.log('[Bridge] Starting full sync...');

        try {
            // Sync folders first (parents before children)
            const folders = await db.folders.toArray();
            for (const folder of folders) {
                try {
                    this.syncFolder(folder);
                    report.folders.synced++;
                } catch {
                    report.folders.errors++;
                }
            }

            // Sync notes
            const notes = await db.notes.toArray();
            for (const note of notes) {
                try {
                    this.syncNote(note);
                    report.notes.synced++;
                } catch {
                    report.notes.errors++;
                }
            }

            // Sync entities
            const entities = await db.entities.toArray();
            for (const entity of entities) {
                try {
                    const cozoEntity = DexieToCozo.entity(entity);
                    cozoDb.runMutation(CozoQueries.upsertEntity(cozoEntity));
                    report.entities.synced++;
                } catch {
                    report.entities.errors++;
                }
            }

            // Sync edges
            const edges = await db.edges.toArray();
            for (const edge of edges) {
                try {
                    const cozoEdge = DexieToCozo.edge(edge);
                    cozoDb.runMutation(CozoQueries.upsertEdge(cozoEdge));
                    report.edges.synced++;
                } catch {
                    report.edges.errors++;
                }
            }

            report.duration = Date.now() - startTime;
            console.log(`[Bridge] ✅ Full sync complete in ${report.duration}ms`, report);
            return report;

        } finally {
            this._syncInProgress.set(false);
        }
    }

    // -------------------------------------------------------------------------
    // Direct Cozo Access (Bypass Dexie)
    // -------------------------------------------------------------------------

    /**
     * Run a Datalog query directly on CozoDB.
     * Use this for graph traversals, HNSW search, etc.
     * 
     * @example
     * const edges = bridge.queryGraph<[string, string, string]>(`
     *   ?[source, target, type] := *entity_edge{source_id, target_id, edge_type},
     *     source = source_id, target = target_id, type = edge_type
     * `);
     */
    queryGraph<T = unknown[]>(
        script: string,
        params?: Record<string, unknown>
    ): T[] {
        if (!this.cozoEnabled) {
            // CozoDB disabled - silently return empty results
            return [];
        }

        try {
            const result = cozoDb.runQuery(script, params || {}) as CozoQueryResult<T>;
            if (!result.ok) {
                console.error('[Bridge] Query failed:', result.message || result.display);
                return [];
            }
            return result.rows || [];
        } catch (err) {
            console.error('[Bridge] Query error:', err);
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
        return this.lazyQueue.getStats();
    }

    /**
     * Check if there are pending sync operations
     */
    hasPendingSync(): boolean {
        return this.lazyQueue.length > 0;
    }

    /**
     * Cleanup when service is destroyed
     */
    destroy(): void {
        this.lazyQueue.destroy();
        this._status.set('uninitialized');
    }
}
