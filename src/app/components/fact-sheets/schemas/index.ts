/**
 * Entity Schema Exports
 * Central export point for all entity schemas
 */

export { characterSchema } from './character.schema';

// Future schemas will be added here:
// export { locationSchema } from './location.schema';
// export { itemSchema } from './item.schema';
// export { factionSchema } from './faction.schema';
// export { eventSchema } from './event.schema';
// export { conceptSchema } from './concept.schema';
// export { npcSchema } from './npc.schema';
// export { sceneSchema } from './scene.schema';

import { EntityKind, EntityFactSheetSchema } from '../types';
import { characterSchema } from './character.schema';
import { sceneSchema } from './scene.schema';

/**
 * Schema registry - maps EntityKind to its schema
 */
export const SCHEMAS: Partial<Record<EntityKind, EntityFactSheetSchema>> = {
    CHARACTER: characterSchema,
    SCENE: sceneSchema,
    // Add others as implemented
};

/**
 * Get schema for an entity kind
 */
export function getSchemaForKind(kind: EntityKind): EntityFactSheetSchema | undefined {
    return SCHEMAS[kind];
}
