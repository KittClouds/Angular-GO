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
    entityKind: string;
    entitySubtype: string;
    entityLabel: string;
    color: string;
    isTypedRoot: boolean;
    isSubtypeRoot: boolean;
    collapsed: boolean;
    ownerId: string;
    isNarrativeRoot: boolean;
    attributes?: string; // JSON blob for worldbuilding data, metadata, etc.
    createdAt: number;
    updatedAt: number;
}

export interface StoreScopedDocument {
    id: string;
    scopeFolderId: string;
    narrativeId: string;
    namespace: string;
    documentKey: string;
    payload: string;
    seededFromScopeFolderId?: string;
    createdAt: number;
    updatedAt: number;
}

export interface StoreScopedEntityField {
    id: string;
    entityId: string;
    scopeFolderId: string;
    narrativeId: string;
    fieldKey: string;
    valueJson: string;
    seededFromScopeFolderId?: string;
    createdAt: number;
    updatedAt: number;
}

export interface StoreScopedDefinition {
    id: string;
    narrativeId: string;
    namespace: string;
    definitionKey: string;
    payload: string;
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
    | { type: 'STORE_LIST_FOLDERS'; payload: { parentId?: string }; id: number }
    // Scoped metadata
    | { type: 'STORE_UPSERT_SCOPED_DOCUMENT'; payload: { documentJSON: string }; id: number }
    | { type: 'STORE_GET_SCOPED_DOCUMENT'; payload: { scopeFolderId: string; namespace: string; documentKey: string }; id: number }
    | { type: 'STORE_LIST_SCOPED_DOCUMENTS'; payload: { scopeFolderId: string; namespace?: string }; id: number }
    | { type: 'STORE_DELETE_SCOPED_DOCUMENT'; payload: { scopeFolderId: string; namespace: string; documentKey: string }; id: number }
    | { type: 'STORE_UPSERT_SCOPED_ENTITY_FIELD'; payload: { fieldJSON: string }; id: number }
    | { type: 'STORE_GET_SCOPED_ENTITY_FIELD'; payload: { entityId: string; scopeFolderId: string; fieldKey: string }; id: number }
    | { type: 'STORE_LIST_SCOPED_ENTITY_FIELDS'; payload: { scopeFolderId: string; entityId?: string }; id: number }
    | { type: 'STORE_DELETE_SCOPED_ENTITY_FIELD'; payload: { entityId: string; scopeFolderId: string; fieldKey: string }; id: number }
    | { type: 'STORE_UPSERT_SCOPED_DEFINITION'; payload: { definitionJSON: string }; id: number }
    | { type: 'STORE_GET_SCOPED_DEFINITION'; payload: { narrativeId: string; namespace: string; definitionKey: string }; id: number }
    | { type: 'STORE_LIST_SCOPED_DEFINITIONS'; payload: { narrativeId: string; namespace?: string }; id: number }
    | { type: 'STORE_DELETE_SCOPED_DEFINITION'; payload: { narrativeId: string; namespace: string; definitionKey: string }; id: number };

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
    // Offset from GoKittService (starts at 1) to prevent ID collisions
    // Both services share the SAME worker — overlapping IDs cause misrouted responses
    private nextRequestId = 100000;

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

        this.initPromise = this._initializeInternal().catch((err) => {
            this.initPromise = null;
            throw err;
        });
        return this.initPromise;
    }

    /**
     * Best-effort initialization used by early-boot consumers.
     * Returns false instead of throwing when GoKitt/WASM is not ready yet.
     */
    async tryInitialize(): Promise<boolean> {
        if (this.initialized) return true;
        if (!this.canInitialize) return false;

        try {
            await this.initialize();
            return this.initialized;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('GoKitt worker not available')) {
                return false;
            }
            throw err;
        }
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

        // Warm OPFS snapshot loading in parallel with in-memory SQLite init.
        const persistenceLoadPromise = this.persistence.load();

        // Initialize the SQLite store
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_INIT', {});

        if (!result.success) {
            throw new Error(`[GoKittStoreService] Store init failed: ${result.error}`);
        }

        this.initialized = true;
        console.log('[GoKittStoreService] ✅ SQLite Store initialized');

        // [INTEGRITY] Check SQLite Version
        try {
            const vRes = await this.sendRequest<{ version: string; error?: string }>('STORE_GET_VERSION', {});
            if (vRes.version) {
                console.log(`[GoKittStoreService] SQLite Engine Version: ${vRes.version}`);
            }
        } catch (e) {
            console.warn('[GoKittStoreService] Failed to check SQLite version:', e);
        }


        // [PERSISTENCE] Restore State (Snapshot Only - Snapshot Native)
        await this._restoreState(persistenceLoadPromise);

        // WAL Handler, Auto-Compaction REMOVED - Snapshot Native
    }


    private async _restoreState(snapshotLoadPromise?: Promise<{ snapshot: Uint8Array | null }>): Promise<void> {
        console.log('[GoKittStoreService] Restoring state from persistence...');
        const { snapshot } = await (snapshotLoadPromise ?? this.persistence.load());

        // Load Snapshot (Binary) — the only persistence source now
        if (snapshot) {
            console.log(`[GoKittStoreService] Importing snapshot (${snapshot.byteLength} bytes)...`);
            try {
                await this.importDatabase(snapshot);

                // Health Check: verify the DB is actually queryable
                const notes = await this.listNotes();
                console.log(`[GoKittStoreService] ✅ Snapshot imported successfully. Health check: ${notes.length} notes readable.`);
            } catch (e) {
                console.error('[GoKittStoreService] ❌ Snapshot is CORRUPT. Discarding and starting fresh.', e);

                // Reinitialize with a clean in-memory DB
                try {
                    await this.sendRequest('STORE_INIT', {});
                    console.log('[GoKittStoreService] ✅ Clean store re-initialized.');
                } catch (reinitErr) {
                    console.error('[GoKittStoreService] FATAL: Could not re-initialize store:', reinitErr);
                }

                // Nuke the corrupted snapshot from OPFS so it never loads again
                try {
                    await this.persistence.clear();
                    console.log('[GoKittStoreService] 🗑️ Corrupted snapshot cleared from OPFS.');
                } catch (clearErr) {
                    console.error('[GoKittStoreService] Failed to clear OPFS:', clearErr);
                }
            }
        } else {
            console.log('[GoKittStoreService] No snapshot found. Starting with empty database.');
        }
    }


    // _replayWalEntry REMOVED - Snapshot Native
    // _registerWalHandler REMOVED - Snapshot Native


    private handleMessage(msg: any): void {
        // WAL_EVENT handler REMOVED - Snapshot Native

        // Handle store responses and generic worker errors tied to a store request.
        if (msg.type !== 'ERROR' && !msg.type?.startsWith('STORE_')) return;


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
    // Persistence Trigger (Snapshot Native)
    // =========================================================================

    private _snapshotTimeout: any = null;
    private isSnapshottingPaused = false;

    /**
     * Pause OPFS snapshots. Crucial during boot/recovery to prevent death spirals.
     */
    pauseSnapshots(): void {
        this.isSnapshottingPaused = true;
        if (this._snapshotTimeout) {
            clearTimeout(this._snapshotTimeout);
            this._snapshotTimeout = null;
        }
    }

    /**
     * Resume OPFS snapshots after boot/recovery finishes.
     */
    resumeSnapshots(): void {
        this.isSnapshottingPaused = false;
    }

    /**
     * Immediately force a snapshot (bypassing debounce but still respecting pause).
     * Used by DataSyncService after a successful recovery.
     */
    async triggerSnapshot(): Promise<void> {
        if (!this.isReady || this.isSnapshottingPaused) return;
        try {
            console.log('[GoKittStoreService] 📸 Manual OPFS snapshot triggered...');
            const dbBlob = await this.exportDatabase();
            await this.persistence.saveSnapshot(dbBlob);
        } catch (err) {
            console.error('[GoKittStoreService] Failed manual snapshot:', err);
        }
    }

    /**
     * Debounces and triggers an atomic binary snapshot of the SQLite database
     * to the OPFS file system. Required because Snapshot Native has no WAL.
     */
    private scheduleSnapshot(): void {
        if (this.isSnapshottingPaused) return;

        if (this._snapshotTimeout) {
            clearTimeout(this._snapshotTimeout);
        }
        this._snapshotTimeout = setTimeout(async () => {
            try {
                if (this.isReady && !this.isSnapshottingPaused) {
                    console.log('[GoKittStoreService] 📸 Auto-triggering OPFS snapshot...');
                    const dbBlob = await this.exportDatabase();
                    await this.persistence.saveSnapshot(dbBlob);
                }
            } catch (err) {
                console.error('[GoKittStoreService] Failed to auto-save snapshot:', err);
            }
        }, 1500); // Debounce to allow batches to finish
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
        this.scheduleSnapshot();
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
        this.scheduleSnapshot();
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
        this.scheduleSnapshot();
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
        this.scheduleSnapshot();
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
        this.scheduleSnapshot();
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
        this.scheduleSnapshot();
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
     * Used by full graph hydration.
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
        this.scheduleSnapshot();
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
        this.scheduleSnapshot();
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
    // Scoped Metadata CRUD
    // =========================================================================

    async upsertScopedDocument(document: StoreScopedDocument): Promise<void> {
        await this.ensureInitialized();
        const documentJSON = JSON.stringify(document);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_UPSERT_SCOPED_DOCUMENT', { documentJSON });
        if (!result.success) {
            throw new Error(`Failed to upsert scoped document: ${result.error}`);
        }
        this.scheduleSnapshot();
    }

    async getScopedDocument(scopeFolderId: string, namespace: string, documentKey: string): Promise<StoreScopedDocument | null> {
        await this.ensureInitialized();
        return this.sendRequest<StoreScopedDocument | null>('STORE_GET_SCOPED_DOCUMENT', { scopeFolderId, namespace, documentKey });
    }

    async listScopedDocuments(scopeFolderId: string, namespace?: string): Promise<StoreScopedDocument[]> {
        await this.ensureInitialized();
        const result = await this.sendRequest<StoreScopedDocument[]>('STORE_LIST_SCOPED_DOCUMENTS', { scopeFolderId, namespace });
        return result || [];
    }

    async deleteScopedDocument(scopeFolderId: string, namespace: string, documentKey: string): Promise<void> {
        await this.ensureInitialized();
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_DELETE_SCOPED_DOCUMENT', { scopeFolderId, namespace, documentKey });
        if (!result.success) {
            throw new Error(`Failed to delete scoped document: ${result.error}`);
        }
        this.scheduleSnapshot();
    }

    async upsertScopedEntityField(field: StoreScopedEntityField): Promise<void> {
        await this.ensureInitialized();
        const fieldJSON = JSON.stringify(field);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_UPSERT_SCOPED_ENTITY_FIELD', { fieldJSON });
        if (!result.success) {
            throw new Error(`Failed to upsert scoped entity field: ${result.error}`);
        }
        this.scheduleSnapshot();
    }

    async getScopedEntityField(entityId: string, scopeFolderId: string, fieldKey: string): Promise<StoreScopedEntityField | null> {
        await this.ensureInitialized();
        return this.sendRequest<StoreScopedEntityField | null>('STORE_GET_SCOPED_ENTITY_FIELD', { entityId, scopeFolderId, fieldKey });
    }

    async listScopedEntityFields(scopeFolderId: string, entityId?: string): Promise<StoreScopedEntityField[]> {
        await this.ensureInitialized();
        const result = await this.sendRequest<StoreScopedEntityField[]>('STORE_LIST_SCOPED_ENTITY_FIELDS', { scopeFolderId, entityId });
        return result || [];
    }

    async deleteScopedEntityField(entityId: string, scopeFolderId: string, fieldKey: string): Promise<void> {
        await this.ensureInitialized();
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_DELETE_SCOPED_ENTITY_FIELD', { entityId, scopeFolderId, fieldKey });
        if (!result.success) {
            throw new Error(`Failed to delete scoped entity field: ${result.error}`);
        }
        this.scheduleSnapshot();
    }

    async upsertScopedDefinition(definition: StoreScopedDefinition): Promise<void> {
        await this.ensureInitialized();
        const definitionJSON = JSON.stringify(definition);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_UPSERT_SCOPED_DEFINITION', { definitionJSON });
        if (!result.success) {
            throw new Error(`Failed to upsert scoped definition: ${result.error}`);
        }
        this.scheduleSnapshot();
    }

    async getScopedDefinition(narrativeId: string, namespace: string, definitionKey: string): Promise<StoreScopedDefinition | null> {
        await this.ensureInitialized();
        return this.sendRequest<StoreScopedDefinition | null>('STORE_GET_SCOPED_DEFINITION', { narrativeId, namespace, definitionKey });
    }

    async listScopedDefinitions(narrativeId: string, namespace?: string): Promise<StoreScopedDefinition[]> {
        await this.ensureInitialized();
        const result = await this.sendRequest<StoreScopedDefinition[]>('STORE_LIST_SCOPED_DEFINITIONS', { narrativeId, namespace });
        return result || [];
    }

    async deleteScopedDefinition(narrativeId: string, namespace: string, definitionKey: string): Promise<void> {
        await this.ensureInitialized();
        const result = await this.sendRequest<{ success: boolean; error?: string }>('STORE_DELETE_SCOPED_DEFINITION', { narrativeId, namespace, definitionKey });
        if (!result.success) {
            throw new Error(`Failed to delete scoped definition: ${result.error}`);
        }
        this.scheduleSnapshot();
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

    get canInitialize(): boolean {
        return !!this.goKitt.worker && this.goKitt.isReady;
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
            entityKind: dexieFolder.entityKind || '',
            entitySubtype: dexieFolder.entitySubtype || '',
            entityLabel: dexieFolder.entityLabel || '',
            color: dexieFolder.color || '',
            isTypedRoot: dexieFolder.isTypedRoot || false,
            isSubtypeRoot: dexieFolder.isSubtypeRoot || false,
            collapsed: dexieFolder.collapsed || false,
            ownerId: dexieFolder.ownerId || '',
            isNarrativeRoot: dexieFolder.isNarrativeRoot || false,
            attributes: dexieFolder.attributes ? (typeof dexieFolder.attributes === 'string' ? dexieFolder.attributes : JSON.stringify(dexieFolder.attributes)) : undefined,
            createdAt: dexieFolder.createdAt || Date.now(),
            updatedAt: dexieFolder.updatedAt || Date.now()
        };
    }
}
