/**
 * CozoFieldMapper - Bidirectional field mapping between Dexie and CozoDB schemas
 * 
 * Handles naming differences (e.g., relType ↔ edge_type) and 
 * adds default values for Cozo-enriched fields.
 */

import type { Note, Folder, Entity, Edge, EntityCard, FactSheetCardSchema, FactSheetFieldSchema, FolderSchema, NetworkInstance, NetworkRelationship, NetworkSchema } from '../dexie/db';

// =============================================================================
// TYPES
// =============================================================================

export interface CozoNote {
    id: string;
    world_id: string;
    title: string;
    content: string;
    markdown_content: string;
    folder_id: string;
    entity_kind: string;
    entity_subtype: string;
    is_entity: boolean;
    is_pinned: boolean;
    favorite: boolean;
    owner_id: string;
    created_at: number;
    updated_at: number;
    narrative_id: string;
}

export interface CozoFolder {
    id: string;
    world_id: string;
    name: string;
    parent_id: string;
    entity_kind: string;
    entity_subtype: string;
    entity_label: string;
    color: string;
    is_typed_root: boolean;
    is_subtype_root: boolean;
    collapsed: boolean;
    owner_id: string;
    created_at: number;
    updated_at: number;
    narrative_id: string;
    is_narrative_root: boolean;
    network_id: string;
    metadata: string; // JSON stringified
}

export interface CozoEntity {
    id: string;
    label: string;
    normalized: string;
    kind: string;
    subtype: string;
    first_note: string;
    created_at: number;
    updated_at: number;
    created_by: string;
    narrative_id: string;
}

export interface CozoEdge {
    id: string;
    source_id: string;
    target_id: string;
    edge_type: string;  // ← Cozo uses edge_type, Dexie uses relType
    confidence: number;
    extraction_methods: string[];
    group_id: string;
    scope_type: string;
    created_at: number;
    valid_at: number;
    invalid_at: number | null;
    fact: string | null;
    weight: number;
    narrative_id: string;
}

// =============================================================================
// DEXIE → COZO MAPPERS
// =============================================================================

export const DexieToCozo = {
    note: (n: Note): CozoNote => ({
        id: n.id,
        world_id: n.worldId,
        title: n.title,
        content: n.content,
        markdown_content: n.markdownContent,
        folder_id: n.folderId,
        entity_kind: n.entityKind,
        entity_subtype: n.entitySubtype,
        is_entity: n.isEntity,
        is_pinned: n.isPinned,
        favorite: n.favorite,
        owner_id: n.ownerId,
        created_at: n.createdAt,
        updated_at: n.updatedAt,
        narrative_id: n.narrativeId || '',
    }),

    folder: (f: Folder): CozoFolder => ({
        id: f.id,
        world_id: f.worldId,
        name: f.name,
        parent_id: f.parentId,
        entity_kind: f.entityKind,
        entity_subtype: f.entitySubtype,
        entity_label: f.entityLabel,
        color: f.color,
        is_typed_root: f.isTypedRoot,
        is_subtype_root: f.isSubtypeRoot,
        collapsed: f.collapsed,
        owner_id: f.ownerId,
        created_at: f.createdAt,
        updated_at: f.updatedAt,
        narrative_id: f.narrativeId || '',
        is_narrative_root: f.isNarrativeRoot,
        network_id: f.networkId || '',
        metadata: JSON.stringify(f.metadata || {}),
    }),

    entity: (e: Entity): CozoEntity => ({
        id: e.id,
        label: e.label,
        normalized: e.label.toLowerCase().trim(),
        kind: e.kind,
        subtype: e.subtype || '',
        first_note: e.firstNote,
        created_at: e.createdAt,
        updated_at: e.updatedAt,
        created_by: e.createdBy,
        narrative_id: e.narrativeId || '',
    }),

    edge: (e: Edge): CozoEdge => ({
        id: e.id,
        source_id: e.sourceId,
        target_id: e.targetId,
        edge_type: e.relType,  // ← Key mapping: relType → edge_type
        confidence: e.confidence,
        extraction_methods: [],
        group_id: '',
        scope_type: 'note',
        created_at: Date.now(),
        valid_at: Date.now(),
        invalid_at: null,
        fact: null,
        weight: 1.0,
        narrative_id: '',
    }),
};

// =============================================================================
// COZO → DEXIE MAPPERS (from query result rows)
// =============================================================================

// Note: Cozo returns rows as arrays matching header order
// These mappers assume a specific column order from queries

export const CozoToDexie = {
    /** 
     * Maps Cozo note row to Dexie Note
     * Expected columns: id, world_id, title, content, markdown_content, folder_id, 
     *                   entity_kind, entity_subtype, is_entity, is_pinned, favorite,
     *                   owner_id, created_at, updated_at, narrative_id
     */
    note: (row: unknown[]): Note => ({
        id: row[0] as string,
        worldId: row[1] as string,
        title: row[2] as string,
        content: row[3] as string,
        markdownContent: row[4] as string,
        folderId: row[5] as string,
        entityKind: row[6] as string,
        entitySubtype: row[7] as string,
        isEntity: row[8] as boolean,
        isPinned: row[9] as boolean,
        favorite: row[10] as boolean,
        ownerId: row[11] as string,
        createdAt: row[12] as number,
        updatedAt: row[13] as number,
        narrativeId: row[14] as string,
    }),

    /**
     * Maps Cozo entity row to Dexie Entity
     * Expected columns: id, label, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id
     */
    entity: (row: unknown[]): Entity => ({
        id: row[0] as string,
        label: row[1] as string,
        kind: row[2] as string,
        subtype: (row[3] as string) || undefined,
        aliases: [],  // Must be fetched separately from entity_aliases
        firstNote: row[4] as string,
        totalMentions: 0,  // Must be computed from entity_mentions
        createdAt: row[5] as number,
        updatedAt: row[6] as number,
        createdBy: row[7] as 'user' | 'extraction' | 'auto',
        narrativeId: (row[8] as string) || undefined,
    }),

    /**
     * Maps Cozo edge row to Dexie Edge
     * Expected columns: id, source_id, target_id, edge_type, confidence
     */
    edge: (row: unknown[]): Edge => ({
        id: row[0] as string,
        sourceId: row[1] as string,
        targetId: row[2] as string,
        relType: row[3] as string,  // ← Key mapping: edge_type → relType
        confidence: row[4] as number,
        bidirectional: false,
    }),
};

// =============================================================================
// QUERY BUILDERS
// =============================================================================

export const CozoQueries = {
    /** Upsert a note into Cozo */
    upsertNote: (n: CozoNote): string => `
        ?[id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id, created_at, updated_at, narrative_id] <- [[
            ${JSON.stringify(n.id)},
            ${JSON.stringify(n.world_id)},
            ${JSON.stringify(n.title)},
            ${JSON.stringify(n.content)},
            ${JSON.stringify(n.markdown_content)},
            ${JSON.stringify(n.folder_id)},
            ${JSON.stringify(n.entity_kind)},
            ${JSON.stringify(n.entity_subtype)},
            ${n.is_entity},
            ${n.is_pinned},
            ${n.favorite},
            ${JSON.stringify(n.owner_id)},
            ${n.created_at},
            ${n.updated_at},
            ${JSON.stringify(n.narrative_id)}
        ]]
        :put notes { id => world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id, created_at, updated_at, narrative_id }
    `,

    /** Upsert a folder into Cozo */
    upsertFolder: (f: CozoFolder): string => `
        ?[id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color, is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at, narrative_id, is_narrative_root, network_id, metadata] <- [[
            ${JSON.stringify(f.id)},
            ${JSON.stringify(f.world_id)},
            ${JSON.stringify(f.name)},
            ${JSON.stringify(f.parent_id)},
            ${JSON.stringify(f.entity_kind)},
            ${JSON.stringify(f.entity_subtype)},
            ${JSON.stringify(f.entity_label)},
            ${JSON.stringify(f.color)},
            ${f.is_typed_root},
            ${f.is_subtype_root},
            ${f.collapsed},
            ${JSON.stringify(f.owner_id)},
            ${f.created_at},
            ${f.updated_at},
            ${JSON.stringify(f.narrative_id)},
            ${f.is_narrative_root},
            ${JSON.stringify(f.network_id)},
            ${JSON.stringify(f.metadata)}
        ]]
        :put folders { id => world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color, is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at, narrative_id, is_narrative_root, network_id, metadata }
    `,

    /** Upsert an entity into Cozo */
    upsertEntity: (e: CozoEntity): string => `
        ?[id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] <- [[
            ${JSON.stringify(e.id)},
            ${JSON.stringify(e.label)},
            ${JSON.stringify(e.normalized)},
            ${JSON.stringify(e.kind)},
            ${JSON.stringify(e.subtype)},
            ${JSON.stringify(e.first_note)},
            ${e.created_at},
            ${e.updated_at},
            ${JSON.stringify(e.created_by)},
            ${JSON.stringify(e.narrative_id)}
        ]]
        :put entities { id => label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id }
    `,

    /** Upsert an edge into Cozo */
    upsertEdge: (e: CozoEdge): string => `
        ?[id, source_id, target_id, edge_type, confidence, extraction_methods, group_id, scope_type, created_at, valid_at, invalid_at, fact, weight, narrative_id] <- [[
            ${JSON.stringify(e.id)},
            ${JSON.stringify(e.source_id)},
            ${JSON.stringify(e.target_id)},
            ${JSON.stringify(e.edge_type)},
            ${e.confidence},
            ${JSON.stringify(e.extraction_methods)},
            ${JSON.stringify(e.group_id)},
            ${JSON.stringify(e.scope_type)},
            ${e.created_at},
            ${e.valid_at},
            ${e.invalid_at === null ? 'null' : e.invalid_at},
            ${e.fact === null ? 'null' : JSON.stringify(e.fact)},
            ${e.weight},
            ${JSON.stringify(e.narrative_id)}
        ]]
        :put entity_edge { id => source_id, target_id, edge_type, confidence, extraction_methods, group_id, scope_type, created_at, valid_at, invalid_at, fact, weight, narrative_id }
    `,

    /** Delete a note by ID */
    deleteNote: (id: string): string => `
        ?[id] <- [[${JSON.stringify(id)}]]
        :rm notes { id }
    `,

    /** Delete a folder by ID */
    deleteFolder: (id: string): string => `
        ?[id] <- [[${JSON.stringify(id)}]]
        :rm folders { id }
    `,

    /** Delete an entity by ID */
    deleteEntity: (id: string): string => `
        ?[id] <- [[${JSON.stringify(id)}]]
        :rm entities { id }
    `,

    /** Delete an edge by ID */
    deleteEdge: (id: string): string => `
        ?[id] <- [[${JSON.stringify(id)}]]
        :rm entity_edge { id }
    `,
};
