/**
 * Cross-Document Knowledge Graph Schema
 * 
 * Supports building a knowledge graph across multiple notes using:
 * 1. node_vectors - Entity embeddings with HNSW index for semantic search
 * 2. entity_clusters - Groups of similar/duplicate entities
 * 3. cluster_members - Members of each cluster
 * 4. cooccurrence_edges - Weighted edges for co-occurring entities
 * 
 * Vector dimensions supported: 768, 384, 256, 128 (Matryoshka representations)
 */

// ============================================================================
// Types
// ============================================================================

export type VectorDimension = 768 | 384 | 256 | 128;

export interface NodeVector {
  nodeId: string;
  model: string;
  dimension: VectorDimension;
  vector: Float32Array | number[];
  contextText: string;
  createdAt: number;
}

export interface EntityCluster {
  clusterId: string;
  canonicalId: string;
  canonicalName: string;
  confidence: number;
  createdAt: number;
}

export interface ClusterMember {
  clusterId: string;
  nodeId: string;
  label: string;
  sourceNote: string;
  similarity: number;
}

export interface CooccurrenceEdge {
  sourceId: string;
  targetId: string;
  weight: number;
  lastSeenAt: number;
  narrativeId?: string;
}

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Node vectors relation with variable dimension support.
 * CozoDB HNSW requires fixed dimension per index, so we store dimension
 * as metadata and create separate indices per dimension tier.
 * 
 * The primary index uses 384 (most common). 
 * Additional indices can be created for 768, 256, 128 as needed.
 */
export const NODE_VECTORS_SCHEMA = `
:create node_vectors {
    node_id: String =>
    model: String,
    dimension: Int,
    vector: [Float],
    context_text: String default '',
    created_at: Float
}
`;

/**
 * HNSW index for 384-dimensional vectors (primary)
 * Note: CozoDB requires fixed dim per index. We create indices on demand.
 */
export const NODE_VECTORS_HNSW_384 = `
::hnsw create node_vectors:semantic_idx_384 {
    dim: 384,
    m: 32,
    dtype: F32,
    fields: [vector],
    distance: Cosine,
    ef_construction: 200,
    filter: dimension == 384
}
`;

export const NODE_VECTORS_HNSW_768 = `
::hnsw create node_vectors:semantic_idx_768 {
    dim: 768,
    m: 32,
    dtype: F32,
    fields: [vector],
    distance: Cosine,
    ef_construction: 200,
    filter: dimension == 768
}
`;

export const NODE_VECTORS_HNSW_256 = `
::hnsw create node_vectors:semantic_idx_256 {
    dim: 256,
    m: 32,
    dtype: F32,
    fields: [vector],
    distance: Cosine,
    ef_construction: 200,
    filter: dimension == 256
}
`;

export const NODE_VECTORS_HNSW_128 = `
::hnsw create node_vectors:semantic_idx_128 {
    dim: 128,
    m: 32,
    dtype: F32,
    fields: [vector],
    distance: Cosine,
    ef_construction: 200,
    filter: dimension == 128
}
`;

/**
 * Entity clusters for duplicate detection
 */
export const ENTITY_CLUSTERS_SCHEMA = `
:create entity_clusters {
    cluster_id: String =>
    canonical_id: String,
    canonical_name: String,
    confidence: Float,
    created_at: Float
}
`;

/**
 * Cluster members (N:1 to entity_clusters)
 */
export const CLUSTER_MEMBERS_SCHEMA = `
:create cluster_members {
    cluster_id: String,
    node_id: String =>
    label: String,
    source_note: String,
    similarity: Float
}
`;

/**
 * Co-occurrence edges with upsertable weights
 * Tracks how often two entities appear together in the same context
 */
export const COOCCURRENCE_EDGES_SCHEMA = `
:create cooccurrence_edges {
    source_id: String,
    target_id: String =>
    weight: Float default 1.0,
    last_seen_at: Float,
    narrative_id: String?
}
`;

// ============================================================================
// Queries
// ============================================================================

export const CROSSDOC_QUERIES = {
  // --- Node Vectors ---

  /** Upsert a node vector */
  upsertVector: `
    ?[node_id, model, dimension, vector, context_text, created_at] <- 
      [[$node_id, $model, $dimension, $vector, $context_text, $created_at]]
    :put node_vectors {
      node_id => model, dimension, vector, context_text, created_at
    }
  `,

  /** Get vector by node ID */
  getVector: `
    ?[node_id, model, dimension, vector, context_text, created_at] := 
      *node_vectors{node_id, model, dimension, vector, context_text, created_at},
      node_id == $node_id
  `,

  /** Check if node has a vector */
  hasVector: `
    ?[exists] := 
      *node_vectors{node_id},
      node_id == $node_id,
      exists = true
    ?[exists] := exists = false
  `,

  /** Delete vector by node ID */
  deleteVector: `
    ?[node_id] := node_id = $node_id
    :rm node_vectors {node_id}
  `,

  /** Search similar vectors (384-dim) using HNSW */
  searchSimilar384: `
    ?[node_id, distance] := ~node_vectors:semantic_idx_384{
      node_id | query: $query_vector, k: $k, ef: $ef
    }
  `,

  /** Search similar vectors (768-dim) using HNSW */
  searchSimilar768: `
    ?[node_id, distance] := ~node_vectors:semantic_idx_768{
      node_id | query: $query_vector, k: $k, ef: $ef
    }
  `,

  /** Search similar vectors (256-dim) using HNSW */
  searchSimilar256: `
    ?[node_id, distance] := ~node_vectors:semantic_idx_256{
      node_id | query: $query_vector, k: $k, ef: $ef
    }
  `,

  /** Search similar vectors (128-dim) using HNSW */
  searchSimilar128: `
    ?[node_id, distance] := ~node_vectors:semantic_idx_128{
      node_id | query: $query_vector, k: $k, ef: $ef
    }
  `,

  // --- Entity Clusters ---

  /** Upsert a cluster */
  upsertCluster: `
    ?[cluster_id, canonical_id, canonical_name, confidence, created_at] <- 
      [[$cluster_id, $canonical_id, $canonical_name, $confidence, $created_at]]
    :put entity_clusters {
      cluster_id => canonical_id, canonical_name, confidence, created_at
    }
  `,

  /** Get cluster by ID */
  getCluster: `
    ?[cluster_id, canonical_id, canonical_name, confidence, created_at] := 
      *entity_clusters{cluster_id, canonical_id, canonical_name, confidence, created_at},
      cluster_id == $cluster_id
  `,

  /** Get cluster containing a specific entity */
  getClusterByEntity: `
    ?[cluster_id, canonical_id, canonical_name, confidence] := 
      *cluster_members{cluster_id, node_id},
      *entity_clusters{cluster_id, canonical_id, canonical_name, confidence},
      node_id == $entity_id
  `,

  /** Get all clusters */
  getAllClusters: `
    ?[cluster_id, canonical_id, canonical_name, confidence, member_count] := 
      *entity_clusters{cluster_id, canonical_id, canonical_name, confidence},
      member_count = count(m_node_id),
      *cluster_members{cluster_id, node_id: m_node_id}
  `,

  // --- Cluster Members ---

  /** Add member to cluster */
  addClusterMember: `
    ?[cluster_id, node_id, label, source_note, similarity] <- 
      [[$cluster_id, $node_id, $label, $source_note, $similarity]]
    :put cluster_members {
      cluster_id, node_id => label, source_note, similarity
    }
  `,

  /** Get all members of a cluster */
  getClusterMembers: `
    ?[node_id, label, source_note, similarity] := 
      *cluster_members{cluster_id, node_id, label, source_note, similarity},
      cluster_id == $cluster_id
    :order -similarity
  `,

  /** Remove member from cluster */
  removeClusterMember: `
    ?[cluster_id, node_id] := cluster_id = $cluster_id, node_id = $node_id
    :rm cluster_members {cluster_id, node_id}
  `,

  // --- Co-occurrence Edges ---

  /** Upsert co-occurrence edge (increment weight if exists) */
  upsertCooccurrence: `
    existing[old_weight] := 
      *cooccurrence_edges{source_id, target_id, weight: old_weight},
      source_id == $source_id,
      target_id == $target_id
    existing[old_weight] := old_weight = 0.0
    
    ?[source_id, target_id, weight, last_seen_at] := 
      existing[old_weight],
      source_id = $source_id,
      target_id = $target_id,
      weight = old_weight + $weight_delta,
      last_seen_at = $now,
      narrative_id = $narrative_id
    :put cooccurrence_edges {
      source_id, target_id => weight, last_seen_at, narrative_id
    }
  `,

  /** Get co-occurrence weight between two entities */
  getCooccurrence: `
    ?[weight, last_seen_at] := 
      *cooccurrence_edges{source_id, target_id, weight, last_seen_at},
      source_id == $source_id,
      target_id == $target_id
  `,

  /** Get all co-occurrences for an entity */
  getEntityCooccurrences: `
    ?[other_id, weight, last_seen_at] := 
      *cooccurrence_edges{source_id, target_id, weight, last_seen_at},
      source_id == $entity_id,
      other_id = target_id
    ?[other_id, weight, last_seen_at] := 
      *cooccurrence_edges{source_id, target_id, weight, last_seen_at},
      target_id == $entity_id,
      other_id = source_id
    :order -weight
    :limit $limit
  `,

  /** Delete co-occurrence edge */
  deleteCooccurrence: `
    ?[source_id, target_id] := source_id = $source_id, target_id = $target_id
    :rm cooccurrence_edges {source_id, target_id}
  `,

  // --- Stats ---

  /** Get cross-document graph statistics */
  getCrossdocStats: `
    vector_count[cnt] := cnt = count(node_id), *node_vectors{node_id}
    cluster_count[cnt] := cnt = count(cluster_id), *entity_clusters{cluster_id}
    member_count[cnt] := cnt = count(node_id), *cluster_members{node_id}
    edge_count[cnt] := cnt = count(source_id), *cooccurrence_edges{source_id}
    total_weight[w] := w = sum(weight), *cooccurrence_edges{weight}
    total_weight[w] := w = 0.0
    
    ?[vectors, clusters, members, cooccurrence_edges, total_cooccurrence_weight] := 
      vector_count[vectors],
      cluster_count[clusters],
      member_count[members],
      edge_count[cooccurrence_edges],
      total_weight[total_cooccurrence_weight]
  `,
};

// ============================================================================
// Dimension Helpers
// ============================================================================

/**
 * Get the appropriate HNSW search query for a given dimension
 */
export function getSearchQueryForDimension(dim: VectorDimension): string {
  switch (dim) {
    case 768: return CROSSDOC_QUERIES.searchSimilar768;
    case 384: return CROSSDOC_QUERIES.searchSimilar384;
    case 256: return CROSSDOC_QUERIES.searchSimilar256;
    case 128: return CROSSDOC_QUERIES.searchSimilar128;
  }
}

/**
 * Get the HNSW index creation script for a given dimension
 */
export function getHnswIndexForDimension(dim: VectorDimension): string {
  switch (dim) {
    case 768: return NODE_VECTORS_HNSW_768;
    case 384: return NODE_VECTORS_HNSW_384;
    case 256: return NODE_VECTORS_HNSW_256;
    case 128: return NODE_VECTORS_HNSW_128;
  }
}

/**
 * Validate vector dimension matches expected
 */
export function validateVectorDimension(vector: number[] | Float32Array, expected: VectorDimension): boolean {
  return vector.length === expected;
}

/**
 * Truncate vector to Matryoshka dimension
 * Matryoshka representations allow using first N dimensions of a larger embedding
 */
export function truncateVector(vector: number[] | Float32Array, targetDim: VectorDimension): number[] {
  if (vector.length < targetDim) {
    throw new Error(`Cannot truncate vector of length ${vector.length} to ${targetDim}`);
  }
  return Array.from(vector).slice(0, targetDim);
}
