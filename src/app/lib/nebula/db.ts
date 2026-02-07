/**
 * CrepeNebulaDB - NebulaDB wrapper with typed collections
 * 
 * Replaces Dexie as the client-facing store.
 * Persistence is handled by CozoDB + OPFS (no IndexedDB).
 * 
 * Boot Flow:
 * 1. BootCache provides instant entity rendering
 * 2. CozoDB hydrates full data from OPFS
 * 3. NebulaDB populates collections from Cozo queries
 */

// Import from local NebulaDB copy (using minimal Angular-compatible exports)
import { createDb as createDatabase, Database, ICollection, Document, IndexType } from '../nebula-db/packages/core/src/angular-exports';
import { MemoryAdapter } from '../nebula-db/packages/core/src/angular-exports';
import { createVersioningPlugin } from './versioning-plugin';

// Re-export types from Dexie for compatibility
export type {
    Note,
    Folder,
    Entity,
    Edge,
    Tag,
    NoteTag,
    Mention,
    Span,
    Wormhole,
    SpanMention,
    Claim,
    TimelineEvent,
} from '../dexie/db';

import type {
    Note,
    Folder,
    Entity,
    Edge,
    Tag,
    NoteTag,
    Mention,
    Span,
    Wormhole,
    SpanMention,
    Claim,
    TimelineEvent,
} from '../dexie/db';

// =============================================================================
// NEBULA DATABASE CLASS
// =============================================================================

export class CrepeNebulaDB {
    private db: Database;
    private _ready = false;

    // Core content collections
    notes: ICollection;
    folders: ICollection;

    // Entities & Relationships
    entities: ICollection;
    edges: ICollection;
    mentions: ICollection;
    tags: ICollection;
    noteTags: ICollection;

    // Span-first model
    spans: ICollection;
    wormholes: ICollection;
    spanMentions: ICollection;
    claims: ICollection;

    // Timeline
    timelineEvents: ICollection;

    // AI Chat
    chatMessages: ICollection;

    constructor() {
        // Initialize with MemoryAdapter (no IndexedDB)
        // Persistence is handled by Cozo + OPFS
        this.db = createDatabase({
            adapter: new MemoryAdapter(),
            plugins: [
                createVersioningPlugin({
                    collections: ['notes'], // Track version history for notes
                    maxVersions: 50,        // Keep enough history for robust undo/redo
                    versionField: '_version',
                    timestampField: '_updatedAt'
                })
            ],
        });

        // Initialize collections with indexes for optimized queries
        this.notes = this.db.collection('notes', {
            indexes: [
                { name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE },
                { name: 'folderId_idx', fields: ['folderId'], type: IndexType.SINGLE }
            ]
        });

        this.folders = this.db.collection('folders', {
            indexes: [
                { name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE },
                { name: 'parentId_idx', fields: ['parentId'], type: IndexType.SINGLE },
                { name: 'narrativeId_idx', fields: ['narrativeId'], type: IndexType.SINGLE }
            ]
        });

        this.entities = this.db.collection('entities', {
            indexes: [
                { name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE },
                { name: 'kind_idx', fields: ['kind'], type: IndexType.SINGLE },
                { name: 'label_idx', fields: ['label'], type: IndexType.SINGLE }
            ]
        });

        this.edges = this.db.collection('edges', {
            indexes: [
                { name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE },
                { name: 'source_target_idx', fields: ['source', 'target'], type: IndexType.COMPOUND }
            ]
        });

        // Secondary collections (basic id index)
        this.mentions = this.db.collection('mentions', {
            indexes: [{ name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE }]
        });
        this.tags = this.db.collection('tags', {
            indexes: [{ name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE }]
        });
        this.noteTags = this.db.collection('noteTags', {
            indexes: [{ name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE }]
        });
        this.spans = this.db.collection('spans', {
            indexes: [{ name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE }]
        });
        this.wormholes = this.db.collection('wormholes', {
            indexes: [{ name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE }]
        });
        this.spanMentions = this.db.collection('spanMentions', {
            indexes: [{ name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE }]
        });
        this.claims = this.db.collection('claims', {
            indexes: [{ name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE }]
        });
        this.timelineEvents = this.db.collection('timelineEvents', {
            indexes: [{ name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE }]
        });

        // AI Chat messages
        this.chatMessages = this.db.collection('chatMessages', {
            indexes: [
                { name: 'id_idx', fields: ['id'], type: IndexType.UNIQUE },
                { name: 'sessionId_idx', fields: ['sessionId'], type: IndexType.SINGLE },
                { name: 'createdAt_idx', fields: ['createdAt'], type: IndexType.SINGLE }
            ]
        });
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    get isReady(): boolean {
        return this._ready;
    }

    /**
     * Mark as ready after hydration from Cozo
     */
    setReady(): void {
        this._ready = true;
        console.log('[NebulaDB] ✅ Ready');
    }

    // -------------------------------------------------------------------------
    // Hydration from Cozo
    // -------------------------------------------------------------------------

    /**
     * Populate a collection with documents from Cozo query results
     */
    async hydrateCollection<T extends Document>(
        collection: ICollection,
        documents: T[]
    ): Promise<void> {
        if (documents.length === 0) return;

        await collection.insertBatch(documents);
        console.log(`[NebulaDB] Hydrated ${collection.name}: ${documents.length} docs`);
    }

    /**
     * Clear all collections (for re-hydration)
     */
    async clearAll(): Promise<void> {
        const collections = [
            this.notes,
            this.folders,
            this.entities,
            this.edges,
            this.mentions,
            this.tags,
            this.noteTags,
            this.spans,
            this.wormholes,
            this.spanMentions,
            this.claims,
            this.timelineEvents,
            this.chatMessages,
        ];

        for (const col of collections) {
            await col.delete({});
        }

        this._ready = false;
        console.log('[NebulaDB] Cleared all collections');
    }

    // -------------------------------------------------------------------------
    // Convenience Methods (Dexie Parity)
    // -------------------------------------------------------------------------

    /**
     * Get a note by ID
     */
    async getNote(id: string): Promise<Note | null> {
        return await this.notes.findOne({ id }) as Note | null;
    }

    /**
     * Get notes by folder
     */
    async getNotesByFolder(folderId: string): Promise<Note[]> {
        return await this.notes.find({ folderId }) as Note[];
    }

    /**
     * Get a folder by ID
     */
    async getFolder(id: string): Promise<Folder | null> {
        return await this.folders.findOne({ id }) as Folder | null;
    }

    /**
     * Get child folders
     */
    async getChildFolders(parentId: string): Promise<Folder[]> {
        return await this.folders.find({ parentId }) as Folder[];
    }

    /**
     * Get an entity by ID
     */
    async getEntity(id: string): Promise<Entity | null> {
        return await this.entities.findOne({ id }) as Entity | null;
    }

    /**
     * Get all entities for a narrative
     */
    async getEntitiesByNarrative(narrativeId: string): Promise<Entity[]> {
        return await this.entities.find({ narrativeId }) as Entity[];
    }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================
// Singleton instance
export const nebulaDb = new CrepeNebulaDB();

// Debug access
if (typeof window !== 'undefined') {
    (window as any).nebulaDb = nebulaDb;
    console.log('[NebulaDB] 🔧 Debug: window.nebulaDb');
}
