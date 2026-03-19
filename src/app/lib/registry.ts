// src/lib/registry.ts
// Entity Registry - Write-through Cache over Go SQLite (SSoT) + Dexie (ephemeral)
// Synchronous reads from memory, async writes to both for persistence.
// Hydrates from Dexie (populated during boot from Go SQLite).

import type { EntityKind } from './Scanner/types';
import { db, Entity, Edge as DexieEdge } from './dexie';
import { clearAllDecorations } from './dexie/decorations';
import { getBridge } from './operations';
import { GoKittStoreService } from '../services/gokitt-store.service';

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
    /** Where this edge came from: 'scanner', 'llm', 'manual' */
    provenance?: 'scanner' | 'llm' | 'manual';
    /** Additional attributes like verb, manner, location, time */
    attributes?: Record<string, any>;
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

    // Dictionary rebuild debounce (for implicit highlighting)
    private dictionaryRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingDictionaryRebuild = false;
    private isRebuildingDictionary = false;

    // =========================================================================
    // Initialization - Hydrate from BootCache (pre-loaded) or Dexie (fallback)
    // =========================================================================

    async init(): Promise<void> {
        if (this.initialized) return;

        const start = performance.now();

        try {
            // Load entities from Dexie (ephemeral cache, populated from SQLite during boot)
            const [entities, edges] = await Promise.all([
                db.entities.toArray(),
                db.edges.toArray(),
            ]);

            // Hydrate entities
            for (const e of entities) {
                const registered = this.dexieToRegisteredEntity(e);
                this.entityCache.set(e.id, registered);
                this.labelIndex.set(e.label.toLowerCase(), e.id);
            }

            // Hydrate edges
            for (const edge of edges) {
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
            console.log(`[CentralRegistry] ✓ Initialized: ${this.entityCache.size} entities, ${this.edgeCache.size} edges (${duration}ms, from Dexie)`);

            // CRITICAL: Notify subscribers about hydrated data.
            // Without this, ScopeService (and other subscribers) never learn
            // that entities are available after boot cache hydration.
            if (this.entityCache.size > 0) {
                this.notify(true); // Entity change → triggers dictionary rebuild too
            }

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

    /**
     * Find an edge by source, target, and type
     */
    findEdge(sourceId: string, targetId: string, type: string): Edge | null {
        const id = `${sourceId}-${type}-${targetId}`;
        return this.edgeCache.get(id) || null;
    }

    // =========================================================================
    // MUTATIONS
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

        // Write-through to SQLite + Dexie (fire-and-forget)
        this.persistEntity(entity);

        this.notify(true); // Entity change - needs dictionary rebuild

        return { entity, isNew, wasMerged: false };
    }

    /**
     * Persist entity to SQLite (Truth) + Dexie (Shadow)
     * Fire-and-forget, non-blocking
     */
    private persistEntity(entity: RegisteredEntity): void {
        const dexieEntity = this.registeredToDexieEntity(entity);

        // 1. Write to Dexie immediately (for synchronous reads)
        db.entities.put(dexieEntity).catch(err => {
            console.warn('[CentralRegistry] Failed to persist entity to Dexie:', entity.id, err);
        });

        // 2. Write to SQLite (Source of Truth) via GoKittStoreService
        const store = getBridge();
        if (store) {
            store.upsertEntity(GoKittStoreService.fromDexieEntity(dexieEntity)).catch(err => {
                console.error('[CentralRegistry] Failed to sync entity to SQLite:', err);
            });
        } else {
            console.warn('[CentralRegistry] Cannot sync entity to SQLite: Store not initialized yet.');
        }
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

        this.notify(true); // Batch entity changes
        return results;
    }

    async deleteEntity(id: string): Promise<boolean> {
        const entity = this.entityCache.get(id);
        if (!entity) {
            return false;
        }

        const connectedEdgeIds = this.getConnectedEdgeIds(id);
        const store = getBridge();

        if (store) {
            try {
                await Promise.all(connectedEdgeIds.map(edgeId => store.deleteEdge(edgeId)));
                await store.deleteEntity(id);
            } catch (err) {
                console.error('[CentralRegistry] Failed to sync entity delete to SQLite:', id, err);
                throw err;
            }
        }

        this.labelIndex.delete(entity.label.toLowerCase());
        this.entityCache.delete(id);
        this.removeEdgesFromCache(connectedEdgeIds);

        try {
            await Promise.all([
                db.entities.delete(id),
                connectedEdgeIds.length > 0 ? db.edges.bulkDelete(connectedEdgeIds) : Promise.resolve(),
            ]);
        } catch (err) {
            console.warn('[CentralRegistry] Failed to delete entity from Dexie:', id, err);
        }

        await this.clearDerivedHighlightState();

        this.notify(true); // Entity deleted
        return true;
    }

    /**
     * Clear all entities and edges from the registry.
     * Returns the number of entities that were cleared.
     */
    async clearAll(): Promise<number> {
        const entityIds = Array.from(this.entityCache.keys());
        const edgeIds = Array.from(this.edgeCache.keys());
        const count = entityIds.length;
        const store = getBridge();

        if (store) {
            try {
                await Promise.all(edgeIds.map(edgeId => store.deleteEdge(edgeId)));
                await Promise.all(entityIds.map(entityId => store.deleteEntity(entityId)));
            } catch (err) {
                console.error('[CentralRegistry] Failed to sync registry clear to SQLite:', err);
                throw err;
            }
        }

        this.entityCache.clear();
        this.labelIndex.clear();
        this.edgeCache.clear();

        try {
            await Promise.all([
                db.entities.clear(),
                db.edges.clear(),
                db.entityMetadata.clear(),
            ]);
        } catch (err) {
            console.warn('[CentralRegistry] Failed to clear Dexie tables:', err);
        }

        await this.clearDerivedHighlightState();

        this.notify(true); // All entities cleared
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

        // Write-through to SQLite + Dexie (fire-and-forget)
        this.persistEntity(updated);

        this.notify(true); // Entity updated
        return updated;
    }

    // =========================================================================
    // RELATIONSHIPS (Edges)
    // =========================================================================

    createEdge(sourceId: string, targetId: string, type: string, options?: {
        sourceNote?: string;
        weight?: number;
        provenance?: 'scanner' | 'llm' | 'manual';
        attributes?: Record<string, any>;
    }): Edge {
        const id = `${sourceId}-${type}-${targetId}`;
        const edge: Edge = {
            id,
            sourceId,
            targetId,
            type,
            confidence: options?.weight ?? 1.0,
            sourceNote: options?.sourceNote,
            provenance: options?.provenance,
            attributes: options?.attributes,
        };

        this.edgeCache.set(id, edge);

        // Write-through to Dexie (fire-and-forget)
        const dexieEdge = {
            id,
            sourceId,
            targetId,
            relType: type,
            confidence: edge.confidence,
            bidirectional: false,
        };

        db.edges.put(dexieEdge).catch(err => {
            console.warn('[CentralRegistry] Failed to persist edge to Dexie:', id, err);
        });

        // Write-through to SQLite
        const store = getBridge();
        if (store) {
            store.upsertEdge(GoKittStoreService.fromDexieEdge(dexieEdge)).catch(err => {
                console.error('[CentralRegistry] Failed to sync edge to SQLite:', err);
            });
        }

        this.notify(false); // Edge change - no dictionary rebuild needed

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

    private notify(isEntityChange: boolean = false): void {
        if (this.suppressEvents) return;

        // Update snapshot
        this.snapshot = Array.from(this.entityCache.values());

        // Notify internal listeners
        this.listeners.forEach(fn => fn());

        // Dispatch DOM event for legacy listeners
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('entities-changed'));
        }

        // Schedule dictionary rebuild ONLY for entity changes (not edges)
        // Edges don't affect the Aho-Corasick dictionary
        if (isEntityChange && !this.isRebuildingDictionary) {
            this.scheduleDictionaryRebuild();
        }
    }

    /**
     * Schedule a dictionary rebuild with debouncing.
     * Multiple rapid changes will only trigger one rebuild after settling.
     */
    private scheduleDictionaryRebuild(): void {
        this.pendingDictionaryRebuild = true;

        // Clear existing timer
        if (this.dictionaryRebuildTimer) {
            clearTimeout(this.dictionaryRebuildTimer);
        }

        // Debounce: wait 500ms after last change before rebuilding
        this.dictionaryRebuildTimer = setTimeout(() => {
            if (this.pendingDictionaryRebuild) {
                this.performDictionaryRebuild();
                this.pendingDictionaryRebuild = false;
            }
        }, 500);
    }

    /**
     * Perform the actual dictionary rebuild.
     * Collects all entities and sends them to GoKitt for AC recompilation.
     */
    private async performDictionaryRebuild(): Promise<void> {
        // Guard: Prevent concurrent rebuilds
        if (this.isRebuildingDictionary) {
            console.log('[CentralRegistry] Dictionary rebuild already in progress, skipping');
            return;
        }
        this.isRebuildingDictionary = true;

        // Import GoKittService dynamically to avoid circular deps
        try {
            const { GoKittService } = await import('../services/gokitt.service');
            const injector = (window as any).__angularInjector;
            if (!injector) {
                console.warn('[CentralRegistry] Angular injector not available for dictionary rebuild');
                return;
            }

            const goKittService = injector.get(GoKittService) as InstanceType<typeof GoKittService>;
            if (!goKittService) {
                console.warn('[CentralRegistry] GoKittService not available');
                return;
            }

            // Build entity list for AC dictionary
            const entities = this.snapshot.map(e => ({
                id: e.id,
                label: e.label,
                kind: e.kind,
                aliases: e.aliases || [],
            }));

            console.log(`[CentralRegistry] Triggering dictionary rebuild with ${entities.length} entities`);
            await goKittService.rebuildDictionary(entities);
            console.log(`[CentralRegistry] ✅ Dictionary rebuild complete`);

            // Dispatch event to trigger immediate rescan with updated dictionary
            // SAFE: ScanCoordinator has guard to skip already-registered entities (line 98-100)
            // preventing: dictionary-rebuilt → rescan → onEntityDecoration → registerEntity → notify → LOOP
            window.dispatchEvent(new CustomEvent('dictionary-rebuilt'));
            console.log(`[CentralRegistry] 📢 Dispatched dictionary-rebuilt event`);
        } catch (err) {
            console.error('[CentralRegistry] Dictionary rebuild failed:', err);
        } finally {
            this.isRebuildingDictionary = false;
        }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    generateEntityId(label: string, kind: EntityKind): string {
        const normalized = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return `${kind.toLowerCase()}_${normalized}`;
    }

    private getConnectedEdgeIds(entityId: string): string[] {
        return Array.from(this.edgeCache.values())
            .filter(edge => edge.sourceId === entityId || edge.targetId === entityId)
            .map(edge => edge.id);
    }

    private removeEdgesFromCache(edgeIds: string[]): void {
        for (const edgeId of edgeIds) {
            this.edgeCache.delete(edgeId);
        }
    }

    private async clearDerivedHighlightState(): Promise<void> {
        try {
            await clearAllDecorations();
        } catch (err) {
            console.warn('[CentralRegistry] Failed to clear derived decorations:', err);
        }
    }
}

// Singleton Export
export const smartGraphRegistry = new CentralRegistry();
