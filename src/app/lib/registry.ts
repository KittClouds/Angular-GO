// src/lib/registry.ts
// Entity Registry - Write-through Cache over Dexie (IndexedDB)
// Synchronous reads from memory, async writes to Dexie for persistence.
// Hydrates from BootCache (pre-loaded in main.ts) or falls back to Dexie.

import type { EntityKind } from './Scanner/types';
import { db, Entity, Edge as DexieEdge } from './dexie';
import { getBootCache, waitForBootCache } from './core/boot-cache';

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
    // For GoKitt compatibility
    noteId?: string;
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
// CentralRegistry - Write-Through Cache over Dexie
// =============================================================================

export class CentralRegistry {
    private initialized = false;
    private entityCache = new Map<string, RegisteredEntity>();
    private labelIndex = new Map<string, string>(); // normalized label -> entity ID
    private edgeCache = new Map<string, Edge>();

    // Reactivity
    private listeners = new Set<() => void>();
    private snapshot: RegisteredEntity[] = []; // Stable reference for signals/hooks
    private suppressEvents = false;

    // =========================================================================
    // Initialization - Hydrate from BootCache (pre-loaded) or Dexie (fallback)
    // =========================================================================

    async init(): Promise<void> {
        if (this.initialized) return;

        const start = performance.now();

        try {
            // Try to use pre-loaded boot cache first
            let bootData = getBootCache();

            if (!bootData) {
                console.log('[CentralRegistry] Boot cache not ready, waiting...');
                bootData = await waitForBootCache();
            }

            // Hydrate entities from boot cache
            for (const e of bootData.entities) {
                const registered = this.dexieToRegisteredEntity(e);
                this.entityCache.set(e.id, registered);
                this.labelIndex.set(e.label.toLowerCase(), e.id);
            }

            // Hydrate edges from boot cache
            for (const edge of bootData.edges) {
                this.edgeCache.set(edge.id, {
                    id: edge.id,
                    sourceId: edge.sourceId,
                    targetId: edge.targetId,
                    type: edge.relType,
                    confidence: edge.confidence,
                });
            }

            this.initialized = true;
            this.snapshot = Array.from(this.entityCache.values());

            const duration = Math.round(performance.now() - start);
            console.log(`[CentralRegistry] ✓ Initialized: ${this.entityCache.size} entities, ${this.edgeCache.size} edges (${duration}ms, from cache)`);

        } catch (err) {
            console.error('[CentralRegistry] Failed to hydrate:', err);
            this.initialized = true; // Still mark as initialized to prevent loops
            this.snapshot = [];
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Convert Dexie Entity to RegisteredEntity (in-memory format)
     */
    private dexieToRegisteredEntity(e: Entity): RegisteredEntity {
        return {
            id: e.id,
            label: e.label,
            kind: e.kind as EntityKind,
            aliases: e.aliases || [],
            subtype: e.subtype,
            firstNote: e.firstNote,
            noteId: e.firstNote, // Alias for GoKitt compatibility
            mentionsByNote: new Map(), // Not stored in Dexie currently
            totalMentions: e.totalMentions || 0,
            lastSeenDate: new Date(e.updatedAt),
            createdAt: new Date(e.createdAt),
            createdBy: e.createdBy || 'user',
            attributes: {},
            registeredAt: e.createdAt,
        };
    }

    /**
     * Convert RegisteredEntity to Dexie Entity format
     */
    private registeredToDexieEntity(e: RegisteredEntity): Entity {
        return {
            id: e.id,
            label: e.label,
            kind: e.kind,
            subtype: e.subtype,
            aliases: e.aliases,
            firstNote: e.firstNote,
            totalMentions: e.totalMentions,
            createdAt: e.createdAt.getTime(),
            updatedAt: e.lastSeenDate.getTime(),
            createdBy: e.createdBy,
        };
    }

    // =========================================================================
    // SYNC GETTERS
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

    /**
     * Get stable snapshot of all entities.
     * Efficient for Angular Signals / React Hooks.
     */
    getAllEntities(): RegisteredEntity[] {
        return this.snapshot;
    }

    /**
     * Alias for getAllEntities() - used by GoKitt
     */
    getAll(): RegisteredEntity[] {
        return this.snapshot;
    }

    getEntitiesByKind(kind: EntityKind): RegisteredEntity[] {
        return this.snapshot.filter(e => e.kind === kind);
    }

    getEdgesForEntity(entityId: string): Edge[] {
        return Array.from(this.edgeCache.values()).filter(e =>
            e.sourceId === entityId || e.targetId === entityId
        );
    }

    // =========================================================================
    // SYNC MUTATIONS
    // =========================================================================

    /**
     * Register an entity synchronously.
     * Returns result immediately. No await needed.
     */
    registerEntity(
        label: string,
        kind: EntityKind,
        noteId: string,
        options?: {
            subtype?: string;
            aliases?: string[];
            attributes?: Record<string, any>;
            source?: 'user' | 'extraction' | 'auto';
        }
    ): EntityRegistrationResult {
        const existing = this.findEntityByLabel(label);
        const isNew = !existing;

        if (!this.suppressEvents) {
            // console.log(`[CentralRegistry] Registering: ${label} (${kind}) from ${options?.source || 'user'}. IsNew? ${isNew}`);
        }

        const id = existing?.id || this.generateEntityId(label, kind);
        const now = Date.now();

        const props = {
            aliases: options?.aliases || existing?.aliases || [],
            subtype: options?.subtype || existing?.subtype,
            firstNote: existing?.firstNote || noteId,
            mentionsByNote: existing ? existing.mentionsByNote : new Map<string, number>([[noteId, 1]]),
            totalMentions: (existing?.totalMentions || 0) + (isNew ? (options?.source === 'auto' ? 0 : 1) : 0), // Don't double count auto-seeds
            lastSeenDate: now,
            createdAt: existing?.createdAt?.getTime() || now,
            createdBy: existing?.createdBy || options?.source || 'user',
            attributes: { ...existing?.attributes, ...options?.attributes },
        };

        const entity: RegisteredEntity = {
            id,
            label,
            kind,
            aliases: props.aliases,
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

        // Write-through to Dexie (fire-and-forget)
        this.persistEntityToDexie(entity);

        this.notify();

        return { entity, isNew, wasMerged: false };
    }

    /**
     * Persist entity to Dexie (fire-and-forget, non-blocking)
     */
    private persistEntityToDexie(entity: RegisteredEntity): void {
        const dexieEntity = this.registeredToDexieEntity(entity);
        db.entities.put(dexieEntity).catch(err => {
            console.warn('[CentralRegistry] Failed to persist entity to Dexie:', entity.id, err);
        });
    }

    registerEntityBatch(
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
    ): EntityRegistrationResult[] {
        const results: EntityRegistrationResult[] = [];
        this.suppressEvents = true; // Suppress intermediate notifies

        try {
            for (const { label, kind, noteId, options } of entities) {
                results.push(this.registerEntity(label, kind, noteId, options));
            }
        } finally {
            this.suppressEvents = false;
        }

        this.notify();
        return results;
    }

    deleteEntity(id: string): boolean {
        const entity = this.entityCache.get(id);
        if (entity) {
            this.labelIndex.delete(entity.label.toLowerCase());
            this.entityCache.delete(id);

            // Write-through to Dexie (fire-and-forget)
            db.entities.delete(id).catch(err => {
                console.warn('[CentralRegistry] Failed to delete entity from Dexie:', id, err);
            });

            this.notify();
            return true;
        }
        return false;
    }

    /**
     * Clear all entities and edges from the registry.
     * Returns the number of entities that were cleared.
     */
    clearAll(): number {
        const count = this.entityCache.size;
        this.entityCache.clear();
        this.labelIndex.clear();
        this.edgeCache.clear();

        // Write-through to Dexie (fire-and-forget)
        Promise.all([
            db.entities.clear(),
            db.edges.clear(),
            db.entityMetadata.clear(),
        ]).catch(err => {
            console.warn('[CentralRegistry] Failed to clear Dexie tables:', err);
        });

        this.notify();
        return count;
    }

    updateEntity(id: string, updates: {
        label?: string;
        kind?: EntityKind;
        aliases?: string[];
        subtype?: string;
        attributes?: Record<string, any>;
    }): RegisteredEntity | null {
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

        // Write-through to Dexie (fire-and-forget)
        this.persistEntityToDexie(updated);

        this.notify();
        return updated;
    }

    // =========================================================================
    // RELATIONSHIPS (Edges)
    // =========================================================================

    createEdge(sourceId: string, targetId: string, type: string, options?: any): Edge {
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

        // Write-through to Dexie (fire-and-forget)
        db.edges.put({
            id,
            sourceId,
            targetId,
            relType: type,
            confidence: 1.0,
            bidirectional: false,
        }).catch(err => {
            console.warn('[CentralRegistry] Failed to persist edge to Dexie:', id, err);
        });

        this.notify(); // Edges change the graph state

        return edge;
    }

    upsertRelationship(rel: any): void {
        const sourceEntity = this.findEntityByLabel(rel.source);
        const targetEntity = this.findEntityByLabel(rel.target);

        if (sourceEntity && targetEntity) {
            this.createEdge(sourceEntity.id, targetEntity.id, rel.type, { sourceNote: rel.sourceNote });
        }
    }

    // =========================================================================
    // REACTIVITY & SUBSCRIPTIONS
    // =========================================================================

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        if (this.suppressEvents) return;

        // Update snapshot
        this.snapshot = Array.from(this.entityCache.values());

        // Notify internal listeners
        this.listeners.forEach(fn => fn());

        // Dispatch DOM event for legacy listeners
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('entities-changed'));
        }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    generateEntityId(label: string, kind: EntityKind): string {
        const normalized = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return `${kind.toLowerCase()}_${normalized}`;
    }
}

// Singleton Export
export const smartGraphRegistry = new CentralRegistry();
