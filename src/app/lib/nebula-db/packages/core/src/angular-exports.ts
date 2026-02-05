/**
 * Minimal exports from NebulaDB core for use in Angular
 * This avoids importing files with incomplete/broken implementations
 */

// Export main database functionality
export { createDb, Database } from './db';
export { Collection } from './collection';
export { matchDocument, applyUpdate } from './optimized-query';

// Export memory adapter only
export { MemoryAdapter } from './memory-adapter';

// Export types
export type {
    Document,
    Query,
    QueryCondition,
    QueryOperator,
    LogicalOperator,
    UpdateOperator,
    UpdateOperation,
    IndexDefinition,
    CollectionOptions,
    DbOptions,
    Adapter,
    Plugin,
    SubscriptionCallback,
    ICollection
} from './types';

// Export enums (needed for index definitions)
export { IndexType } from './types';
