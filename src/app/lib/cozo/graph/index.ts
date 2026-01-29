/**
 * CozoDB Graph Module - Main exports
 * 
 * This is the primary entry point for the graph registry system.
 */

// Core registry
export {
    graphRegistry,
    graphRegistry as cozoGraphRegistry, // Alias for different naming conventions
    CozoGraphRegistry,
    CozoGraphRegistry as GraphRegistry, // Legacy alias
    type CozoEntity,
    type CozoRelationship,
    type RelationshipProvenance,
    type EntityStats,
    type GlobalStats
} from './GraphRegistry';

// Hot cache
export {
    GraphHotCache,
    graphHotCache,
    type GraphHotCacheConfig
} from './GraphHotCache';

// Adapters (backwards compatibility)
export {
    entityRegistry,
    EntityRegistryAdapter,
    type RegisteredEntity,
    type EntityRegistrationResult,
    type EntitySearchResult,
    type EntityMention,
    type EntityStats as AdapterEntityStats
} from './adapters/EntityRegistryAdapter';

export {
    relationshipRegistry,
    RelationshipRegistryAdapter
} from './adapters/RelationshipRegistryAdapter';

export type {
    UnifiedRelationship,
    RelationshipInput,
    RelationshipQuery,
    RelationshipStats,
    RelationshipProvenance as AdapterRelationshipProvenance,
    RelationshipSource
} from './adapters/types';
