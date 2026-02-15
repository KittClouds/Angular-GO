/**
 * RAPTOR Layer 3 Schema (Recursive Abstractive Processing for Tree-Organized Retrieval)
 * 
 * Implements the hierarchical tree structure for RAPTOR-style RAG.
 * 
 * Structure:
 * - Level 0: Leaf nodes (original text chunks)
 * - Level 1+: Cluster centroids (abstractive/extractive summaries)
 * 
 * Supports:
 * - Hierarchical traversal
 * - Collapsed retrieval (using HNSW)
 * - Tree management (children pointers)
 */

// ============================================================================
// Types
// ============================================================================

export interface RaptorNode {
    nodeId: string;
    narrativeId: string;    // Scope filter for vault/narrative
    level: number;
    embedding: Float32Array | number[];
    payload: RaptorPayload; // JSON string
    children: string[];     // List of child IDs
    createdAt: number;
}

export interface RaptorPayload {
    text: string;           // The representative text (chunk or centroid extractive summary)
    sourceId: string;       // Original note ID
    startIndex?: number;    // For leaves
    endIndex?: number;      // For leaves
    metadata?: Record<string, any>;
}

export interface RaptorConfig {
    treeId: string;
    rootNodes: string[];
    levels: number;
    isDirty: boolean;
    lastBuiltAt: number;
}

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Main storage for RAPTOR nodes (both leaves and internal clusters)
 */
export const RAPTOR_NODES_SCHEMA = `
:create raptor_nodes {
    node_id: String =>
    narrative_id: String,
    level: Int,
    embedding: <F32; 256>,
    payload: Json,
    children: [String],
    created_at: Float
}
`;

/**
 * Configuration/Meta table for the RAPTOR tree state
 */
export const RAPTOR_CONFIG_SCHEMA = `
:create raptor_config {
    tree_id: String =>
    root_nodes: [String],
    levels: Int,
    is_dirty: Bool,
    last_built_at: Float
}
`;

/**
 * HNSW Index for fast vector retrieval
 * Using 256d for MDBR Leaf model (default, fast).
 * We index ALL levels to support "Collapsed" retrieval mode.
 * We can filter by 'level' or 'narrative_id' for scoped/leaf-only queries.
 */
export const RAPTOR_HNSW_INDEX = `
::hnsw create raptor_nodes:idx {
    dim: 256,
    m: 32,
    dtype: F32,
    fields: [embedding],
    distance: Cosine,
    ef_construction: 200
}
`;

// ============================================================================
// Queries
// ============================================================================

export const RAPTOR_QUERIES = {
    // --- Node Operations ---

    /** Upsert a batch of nodes */
    upsertNodes: `
    ?[node_id, narrative_id, level, embedding, payload, children, created_at] <- $nodes
    :put raptor_nodes {
        node_id => narrative_id, level, embedding, payload, children, created_at
    }
    `,

    /** Get a node by ID */
    getNode: `
    ?[node_id, narrative_id, level, embedding, payload, children] :=
        *raptor_nodes{node_id, narrative_id, level, embedding, payload, children},
        node_id == $node_id
    `,

    /** Get all nodes at a specific level */
    getNodesByLevel: `
    ?[node_id, narrative_id, embedding, payload, children] :=
        *raptor_nodes{node_id, narrative_id, level, embedding, payload, children},
        level == $level
    `,

    /** Get all nodes for a narrative */
    getNodesByNarrative: `
    ?[node_id, level, embedding, payload, children] :=
        *raptor_nodes{node_id, narrative_id, level, embedding, payload, children},
        narrative_id == $narrative_id
    `,

    /** 
     * Get children of a set of parent nodes 
     * Useful for tree traversal
     */
    getChildren: `
    parent_ids[pid] <- $parent_ids
    
    ?[child_id, level, embedding, payload, children] :=
        parent_ids[pid],
        *raptor_nodes{node_id: pid, children: child_list},
        child_id in child_list,
        *raptor_nodes{node_id: child_id, level, embedding, payload, children}
    `,

    /** Delete all nodes (reset) */
    deleteAllNodes: `
    :rm raptor_nodes
    `,

    // --- Search ---

    /** 
     * HNSW Search (Collapsed Mode)
     * Search across ALL nodes regardless of level
     */
    searchCollapsed: `
    ?[node_id, distance, level, payload] := 
        ~raptor_nodes:idx{ node_id | query: $query, k: $k, ef: $ef },
        *raptor_nodes{node_id, level, payload}
    `,

    /** 
     * HNSW Search (Collapsed Mode, Scoped by Narrative)
     * Search within a specific narrative vault
     */
    searchCollapsedScoped: `
    ?[node_id, distance, level, payload] := 
        ~raptor_nodes:idx{ node_id | query: $query, k: $k, ef: $ef },
        *raptor_nodes{node_id, narrative_id, level, payload},
        narrative_id == $narrative_id
    `,

    /**
     * HNSW Search (Leaf Only)
     * For when you only want actual text chunks
     */
    searchLeaves: `
    ?[node_id, distance, payload] := 
        ~raptor_nodes:idx{ node_id | query: $query, k: $k, ef: $ef, filter: level == 0 },
        *raptor_nodes{node_id, payload}
    `,

    /**
     * HNSW Search (Leaf Only, Scoped by Narrative)
     * Scoped chunk search within a narrative vault
     */
    searchLeavesScoped: `
    ?[node_id, distance, payload] := 
        ~raptor_nodes:idx{ node_id | query: $query, k: $k, ef: $ef, filter: level == 0 },
        *raptor_nodes{node_id, narrative_id, payload},
        narrative_id == $narrative_id
    `,

    // --- Config Operations ---

    /** Update tree config */
    updateConfig: `
    ?[tree_id, root_nodes, levels, is_dirty, last_built_at] <- 
      [[$tree_id, $root_nodes, $levels, $is_dirty, $last_built_at]]
    :put raptor_config {
        tree_id => root_nodes, levels, is_dirty, last_built_at
    }
    `,

    /** Get tree config */
    getConfig: `
    ?[tree_id, root_nodes, levels, is_dirty, last_built_at] :=
        *raptor_config{tree_id, root_nodes, levels, is_dirty, last_built_at}
    `
};
