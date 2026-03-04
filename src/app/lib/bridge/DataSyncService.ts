
import { Injectable, inject, signal, computed } from '@angular/core';
import { GoKittStoreService, StoreNote, StoreEntity, StoreEdge, StoreFolder } from '../../services/gokitt-store.service';
import { db } from '../dexie/db';
import type { Note, Folder, Entity, Edge } from '../dexie/db';

export type SyncStatus = 'uninitialized' | 'syncing' | 'idle' | 'error';

export interface SyncReport {
    notes: number;
    folders: number;
    entities: number;
    edges: number;
    duration: number;
    direction: 'sqlite-to-dexie' | 'dexie-to-sqlite';
}

/**
 * DataSyncService (formerly GoSqliteCozoBridge)
 * 
 * CORE RESPONSIBILITY:
 * Enforce SQLite as the Single Source of Truth.
 * Dexie is relegated to a "Shadow" cache for:
 * 1. Boot speed (pre-WASM paint).
 * 2. Visual smoothness (avoiding verified-but-empty states).
 * 
 * SYNC STRATEGY:
 * - Boot: Load SQLite.
 * - If SQLite Empty: Import from Dexie (One-time migration/Recovery).
 * - After Boot: POPULATE Dexie with SQLite data synchronously. Dexie is write-through cache.
 */
@Injectable({ providedIn: 'root' })
export class DataSyncService {
    private goKittStore = inject(GoKittStoreService);

    // State
    private _status = signal<SyncStatus>('uninitialized');
    private _lastError = signal<string | null>(null);
    private _lastReport = signal<SyncReport | null>(null);

    readonly status = this._status.asReadonly();
    readonly lastError = this._lastError.asReadonly();
    readonly lastReport = this._lastReport.asReadonly();

    /**
     * Initialize the sync service.
     * Guaranteed to result in SQLite containing data (if any exists anywhere).
     */
    async init(): Promise<void> {
        if (this._status() !== 'uninitialized') return;
        this._status.set('syncing');

        try {
            // 1. Ensure SQLite is ready
            if (!this.goKittStore.isReady) {
                await this.goKittStore.initialize();
            }

            // 2. Check SQLite State
            const sqliteCount = await this.goKittStore.countNotes();

            if (sqliteCount === 0) {
                console.log('[DataSyncService] ⚠️ SQLite is empty. Attempting recovery from Dexie...');
                await this.recoverFromDexie();
            }

            // 3. Populate Dexie (Reactive Cache)
            // We WAIT for this now, so the system doesn't query Dexie before it's populated
            await this.syncSqliteToDexie();

            this._status.set('idle');

        } catch (err) {
            console.error('[DataSyncService] Init failed:', err);
            this._status.set('error');
            this._lastError.set(String(err));
            throw err;
        }
    }

    /**
     * [ONE-WAY] Overwrite Dexie with data from SQLite.
     * This fixes any "stale" data in Dexie/BootCache.
     */
    async syncSqliteToDexie(): Promise<void> {
        console.log('[DataSyncService] 🔄 Starting SQLite -> Dexie sync (Enforcing Truth)...');
        const startTime = Date.now();
        this._status.set('syncing');

        try {
            // A. Fetch ALL Data from SQLite (The Truth)
            const [notes, entities, edges, folders] = await Promise.all([
                this.goKittStore.listNotes(),
                this.goKittStore.listEntities(),
                this.goKittStore.listAllEdges(),
                this.goKittStore.listFolders()
            ]);

            // B. WRITE TO DEXIE (The Shadow)
            await db.transaction('rw', db.notes, db.entities, db.edges, db.folders, async () => {
                // 1. Clear everything
                await Promise.all([
                    db.notes.clear(),
                    db.entities.clear(),
                    db.edges.clear(),
                    db.folders.clear()
                ]);

                // 2. Bulk Put
                if (notes.length > 0) await db.notes.bulkPut(notes.map(n => this.toDexieNote(n)));
                if (entities.length > 0) await db.entities.bulkPut(entities.map(e => this.toDexieEntity(e)));
                if (edges.length > 0) await db.edges.bulkPut(edges.map(e => this.toDexieEdge(e)));
                if (folders.length > 0) await db.folders.bulkPut(folders.map(f => this.toDexieFolder(f)));
            });

            const report: SyncReport = {
                notes: notes.length,
                folders: folders.length,
                entities: entities.length,
                edges: edges.length,
                duration: Date.now() - startTime,
                direction: 'sqlite-to-dexie'
            };

            this._lastReport.set(report);
            console.log('[DataSyncService] ✅ Sync Complete. Dexie is now identical to SQLite.', report);

        } catch (err) {
            console.error('[DataSyncService] ❌ Sync failed:', err);
            this._lastError.set(String(err));
            throw err;
        } finally {
            this._status.set('idle');
        }
    }

    /**
     * [RECOVERY] Import data from Dexie into SQLite.
     * Only used if SQLite is empty (e.g. first run after clearing OPFS).
     * Uses STORE_IMPORT for a single round-trip instead of N sequential upserts.
     */
    private async recoverFromDexie(): Promise<void> {
        const startTime = Date.now();
        try {
            const [dNotes, dEntities, dEdges, dFolders] = await Promise.all([
                db.notes.toArray(),
                db.entities.toArray(),
                db.edges.toArray(),
                db.folders.toArray()
            ]);

            if (dNotes.length === 0 && dEntities.length === 0) {
                console.log('[DataSyncService] Dexie is also empty. Starting fresh.');
                return;
            }

            console.log(`[DataSyncService] Recovering ${dNotes.length} notes, ${dEntities.length} entities from Dexie (BATCHED)...`);

            // Build the batch payload matching Go's Import() ExportData struct
            const recoveryPayload = {
                notes: dNotes.map(n => GoKittStoreService.fromDexieNote(n)),
                entities: dEntities.map(e => GoKittStoreService.fromDexieEntity(e)),
                edges: dEdges.map(e => GoKittStoreService.fromDexieEdge(e)),
                folders: dFolders.map(f => GoKittStoreService.fromDexieFolder(f)),
            };

            // Single round-trip: JSON → Uint8Array → STORE_IMPORT → Go Import()
            const encoded = new TextEncoder().encode(JSON.stringify(recoveryPayload));
            await this.goKittStore.importDatabase(encoded);

            console.log(`[DataSyncService] ✅ Recovery Complete in ${Date.now() - startTime}ms`);

        } catch (err) {
            console.error('[DataSyncService] Recovery failed:', err);
            throw err;
        }
    }


    // =========================================================================
    // CRUD Facade (SQLite = Truth, Dexie = Shadow)
    // =========================================================================

    /**
     * Best-effort Dexie write for boot cache warming.
     * Swallows all errors — this is non-critical cache warming.
     */
    private warmDexie<T>(table: { put: (obj: T) => Promise<unknown>, delete: (key: any) => Promise<unknown> }, obj: T | null, deleteId?: string): void {
        try {
            if (deleteId) {
                table.delete(deleteId).catch(() => { });
                return;
            }
            if (obj && (obj as any).id) {
                table.put(obj).catch(() => { });
            }
        } catch {
            // Swallow errors
        }
    }

    // --- Notes ---

    async syncNote(note: Note): Promise<void> {
        await this.goKittStore.upsertNote(GoKittStoreService.fromDexieNote(note));
        this.warmDexie(db.notes, note);
    }

    async deleteNote(noteId: string): Promise<void> {
        await this.goKittStore.deleteNote(noteId);
        this.warmDexie(db.notes, null, noteId);
    }

    async getNote(id: string): Promise<StoreNote | null> {
        return this.goKittStore.getNote(id);
    }

    async getAllNotes(): Promise<StoreNote[]> {
        return this.goKittStore.listNotes();
    }

    async getNotesByFolder(folderId: string): Promise<StoreNote[]> {
        return this.goKittStore.listNotes(folderId);
    }

    // --- Folders ---

    async syncFolder(folder: Folder): Promise<void> {
        await this.goKittStore.upsertFolder(GoKittStoreService.fromDexieFolder(folder));
        this.warmDexie(db.folders, folder);
    }

    async deleteFolder(folderId: string): Promise<void> {
        await this.goKittStore.deleteFolder(folderId);
        this.warmDexie(db.folders, null, folderId);
    }

    async getFolder(id: string): Promise<StoreFolder | null> {
        return this.goKittStore.getFolder(id);
    }

    async getAllFolders(): Promise<StoreFolder[]> {
        return this.goKittStore.listFolders();
    }

    // --- Entities ---

    async syncEntity(entity: Entity): Promise<void> {
        await this.goKittStore.upsertEntity(GoKittStoreService.fromDexieEntity(entity));
        this.warmDexie(db.entities, entity);
    }

    async deleteEntity(entityId: string): Promise<void> {
        await this.goKittStore.deleteEntity(entityId);
        this.warmDexie(db.entities, null, entityId);
    }

    async getEntity(id: string): Promise<StoreEntity | null> {
        return this.goKittStore.getEntity(id);
    }

    async getAllEntities(): Promise<StoreEntity[]> {
        return this.goKittStore.listEntities();
    }

    // --- Edges ---

    async syncEdge(edge: Edge): Promise<void> {
        await this.goKittStore.upsertEdge(GoKittStoreService.fromDexieEdge(edge));
        this.warmDexie(db.edges, edge);
    }

    async deleteEdge(edgeId: string): Promise<void> {
        await this.goKittStore.deleteEdge(edgeId);
        this.warmDexie(db.edges, null, edgeId);
    }

    async getEdgesForEntity(entityId: string): Promise<StoreEdge[]> {
        return this.goKittStore.listEdgesForEntity(entityId);
    }

    // --- Utility ---

    /** Check if bridge is ready (sync version for operations.ts) */
    isReadySync(): boolean {
        // We consider it ready if store is ready, as init() handles the sync in background
        // But for strict startup safety, we might check status
        return this.goKittStore.isReady;
    }

    // =========================================================================
    // Mappers (Store -> Dexie)
    // =========================================================================

    private toDexieNote(n: StoreNote): Note {
        return {
            id: n.id,
            worldId: n.worldId,
            title: n.title,
            content: n.content,
            markdownContent: n.markdownContent,
            folderId: n.folderId,
            entityKind: n.entityKind,
            entitySubtype: n.entitySubtype,
            isEntity: n.isEntity,
            isPinned: n.isPinned,
            favorite: n.favorite,
            ownerId: n.ownerId,
            narrativeId: n.narrativeId,
            order: n.order,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt
        };
    }

    private toDexieEntity(e: StoreEntity): Entity {
        return {
            id: e.id,
            label: e.label,
            kind: e.kind,
            subtype: e.subtype,
            aliases: e.aliases,
            firstNote: e.firstNote,
            totalMentions: e.totalMentions,
            narrativeId: e.narrativeId,
            createdBy: e.createdBy,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt
        };
    }

    private toDexieFolder(f: StoreFolder): Folder {
        return {
            id: f.id,
            name: f.name,
            parentId: f.parentId || '',
            worldId: f.worldId,
            narrativeId: f.narrativeId || '',
            order: f.folderOrder,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
            // Default values for fields not present in StoreFolder
            entityKind: '',
            entitySubtype: '',
            entityLabel: '',
            color: '',
            isTypedRoot: false,
            isSubtypeRoot: false,
            collapsed: false,
            ownerId: '',
            isNarrativeRoot: false
        };
    }

    private toDexieEdge(e: StoreEdge): Edge {
        return {
            id: e.id,
            sourceId: e.sourceId,
            targetId: e.targetId,
            relType: e.relType,
            confidence: e.confidence,
            bidirectional: e.bidirectional,
        };
    }
}
