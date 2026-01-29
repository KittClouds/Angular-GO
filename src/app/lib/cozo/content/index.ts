/**
 * Cozo Content Module - Notes, Folders, Tags, Calendar
 * 
 * Single source of truth for all content storage.
 */

// Types
export * from './ContentTypes';

// Schema
export { CONTENT_SCHEMAS, createContentSchemas } from './ContentSchema';

// Repositories
export {
    NoteRepo,
    FolderRepo,
    TagRepo,
    initContentRepo,
    isContentRepoInitialized,
} from './ContentRepo';

export { CalendarRepo } from './CalendarRepo';

// Entity Metadata (graph-native FactSheets replacement)
export {
    entityMetadataService,
    EntityMetadataService,
    ensureMetadataSchemas,
} from './EntityMetadataService';
