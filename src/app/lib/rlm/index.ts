/**
 * Recursive Language Model (RLM) Module
 *
 * Graph-native RLM implementation using CozoDB for recursive reasoning.
 * Key insight: Recursion works better in a graph - Datalog's fixed-point
 * semantics handle recursive queries naturally.
 *
 * Architecture:
 * - Workspace (ws_*) - isolated namespace for model experimentation
 * - Query Runner - two-lane execution (RO/WS) with validation
 * - Retrieval - FTS, vector, and graph expansion building blocks
 * - RLM Loop - observe/plan/execute/evaluate cycle
 */

// Schema exports
export {
    // Types
    type WsSession,
    type WsNodeKind,
    type WsNode,
    type WsEdgeRel,
    type WsEdge,
    type WsViewCache,
    type WsMetric,
    // Schema DDL
    WS_SESSION_SCHEMA,
    WS_NODE_SCHEMA,
    WS_EDGE_SCHEMA,
    WS_VIEW_CACHE_SCHEMA,
    WS_METRIC_SCHEMA,
    // Queries
    WS_QUERIES,
    // Schema list
    WS_SCHEMAS,
    WS_RELATIONS,
} from './schema/workspace-schema';

// Validator exports
export {
    // Types
    type ValidationResult,
    type QueryCaps,
    DEFAULT_RO_CAPS,
    DEFAULT_WS_CAPS,
    // Validators
    validateRO,
    validateWS,
    validateAuto,
    detectMutations,
    extractMutationTargets,
    isIndexedQuery,
    hasLimitClause,
    isSafeScript,
} from './validators/query-validator';

// Query Runner exports
export {
    // Types
    type QueryResult,
    type RunOptions,
    // Service
    QueryRunnerService,
    // Standalone functions
    runRO,
    runWS,
} from './services/query-runner.service';

// Workspace Ops exports
export {
    // Types
    type OpResult,
    type CreateNodePayload,
    type UpdateNodePayload,
    type LinkPayload,
    type SnapshotViewPayload,
    type StoreQueryPayload,
    type StoreResultPayload,
    type SpawnTaskPayload,
    type WorkspaceOpType,
    // Service
    WorkspaceOpsService,
    // Standalone functions
    createNode,
    link,
    storeQuery,
} from './services/workspace-ops.service';

// RLM Loop exports
export {
    // Types
    type RLMContext,
    type RLMStepType,
    type RLMStepResult,
    type ObservationResult,
    type ReasoningPlan,
    type PlanStep,
    type ExecutionResult,
    type EvaluationResult,
    type RLMLoopResult,
    type RLMLoopOptions,
    // Service
    RlmLoopService,
    // Standalone function
    // Standalone function
    runRLMLoop,
} from './services/rlm-loop.service';

// Context Formatting exports
export {
    formatRlmContext,
    RLM_CONTEXT_VERSION,
} from './services/rlm-context';

// Retrieval exports
export {
    // Types
    type BlockSearchResult,
    type NoteSearchResult,
    type WsNodeJsonResult,
    type EpisodePayloadResult,
    type FolderMetadataResult,
    // Service
    RetrievalService,
} from './services/retrieval.service';

// RLM LLM Provider exports
export {
    RlmLlmService,
} from './services/rlm-llm.service';

// App Context exports (live application state for RLM grounding)
export {
    type AppContext,
    type EntitySnapshot,
} from './services/app-context';

export {
    AppContextProviderService,
} from './services/app-context-provider.service';
