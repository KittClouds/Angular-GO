/**
 * EntityRegistryAdapter - Backwards compatibility layer
 * 
 * Drop-in replacement for the old EntityRegistry.
 * Delegates all operations to GraphRegistry.
 * 
 * Usage:
 *   import { entityRegistry } from '@/lib/cozo/graph/adapters/EntityRegistryAdapter';
 */

import { graphRegistry, type CozoEntity } from '../GraphRegistry';
import type { EntityKind } from '../../utils';

// ==================== LEGACY TYPES (from old EntityRegistry) ====================

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
}

export interface EntityMention {
    entityId: string;
    noteId: string;
    count: number;
    lastSeen: Date;
}

export interface EntityRegistrationResult {
    entity: RegisteredEntity;
    isNew: boolean;
    wasMerged: boolean;
}

export interface EntitySearchResult {
    entity: RegisteredEntity;
    matchType: 'exact' | 'alias' | 'fuzzy';
    score: number;
}

export interface EntityStats {
    totalEntities: number;
    byKind: Record<string, number>;
    totalMentions: number;
    totalAliases: number;
}

// ==================== ADAPTER CLASS ====================

export class EntityRegistryAdapter {
    private initialized = false;
    private initPromise: Promise<void> | null = null;

    /**
     * Check if the adapter is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Initialize the registry (delegates to GraphRegistry)
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                await graphRegistry.init();
                this.initialized = true;
            } catch (err) {
                this.initPromise = null;
                throw err;
            }
        })();

        return this.initPromise;
    }

    /**
     * Register an entity (or update if exists)
     */
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
        await this.ensureInit();

        // Check if entity already exists
        const existing = graphRegistry.findEntityByLabel(label);
        const isNew = !existing;

        // Register via unified registry
        const entity = graphRegistry.registerEntity(label, kind, noteId, {
            subtype: options?.subtype,
            aliases: options?.aliases,
            metadata: options?.attributes,
        });

        if (!entity) {
            throw new Error(`Failed to register entity: ${label}`);
        }

        return {
            entity: this.convertToLegacyEntity(entity),
            isNew,
            wasMerged: false,
        };
    }

    /**
     * Check if entity is registered
     */
    isRegisteredEntity(label: string): boolean {
        if (!this.initialized) return false;
        return !!graphRegistry.findEntityByLabelSync(label);
    }

    /**
     * Get entity by ID
     */
    getEntityById(id: string): RegisteredEntity | null {
        if (!this.initialized) return null;
        const entity = graphRegistry.getEntityByIdSync(id);
        return entity ? this.convertToLegacyEntity(entity) : null;
    }

    /**
     * Find entity by label (case-insensitive)
     */
    findEntityByLabel(label: string): RegisteredEntity | null {
        if (!this.initialized) return null;
        const entity = graphRegistry.findEntityByLabelSync(label);
        return entity ? this.convertToLegacyEntity(entity) : null;
    }

    /**
     * Get all entities
     */
    getAllEntities(): RegisteredEntity[] {
        if (!this.initialized) return [];
        const entities = graphRegistry.getAllEntitiesSync();
        return entities.map(e => this.convertToLegacyEntity(e));
    }

    /**
     * Get all entities synchronously (requires CozoDB init)
     */
    getAllEntitiesSync(): RegisteredEntity[] {
        if (!this.initialized) return [];
        try {
            const entities = graphRegistry.getAllEntitiesSync();
            return entities.map(e => this.convertToLegacyEntity(e));
        } catch (err) {
            console.warn('[EntityRegistryAdapter] getAllEntitiesSync failed:', err);
            return [];
        }
    }

    findEntitySync(label: string): RegisteredEntity | null {
        if (!this.initialized) return null;
        const entity = graphRegistry.findEntityByLabelSync(label);
        return entity ? this.convertToLegacyEntity(entity) : null;
    }

    getEntityByIdSync(id: string): RegisteredEntity | null {
        if (!this.initialized) return null;
        const entity = graphRegistry.getEntityByIdSync(id);
        return entity ? this.convertToLegacyEntity(entity) : null;
    }

    /**
     * Check if entity matches (sync)
     */
    findEntity(text: string): RegisteredEntity | undefined {
        return this.findEntitySync(text) || undefined;
    }

    /**
     * Get entities by kind
     */
    getEntitiesByKind(kind: EntityKind): RegisteredEntity[] {
        if (!this.initialized) return [];
        const entities = graphRegistry.getAllEntitiesSync({ kind });
        return entities.map(e => this.convertToLegacyEntity(e));
    }

    /**
     * Get entities by subtype
     */
    async getEntitiesBySubtype(kind: EntityKind, subtype: string): Promise<RegisteredEntity[]> {
        await this.ensureInit();
        const entities = graphRegistry.getEntitiesBySubtype(kind, subtype);
        return entities.map(e => this.convertToLegacyEntity(e));
    }

    /**
     * Search entities (fuzzy matching)
     */
    async searchEntities(query: string): Promise<EntitySearchResult[]> {
        await this.ensureInit();
        const entities = graphRegistry.searchEntities(query);

        const normalized = query.toLowerCase().trim();

        return entities.map(entity => {
            let matchType: 'exact' | 'alias' | 'fuzzy' = 'fuzzy';
            let score = 0.5;

            if (entity.normalized === normalized) {
                matchType = 'exact';
                score = 1.0;
            } else if (entity.aliases?.some(a => a.toLowerCase() === normalized)) {
                matchType = 'alias';
                score = 0.9;
            } else if (entity.normalized.includes(normalized)) {
                matchType = 'fuzzy';
                score = 0.7;
            }

            return {
                entity: this.convertToLegacyEntity(entity),
                matchType,
                score,
            };
        }).sort((a, b) => b.score - a.score);
    }

    /**
     * Add alias to entity
     */
    async addAlias(entityId: string, alias: string): Promise<boolean> {
        await this.ensureInit();
        return graphRegistry.addAlias(entityId, alias);
    }

    /**
     * Remove alias from entity
     */
    async removeAlias(entityId: string, alias: string): Promise<boolean> {
        await this.ensureInit();
        return graphRegistry.removeAlias(entityId, alias);
    }

    /**
     * Update entity mention count for a note
     */
    async updateNoteMentions(entityId: string, noteId: string, count: number): Promise<void> {
        await this.ensureInit();
        graphRegistry.updateNoteMentions(entityId, noteId, count);
    }

    /**
     * Update entity properties
     */
    async updateEntity(
        id: string,
        updates: {
            label?: string;
            kind?: EntityKind;
            subtype?: string;
            attributes?: Record<string, any>;
        }
    ): Promise<boolean> {
        await this.ensureInit();
        const result = graphRegistry.updateEntity(id, {
            label: updates.label,
            kind: updates.kind,
            subtype: updates.subtype,
            metadata: updates.attributes,
        });
        return result !== null;
    }

    /**
     * Delete entity (cascading)
     */
    async deleteEntity(id: string): Promise<boolean> {
        await this.ensureInit();
        return graphRegistry.deleteEntity(id);
    }

    /**
     * Merge two entities
     */
    async mergeEntities(targetId: string, sourceId: string): Promise<boolean> {
        await this.ensureInit();
        return graphRegistry.mergeEntities(targetId, sourceId);
    }

    /**
     * Handle note deletion (cleanup)
     */
    async onNoteDeleted(noteId: string): Promise<void> {
        await this.ensureInit();
        graphRegistry.onNoteDeleted(noteId);
    }

    async getEntityStats(entityId: string): Promise<{
        totalMentions: number;
        noteCount: number;
        aliases: string[];
    } | null> {
        await this.ensureInit();
        const entity = graphRegistry.getEntityById(entityId);
        if (!entity) return null;
        return {
            totalMentions: entity.totalMentions || 0,
            noteCount: entity.mentionsByNote?.size || 0,
            aliases: entity.aliases || [],
        };
    }

    /**
     * Get global statistics
     */
    async getStats(): Promise<EntityStats> {
        await this.ensureInit();
        const globalStats = graphRegistry.getGlobalStats();

        let totalMentions = 0;
        let totalAliases = 0;

        // Calculate totals (approximation from entity data)
        const allEntities = graphRegistry.getAllEntities();
        for (const entity of allEntities) {
            totalMentions += entity.totalMentions || 0;
            totalAliases += entity.aliases?.length || 0;
        }

        return {
            totalEntities: globalStats.totalEntities,
            byKind: globalStats.entitiesByKind,
            totalMentions,
            totalAliases,
        };
    }

    /**
     * Export registry to JSON
     */
    async toJSON(): Promise<any> {
        await this.ensureInit();
        return {
            version: '1.0',
            timestamp: new Date().toISOString(),
            entities: (graphRegistry.getAllEntities()).map(e => this.convertToLegacyEntity(e)),
        };
    }

    /**
     * Import registry from JSON
     */
    async fromJSON(data: any): Promise<void> {
        await this.ensureInit();

        if (data.entities) {
            console.warn('[EntityRegistryAdapter] Legacy import format detected, converting...');

            for (const entity of data.entities) {
                graphRegistry.registerEntity(
                    entity.label,
                    entity.kind,
                    entity.firstNote,
                    {
                        subtype: entity.subtype,
                        aliases: entity.aliases,
                        metadata: entity.attributes,
                    }
                );

                // Restore mentions
                if (entity.mentionsByNote) {
                    for (const [noteId, count] of Object.entries(entity.mentionsByNote)) {
                        graphRegistry.updateNoteMentions(entity.id, noteId, count as number);
                    }
                }
            }
        }
    }

    /**
     * Clear all data
     */
    async clear(): Promise<void> {
        await this.ensureInit();
        // Clear not implemented - would need to delete all entities
        console.warn('[EntityRegistryAdapter] clear() not fully implemented');
    }

    /**
     * Manual persistence
     */
    async persist(): Promise<void> {
        await this.ensureInit();
        // Cozo is always persisted to memory/WASM state. 
        // If file sync is needed, logic should be in db.ts or hook.
    }

    // ==================== HELPER METHODS ====================

    private async ensureInit(): Promise<void> {
        if (!this.initialized) {
            await this.init();
        }
    }

    /**
     * Convert CozoEntity to legacy RegisteredEntity format
     */
    private convertToLegacyEntity(entity: CozoEntity): RegisteredEntity {
        return {
            id: entity.id,
            label: entity.label,
            aliases: entity.aliases || [],
            kind: entity.kind,
            subtype: entity.subtype,
            firstNote: entity.firstNote,
            mentionsByNote: entity.mentionsByNote || new Map(),
            totalMentions: entity.totalMentions || 0,
            lastSeenDate: entity.lastSeenDate || new Date(),
            createdAt: entity.createdAt,
            createdBy: entity.createdBy,
            attributes: entity.metadata || {},
        };
    }
}

// Singleton instance (drop-in replacement)
export const entityRegistry = new EntityRegistryAdapter();
