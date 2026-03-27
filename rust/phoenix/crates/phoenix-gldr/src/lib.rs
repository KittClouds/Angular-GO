use phoenix_graptor::{GraptorEdge, GraptorGraph, GraptorVertex};
use phoenix_lex::LexIndex;
use phoenix_store_cozo::{PhoenixCozoStore, SemanticNeighbor, StoreError};
use phoenix_types::{
    BoundaryKind, ChunkHit, Diagnostic, EntityId, NodeHit, QueryRequest, QueryResult,
    TemporalMarker,
};
use rustc_hash::FxHashMap;
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct GldrConfig {
    pub seed_limit: usize,
    pub mention_bridge: f64,
    pub event_bridge: f64,
    pub shared_chunk_bridge: f64,
    pub cooccurs_bridge: f64,
    pub cross_chapter_bridge: f64,
    pub chapter_seed_boost: f64,
}

impl Default for GldrConfig {
    fn default() -> Self {
        Self {
            seed_limit: 12,
            mention_bridge: 0.72,
            event_bridge: 0.58,
            shared_chunk_bridge: 0.42,
            cooccurs_bridge: 0.26,
            cross_chapter_bridge: 0.18,
            chapter_seed_boost: 0.12,
        }
    }
}

pub struct PhoenixGldr {
    config: GldrConfig,
}

impl PhoenixGldr {
    pub fn new(config: GldrConfig) -> Self {
        Self { config }
    }

    pub fn query(
        &self,
        store: &PhoenixCozoStore,
        lex: &LexIndex,
        request: &QueryRequest,
    ) -> Result<QueryResult, StoreError> {
        let limit = request.limit.unwrap_or(5).max(1);
        let semantic_requested = request
            .targets
            .iter()
            .any(|target| matches!(target, phoenix_types::QueryTarget::Semantic));
        let lexical = lex.search(
            &request.query,
            &request.scope,
            limit.max(self.config.seed_limit) * 2,
        );
        let semantic_hits = if semantic_requested {
            request
                .semantic_query_vector
                .as_ref()
                .map(|vector| {
                    store.query_semantic_neighbors(
                        &vector.values,
                        &request.scope,
                        limit.max(self.config.seed_limit) * 2,
                        limit.max(self.config.seed_limit) * 8,
                    )
                })
                .transpose()?
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let seed_vertex_ids: Vec<String> = lexical
            .span_hits
            .iter()
            .take(self.config.seed_limit.max(limit))
            .map(|hit| leaf_vertex_id(&hit.span_id))
            .chain(
                semantic_hits
                    .iter()
                    .take(self.config.seed_limit.max(limit))
                    .map(|hit| leaf_vertex_id(&hit.span_id)),
            )
            .collect();
        let graph = load_subgraph(store, &seed_vertex_ids)?;
        let temporal = TemporalFilter::from_marker(request.temporal.as_ref());
        let wants_chunks = request.targets.is_empty()
            || request.targets.iter().any(|target| {
                matches!(
                    target,
                    phoenix_types::QueryTarget::Chunks
                        | phoenix_types::QueryTarget::Graph
                        | phoenix_types::QueryTarget::Semantic
                )
            });
        let wants_nodes = request.targets.iter().any(|target| {
            matches!(
                target,
                phoenix_types::QueryTarget::Nodes | phoenix_types::QueryTarget::Graph
            )
        });

        let mut chunk_scores = FxHashMap::<String, f64>::default();
        let mut node_scores = FxHashMap::<String, f64>::default();
        let seed_limit = self.config.seed_limit.max(limit);

        for (rank, hit) in lexical.span_hits.iter().take(seed_limit).enumerate() {
            let leaf_id = leaf_vertex_id(&hit.span_id);
            let Some(leaf_vertex) = graph.vertices.get(&leaf_id) else {
                continue;
            };
            if !temporal.matches_vertex(leaf_vertex) {
                continue;
            }

            let seed_score = hit.score;
            let direct_chunk_score = if semantic_requested {
                reciprocal_rank_score(rank)
            } else {
                hit.score
            };
            accumulate_score(&mut chunk_scores, &hit.span_id, direct_chunk_score);

            if wants_nodes {
                for edge in graph.outgoing_matching(&leaf_id, "mentions") {
                    let Some(entity_vertex) = graph.vertices.get(&edge.target_id) else {
                        continue;
                    };
                    if !temporal.matches_vertex(entity_vertex) {
                        continue;
                    }
                    if let Some(entity_id) = entity_vertex.entity_id.as_ref() {
                        let entity_score =
                            scaled_score(seed_score, self.config.mention_bridge, edge.weight);
                        accumulate_score(&mut node_scores, entity_id, entity_score);
                        self.expand_entity(
                            &graph,
                            entity_id,
                            entity_score,
                            &temporal,
                            &mut chunk_scores,
                            &mut node_scores,
                        );
                    }
                }
            }

            for edge in graph.outgoing_matching(&leaf_id, "has_event") {
                let Some(event_vertex) = graph.vertices.get(&edge.target_id) else {
                    continue;
                };
                if !temporal.matches_vertex(event_vertex) {
                    continue;
                }
                let event_score = scaled_score(seed_score, self.config.event_bridge, edge.weight);
                for event_edge in graph.incoming_matching(&edge.target_id, "event_subject") {
                    if let Some(entity_vertex) = graph.vertices.get(&event_edge.source_id) {
                        if !temporal.matches_vertex(entity_vertex) {
                            continue;
                        }
                        if let Some(entity_id) = entity_vertex.entity_id.as_ref() {
                            accumulate_score(&mut node_scores, entity_id, event_score);
                            self.expand_entity(
                                &graph,
                                entity_id,
                                event_score,
                                &temporal,
                                &mut chunk_scores,
                                &mut node_scores,
                            );
                        }
                    }
                }
                for event_edge in graph.outgoing_any(&edge.target_id) {
                    if !matches!(
                        event_edge.edge_type.as_str(),
                        "event_object" | "event_recipient"
                    ) {
                        continue;
                    }
                    if let Some(entity_vertex) = graph.vertices.get(&event_edge.target_id) {
                        if !temporal.matches_vertex(entity_vertex) {
                            continue;
                        }
                        if let Some(entity_id) = entity_vertex.entity_id.as_ref() {
                            let score = scaled_score(event_score, 0.92, event_edge.weight);
                            accumulate_score(&mut node_scores, entity_id, score);
                            self.expand_entity(
                                &graph,
                                entity_id,
                                score,
                                &temporal,
                                &mut chunk_scores,
                                &mut node_scores,
                            );
                        }
                    }
                }
            }

            if let (Some(document_id), Some(chapter_id)) =
                (leaf_vertex.document_id.as_ref(), leaf_vertex.chapter_id)
            {
                for chapter_edge in graph
                    .outgoing_matching(&chapter_vertex_id(document_id, chapter_id), "cross_chapter")
                {
                    let Some(target_chapter) = graph.vertices.get(&chapter_edge.target_id) else {
                        continue;
                    };
                    let Some(target_document_id) = target_chapter.document_id.as_ref() else {
                        continue;
                    };
                    let Some(target_chapter_id) = target_chapter.chapter_id else {
                        continue;
                    };
                    let chapter_score = scaled_score(
                        seed_score,
                        self.config.cross_chapter_bridge,
                        chapter_edge.weight,
                    );
                    for related_leaf in graph.chapter_leaves(target_document_id, target_chapter_id)
                    {
                        let Some(related_vertex) = graph.vertices.get(related_leaf) else {
                            continue;
                        };
                        if !temporal.matches_vertex(related_vertex) {
                            continue;
                        }
                        if let Some(search_chunk_id) = related_vertex.search_chunk_id.as_ref() {
                            accumulate_score(
                                &mut chunk_scores,
                                search_chunk_id,
                                chapter_score * (1.0 + self.config.chapter_seed_boost),
                            );
                        }
                    }
                }
            }
        }

        for (rank, hit) in semantic_hits.iter().take(seed_limit).enumerate() {
            accumulate_semantic_hit(
                &graph,
                hit,
                rank,
                &temporal,
                wants_nodes,
                self,
                &mut chunk_scores,
                &mut node_scores,
            );
        }

        let mut diagnostics = lexical.diagnostics;
        diagnostics.push(Diagnostic {
            code: "PX_GLDR_OK".to_owned(),
            message: "GLDR graph expansion fused lexical anchors with canonical graph facts."
                .to_owned(),
        });
        if semantic_requested {
            diagnostics.push(Diagnostic {
                code: if request.semantic_query_vector.is_some() {
                    "PX_GLDR_SEMANTIC".to_owned()
                } else {
                    "PX_GLDR_SEMANTIC_MISSING_VECTOR".to_owned()
                },
                message: if request.semantic_query_vector.is_some() {
                    format!(
                        "Semantic retrieval fused {} HNSW neighbors with lexical and graph expansion.",
                        semantic_hits.len()
                    )
                } else {
                    "Semantic target requested without a query vector; GLDR used lexical and graph retrieval only."
                        .to_owned()
                },
            });
        }
        if request.temporal.is_some() {
            diagnostics.push(Diagnostic {
                code: "PX_GLDR_TEMPORAL".to_owned(),
                message: temporal.diagnostic_message(),
            });
        }

        let chunk_hits = if wants_chunks {
            ranked_chunk_hits(chunk_scores, limit)
        } else {
            Vec::new()
        };
        let node_hits = if wants_nodes {
            ranked_node_hits(node_scores, limit)
        } else {
            Vec::new()
        };

        Ok(QueryResult {
            session_id: request.session_id.clone(),
            chunk_hits,
            node_hits,
            diagnostics,
        })
    }

    fn expand_entity(
        &self,
        graph: &GraptorGraph,
        entity_id: &str,
        seed_score: f64,
        temporal: &TemporalFilter,
        chunk_scores: &mut FxHashMap<String, f64>,
        node_scores: &mut FxHashMap<String, f64>,
    ) {
        let entity_vertex_id = entity_vertex_id(entity_id);

        for edge in graph.incoming_matching(&entity_vertex_id, "mentions") {
            let Some(leaf_vertex) = graph.vertices.get(&edge.source_id) else {
                continue;
            };
            if !temporal.matches_vertex(leaf_vertex) {
                continue;
            }
            if let Some(search_chunk_id) = leaf_vertex.search_chunk_id.as_ref() {
                let score = scaled_score(seed_score, self.config.shared_chunk_bridge, edge.weight);
                accumulate_score(chunk_scores, search_chunk_id, score);
            }
        }

        for edge in graph.outgoing_matching(&entity_vertex_id, "cooccurs") {
            let Some(other_vertex) = graph.vertices.get(&edge.target_id) else {
                continue;
            };
            if !temporal.matches_vertex(other_vertex) {
                continue;
            }
            if let Some(other_id) = other_vertex.entity_id.as_ref() {
                let score = scaled_score(seed_score, self.config.cooccurs_bridge, edge.weight);
                accumulate_score(node_scores, other_id, score);
                for incoming in graph.incoming_matching(&edge.target_id, "mentions") {
                    let Some(leaf_vertex) = graph.vertices.get(&incoming.source_id) else {
                        continue;
                    };
                    if !temporal.matches_vertex(leaf_vertex) {
                        continue;
                    }
                    if let Some(search_chunk_id) = leaf_vertex.search_chunk_id.as_ref() {
                        accumulate_score(
                            chunk_scores,
                            search_chunk_id,
                            scaled_score(score, self.config.shared_chunk_bridge, incoming.weight),
                        );
                    }
                }
            }
        }
    }
}

impl Default for PhoenixGldr {
    fn default() -> Self {
        Self::new(GldrConfig::default())
    }
}

#[derive(Clone, Debug, Default)]
struct TemporalFilter {
    chapter: Option<u32>,
    boundary_doc_id: Option<String>,
    boundary_ordinal: Option<u32>,
    boundary_end_ordinal: Option<u32>,
}

impl TemporalFilter {
    fn from_marker(marker: Option<&TemporalMarker>) -> Self {
        let chapter = marker.and_then(|marker| marker.chapter);
        let boundary_doc_id = marker.and_then(|marker| {
            marker
                .boundary_doc_id
                .as_ref()
                .map(|document_id| document_id.0.clone())
        });
        let boundary_ordinal = marker.and_then(|marker| {
            marker
                .boundary_ordinal
                .or(marker.ordinal)
                .map(|value| value as u32)
        });
        let boundary_end_ordinal =
            marker.and_then(|marker| marker.boundary_end_ordinal.map(|value| value as u32));
        Self {
            chapter,
            boundary_doc_id,
            boundary_ordinal,
            boundary_end_ordinal,
        }
    }

    fn matches_vertex(&self, vertex: &GraptorVertex) -> bool {
        if let Some(boundary_ordinal) = self.boundary_ordinal {
            if let Some(document_id) = self.boundary_doc_id.as_ref() {
                if vertex.document_id.as_deref() != Some(document_id.as_str()) {
                    return false;
                }
            }
            let boundary_end = self.boundary_end_ordinal.unwrap_or(boundary_ordinal);
            let matches_boundary = vertex
                .boundary_ordinal
                .map(|value| value >= boundary_ordinal && value <= boundary_end)
                .unwrap_or(false)
                || vertex
                    .boundary_ordinals
                    .iter()
                    .any(|value| *value >= boundary_ordinal && *value <= boundary_end);
            if !matches_boundary {
                return false;
            }
        }
        match self.chapter {
            None => true,
            Some(chapter) => {
                vertex.chapter_id == Some(chapter)
                    || vertex.chapters.iter().any(|value| *value == chapter)
            }
        }
    }

    fn diagnostic_message(&self) -> String {
        if let Some(boundary_ordinal) = self.boundary_ordinal {
            let boundary_end = self.boundary_end_ordinal.unwrap_or(boundary_ordinal);
            let doc = self.boundary_doc_id.as_deref().unwrap_or("<any-document>");
            if boundary_end == boundary_ordinal {
                return format!(
                    "Applied boundary-local temporal filtering at {doc} ordinal {boundary_ordinal}."
                );
            }
            return format!(
                "Applied boundary-range temporal filtering at {doc} ordinals {boundary_ordinal}..={boundary_end}."
            );
        }
        match self.chapter {
            Some(chapter) => {
                format!("Applied chapter-local temporal filtering at chapter {chapter}.")
            }
            None => "No chapter-local temporal filter was applied.".to_owned(),
        }
    }
}

fn accumulate_score(scores: &mut FxHashMap<String, f64>, key: &str, score: f64) {
    scores
        .entry(key.to_owned())
        .and_modify(|value| *value += score)
        .or_insert(score);
}

fn scaled_score(seed: f64, bridge: f64, weight: i64) -> f64 {
    let weight_gain = 1.0 + (weight.max(1) as f64).ln() * 0.2;
    seed * bridge * weight_gain
}

fn reciprocal_rank_score(rank: usize) -> f64 {
    1.0 / (60.0 + rank as f64 + 1.0)
}

fn semantic_seed_score(rank: usize, distance: f64) -> f64 {
    reciprocal_rank_score(rank) * (1.0 / (1.0 + distance.max(0.0)))
}

fn accumulate_semantic_hit(
    graph: &GraptorGraph,
    hit: &SemanticNeighbor,
    rank: usize,
    temporal: &TemporalFilter,
    wants_nodes: bool,
    gldr: &PhoenixGldr,
    chunk_scores: &mut FxHashMap<String, f64>,
    node_scores: &mut FxHashMap<String, f64>,
) {
    let leaf_id = leaf_vertex_id(&hit.span_id);
    let Some(leaf_vertex) = graph.vertices.get(&leaf_id) else {
        return;
    };
    if !temporal.matches_vertex(leaf_vertex) {
        return;
    }
    let seed_score = semantic_seed_score(rank, hit.distance);
    accumulate_score(chunk_scores, &hit.span_id, seed_score);

    if wants_nodes {
        for edge in graph.outgoing_matching(&leaf_id, "mentions") {
            let Some(entity_vertex) = graph.vertices.get(&edge.target_id) else {
                continue;
            };
            if !temporal.matches_vertex(entity_vertex) {
                continue;
            }
            if let Some(entity_id) = entity_vertex.entity_id.as_ref() {
                let entity_score =
                    scaled_score(seed_score, gldr.config.mention_bridge, edge.weight);
                accumulate_score(node_scores, entity_id, entity_score);
                gldr.expand_entity(
                    graph,
                    entity_id,
                    entity_score,
                    temporal,
                    chunk_scores,
                    node_scores,
                );
            }
        }
    }
}

fn ranked_chunk_hits(scores: FxHashMap<String, f64>, limit: usize) -> Vec<ChunkHit> {
    let mut hits = scores
        .into_iter()
        .map(|(chunk_id, score)| ChunkHit { chunk_id, score })
        .collect::<Vec<_>>();
    hits.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.chunk_id.cmp(&right.chunk_id))
    });
    if hits.len() > limit {
        hits.truncate(limit);
    }
    hits
}

fn ranked_node_hits(scores: FxHashMap<String, f64>, limit: usize) -> Vec<NodeHit> {
    let mut hits = scores
        .into_iter()
        .map(|(entity_id, score)| NodeHit {
            entity_id: Some(EntityId(entity_id)),
            score,
        })
        .collect::<Vec<_>>();
    hits.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.entity_id.cmp(&right.entity_id))
    });
    if hits.len() > limit {
        hits.truncate(limit);
    }
    hits
}

fn leaf_vertex_id(search_chunk_id: &str) -> String {
    format!("leaf::{search_chunk_id}")
}

fn entity_vertex_id(entity_id: &str) -> String {
    format!("entity::{entity_id}")
}

fn boundary_kind_from_str(kind: &str) -> BoundaryKind {
    match kind {
        "chapter" => BoundaryKind::Chapter,
        "heading" => BoundaryKind::Heading,
        "section" => BoundaryKind::Section,
        "act" => BoundaryKind::Act,
        _ => BoundaryKind::Other,
    }
}

fn chapter_vertex_id(document_id: &str, chapter_id: u32) -> String {
    format!("chapter::{document_id}::{chapter_id}")
}

/// Load only the sub-graph reachable within 2 hops of the given seed vertex IDs.
/// This replaces the full `load_graph_snapshot` for query paths, reducing
/// data transfer from tens of thousands of rows to typically <500.
fn load_subgraph(
    store: &PhoenixCozoStore,
    seed_vertex_ids: &[String],
) -> Result<GraptorGraph, StoreError> {
    if seed_vertex_ids.is_empty() {
        return Ok(GraptorGraph::default());
    }

    // Single unified Datalog query that returns both vertices and edges.
    // Uses a 'kind' discriminator: 'v' for vertices, 'e' for edges.
    // Columns: [kind, c0, c1, c2, c3, c4, c5]
    // Vertices: ['v', id, weight_str, value, attributes, null, null]
    // Edges:    ['e', source_id, target_id, edge_type, weight_str, attributes, data]
    let script = r#"
        seeds[id] <- $seeds

        hop1_targets[tid] := seeds[sid],
            *graph_edges{ source_id: sid, target_id: tid }
        hop1_sources[sid] := seeds[tid],
            *graph_edges{ source_id: sid, target_id: tid }
        hop2_targets[tid] := hop1_targets[mid],
            *graph_edges{ source_id: mid, target_id: tid }
        hop2_sources[sid] := hop1_targets[mid],
            *graph_edges{ source_id: sid, target_id: mid }

        touched[id] := seeds[id]
        touched[id] := hop1_targets[id]
        touched[id] := hop1_sources[id]
        touched[id] := hop2_targets[id]
        touched[id] := hop2_sources[id]

        ?[kind, c0, c1, c2, c3, c4, c5] := kind = "v", touched[c0],
            *graph_vertices{ id: c0, weight: w, value: c2, attributes: c3 },
            c1 = to_string(w), c4 = null, c5 = null

        ?[kind, c0, c1, c2, c3, c4, c5] := kind = "e",
            touched[c0], touched[c1],
            *graph_edges{ source_id: c0, target_id: c1, edge_type: c2, weight: w, attributes: c4, data: c5 },
            c3 = to_string(w)
    "#;

    let mut graph = GraptorGraph::default();

    // Single query returns both vertices and edges
    let rows = store.run_datalog_json(script, seed_vertex_ids)?;
    for row in &rows {
        let Some(kind) = row.first().and_then(Value::as_str) else {
            continue;
        };
        match kind {
            "v" => {
                // Columns: ['v', id, weight_str, value, attributes, null, null]
                let Some(id) = row.get(1).and_then(Value::as_str) else {
                    continue;
                };
                let weight = row
                    .get(2)
                    .and_then(Value::as_str)
                    .and_then(|s| s.parse::<i64>().ok())
                    .or_else(|| row.get(2).and_then(Value::as_i64))
                    .unwrap_or(1);
                let value = row.get(3).cloned().unwrap_or(Value::Null);
                let attributes = row.get(4).cloned().unwrap_or(Value::Null);

                let vertex_kind = value
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_owned();
                let entity_id = value
                    .get("entityId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let search_chunk_id = value
                    .get("searchChunkId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        attributes
                            .get("searchChunkId")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    });
                let document_id = attributes
                    .get("documentId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let chapter_id = attributes
                    .get("chapterId")
                    .and_then(Value::as_u64)
                    .map(|v| v as u32);
                let chapters = attributes
                    .get("chapters")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Value::as_u64)
                            .map(|v| v as u32)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let boundary_id = attributes
                    .get("boundaryId")
                    .and_then(Value::as_u64)
                    .map(|v| v as u32);
                let boundary_ordinal = attributes
                    .get("boundaryOrdinal")
                    .and_then(Value::as_u64)
                    .map(|v| v as u32);
                let boundary_kind = attributes
                    .get("boundaryKind")
                    .and_then(Value::as_str)
                    .map(boundary_kind_from_str);
                let boundary_ordinals = attributes
                    .get("boundaryOrdinals")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Value::as_u64)
                            .map(|v| v as u32)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                let vertex = GraptorVertex {
                    id: id.to_owned(),
                    kind: vertex_kind,
                    weight,
                    value,
                    attributes: attributes.clone(),
                    entity_id,
                    search_chunk_id: search_chunk_id.clone(),
                    document_id: document_id.clone(),
                    chapter_id,
                    chapters,
                    boundary_id,
                    boundary_ordinal,
                    boundary_kind,
                    boundary_ordinals,
                };
                graph.vertices.insert(id.to_owned(), vertex);
                if let (Some(doc_id), Some(ch_id), Some(_)) =
                    (document_id, chapter_id, search_chunk_id)
                {
                    graph
                        .chapter_leaves
                        .entry((doc_id, ch_id))
                        .or_default()
                        .push(id.to_owned());
                }
            }
            "e" => {
                // Columns: ['e', source_id, target_id, edge_type, weight_str, attributes, data]
                let Some(source_id) = row.get(1).and_then(Value::as_str) else {
                    continue;
                };
                let Some(target_id) = row.get(2).and_then(Value::as_str) else {
                    continue;
                };
                let edge_weight = row
                    .get(4)
                    .and_then(Value::as_str)
                    .and_then(|s| s.parse::<i64>().ok())
                    .or_else(|| row.get(4).and_then(Value::as_i64))
                    .unwrap_or(1);
                let edge = GraptorEdge {
                    source_id: source_id.to_owned(),
                    target_id: target_id.to_owned(),
                    edge_type: row
                        .get(3)
                        .and_then(Value::as_str)
                        .unwrap_or("edge")
                        .to_owned(),
                    weight: edge_weight,
                    attributes: row.get(5).cloned().unwrap_or(Value::Null),
                    data: row.get(6).cloned().filter(|v| !v.is_null()),
                };
                graph
                    .outgoing
                    .entry(source_id.to_owned())
                    .or_default()
                    .push(edge.clone());
                graph
                    .incoming
                    .entry(target_id.to_owned())
                    .or_default()
                    .push(edge);
            }
            _ => continue,
        }
    }

    Ok(graph)
}

#[cfg(test)]
mod tests {
    use super::*;
    use phoenix_lex::LexConfig;
    use phoenix_store_cozo::PhoenixCozoStore;
    use phoenix_types::{ScopeKey, TemporalSource};
    use serde_json::json;

    fn test_scope() -> ScopeKey {
        ScopeKey {
            world_id: Some("world-1".to_owned()),
            narrative_id: None,
            folder_id: None,
            folder_path: None,
        }
    }

    fn seed_note(store: &PhoenixCozoStore, id: &str, title: &str, content: &str) {
        store
            .put_row(
                "notes",
                json!({
                    "id": id,
                    "version": 1,
                    "world_id": "world-1",
                    "title": title,
                    "content": content,
                    "markdown_content": content,
                    "folder_id": null,
                    "entity_kind": null,
                    "entity_subtype": null,
                    "is_entity": false,
                    "is_pinned": false,
                    "favorite": false,
                    "owner_id": id,
                    "narrative_id": null,
                    "order": 0.0,
                    "created_at": 1,
                    "updated_at": 1,
                    "valid_from": 1,
                    "valid_to": null,
                    "is_current": true,
                    "change_reason": "seed"
                }),
            )
            .expect("seed note");
    }

    #[test]
    fn gldr_expands_from_seed_chunk_to_related_entity_and_chunk() {
        let store = PhoenixCozoStore::new().expect("store");
        seed_note(&store, "doc-1", "Chapters", "Ryan woke up. He ran.");

        store
            .put_row(
                "chunks",
                json!({
                    "chunk_id": 1001,
                    "doc_id": "doc-1",
                    "level": 0,
                    "start": 0,
                    "end": 13,
                    "text": "Ryan woke up.",
                    "parent_id": null,
                    "scope_narrative": null,
                    "scope_folder": null,
                    "created_at": 1
                }),
            )
            .expect("chunk 1");
        store
            .put_row(
                "chunks",
                json!({
                    "chunk_id": 1002,
                    "doc_id": "doc-1",
                    "level": 0,
                    "start": 14,
                    "end": 26,
                    "text": "He ran hard.",
                    "parent_id": null,
                    "scope_narrative": null,
                    "scope_folder": null,
                    "created_at": 1
                }),
            )
            .expect("chunk 2");
        store
            .put_row(
                "chunkid_map",
                json!({
                    "id": 1001,
                    "chunk_key": "doc-1:1:0:0-13",
                    "doc_id": "doc-1",
                    "created_at": 1
                }),
            )
            .expect("chunkid 1");
        store
            .put_row(
                "chunkid_map",
                json!({
                    "id": 1002,
                    "chunk_key": "doc-1:2:0:14-26",
                    "doc_id": "doc-1",
                    "created_at": 1
                }),
            )
            .expect("chunkid 2");
        store
            .put_row(
                "graph_vertices",
                json!({
                    "id": "leaf::doc-1:1:0:0-13",
                    "value": { "kind": "leaf", "searchChunkId": "doc-1:1:0:0-13" },
                    "weight": 1,
                    "attributes": { "documentId": "doc-1", "chapterId": 1 }
                }),
            )
            .expect("leaf 1 vertex");
        store
            .put_row(
                "graph_vertices",
                json!({
                    "id": "leaf::doc-1:2:0:14-26",
                    "value": { "kind": "leaf", "searchChunkId": "doc-1:2:0:14-26" },
                    "weight": 1,
                    "attributes": { "documentId": "doc-1", "chapterId": 2 }
                }),
            )
            .expect("leaf 2 vertex");
        store.put_row(
            "graph_vertices",
            json!({
                "id": "entity::ryan",
                "value": { "kind": "entity", "entityId": "ryan", "label": "Ryan", "entityKind": "Character" },
                "weight": 2,
                "attributes": { "chapters": [1, 2] }
            }),
        )
        .expect("entity vertex");
        store
            .put_row(
                "graph_edges",
                json!({
                    "source_id": "leaf::doc-1:1:0:0-13",
                    "target_id": "entity::ryan",
                    "weight": 100,
                    "attributes": { "confidence": 1.0 },
                    "data": null,
                    "edge_type": "mentions"
                }),
            )
            .expect("mentions 1");
        store
            .put_row(
                "graph_edges",
                json!({
                    "source_id": "leaf::doc-1:2:0:14-26",
                    "target_id": "entity::ryan",
                    "weight": 85,
                    "attributes": { "confidence": 0.85 },
                    "data": null,
                    "edge_type": "mentions"
                }),
            )
            .expect("mentions 2");

        let lex = LexIndex::from_store(&store, LexConfig::default()).expect("lex");
        let gldr = PhoenixGldr::default();
        let result = gldr
            .query(
                &store,
                &lex,
                &QueryRequest {
                    session_id: None,
                    query: "Ryan".to_owned(),
                    scope: test_scope(),
                    targets: vec![phoenix_types::QueryTarget::Graph],
                    limit: Some(5),
                    temporal: None,
                    semantic_query_vector: None,
                },
            )
            .expect("gldr query");

        assert_eq!(result.node_hits.len(), 1);
        assert_eq!(
            result.node_hits[0].entity_id,
            Some(EntityId("ryan".to_owned()))
        );
        assert!(
            result
                .chunk_hits
                .iter()
                .any(|hit| hit.chunk_id == "doc-1:2:0:14-26"),
            "graph expansion should recover the second chunk through the shared entity"
        );
    }

    #[test]
    fn gldr_honors_chapter_temporal_filter() {
        let store = PhoenixCozoStore::new().expect("store");
        seed_note(&store, "doc-1", "Temporal", "Ryan stood. Ryan ran.");

        for (chunk_id, chapter_id, key, text) in [
            (2001_i64, 1_u32, "doc-1:1:0:0-11", "Ryan stood."),
            (2002_i64, 2_u32, "doc-1:2:0:12-21", "Ryan ran."),
        ] {
            store
                .put_row(
                    "chunks",
                    json!({
                        "chunk_id": chunk_id,
                        "doc_id": "doc-1",
                        "level": 0,
                        "start": if chapter_id == 1 { 0 } else { 12 },
                        "end": if chapter_id == 1 { 11 } else { 21 },
                        "text": text,
                        "parent_id": null,
                        "scope_narrative": null,
                        "scope_folder": null,
                        "created_at": 1
                    }),
                )
                .expect("chunk");
            store
                .put_row(
                    "chunkid_map",
                    json!({
                        "id": chunk_id,
                        "chunk_key": key,
                        "doc_id": "doc-1",
                        "created_at": 1
                    }),
                )
                .expect("chunkid");
            store
                .put_row(
                    "graph_vertices",
                    json!({
                        "id": format!("leaf::{key}"),
                        "value": { "kind": "leaf", "searchChunkId": key },
                        "weight": 1,
                        "attributes": { "documentId": "doc-1", "chapterId": chapter_id }
                    }),
                )
                .expect("leaf");
        }
        store.put_row(
            "graph_vertices",
            json!({
                "id": "entity::ryan",
                "value": { "kind": "entity", "entityId": "ryan", "label": "Ryan", "entityKind": "Character" },
                "weight": 2,
                "attributes": { "chapters": [1, 2] }
            }),
        )
        .expect("entity");
        store
            .put_row(
                "graph_edges",
                json!({
                    "source_id": "leaf::doc-1:1:0:0-11",
                    "target_id": "entity::ryan",
                    "weight": 100,
                    "attributes": { "confidence": 1.0 },
                    "data": null,
                    "edge_type": "mentions"
                }),
            )
            .expect("mentions 1");
        store
            .put_row(
                "graph_edges",
                json!({
                    "source_id": "leaf::doc-1:2:0:12-21",
                    "target_id": "entity::ryan",
                    "weight": 100,
                    "attributes": { "confidence": 1.0 },
                    "data": null,
                    "edge_type": "mentions"
                }),
            )
            .expect("mentions 2");

        let lex = LexIndex::from_store(&store, LexConfig::default()).expect("lex");
        let gldr = PhoenixGldr::default();
        let result = gldr
            .query(
                &store,
                &lex,
                &QueryRequest {
                    session_id: None,
                    query: "Ryan".to_owned(),
                    scope: test_scope(),
                    targets: vec![phoenix_types::QueryTarget::Graph],
                    limit: Some(5),
                    temporal: Some(TemporalMarker {
                        source: Some(TemporalSource::Chapter),
                        chapter: Some(2),
                        calendar: None,
                        story_time: None,
                        ordinal: None,
                        ..Default::default()
                    }),
                    semantic_query_vector: None,
                },
            )
            .expect("temporal query");

        assert_eq!(result.chunk_hits.len(), 1);
        assert_eq!(result.chunk_hits[0].chunk_id, "doc-1:2:0:12-21");
        assert_eq!(result.node_hits.len(), 1);
    }
}
