// src/app/lib/dexie/db.ts
// Dexie database for Angular - Complete schema with scope hierarchy
// This is the IndexedDB persistence layer

import Dexie, { Table } from 'dexie';

// =============================================================================
// CORE CONTENT INTERFACES
// =============================================================================

export interface Note {
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
    createdAt: number;
    updatedAt: number;
    // Scope hierarchy
    narrativeId: string;          // Vault this note belongs to ('' if global)
}

export interface Folder {
    id: string;
    worldId: string;
    name: string;
    parentId: string;
    entityKind: string;
    entitySubtype: string;
    entityLabel: string;
    color: string;
    isTypedRoot: boolean;
    isSubtypeRoot: boolean;
    collapsed: boolean;
    ownerId: string;
    createdAt: number;
    updatedAt: number;
    // Scope hierarchy
    narrativeId: string;          // Vault this folder belongs to ('' if global)
    isNarrativeRoot: boolean;     // Is THIS folder a vault root?
    // Network
    networkId?: string;           // If this folder IS a network root
}

export interface Tag {
    id: string;
    worldId: string;
    name: string;
    color: string;
    ownerId: string;
}

export interface NoteTag {
    noteId: string;
    tagId: string;
}

export interface Entity {
    id: string;
    label: string;
    kind: string;
    subtype?: string;
    aliases: string[];
    firstNote: string;
    totalMentions: number;
    createdAt: number;
    updatedAt: number;
    createdBy: 'user' | 'extraction' | 'auto';
    narrativeId?: string;         // Scope to narrative
}

export interface Mention {
    id: string;
    noteId: string;
    entityId: string;
    start: number;
    end: number;
    matchType: string;
}

export interface Edge {
    id: string;
    sourceId: string;
    targetId: string;
    relType: string;
    confidence: number;
    bidirectional: boolean;
}

// =============================================================================
// DECORATION & CACHE INTERFACES
// =============================================================================

export interface DecorationMeta {
    noteId: string;
    version: number;
    lastScan: number;
}

export interface DecorationSpans {
    noteId: string;
    spans: any[];
    contentHash: string;
    updatedAt: number;
}

export interface ScannerCache {
    id: string;
    data: Uint8Array;
    createdAt: number;
}

export interface ModelCache {
    modelId: string;
    onnx: ArrayBuffer;
    tokenizer: string;
    timestamp: number;
}

// =============================================================================
// ENTITY FACT SHEET INTERFACES
// =============================================================================

export interface EntityMetadata {
    entityId: string;
    key: string;
    value: string;
}

export interface EntityCard {
    entityId: string;
    cardId: string;
    name: string;
    color: string;
    icon: string;
    displayOrder: number;
    isCollapsed: boolean;
    createdAt: number;
    updatedAt: number;
}

// =============================================================================
// FOLDER SCHEMA INTERFACES (NEW)
// =============================================================================

export interface AllowedSubfolderDef {
    entityKind: string;
    subtype?: string;
    label: string;
    icon?: string;
    description?: string;
    relationshipType?: string;
    autoCreateNetwork?: boolean;
    networkSchemaId?: string;
}

export interface AllowedNoteTypeDef {
    entityKind: string;
    subtype?: string;
    label: string;
    icon?: string;
    templateId?: string;
}

export interface FolderSchema {
    id: string;                   // e.g., "CHARACTER" or "CHARACTER::PROTAGONIST"
    entityKind: string;
    subtype?: string;
    name: string;
    description?: string;
    allowedSubfolders: AllowedSubfolderDef[];
    allowedNoteTypes: AllowedNoteTypeDef[];
    isVaultRoot: boolean;         // NARRATIVE = true
    containerOnly: boolean;       // Only subfolders, no notes
    propagateKindToChildren: boolean;
    icon?: string;
    isSystem: boolean;
    createdAt: number;
    updatedAt: number;
}

// =============================================================================
// NETWORK INTERFACES (NEW)
// =============================================================================

export type NetworkKind = 'FAMILY' | 'ORGANIZATION' | 'FACTION' | 'ALLIANCE' | 'GUILD' | 'FRIENDSHIP' | 'RIVALRY' | 'CUSTOM';

export interface NetworkRelationshipDef {
    id: string;
    code: string;
    label: string;
    sourceKind: string;
    targetKind: string;
    direction: 'OUTBOUND' | 'INBOUND' | 'BIDIRECTIONAL';
    inverseCode?: string;
    icon?: string;
}

export interface NetworkSchema {
    id: string;
    name: string;
    kind: NetworkKind;
    subtype?: string;
    description: string;
    allowedEntityKinds: string[];
    relationships: NetworkRelationshipDef[];
    isHierarchical: boolean;
    allowCycles: boolean;
    autoCreateInverse: boolean;
    icon?: string;
    isSystem: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface NetworkInstance {
    id: string;
    schemaId: string;
    name: string;
    rootFolderId: string;
    rootEntityId?: string;
    entityIds: string[];
    narrativeId: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
}

export interface NetworkRelationship {
    id: string;
    networkId: string;
    sourceEntityId: string;
    targetEntityId: string;
    relationshipCode: string;
    strength?: number;
    startDate?: number;
    endDate?: number;
    notes?: string;
    createdAt: number;
    updatedAt: number;
}

// =============================================================================
// DEXIE DATABASE
// =============================================================================

export class CrepeDatabase extends Dexie {
    // Core content
    notes!: Table<Note>;
    folders!: Table<Folder>;
    tags!: Table<Tag>;
    noteTags!: Table<NoteTag>;
    entities!: Table<Entity>;
    mentions!: Table<Mention>;
    edges!: Table<Edge>;

    // Decorations
    decorationMeta!: Table<DecorationMeta>;
    decorationSpans!: Table<DecorationSpans>;

    // Cache
    scannerCache!: Table<ScannerCache>;
    modelCache!: Table<ModelCache>;

    // Fact sheets
    entityMetadata!: Table<EntityMetadata>;
    entityCards!: Table<EntityCard>;

    // Folder schemas (NEW)
    folderSchemas!: Table<FolderSchema>;

    // Networks (NEW)
    networkSchemas!: Table<NetworkSchema>;
    networkInstances!: Table<NetworkInstance>;
    networkRelationships!: Table<NetworkRelationship>;

    constructor() {
        super('CrepeNotes');

        // Version 3: Added scope hierarchy and schema tables
        this.version(3).stores({
            // Notes: added narrativeId index for scope queries
            notes: 'id, worldId, folderId, title, entityKind, isEntity, isPinned, favorite, updatedAt, narrativeId',

            // Folders: added narrativeId, isNarrativeRoot indexes
            folders: 'id, worldId, parentId, entityKind, isTypedRoot, isSubtypeRoot, narrativeId, isNarrativeRoot',

            // Tags
            tags: 'id, worldId, name',

            // Note-Tag junction
            noteTags: '[noteId+tagId], noteId, tagId',

            // Entities: added narrativeId for scope
            entities: 'id, kind, label, createdAt, narrativeId',

            // Mentions
            mentions: 'id, noteId, entityId',

            // Edges
            edges: 'id, sourceId, targetId, relType',

            // Decorations
            decorationMeta: 'noteId',
            decorationSpans: 'noteId',

            // Cache
            scannerCache: 'id',
            modelCache: 'modelId',

            // Fact sheets
            entityMetadata: '[entityId+key], entityId',
            entityCards: '[entityId+cardId], entityId, displayOrder',

            // Folder schemas (NEW)
            folderSchemas: 'id, entityKind, isSystem',

            // Network schemas (NEW)
            networkSchemas: 'id, kind, isSystem',

            // Network instances (NEW)
            networkInstances: 'id, schemaId, rootFolderId, narrativeId',

            // Network relationships (NEW)
            networkRelationships: 'id, networkId, sourceEntityId, targetEntityId, relationshipCode'
        });
    }
}

export const db = new CrepeDatabase();

