/**
 * Layer 4: LLM Memory Schema
 * 
 * Provides scoped recall and episode logging for LLM memory integration.
 * 
 * Key relations:
 * - episode_log: Append-only action stream for temporal reasoning
 * - blocks: Text chunks with HNSW vectors for semantic search
 */

// Import ScopeMode for local use and re-export it
import { ScopeMode } from '../types';
export type { ScopeMode };

// ============================================================================
// Types
// ============================================================================


export interface Episode {
    scopeId: string;
    noteId: string;
    ts: number;
    actionType: EpisodeActionType;
    targetId: string;
    targetKind: EpisodeTargetKind;
    payload: EpisodePayload;
    narrativeId: string;
}

export type EpisodeActionType =
    | 'created_entity'
    | 'renamed_entity'
    | 'merged_entity'
    | 'deleted_entity'
    | 'created_block'
    | 'edited_block'
    | 'deleted_block'
    | 'moved_note'
    | 'created_note'
    | 'deleted_note'
    | 'created_relationship'
    | 'deleted_relationship'
    // RLM (Recursive Language Model) action types
    | 'rlm_query_executed'      // Model ran a Cozo query
    | 'rlm_workspace_mutation'  // Model modified workspace
    | 'rlm_step'                // Reasoning step completed
    | 'rlm_claim_extracted'     // New claim from reasoning
    | 'rlm_contradiction_found' // Contradiction detected
    | 'rlm_plan_created'        // New reasoning plan
    | 'rlm_plan_completed'      // Plan finished
    // RLM Workspace Ops action types
    | 'rlm_create_node'         // Workspace node created
    | 'rlm_update_node'         // Workspace node updated
    | 'rlm_delete_node'         // Workspace node deleted
    | 'rlm_link'                // Workspace edge created
    | 'rlm_unlink'              // Workspace edge deleted
    | 'rlm_snapshot_view'       // View cached
    | 'rlm_get_view'            // View retrieved
    | 'rlm_store_query'         // Query node stored
    | 'rlm_store_result'        // Result node stored
    | 'rlm_spawn_task'         // Task node spawned
    | 'fts_search';             // FTS search executed

export type EpisodeTargetKind = 'entity' | 'block' | 'note' | 'folder' | 'relationship' | 'workspace' | 'node' | 'workspace_node' | 'search';

export interface EpisodePayload {
    oldValue?: unknown;
    newValue?: unknown;
    context?: string;
    metadata?: Record<string, unknown>;
}

// ============================================================================
// RLM-Specific Payload Types
// ============================================================================

/**
 * Payload for rlm_query_executed episodes
 */
export interface RLMQueryExecutedPayload {
    workspace_id: string;
    query_node_id: string;
    script: string;
    lat_ms: number;
    rows: number;
    truncated: boolean;
    error?: string;
}

/**
 * Payload for rlm_workspace_mutation episodes
 */
export interface RLMWorkspaceMutationPayload {
    workspace_id: string;
    ops: Array<{
        op: string;
        payload: Record<string, unknown>;
    }>;
    affected: string[];  // node_ids touched
}

/**
 * Payload for rlm_step episodes
 */
export interface RLMStepPayload {
    prompt_ref: string;       // ws_node id of prompt
    view_id: string;          // ws_view_cache id
    model_output_ref: string; // ws_node id of output
    reasoning: string;        // Model's reasoning trace
}

/**
 * Payload for rlm_claim_extracted episodes
 */
export interface RLMClaimExtractedPayload {
    workspace_id: string;
    claim_node_id: string;
    text: string;
    confidence: number;
    source_ids: string[];
}

/**
 * Payload for rlm_contradiction_found episodes
 */
export interface RLMContradictionFoundPayload {
    workspace_id: string;
    claim_a_id: string;
    claim_b_id: string;
    conflict_type: string;
}

/**
 * Payload for rlm_plan_created/rlm_plan_completed episodes
 */
export interface RLMPlanPayload {
    workspace_id: string;
    plan_node_id: string;
    steps: string[];
    current_step?: number;
    status: 'created' | 'in_progress' | 'completed' | 'failed';
}

export interface Block {
    blockId: string;
    noteId: string;
    ord: number;
    text: string;
    textVec?: number[];
    narrativeId: string;
    createdAt: number;
}

export interface BlockMatch {
    blockId: string;
    noteId: string;
    text: string;
    distance: number;
    ord: number;
}

export interface EntityMatch {
    entityId: string;
    name: string;
    kind: string;
    distance: number;
    mentionCount?: number;
}

export interface EpisodeMatch {
    scopeId: string;
    noteId: string;
    ts: number;
    actionType: EpisodeActionType;
    targetId: string;
    payload: EpisodePayload;
}

export interface RecallRequest {
    scopeId: string;
    scopeMode: ScopeMode;
    query?: string;
    queryVector?: number[];
    k?: number;
    filters?: {
        entityKinds?: string[];
        actionTypes?: EpisodeActionType[];
        dateRange?: { start: number; end: number };
    };
}

export interface RecallResult {
    blocks: BlockMatch[];
    entities: EntityMatch[];
    episodes: EpisodeMatch[];
}

// Chat message type for AI panel
export interface ChatMessage {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: number;
    narrativeId?: string;
    metadata?: Record<string, unknown>;
}

// ============================================================================
// Schema Definitions
// ============================================================================

// NOTE: chat_messages schema removed - now using Go/SQLite via GoChatService

/**
 * Episode log: Append-only action stream for temporal reasoning.
 * Enables "what did the LLM know at time T?" queries.
 * 
 * Key: (scope_id, note_id, ts) - compound for efficient range queries
 */
export const EPISODE_LOG_SCHEMA = `
:create episode_log {
    scope_id: String,
    note_id: String,
    ts: Float
    =>
    action_type: String,
    target_id: String,
    target_kind: String,
    payload: Json,
    narrative_id: String
}
`;

/**
 * Block-level text chunks with vectors for semantic search.
 * Complements RAPTOR by providing fine-grained LLM memory access.
 * 
 * Note: dimension field is required for HNSW index filtering.
 * Default dimension is 384 (Matryoshka-compatible).
 */
export const BLOCKS_SCHEMA = `
:create blocks {
    block_id: String
    =>
    note_id: String,
    ord: Int,
    text: String,
    dimension: Int default 384,
    text_vec: [Float],
    narrative_id: String,
    created_at: Float
}
`;

/**
 * HNSW index for block vectors (384d - Matryoshka compatible)
 * Uses filter clause to match only 384-dimension vectors.
 */
export const BLOCKS_HNSW_384 = `
::hnsw create blocks:semantic_idx_384 {
    dim: 384,
    m: 32,
    dtype: F32,
    fields: [text_vec],
    distance: Cosine,
    ef_construction: 200,
    filter: dimension == 384
}
`;

/**
 * FTS index for blocks text.
 * Enables keyword search over memory blocks.
 */
export const BLOCKS_FTS_SCHEMA = `
::fts create blocks:fts_idx {
    extractor: text,
    tokenizer: default,
    filter: default
}
`;

// ============================================================================
// Queries
// ============================================================================

export const MEMORY_QUERIES = {
    // --- Episode Log ---

    /** Log an episode (append-only) */
    logEpisode: `
        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload, narrative_id] <- 
            [[$scope_id, $note_id, $ts, $action_type, $target_id, $target_kind, $payload, $narrative_id]]
        :put episode_log {
            scope_id, note_id, ts => action_type, target_id, target_kind, payload, narrative_id
        }
    `,

    /** Get episodes for a scope (local only) */
    getEpisodesLocal: `
        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload] :=
            *episode_log{scope_id, note_id, ts, action_type, target_id, target_kind, payload},
            scope_id == $scope_id
        :order -ts
        :limit $limit
    `,

    /** Get episodes with bubble-up (includes ancestor scopes) */
    getEpisodesBubbleUp: `
        # Build scope closure from folder hierarchy
        scope_closure[sid] <- [[$scope_id]]
        scope_closure[parent_id] :=
            scope_closure[child_id],
            *folder_hierarchy{parent_id, child_id, invalid_at},
            is_null(invalid_at)

        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload] :=
            scope_closure[scope_id],
            *episode_log{scope_id, note_id, ts, action_type, target_id, target_kind, payload}
        :order -ts
        :limit $limit
    `,

    /** Get episodes by action type */
    getEpisodesByAction: `
        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload] :=
            *episode_log{scope_id, note_id, ts, action_type, target_id, target_kind, payload},
            action_type == $action_type
        :order -ts
        :limit $limit
    `,

    /** Get episodes affecting a specific target */
    getEpisodesByTarget: `
        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload] :=
            *episode_log{scope_id, note_id, ts, action_type, target_id, target_kind, payload},
            target_id == $target_id
        :order -ts
        :limit $limit
    `,

    /** Get episodes in time range */
    getEpisodesInRange: `
        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload] :=
            *episode_log{scope_id, note_id, ts, action_type, target_id, target_kind, payload},
            ts >= $start_ts,
            ts <= $end_ts
        :order -ts
        :limit $limit
    `,

    // --- Blocks ---

    /** Upsert a block (dimension defaults to 384) */
    upsertBlock: `
        ?[block_id, note_id, ord, text, dimension, text_vec, narrative_id, created_at] <-
            [[$block_id, $note_id, $ord, $text, 384, $text_vec, $narrative_id, $created_at]]
        :put blocks {
            block_id => note_id, ord, text, dimension, text_vec, narrative_id, created_at
        }
    `,

    /** Batch upsert blocks (dimension defaults to 384) */
    upsertBlocksBatch: `
        ?[block_id, note_id, ord, text, dimension, text_vec, narrative_id, created_at] <- $blocks
        :put blocks {
            block_id => note_id, ord, text, dimension, text_vec, narrative_id, created_at
        }
    `,

    /** Get blocks for a note */
    getBlocksByNote: `
        ?[block_id, ord, text, narrative_id] :=
            *blocks{block_id, note_id, ord, text, narrative_id},
            note_id == $note_id
        :order ord
    `,

    /** Delete blocks for a note */
    deleteBlocksByNote: `
        ?[block_id] :=
            *blocks{block_id, note_id},
            note_id == $note_id
        :rm blocks {block_id}
    `,

    /** Search blocks by vector (local scope) */
    searchBlocksLocal: `
        ?[block_id, distance, note_id, ord, text] :=
            ~blocks:semantic_idx_384{ block_id | query: $query_vector, k: $k, ef: $ef },
            *blocks{block_id, note_id, ord, text, narrative_id},
            narrative_id == $narrative_id
    `,

    /** Search blocks with bubble-up scope */
    searchBlocksBubbleUp: `
        # Build scope closure
        scope_closure[nid] <- [[$narrative_id]]
        scope_closure[parent_nid] :=
            scope_closure[child_nid],
            *folder_hierarchy{parent_id: parent_nid, child_id: child_nid, invalid_at},
            is_null(invalid_at)

        ?[block_id, distance, note_id, ord, text] :=
            ~blocks:semantic_idx_384{ block_id | query: $query_vector, k: $k, ef: $ef },
            *blocks{block_id, note_id, ord, text, narrative_id},
            scope_closure[narrative_id]
    `,

    /** Search blocks globally */
    searchBlocksGlobal: `
        ?[block_id, distance, note_id, ord, text] :=
            ~blocks:semantic_idx_384{ block_id | query: $query_vector, k: $k, ef: $ef },
            *blocks{block_id, note_id, ord, text}
    `,

    // --- Stats ---

    /** Get memory layer statistics */
    getMemoryStats: `
        episode_count[cnt] := cnt = count(ts), *episode_log{ts}
        block_count[cnt] := cnt = count(block_id), *blocks{block_id}
        
        ?[episodes, blocks] :=
            episode_count[episodes],
            block_count[blocks]
    `,
};

// ============================================================================
// Mappers
// ============================================================================

export function mapRowToEpisode(row: unknown[]): Episode {
    return {
        scopeId: row[0] as string,
        noteId: row[1] as string,
        ts: row[2] as number,
        actionType: row[3] as EpisodeActionType,
        targetId: row[4] as string,
        targetKind: row[5] as EpisodeTargetKind,
        payload: row[6] as EpisodePayload,
        narrativeId: row[7] as string,
    };
}

export function mapRowToBlock(row: unknown[]): Block {
    return {
        blockId: row[0] as string,
        noteId: row[1] as string,
        ord: row[2] as number,
        text: row[3] as string,
        textVec: row[4] as number[] | undefined,
        narrativeId: row[5] as string,
        createdAt: row[6] as number,
    };
}

export function mapRowToBlockMatch(row: unknown[]): BlockMatch {
    return {
        blockId: row[0] as string,
        distance: row[1] as number,
        noteId: row[2] as string,
        ord: row[3] as number,
        text: row[4] as string,
    };
}
