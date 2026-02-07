/**
 * Episode Log Service
 * 
 * Append-only action stream for LLM memory temporal reasoning.
 * Captures user actions to enable "what did the LLM know at time T?" queries.
 */

import { cozoDb } from '../db';
import {
    Episode,
    EpisodeActionType,
    EpisodeTargetKind,
    EpisodePayload,
    EpisodeMatch,
    MEMORY_QUERIES,
    mapRowToEpisode,
} from '../schema/layer4-memory';
import { ScopeMode, buildScopeClosureRule } from '../types';

// ============================================================================
// Episode Logging
// ============================================================================

/**
 * Log an episode to the append-only stream.
 * Episodes are immutable once written.
 */
export function logEpisode(episode: Episode): boolean {
    const query = MEMORY_QUERIES.logEpisode;

    try {
        const resultStr = cozoDb.run(query, {
            scope_id: episode.scopeId,
            note_id: episode.noteId,
            ts: episode.ts,
            action_type: episode.actionType,
            target_id: episode.targetId,
            target_kind: episode.targetKind,
            payload: episode.payload,
            narrative_id: episode.narrativeId,
        });
        const result = JSON.parse(resultStr);
        return result.ok !== false;
    } catch (err) {
        console.error('[EpisodeLogService] Failed to log episode:', err);
        return false;
    }
}

/**
 * Convenience function to create and log an episode in one call.
 */
export function recordAction(
    scopeId: string,
    noteId: string,
    actionType: EpisodeActionType,
    targetId: string,
    targetKind: EpisodeTargetKind,
    payload: EpisodePayload,
    narrativeId: string
): boolean {
    return logEpisode({
        scopeId,
        noteId,
        ts: Date.now(),
        actionType,
        targetId,
        targetKind,
        payload,
        narrativeId,
    });
}

// ============================================================================
// Episode Retrieval
// ============================================================================

/**
 * Get episodes for a scope with optional mode.
 */
export function getEpisodes(
    scopeId: string,
    mode: ScopeMode = 'local_only',
    limit: number = 100
): Episode[] {
    const query = mode === 'bubble_up'
        ? MEMORY_QUERIES.getEpisodesBubbleUp
        : MEMORY_QUERIES.getEpisodesLocal;

    try {
        const resultStr = cozoDb.run(query, {
            scope_id: scopeId,
            limit,
        });
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            console.error('[EpisodeLogService] Query failed:', result.message);
            return [];
        }
        return (result.rows || []).map(mapRowToEpisode);
    } catch (err) {
        console.error('[EpisodeLogService] Failed to get episodes:', err);
        return [];
    }
}

/**
 * Get episodes affecting a specific target entity/block/note.
 */
export function getEpisodesByTarget(
    targetId: string,
    limit: number = 50
): Episode[] {
    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.getEpisodesByTarget, {
            target_id: targetId,
            limit,
        });
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            console.error('[EpisodeLogService] Query failed:', result.message);
            return [];
        }
        return (result.rows || []).map(mapRowToEpisode);
    } catch (err) {
        console.error('[EpisodeLogService] Failed to get episodes by target:', err);
        return [];
    }
}

/**
 * Get episodes of a specific action type.
 */
export function getEpisodesByAction(
    actionType: EpisodeActionType,
    limit: number = 50
): Episode[] {
    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.getEpisodesByAction, {
            action_type: actionType,
            limit,
        });
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            console.error('[EpisodeLogService] Query failed:', result.message);
            return [];
        }
        return (result.rows || []).map(mapRowToEpisode);
    } catch (err) {
        console.error('[EpisodeLogService] Failed to get episodes by action:', err);
        return [];
    }
}

/**
 * Get episodes in a time range.
 */
export function getEpisodesInRange(
    startTs: number,
    endTs: number,
    limit: number = 100
): Episode[] {
    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.getEpisodesInRange, {
            start_ts: startTs,
            end_ts: endTs,
            limit,
        });
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            console.error('[EpisodeLogService] Query failed:', result.message);
            return [];
        }
        return (result.rows || []).map(mapRowToEpisode);
    } catch (err) {
        console.error('[EpisodeLogService] Failed to get episodes in range:', err);
        return [];
    }
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Get timeline of actions for an entity (for fact sheet history).
 */
export function getEntityTimeline(entityId: string, limit: number = 20): Episode[] {
    return getEpisodesByTarget(entityId, limit);
}

/**
 * Check if the LLM would have known about an entity at a given time.
 */
export function entityExistedAt(entityId: string, atTime: number): boolean {
    const episodes = getEpisodesByTarget(entityId);

    // Find creation and deletion events
    const creationEvent = episodes.find(e => e.actionType === 'created_entity');
    const deletionEvent = episodes.find(e => e.actionType === 'deleted_entity');

    if (!creationEvent) return false;
    if (creationEvent.ts > atTime) return false;
    if (deletionEvent && deletionEvent.ts <= atTime) return false;

    return true;
}

/**
 * Get the state of an entity at a specific point in time.
 * Reconstructs state by replaying episodes up to the given timestamp.
 */
export function getEntityStateAt(entityId: string, atTime: number): Record<string, unknown> | null {
    const episodes = getEpisodesByTarget(entityId)
        .filter(e => e.ts <= atTime)
        .sort((a, b) => a.ts - b.ts);

    if (episodes.length === 0) return null;

    // Start with empty state and apply changes
    let state: Record<string, unknown> = {};

    for (const ep of episodes) {
        if (ep.actionType === 'created_entity') {
            state = { ...state, ...((ep.payload.newValue as Record<string, unknown>) || {}) };
        } else if (ep.actionType === 'renamed_entity') {
            state['name'] = ep.payload.newValue;
        } else if (ep.actionType === 'merged_entity') {
            // Merge preserves the target entity's state
            state = { ...state, merged: true, mergedFrom: ep.payload.metadata };
        } else if (ep.actionType === 'deleted_entity') {
            return null; // Entity was deleted before this time
        }
    }

    return state;
}
