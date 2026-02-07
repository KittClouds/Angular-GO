/**
 * Memory Recall Service
 * 
 * Scoped semantic search for LLM memory integration.
 * Supports local_only, bubble_up, and global_fallback scope modes.
 */

import { cozoDb } from '../db';
import {
    RecallRequest,
    RecallResult,
    BlockMatch,
    EntityMatch,
    EpisodeMatch,
    Block,
    MEMORY_QUERIES,
    mapRowToBlockMatch,
} from '../schema/layer4-memory';
import { ScopeMode, buildScopeClosureRule } from '../types';

// ============================================================================
// Recall API
// ============================================================================

/**
 * Main recall function for LLM memory retrieval.
 * Takes a scope and mode, returns relevant blocks, entities, and episodes.
 */
export async function recall(request: RecallRequest): Promise<RecallResult> {
    const {
        scopeId,
        scopeMode,
        queryVector,
        k = 10,
        filters,
    } = request;

    const result: RecallResult = {
        blocks: [],
        entities: [],
        episodes: [],
    };

    // If no query vector, we can't do semantic search
    if (!queryVector || queryVector.length === 0) {
        console.warn('[MemoryRecallService] No query vector provided');
        return result;
    }

    // Search blocks based on scope mode
    result.blocks = searchBlocks(scopeId, scopeMode, queryVector, k);

    // If global_fallback and no local results, search globally
    if (scopeMode === 'global_fallback' && result.blocks.length === 0) {
        result.blocks = searchBlocksGlobal(queryVector, k);
    }

    // Expand to nearby entities mentioned in the matched blocks
    if (result.blocks.length > 0) {
        const noteIds = [...new Set(result.blocks.map(b => b.noteId))];
        result.entities = getEntitiesInNotes(noteIds, filters?.entityKinds);
    }

    return result;
}

// ============================================================================
// Block Operations
// ============================================================================

/**
 * Search blocks by vector with scope filtering.
 */
export function searchBlocks(
    narrativeId: string,
    mode: ScopeMode,
    queryVector: number[],
    k: number = 10,
    ef: number = 100
): BlockMatch[] {
    const query = mode === 'bubble_up'
        ? MEMORY_QUERIES.searchBlocksBubbleUp
        : MEMORY_QUERIES.searchBlocksLocal;

    try {
        const resultStr = cozoDb.run(query, {
            narrative_id: narrativeId,
            query_vector: queryVector,
            k,
            ef,
        });
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            console.error('[MemoryRecallService] Block search failed:', result.message);
            return [];
        }
        return (result.rows || []).map(mapRowToBlockMatch);
    } catch (err) {
        console.error('[MemoryRecallService] Block search error:', err);
        return [];
    }
}

/**
 * Search blocks globally (no scope filtering).
 */
export function searchBlocksGlobal(
    queryVector: number[],
    k: number = 10,
    ef: number = 100
): BlockMatch[] {
    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.searchBlocksGlobal, {
            query_vector: queryVector,
            k,
            ef,
        });
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            console.error('[MemoryRecallService] Global block search failed:', result.message);
            return [];
        }
        return (result.rows || []).map(mapRowToBlockMatch);
    } catch (err) {
        console.error('[MemoryRecallService] Global block search error:', err);
        return [];
    }
}

/**
 * Upsert a single block.
 */
export function upsertBlock(block: Block): boolean {
    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.upsertBlock, {
            block_id: block.blockId,
            note_id: block.noteId,
            ord: block.ord,
            text: block.text,
            text_vec: block.textVec || [],
            narrative_id: block.narrativeId,
            created_at: block.createdAt,
        });
        const result = JSON.parse(resultStr);
        return result.ok !== false;
    } catch (err) {
        console.error('[MemoryRecallService] Block upsert error:', err);
        return false;
    }
}

/**
 * Upsert multiple blocks in a batch.
 * Note: dimension is hardcoded to 384 for Matryoshka compatibility.
 */
export function upsertBlocks(blocks: Block[]): boolean {
    if (blocks.length === 0) return true;

    // Include dimension (384) in the data for HNSW index compatibility
    const blockData = blocks.map(b => [
        b.blockId,
        b.noteId,
        b.ord,
        b.text,
        384, // dimension for HNSW filtering
        b.textVec || [],
        b.narrativeId,
        b.createdAt,
    ]);

    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.upsertBlocksBatch, {
            blocks: blockData,
        });
        const result = JSON.parse(resultStr);
        return result.ok !== false;
    } catch (err) {
        console.error('[MemoryRecallService] Batch block upsert error:', err);
        return false;
    }
}

/**
 * Get all blocks for a note.
 */
export function getBlocksByNote(noteId: string): Block[] {
    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.getBlocksByNote, {
            note_id: noteId,
        });
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            console.error('[MemoryRecallService] Get blocks failed:', result.message);
            return [];
        }
        return (result.rows || []).map((row: unknown[]) => ({
            blockId: row[0] as string,
            ord: row[1] as number,
            text: row[2] as string,
            narrativeId: row[3] as string,
            noteId,
            createdAt: Date.now(),
        }));
    } catch (err) {
        console.error('[MemoryRecallService] Get blocks error:', err);
        return [];
    }
}

/**
 * Delete all blocks for a note (before re-chunking).
 */
export function deleteBlocksByNote(noteId: string): boolean {
    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.deleteBlocksByNote, {
            note_id: noteId,
        });
        const result = JSON.parse(resultStr);
        return result.ok !== false;
    } catch (err) {
        console.error('[MemoryRecallService] Delete blocks error:', err);
        return false;
    }
}

// ============================================================================
// Entity Expansion
// ============================================================================

/**
 * Get entities mentioned in a set of notes.
 * Used for expanding block search results to related entities.
 */
function getEntitiesInNotes(noteIds: string[], kindFilter?: string[]): EntityMatch[] {
    if (noteIds.length === 0) return [];

    const noteIdList = noteIds.map(id => `"${id}"`).join(', ');
    const kindClause = kindFilter && kindFilter.length > 0
        ? `, kind in [${kindFilter.map(k => `"${k}"`).join(', ')}]`
        : '';

    const query = `
        note_ids[nid] <- [[${noteIdList}]]
        
        ?[entity_id, name, kind, mention_count] :=
            note_ids[note_id],
            *entity_mentions{entity_id, note_id, mention_count},
            *entities{id: entity_id, label: name, kind}
            ${kindClause}
        :order -mention_count
        :limit 20
    `;

    try {
        const resultStr = cozoDb.run(query);
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            console.error('[MemoryRecallService] Entity expansion failed:', result.message);
            return [];
        }
        return (result.rows || []).map((row: unknown[]) => ({
            entityId: row[0] as string,
            name: row[1] as string,
            kind: row[2] as string,
            distance: 0, // Not from vector search
            mentionCount: row[3] as number,
        }));
    } catch (err) {
        console.error('[MemoryRecallService] Entity expansion error:', err);
        return [];
    }
}

// ============================================================================
// Memory Stats
// ============================================================================

/**
 * Get statistics about the memory layer.
 */
export function getMemoryStats(): { episodes: number; blocks: number } {
    try {
        const resultStr = cozoDb.run(MEMORY_QUERIES.getMemoryStats);
        const result = JSON.parse(resultStr);
        if (result.ok === false || !result.rows || result.rows.length === 0) {
            return { episodes: 0, blocks: 0 };
        }
        return {
            episodes: result.rows[0][0] as number,
            blocks: result.rows[0][1] as number,
        };
    } catch (err) {
        console.error('[MemoryRecallService] Stats error:', err);
        return { episodes: 0, blocks: 0 };
    }
}
