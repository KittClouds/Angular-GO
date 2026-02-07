/**
 * LLM Memory Module
 * 
 * Public API for the Layer 4 LLM memory system.
 * 
 * Key concepts:
 * - Episodes: Append-only action stream for temporal reasoning
 * - Blocks: Text chunks with HNSW vectors for semantic search
 * - Scope modes: local_only, bubble_up, global_fallback
 */

// Schema & Types
export {
    // Types
    type ScopeMode,
    type Episode,
    type EpisodeActionType,
    type EpisodeTargetKind,
    type EpisodePayload,
    type Block,
    type BlockMatch,
    type EntityMatch,
    type EpisodeMatch,
    type RecallRequest,
    type RecallResult,

    // Schema (for initialization)
    EPISODE_LOG_SCHEMA,
    BLOCKS_SCHEMA,
    BLOCKS_HNSW_384,

    // Queries (for advanced usage)
    MEMORY_QUERIES,

    // Mappers
    mapRowToEpisode,
    mapRowToBlock,
    mapRowToBlockMatch,
} from '../schema/layer4-memory';

// Episode Service
export {
    logEpisode,
    recordAction,
    getEpisodes,
    getEpisodesByTarget,
    getEpisodesByAction,
    getEpisodesInRange,
    getEntityTimeline,
    entityExistedAt,
    getEntityStateAt,
} from './EpisodeLogService';

// Recall Service
export {
    recall,
    searchBlocks,
    searchBlocksGlobal,
    upsertBlock,
    upsertBlocks,
    getBlocksByNote,
    deleteBlocksByNote,
    getMemoryStats,
} from './MemoryRecallService';
