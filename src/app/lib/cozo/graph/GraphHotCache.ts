/**
 * GraphHotCache - O(1) in-memory entity/relationship lookup
 * 
 * Dual-index cache with normalized label + alias lookups.
 * Syncs to localStorage boot cache for instant startup.
 * 
 * Hot = actively queried, Warm = preloaded from boot cache, Cold = DB-only
 */

import type { CozoEntity, CozoRelationship } from './GraphRegistry';
import { saveCozoBootCache, loadCozoBootCache, buildCozoBootCache, type CozoBootCache } from '../../storage/cozoBootCache';
import type { QueryClient } from '@tanstack/react-query';

// =============================================================================
// TYPES
// =============================================================================

export interface GraphHotCacheConfig {
    maxEntities?: number;       // LRU eviction threshold (default 1000)
    maxRelationships?: number;  // (default 2000)
    bootCacheEnabled?: boolean; // localStorage sync (default true)
    queryClient?: QueryClient;  // TanStack invalidation (optional)
}

interface CacheEntry<T> {
    data: T;
    lastAccessed: number;
}

// =============================================================================
// GRAPH HOT CACHE
// =============================================================================

export class GraphHotCache {
    // Entity caches
    private entityById = new Map<string, CacheEntry<CozoEntity>>();
    private entityByNormalized = new Map<string, string>(); // normalized → id
    private aliasToEntityId = new Map<string, string>();    // normalized alias → id

    // Relationship cache
    private relationshipById = new Map<string, CacheEntry<CozoRelationship>>();

    // Config
    private maxEntities: number;
    private maxRelationships: number;
    private bootCacheEnabled: boolean;
    private queryClient: QueryClient | null = null;

    // State
    private warmed = false;
    private dirty = false; // Needs boot cache sync

    // Entity version for decoration cache invalidation
    // Bumps whenever entities are added/updated/removed
    private _entityVersion = 0;

    constructor(config: GraphHotCacheConfig = {}) {
        this.maxEntities = config.maxEntities ?? 500;       // Lower default for memory
        this.maxRelationships = config.maxRelationships ?? 1000;  // Lower default for memory
        this.bootCacheEnabled = config.bootCacheEnabled ?? true;
        this.queryClient = config.queryClient ?? null;
    }

    // =========================================================================
    // ENTITY OPERATIONS
    // =========================================================================

    /**
     * Get entity by ID (O(1))
     */
    getEntity(id: string): CozoEntity | null {
        const entry = this.entityById.get(id);
        if (entry) {
            entry.lastAccessed = Date.now();
            return entry.data;
        }
        return null;
    }

    /**
     * Find entity by label or alias (O(1))
     */
    findEntityByLabel(text: string): CozoEntity | null {
        const normalized = this.normalize(text);

        // Check primary label
        const idByLabel = this.entityByNormalized.get(normalized);
        if (idByLabel) {
            return this.getEntity(idByLabel);
        }

        // Check aliases
        const idByAlias = this.aliasToEntityId.get(normalized);
        if (idByAlias) {
            return this.getEntity(idByAlias);
        }

        return null;
    }

    /**
     * Check if entity exists by label (O(1))
     */
    hasEntity(text: string): boolean {
        const normalized = this.normalize(text);
        return this.entityByNormalized.has(normalized) || this.aliasToEntityId.has(normalized);
    }

    /**
     * Add or update entity in cache
     * @param skipVersionBump - If true, don't bump entityVersion (used during bulk warming)
     */
    setEntity(entity: CozoEntity, skipVersionBump = false): void {
        const normalized = this.normalize(entity.label);

        // Remove old index entries if updating
        const existing = this.entityById.get(entity.id);
        if (existing) {
            this.entityByNormalized.delete(this.normalize(existing.data.label));
            for (const alias of existing.data.aliases ?? []) {
                this.aliasToEntityId.delete(this.normalize(alias));
            }
        }

        // Add to cache
        this.entityById.set(entity.id, {
            data: entity,
            lastAccessed: Date.now()
        });
        this.entityByNormalized.set(normalized, entity.id);

        // Index aliases
        for (const alias of entity.aliases ?? []) {
            this.aliasToEntityId.set(this.normalize(alias), entity.id);
        }

        this.dirty = true;
        if (!skipVersionBump) {
            this._entityVersion++;  // Bump for decoration cache invalidation
        }
        this.evictEntitiesIfNeeded();
        this.maybeInvalidateQueries('entities');
    }

    /**
     * Remove entity from cache
     */
    removeEntity(id: string): void {
        const entry = this.entityById.get(id);
        if (!entry) return;

        // Remove all index entries
        this.entityByNormalized.delete(this.normalize(entry.data.label));
        for (const alias of entry.data.aliases ?? []) {
            this.aliasToEntityId.delete(this.normalize(alias));
        }
        this.entityById.delete(id);

        this.dirty = true;
        this._entityVersion++;  // Bump for decoration cache invalidation
        this.maybeInvalidateQueries('entities');
    }

    /**
     * Get all cached entities
     */
    getAllEntities(): CozoEntity[] {
        return Array.from(this.entityById.values()).map(e => e.data);
    }

    /**
     * Get entities by kind (O(n) but from memory)
     */
    getEntitiesByKind(kind: string): CozoEntity[] {
        return this.getAllEntities().filter(e => e.kind === kind);
    }

    // =========================================================================
    // RELATIONSHIP OPERATIONS
    // =========================================================================

    /**
     * Get relationship by ID (O(1))
     */
    getRelationship(id: string): CozoRelationship | null {
        const entry = this.relationshipById.get(id);
        if (entry) {
            entry.lastAccessed = Date.now();
            return entry.data;
        }
        return null;
    }

    /**
     * Add or update relationship in cache
     */
    setRelationship(rel: CozoRelationship): void {
        this.relationshipById.set(rel.id, {
            data: rel,
            lastAccessed: Date.now()
        });
        this.evictRelationshipsIfNeeded();
    }

    /**
     * Remove relationship from cache
     */
    removeRelationship(id: string): void {
        this.relationshipById.delete(id);
    }

    /**
     * Get all cached relationships
     */
    getAllRelationships(): CozoRelationship[] {
        return Array.from(this.relationshipById.values()).map(r => r.data);
    }

    // =========================================================================
    // CACHE LIFECYCLE
    // =========================================================================

    /**
     * Warm the cache from boot cache (localStorage)
     * Returns entities loaded (0 if no boot cache)
     */
    warmFromBootCache(): number {
        if (!this.bootCacheEnabled) return 0;

        const bootCache = loadCozoBootCache();
        if (!bootCache) return 0;

        for (const e of bootCache.entities) {
            // Minimal entity for cache (no computed fields yet)
            const entity: CozoEntity = {
                id: e.id,
                label: e.label,
                normalized: this.normalize(e.label),
                kind: e.kind as any,
                subtype: e.subtype,
                aliases: e.aliases,
                firstNote: '', // Will be hydrated from DB
                createdAt: new Date(),
                updatedAt: new Date(), // Added missing field
                createdBy: 'auto',
                narrativeId: (e as any).narrativeId // Optional if boot cache updated
            };
            this.setEntity(entity, true);  // Skip version bump during bulk load
        }

        this.warmed = true;
        this.dirty = false; // Just loaded, not dirty
        console.log(`[GraphHotCache] Warmed from boot cache: ${bootCache.entities.length} entities, entityVersion=${this._entityVersion}`);
        return bootCache.entities.length;
    }

    /**
     * Bulk warm with full entities (from DB load)
     */
    warmWithEntities(entities: CozoEntity[]): void {
        for (const entity of entities) {
            this.setEntity(entity, true);  // Skip version bump during bulk load
        }
        this.warmed = true;
        this.syncToBootCache();
        console.log(`[GraphHotCache] Warmed with ${entities.length} entities from DB, entityVersion=${this._entityVersion}`);
    }

    /**
     * Sync current state to boot cache (localStorage)
     */
    syncToBootCache(): void {
        if (!this.bootCacheEnabled || !this.dirty) return;

        const entities = this.getAllEntities().map(e => ({
            id: e.id,
            label: e.label,
            kind: e.kind,
            subtype: e.subtype,
            aliases: e.aliases,
            narrativeId: e.narrativeId
        }));

        const cache = buildCozoBootCache(
            entities,
            this.relationshipById.size
        );
        saveCozoBootCache(cache);
        this.dirty = false;
    }

    /**
     * Invalidate single entity (also syncs boot cache)
     */
    invalidateEntity(id: string): void {
        this.removeEntity(id);
        this.syncToBootCache();
    }

    /**
     * Invalidate all cache
     */
    invalidateAll(): void {
        this.entityById.clear();
        this.entityByNormalized.clear();
        this.aliasToEntityId.clear();
        this.relationshipById.clear();
        this.warmed = false;
        this.dirty = true;
        this.maybeInvalidateQueries('entities');
        this.maybeInvalidateQueries('relationships');
    }

    /**
     * Get cache stats
     */
    getStats(): { entities: number; relationships: number; warmed: boolean; dirty: boolean } {
        return {
            entities: this.entityById.size,
            relationships: this.relationshipById.size,
            warmed: this.warmed,
            dirty: this.dirty
        };
    }

    get isWarmed(): boolean {
        return this.warmed;
    }

    get size(): number {
        return this.entityById.size;
    }

    /**
     * Get current entity version (for decoration cache invalidation)
     */
    get entityVersion(): number {
        return this._entityVersion;
    }

    /**
     * Bump entity version (call when entities change)
     */
    bumpEntityVersion(): void {
        this._entityVersion++;
    }

    // =========================================================================
    // TanStack Query Integration
    // =========================================================================

    setQueryClient(client: QueryClient): void {
        this.queryClient = client;
    }

    private maybeInvalidateQueries(key: string): void {
        if (!this.queryClient) return;
        this.queryClient.invalidateQueries({ queryKey: [key] });
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    private normalize(text: string): string {
        return text.trim().toLowerCase();
    }

    private evictEntitiesIfNeeded(): void {
        if (this.entityById.size <= this.maxEntities) return;

        // LRU eviction: sort by lastAccessed, remove oldest
        const entries = Array.from(this.entityById.entries())
            .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

        const toEvict = entries.slice(0, entries.length - this.maxEntities);
        for (const [id] of toEvict) {
            this.removeEntity(id);
        }
    }

    private evictRelationshipsIfNeeded(): void {
        if (this.relationshipById.size <= this.maxRelationships) return;

        const entries = Array.from(this.relationshipById.entries())
            .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

        const toEvict = entries.slice(0, entries.length - this.maxRelationships);
        for (const [id] of toEvict) {
            this.relationshipById.delete(id);
        }
    }
}

// Singleton instance
export const graphHotCache = new GraphHotCache();
