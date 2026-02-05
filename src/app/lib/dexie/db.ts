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
    // Ordering
    order: number;                // Float-based order within folder (1000, 2000, etc.)
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
    // Generic attributes for World Building, etc.
    attributes?: Record<string, any>;
    // Ordering
    order: number;                // Float-based order within parent (1000, 2000, etc.)
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
    contextId?: string; // Scope ID (e.g. "global", "chapter-id")
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

// Custom slider definitions for fact sheets (e.g., Health, Mana, Sanity)
export interface CustomSliderDef {
    id: string;              // UUID
    entityKind: string;      // CHARACTER, NPC, etc.
    name: string;            // Internal name: "health", "sanity"
    label: string;           // Display: "Health", "Sanity"
    // Color gradient: from low value to high value
    colorLow: string;        // e.g., "#ef4444" (red) - critical state
    colorMid?: string;       // e.g., "#f59e0b" (amber) - warning
    colorHigh: string;       // e.g., "#22c55e" (green) - healthy
    // Umbra preset name (optional, for quick styling)
    umbraPreset?: string;    // "vitals", "magic", "corruption", "neutral"
    min: number;             // Default 0
    max: number;             // Default 100
    icon?: string;           // Lucide icon name
    isSystem: boolean;       // System sliders can't be deleted
    displayOrder: number;
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
    customSliderDefs!: Table<CustomSliderDef>;

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
        super('CrepeNotesDB');

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

        // Version 7: Drag-and-Drop Reordering
        // Added order field to notes and folders for manual reordering
        this.version(7).stores({
            // Notes: added order index for manual sorting
            notes: 'id, worldId, folderId, title, entityKind, isEntity, isPinned, favorite, updatedAt, narrativeId, order, [folderId+order]',

            // Folders: added order index for manual sorting
            folders: 'id, worldId, parentId, entityKind, isTypedRoot, isSubtypeRoot, narrativeId, isNarrativeRoot, order, [parentId+order]'
        }).upgrade(async (tx) => {
            // Migration: Populate order field for existing items
            // Use createdAt as initial ordering to preserve insertion order

            // Migrate folders
            const folders = await tx.table('folders').toArray();
            const foldersByParent = new Map<string, typeof folders>();
            for (const folder of folders) {
                const parentId = folder.parentId || '';
                if (!foldersByParent.has(parentId)) {
                    foldersByParent.set(parentId, []);
                }
                foldersByParent.get(parentId)!.push(folder);
            }

            for (const [parentId, siblings] of foldersByParent) {
                // Sort by createdAt to preserve insertion order
                siblings.sort((a, b) => a.createdAt - b.createdAt);
                for (let i = 0; i < siblings.length; i++) {
                    await tx.table('folders').update(siblings[i].id, { order: (i + 1) * 1000 });
                }
            }

            // Migrate notes
            const notes = await tx.table('notes').toArray();
            const notesByFolder = new Map<string, typeof notes>();
            for (const note of notes) {
                const folderId = note.folderId || '';
                if (!notesByFolder.has(folderId)) {
                    notesByFolder.set(folderId, []);
                }
                notesByFolder.get(folderId)!.push(note);
            }

            for (const [folderId, siblings] of notesByFolder) {
                // Sort by createdAt to preserve insertion order
                siblings.sort((a, b) => a.createdAt - b.createdAt);
                for (let i = 0; i < siblings.length; i++) {
                    await tx.table('notes').update(siblings[i].id, { order: (i + 1) * 1000 });
                }
            }

            console.log('[Dexie] Migration to v7 complete: order fields populated');
        });

        // Version 8: Chapter-Scoped Entity State
        // Added contextId to EntityMetadata for historical tracking
        this.version(8).stores({
            // key is now composite with contextId
            entityMetadata: '[entityId+key+contextId], entityId, [entityId+contextId]'
        }).upgrade(async (tx) => {
            // Migration: Set default contextId to 'global' for existing records
            await tx.table('entityMetadata').toCollection().modify((item: EntityMetadata) => {
                if (!item.contextId) {
                    item.contextId = 'global';
                }
            });
            console.log('[Dexie] Migration to v8 complete: entityMetadata contextId populated');
        });

        // Version 9: Index Folder Name
        // Added 'name' to folders index to support efficient lookups (e.g. finding "Chapters" folder)
        this.version(9).stores({
            folders: 'id, worldId, parentId, name, entityKind, isTypedRoot, isSubtypeRoot, narrativeId, isNarrativeRoot, order, [parentId+order]'
        });

        // Version 10: Switch Chapters to Notes
        // Updating ACT schema to allow CHAPTER as a note type
        this.version(10).upgrade(async (tx) => {
            // We need to import the new schema here or redefine it slightly to avoid circular dependencies if importing from default-schemas
            // For safety, we'll manually specify the update
            const ACT_SCHEMA_ID = 'ACT';

            const actSchema = await tx.table('folderSchemas').get(ACT_SCHEMA_ID);
            if (actSchema) {
                // Remove CHAPTER from subfolders
                actSchema.allowedSubfolders = actSchema.allowedSubfolders.filter((s: any) => s.entityKind !== 'CHAPTER');

                // Add CHAPTER to note types if not present
                if (!actSchema.allowedNoteTypes.find((n: any) => n.entityKind === 'CHAPTER')) {
                    actSchema.allowedNoteTypes.push({ entityKind: 'CHAPTER', label: 'Chapter', icon: 'book' });
                }

                await tx.table('folderSchemas').put(actSchema);
                console.log('[Dexie] Upgrade to v10: Updated ACT schema to support Chapter Notes');
            }
        });

        // Version 11: Move Story Arcs to Act Notes
        // Updating NARRATIVE schema to remove ARC subfolder
        // Updating ACT schema to add ARC note type
        this.version(11).upgrade(async (tx) => {
            const NARRATIVE_SCHEMA_ID = 'NARRATIVE';
            const ACT_SCHEMA_ID = 'ACT';

            // 1. Update NARRATIVE: Remove ARC from subfolders
            const narrativeSchema = await tx.table('folderSchemas').get(NARRATIVE_SCHEMA_ID);
            if (narrativeSchema) {
                narrativeSchema.allowedSubfolders = narrativeSchema.allowedSubfolders.filter((s: any) => s.entityKind !== 'ARC');
                await tx.table('folderSchemas').put(narrativeSchema);
                console.log('[Dexie] Upgrade to v11: Removed ARC from Narrative subfolders');
            }

            // 2. Update ACT: Add ARC to note types
            const actSchema = await tx.table('folderSchemas').get(ACT_SCHEMA_ID);
            if (actSchema) {
                if (!actSchema.allowedNoteTypes.find((n: any) => n.entityKind === 'ARC')) {
                    actSchema.allowedNoteTypes.push({ entityKind: 'ARC', label: 'Story Arc', icon: 'git-branch' });
                }
                await tx.table('folderSchemas').put(actSchema);
                console.log('[Dexie] Upgrade to v11: Added ARC to Act note types');
            }
        });

        // Version 12: Convert Story Arc to Folder
        // 1. ARC schema: Remove ACT subfolder, add CHAPTER note type
        // 2. ACT schema: Add ARC subfolder, remove ARC note type
        this.version(12).upgrade(async (tx) => {
            const ACT_SCHEMA_ID = 'ACT';
            const ARC_SCHEMA_ID = 'ARC';

            // Update ARC Schema
            const arcSchema = await tx.table('folderSchemas').get(ARC_SCHEMA_ID);
            if (arcSchema) {
                // Clear subfolders (remove ACT/CHAPTER folders)
                arcSchema.allowedSubfolders = [];

                // Add CHAPTER note type
                if (!arcSchema.allowedNoteTypes.find((n: any) => n.entityKind === 'CHAPTER')) {
                    arcSchema.allowedNoteTypes.push({ entityKind: 'CHAPTER', label: 'Chapter', icon: 'book' });
                }
                await tx.table('folderSchemas').put(arcSchema);
            }

            // Update ACT Schema
            const actSchema = await tx.table('folderSchemas').get(ACT_SCHEMA_ID);
            if (actSchema) {
                // Remove ARC from notes
                actSchema.allowedNoteTypes = actSchema.allowedNoteTypes.filter((n: any) => n.entityKind !== 'ARC');

                // Add ARC to subfolders
                if (!actSchema.allowedSubfolders.find((s: any) => s.entityKind === 'ARC')) {
                    actSchema.allowedSubfolders.unshift({ entityKind: 'ARC', label: 'Story Arc', icon: 'git-branch' });
                }
                await tx.table('folderSchemas').put(actSchema);
                console.log('[Dexie] Upgrade to v12: Converted Story Arc to Folder structure');
            }
        });

        // Version 13: Restrict Narrative Subfolders
        // Only Act, Scene, and Concept (World Building) allowed
        this.version(13).upgrade(async (tx) => {
            const NARRATIVE_SCHEMA_ID = 'NARRATIVE';
            const schema = await tx.table('folderSchemas').get(NARRATIVE_SCHEMA_ID);

            if (schema) {
                const allowedKinds = ['ACT', 'SCENE', 'CONCEPT'];
                schema.allowedSubfolders = schema.allowedSubfolders.filter((s: any) =>
                    allowedKinds.includes(s.entityKind)
                );
                await tx.table('folderSchemas').put(schema);
                console.log('[Dexie] Upgrade to v13: Restricted Narrative subfolders');
            }
        });

        // Version 14: Custom Slider Definitions
        // Dynamic user-defined sliders for fact sheets (Health, Mana, Sanity, etc.)
        this.version(14).stores({
            customSliderDefs: 'id, entityKind, displayOrder, isSystem'
        }).upgrade(async (tx) => {
            // Seed default sliders for CHARACTER entity kind
            const now = Date.now();
            const defaultSliders = [
                { id: 'sys-xp', entityKind: 'CHARACTER', name: 'xp', label: 'XP', colorLow: '#6366f1', colorMid: '#8b5cf6', colorHigh: '#a855f7', umbraPreset: 'magic', min: 0, max: 100, icon: 'Sparkles', isSystem: true, displayOrder: 0, createdAt: now, updatedAt: now },
                { id: 'sys-health', entityKind: 'CHARACTER', name: 'health', label: 'Health', colorLow: '#ef4444', colorMid: '#f59e0b', colorHigh: '#22c55e', umbraPreset: 'vitals', min: 0, max: 100, icon: 'Heart', isSystem: true, displayOrder: 1, createdAt: now, updatedAt: now },
                { id: 'sys-mana', entityKind: 'CHARACTER', name: 'mana', label: 'Mana', colorLow: '#0ea5e9', colorMid: '#3b82f6', colorHigh: '#6366f1', umbraPreset: 'magic', min: 0, max: 100, icon: 'Droplet', isSystem: true, displayOrder: 2, createdAt: now, updatedAt: now },
                { id: 'sys-stamina', entityKind: 'CHARACTER', name: 'stamina', label: 'Stamina', colorLow: '#f97316', colorMid: '#eab308', colorHigh: '#84cc16', umbraPreset: 'vitals', min: 0, max: 100, icon: 'Zap', isSystem: true, displayOrder: 3, createdAt: now, updatedAt: now },
            ];
            for (const slider of defaultSliders) {
                await tx.table('customSliderDefs').put(slider);
            }
            console.log('[Dexie] Upgrade to v14: Seeded default custom sliders');
        });
    }

}


export const db = new CrepeDatabase();
