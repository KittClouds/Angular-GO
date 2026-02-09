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
    | { type: 'STORE_LIST_EDGES'; payload: { entityId: string }; id: number };

// =============================================================================
// Service
// =============================================================================

@Injectable({
    providedIn: 'root'
})
export class GoKittStoreService {
    private goKitt = inject(GoKittService);

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
    }

    private handleMessage(msg: any): void {
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

    private sendRequest<T>(type: string, payload: any): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const id = this.nextRequestId++;
            this.pendingRequests.set(id, { resolve, reject });

            this.worker.postMessage({ type, payload, id } as StoreWorkerMessage);

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
}
