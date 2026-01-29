/**
 * Narrative Scope Utilities
 * 
 * Functions for managing entity isolation within narrative vaults.
 * Entities in one narrative are completely isolated from entities in another.
 */

import type { GraphScope, CozoEntity } from './types';
import { buildScopeIdentifier } from './types';

/**
 * Build a narrative-scoped identifier
 */
export function buildNarrativeScopeId(narrativeId: string): string {
    return `narrative:${narrativeId}`;
}

/**
 * Check if a groupId belongs to a narrative scope
 */
export function isNarrativeScope(groupId: string): boolean {
    return groupId.startsWith('narrative:');
}

/**
 * Extract narrative ID from a groupId
 * Returns undefined if not a narrative scope
 */
export function extractNarrativeId(groupId: string): string | undefined {
    if (!isNarrativeScope(groupId)) return undefined;
    return groupId.replace('narrative:', '');
}

/**
 * Filter entities by narrative scope
 * If narrativeId is provided, only return entities from that narrative.
 * If narrativeId is undefined, only return global (non-narrative) entities.
 */
export function filterEntitiesByNarrative(
    entities: CozoEntity[],
    narrativeId?: string
): CozoEntity[] {
    if (narrativeId) {
        // Only entities from this specific narrative
        return entities.filter(e => e.narrativeId === narrativeId);
    } else {
        // Only global entities (no narrative scope)
        return entities.filter(e => !e.narrativeId);
    }
}

/**
 * Check if an entity belongs to a specific narrative
 */
export function entityBelongsToNarrative(
    entity: CozoEntity,
    narrativeId?: string
): boolean {
    if (!narrativeId) {
        // No narrative scope - entity must be global
        return !entity.narrativeId;
    }
    return entity.narrativeId === narrativeId;
}

/**
 * Build the appropriate groupId for an entity based on its narrative scope
 */
export function buildEntityGroupId(narrativeId?: string): string {
    if (narrativeId) {
        return buildScopeIdentifier('narrative', narrativeId).groupId;
    }
    return buildScopeIdentifier('vault', 'global').groupId;
}

/**
 * For scanner: Get the effective narrative context from note metadata
 */
export interface ScanContext {
    noteId: string;
    folderId?: string;
    narrativeId?: string;
}

/**
 * Determine if two entities can reference each other
 * Entities in different narratives cannot directly reference each other
 */
export function canEntitiesReference(
    entityA: { narrativeId?: string },
    entityB: { narrativeId?: string }
): boolean {
    // Both must be in same narrative OR both must be global
    if (entityA.narrativeId && entityB.narrativeId) {
        return entityA.narrativeId === entityB.narrativeId;
    }
    if (!entityA.narrativeId && !entityB.narrativeId) {
        return true; // Both global
    }
    // One is narrative-scoped, other is global - cannot reference
    return false;
}
