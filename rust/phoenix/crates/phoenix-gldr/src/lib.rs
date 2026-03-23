use phoenix_graptor::{load_graph_snapshot, GraptorGraph, GraptorVertex};
use phoenix_lex::LexIndex;
use phoenix_store_cozo::{PhoenixCozoStore, StoreError};
use phoenix_types::{
    ChunkHit, Diagnostic, EntityId, NodeHit, QueryRequest, QueryResult, TemporalMarker,
};
use rustc_hash::FxHashMap;

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
        let lexical = lex.search(
            &request.query,
            &request.scope,
            limit.max(self.config.seed_limit) * 2,
        );
        let graph = load_graph_snapshot(store)?;
        let temporal = TemporalFilter::from_marker(request.temporal.as_ref());
        let wants_chunks = request.targets.is_empty()
            || request.targets.iter().any(|target| {
                matches!(
                    target,
                    phoenix_types::QueryTarget::Chunks | phoenix_types::QueryTarget::Graph
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

        for hit in lexical
            .span_hits
            .iter()
            .take(self.config.seed_limit.max(limit))
        {
            let leaf_id = leaf_vertex_id(&hit.span_id);
            let Some(leaf_vertex) = graph.vertices.get(&leaf_id) else {
                continue;
            };
            if !temporal.matches_vertex(leaf_vertex) {
                continue;
            }

            accumulate_score(&mut chunk_scores, &hit.span_id, hit.score);

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
                            scaled_score(hit.score, self.config.mention_bridge, edge.weight);
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
                let event_score = scaled_score(hit.score, self.config.event_bridge, edge.weight);
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
                        hit.score,
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

        let mut diagnostics = lexical.diagnostics;
        diagnostics.push(Diagnostic {
            code: "PX_GLDR_OK".to_owned(),
            message: "GLDR graph expansion fused lexical anchors with canonical graph facts."
                .to_owned(),
        });
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
}

impl TemporalFilter {
    fn from_marker(marker: Option<&TemporalMarker>) -> Self {
        let chapter = marker.and_then(|marker| {
            marker
                .chapter
                .or_else(|| marker.ordinal.map(|value| value as u32))
        });
        Self { chapter }
    }

    fn matches_vertex(&self, vertex: &GraptorVertex) -> bool {
        match self.chapter {
            None => true,
            Some(chapter) => {
                vertex.chapter_id == Some(chapter)
                    || vertex.chapters.iter().any(|value| *value == chapter)
            }
        }
    }

    fn diagnostic_message(&self) -> String {
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

fn chapter_vertex_id(document_id: &str, chapter_id: u32) -> String {
    format!("chapter::{document_id}::{chapter_id}")
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
                    }),
                },
            )
            .expect("temporal query");

        assert_eq!(result.chunk_hits.len(), 1);
        assert_eq!(result.chunk_hits[0].chunk_id, "doc-1:2:0:12-21");
        assert_eq!(result.node_hits.len(), 1);
    }
}
