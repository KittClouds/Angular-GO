/**
 * Workspace Schema for Recursive Language Model (RLM)
 *
 * Provides isolated namespace for model experimentation without polluting canonical data.
 * All workspace relations use the `ws_` prefix and are keyed by `workspace_id`.
 *
 * Key Design Decisions:
 * - Workspace as first-class subgraph
 * - Multiple concurrent reasoning sessions via workspace_id isolation
 * - Model-writable scratchpad for queries, claims, and reasoning chains
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Workspace session - one per reasoning episode
 */
export interface WsSession {
    workspace_id: string;
    world_id: string;
    created_at: number;
    meta: Record<string, unknown>;
}

/**
 * Node kinds for workspace nodes
 */
export type WsNodeKind =
    | 'prompt'    // Long context storage
    | 'thread'    // Conversation thread reference
    | 'claim'     // Extracted assertion
    | 'span'      // Temporal segment
    | 'plan'      // Reasoning plan
    | 'query'     // Cozo query script
    | 'result'    // Query result
    | 'draft'     // Working output
    | 'task';     // Recursive task spawn

/**
 * Workspace node - the model's working memory
 */
export interface WsNode {
    workspace_id: string;
    node_id: string;
    kind: WsNodeKind;
    json: Record<string, unknown>;
    created_at: number;
    updated_at: number;
}

/**
 * Edge relationship types
 */
export type WsEdgeRel =
    | 'produced'      // Query → Result
    | 'refines'       // Draft → Draft (new version)
    | 'contradicts'   // Claim → Claim (conflict)
    | 'supports'      // Result → Claim (evidence)
    | 'derives'       // Claim → Draft (inclusion)
    | 'references'    // Node → Entity (canonical)
    | 'spawned';      // Task → Task (recursion)

/**
 * Workspace edge - relationships between nodes
 */
export interface WsEdge {
    workspace_id: string;
    from_id: string;
    to_id: string;
    rel: WsEdgeRel;
    meta: Record<string, unknown>;
    created_at: number;
}

/**
 * Materialized view cache
 */
export interface WsViewCache {
    workspace_id: string;
    view_id: string;
    json: Record<string, unknown>;
    created_at: number;
    updated_at: number;
}

/**
 * Workspace metric for performance tracking
 */
export interface WsMetric {
    workspace_id: string;
    key: string;
    value: Record<string, unknown>;
    ts: number;
}

// ============================================================================
// Schema Definitions (CozoScript DDL)
// ============================================================================

/**
 * Session metadata - one per reasoning episode
 */
export const WS_SESSION_SCHEMA = `
:create ws_session {
    workspace_id: String =>
    world_id: String,
    created_at: Float,
    meta: Json default {}
}
`;

/**
 * Nodes - the model's working memory
 * Key: (workspace_id, node_id) for isolation
 */
export const WS_NODE_SCHEMA = `
:create ws_node {
    workspace_id: String,
    node_id: String =>
    kind: String,
    json: Json default {},
    created_at: Float,
    updated_at: Float
}
`;

/**
 * Edges - relationships between workspace nodes
 * Key: (workspace_id, from_id, to_id, rel) for unique relationships
 */
export const WS_EDGE_SCHEMA = `
:create ws_edge {
    workspace_id: String,
    from_id: String,
    to_id: String,
    rel: String =>
    meta: Json default {},
    created_at: Float
}
`;

/**
 * Materialized view cache - stored query results
 */
export const WS_VIEW_CACHE_SCHEMA = `
:create ws_view_cache {
    workspace_id: String,
    view_id: String =>
    json: Json,
    created_at: Float,
    updated_at: Float
}
`;

/**
 * Metrics - performance tracking for queries and operations
 */
export const WS_METRIC_SCHEMA = `
:create ws_metric {
    workspace_id: String,
    key: String =>
    value: Json,
    ts: Float
}
`;

// ============================================================================
// Query Collection
// ============================================================================

/**
 * Workspace queries for common operations
 */
export const WS_QUERIES = {
    // Session operations
    createSession: `
        ?[workspace_id, world_id, created_at, meta] <- [[$workspace_id, $world_id, $created_at, $meta]]
        :put ws_session {workspace_id}
    `,

    getSession: `
        ?[workspace_id, world_id, created_at, meta] :=
            *ws_session{workspace_id, world_id, created_at, meta},
            workspace_id == $workspace_id
    `,

    deleteSession: `
        ?[workspace_id] := *ws_session{workspace_id}, workspace_id == $workspace_id
        :rm ws_session {workspace_id}
    `,

    // Node operations
    createNode: `
        ?[workspace_id, node_id, kind, json, created_at, updated_at] <- [[
            $workspace_id, $node_id, $kind, $json, $created_at, $updated_at
        ]]
        :put ws_node {workspace_id, node_id}
    `,

    getNode: `
        ?[node_id, kind, json, created_at, updated_at] :=
            *ws_node{workspace_id, node_id, kind, json, created_at, updated_at},
            workspace_id == $workspace_id,
            node_id == $node_id
    `,

    getNodesByKind: `
        ?[node_id, kind, json, created_at, updated_at] :=
            *ws_node{workspace_id, node_id, kind, json, created_at, updated_at},
            workspace_id == $workspace_id,
            kind == $kind
        :order created_at
    `,

    updateNodeJson: `
        ?[workspace_id, node_id, kind, json, created_at, updated_at] <- [[
            $workspace_id, $node_id, $kind, $json, $created_at, $updated_at
        ]]
        :put ws_node {workspace_id, node_id}
    `,

    deleteNode: `
        ?[workspace_id, node_id] := *ws_node{workspace_id, node_id}, 
            workspace_id == $workspace_id, node_id == $node_id
        :rm ws_node {workspace_id, node_id}
    `,

    // Edge operations
    createEdge: `
        ?[workspace_id, from_id, to_id, rel, meta, created_at] <- [[
            $workspace_id, $from_id, $to_id, $rel, $meta, $created_at
        ]]
        :put ws_edge {workspace_id, from_id, to_id, rel}
    `,

    getEdgesFrom: `
        ?[to_id, rel, meta, created_at] :=
            *ws_edge{workspace_id, from_id, to_id, rel, meta, created_at},
            workspace_id == $workspace_id,
            from_id == $from_id
    `,

    getEdgesTo: `
        ?[from_id, rel, meta, created_at] :=
            *ws_edge{workspace_id, from_id, to_id, rel, meta, created_at},
            workspace_id == $workspace_id,
            to_id == $to_id
    `,

    deleteEdge: `
        ?[workspace_id, from_id, to_id, rel] := *ws_edge{workspace_id, from_id, to_id, rel},
            workspace_id == $workspace_id, from_id == $from_id, to_id == $to_id, rel == $rel
        :rm ws_edge {workspace_id, from_id, to_id, rel}
    `,

    // View cache operations
    createView: `
        ?[workspace_id, view_id, json, created_at, updated_at] <- [[
            $workspace_id, $view_id, $json, $created_at, $updated_at
        ]]
        :put ws_view_cache {workspace_id, view_id}
    `,

    getView: `
        ?[view_id, json, created_at, updated_at] :=
            *ws_view_cache{workspace_id, view_id, json, created_at, updated_at},
            workspace_id == $workspace_id,
            view_id == $view_id
    `,

    // Metric operations
    recordMetric: `
        ?[workspace_id, key, value, ts] <- [[$workspace_id, $key, $value, $ts]]
        :put ws_metric {workspace_id, key}
    `,

    getMetrics: `
        ?[key, value, ts] :=
            *ws_metric{workspace_id, key, value, ts},
            workspace_id == $workspace_id
        :order -ts
        :limit 100
    `,

    // Cleanup - delete all workspace data
    deleteWorkspaceData: `
        # Delete all nodes
        ?[workspace_id, node_id] := *ws_node{workspace_id, node_id}, workspace_id == $workspace_id
        :rm ws_node {workspace_id, node_id}
        
        # Delete all edges
        ?[workspace_id, from_id, to_id, rel] := *ws_edge{workspace_id, from_id, to_id, rel}, workspace_id == $workspace_id
        :rm ws_edge {workspace_id, from_id, to_id, rel}
        
        # Delete all views
        ?[workspace_id, view_id] := *ws_view_cache{workspace_id, view_id}, workspace_id == $workspace_id
        :rm ws_view_cache {workspace_id, view_id}
        
        # Delete all metrics
        ?[workspace_id, key] := *ws_metric{workspace_id, key}, workspace_id == $workspace_id
        :rm ws_metric {workspace_id, key}
    `,

    // Stats
    getWorkspaceStats: `
        node_count[count] := count = count(*ws_node{workspace_id}), workspace_id == $workspace_id
        edge_count[count] := count = count(*ws_edge{workspace_id}), workspace_id == $workspace_id
        view_count[count] := count = count(*ws_view_cache{workspace_id}), workspace_id == $workspace_id
        
        ?[nodes, edges, views] := node_count[nodes], edge_count[edges], view_count[views]
    `,
};

// ============================================================================
// Schema List for Initialization
// ============================================================================

/**
 * All workspace schemas for bulk creation
 */
export const WS_SCHEMAS = [
    WS_SESSION_SCHEMA,
    WS_NODE_SCHEMA,
    WS_EDGE_SCHEMA,
    WS_VIEW_CACHE_SCHEMA,
    WS_METRIC_SCHEMA,
];

/**
 * Relation names for export/import
 */
export const WS_RELATIONS = [
    'ws_session',
    'ws_node',
    'ws_edge',
    'ws_view_cache',
    'ws_metric',
];
