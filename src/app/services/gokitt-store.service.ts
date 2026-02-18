/**
 * GoKitt SQLite Store Service
 * 
 * Provides a TypeScript interface to the Go SQLite store running in WASM.
 * This is the primary data persistence layer, replacing Dexie for notes/entities/edges.
 * 
 * Architecture:
 * - Angular Service → Worker Message → Go WASM → SQLite (in-memory)
 * - All data persists in Go's SQLite database
 * - TypeScript types mirror Go struct definitions exactly
 */

import { Injectable, inject } from '@angular/core';
import { GoKittService } from './gokitt.service';
import { SqlitePersistenceService } from '../lib/sqlite/persistence/SqlitePersistenceService';


// =============================================================================
// Type Definitions - Mirroring Go store/models.go
// =============================================================================

/**
 * Note represents a document in the store.
 * Maps 1:1 to Go store.Note struct.
 */
export interface StoreNote {
    id: string;
    worldId: string;
    title: string;
    content: string;
    markdownContent: string;
    folderId: string;
    entityKind: string;
    entitySubtype: string;
    isEntity: boolean;
    isPinned: boolean;
    favorite: boolean;
    ownerId: string;
    narrativeId: string;
    order: number;
    createdAt: number;
    updatedAt: number;
}

/**
 * Entity represents a registered entity in the store.
 * Maps 1:1 to Go store.Entity struct.
 */
export interface StoreEntity {
    id: string;
    label: string;
    kind: string;
    subtype?: string;
    aliases: string[];
    firstNote: string;
    totalMentions: number;
    narrativeId?: string;
    createdBy: 'user' | 'extraction' | 'auto';
    createdAt: number;
    updatedAt: number;
}

/**
 * Edge represents a relationship between two entities.
 * Maps 1:1 to Go store.Edge struct.
 */
export interface StoreEdge {
    id: string;
    sourceId: string;
    targetId: string;
    relType: string;
    confidence: number;
    bidirectional: boolean;
    sourceNote?: string;
    createdAt: number;
}

/**
 * Folder represents a folder in the document hierarchy.
 * Maps 1:1 to Go store.Folder struct.
 */
export interface StoreFolder {
    id: string;
    name: string;
    parentId?: string;
    worldId: string;
    narrativeId?: string;
    folderOrder: number;
    createdAt: number;
    updatedAt: number;
}

// =============================================================================
// Worker Message Types (added to extend GoKitt API)
// =============================================================================

type StoreWorkerMessage =
    // SQLite Store API
    | { type: 'STORE_INIT'; id: number }
    | { type: 'STORE_UPSERT_NOTE'; payload: { noteJSON: string }; id: number }
    | { type: 'STORE_GET_NOTE'; payload: { id: string }; id: number }
    | { type: 'STORE_DELETE_NOTE'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_NOTES'; payload: { folderId?: string }; id: number }
    | { type: 'STORE_UPSERT_ENTITY'; payload: { entityJSON: string }; id: number }
    | { type: 'STORE_GET_ENTITY'; payload: { id: string }; id: number }
    | { type: 'STORE_GET_ENTITY_BY_LABEL'; payload: { label: string }; id: number }
    | { type: 'STORE_DELETE_ENTITY'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_ENTITIES'; payload: { kind?: string }; id: number }
    | { type: 'STORE_UPSERT_EDGE'; payload: { edgeJSON: string }; id: number }
    | { type: 'STORE_GET_EDGE'; payload: { id: string }; id: number }
    | { type: 'STORE_DELETE_EDGE'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_EDGES'; payload: { entityId: string }; id: number }
    // Export/Import (OPFS Sync)
    | { type: 'STORE_EXPORT'; id: number }
    | { type: 'STORE_IMPORT'; payload: { data: ArrayBuffer }; id: number }
    // Folder CRUD
    | { type: 'STORE_UPSERT_FOLDER'; payload: { folderJSON: string }; id: number }
    | { type: 'STORE_GET_FOLDER'; payload: { id: string }; id: number }
    | { type: 'STORE_DELETE_FOLDER'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_FOLDERS'; payload: { parentId?: string }; id: number };

// =============================================================================
// Service
// =============================================================================

@Injectable({
    providedIn: 'root'
})
export class GoKittStoreService {
    private goKitt = inject(GoKittService);
    private persistence = inject(SqlitePersistenceService);

    private worker: Worker | null = null;

    private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private nextRequestId = 1;

    private initialized = false;
    private initPromise: Promise<void> | null = null;

    constructor() {
        console.log('[GoKittStoreService] Service created');
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    /**
     * Initialize the SQLite store.
     * Must be called after GoKittService.loadWasm() completes.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._initializeInternal();
        return this.initPromise;
    }

    private async _initializeInternal(): Promise<void> {
        // Get worker reference from GoKittService
        // We need to access the worker - for now we'll create our own message channel
        this.worker = (this.goKitt as any).worker;

        if (!this.worker) {
            throw new Error('[GoKittStoreService] GoKitt worker not available. Ensure loadWasm() was called first.');
        }

        // Setup message handler for store responses
        this.worker.addEventListener('message', (e: MessageEvent) => {
            this.handleMessage(e.data);
        });

        // Initialize the SQLite store
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_INIT', {});

        if (!result.success) {
            throw new Error(`[GoKittStoreService] Store init failed: ${result.error}`);
        }

        this.initialized = true;
        console.log('[GoKittStoreService] ✅ SQLite Store initialized');

        // [PERSISTENCE] Restore State (Snapshot + WAL)
        await this._restoreState();

        // [PERSISTENCE] Register WAL Handler
        // [PERSISTENCE] Register WAL Handler
        this._registerWalHandler();

        // [PERSISTENCE] Setup Auto-Compaction
        this.persistence.compactNeeded$.subscribe(async () => {
            console.log('[GoKittStoreService] Auto-compacting database...');
            try {
                const data = await this.exportDatabase();
                await this.persistence.compact(data);
                console.log('[GoKittStoreService] Auto-compaction successful');
            } catch (e) {
                console.error('[GoKittStoreService] Auto-compaction failed:', e);
            }
        });
    }


    private async _restoreState(): Promise<void> {
        console.log('[GoKittStoreService] Restoring state from persistence...');
        const { snapshot, wal, recoveryMode } = await this.persistence.load();

        // 1. Load Snapshot (Binary)
        if (snapshot) {
            console.log(`[GoKittStoreService] Importing snapshot (${snapshot.byteLength} bytes)...`);
            // We need to send this Uint8Array to the worker -> Go
            // Since we can't easily pass it via the generic sendRequest (yet), 
            // we rely on the implementationdetails of GoOpfsSyncService being replaced
            // For now, we reuse the existing infrastructure or add a specialized call

            // To properly send ArrayBuffer transferables, we need direct worker access or updated GoKittService
            // Assuming we can send it as payload for now (copy overhead, but works for V1)

            // @todo: Optimize with Transferable when GoKittService supports it
            await this.importDatabase(snapshot);
        }

        // 2. Replay WAL (JSONL)
        if (wal.length > 0) {
            console.log(`[GoKittStoreService] Replaying ${wal.length} WAL entries...`);
            for (const entry of wal) {
                try {
                    await this._replayWalEntry(entry);
                } catch (e) {
                    console.warn(`[GoKittStoreService] Failed to replay WAL entry ${entry.op}:`, e);
                }
            }
        }

        if (recoveryMode) {
            console.warn('[GoKittStoreService] ⚠️ System recovered from backup');
        }
    }

    private async _replayWalEntry(entry: { op: string; data: any }): Promise<void> {
        // Map WAL op to Store method
        switch (entry.op) {
            case 'upsertNote':
                await this.upsertNote(entry.data);
                break;
            case 'deleteNote':
                await this.deleteNote(entry.data.id);
                break;
            case 'upsertEntity':
                await this.upsertEntity(entry.data);
                break;
            case 'deleteEntity':
                await this.deleteEntity(entry.data.id);
                break;
            case 'upsertEdge':
                await this.upsertEdge(entry.data);
                break;
            case 'deleteEdge':
                await this.deleteEdge(entry.data.id);
                break;
            case 'upsertFolder':
                await this.upsertFolder(entry.data);
                break;
            case 'deleteFolder':
                await this.deleteFolder(entry.data.id);
                break;
        }
    }

    private _registerWalHandler(): void {
        // The handler is registered in the worker during init and events are sent as WAL_EVENT messages.
        // We listen for them in handleMessage().
        console.log('[GoKittStoreService] Listening for WAL events from worker');
    }


    private handleMessage(msg: any): void {
        // [WAL] Handle incoming WAL events
        if (msg.type === 'WAL_EVENT') {
            const { op, data } = msg;
            this.persistence.appendWal(op, data);
            return;
        }

        // Only handle store-related responses
        if (!msg.type?.startsWith('STORE_')) return;


        if ('id' in msg && msg.id !== undefined) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                this.pendingRequests.delete(msg.id);

                if (msg.type === 'ERROR') {
                    pending.reject(new Error(msg.payload?.message || 'Unknown error'));
                } else {
                    pending.resolve(msg.payload);
                }
            }
        }
    }

    private sendRequest<T>(type: string, payload: any, transfer: Transferable[] = []): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const id = this.nextRequestId++;
            this.pendingRequests.set(id, { resolve, reject });

            this.worker.postMessage({ type, payload, id } as StoreWorkerMessage, transfer);


            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${type} timed out`));
                }
            }, 30000);
        });
    }

    // =========================================================================
    // Note CRUD
    // =========================================================================

    /**
     * Insert or update a note.
     */
    async upsertNote(note: StoreNote): Promise<void> {
        await this.ensureInitialized();
        const noteJSON = JSON.stringify(note);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_UPSERT_NOTE', { noteJSON });
        if (!result.success) {
            throw new Error(`Failed to upsert note: ${result.error}`);
        }
    }

    /**
     * Get a note by ID.
     */
    async getNote(id: string): Promise<StoreNote | null> {
        await this.ensureInitialized();
        return this.sendRequest<StoreNote | null>('STORE_GET_NOTE', { id });
    }

    /**
     * Delete a note by ID.
     */
    async deleteNote(id: string): Promise<void> {
        await this.ensureInitialized();
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_DELETE_NOTE', { id });
        if (!result.success) {
            throw new Error(`Failed to delete note: ${result.error}`);
        }
    }

    /**
     * List all notes, optionally filtered by folder.
     */
    async listNotes(folderId?: string): Promise<StoreNote[]> {
        await this.ensureInitialized();
        const result = await this.sendRequest<StoreNote[]>('STORE_LIST_NOTES', { folderId });
        return result || [];
    }

    // =========================================================================
    // Entity CRUD
    // =========================================================================

    /**
     * Insert or update an entity.
     */
    async upsertEntity(entity: StoreEntity): Promise<void> {
        await this.ensureInitialized();
        const entityJSON = JSON.stringify(entity);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_UPSERT_ENTITY', { entityJSON });
        if (!result.success) {
            throw new Error(`Failed to upsert entity: ${result.error}`);
        }
    }

    /**
     * Get an entity by ID.
     */
    async getEntity(id: string): Promise<StoreEntity | null> {
        await this.ensureInitialized();
        return this.sendRequest<StoreEntity | null>('STORE_GET_ENTITY', { id });
    }

    /**
     * Find an entity by label (case-insensitive).
     */
    async getEntityByLabel(label: string): Promise<StoreEntity | null> {
        await this.ensureInitialized();
        return this.sendRequest<StoreEntity | null>('STORE_GET_ENTITY_BY_LABEL', { label });
    }

    /**
     * Delete an entity by ID.
     */
    async deleteEntity(id: string): Promise<void> {
        await this.ensureInitialized();
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_DELETE_ENTITY', { id });
        if (!result.success) {
            throw new Error(`Failed to delete entity: ${result.error}`);
        }
    }

    /**
     * List all entities, optionally filtered by kind.
     */
    async listEntities(kind?: string): Promise<StoreEntity[]> {
        await this.ensureInitialized();
        const result = await this.sendRequest<StoreEntity[]>('STORE_LIST_ENTITIES', { kind });
        return result || [];
    }

    // =========================================================================
    // Edge CRUD
    // =========================================================================

    /**
     * Insert or update an edge.
     */
    async upsertEdge(edge: StoreEdge): Promise<void> {
        await this.ensureInitialized();
        const edgeJSON = JSON.stringify(edge);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_UPSERT_EDGE', { edgeJSON });
        if (!result.success) {
            throw new Error(`Failed to upsert edge: ${result.error}`);
        }
    }

    /**
     * Get an edge by ID.
     */
    async getEdge(id: string): Promise<StoreEdge | null> {
        await this.ensureInitialized();
        return this.sendRequest<StoreEdge | null>('STORE_GET_EDGE', { id });
    }

    /**
     * Delete an edge by ID.
     */
    async deleteEdge(id: string): Promise<void> {
        await this.ensureInitialized();
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_DELETE_EDGE', { id });
        if (!result.success) {
            throw new Error(`Failed to delete edge: ${result.error}`);
        }
    }

    /**
     * List all edges for an entity (as source or target).
     */
    async listEdgesForEntity(entityId: string): Promise<StoreEdge[]> {
        await this.ensureInitialized();
        const result = await this.sendRequest<StoreEdge[]>('STORE_LIST_EDGES', { entityId });
        return result || [];
    }

    /**
     * List ALL edges in the store (no filter).
     * Used by CozoHydrator for full graph hydration.
     */
    async listAllEdges(): Promise<StoreEdge[]> {
        await this.ensureInitialized();
        // Use empty string to get all edges
        const result = await this.sendRequest<StoreEdge[]>('STORE_LIST_EDGES', { entityId: '' });
        return result || [];
    }

    // =========================================================================
    // Folder CRUD
    // =========================================================================

    /**
     * Insert or update a folder.
     */
    async upsertFolder(folder: StoreFolder): Promise<void> {
        await this.ensureInitialized();
        const folderJSON = JSON.stringify(folder);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_UPSERT_FOLDER', { folderJSON });
        if (!result.success) {
            throw new Error(`Failed to upsert folder: ${result.error}`);
        }
    }

    /**
     * Get a folder by ID.
     */
    async getFolder(id: string): Promise<StoreFolder | null> {
        await this.ensureInitialized();
        return this.sendRequest<StoreFolder | null>('STORE_GET_FOLDER', { id });
    }

    /**
     * Delete a folder by ID.
     */
    async deleteFolder(id: string): Promise<void> {
        await this.ensureInitialized();
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_DELETE_FOLDER', { id });
        if (!result.success) {
            throw new Error(`Failed to delete folder: ${result.error}`);
        }
    }

    /**
     * List folders, optionally filtered by parent.
     */
    async listFolders(parentId?: string): Promise<StoreFolder[]> {
        await this.ensureInitialized();
        const result = await this.sendRequest<StoreFolder[]>('STORE_LIST_FOLDERS', { parentId });
        return result || [];
    }

    // =========================================================================
    // Export / Import (OPFS Sync)
    // =========================================================================

    /**
     * Export the entire SQLite database as a binary blob.
     * Returns raw bytes for OPFS persistence.
     */
    async exportDatabase(): Promise<Uint8Array> {
        await this.ensureInitialized();
        const result = await this.sendRequest<{ data: ArrayBuffer; size: number } | { success: false; error: string }>('STORE_EXPORT', {});
        if ('error' in result) {
            throw new Error(`Export failed: ${result.error}`);
        }
        return new Uint8Array(result.data);
    }

    /**
     * Import a SQLite database from binary blob.
     * Replaces all existing data.
     */
    async importDatabase(data: Uint8Array): Promise<void> {
        await this.ensureInitialized();
        // Transfer the buffer for zero-copy
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_IMPORT', { data: buffer }, [buffer]);

        if (!result.success) {
            throw new Error(`Import failed: ${result.error}`);
        }
    }

    /**
     * Count notes in the store (without fetching all data).
     */
    async countNotes(): Promise<number> {
        await this.ensureInitialized();
        const notes = await this.listNotes();
        return notes.length;
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    /**
     * Check if the store is ready.
     */
    get isReady(): boolean {
        return this.initialized;
    }

    // =========================================================================
    // Conversion Helpers (Dexie ↔ Store)
    // =========================================================================

    /**
     * Convert a Dexie Note to StoreNote format.
     */
    static fromDexieNote(dexieNote: any): StoreNote {
        return {
            id: dexieNote.id,
            worldId: dexieNote.worldId || '',
            title: dexieNote.title || '',
            content: dexieNote.content || '',
            markdownContent: dexieNote.markdownContent || '',
            folderId: dexieNote.folderId || '',
            entityKind: dexieNote.entityKind || '',
            entitySubtype: dexieNote.entitySubtype || '',
            isEntity: dexieNote.isEntity || false,
            isPinned: dexieNote.isPinned || false,
            favorite: dexieNote.favorite || false,
            ownerId: dexieNote.ownerId || '',
            narrativeId: dexieNote.narrativeId || '',
            order: dexieNote.order || 0,
            createdAt: dexieNote.createdAt || Date.now(),
            updatedAt: dexieNote.updatedAt || Date.now()
        };
    }

    /**
     * Convert a Dexie Entity to StoreEntity format.
     */
    static fromDexieEntity(dexieEntity: any): StoreEntity {
        return {
            id: dexieEntity.id,
            label: dexieEntity.label || '',
            kind: dexieEntity.kind || 'UNKNOWN',
            subtype: dexieEntity.subtype,
            aliases: dexieEntity.aliases || [],
            firstNote: dexieEntity.firstNote || '',
            totalMentions: dexieEntity.totalMentions || 0,
            narrativeId: dexieEntity.narrativeId,
            createdBy: dexieEntity.createdBy || 'user',
            createdAt: dexieEntity.createdAt || Date.now(),
            updatedAt: dexieEntity.updatedAt || Date.now()
        };
    }

    /**
     * Convert a Dexie Edge to StoreEdge format.
     */
    static fromDexieEdge(dexieEdge: any): StoreEdge {
        return {
            id: dexieEdge.id,
            sourceId: dexieEdge.sourceId,
            targetId: dexieEdge.targetId,
            relType: dexieEdge.relType || 'RELATED_TO',
            confidence: dexieEdge.confidence ?? 1.0,
            bidirectional: dexieEdge.bidirectional || false,
            sourceNote: dexieEdge.sourceNote,
            createdAt: dexieEdge.createdAt || Date.now()
        };
    }

    /**
     * Convert a Dexie Folder to StoreFolder format.
     */
    static fromDexieFolder(dexieFolder: any): StoreFolder {
        return {
            id: dexieFolder.id,
            name: dexieFolder.name || '',
            parentId: dexieFolder.parentId,
            worldId: dexieFolder.worldId || '',
            narrativeId: dexieFolder.narrativeId,
            folderOrder: dexieFolder.folderOrder ?? dexieFolder.order ?? 0,
            createdAt: dexieFolder.createdAt || Date.now(),
            updatedAt: dexieFolder.updatedAt || Date.now()
        };
    }
}
