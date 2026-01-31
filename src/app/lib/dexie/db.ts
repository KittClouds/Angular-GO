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
    // Metadata
    metadata?: {
        date?: { year: number; monthIndex: number; dayIndex: number };
    };
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
// SPAN-FIRST DATA MODEL (Immutable Facts Layer)
// =============================================================================

/**
 * TextQuoteSelector - Web Annotation compatible selector for robust anchoring
 */
export interface TextQuoteSelector {
    /** Exact text content of the span */
    exact: string;
    /** Text immediately before the span (context for disambiguation) */
    prefix: string;
    /** Text immediately after the span (context for disambiguation) */
    suffix: string;
}

/**
 * Span - The atomic immutable fact. All derived data traces back here.
 * Uses Web Annotation's TextPositionSelector + TextQuoteSelector for resilient anchoring.
 */
export interface Span {
    id: string;                        // UUID
    worldId: string;                   // Global world/workspace
    noteId: string;                    // Document containing this span
    narrativeId?: string;              // Vault scope

    // Position selector (fast path)
    start: number;                     // Byte offset in document
    end: number;                       // Byte offset end

    // Quote selector (resilient path)
    selector: TextQuoteSelector;
    contentHash: string;               // Hash of selector for O(1) resolution

    // Provenance
    createdBy: 'user' | 'scanner' | 'import';
    status: 'resolved' | 'detached' | 'stale';  // detached = content changed, stale = needs re-anchor

    createdAt: number;
    updatedAt: number;
}

/**
 * Wormhole - A contract binding two spans together.
 * Spans can be in same or different documents. Wormholes are NOT entity-to-entity.
 */
export interface Wormhole {
    id: string;
    srcSpanId: string;                 // Source span
    dstSpanId: string;                 // Destination span

    mode: 'user' | 'suggested' | 'auto';
    confidence: number;                // 0-1, only meaningful for suggested/auto
    rationale?: string;                // Why this wormhole exists (for suggestions)

    // Metadata
    wormholeType?: string;             // Optional semantic type (ref, alias, elaboration, etc.)
    bidirectional: boolean;

    createdAt: number;
    updatedAt: number;
}

/**
 * SpanMention - Links a Span to a candidate Entity.
 * The span is the ground truth; entity linkage is derived/optional.
 */
export interface SpanMention {
    id: string;
    spanId: string;                    // FK to Span (required)
    candidateEntityId?: string;        // FK to Entity (optional - may be unresolved)

    // Evidence vector for entity resolution
    matchType: 'exact' | 'alias' | 'fuzzy' | 'inferred';
    confidence: number;                // 0-1

    // Harvester/virus evidence (for unsupervised NER)
    evidenceVector?: {
        frequency: number;             // How often this surface form appears
        capitalRatio: number;          // Capitalization signal
        contextScore: number;          // Semantic context fit
        cooccurrence: number;          // Co-occurrence with known entities
    };

    status: 'pending' | 'accepted' | 'rejected';

    createdAt: number;
    updatedAt: number;
}

/**
 * Claim - SVO (Subject-Verb-Object) quad edge.
 * Arguments ALWAYS reference Spans (or through spans, entities).
 * This ensures all semantic claims are traceable to source text.
 */
export interface Claim {
    id: string;
    worldId: string;
    narrativeId?: string;

    // SVO Triple (with optional qualifier for Quad)
    subjectSpanId: string;             // Span where subject appears
    subjectEntityId?: string;          // Resolved entity (optional)

    verb: string;                      // Relation type / predicate
    verbSpanId?: string;               // Span where verb appears (optional)

    objectSpanId: string;              // Span where object appears
    objectEntityId?: string;           // Resolved entity (optional)

    // Qualifier (for quads - "when", "where", "how")
    qualifierKey?: string;
    qualifierValue?: string;
    qualifierSpanId?: string;

    // Provenance
    sourceNoteId: string;              // Document where claim was extracted
    confidence: number;
    extractedBy: 'user' | 'scanner' | 'llm';

    createdAt: number;
    updatedAt: number;
}

/**
 * TimelineEvent - A scene/beat in the narrative timeline.
 * Acts as a scene manager for tracking story progression.
 */
export interface TimelineEvent {
    id: string;
    narrativeId: string;            // Which narrative vault this belongs to

    // Content
    title: string;                  // "The Arrival", "Strider's Corner"
    description: string;            // Scene summary / beat

    // Timeline position
    order: number;                  // Global sort order within narrative
    displayTime?: string;           // Human readable: "14:00", "Dawn", "Third Age 3018"

    // References
    entityIds: string[];            // Characters/locations involved
    linkedNoteId?: string;          // Optional: Jump to this note for details

    // Metadata
    color?: string;                 // Visual accent
    status: 'draft' | 'locked';     // Can lock events to prevent edits

    createdAt: number;
    updatedAt: number;
}

// =============================================================================
// UNIFIED CODEX SYSTEM
// =============================================================================

/**
 * CodexEntry - The atomic unit of the Codex.
 * Unified model for Worldbuilding Facts, Story Beats, and Timeline Events.
 * All entries can link back to source Spans for provenance.
 */
export interface CodexEntry {
    id: string;
    narrativeId: string;              // Scoped to narrative

    // Type discrimination
    entryType: 'fact' | 'beat' | 'event';

    // Common fields
    title: string;
    description: string;
    status: 'draft' | 'planned' | 'complete' | 'locked';

    // Category (for facts/beats)
    category?: string;                // e.g., 'geography', 'magic', 'act1'
    subcategory?: string;             // e.g., 'opening-image', 'theme-stated'

    // Ordering
    order: number;
    parentId?: string;                // Hierarchical (beat inside act, fact inside category)

    // Provenance: Link to source span
    sourceSpanId?: string;            // The span this was extracted from
    sourceNoteId?: string;            // Quick lookup

    // Linked entities
    entityIds: string[];              // Characters, locations involved

    // Timeline-specific
    temporalOrder?: number;           // For timeline sequencing
    date?: { year: number; monthIndex: number; dayIndex: number };
    displayTime?: string;             // Human readable: "14:00", "Dawn"
    linkedNoteId?: string;            // Jump to this note

    // Visual
    color?: string;                   // Accent color

    // Metadata
    createdAt: number;
    updatedAt: number;
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

// Global per-kind card schema (all CHARACTERs share this layout)
export interface FactSheetCardSchema {
    id: string;                      // e.g., "CHARACTER::identity"
    entityKind: string;              // CHARACTER, LOCATION, etc.
    cardId: string;                  // "identity", "progression", etc.
    title: string;
    icon: string;                    // Lucide icon name
    gradient: string;                // Tailwind gradient classes
    displayOrder: number;
    isSystem: boolean;               // System cards can't be deleted
    createdAt: number;
    updatedAt: number;
}

// Global per-kind field schema (fields within cards)
export interface FactSheetFieldSchema {
    id: string;                      // e.g., "CHARACTER::identity::fullName"
    entityKind: string;              // CHARACTER, LOCATION, etc.
    cardId: string;                  // "identity", "progression", etc.
    fieldName: string;               // "fullName", "age", etc.
    fieldType: string;               // "text", "number", "progress", "stat-grid"
    label: string;
    placeholder?: string;
    multiline?: boolean;
    min?: number;
    max?: number;
    step?: number;
    defaultValue?: string;           // JSON-encoded default
    options?: string;                // JSON-encoded for dropdowns
    color?: string;                  // For progress bars
    currentField?: string;           // For progress: linked field name
    maxField?: string;               // For progress: linked field name
    stats?: string;                  // JSON-encoded for stat-grid
    unit?: string;                   // e.g., "lbs"
    displayOrder: number;
    isSystem: boolean;               // System fields can't be deleted
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

    // Fact sheets - per-entity data
    entityMetadata!: Table<EntityMetadata>;
    entityCards!: Table<EntityCard>;

    // Fact sheet schemas - global per-kind definitions
    factSheetCardSchemas!: Table<FactSheetCardSchema>;
    factSheetFieldSchemas!: Table<FactSheetFieldSchema>;

    // Folder schemas
    folderSchemas!: Table<FolderSchema>;

    // Networks
    networkSchemas!: Table<NetworkSchema>;
    networkInstances!: Table<NetworkInstance>;
    networkRelationships!: Table<NetworkRelationship>;

    // Span-first data model (v4)
    spans!: Table<Span>;
    wormholes!: Table<Wormhole>;
    spanMentions!: Table<SpanMention>;
    claims!: Table<Claim>;

    // Timeline Codex (v5)
    timelineEvents!: Table<TimelineEvent>;

    // Unified Codex (v6)
    codexEntries!: Table<CodexEntry>;

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

            // Fact sheets - per-entity data
            entityMetadata: '[entityId+key], entityId',
            entityCards: '[entityId+cardId], entityId, displayOrder',

            // Fact sheet schemas - global per-kind (NEW)
            factSheetCardSchemas: 'id, entityKind, displayOrder, isSystem',
            factSheetFieldSchemas: 'id, entityKind, cardId, displayOrder, isSystem',

            // Folder schemas (NEW)
            folderSchemas: 'id, entityKind, isSystem',

            // Network schemas (NEW)
            networkSchemas: 'id, kind, isSystem',

            // Network instances (NEW)
            networkInstances: 'id, schemaId, rootFolderId, narrativeId',

            // Network relationships (NEW)
            networkRelationships: 'id, networkId, sourceEntityId, targetEntityId, relationshipCode'
        });

        // Version 4: Span-first data model (Immutable Facts Layer)
        // All derived data (entities, claims) traces back to Spans
        // Only need to specify NEW tables - existing ones are inherited
        this.version(4).stores({
            // NEW: Span - immutable fact with Web Annotation selectors
            // Indexed by content hash (O(1)) and position range (O(log n))
            spans: 'id, worldId, noteId, narrativeId, status, createdAt, contentHash, [noteId+status], [worldId+start+end]',

            // NEW: Wormhole - binding contracts between spans
            wormholes: 'id, srcSpanId, dstSpanId, mode, wormholeType, [srcSpanId+dstSpanId]',

            // NEW: SpanMention - span → candidate entity evidence
            spanMentions: 'id, spanId, candidateEntityId, status, [spanId+candidateEntityId]',

            // NEW: Claim - SVO quads referencing spans
            claims: 'id, worldId, narrativeId, subjectSpanId, objectSpanId, verb, sourceNoteId, [subjectEntityId+verb+objectEntityId]'
        });

        // Version 5: Timeline Codex
        this.version(5).stores({
            // NEW: TimelineEvent - scene/beat manager for narrative
            timelineEvents: 'id, narrativeId, order, status, [narrativeId+order]'
        });

        // Version 6: Unified Codex System
        this.version(6).stores({
            // NEW: CodexEntry - unified facts, beats, and events
            codexEntries: 'id, narrativeId, entryType, category, subcategory, parentId, order, status, sourceSpanId, sourceNoteId, createdAt, [narrativeId+entryType], [narrativeId+category], [narrativeId+entryType+category]'
        });
    }
}

export const db = new CrepeDatabase();


