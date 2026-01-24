// src/lib/registry.ts
// Entity Registry - In-Memory / Local Storage Implementation
// Derived from RustSmartGraphRegistry but without WASM dependency

import type { EntityKind } from './Scanner/types';
import { kittCore } from './kittcore';

// =============================================================================
// Types
// =============================================================================

export interface RegisteredEntity {
    id: string;
    label: string;
    aliases: string[];
    kind: EntityKind;
    subtype?: string;
    firstNote: string;
    mentionsByNote: Map<string, number>;
    totalMentions: number;
    lastSeenDate: Date;
    createdAt: Date;
    createdBy: 'user' | 'extraction' | 'auto';
    attributes?: Record<string, any>;
    registeredAt: number;
}

export interface EntityRegistrationResult {
    entity: RegisteredEntity;
    isNew: boolean;
    wasMerged: boolean;
}

export interface Edge {
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    confidence: number;
    sourceNote?: string;
}

// =============================================================================
// CentralRegistry - In-Memory Implementation
// =============================================================================

export class CentralRegistry {
    private initialized = false;
    private entityCache = new Map<string, RegisteredEntity>();
    private labelIndex = new Map<string, string>(); // normalized label -> entity ID
    private suppressEvents = false;

    // =========================================================================
    // Initialization
    // =========================================================================

    async init(): Promise<void> {
        if (this.initialized) return;

        // In a real app, this would load from LocalStorage or IndexedDB
        this.initialized = true;
        console.log(`[CentralRegistry] Initialized. Loaded ${this.entityCache.size} entities.`);
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    async refresh(): Promise<void> {
        // No-op for in-memory
    }

    // =========================================================================
    // ENTITY OPERATIONS
    // =========================================================================

    isRegisteredEntity(label: string): boolean {
        return this.labelIndex.has(label.toLowerCase());
    }

    getEntityById(id: string): RegisteredEntity | null {
        return this.entityCache.get(id) || null;
    }

    findEntityByLabel(label: string): RegisteredEntity | null {
        const id = this.labelIndex.get(label.toLowerCase());
        return id ? this.entityCache.get(id) || null : null;
    }

    getAllEntities(): RegisteredEntity[] {
        return Array.from(this.entityCache.values());
    }

    getEntitiesByKind(kind: EntityKind): RegisteredEntity[] {
        return this.getAllEntities().filter(e => e.kind === kind);
    }

    async registerEntity(
        label: string,
        kind: EntityKind,
        noteId: string,
        options?: {
            subtype?: string;
            aliases?: string[];
            attributes?: Record<string, any>;
            source?: 'user' | 'extraction' | 'auto';
        }
    ): Promise<EntityRegistrationResult> {
        const existing = this.findEntityByLabel(label);
        const isNew = !existing;

        if (this.suppressEvents) {
            // Batch mode log (less verbose)
        } else {
            console.log(`[CentralRegistry] Registering: ${label} (${kind}) from ${options?.source || 'user'}. IsNew? ${isNew}`);
        }

        const id = existing?.id || this.generateEntityId(label, kind);
        const now = Date.now();

        const props = {
            aliases: options?.aliases || existing?.aliases || [],
            subtype: options?.subtype || existing?.subtype,
            firstNote: existing?.firstNote || noteId,
            mentionsByNote: existing ? existing.mentionsByNote : new Map<string, number>([[noteId, 1]]),
            totalMentions: (existing?.totalMentions || 0) + (isNew ? 1 : 0),
            lastSeenDate: now,
            createdAt: existing?.createdAt?.getTime() || now,
            createdBy: existing?.createdBy || options?.source || 'user',
            attributes: { ...existing?.attributes, ...options?.attributes },
        };

        // In-memory update
        const entity: RegisteredEntity = {
            id,
            label,
            aliases: props.aliases,
            kind,
            subtype: props.subtype,
            firstNote: props.firstNote,
            mentionsByNote: props.mentionsByNote,
            totalMentions: props.totalMentions,
            lastSeenDate: new Date(props.lastSeenDate),
            createdAt: new Date(props.createdAt),
            createdBy: props.createdBy as 'user' | 'extraction' | 'auto',
            attributes: props.attributes,
            registeredAt: props.createdAt,
        };

        this.entityCache.set(id, entity);
        this.labelIndex.set(label.toLowerCase(), id);

        // Dispatch event
        if (!this.suppressEvents && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('entities-changed'));
        }

        return { entity, isNew, wasMerged: false };
    }

    async registerEntityBatch(
        entities: Array<{
            label: string;
            kind: EntityKind;
            noteId: string;
            options?: {
                subtype?: string;
                aliases?: string[];
                attributes?: Record<string, any>;
                source?: 'user' | 'extraction' | 'auto';
            };
        }>
    ): Promise<EntityRegistrationResult[]> {
        const results: EntityRegistrationResult[] = [];

        this.suppressEvents = true;
        try {
            for (const { label, kind, noteId, options } of entities) {
                const result = await this.registerEntity(label, kind, noteId, options);
                results.push(result);
            }
        } finally {
            this.suppressEvents = false;
        }

        if (results.length > 0 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('entities-changed'));
        }

        return results;
    }

    async deleteEntity(id: string): Promise<boolean> {
        const entity = this.entityCache.get(id);
        if (entity) {
            this.labelIndex.delete(entity.label.toLowerCase());
            this.entityCache.delete(id);
            return true;
        }
        return false;
    }

    async updateEntity(id: string, updates: {
        label?: string;
        kind?: EntityKind;
        aliases?: string[];
        subtype?: string;
        attributes?: Record<string, any>;
    }): Promise<RegisteredEntity | null> {
        const existing = this.entityCache.get(id);
        if (!existing) return null;

        const newLabel = updates.label ?? existing.label;
        const newKind = updates.kind ?? existing.kind;

        const updated: RegisteredEntity = {
            ...existing,
            label: newLabel,
            kind: newKind,
            aliases: updates.aliases ?? existing.aliases,
            subtype: updates.subtype ?? existing.subtype,
            attributes: { ...existing.attributes, ...updates.attributes },
            lastSeenDate: new Date(),
        };

        if (updates.label && updates.label !== existing.label) {
            this.labelIndex.delete(existing.label.toLowerCase());
            this.labelIndex.set(newLabel.toLowerCase(), id);
        }

        this.entityCache.set(id, updated);
        return updated;
    }

    // =========================================================================
    // EDGE OPERATIONS (Relationships) - Mocked for now
    // =========================================================================

    private edgeCache = new Map<string, Edge>();

    // =========================================================================
    // EDGE OPERATIONS (Relationships)
    // =========================================================================

    async createEdge(sourceId: string, targetId: string, type: string, options?: any): Promise<Edge> {
        const id = `${sourceId}-${type}-${targetId}`;
        const edge: Edge = {
            id,
            sourceId,
            targetId,
            type,
            confidence: 1.0,
            sourceNote: options?.sourceNote
        };

        this.edgeCache.set(id, edge);

        if (!this.suppressEvents && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('entities-changed'));
        }

        return edge;
    }

    async upsertRelationship(rel: any): Promise<void> {
        // Find entity IDs first (assuming labels are passed)
        const sourceEntity = this.findEntityByLabel(rel.source);
        const targetEntity = this.findEntityByLabel(rel.target);

        if (sourceEntity && targetEntity) {
            await this.createEdge(sourceEntity.id, targetEntity.id, rel.type, { sourceNote: rel.sourceNote });
            console.log(`[CentralRegistry] Upserted relation: ${rel.source} -> ${rel.type} -> ${rel.target}`);
        } else {
            console.warn(`[CentralRegistry] Could not upsert relation, missing entities: ${rel.source} -> ${rel.target}`);
        }
    }

    getEdgesForEntity(entityId: string): Edge[] {
        return Array.from(this.edgeCache.values()).filter(e =>
            e.sourceId === entityId || e.targetId === entityId
        );
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private generateEntityId(label: string, kind: EntityKind): string {
        const normalized = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return `${kind.toLowerCase()}_${normalized}`;
    }
}

// Singleton Export
export const smartGraphRegistry = new CentralRegistry();
