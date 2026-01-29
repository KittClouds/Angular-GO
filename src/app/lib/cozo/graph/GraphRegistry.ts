/**
 * CozoGraphRegistry - Single source of truth for entities and relationships
 * 
 * Built directly on CozoDB (WASM/In-Memory) with GraphHotCache integration.
 * 
 * NOTE: Most methods are SYNCHRONOUS because CozoDB WASM is synchronous.
 * Async is only needed for initialization or heavy I/O.
 * 
 * REFACTORED: Renamed from GraphRegistry, integrated GraphHotCache for O(1) lookups.
 */

import { cozoDb } from '../db';
import type { EntityKind } from '../utils';
import { FOLDER_HIERARCHY_SCHEMA } from '../schema/layer2-folder-hierarchy';
import { NETWORK_INSTANCE_SCHEMA } from '../schema/layer2-network-instance';
import { NETWORK_MEMBERSHIP_SCHEMA } from '../schema/layer2-network-membership';
import { NETWORK_RELATIONSHIP_SCHEMA } from '../schema/layer2-network-relationship';
import { GraphHotCache } from './GraphHotCache';

// ==================== TYPES ====================

export interface CozoEntity {
    id: string;
    label: string;
    normalized: string;
    kind: EntityKind;
    subtype?: string;
    firstNote: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: 'user' | 'extraction' | 'auto';

    // Computed fields
    aliases?: string[];
    mentionsByNote?: Map<string, number>;
    totalMentions?: number;
    lastSeenDate?: Date;
    metadata?: Record<string, any>;
    attributes?: Record<string, any>;
    narrativeId?: string;
}

export interface CozoRelationship {
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    inverseType?: string;
    bidirectional: boolean;
    confidence: number;
    namespace?: string;
    createdAt: Date;
    updatedAt: Date;

    // Computed fields
    provenance?: RelationshipProvenance[];
    attributes?: Record<string, any>;
    narrativeId?: string;
}

export interface RelationshipProvenance {
    source: string;
    originId: string;
    confidence: number;
    timestamp: Date;
    context?: string;
}

export interface EntityStats {
    totalMentions: number;
    noteCount: number;
    relationshipCount: number;
    aliases: string[];
}

export interface GlobalStats {
    totalEntities: number;
    totalRelationships: number;
    totalProvenance: number;
    entitiesByKind: Record<string, number>;
    relationshipsByType: Record<string, number>;
}

// ==================== GRAPH REGISTRY ====================

export class CozoGraphRegistry {
    private initialized = false;

    // Hot cache for O(1) entity/relationship lookups
    private hotCache = new GraphHotCache({
        maxEntities: 1000,
        maxRelationships: 2000,
        bootCacheEnabled: true
    });

    private onEntityDeleteCallback?: (entityId: string) => void;
    private onEntityMergeCallback?: (oldId: string, newId: string) => void;

    async init(): Promise<void> {
        if (this.initialized) return;

        console.log('[CozoGraphRegistry] Initializing...');

        // Try warming from boot cache first for instant UI
        const bootCacheCount = this.hotCache.warmFromBootCache();
        if (bootCacheCount > 0) {
            console.log(`[CozoGraphRegistry] Boot cache pre-warmed with ${bootCacheCount} entities`);
        }

        await cozoDb.init();

        // Schemas are now created during db.init() BEFORE persistence restore
        // So entities relation already exists and is populated from snapshot

        // Full hydration from DB if boot cache was empty or stale
        if (!this.hotCache.isWarmed || bootCacheCount === 0) {
            const entities = this.loadAllEntitiesFromDB();
            this.hotCache.warmWithEntities(entities);
        }

        this.initialized = true;
        console.log(`[CozoGraphRegistry] ✅ Initialized (${this.hotCache.size} entities cached)`);
    }

    /**
     * Load all entities from DB (used for cache warming)
     */
    private loadAllEntitiesFromDB(): CozoEntity[] {
        const query = `?[id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] := *entities{id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id}`;
        try {
            const result = cozoDb.runQuery(query);
            return (result.rows || []).map((row: any) => this.hydrateEntity(row));
        } catch (e) {
            // Fallback for missing columns
            const legacyQuery = `?[id, label, normalized, kind, subtype, first_note, created_at, created_by] := *entities{id, label, normalized, kind, subtype, first_note, created_at, created_by}`;
            const result = cozoDb.runQuery(legacyQuery);
            return (result.rows || []).map((row: any) => this.hydrateEntityLegacy(row)); // Need a legacy hydrate or handle logic in hydrate
        }
    }

    /**
     * Get the hot cache for direct access (e.g., for scanner hydration)
     */
    getHotCache(): GraphHotCache {
        return this.hotCache;
    }

    // ==================== ENTITY OPERATIONS ====================

    registerEntity(
        label: string,
        kind: EntityKind,
        noteId: string,
        options?: {
            subtype?: string;
            aliases?: string[];
            metadata?: Record<string, any>;
            attributes?: Record<string, any>;
            narrativeId?: string;
        }
    ): CozoEntity {
        const normalized = this.normalize(label);
        const existing = this.findEntityByLabel(label);

        if (existing) {
            this.incrementMention(existing.id, noteId);
            if (options?.metadata) {
                for (const [key, value] of Object.entries(options.metadata)) {
                    this.setEntityMetadata(existing.id, key, value);
                }
            }
            if (options?.aliases) {
                for (const alias of options.aliases) {
                    this.addAlias(existing.id, alias);
                }
            }
            const updated = this.getEntityById(existing.id)!;
            this.hotCache.setEntity(updated);
            return updated;
        }

        const id = this.generateId();
        const now = Date.now();

        const insertQuery = `
      ?[id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] <- [[
        $id, $label, $normalized, $kind, $subtype, $first_note, $created_at, $updated_at, $created_by, $narrative_id
      ]]
      :put entities {id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id}
    `;

        const params = {
            id,
            label,
            normalized,
            kind,
            subtype: options?.subtype ?? null,
            first_note: noteId,
            created_at: now,
            updated_at: now,
            created_by: 'user',
            narrative_id: options?.narrativeId ?? null
        };

        try {
            const result = cozoDb.runQuery(insertQuery, params);
            if (result.ok === false) {
                console.error('[GraphRegistry] Insert failed:', result);
                throw new Error(`Insert failed: ${JSON.stringify(result)}`);
            }
        } catch (err) {
            console.error('[GraphRegistry] registerEntity insert error:', err);
            throw err;
        }

        if (options?.aliases) {
            for (const alias of options.aliases) this.addAlias(id, alias);
        }
        if (options?.metadata) {
            for (const [key, value] of Object.entries(options.metadata)) {
                this.setEntityMetadata(id, key, value);
            }
        }
        this.incrementMention(id, noteId);

        const insertedEntity = this.getEntityById(id);
        if (!insertedEntity) {
            console.error('[CozoGraphRegistry] Entity not found after insert, id:', id);
            throw new Error(`Entity insert succeeded but retrieval failed for id: ${id}`);
        }
        this.hotCache.setEntity(insertedEntity);
        return insertedEntity;
    }

    getEntityById(id: string): CozoEntity | null {
        // Check hot cache first (O(1))
        const cached = this.hotCache.getEntity(id);
        if (cached) return cached;

        // Fall back to DB
        const query = `?[id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] := *entities{id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id}, id == $id`;
        const result = cozoDb.runQuery(query, { id });

        if (!result.rows || result.rows.length === 0) return null;

        const entity = this.hydrateEntity(result.rows[0]);
        this.hotCache.setEntity(entity);
        return entity;
    }

    // Alias for legacy compatibility (adapters expectation)
    getEntityByIdSync(id: string): CozoEntity | null {
        return this.getEntityById(id);
    }

    findEntityByLabel(label: string): CozoEntity | null {
        // Check hot cache first (O(1) with alias index)
        const cached = this.hotCache.findEntityByLabel(label);
        if (cached) return cached;

        // Fall back to DB
        const normalized = this.normalize(label);

        let result = cozoDb.runQuery(
            `?[id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] := *entities{id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id}, normalized == $normalized`,
            { normalized }
        );
        if (result.rows?.length > 0) {
            const entity = this.hydrateEntity(result.rows[0]);
            this.hotCache.setEntity(entity);
            return entity;
        }

        result = cozoDb.runQuery(
            `?[id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] := *entity_aliases{entity_id, normalized: alias_norm}, alias_norm == $normalized, *entities{id: entity_id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id}`,
            { normalized }
        );
        if (result.rows?.length > 0) {
            const entity = this.hydrateEntity(result.rows[0]);
            this.hotCache.setEntity(entity);
            return entity;
        }

        return null;
    }

    // Alias for legacy compatibility
    findEntityByLabelSync(label: string): CozoEntity | null {
        return this.findEntityByLabel(label);
    }

    isRegisteredEntity(label: string): boolean {
        // Check hot cache first (O(1))
        if (this.hotCache.hasEntity(label)) return true;

        // Fall back to DB for cache misses
        const normalized = this.normalize(label);
        try {
            const query = `?[exists] := *entities{normalized}, normalized == $normalized, exists = true ?[exists] := *entity_aliases{normalized}, normalized == $normalized, exists = true`;
            const result = cozoDb.runQuery(query, { normalized });
            return result.rows?.length > 0;
        } catch { return false; }
    }

    getAllEntities(filters?: { kind?: EntityKind; subtype?: string; minMentions?: number; narrativeId?: string }): CozoEntity[] {
        const whereClauses: string[] = [];
        const params: Record<string, any> = {};

        if (filters?.kind) {
            whereClauses.push(`kind == $filter_kind`);
            params['filter_kind'] = filters.kind;
        }
        if (filters?.subtype) {
            whereClauses.push(`subtype == $filter_subtype`);
            params['filter_subtype'] = filters.subtype;
        }
        if (filters?.narrativeId) {
            whereClauses.push(`narrative_id == $narrative_id`);
            params['narrative_id'] = filters.narrativeId;
        }

        const whereClause = whereClauses.length > 0 ? `,\n        ${whereClauses.join(',\n        ')}` : '';
        const query = `?[id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] := *entities{id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id}${whereClause}`;

        const result = cozoDb.runQuery(query, params);
        const entities = (result.rows || []).map((row: any) => this.hydrateEntity(row));

        if (filters?.minMentions !== undefined) return entities.filter((e: CozoEntity) => (e.totalMentions || 0) >= (filters.minMentions ?? 0));
        return entities;
    }

    // Alias for legacy compatibility
    getAllEntitiesSync(filters?: { kind?: EntityKind; subtype?: string; minMentions?: number }): CozoEntity[] {
        return this.getAllEntities(filters);
    }

    getEntitiesByKind(kind: EntityKind): CozoEntity[] { return this.getAllEntities({ kind }); }
    getEntitiesBySubtype(kind: EntityKind, subtype: string): CozoEntity[] { return this.getAllEntities({ kind, subtype }); }

    searchEntities(query: string): CozoEntity[] {
        const normalized = this.normalize(query);
        const all = this.getAllEntities();
        return all.filter(entity => {
            if (entity.normalized === normalized) return true;
            if (entity.normalized.includes(normalized)) return true;
            if (entity.aliases?.some(a => this.normalize(a).includes(normalized))) return true;
            return false;
        });
    }

    updateEntity(id: string, updates: { label?: string; kind?: EntityKind; subtype?: string; aliases?: string[]; metadata?: Record<string, any>; attributes?: Record<string, any>; narrativeId?: string }): CozoEntity | null {
        const entity = this.getEntityById(id);
        if (!entity) return null;

        if (updates.label || updates.kind || updates.subtype !== undefined || updates.narrativeId !== undefined) {
            const newLabel = updates.label || entity.label;
            const newNorm = this.normalize(newLabel);
            const newKind = updates.kind || entity.kind;
            const newSubtype = updates.subtype !== undefined ? updates.subtype : entity.subtype;
            const newNarrativeId = updates.narrativeId !== undefined ? updates.narrativeId : entity.narrativeId;


            const updateQuery = `?[id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id] <- [[$id, $label, $normalized, $kind, $subtype, $first_note, $created_at, $updated_at, $created_by, $narrative_id]] :put entities {id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id}`;

            try {
                cozoDb.runQuery(updateQuery, {
                    id,
                    label: newLabel,
                    normalized: newNorm,
                    kind: newKind,
                    subtype: newSubtype ?? null,
                    first_note: entity.firstNote,
                    created_at: entity.createdAt.getTime(),
                    updated_at: Date.now(),
                    created_by: entity.createdBy,
                    narrative_id: newNarrativeId ?? null
                });
            } catch (err) { console.error('[CozoGraphRegistry] Update failed:', err); return null; }
        }

        if (updates.metadata) {
            for (const [key, value] of Object.entries(updates.metadata)) this.setEntityMetadata(id, key, value);
        }

        // Handle aliases update - clear and re-add
        if (updates.aliases !== undefined) {
            // Remove existing aliases
            const existingAliases = this.getAliases(id);
            for (const alias of existingAliases) {
                this.removeAlias(id, alias);
            }
            // Add new aliases
            for (const alias of updates.aliases) {
                this.addAlias(id, alias);
            }
        }

        // Refresh cache with updated entity
        const updated = this.getEntityById(id);
        if (updated) this.hotCache.setEntity(updated);
        return updated;
    }

    deleteEntity(id: string): boolean {
        if (this.onEntityDeleteCallback) this.onEntityDeleteCallback(id);

        const relIds = this.getRelationshipIdsForEntity(id);
        for (const relId of relIds) {
            this.deleteRelationshipProvenance(relId);
            this.deleteRelationshipAttributes(relId);
        }

        cozoDb.runQuery(`?[id] := *entity_edge{id, source_id, target_id}, (source_id == $entity_id || target_id == $entity_id) :rm entity_edge {id}`, { entity_id: id });
        cozoDb.runQuery(`?[entity_id, alias, normalized] := *entity_aliases{entity_id, alias, normalized}, entity_id == $entity_id :rm entity_aliases {entity_id, alias, normalized}`, { entity_id: id });
        cozoDb.runQuery(`?[entity_id, note_id] := *entity_mentions{entity_id, note_id}, entity_id == $entity_id :rm entity_mentions {entity_id, note_id}`, { entity_id: id });
        cozoDb.runQuery(`?[entity_id, key] := *entity_metadata{entity_id, key}, entity_id == $entity_id :rm entity_metadata {entity_id, key}`, { entity_id: id });
        cozoDb.runQuery(`?[id] := *entities{id}, id == $id :rm entities {id}`, { id });

        this.hotCache.removeEntity(id);
        return true;
    }

    mergeEntities(targetId: string, sourceId: string): boolean {
        const target = this.getEntityById(targetId);
        const source = this.getEntityById(sourceId);
        if (!target || !source || targetId === sourceId) return false;

        if (this.onEntityMergeCallback) this.onEntityMergeCallback(sourceId, targetId);

        if (source.aliases) for (const alias of source.aliases) this.addAlias(targetId, alias);
        this.addAlias(targetId, source.label);

        if (source.mentionsByNote) {
            for (const [noteId, count] of source.mentionsByNote.entries()) this.incrementMention(targetId, noteId, count);
        }

        const rels = this.getRelationshipsForEntity(sourceId);
        for (const rel of rels) {
            const newSrc = rel.sourceId === sourceId ? targetId : rel.sourceId;
            const newTgt = rel.targetId === sourceId ? targetId : rel.targetId;
            cozoDb.runQuery(
                `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] <- [[$id, $source_id, $target_id, $edge_type, $confidence, $narrative_id, $created_at]] :put entity_edge {id, source_id, target_id, edge_type, confidence, narrative_id, created_at}`,
                {
                    id: rel.id,
                    source_id: newSrc,
                    target_id: newTgt,
                    edge_type: rel.type,
                    confidence: rel.confidence,
                    narrative_id: rel.narrativeId ?? null,
                    created_at: rel.createdAt.getTime(),
                }
            );
        }

        if (source.metadata) {
            for (const [key, value] of Object.entries(source.metadata)) this.setEntityMetadata(targetId, key, value);
        }

        this.deleteEntity(sourceId);
        return true;
    }

    onNoteDeleted(noteId: string): void {
        console.log(`[GraphRegistry] Cleaning up note ${noteId}`);
        cozoDb.runQuery(`?[entity_id, note_id] := *entity_mentions{entity_id, note_id}, note_id == $note_id :rm entity_mentions {entity_id, note_id}`, { note_id: noteId });
        cozoDb.runQuery(`?[relationship_id, source, origin_id] := *relationship_provenance{relationship_id, source, origin_id}, origin_id == $origin_id :rm relationship_provenance {relationship_id, source, origin_id}`, { origin_id: noteId });
    }

    // ==================== ALIAS MANAGEMENT ====================

    addAlias(entityId: string, alias: string): boolean {
        const normalized = this.normalize(alias);
        const existing = cozoDb.runQuery(
            `?[entity_id] := *entity_aliases{entity_id, normalized}, normalized == $normalized`,
            { normalized }
        );

        if (existing.rows?.length > 0) {
            if (existing.rows[0][0] !== entityId) {
                console.warn(`[GraphRegistry] Alias "${alias}" already belongs to ${existing.rows[0][0]}`);
                return false;
            }
            return true;
        }

        cozoDb.runQuery(
            `?[entity_id, alias, normalized] <- [[$entity_id, $alias, $normalized]] :put entity_aliases {entity_id, alias, normalized}`,
            { entity_id: entityId, alias, normalized }
        );
        // Refresh cache with updated aliases
        const updated = this.getEntityById(entityId);
        if (updated) this.hotCache.setEntity(updated);
        return true;
    }

    removeAlias(entityId: string, alias: string): boolean {
        const normalized = this.normalize(alias);
        cozoDb.runQuery(
            `?[entity_id, alias, normalized] := *entity_aliases{entity_id, alias, normalized}, entity_id == $entity_id, normalized == $normalized :rm entity_aliases {entity_id, alias, normalized}`,
            { entity_id: entityId, normalized }
        );
        // Refresh cache with updated aliases
        const updated = this.getEntityById(entityId);
        if (updated) this.hotCache.setEntity(updated);
        return true;
    }

    getAliases(entityId: string): string[] {
        const result = cozoDb.runQuery(
            `?[alias] := *entity_aliases{entity_id, alias}, entity_id == $entity_id`,
            { entity_id: entityId }
        );
        return (result.rows || []).map((row: any) => row[0]);
    }

    // ==================== MENTION STATISTICS ====================

    private incrementMention(entityId: string, noteId: string, delta: number = 1): void {
        const now = Date.now();
        const result = cozoDb.runQuery(
            `?[count] := *entity_mentions{entity_id, note_id, mention_count: count}, entity_id == $entity_id, note_id == $note_id`,
            { entity_id: entityId, note_id: noteId }
        );
        const currentCount = result.rows?.length > 0 ? result.rows[0][0] : 0;
        cozoDb.runQuery(
            `?[entity_id, note_id, mention_count, last_seen] <- [[$entity_id, $note_id, $mention_count, $last_seen]] :put entity_mentions {entity_id, note_id, mention_count, last_seen}`,
            { entity_id: entityId, note_id: noteId, mention_count: currentCount + delta, last_seen: now }
        );
    }

    updateNoteMentions(entityId: string, noteId: string, count: number): void {
        if (count <= 0) {
            cozoDb.runQuery(
                `?[entity_id, note_id] := *entity_mentions{entity_id, note_id}, entity_id == $entity_id, note_id == $note_id :rm entity_mentions {entity_id, note_id}`,
                { entity_id: entityId, note_id: noteId }
            );
        } else {
            cozoDb.runQuery(
                `?[entity_id, note_id, mention_count, last_seen] <- [[$entity_id, $note_id, $mention_count, $last_seen]] :put entity_mentions {entity_id, note_id, mention_count, last_seen}`,
                { entity_id: entityId, note_id: noteId, mention_count: count, last_seen: Date.now() }
            );
        }
        // Refresh cache
        const updated = this.getEntityById(entityId);
        if (updated) this.hotCache.setEntity(updated);
    }

    // ==================== METADATA MANAGEMENT ====================

    setEntityMetadata(entityId: string, key: string, value: any): void {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        cozoDb.runQuery(
            `?[entity_id, key, value] <- [[$entity_id, $key, $value]] :put entity_metadata {entity_id, key, value}`,
            { entity_id: entityId, key, value: valueStr }
        );
        // Invalidate cache - metadata changed
        this.hotCache.removeEntity(entityId);
    }

    getEntityMetadata(entityId: string): Record<string, any> {
        const result = cozoDb.runQuery(
            `?[key, value] := *entity_metadata{entity_id, key, value}, entity_id == $entity_id`,
            { entity_id: entityId }
        );
        const metadata: Record<string, any> = {};
        for (const [key, value] of result.rows || []) {
            try { metadata[key] = JSON.parse(value); } catch { metadata[key] = value; }
        }
        return metadata;
    }

    // ==================== RELATIONSHIP OPERATIONS ====================

    addRelationship(
        sourceId: string, targetId: string, type: string, provenance: RelationshipProvenance,
        options?: { inverseType?: string; bidirectional?: boolean; namespace?: string; attributes?: Record<string, any>; narrativeId?: string }
    ): CozoRelationship {
        const existing = this.findRelationship(sourceId, targetId, type, options?.namespace);

        if (existing) {
            this.addProvenance(existing.id, provenance);
            this.recalculateRelationshipConfidence(existing.id);
            this.hotCache.removeRelationship(existing.id);
            return (this.getRelationshipById(existing.id))!;
        }

        const id = this.generateId();
        const now = Date.now();

        cozoDb.runQuery(
            `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] <- [[$id, $source_id, $target_id, $edge_type, $confidence, $narrative_id, $created_at]] :put entity_edge {id, source_id, target_id, edge_type, confidence, narrative_id, created_at}`,
            {
                id,
                source_id: sourceId,
                target_id: targetId,
                edge_type: type,
                confidence: provenance.confidence,
                narrative_id: options?.narrativeId ?? null,
                created_at: now
            }
        );

        this.addProvenance(id, provenance);
        if (options?.inverseType) this.setRelationshipAttribute(id, 'inverseType', options.inverseType);
        if (options?.bidirectional !== undefined) this.setRelationshipAttribute(id, 'bidirectional', options.bidirectional);

        if (options?.attributes) {
            for (const [key, value] of Object.entries(options.attributes)) this.setRelationshipAttribute(id, key, value);
        }

        return (this.getRelationshipById(id))!;
    }

    // Alias for legacy compatibility
    addRelationshipSync(
        sourceId: string, targetId: string, type: string, provenance: RelationshipProvenance,
        options?: { inverseType?: string; bidirectional?: boolean; namespace?: string; attributes?: Record<string, any> }
    ): CozoRelationship {
        return this.addRelationship(sourceId, targetId, type, provenance, options);
    }

    getRelationshipById(id: string): CozoRelationship | null {
        // Check hot cache first
        const cached = this.hotCache.getRelationship(id);
        if (cached) return cached;

        const result = cozoDb.runQuery(
            `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] := *entity_edge{id, source_id, target_id, edge_type, confidence, narrative_id, created_at}, id == $id`,
            { id }
        );
        if (!result.rows?.length) return null;

        const relationship = this.hydrateRelationship(result.rows[0]);
        // Hydrate associations
        relationship.provenance = this.getRelationshipProvenance(id);
        relationship.attributes = this.getRelationshipAttributes(id);

        if (relationship.attributes?.['inverseType']) relationship.inverseType = relationship.attributes['inverseType'];
        if (relationship.attributes?.['bidirectional']) relationship.bidirectional = relationship.attributes['bidirectional'];

        this.hotCache.setRelationship(relationship);
        return relationship;
    }

    getRelationshipByIdSync(id: string): CozoRelationship | null {
        return this.getRelationshipById(id);
    }

    findRelationship(sourceId: string, targetId: string, type: string, namespace?: string): CozoRelationship | null {
        // Note: Namespace is less used in new schema, might need adjustment
        const params: Record<string, any> = { source_id: sourceId, target_id: targetId, edge_type: type };
        const result = cozoDb.runQuery(
            `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] := *entity_edge{id, source_id, target_id, edge_type, confidence, narrative_id, created_at}, source_id == $source_id, target_id == $target_id, edge_type == $edge_type`,
            params
        );
        if (!result.rows?.length) return null;

        const relationship = this.hydrateRelationship(result.rows[0]);
        // Hydrate associations
        relationship.provenance = this.getRelationshipProvenance(relationship.id);
        relationship.attributes = this.getRelationshipAttributes(relationship.id);

        if (relationship.attributes?.['inverseType']) relationship.inverseType = relationship.attributes['inverseType'];
        if (relationship.attributes?.['bidirectional']) relationship.bidirectional = relationship.attributes['bidirectional'];

        return relationship;
    }

    findRelationshipSync(sourceId: string, targetId: string, type: string, namespace?: string): CozoRelationship | null {
        return this.findRelationship(sourceId, targetId, type, namespace);
    }

    getRelationshipIdsForEntity(entityId: string): string[] {
        const result = cozoDb.runQuery(
            `?[id] := *entity_edge{id, source_id, target_id}, (source_id == $entity_id || target_id == $entity_id)`,
            { entity_id: entityId }
        );
        return (result.rows || []).map((row: any) => row[0]);
    }

    getRelationshipsForEntity(entityId: string): CozoRelationship[] {
        const result = cozoDb.runQuery(
            `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] := *entity_edge{id, source_id, target_id, edge_type, confidence, narrative_id, created_at}, (source_id == $entity_id || target_id == $entity_id)`,
            { entity_id: entityId }
        );
        return (result.rows || []).map((row: any) => this.hydrateRelationship(row));
    }

    getRelationshipsForEntitySync(entityId: string): CozoRelationship[] {
        return this.getRelationshipsForEntity(entityId);
    }

    getRelationshipsBySource(sourceId: string): CozoRelationship[] {
        const result = cozoDb.runQuery(
            `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] := *entity_edge{id, source_id, target_id, edge_type, confidence, narrative_id, created_at}, source_id == $source_id`,
            { source_id: sourceId }
        );
        return (result.rows || []).map((row: any) => this.hydrateRelationship(row));
    }

    getRelationshipsBySourceSync(sourceId: string): CozoRelationship[] {
        return this.getRelationshipsBySource(sourceId);
    }

    getRelationshipsByTarget(targetId: string): CozoRelationship[] {
        const result = cozoDb.runQuery(
            `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] := *entity_edge{id, source_id, target_id, edge_type, confidence, narrative_id, created_at}, target_id == $target_id`,
            { target_id: targetId }
        );
        return (result.rows || []).map((row: any) => this.hydrateRelationship(row));
    }

    getRelationshipsByTargetSync(targetId: string): CozoRelationship[] {
        return this.getRelationshipsByTarget(targetId);
    }

    getRelationshipsByType(type: string): CozoRelationship[] {
        const result = cozoDb.runQuery(
            `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] := *entity_edge{id, source_id, target_id, edge_type, confidence, narrative_id, created_at}, edge_type == $type`,
            { type }
        );
        return (result.rows || []).map((row: any) => this.hydrateRelationship(row));
    }

    getRelationshipsByTypeSync(type: string): CozoRelationship[] {
        return this.getRelationshipsByType(type);
    }

    getRelationshipsByNamespace(namespace: string): CozoRelationship[] {
        // Namespace not present in entity_edge, return empty or implement new filtering strategy
        return [];
    }

    getRelationshipsByNamespaceSync(namespace: string): CozoRelationship[] {
        return this.getRelationshipsByNamespace(namespace);
    }

    getAllRelationshipsSync(): CozoRelationship[] {
        const result = cozoDb.runQuery(`?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] := *entity_edge{id, source_id, target_id, edge_type, confidence, narrative_id, created_at}`);
        return (result.rows || []).map((row: any) => this.hydrateRelationship(row));
    }

    deleteRelationship(id: string): boolean {
        this.deleteRelationshipProvenance(id);
        this.deleteRelationshipAttributes(id);
        cozoDb.runQuery(`?[id] := *entity_edge{id}, id == $id :rm entity_edge {id}`, { id });
        this.hotCache.removeRelationship(id);
        return true;
    }

    deleteRelationshipSync(id: string): boolean {
        return this.deleteRelationship(id);
    }

    deleteRelationshipsByEntity(entityId: string): number {
        const relationships = this.getRelationshipsForEntity(entityId);
        for (const rel of relationships) this.deleteRelationship(rel.id);
        return relationships.length;
    }

    // ==================== PROVENANCE MANAGEMENT ====================

    addProvenance(relationshipId: string, provenance: RelationshipProvenance): void {
        cozoDb.runQuery(
            `?[relationship_id, source, origin_id, confidence, timestamp, context] <- [[$relationship_id, $source, $origin_id, $confidence, $timestamp, $context]] :put relationship_provenance {relationship_id, source, origin_id, confidence, timestamp, context}`,
            {
                relationship_id: relationshipId,
                source: provenance.source,
                origin_id: provenance.originId,
                confidence: provenance.confidence,
                timestamp: provenance.timestamp.getTime(),
                context: provenance.context ?? null
            }
        );
        this.hotCache.removeRelationship(relationshipId);
    }

    addProvenanceSync(relationshipId: string, provenance: RelationshipProvenance): void {
        this.addProvenance(relationshipId, provenance);
    }

    deleteRelationshipProvenance(relationshipId: string): void {
        cozoDb.runQuery(
            `?[relationship_id] := *relationship_provenance{relationship_id}, relationship_id == $id :rm relationship_provenance {relationship_id}`,
            { id: relationshipId }
        );
    }

    getRelationshipProvenance(relationshipId: string): RelationshipProvenance[] {
        const result = cozoDb.runQuery(
            `?[source, origin_id, confidence, timestamp, context] := *relationship_provenance{relationship_id, source, origin_id, confidence, timestamp, context}, relationship_id == $id`,
            { id: relationshipId }
        );
        return (result.rows || []).map((row: any) => ({
            source: row[0],
            originId: row[1],
            confidence: row[2],
            timestamp: new Date(row[3]),
            context: row[4]
        }));
    }

    getRelationshipProvenanceSync(relationshipId: string): RelationshipProvenance[] {
        return this.getRelationshipProvenance(relationshipId);
    }

    // ==================== ATTRIBUTE MANAGEMENT ====================

    setRelationshipAttribute(relationshipId: string, key: string, value: any): void {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        cozoDb.runQuery(
            `?[relationship_id, key, value] <- [[$relationship_id, $key, $value]] :put relationship_attributes {relationship_id, key, value}`,
            { relationship_id: relationshipId, key, value: valueStr }
        );
        this.hotCache.removeRelationship(relationshipId);
    }

    getRelationshipAttributes(relationshipId: string): Record<string, any> {
        const result = cozoDb.runQuery(
            `?[key, value] := *relationship_attributes{relationship_id, key, value}, relationship_id == $id`,
            { id: relationshipId }
        );
        const attributes: Record<string, any> = {};
        for (const [key, value] of result.rows || []) {
            try { attributes[key] = JSON.parse(value); } catch { attributes[key] = value; }
        }
        return attributes;
    }

    deleteRelationshipAttributes(relationshipId: string): void {
        cozoDb.runQuery(
            `?[relationship_id] := *relationship_attributes{relationship_id}, relationship_id == $id :rm relationship_attributes {relationship_id}`,
            { id: relationshipId }
        );
    }

    setRelationshipAttributeSync(relationshipId: string, key: string, value: any): void {
        this.setRelationshipAttribute(relationshipId, key, value);
    }

    // ==================== STATS ====================

    getGlobalStats(): GlobalStats {
        // Quick estimates
        const entityCount = cozoDb.runQuery(`count[c] := c = count(id), *entities{id} ?[c] := count[c]`);
        const relCount = cozoDb.runQuery(`count[c] := c = count(id), *entity_edge{id} ?[c] := count[c]`);
        const provCount = cozoDb.runQuery(`count[c] := c = count(relationship_id), *relationship_provenance{relationship_id} ?[c] := count[c]`);

        return {
            totalEntities: entityCount.rows?.[0]?.[0] || 0,
            totalRelationships: relCount.rows?.[0]?.[0] || 0,
            totalProvenance: provCount.rows?.[0]?.[0] || 0,
            entitiesByKind: {},
            relationshipsByType: {}
        };
    }

    getDetailedStats(): { total: number; byType: Record<string, number>; bySource: Record<string, number>; averageConfidence: number } {
        const globalCheck = this.getGlobalStats();

        // byType
        const byTypeRes = cozoDb.runQuery(`?[edge_type, count] := *entity_edge{edge_type}, count = count(edge_type)`);
        const byType: Record<string, number> = {};
        for (const row of byTypeRes.rows || []) {
            byType[row[0]] = row[1];
        }

        // bySource
        const bySourceRes = cozoDb.runQuery(`?[source, count] := *relationship_provenance{source}, count = count(source)`);
        const bySource: Record<string, number> = {};
        for (const row of bySourceRes.rows || []) {
            bySource[row[0]] = row[1];
        }

        // Average confidence
        const avgConfRes = cozoDb.runQuery(`?[avg] := *entity_edge{confidence}, avg = mean(confidence)`);
        const avgConf = avgConfRes.rows?.[0]?.[0] || 0;

        return {
            total: globalCheck.totalRelationships,
            byType,
            bySource,
            averageConfidence: avgConf
        };
    }

    // ==================== CONFIDENCE CALCULATION ====================

    /**
     * Re-calculates relationship confidence based on provenance
     * Simple logic: take max confidence of any provenance entry
     */
    recalculateRelationshipConfidence(relationshipId: string): number {
        const result = cozoDb.runQuery(
            `?[confidence] := *relationship_provenance{relationship_id, confidence}, relationship_id == $id`,
            { id: relationshipId }
        );

        if (!result.rows || result.rows.length === 0) return 0;

        let maxConfidence = 0;
        for (const row of result.rows) {
            maxConfidence = Math.max(maxConfidence, row[0]);
        }

        // Update relationship
        // We need existing type to update... fetch it first
        const rel = this.getRelationshipById(relationshipId);
        if (rel) {
            cozoDb.runQuery(
                `?[id, source_id, target_id, edge_type, confidence, narrative_id, created_at] <- [[$id, $source_id, $target_id, $edge_type, $confidence, $narrative_id, $created_at]] :put entity_edge {id, source_id, target_id, edge_type, confidence, narrative_id, created_at}`,
                {
                    id: rel.id,
                    source_id: rel.sourceId,
                    target_id: rel.targetId,
                    edge_type: rel.type,
                    confidence: maxConfidence,
                    narrative_id: rel.narrativeId ?? null,
                    created_at: rel.createdAt.getTime()
                }
            );
        }

        return maxConfidence;
    }

    recalculateRelationshipConfidenceSync(relationshipId: string): number {
        return this.recalculateRelationshipConfidence(relationshipId);
    }

    // ==================== HELPERS ====================

    private hydrateEntity(row: any[]): CozoEntity {
        // Row order: id, label, normalized, kind, subtype, first_note, created_at, updated_at, created_by, narrative_id
        return {
            id: row[0],
            label: row[1],
            normalized: row[2],
            kind: row[3] as EntityKind,
            subtype: row[4],
            firstNote: row[5],
            createdAt: new Date(row[6]),
            updatedAt: new Date(row[7]),
            createdBy: row[8] as any,
            narrativeId: row[9]
        };
    }

    private hydrateEntityLegacy(row: any[]): CozoEntity {
        // Legacy Row order: id, label, normalized, kind, subtype, first_note, created_at, created_by
        const createdAt = new Date(row[6]);
        return {
            id: row[0],
            label: row[1],
            normalized: row[2],
            kind: row[3] as EntityKind,
            subtype: row[4],
            firstNote: row[5],
            createdAt: createdAt,
            updatedAt: createdAt,
            createdBy: row[7] as any,
            narrativeId: undefined
        };
    }

    private hydrateRelationship(row: any[]): CozoRelationship {
        // Row order: id, source_id, target_id, edge_type, confidence, narrative_id, created_at
        return {
            id: row[0],
            sourceId: row[1],
            targetId: row[2],
            type: row[3],
            confidence: row[4],
            narrativeId: row[5],
            createdAt: new Date(row[6]),
            updatedAt: new Date(row[6]), // No updated_at in entity_edge
            bidirectional: false, // Default for entity_edge
            inverseType: undefined,
        };
    }

    private normalize(text: string): string {
        return text.toLowerCase().trim();
    }

    private generateId(): string {
        return crypto.randomUUID();
    }
}

export const graphRegistry = new CozoGraphRegistry();
