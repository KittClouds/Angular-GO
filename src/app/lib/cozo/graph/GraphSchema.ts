/**
 * Graph Schema Creation - Exported for early initialization
 * 
 * Must be called BEFORE snapshot restore to ensure entity relations exist.
 */

import { cozoDb } from '../db';
import { FOLDER_HIERARCHY_SCHEMA } from '../schema/layer2-folder-hierarchy';
import { NETWORK_INSTANCE_SCHEMA } from '../schema/layer2-network-instance';
import { NETWORK_MEMBERSHIP_SCHEMA } from '../schema/layer2-network-membership';
import { NETWORK_RELATIONSHIP_SCHEMA } from '../schema/layer2-network-relationship';
import { SPANS_SCHEMA, WORMHOLES_SCHEMA, SPAN_MENTIONS_SCHEMA } from '../schema/layer2-span-model';
import {
    NODE_VECTORS_SCHEMA,
    ENTITY_CLUSTERS_SCHEMA,
    CLUSTER_MEMBERS_SCHEMA,
    COOCCURRENCE_EDGES_SCHEMA,
    NODE_VECTORS_HNSW_384,
    NODE_VECTORS_HNSW_768,
    NODE_VECTORS_HNSW_256,
    NODE_VECTORS_HNSW_128,
    type VectorDimension,
} from '../schema/layer2-crossdoc';
import {
    EPISODE_LOG_SCHEMA,
    BLOCKS_SCHEMA,
    BLOCKS_HNSW_384,
    BLOCKS_FTS_SCHEMA,
} from '../schema/layer4-memory';
import {
    RAPTOR_NODES_SCHEMA,
    RAPTOR_CONFIG_SCHEMA,
    RAPTOR_HNSW_INDEX
} from '../schema/layer3-raptor';
import {
    WS_SESSION_SCHEMA,
    WS_NODE_SCHEMA,
    WS_EDGE_SCHEMA,
    WS_VIEW_CACHE_SCHEMA,
    WS_METRIC_SCHEMA,
} from '../../rlm/schema/workspace-schema';

let graphSchemasCreated = false;

/**
 * Create all graph-related schemas (entities, relationships, etc.)
 * Safe to call multiple times - will skip if already created.
 */
export function createGraphSchemas(): string[] {
    if (graphSchemasCreated) {
        console.log('[GraphSchema] Already created, skipping');
        return [];
    }

    console.log('[GraphSchema] Creating graph schemas...');

    const basicSchemas = [
        { name: 'entities', script: `:create entities { id: String => label: String, normalized: String, kind: String, subtype: String?, first_note: String, created_at: Float, updated_at: Float, created_by: String, narrative_id: String? }` },
        { name: 'entity_aliases', script: `:create entity_aliases { entity_id: String, normalized: String => alias: String }` },
        { name: 'entity_mentions', script: `:create entity_mentions { entity_id: String, note_id: String => mention_count: Int, last_seen: Float, narrative_id: String?, role: String default '' }` },
        { name: 'entity_metadata', script: `:create entity_metadata { entity_id: String, key: String => value: String }` },
        // Edges (aligned with CozoEntityEdge and layer2-unified)
        { name: 'entity_edge', script: `:create entity_edge { id: String => source_id: String, target_id: String, edge_type: String, confidence: Float, extraction_methods: [String], group_id: String, scope_type: String, created_at: Float, valid_at: Float, invalid_at: Float?, fact: String?, weight: Float, narrative_id: String? }` },
        { name: 'relationship_provenance', script: `:create relationship_provenance { relationship_id: String, source: String, origin_id: String => confidence: Float, timestamp: Float, context: String? }` },
        { name: 'relationship_attributes', script: `:create relationship_attributes { relationship_id: String, key: String => value: String }` },
        // Unsupervised NER ("Discovery Engine") candidates
        { name: 'discovery_candidates', script: `:create discovery_candidates { token: String => kind: Int, score: Float, status: Int, last_seen: Float, first_seen: Float, count: Int }` },

        // Fact Sheets & Schemas
        { name: 'folder_schemas', script: `:create folder_schemas { id: String => entity_kind: String, subtype: String?, name: String, description: String?, allowed_subfolders: String, allowed_note_types: String, is_vault_root: Bool, container_only: Bool, propagate_kind_to_children: Bool, icon: String?, is_system: Bool, created_at: Float, updated_at: Float }` },
        { name: 'entity_cards', script: `:create entity_cards { entity_id: String, card_id: String => name: String, color: String, icon: String, display_order: Int, is_collapsed: Bool, created_at: Float, updated_at: Float }` },
        { name: 'fact_sheet_card_schemas', script: `:create fact_sheet_card_schemas { id: String => entity_kind: String, card_id: String, title: String, icon: String, gradient: String, display_order: Int, is_system: Bool, created_at: Float, updated_at: Float }` },
        { name: 'fact_sheet_field_schemas', script: `:create fact_sheet_field_schemas { id: String => entity_kind: String, card_id: String, field_name: String, field_type: String, label: String, placeholder: String?, multiline: Bool?, min_val: Float?, max_val: Float?, step: Float?, default_value: String?, options: String?, color: String?, current_field: String?, max_field: String?, stats: String?, unit: String?, display_order: Int, is_system: Bool, created_at: Float, updated_at: Float }` },
    ];

    const allSchemas = [
        ...basicSchemas,
        { name: 'folder_hierarchy', script: FOLDER_HIERARCHY_SCHEMA.trim() },
        { name: 'network_instance', script: NETWORK_INSTANCE_SCHEMA.trim() },
        { name: 'network_membership', script: NETWORK_MEMBERSHIP_SCHEMA.trim() },
        { name: 'network_relationship', script: NETWORK_RELATIONSHIP_SCHEMA.trim() },
        // Span-first data model (immutable facts layer)
        { name: 'spans', script: SPANS_SCHEMA.trim() },
        { name: 'wormholes', script: WORMHOLES_SCHEMA.trim() },
        { name: 'span_mentions', script: SPAN_MENTIONS_SCHEMA.trim() },
        // Cross-document knowledge graph schemas
        { name: 'node_vectors', script: NODE_VECTORS_SCHEMA.trim() },
        { name: 'entity_clusters', script: ENTITY_CLUSTERS_SCHEMA.trim() },
        { name: 'cluster_members', script: CLUSTER_MEMBERS_SCHEMA.trim() },
        { name: 'cooccurrence_edges', script: COOCCURRENCE_EDGES_SCHEMA.trim() },
        // Layer 4: LLM Memory
        { name: 'episode_log', script: EPISODE_LOG_SCHEMA.trim() },
        { name: 'blocks', script: BLOCKS_SCHEMA.trim() },
        { name: 'blocks_fts', script: BLOCKS_FTS_SCHEMA.trim() },
        // Layer 3: RAPTOR (Semantic Search)
        { name: 'raptor_nodes', script: RAPTOR_NODES_SCHEMA.trim() },
        { name: 'raptor_config', script: RAPTOR_CONFIG_SCHEMA.trim() },
        { name: 'raptor_index', script: RAPTOR_HNSW_INDEX.trim() },
        // Layer 3: RAPTOR (Semantic Search)
        { name: 'raptor_nodes', script: RAPTOR_NODES_SCHEMA.trim() },
        { name: 'raptor_config', script: RAPTOR_CONFIG_SCHEMA.trim() },
        { name: 'raptor_index', script: RAPTOR_HNSW_INDEX.trim() },
        // NOTE: chat_messages removed - now using Go/SQLite via GoChatService
        // RLM Workspace schemas (ws_* relations)
        { name: 'ws_session', script: WS_SESSION_SCHEMA.trim() },
        { name: 'ws_node', script: WS_NODE_SCHEMA.trim() },
        { name: 'ws_edge', script: WS_EDGE_SCHEMA.trim() },
        { name: 'ws_view_cache', script: WS_VIEW_CACHE_SCHEMA.trim() },
        { name: 'ws_metric', script: WS_METRIC_SCHEMA.trim() },
    ];

    const created: string[] = [];

    for (const { name, script } of allSchemas) {
        try {
            const resultStr = cozoDb.run(script);
            const result = JSON.parse(resultStr);
            if (result.ok === false) {
                const msg = result.message || result.display || 'Unknown error';

                // Special handling for RAPTOR HNSW index failure on existing non-vector table
                if (name === 'raptor_index' && !msg.includes('already exists')) {
                    console.warn(`[GraphSchema] RAPTOR index '${name}' failed: ${msg}. FORCE-RECREATING due to schema mismatch...`);
                    try {
                        cozoDb.run(':rm raptor_nodes');
                        console.log('[GraphSchema] Dropped old raptor_nodes table.');

                        // Re-create the table
                        const nodesScript = allSchemas.find(s => s.name === 'raptor_nodes')?.script;
                        if (nodesScript) {
                            cozoDb.run(nodesScript);
                            console.log('[GraphSchema] Re-created raptor_nodes table.');
                        }

                        // Retry index creation
                        const retryRes = cozoDb.run(script);
                        const retryParsed = JSON.parse(retryRes);
                        if (retryParsed.ok === false) {
                            console.error('[GraphSchema] RETRY FAILED:', retryParsed);
                        } else {
                            console.log('[GraphSchema] ✅ Created RAPTOR HNSW index after recreation.');
                            created.push(name);
                        }
                        continue;
                    } catch (retryErr) {
                        console.error('[GraphSchema] Failed to recreate RAPTOR schema:', retryErr);
                    }
                }

                if (!msg.includes('already exists') && !msg.includes('conflicts with an existing one')) {
                    console.error(`[GraphSchema] ${name} failed:`, msg);
                }
            } else {
                created.push(name);
            }
        } catch (err) {
            const errMsg = String(err);

            // Catch error on retry if needed... (same logic as above but for throws)
            if (name === 'raptor_index' && !errMsg.includes('already exists')) {
                console.warn(`[GraphSchema] RAPTOR index throw: ${errMsg}. Recreating...`);
                try {
                    cozoDb.run(':rm raptor_nodes');
                    const nodesScript = allSchemas.find(s => s.name === 'raptor_nodes')?.script;
                    if (nodesScript) cozoDb.run(nodesScript);
                    cozoDb.run(script);
                    console.log('[GraphSchema] ✅ Created RAPTOR HNSW index (from throw).');
                    created.push(name);
                    continue;
                } catch (retryThrow) {
                    console.error('[GraphSchema] Failed recreate from throw:', retryThrow);
                }
            }

            if (!errMsg.includes('already exists') && !errMsg.includes('conflicts with an existing one')) {
                console.error(`[GraphSchema] Creation failed for ${name}:`, err);
            }
        }
    }

    graphSchemasCreated = true;
    console.log(`[GraphSchema] ✅ ${created.length} schemas ready`);
    return created;
}

/**
 * Check if graph schemas have been created
 */
export function areGraphSchemasCreated(): boolean {
    return graphSchemasCreated;
}

/**
 * Reset flag (for testing)
 */
export function resetGraphSchemaFlag(): void {
    graphSchemasCreated = false;
}

// Track which HNSW indices have been created
const hnswIndicesCreated = new Set<VectorDimension>();

/**
 * Create HNSW index for a specific vector dimension.
 * Should be called after node_vectors relation exists.
 * Safe to call multiple times - will skip if already created.
 * 
 * @param dimension - Vector dimension (768, 384, 256, or 128)
 * @returns true if index was created, false if already exists
 */
export function createVectorHnswIndex(dimension: VectorDimension): boolean {
    if (hnswIndicesCreated.has(dimension)) {
        console.log(`[GraphSchema] HNSW index for ${dimension}d already created, skipping`);
        return false;
    }

    const indexScripts: Record<VectorDimension, string> = {
        768: NODE_VECTORS_HNSW_768,
        384: NODE_VECTORS_HNSW_384,
        256: NODE_VECTORS_HNSW_256,
        128: NODE_VECTORS_HNSW_128,
    };

    const script = indexScripts[dimension];
    if (!script) {
        console.error(`[GraphSchema] Unknown dimension: ${dimension}`);
        return false;
    }

    try {
        const resultStr = cozoDb.run(script.trim());
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            const msg = result.message || result.display || 'Unknown error';
            if (msg.includes('already exists')) {
                hnswIndicesCreated.add(dimension);
                return false;
            }
            console.error(`[GraphSchema] HNSW ${dimension}d failed:`, msg);
            return false;
        }
        console.log(`[GraphSchema] HNSW index semantic_idx_${dimension} created`);
        hnswIndicesCreated.add(dimension);
        return true;
    } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes('already exists')) {
            hnswIndicesCreated.add(dimension);
            return false;
        }
        console.error(`[GraphSchema] HNSW ${dimension}d creation failed:`, err);
        return false;
    }
}

/**
 * Create all HNSW indices (768, 384, 256, 128).
 * @returns Array of dimensions that were created
 */
export function createAllVectorHnswIndices(): VectorDimension[] {
    const dimensions: VectorDimension[] = [384, 768, 256, 128];
    const created: VectorDimension[] = [];

    for (const dim of dimensions) {
        if (createVectorHnswIndex(dim)) {
            created.push(dim);
        }
    }

    console.log(`[GraphSchema] ✅ HNSW indices complete (${created.length} created)`);
    return created;
}

/**
 * Check if HNSW index exists for a dimension
 */
export function hasVectorHnswIndex(dimension: VectorDimension): boolean {
    return hnswIndicesCreated.has(dimension);
}

/**
 * Reset HNSW index flags (for testing)
 */
export function resetHnswIndexFlags(): void {
    hnswIndicesCreated.clear();
    blocksHnswCreated = false;
}

// Track blocks HNSW index
let blocksHnswCreated = false;

/**
 * Create HNSW index for blocks relation (LLM memory).
 * Should be called after blocks relation exists.
 * Safe to call multiple times - will skip if already created.
 */
export function createBlocksHnswIndex(): boolean {
    if (blocksHnswCreated) {
        console.log('[GraphSchema] Blocks HNSW index already created, skipping');
        return false;
    }

    try {
        const resultStr = cozoDb.run(BLOCKS_HNSW_384.trim());
        const result = JSON.parse(resultStr);
        if (result.ok === false) {
            const msg = result.message || result.display || 'Unknown error';
            if (msg.includes('already exists')) {
                blocksHnswCreated = true;
                return false;
            }
            console.error('[GraphSchema] Blocks HNSW failed:', msg);
            return false;
        }
        console.log('[GraphSchema] ✅ Blocks HNSW index created');
        blocksHnswCreated = true;
        return true;
    } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes('already exists')) {
            blocksHnswCreated = true;
            return false;
        }
        console.error('[GraphSchema] Blocks HNSW creation failed:', err);
        return false;
    }
}

// Re-export VectorDimension type for external use
export type { VectorDimension };

