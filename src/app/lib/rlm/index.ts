/**
 * RLM Module
 *
 * Simplified workspace-first architecture.
 * All CozoDB-dependent services removed. Logic now lives in Go (WASM).
 *
 * Public surface:
 * - RlmOrchestratorService: thin TS → WASM bridge (processWithWorkspace, getContext)
 * - RlmLlmService: LLM routing (unchanged)
 * - AppContextProviderService: live app state for prompt grounding (unchanged)
 * - Workspace schema types: kept for any legacy UI usage
 * - Validator utilities: safe to keep (pure TS, no DB deps)
 */

// ================================================================
// New orchestrator (replaces rlm-loop + query-runner + workspace-ops + retrieval)
// ================================================================
export {
    RlmOrchestratorService,
    type ActivationResult,
    type ToolCallResult,
} from './services/rlm-orchestrator.service';

// ================================================================
// Workspace schema types (UI / legacy read access)
// ================================================================
export {
    type WsSession,
    type WsNodeKind,
    type WsNode,
    type WsEdgeRel,
    type WsEdge,
    type WsViewCache,
    type WsMetric,
    WS_SESSION_SCHEMA,
    WS_NODE_SCHEMA,
    WS_EDGE_SCHEMA,
    WS_VIEW_CACHE_SCHEMA,
    WS_METRIC_SCHEMA,
    WS_QUERIES,
    WS_SCHEMAS,
    WS_RELATIONS,
} from './schema/workspace-schema';

// ================================================================
// Validator utilities (pure TS, no DB deps — safe to keep)
// ================================================================
export {
    type ValidationResult,
    type QueryCaps,
    DEFAULT_RO_CAPS,
    DEFAULT_WS_CAPS,
    validateRO,
    validateWS,
    validateAuto,
    detectMutations,
    extractMutationTargets,
    isIndexedQuery,
    hasLimitClause,
    isSafeScript,
} from './validators/query-validator';

// ================================================================
// Context formatting
// ================================================================
export {
    formatRlmContext,
    RLM_CONTEXT_VERSION,
} from './services/rlm-context';

// ================================================================
// LLM routing
// ================================================================
export {
    RlmLlmService,
} from './services/rlm-llm.service';

// ================================================================
// App context (live Angular state for RLM grounding)
// ================================================================
export {
    type AppContext,
    type EntitySnapshot,
} from './services/app-context';

export {
    AppContextProviderService,
} from './services/app-context-provider.service';
