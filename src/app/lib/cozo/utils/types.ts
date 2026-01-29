/**
 * Cozo-local type definitions
 * These mirror the main app types but are isolated to avoid circular deps
 */

// Entity kinds used throughout the cozo graph
export type EntityKind =
    | 'CHARACTER'
    | 'LOCATION'
    | 'NPC'
    | 'ITEM'
    | 'FACTION'
    | 'SCENE'
    | 'EVENT'
    | 'CONCEPT'
    | 'ARC'
    | 'ACT'
    | 'CHAPTER'
    | 'BEAT'
    | 'TIMELINE'
    | 'NARRATIVE';

export const ENTITY_KINDS: readonly EntityKind[] = [
    'CHARACTER',
    'LOCATION',
    'NPC',
    'ITEM',
    'FACTION',
    'SCENE',
    'EVENT',
    'CONCEPT',
    'ARC',
    'ACT',
    'CHAPTER',
    'BEAT',
    'TIMELINE',
    'NARRATIVE',
] as const;

// Graph scope types
export type GraphScope = 'note' | 'folder' | 'vault' | 'narrative';

// Extraction method types
export type ExtractionMethod = 'regex' | 'llm' | 'manual';

// Confidence levels
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * Helper to check if a string is a valid EntityKind
 */
export function isEntityKind(value: string): value is EntityKind {
    return ENTITY_KINDS.includes(value as EntityKind);
}
