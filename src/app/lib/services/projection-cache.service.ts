import { Injectable } from '@angular/core';
import type { Entity } from '../dexie/db';
import type { CozoSpan } from '../cozo/schema/layer2-span-model';

// Cross-world query functionality now uses CozoDB for spans, wormholes, spanMentions.
// Schemas: src/app/lib/cozo/schema/layer2-span-model.ts
// Operations: GoKitt/internal/store/sqlite_store.go (when implemented)

/**
 * Dependency Graph Node for reactive invalidation
 */
interface ProjectionDependency {
    sourceSpanId: string;
    // what derived artifacts depend on this span?
    dependents: {
        type: 'entity' | 'claim' | 'cst_node';
        id: string;
    }[];
}

/**
 * Per-World Projection Cache
 * Stores derived artifacts (CST, PCST) and dependency graph to minimize re-compute.
 */
interface WorldProjectionState {
    worldId: string;

    // Cache for Concrete Syntax Trees or Projected CSTs
    // Key: noteId, Value: Computed Tree
    cstCache: Map<string, any>;

    // Dependency Graph: Which spans effect which higher-order constructs
    // Key: spanId, Value: Dependencies
    dependencyGraph: Map<string, ProjectionDependency>;

    // Entity/Claim Projection Cache (hot objects)
    entityProjectionCache: Map<string, Entity>;
    claimProjectionCache: Map<string, any>; // Claim type if needed
}

@Injectable({
    providedIn: 'root'
})
export class ProjectionCacheService {
    // In-memory cache of projections (cleared on reload, rehydrated lazily)
    private worlds = new Map<string, WorldProjectionState>();

    constructor() { }

    private getWorld(worldId: string): WorldProjectionState {
        if (!this.worlds.has(worldId)) {
            this.worlds.set(worldId, {
                worldId,
                cstCache: new Map(),
                dependencyGraph: new Map(),
                entityProjectionCache: new Map(),
                claimProjectionCache: new Map()
            });
        }
        return this.worlds.get(worldId)!;
    }

    /**
     * INVALIDATION: Called when a span is modified/detached (e.g. by re-anchoring)
     * Triggers updates only for affected derived artifacts.
     */
    invalidateSpan(worldId: string, spanId: string) {
        const world = this.getWorld(worldId);
        const deps = world.dependencyGraph.get(spanId);

        if (deps) {
            deps.dependents.forEach(dep => {
                if (dep.type === 'entity') world.entityProjectionCache.delete(dep.id);
                if (dep.type === 'claim') world.claimProjectionCache.delete(dep.id);
                // CST invalidation might be more granular (node level) or note level
            });
        }
    }

    /**
     * CROSS-WORLD QUERY: world -> spans -> wormholes -> target spans -> target entities
     *
     * CozoDB Implementation (when Go operations are ready):
     * 1. Query spans by world_id and position range from CozoDB
     * 2. Query wormholes to find cross-span links
     * 3. Query span_mentions to resolve entity candidates
     * 4. Query entities for final entity data
     *
     * See: docs/cozo-span-migration-plan.md for full query design
     */
    async crossWorldQuery(
        sourceWorldId: string,
        start: number,
        end: number
    ): Promise<{ spans: CozoSpan[], entities: Entity[] }> {
        // TODO: Implement using Go operations when ready
        // Example CozoDB query pattern:
        // ?[span] := *spans{world_id: sourceWorldId, start: s, end: e, id: span},
        //           s >= start, e <= end
        // ?[dst_span] := *wormholes{src_span_id: span, dst_span_id: dst_span}
        // ?[entity] := *span_mentions{span_id: dst_span, candidate_entity_id: entity}

        console.warn('[ProjectionCacheService] crossWorldQuery not yet implemented - CozoDB schemas ready, Go operations pending');

        return {
            spans: [],
            entities: []
        };
    }
}
