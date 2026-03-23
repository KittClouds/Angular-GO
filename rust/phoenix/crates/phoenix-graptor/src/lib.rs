use std::cmp::{max, min};
use std::collections::{BTreeMap, BTreeSet};

use daachorse::{DoubleArrayAhoCorasick, DoubleArrayAhoCorasickBuilder, MatchKind};
use phoenix_alex::{is_sentence_guard, normalize_raw};
use phoenix_scanner::PhoenixScanner;
use phoenix_store_cozo::{PhoenixCozoStore, StoreError};
use phoenix_structure::PhoenixStructure;
use phoenix_types::{
    ChunkStats, Diagnostic, DiscoverySummary, DocumentId, EntityId, EntityKind, EntitySummary,
    EvidenceSpan, FrameSlot, GenderHint, GraphDeltaChunk, GraphDeltaEdge, GraphDeltaNode,
    GraphDeltaRequest, GraphDeltaResult, GraphSummary, IngestDocument, IngestDocumentSummary,
    IngestRequest, IngestResult, MentionEntityRef, MentionSource, NoteId, RelationCandidate,
    ResolverEntitySeed, ResolverLinkKind, RetrievalSummary, ScopeKey, ScanRequest,
    SessionDocumentState, SessionId, SessionState, SessionStats, StructureRequest, TextRange,
};
use serde_json::{json, Value};

const DEFAULT_CHAPTER_KEYWORDS: &[&str] = &[
    "chapter",
    "part",
    "section",
    "introduction",
    "conclusion",
    "summary",
    "appendix",
    "#",
];

#[derive(Clone, Debug)]
pub struct GraptorConfig {
    pub chunk_size: usize,
    pub overlap: usize,
    pub parent_chunk_size: usize,
    pub parent_overlap: usize,
    chapter_keywords: Vec<String>,
}

impl Default for GraptorConfig {
    fn default() -> Self {
        Self {
            chunk_size: 500,
            overlap: 100,
            parent_chunk_size: 2_000,
            parent_overlap: 500,
            chapter_keywords: DEFAULT_CHAPTER_KEYWORDS
                .iter()
                .map(|keyword| keyword.to_string())
                .collect(),
        }
    }
}

pub struct PhoenixGraptor {
    config: GraptorConfig,
    chapter_matcher: Option<DoubleArrayAhoCorasick>,
}

#[derive(Clone, Debug, Default)]
pub struct GraptorVertex {
    pub id: String,
    pub kind: String,
    pub weight: i64,
    pub value: Value,
    pub attributes: Value,
    pub entity_id: Option<String>,
    pub search_chunk_id: Option<String>,
    pub document_id: Option<String>,
    pub chapter_id: Option<u32>,
    pub chapters: Vec<u32>,
}

#[derive(Clone, Debug, Default)]
pub struct GraptorEdge {
    pub source_id: String,
    pub target_id: String,
    pub edge_type: String,
    pub weight: i64,
    pub attributes: Value,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, Default)]
pub struct GraptorGraph {
    pub vertices: BTreeMap<String, GraptorVertex>,
    pub outgoing: BTreeMap<String, Vec<GraptorEdge>>,
    pub incoming: BTreeMap<String, Vec<GraptorEdge>>,
    pub chapter_leaves: BTreeMap<(String, u32), Vec<String>>,
}

impl GraptorGraph {
    pub fn outgoing_matching<'a>(
        &'a self,
        vertex_id: &str,
        edge_type: &'a str,
    ) -> impl Iterator<Item = &'a GraptorEdge> {
        self.outgoing_any(vertex_id)
            .filter(move |edge| edge.edge_type == edge_type)
    }

    pub fn incoming_matching<'a>(
        &'a self,
        vertex_id: &str,
        edge_type: &'a str,
    ) -> impl Iterator<Item = &'a GraptorEdge> {
        self.incoming_any(vertex_id)
            .filter(move |edge| edge.edge_type == edge_type)
    }

    pub fn outgoing_any<'a>(&'a self, vertex_id: &str) -> impl Iterator<Item = &'a GraptorEdge> {
        self.outgoing
            .get(vertex_id)
            .into_iter()
            .flat_map(|edges| edges.iter())
    }

    pub fn incoming_any<'a>(&'a self, vertex_id: &str) -> impl Iterator<Item = &'a GraptorEdge> {
        self.incoming
            .get(vertex_id)
            .into_iter()
            .flat_map(|edges| edges.iter())
    }

    pub fn chapter_leaves(
        &self,
        document_id: &str,
        chapter_id: u32,
    ) -> impl Iterator<Item = &String> {
        self.chapter_leaves
            .get(&(document_id.to_owned(), chapter_id))
            .into_iter()
            .flat_map(|leaves| leaves.iter())
    }
}

impl PhoenixGraptor {
    pub fn new(config: GraptorConfig) -> Self {
        let chapter_matcher = if config.chapter_keywords.is_empty() {
            None
        } else {
            DoubleArrayAhoCorasickBuilder::new()
                .match_kind(MatchKind::LeftmostLongest)
                .build_with_values(
                    config
                        .chapter_keywords
                        .iter()
                        .enumerate()
                        .map(|(index, keyword)| (keyword.as_bytes(), index as u32)),
                )
                .ok()
        };
        Self {
            config,
            chapter_matcher,
        }
    }

    pub fn ingest(
        &self,
        store: &PhoenixCozoStore,
        scanner: &PhoenixScanner,
        structure: &PhoenixStructure,
        request: &IngestRequest,
    ) -> Result<IngestResult, StoreError> {
        let now = now_ms();
        let mut registry = EntityRegistry::from_store(store)?;
        let mut diagnostics = Vec::new();
        let mut documents = Vec::new();
        let mut total_chapters = 0usize;
        let mut total_parents = 0usize;
        let mut total_leaves = 0usize;
        let mut total_mentions = 0usize;
        let mut total_edges = 0usize;
        let mut total_cross_chapter = 0usize;
        let mut total_discovery_candidates = 0usize;

        for document in &request.documents {
            let artifacts =
                self.process_document(document, request.session_id.as_ref(), scanner, structure, &mut registry);
            self.persist_document(store, &artifacts, &registry, now)?;
            total_chapters += artifacts.summary.chapter_count;
            total_parents += artifacts.summary.parent_count;
            total_leaves += artifacts.summary.leaf_count;
            total_mentions += artifacts.mention_count;
            total_edges += artifacts.edge_count;
            total_cross_chapter += artifacts.cross_chapter_links;
            total_discovery_candidates += artifacts.discovery_rows.len();
            diagnostics.extend(artifacts.diagnostics.clone());
            documents.push(artifacts.summary);
        }
        let result = IngestResult {
            session_id: request.session_id.clone(),
            document_count: request.documents.len(),
            warning_count: diagnostics.len(),
            documents,
            chunk_stats: Some(ChunkStats {
                documents: request.documents.len(),
                total_chapters,
                total_parents,
                total_leaves,
            }),
            graph_summary: Some(GraphSummary {
                documents: request.documents.len(),
                total_chapters,
                total_leaves,
                total_entities: registry.entities.len(),
                total_mentions: total_mentions + registry.initial_mentions as usize,
                total_edges,
                cross_chapter_links: total_cross_chapter,
            }),
            entity_summary: Some(EntitySummary {
                total_entities: registry.entities.len(),
                total_aliases: registry.total_aliases(),
                total_mentions: total_mentions + registry.initial_mentions as usize,
                multi_chapter_entities: registry.multi_chapter_entities(),
            }),
            discovery_summary: Some(DiscoverySummary {
                candidate_count: total_discovery_candidates,
                mention_count: total_discovery_candidates,
                persisted_count: total_discovery_candidates,
            }),
            retrieval_summary: Some(RetrievalSummary {
                qgram_documents: request.documents.len(),
                gldr_chunks: total_leaves,
                gldr_entities: registry.entities.len(),
                gldr_edges: total_edges,
                raptor_documents: 0,
                raptor_leaves: 0,
                raptor_enabled: false,
            }),
            relation_counts: store.relation_counts()?,
            diagnostics,
        };

        if let Some(session_id) = request.session_id.as_ref() {
            self.persist_session_manifests(store, session_id, &result, now)?;
        }

        Ok(result)
    }

    pub fn load_graph(&self, store: &PhoenixCozoStore) -> Result<GraptorGraph, StoreError> {
        load_graph_snapshot(store)
    }

    pub fn session_state(
        &self,
        store: &PhoenixCozoStore,
        session_id: &SessionId,
    ) -> Result<SessionState, StoreError> {
        load_session_state(store, session_id)
    }

    pub fn session_stats(
        &self,
        store: &PhoenixCozoStore,
        session_id: &SessionId,
    ) -> Result<SessionStats, StoreError> {
        load_session_stats(store, session_id)
    }

    pub fn graph_delta(
        &self,
        store: &PhoenixCozoStore,
        request: &GraphDeltaRequest,
    ) -> Result<GraphDeltaResult, StoreError> {
        build_graph_delta(store, request)
    }

    fn process_document(
        &self,
        document: &IngestDocument,
        session_id: Option<&SessionId>,
        scanner: &PhoenixScanner,
        structure: &PhoenixStructure,
        registry: &mut EntityRegistry,
    ) -> DocumentArtifacts {
        let note_id = document
            .note_id
            .clone()
            .unwrap_or_else(|| NoteId(document.document_id.0.clone()));
        let boundaries = self.detect_chapter_boundaries(&document.text);
        let mut chapters = build_chapter_specs(document, &boundaries);
        let mut leaves = build_leaf_chunks(document, &self.config);
        assign_leaves_to_chapters(document, &chapters, &mut leaves);
        build_parent_chunks(document, &self.config, &mut chapters, &mut leaves);

        let mut diagnostics = vec![Diagnostic {
            code: "PX_GRAPTOR_CHUNKERX2".to_owned(),
            message: format!(
                "ChunkerX2-style ingest produced {} chapters, {} parents, and {} leaves.",
                chapters.len(),
                chapters.iter().map(|chapter| chapter.parents.len()).sum::<usize>(),
                leaves.len()
            ),
        }];
        let mut chunk_rows = Vec::new();
        let mut chunkid_rows = Vec::new();
        let mut entity_ids = BTreeSet::new();
        let mut span_rows = BTreeMap::<String, Value>::new();
        let mut span_mention_rows = BTreeMap::<String, Value>::new();
        let mut evidence_rows = BTreeMap::<String, Value>::new();
        let mut discovery_rows = BTreeMap::<String, Value>::new();
        let mut edge_rows = BTreeMap::<String, Value>::new();
        let mut graph_vertex_rows = BTreeMap::<String, Value>::new();
        let mut graph_label_rows = BTreeSet::<(String, String)>::new();
        let mut graph_edge_rows = BTreeMap::<(String, String), Value>::new();
        let mut graph_property_rows = BTreeMap::<(String, String, String, i64), Value>::new();
        let mut chapter_links = BTreeMap::<(u32, u32), BTreeSet<String>>::new();
        let mut mention_count = 0usize;

        graph_vertex_rows.insert(
            document_vertex_id(&document.document_id),
            json!({
                "id": document_vertex_id(&document.document_id),
                "value": {
                    "kind": "document",
                    "documentId": document.document_id.0,
                    "noteId": note_id.0,
                    "title": document.title,
                },
                "weight": 1,
                "attributes": {
                    "scope": document.scope,
                },
            }),
        );
        graph_label_rows.insert((document_vertex_id(&document.document_id), document.title.clone()));

        for chapter in &chapters {
            chunk_rows.push(chapter_chunk_row(document, chapter, &document.scope));
            chunkid_rows.push(chapter_chunkid_row(document, chapter));
            graph_vertex_rows.insert(
                chapter_vertex_id(&document.document_id, chapter.chapter_id),
                chapter_vertex_row(document, chapter),
            );
            graph_label_rows.insert((
                chapter_vertex_id(&document.document_id, chapter.chapter_id),
                chapter.title.clone(),
            ));
            graph_edge_rows.insert(
                (
                    document_vertex_id(&document.document_id),
                    chapter_vertex_id(&document.document_id, chapter.chapter_id),
                ),
                graph_edge_row(
                    &document_vertex_id(&document.document_id),
                    &chapter_vertex_id(&document.document_id, chapter.chapter_id),
                    1,
                    "contains",
                    json!({ "kind": "contains" }),
                    None,
                ),
            );
        }

        let scan_session_id = SessionId(format!(
            "{}::{}::graptor",
            session_id
                .map(|value| value.0.clone())
                .unwrap_or_else(|| "session".to_owned()),
            document.document_id.0
        ));

        process_document_chunks(
            document,
            &note_id,
            &chapters,
            &leaves,
            &scan_session_id,
            scanner,
            structure,
            registry,
            &mut chunk_rows,
            &mut chunkid_rows,
            &mut entity_ids,
            &mut span_rows,
            &mut span_mention_rows,
            &mut evidence_rows,
            &mut discovery_rows,
            &mut edge_rows,
            &mut graph_vertex_rows,
            &mut graph_label_rows,
            &mut graph_edge_rows,
            &mut graph_property_rows,
            &mut chapter_links,
            &mut mention_count,
            &mut diagnostics,
        );

        populate_graph_properties(
            &mut graph_property_rows,
            &graph_vertex_rows,
            &graph_edge_rows,
            now_ms(),
        );

        let summary = IngestDocumentSummary {
            document_id: document.document_id.clone(),
            note_id: Some(note_id),
            chapter_count: chapters.len(),
            parent_count: chapters.iter().map(|chapter| chapter.parents.len()).sum(),
            leaf_count: leaves.len(),
            entity_count: entity_ids.len(),
            edge_count: edge_rows.len() + graph_edge_rows.len(),
            has_front_matter_chapter: chapters
                .first()
                .map(|chapter| chapter.chapter_id == 0)
                .unwrap_or(false),
        };

        let document_manifest = build_document_manifest(
            document,
            session_id,
            &summary,
            &chapters,
            &discovery_rows,
            now_ms(),
        );

        DocumentArtifacts {
            document: document.clone(),
            session_id: session_id.cloned(),
            entity_ids,
            chunk_rows,
            chunkid_rows,
            span_rows,
            span_mention_rows,
            evidence_rows,
            discovery_rows,
            edge_rows,
            graph_vertex_rows,
            graph_label_rows,
            graph_edge_rows,
            graph_property_rows,
            document_manifest,
            mention_count,
            edge_count: summary.edge_count,
            cross_chapter_links: chapter_links.len(),
            diagnostics,
            summary,
        }
    }

    fn persist_document(
        &self,
        store: &PhoenixCozoStore,
        artifacts: &DocumentArtifacts,
        registry: &EntityRegistry,
        now: i64,
    ) -> Result<(), StoreError> {
        persist_document_rows(store, artifacts, registry, now)
    }

    fn detect_chapter_boundaries(&self, text: &str) -> Vec<ChapterBoundary> {
        let Some(matcher) = &self.chapter_matcher else {
            return Vec::new();
        };
        let mut boundaries = Vec::new();
        let bytes = text.as_bytes();
        let mut last_line_start = None;
        for matched in matcher.leftmost_find_iter(bytes) {
            let (line_start, line_end) = line_bounds(bytes, matched.start());
            if last_line_start == Some(line_start) {
                continue;
            }
            last_line_start = Some(line_start);
            let line = text.get(line_start..line_end).unwrap_or_default();
            if validate_chapter_line(line).is_some() {
                boundaries.push(ChapterBoundary {
                    start: line_start,
                    title: line.trim().to_owned(),
                });
            }
        }
        let mut line_start = 0usize;
        for (offset, byte) in bytes.iter().enumerate() {
            if *byte != b'\n' && offset + 1 != bytes.len() {
                continue;
            }
            let line_end = if *byte == b'\n' { offset } else { bytes.len() };
            if boundaries.iter().any(|boundary| boundary.start == line_start) {
                line_start = offset + 1;
                continue;
            }
            let line = text.get(line_start..line_end).unwrap_or_default();
            if validate_chapter_line(line).is_some() {
                boundaries.push(ChapterBoundary {
                    start: line_start,
                    title: line.trim().to_owned(),
                });
            }
            line_start = offset + 1;
        }
        boundaries.sort_by_key(|boundary| boundary.start);
        boundaries.dedup_by_key(|boundary| boundary.start);
        boundaries
    }
}

impl Default for PhoenixGraptor {
    fn default() -> Self {
        Self::new(GraptorConfig::default())
    }
}

impl PhoenixGraptor {
    fn persist_session_manifests(
        &self,
        store: &PhoenixCozoStore,
        session_id: &SessionId,
        _result: &IngestResult,
        now: i64,
    ) -> Result<(), StoreError> {
        let state = load_session_state(store, session_id)?;
        let stats = load_session_stats(store, session_id)?;
        let narrative_id = None::<String>;
        persist_session_workspace_artifact(
            store,
            session_id,
            "graptor_session_state",
            &serde_json::to_value(&state).expect("session state json"),
            narrative_id.as_deref(),
            None,
            now,
        )?;
        persist_session_workspace_artifact(
            store,
            session_id,
            "graptor_session_stats",
            &serde_json::to_value(&stats).expect("session stats json"),
            narrative_id.as_deref(),
            None,
            now,
        )?;
        persist_session_definition(
            store,
            session_id,
            "state",
            &serde_json::to_value(&state).expect("session state json"),
            narrative_id.as_deref(),
            now,
        )?;
        persist_session_definition(
            store,
            session_id,
            "stats",
            &serde_json::to_value(&stats).expect("session stats json"),
            narrative_id.as_deref(),
            now,
        )?;
        Ok(())
    }
}

pub fn load_graph_snapshot(store: &PhoenixCozoStore) -> Result<GraptorGraph, StoreError> {
    let mut graph = GraptorGraph::default();
    for row in store.fetch_rows("graph_vertices")? {
        let Some(id) = row.get("id").and_then(Value::as_str) else {
            continue;
        };
        let value = row.get("value").cloned().unwrap_or(Value::Null);
        let attributes = row.get("attributes").cloned().unwrap_or(Value::Null);
        let kind = value
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
            .map(|value| value as u32);
        let chapters = attributes
            .get("chapters")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_u64)
                    .map(|value| value as u32)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let vertex = GraptorVertex {
            id: id.to_owned(),
            kind,
            weight: row.get("weight").and_then(Value::as_i64).unwrap_or(1),
            value,
            attributes: attributes.clone(),
            entity_id,
            search_chunk_id: search_chunk_id.clone(),
            document_id: document_id.clone(),
            chapter_id,
            chapters,
        };
        graph.vertices.insert(id.to_owned(), vertex);
        if let (Some(document_id), Some(chapter_id), Some(_)) =
            (document_id, chapter_id, search_chunk_id)
        {
            graph
                .chapter_leaves
                .entry((document_id, chapter_id))
                .or_default()
                .push(id.to_owned());
        }
    }
    for row in store.fetch_rows("graph_edges")? {
        let Some(source_id) = row.get("source_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(target_id) = row.get("target_id").and_then(Value::as_str) else {
            continue;
        };
        let edge = GraptorEdge {
            source_id: source_id.to_owned(),
            target_id: target_id.to_owned(),
            edge_type: row
                .get("edge_type")
                .and_then(Value::as_str)
                .unwrap_or("edge")
                .to_owned(),
            weight: row.get("weight").and_then(Value::as_i64).unwrap_or(1),
            attributes: row.get("attributes").cloned().unwrap_or(Value::Null),
            data: row.get("data").cloned().filter(|value| !value.is_null()),
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
    Ok(graph)
}

pub fn load_session_state(
    store: &PhoenixCozoStore,
    session_id: &SessionId,
) -> Result<SessionState, StoreError> {
    let artifact = store
        .fetch_rows("workspace_artifacts")?
        .into_iter()
        .find(|row| {
            row.get("thread_id").and_then(Value::as_str) == Some(session_id.0.as_str())
                && row.get("kind").and_then(Value::as_str) == Some("graptor_session_state")
        });
    if let Some(payload) = artifact.and_then(|row| row.get("payload").cloned()) {
        if let Ok(state) = serde_json::from_value(payload) {
            return Ok(state);
        }
    }

    let mut documents = store
        .fetch_rows("scoped_documents")?
        .into_iter()
        .filter(|row| row.get("namespace").and_then(Value::as_str) == Some("graptor.documents"))
        .filter(|row| {
            row.get("payload")
                .and_then(|value| value.get("sessionId"))
                .and_then(Value::as_str)
                == Some(session_id.0.as_str())
        })
        .filter_map(|row| {
            let payload = row.get("payload")?;
            Some(SessionDocumentState {
                document_id: DocumentId(
                    payload
                        .get("documentId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                ),
                note_id: payload
                    .get("noteId")
                    .and_then(Value::as_str)
                    .map(|value| NoteId(value.to_owned())),
                chapter_count: payload
                    .get("summary")
                    .and_then(|value| value.get("chapterCount"))
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize,
                chapter_titles: payload
                    .get("chapters")
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.get("title").and_then(Value::as_str))
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default(),
                parent_count: payload
                    .get("summary")
                    .and_then(|value| value.get("parentCount"))
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize,
                leaf_count: payload
                    .get("summary")
                    .and_then(|value| value.get("leafCount"))
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize,
                entity_count: payload
                    .get("summary")
                    .and_then(|value| value.get("entityCount"))
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize,
                discovery_count: payload
                    .get("discoveryCount")
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize,
                has_front_matter_chapter: payload
                    .get("summary")
                    .and_then(|value| value.get("hasFrontMatterChapter"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                updated_at: payload
                    .get("updatedAt")
                    .and_then(Value::as_i64)
                    .unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    documents.sort_by(|left, right| left.document_id.cmp(&right.document_id));
    Ok(SessionState {
        session_id: session_id.clone(),
        documents,
        manifest_namespaces: vec![
            "graptor.documents".to_owned(),
            "graptor.manifest".to_owned(),
            "graptor.session".to_owned(),
        ],
        updated_at: now_ms(),
    })
}

pub fn load_session_stats(
    store: &PhoenixCozoStore,
    session_id: &SessionId,
) -> Result<SessionStats, StoreError> {
    let artifact = store
        .fetch_rows("workspace_artifacts")?
        .into_iter()
        .find(|row| {
            row.get("thread_id").and_then(Value::as_str) == Some(session_id.0.as_str())
                && row.get("kind").and_then(Value::as_str) == Some("graptor_session_stats")
        });
    if let Some(payload) = artifact.and_then(|row| row.get("payload").cloned()) {
        if let Ok(stats) = serde_json::from_value(payload) {
            return Ok(stats);
        }
    }

    let state = load_session_state(store, session_id)?;
    let relation_counts = store.relation_counts()?;
    let count_for = |name: &str| {
        relation_counts
            .iter()
            .find(|count| count.relation == name)
            .map(|count| count.rows)
            .unwrap_or_default()
    };
    Ok(SessionStats {
        session_id: session_id.clone(),
        document_count: state.documents.len(),
        chapter_count: state.documents.iter().map(|document| document.chapter_count).sum(),
        parent_count: state.documents.iter().map(|document| document.parent_count).sum(),
        leaf_count: state.documents.iter().map(|document| document.leaf_count).sum(),
        entity_count: state.documents.iter().map(|document| document.entity_count).sum(),
        discovery_candidate_count: count_for("discovery_candidates"),
        graph_vertex_count: count_for("graph_vertices"),
        graph_edge_count: count_for("graph_edges"),
        span_count: count_for("spans"),
        updated_at: now_ms(),
    })
}

pub fn build_graph_delta(
    store: &PhoenixCozoStore,
    request: &GraphDeltaRequest,
) -> Result<GraphDeltaResult, StoreError> {
    let graph = load_graph_snapshot(store)?;
    let state = load_session_state(store, &request.session_id)?;
    let mut allowed_documents = state
        .documents
        .iter()
        .map(|document| document.document_id.0.clone())
        .collect::<BTreeSet<_>>();
    if !request.changed_documents.is_empty() {
        let requested = request
            .changed_documents
            .iter()
            .map(|document| document.0.clone())
            .collect::<BTreeSet<_>>();
        allowed_documents.retain(|document_id| requested.contains(document_id));
    }

    let mut diagnostics = Vec::new();
    if let Some(since_commit) = request.since_commit.as_ref() {
        diagnostics.push(Diagnostic {
            code: "PX_GRAPH_DELTA_SNAPSHOT".to_owned(),
            message: format!(
                "Graph delta is snapshot-based in v1; sinceCommit {} was treated as a hint only.",
                since_commit.0
            ),
        });
    }

    let mut chunk_ids = graph
        .vertices
        .values()
        .filter(|vertex| vertex.kind == "leaf")
        .filter(|vertex| {
            vertex
                .document_id
                .as_ref()
                .map(|document_id| allowed_documents.contains(document_id))
                .unwrap_or(false)
        })
        .map(|vertex| vertex.id.clone())
        .collect::<Vec<_>>();
    chunk_ids.sort();
    if let Some(limit) = request.limit {
        if chunk_ids.len() > limit {
            chunk_ids.truncate(limit);
            diagnostics.push(Diagnostic {
                code: "PX_GRAPH_DELTA_LIMIT".to_owned(),
                message: format!("Graph delta limited to {limit} leaf chunks for this response."),
            });
        }
    }

    let chunk_id_set = chunk_ids.iter().cloned().collect::<BTreeSet<_>>();
    let mut included_nodes = chunk_id_set.clone();
    for chunk_id in &chunk_ids {
        for edge in graph.outgoing_any(chunk_id).chain(graph.incoming_any(chunk_id)) {
            if let Some(vertex) = graph
                .vertices
                .get(if edge.source_id == *chunk_id {
                    edge.target_id.as_str()
                } else {
                    edge.source_id.as_str()
                })
            {
                if matches!(vertex.kind.as_str(), "entity" | "event") {
                    included_nodes.insert(vertex.id.clone());
                }
            }
        }
    }

    let mut extra_node_ids = included_nodes
        .iter()
        .filter(|vertex_id| !chunk_id_set.contains(*vertex_id))
        .cloned()
        .collect::<Vec<_>>();
    extra_node_ids.sort();
    let mut chunks = Vec::new();
    for chunk_id in &chunk_ids {
        let Some(vertex) = graph.vertices.get(chunk_id) else {
            continue;
        };
        let start = vertex
            .attributes
            .get("start")
            .and_then(Value::as_u64)
            .unwrap_or_default() as u32;
        let end = vertex
            .attributes
            .get("end")
            .and_then(Value::as_u64)
            .unwrap_or_default() as u32;
        let Some(document_id) = vertex.document_id.as_ref().cloned() else {
            continue;
        };
        chunks.push(GraphDeltaChunk {
            vertex_id: vertex.id.clone(),
            chunk_id: vertex.search_chunk_id.clone().unwrap_or_default(),
            document_id: DocumentId(document_id),
            note_id: vertex
                .attributes
                .get("noteId")
                .and_then(Value::as_str)
                .map(|value| NoteId(value.to_owned())),
            chapter_id: vertex.chapter_id.unwrap_or_default(),
            range: TextRange { start, end },
        });
    }

    let mut nodes = Vec::new();
    for node_id in &extra_node_ids {
        let Some(vertex) = graph.vertices.get(node_id) else {
            continue;
        };
        let label = vertex
            .value
            .get("label")
            .and_then(Value::as_str)
            .or_else(|| vertex.value.get("lemma").and_then(Value::as_str))
            .unwrap_or(vertex.id.as_str())
            .to_owned();
        nodes.push(GraphDeltaNode {
            node_id: vertex.id.clone(),
            kind: vertex.kind.clone(),
            label,
            entity_id: vertex.entity_id.as_ref().map(|value| EntityId(value.clone())),
            document_id: vertex.document_id.as_ref().map(|value| DocumentId(value.clone())),
            chapter_id: vertex.chapter_id,
            weight: vertex.weight as i32,
        });
    }

    let mut edges = Vec::new();
    let mut edge_keys = BTreeSet::new();
    for vertex_id in &included_nodes {
        for edge in graph.outgoing_any(vertex_id) {
            if included_nodes.contains(&edge.target_id)
                && edge_keys.insert((
                    edge.source_id.clone(),
                    edge.target_id.clone(),
                    edge.edge_type.clone(),
                ))
            {
                edges.push(GraphDeltaEdge {
                    source_id: edge.source_id.clone(),
                    target_id: edge.target_id.clone(),
                    edge_type: edge.edge_type.clone(),
                    weight: edge.weight as i32,
                });
            }
        }
    }
    edges.sort_by(|left, right| {
        (&left.source_id, &left.target_id, &left.edge_type).cmp(&(
            &right.source_id,
            &right.target_id,
            &right.edge_type,
        ))
    });

    Ok(GraphDeltaResult {
        session_id: request.session_id.clone(),
        chunks,
        nodes,
        edges,
        diagnostics,
    })
}


#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BoundaryKind {
    Chapter,
    Section,
}

#[derive(Clone, Debug)]
struct ChapterBoundary {
    start: usize,
    title: String,
}

#[derive(Clone, Debug)]
struct ChapterSpec {
    chunk_id: i64,
    chapter_id: u32,
    start: usize,
    end: usize,
    title: String,
    parents: Vec<ParentChunk>,
}

#[derive(Clone, Debug)]
struct ParentChunk {
    chunk_id: i64,
    start: usize,
    end: usize,
    text: String,
}

#[derive(Clone, Debug)]
struct LeafChunk {
    chunk_id: i64,
    search_id: String,
    chapter_id: u32,
    parent_id: Option<i64>,
    start: usize,
    end: usize,
    text: String,
}

#[derive(Clone, Debug)]
struct MentionRecord {
    entity_id: EntityId,
    surface: String,
    range: TextRange,
    absolute_range: TextRange,
    confidence: f32,
    span_id: String,
    span_mention_id: String,
}

#[derive(Clone, Debug)]
struct DiscoveryRecord {
    key: String,
    chapter_id: u32,
    range: TextRange,
    confidence: f32,
}

#[derive(Clone, Debug)]
struct EntityState {
    id: EntityId,
    label: String,
    kind: EntityKind,
    aliases: BTreeSet<String>,
    chapters: BTreeSet<u32>,
    total_mentions: u32,
}

#[derive(Default)]
struct EntityRegistry {
    entities: BTreeMap<String, EntityState>,
    surfaces: BTreeMap<String, EntityId>,
    cooccurrence: BTreeMap<(String, String, String), u32>,
    initial_mentions: u32,
}

#[derive(Clone, Debug)]
struct DocumentArtifacts {
    document: IngestDocument,
    session_id: Option<SessionId>,
    entity_ids: BTreeSet<String>,
    chunk_rows: Vec<Value>,
    chunkid_rows: Vec<Value>,
    span_rows: BTreeMap<String, Value>,
    span_mention_rows: BTreeMap<String, Value>,
    evidence_rows: BTreeMap<String, Value>,
    discovery_rows: BTreeMap<String, Value>,
    edge_rows: BTreeMap<String, Value>,
    graph_vertex_rows: BTreeMap<String, Value>,
    graph_label_rows: BTreeSet<(String, String)>,
    graph_edge_rows: BTreeMap<(String, String), Value>,
    graph_property_rows: BTreeMap<(String, String, String, i64), Value>,
    document_manifest: Value,
    mention_count: usize,
    edge_count: usize,
    cross_chapter_links: usize,
    diagnostics: Vec<Diagnostic>,
    summary: IngestDocumentSummary,
}

impl EntityRegistry {
    fn from_store(store: &PhoenixCozoStore) -> Result<Self, StoreError> {
        let mut registry = Self::default();
        for row in store.fetch_rows("entities")? {
            let Some(id) = row.get("id").and_then(Value::as_str) else {
                continue;
            };
            let label = row
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let aliases = row
                .get("aliases")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect::<BTreeSet<_>>()
                })
                .unwrap_or_default();
            let total_mentions = row
                .get("total_mentions")
                .and_then(Value::as_u64)
                .unwrap_or_default() as u32;
            let entity = EntityState {
                id: EntityId(id.to_owned()),
                label: label.clone(),
                kind: kind_from_string(row.get("kind").and_then(Value::as_str).unwrap_or("Other")),
                aliases: aliases.clone(),
                chapters: BTreeSet::new(),
                total_mentions,
            };
            registry.initial_mentions += total_mentions;
            registry.surfaces.insert(normalize_key(&label), entity.id.clone());
            for alias in &aliases {
                registry
                    .surfaces
                    .insert(normalize_key(alias), entity.id.clone());
            }
            registry.entities.insert(entity.id.0.clone(), entity);
        }
        Ok(registry)
    }

    fn resolver_seed(&self, scope: &ScopeKey) -> Vec<ResolverEntitySeed> {
        self.entities
            .values()
            .map(|entity| ResolverEntitySeed {
                entity_id: entity.id.clone(),
                canonical_name: entity.label.clone(),
                aliases: entity.aliases.iter().cloned().collect(),
                kind: Some(entity.kind.clone()),
                gender: Some(GenderHint::Unknown),
                number: None,
                scope: scope.clone(),
            })
            .collect()
    }

    fn resolve_or_register(
        &mut self,
        surface: &str,
        explicit_id: Option<&EntityId>,
        kind: Option<EntityKind>,
        chapter_id: u32,
    ) -> EntityId {
        if let Some(explicit_id) = explicit_id {
            let entry = self.entities.entry(explicit_id.0.clone()).or_insert_with(|| EntityState {
                id: explicit_id.clone(),
                label: surface.to_owned(),
                kind: kind.clone().unwrap_or(EntityKind::Other),
                aliases: BTreeSet::new(),
                chapters: BTreeSet::new(),
                total_mentions: 0,
            });
            entry.chapters.insert(chapter_id);
            self.surfaces
                .insert(normalize_key(surface), explicit_id.clone());
            return explicit_id.clone();
        }

        let normalized = normalize_key(surface);
        if let Some(existing) = self.surfaces.get(&normalized) {
            if let Some(entity) = self.entities.get_mut(&existing.0) {
                entity.chapters.insert(chapter_id);
            }
            return existing.clone();
        }

        let entity_id = EntityId(format!("entity-{}", stable_hex("entity", &[normalized.as_str()])));
        self.entities.insert(
            entity_id.0.clone(),
            EntityState {
                id: entity_id.clone(),
                label: surface.to_owned(),
                kind: kind.unwrap_or(EntityKind::Other),
                aliases: BTreeSet::new(),
                chapters: BTreeSet::from([chapter_id]),
                total_mentions: 0,
            },
        );
        self.surfaces.insert(normalized, entity_id.clone());
        entity_id
    }

    fn add_alias(&mut self, entity_id: &EntityId, alias: &str) {
        if let Some(entity) = self.entities.get_mut(&entity_id.0) {
            if normalize_key(alias) == normalize_key(&entity.label) {
                return;
            }
            entity.aliases.insert(alias.to_owned());
            self.surfaces
                .insert(normalize_key(alias), entity_id.clone());
        }
    }

    fn record_mention(&mut self, entity_id: &EntityId, chapter_id: u32) {
        if let Some(entity) = self.entities.get_mut(&entity_id.0) {
            entity.total_mentions += 1;
            entity.chapters.insert(chapter_id);
        }
    }

    fn record_cooccurrence(&mut self, document: &IngestDocument, entity_ids: Vec<EntityId>) {
        let unique = entity_ids
            .into_iter()
            .map(|entity_id| entity_id.0)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        for index in 0..unique.len() {
            for next in index + 1..unique.len() {
                let (left, right) = if unique[index] <= unique[next] {
                    (unique[index].clone(), unique[next].clone())
                } else {
                    (unique[next].clone(), unique[index].clone())
                };
                *self
                    .cooccurrence
                    .entry((document.document_id.0.clone(), left, right))
                    .or_insert(0) += 1;
            }
        }
    }

    fn cooccurrence_rows(&self, document: &IngestDocument) -> Vec<Value> {
        self.cooccurrence
            .iter()
            .filter_map(|((doc_id, left, right), count)| {
                if doc_id != &document.document_id.0 {
                    return None;
                }
                Some(json!({
                    "id": stable_hex("edge", &[doc_id.as_str(), left.as_str(), right.as_str(), "cooccurs"]),
                    "source_id": left,
                    "target_id": right,
                    "rel_type": "cooccurs",
                    "confidence": *count as f64,
                    "bidirectional": true,
                    "source_note": document.note_id.as_ref().map(|value| value.0.clone()).unwrap_or_else(|| document.document_id.0.clone()),
                    "created_at": now_ms(),
                }))
            })
            .collect()
    }

    fn total_aliases(&self) -> usize {
        self.entities.values().map(|entity| entity.aliases.len()).sum()
    }

    fn multi_chapter_entities(&self) -> usize {
        self.entities
            .values()
            .filter(|entity| entity.chapters.len() > 1)
            .count()
    }
}

fn build_chapter_specs(document: &IngestDocument, boundaries: &[ChapterBoundary]) -> Vec<ChapterSpec> {
    if boundaries.is_empty() {
        return vec![ChapterSpec {
            chunk_id: stable_int("chunk", &[document.document_id.0.as_str(), "2", "0", &document.text.len().to_string()]),
            chapter_id: 0,
            start: 0,
            end: document.text.len(),
            title: "document".to_owned(),
            parents: Vec::new(),
        }];
    }

    let mut chapters = Vec::new();
    let mut next_id = 1u32;
    if boundaries[0].start > 0 && document.text[..boundaries[0].start].trim().len() > 0 {
        chapters.push(ChapterSpec {
            chunk_id: stable_int("chunk", &[document.document_id.0.as_str(), "2", "0", &boundaries[0].start.to_string()]),
            chapter_id: 0,
            start: 0,
            end: boundaries[0].start,
            title: "front matter".to_owned(),
            parents: Vec::new(),
        });
    }
    for (index, boundary) in boundaries.iter().enumerate() {
        let end = boundaries
            .get(index + 1)
            .map(|next| next.start)
            .unwrap_or(document.text.len());
        chapters.push(ChapterSpec {
            chunk_id: stable_int(
                "chunk",
                &[
                    document.document_id.0.as_str(),
                    "2",
                    &boundary.start.to_string(),
                    &end.to_string(),
                ],
            ),
            chapter_id: next_id,
            start: boundary.start,
            end,
            title: boundary.title.clone(),
            parents: Vec::new(),
        });
        next_id += 1;
    }
    chapters
}

fn build_leaf_chunks(document: &IngestDocument, config: &GraptorConfig) -> Vec<LeafChunk> {
    let sentences = split_sentences(&document.text);
    if sentences.is_empty() {
        return Vec::new();
    }

    let mut leaves = Vec::new();
    let mut window = Vec::<TextRange>::new();
    let mut current_len = 0usize;

    let emit = |window: &[TextRange], leaves: &mut Vec<LeafChunk>| {
        if window.is_empty() {
            return;
        }
        let start = window[0].start as usize;
        let end = window[window.len() - 1].end as usize;
        leaves.push(LeafChunk {
            chunk_id: stable_int(
                "chunk",
                &[document.document_id.0.as_str(), "0", &start.to_string(), &end.to_string()],
            ),
            search_id: String::new(),
            chapter_id: 0,
            parent_id: None,
            start,
            end,
            text: preserve_offsets_slice(&document.text[start..end]),
        });
    };

    for sentence in sentences {
        let sentence_len = (sentence.end - sentence.start) as usize;
        if current_len > 0 && current_len + sentence_len > config.chunk_size {
            emit(&window, &mut leaves);
            let mut overlap_len = 0usize;
            let mut new_window = Vec::new();
            for span in window.iter().rev() {
                let span_len = (span.end - span.start) as usize;
                if overlap_len + span_len > config.overlap {
                    break;
                }
                overlap_len += span_len;
                new_window.push(*span);
            }
            new_window.reverse();
            window = new_window;
            current_len = overlap_len;
        }
        window.push(sentence);
        current_len += sentence_len;
    }
    emit(&window, &mut leaves);
    leaves
}

fn assign_leaves_to_chapters(document: &IngestDocument, chapters: &[ChapterSpec], leaves: &mut [LeafChunk]) {
    for leaf in leaves {
        let mut best_chapter = chapters.first().map(|chapter| chapter.chapter_id).unwrap_or(0);
        let mut best_overlap = 0usize;
        for chapter in chapters {
            let overlap = overlap_len(leaf.start, leaf.end, chapter.start, chapter.end);
            if overlap > best_overlap {
                best_overlap = overlap;
                best_chapter = chapter.chapter_id;
            }
        }
        leaf.chapter_id = best_chapter;
        leaf.search_id = format!(
            "{}:{}:{}:{}-{}",
            document.document_id.0, leaf.chapter_id, leaf.chunk_id, leaf.start, leaf.end
        );
    }
}

fn build_parent_chunks(
    document: &IngestDocument,
    config: &GraptorConfig,
    chapters: &mut [ChapterSpec],
    leaves: &mut [LeafChunk],
) {
    for chapter in chapters {
        let indices = leaves
            .iter()
            .enumerate()
            .filter_map(|(index, leaf)| (leaf.chapter_id == chapter.chapter_id).then_some(index))
            .collect::<Vec<_>>();
        if indices.is_empty() {
            continue;
        }
        let mut start_index = 0usize;
        while start_index < indices.len() {
            let first = &leaves[indices[start_index]];
            let mut end_index = start_index;
            let mut current_len = 0usize;
            while end_index < indices.len() {
                let leaf = &leaves[indices[end_index]];
                let leaf_len = leaf.end - leaf.start;
                if current_len > 0 && current_len + leaf_len > config.parent_chunk_size {
                    break;
                }
                current_len += leaf_len;
                end_index += 1;
            }
            let last = &leaves[indices[end_index - 1]];
            let parent_id = stable_int(
                "chunk",
                &[
                    document.document_id.0.as_str(),
                    "1",
                    &first.start.to_string(),
                    &last.end.to_string(),
                ],
            );
            chapter.parents.push(ParentChunk {
                chunk_id: parent_id,
                start: first.start,
                end: last.end,
                text: preserve_offsets_slice(&document.text[first.start..last.end]),
            });
            for index in &indices[start_index..end_index] {
                leaves[*index].parent_id = Some(parent_id);
            }

            if end_index >= indices.len() {
                break;
            }
            let mut overlap_len = 0usize;
            let mut new_start = end_index;
            for index in (start_index..end_index).rev() {
                let leaf = &leaves[indices[index]];
                let leaf_len = leaf.end - leaf.start;
                if overlap_len + leaf_len > config.parent_overlap {
                    break;
                }
                overlap_len += leaf_len;
                new_start = index;
            }
            start_index = if new_start == start_index {
                end_index
            } else {
                new_start
            };
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn process_document_chunks(
    document: &IngestDocument,
    note_id: &NoteId,
    chapters: &[ChapterSpec],
    leaves: &[LeafChunk],
    scan_session_id: &SessionId,
    scanner: &PhoenixScanner,
    structure: &PhoenixStructure,
    registry: &mut EntityRegistry,
    chunk_rows: &mut Vec<Value>,
    chunkid_rows: &mut Vec<Value>,
    entity_ids: &mut BTreeSet<String>,
    span_rows: &mut BTreeMap<String, Value>,
    span_mention_rows: &mut BTreeMap<String, Value>,
    evidence_rows: &mut BTreeMap<String, Value>,
    discovery_rows: &mut BTreeMap<String, Value>,
    edge_rows: &mut BTreeMap<String, Value>,
    graph_vertex_rows: &mut BTreeMap<String, Value>,
    graph_label_rows: &mut BTreeSet<(String, String)>,
    graph_edge_rows: &mut BTreeMap<(String, String), Value>,
    graph_property_rows: &mut BTreeMap<(String, String, String, i64), Value>,
    chapter_links: &mut BTreeMap<(u32, u32), BTreeSet<String>>,
    mention_count: &mut usize,
    diagnostics: &mut Vec<Diagnostic>,
) {
    for chapter in chapters {
        for parent in &chapter.parents {
            chunk_rows.push(parent_chunk_row(document, parent, &document.scope));
            chunkid_rows.push(parent_chunkid_row(document, chapter, parent));
            let parent_vertex = parent_vertex_id(parent.chunk_id);
            graph_vertex_rows.insert(parent_vertex.clone(), parent_vertex_row(document, chapter, parent));
            graph_edge_rows.insert(
                (
                    chapter_vertex_id(&document.document_id, chapter.chapter_id),
                    parent_vertex.clone(),
                ),
                graph_edge_row(
                    &chapter_vertex_id(&document.document_id, chapter.chapter_id),
                    &parent_vertex,
                    1,
                    "contains",
                    json!({ "kind": "contains" }),
                    None,
                ),
            );
        }
    }

    for leaf in leaves {
        chunk_rows.push(leaf_chunk_row(document, leaf, &document.scope));
        chunkid_rows.push(leaf_chunkid_row(document, leaf));
        let chapter = chapters
            .iter()
            .find(|chapter| chapter.chapter_id == leaf.chapter_id)
            .expect("leaf chapter should exist");
        let leaf_vertex = leaf_vertex_id(&leaf.search_id);
        graph_vertex_rows.insert(leaf_vertex.clone(), leaf_vertex_row(document, note_id, chapter, leaf));
        graph_label_rows.insert((leaf_vertex.clone(), leaf.search_id.clone()));
        let parent_or_chapter = leaf
            .parent_id
            .map(parent_vertex_id)
            .unwrap_or_else(|| chapter_vertex_id(&document.document_id, leaf.chapter_id));
        graph_edge_rows.insert(
            (parent_or_chapter.clone(), leaf_vertex.clone()),
            graph_edge_row(
                &parent_or_chapter,
                &leaf_vertex,
                1,
                "contains",
                json!({ "kind": "contains" }),
                None,
            ),
        );

        let scan = scanner.scan(&ScanRequest {
            text: leaf.text.clone(),
            scope: document.scope.clone(),
            session_id: Some(scan_session_id.clone()),
            resolver_seed: registry.resolver_seed(&document.scope),
        });
        let structure_artifact = structure.build(&StructureRequest {
            text: leaf.text.clone(),
            scan: scan.clone(),
        });

        let (mentions, discoveries) =
            resolve_mentions(document, note_id, leaf, &scan, registry, chapter_links);
        *mention_count += mentions.len();
        if !mentions.is_empty() {
            diagnostics.push(Diagnostic {
                code: "PX_GRAPTOR_LEAF".to_owned(),
                message: format!(
                    "Leaf {} yielded {} entity mentions and {} relation candidates.",
                    leaf.search_id,
                    mentions.len(),
                    structure_artifact.relations.len()
                ),
            });
        }
        if !discoveries.is_empty() {
            diagnostics.push(Diagnostic {
                code: "PX_GRAPTOR_DISCOVERY".to_owned(),
                message: format!(
                    "Leaf {} produced {} speculative discovery candidates.",
                    leaf.search_id,
                    discoveries.len()
                ),
            });
        }

        for discovery in discoveries {
            discovery_rows.insert(
                discovery_row_id(document, &discovery),
                discovery_row(document, &discovery),
            );
        }

        for mention in &mentions {
            entity_ids.insert(mention.entity_id.0.clone());
            span_rows.insert(
                mention.span_id.clone(),
                mention_span_row(document, note_id, mention),
            );
            span_mention_rows.insert(
                mention.span_mention_id.clone(),
                mention_span_mention_row(mention),
            );
            let entity_vertex = entity_vertex_id(&mention.entity_id);
            let entity = registry
                .entities
                .get(&mention.entity_id.0)
                .expect("entity should exist");
            graph_vertex_rows
                .entry(entity_vertex.clone())
                .or_insert_with(|| entity_vertex_row(entity));
            graph_label_rows.insert((entity_vertex.clone(), entity.label.clone()));
            for alias in &entity.aliases {
                graph_label_rows.insert((entity_vertex.clone(), alias.clone()));
            }
            graph_edge_rows.insert(
                (leaf_vertex.clone(), entity_vertex.clone()),
                graph_edge_row(
                    &leaf_vertex,
                    &entity_vertex,
                    max(1, (mention.confidence * 100.0).round() as i64),
                    "mentions",
                    json!({ "confidence": mention.confidence }),
                    None,
                ),
            );
        }

        record_graph_property(
            graph_property_rows,
            &leaf_vertex,
            "vertex",
            "chunk.text",
            json!(leaf.text),
            now_ms(),
        );

        apply_alias_candidates(&scan, &mentions, registry);
        for evidence in build_absolute_evidence(document, note_id, leaf, &structure_artifact.evidence_spans) {
            evidence_rows.insert(evidence_id(note_id, &evidence), evidence_row(document, note_id, &evidence));
        }
        materialize_relations(
            document,
            note_id,
            leaf,
            &structure_artifact.relations,
            &mentions,
            edge_rows,
            graph_vertex_rows,
            graph_label_rows,
            graph_edge_rows,
            evidence_rows,
        );
        registry.record_cooccurrence(
            document,
            mentions
                .iter()
                .map(|mention| mention.entity_id.clone())
                .collect(),
        );
    }

    for edge in registry.cooccurrence_rows(document) {
        let edge_id = edge["id"].as_str().unwrap_or_default().to_owned();
        let left = edge["source_id"].as_str().unwrap_or_default().to_owned();
        let right = edge["target_id"].as_str().unwrap_or_default().to_owned();
        let count = edge["confidence"].as_f64().unwrap_or(1.0) as i64;
        edge_rows.insert(edge_id, edge);
        graph_edge_rows.insert(
            (
                entity_vertex_id(&EntityId(left.clone())),
                entity_vertex_id(&EntityId(right.clone())),
            ),
            graph_edge_row(
                &entity_vertex_id(&EntityId(left.clone())),
                &entity_vertex_id(&EntityId(right.clone())),
                count,
                "cooccurs",
                json!({ "count": count }),
                None,
            ),
        );
        graph_edge_rows.insert(
            (
                entity_vertex_id(&EntityId(right.clone())),
                entity_vertex_id(&EntityId(left.clone())),
            ),
            graph_edge_row(
                &entity_vertex_id(&EntityId(right)),
                &entity_vertex_id(&EntityId(left)),
                count,
                "cooccurs",
                json!({ "count": count }),
                None,
            ),
        );
    }

    for ((left, right), shared_entities) in chapter_links.iter() {
        let edge_id = stable_hex(
            "edge",
            &[
                document.document_id.0.as_str(),
                &left.to_string(),
                &right.to_string(),
                "cross_chapter",
            ],
        );
        edge_rows.insert(
            edge_id.clone(),
            json!({
                "id": edge_id,
                "source_id": chapter_vertex_id(&document.document_id, *left),
                "target_id": chapter_vertex_id(&document.document_id, *right),
                "rel_type": "cross_chapter",
                "confidence": shared_entities.len() as f64,
                "bidirectional": true,
                "source_note": note_id.0,
                "created_at": now_ms(),
            }),
        );
        graph_edge_rows.insert(
            (
                chapter_vertex_id(&document.document_id, *left),
                chapter_vertex_id(&document.document_id, *right),
            ),
            graph_edge_row(
                &chapter_vertex_id(&document.document_id, *left),
                &chapter_vertex_id(&document.document_id, *right),
                shared_entities.len() as i64,
                "cross_chapter",
                json!({ "sharedEntityCount": shared_entities.len() }),
                Some(json!({ "sharedEntities": shared_entities })),
            ),
        );
    }
}

fn persist_document_rows(
    store: &PhoenixCozoStore,
    artifacts: &DocumentArtifacts,
    registry: &EntityRegistry,
    now: i64,
) -> Result<(), StoreError> {
    let note_id = artifacts.summary.note_id.as_ref().expect("note id");
    store.put_row(
        "notes",
        json!({
            "id": note_id.0,
            "version": 1,
            "world_id": artifacts.document.scope.world_id.clone().unwrap_or_default(),
            "title": artifacts.document.title,
            "content": artifacts.document.text,
            "markdown_content": artifacts.document.text,
            "folder_id": artifacts.document.scope.folder_id,
            "entity_kind": null,
            "entity_subtype": null,
            "is_entity": false,
            "is_pinned": false,
            "favorite": false,
            "owner_id": artifacts.document.document_id.0,
            "narrative_id": artifacts.document.scope.narrative_id,
            "order": null,
            "created_at": now,
            "updated_at": now,
            "valid_from": now,
            "valid_to": null,
            "is_current": true,
            "change_reason": "phoenix_graptor_ingest",
        }),
    )?;
    store.put_row(
        "docid_map",
        json!({
            "id": stable_int("docid", &[artifacts.document.document_id.0.as_str()]),
            "docid": artifacts.document.document_id.0,
            "created_at": now,
        }),
    )?;
    for row in &artifacts.chunk_rows {
        store.put_row("chunks", row.clone())?;
    }
    for row in &artifacts.chunkid_rows {
        store.put_row("chunkid_map", row.clone())?;
    }
    for entity_id in &artifacts.entity_ids {
        let entity = registry.entities.get(entity_id).expect("entity should exist");
        store.put_row("entities", entity_row(entity, &artifacts.document.scope, note_id, now))?;
    }
    for row in artifacts.span_rows.values() {
        store.put_row("spans", row.clone())?;
    }
    for row in artifacts.span_mention_rows.values() {
        store.put_row("span_mentions", row.clone())?;
    }
    for row in artifacts.evidence_rows.values() {
        store.put_row("spans", row.clone())?;
    }
    for row in artifacts.discovery_rows.values() {
        store.put_row("discovery_candidates", row.clone())?;
    }
    for row in artifacts.edge_rows.values() {
        store.put_row("edges", row.clone())?;
    }
    for row in artifacts.graph_vertex_rows.values() {
        store.put_row("graph_vertices", row.clone())?;
    }
    for (vertex_id, label) in &artifacts.graph_label_rows {
        store.put_row("graph_vertex_labels", json!({ "vertex_id": vertex_id, "label": label }))?;
    }
    for row in artifacts.graph_edge_rows.values() {
        store.put_row("graph_edges", row.clone())?;
    }
    for row in artifacts.graph_property_rows.values() {
        store.put_row("graph_properties", row.clone())?;
    }
    store.put_row(
        "scoped_documents",
        scoped_document_row(&artifacts.document, &artifacts.document_manifest, now),
    )?;
    store.put_row(
        "scoped_definitions",
        scoped_document_definition_row(&artifacts.document, &artifacts.document_manifest, now),
    )?;
    for entity_id in &artifacts.entity_ids {
        let entity = registry.entities.get(entity_id).expect("entity should exist");
        store.put_row(
            "scoped_entity_fields",
            scoped_entity_field_row(
                &artifacts.document,
                artifacts.session_id.as_ref(),
                entity,
                now,
            ),
        )?;
    }
    Ok(())
}

fn build_document_manifest(
    document: &IngestDocument,
    session_id: Option<&SessionId>,
    summary: &IngestDocumentSummary,
    chapters: &[ChapterSpec],
    discovery_rows: &BTreeMap<String, Value>,
    now: i64,
) -> Value {
    json!({
        "documentId": document.document_id.0,
        "sessionId": session_id.map(|value| value.0.clone()),
        "noteId": summary.note_id.as_ref().map(|id| id.0.clone()),
        "title": document.title,
        "scope": document.scope,
        "summary": summary,
        "discoveryCount": discovery_rows.len(),
        "chapters": chapters.iter().map(|chapter| {
            json!({
                "chapterId": chapter.chapter_id,
                "title": chapter.title,
                "start": chapter.start,
                "end": chapter.end,
                "parentCount": chapter.parents.len(),
                "parentIds": chapter.parents.iter().map(|parent| parent.chunk_id).collect::<Vec<_>>(),
            })
        }).collect::<Vec<_>>(),
        "updatedAt": now,
    })
}

fn scoped_document_row(document: &IngestDocument, payload: &Value, now: i64) -> Value {
    json!({
        "id": stable_hex("scoped_document", &[document.document_id.0.as_str()]),
        "scope_folder_id": document.scope.folder_id.clone().unwrap_or_else(|| "__root__".to_owned()),
        "narrative_id": document.scope.narrative_id.clone().unwrap_or_else(|| "__global__".to_owned()),
        "namespace": "graptor.documents",
        "document_key": document.document_id.0,
        "payload": payload,
        "seeded_from_scope_folder_id": document.scope.folder_id,
        "created_at": now,
        "updated_at": now,
    })
}

fn scoped_document_definition_row(document: &IngestDocument, payload: &Value, now: i64) -> Value {
    json!({
        "id": stable_hex("scoped_definition", &[document.document_id.0.as_str(), "manifest"]),
        "narrative_id": document.scope.narrative_id.clone().unwrap_or_else(|| "__global__".to_owned()),
        "namespace": "graptor.manifest",
        "definition_key": format!("document:{}", document.document_id.0),
        "payload": payload,
        "created_at": now,
        "updated_at": now,
    })
}

fn scoped_entity_field_row(
    document: &IngestDocument,
    session_id: Option<&SessionId>,
    entity: &EntityState,
    now: i64,
) -> Value {
    json!({
        "id": stable_hex("scoped_entity", &[document.document_id.0.as_str(), entity.id.0.as_str()]),
        "entity_id": entity.id.0,
        "scope_folder_id": document.scope.folder_id.clone().unwrap_or_else(|| "__root__".to_owned()),
        "narrative_id": document.scope.narrative_id.clone().unwrap_or_else(|| "__global__".to_owned()),
        "field_key": "graptor.registry",
        "value_json": {
            "sessionId": session_id.map(|value| value.0.clone()),
            "documentId": document.document_id.0,
            "label": entity.label,
            "kind": kind_to_string(&entity.kind),
            "aliases": entity.aliases.iter().cloned().collect::<Vec<_>>(),
            "chapters": entity.chapters.iter().copied().collect::<Vec<_>>(),
            "totalMentions": entity.total_mentions,
        },
        "seeded_from_scope_folder_id": document.scope.folder_id,
        "created_at": now,
        "updated_at": now,
    })
}

fn discovery_row_id(document: &IngestDocument, discovery: &DiscoveryRecord) -> String {
    stable_hex(
        "discovery",
        &[
            document.document_id.0.as_str(),
            discovery.key.as_str(),
            &discovery.chapter_id.to_string(),
            &discovery.range.start.to_string(),
            &discovery.range.end.to_string(),
        ],
    )
}

fn discovery_row(document: &IngestDocument, discovery: &DiscoveryRecord) -> Value {
    json!({
        "token": discovery_row_id(document, discovery),
        "kind": 0,
        "score": discovery.confidence as f64,
        "status": 1,
        "last_seen": now_ms(),
        "first_seen": now_ms(),
        "count": 1,
    })
}

fn populate_graph_properties(
    rows: &mut BTreeMap<(String, String, String, i64), Value>,
    graph_vertex_rows: &BTreeMap<String, Value>,
    graph_edge_rows: &BTreeMap<(String, String), Value>,
    now: i64,
) {
    for (vertex_id, row) in graph_vertex_rows {
        if let Some(weight) = row.get("weight") {
            record_graph_property(rows, vertex_id, "vertex", "weight", weight.clone(), now);
        }
        if let Some(value) = row.get("value") {
            record_graph_json_properties(rows, vertex_id, "vertex", "value", value, now);
        }
        if let Some(attributes) = row.get("attributes") {
            record_graph_json_properties(rows, vertex_id, "vertex", "attributes", attributes, now);
        }
    }

    for row in graph_edge_rows.values() {
        let Some(source_id) = row.get("source_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(target_id) = row.get("target_id").and_then(Value::as_str) else {
            continue;
        };
        let edge_type = row
            .get("edge_type")
            .and_then(Value::as_str)
            .unwrap_or("edge");
        let owner_id = format!("{source_id}->{target_id}::{edge_type}");
        if let Some(weight) = row.get("weight") {
            record_graph_property(rows, &owner_id, "edge", "weight", weight.clone(), now);
        }
        record_graph_property(
            rows,
            &owner_id,
            "edge",
            "edge_type",
            json!(edge_type),
            now,
        );
        if let Some(attributes) = row.get("attributes") {
            record_graph_json_properties(rows, &owner_id, "edge", "attributes", attributes, now);
        }
        if let Some(data) = row.get("data").filter(|value| !value.is_null()) {
            record_graph_json_properties(rows, &owner_id, "edge", "data", data, now);
        }
    }
}

fn record_graph_json_properties(
    rows: &mut BTreeMap<(String, String, String, i64), Value>,
    owner_id: &str,
    owner_type: &str,
    prefix: &str,
    value: &Value,
    now: i64,
) {
    record_graph_property(rows, owner_id, owner_type, prefix, value.clone(), now);
    if let Some(object) = value.as_object() {
        for (key, value) in object {
            record_graph_property(
                rows,
                owner_id,
                owner_type,
                &format!("{prefix}.{key}"),
                value.clone(),
                now,
            );
        }
    }
}

fn record_graph_property(
    rows: &mut BTreeMap<(String, String, String, i64), Value>,
    owner_id: &str,
    owner_type: &str,
    key: &str,
    value: Value,
    now: i64,
) {
    let txn_id = stable_int("graph_property", &[owner_id, owner_type, key]);
    rows.insert(
        (
            owner_id.to_owned(),
            owner_type.to_owned(),
            key.to_owned(),
            now,
        ),
        json!({
            "owner_id": owner_id,
            "owner_type": owner_type,
            "key": key,
            "valid_from": now,
            "value_type": graph_value_type(&value),
            "value_blob": value,
            "valid_until": null,
            "txn_id": txn_id,
        }),
    );
}

fn graph_value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn persist_session_workspace_artifact(
    store: &PhoenixCozoStore,
    session_id: &SessionId,
    kind: &str,
    payload: &Value,
    narrative_id: Option<&str>,
    folder_id: Option<&str>,
    now: i64,
) -> Result<(), StoreError> {
    store.put_row(
        "workspace_artifacts",
        json!({
            "key": format!("graptor:{}:{}", session_id.0, kind),
            "thread_id": session_id.0,
            "narrative_id": narrative_id.unwrap_or("__global__"),
            "folder_id": folder_id.unwrap_or("__root__"),
            "kind": kind,
            "payload": payload,
            "pinned": false,
            "produced_by": "graptor",
            "created_at": now,
            "updated_at": now,
        }),
    )
}

fn persist_session_definition(
    store: &PhoenixCozoStore,
    session_id: &SessionId,
    kind: &str,
    payload: &Value,
    narrative_id: Option<&str>,
    now: i64,
) -> Result<(), StoreError> {
    store.put_row(
        "scoped_definitions",
        json!({
            "id": stable_hex("session_definition", &[session_id.0.as_str(), kind]),
            "narrative_id": narrative_id.unwrap_or("__global__"),
            "namespace": "graptor.session",
            "definition_key": format!("{}:{}", kind, session_id.0),
            "payload": payload,
            "created_at": now,
            "updated_at": now,
        }),
    )
}

fn resolve_mentions(
    _document: &IngestDocument,
    note_id: &NoteId,
    leaf: &LeafChunk,
    scan: &phoenix_types::ScanArtifact,
    registry: &mut EntityRegistry,
    chapter_links: &mut BTreeMap<(u32, u32), BTreeSet<String>>,
) -> (Vec<MentionRecord>, Vec<DiscoveryRecord>) {
    let mut mentions = Vec::new();
    let mut discoveries = Vec::new();
    for mention in &scan.mentions {
        if mention.source == Some(MentionSource::Discovery)
            || matches!(mention.entity_ref, Some(MentionEntityRef::Speculative(_)))
        {
            discoveries.push(DiscoveryRecord {
                key: match mention.entity_ref.as_ref() {
                    Some(MentionEntityRef::Speculative(key)) => key.clone(),
                    _ => normalize_key(&mention.surface),
                },
                chapter_id: leaf.chapter_id,
                range: TextRange {
                    start: leaf.start as u32 + mention.range.start,
                    end: leaf.start as u32 + mention.range.end,
                },
                confidence: mention.confidence,
            });
            continue;
        }
        let explicit_id = match mention.entity_ref.as_ref() {
            Some(MentionEntityRef::Known(entity_id)) => Some(entity_id),
            _ => None,
        };
        let entity_id = registry.resolve_or_register(
            &mention.surface,
            explicit_id,
            mention.kind.clone(),
            leaf.chapter_id,
        );
        registry.record_mention(&entity_id, leaf.chapter_id);
        if let Some(entity) = registry.entities.get(&entity_id.0) {
            for chapter_id in entity.chapters.iter().copied().filter(|chapter| *chapter != leaf.chapter_id) {
                let key = if chapter_id < leaf.chapter_id {
                    (chapter_id, leaf.chapter_id)
                } else {
                    (leaf.chapter_id, chapter_id)
                };
                chapter_links
                    .entry(key)
                    .or_default()
                    .insert(entity.label.clone());
            }
        }
        let absolute_range = TextRange {
            start: leaf.start as u32 + mention.range.start,
            end: leaf.start as u32 + mention.range.end,
        };
        let span_id = stable_hex(
            "span",
            &[
                note_id.0.as_str(),
                entity_id.0.as_str(),
                &leaf.chapter_id.to_string(),
                &absolute_range.start.to_string(),
                &absolute_range.end.to_string(),
                mention.surface.as_str(),
            ],
        );
        mentions.push(MentionRecord {
            entity_id,
            surface: mention.surface.clone(),
            range: mention.range,
            absolute_range,
            confidence: mention.confidence,
            span_id: span_id.clone(),
            span_mention_id: stable_hex("spanmention", &[span_id.as_str(), mention.surface.as_str()]),
        });
    }
    (mentions, discoveries)
}

fn apply_alias_candidates(
    scan: &phoenix_types::ScanArtifact,
    mentions: &[MentionRecord],
    registry: &mut EntityRegistry,
) {
    for link in &scan.resolver_links {
        if link.link_kind != Some(ResolverLinkKind::AliasCandidate) {
            continue;
        }
        let Some(source) = mentions
            .iter()
            .find(|mention| overlaps(mention.range, link.source_range))
        else {
            continue;
        };
        let target = match link.target_entity.as_ref() {
            Some(MentionEntityRef::Known(entity_id)) => Some(entity_id.clone()),
            _ => mentions
                .iter()
                .find(|mention| {
                    link.target_range
                        .map(|range| overlaps(mention.range, range))
                        .unwrap_or(false)
                })
                .map(|mention| mention.entity_id.clone()),
        };
        if let Some(target) = target {
            registry.add_alias(&target, &source.surface);
        }
    }
}

fn build_absolute_evidence(
    document: &IngestDocument,
    note_id: &NoteId,
    leaf: &LeafChunk,
    evidence: &[EvidenceSpan],
) -> Vec<EvidenceSpan> {
    evidence
        .iter()
        .map(|span| EvidenceSpan {
            document_id: Some(document.document_id.clone()),
            note_id: Some(note_id.clone()),
            label: span.label.clone(),
            kind: span.kind.clone(),
            range: TextRange {
                start: leaf.start as u32 + span.range.start,
                end: leaf.start as u32 + span.range.end,
            },
        })
        .collect()
}

fn materialize_relations(
    document: &IngestDocument,
    note_id: &NoteId,
    leaf: &LeafChunk,
    relations: &[RelationCandidate],
    mentions: &[MentionRecord],
    edge_rows: &mut BTreeMap<String, Value>,
    graph_vertex_rows: &mut BTreeMap<String, Value>,
    graph_label_rows: &mut BTreeSet<(String, String)>,
    graph_edge_rows: &mut BTreeMap<(String, String), Value>,
    evidence_rows: &mut BTreeMap<String, Value>,
) {
    for relation in relations {
        let event_id = stable_hex(
            "event",
            &[
                document.document_id.0.as_str(),
                leaf.search_id.as_str(),
                relation.lemma.as_str(),
                &relation.verb_range.start.to_string(),
            ],
        );
        graph_vertex_rows.insert(
            event_id.clone(),
            json!({
                "id": event_id.clone(),
                "value": {
                    "kind": "event",
                    "lemma": relation.lemma,
                    "eventClass": relation.event_class,
                    "relationType": relation.relation_type,
                },
                "weight": 1,
                "attributes": {
                    "documentId": document.document_id.0,
                    "noteId": note_id.0,
                    "chapterId": leaf.chapter_id,
                    "searchChunkId": leaf.search_id,
                    "verbRange": relation.verb_range,
                },
            }),
        );
        graph_label_rows.insert((event_id.clone(), relation.lemma.clone()));
        graph_label_rows.insert((event_id.clone(), relation.relation_type.clone()));
        graph_edge_rows.insert(
            (leaf_vertex_id(&leaf.search_id), event_id.clone()),
            graph_edge_row(
                &leaf_vertex_id(&leaf.search_id),
                &event_id,
                1,
                "has_event",
                json!({ "kind": "event" }),
                None,
            ),
        );

        if let Some(subject_id) = resolve_slot_entity(relation.subject.as_ref(), mentions) {
            graph_edge_rows.insert(
                (entity_vertex_id(&subject_id), event_id.clone()),
                graph_edge_row(
                    &entity_vertex_id(&subject_id),
                    &event_id,
                    100,
                    "event_subject",
                    json!({ "role": "subject" }),
                    None,
                ),
            );
            if let Some(object_id) = resolve_slot_entity(relation.object.as_ref(), mentions) {
                graph_edge_rows.insert(
                    (event_id.clone(), entity_vertex_id(&object_id)),
                    graph_edge_row(
                        &event_id,
                        &entity_vertex_id(&object_id),
                        100,
                        "event_object",
                        json!({ "role": "object" }),
                        None,
                    ),
                );
                let edge_id = stable_hex(
                    "edge",
                    &[
                        document.document_id.0.as_str(),
                        subject_id.0.as_str(),
                        object_id.0.as_str(),
                        relation.relation_type.as_str(),
                        "object",
                        event_id.as_str(),
                    ],
                );
                edge_rows.insert(
                    edge_id.clone(),
                    json!({
                        "id": edge_id,
                        "source_id": subject_id.0,
                        "target_id": object_id.0,
                        "rel_type": format!("{}:object", relation.relation_type),
                        "confidence": 0.95,
                        "bidirectional": false,
                        "source_note": note_id.0,
                        "created_at": now_ms(),
                    }),
                );
            }
            if let Some(recipient_id) = resolve_slot_entity(relation.recipient.as_ref(), mentions) {
                graph_edge_rows.insert(
                    (event_id.clone(), entity_vertex_id(&recipient_id)),
                    graph_edge_row(
                        &event_id,
                        &entity_vertex_id(&recipient_id),
                        90,
                        "event_recipient",
                        json!({ "role": "recipient" }),
                        None,
                    ),
                );
                let edge_id = stable_hex(
                    "edge",
                    &[
                        document.document_id.0.as_str(),
                        subject_id.0.as_str(),
                        recipient_id.0.as_str(),
                        relation.relation_type.as_str(),
                        "recipient",
                        event_id.as_str(),
                    ],
                );
                edge_rows.insert(
                    edge_id.clone(),
                    json!({
                        "id": edge_id,
                        "source_id": subject_id.0,
                        "target_id": recipient_id.0,
                        "rel_type": format!("{}:recipient", relation.relation_type),
                        "confidence": 0.9,
                        "bidirectional": false,
                        "source_note": note_id.0,
                        "created_at": now_ms(),
                    }),
                );
            }
        }

        for evidence in &relation.evidence {
            let absolute = EvidenceSpan {
                document_id: Some(document.document_id.clone()),
                note_id: Some(note_id.clone()),
                label: evidence.label.clone(),
                kind: evidence.kind.clone(),
                range: TextRange {
                    start: leaf.start as u32 + evidence.range.start,
                    end: leaf.start as u32 + evidence.range.end,
                },
            };
            evidence_rows.insert(evidence_id(note_id, &absolute), evidence_row(document, note_id, &absolute));
        }
    }
}

fn resolve_slot_entity(slot: Option<&FrameSlot>, mentions: &[MentionRecord]) -> Option<EntityId> {
    let slot = slot?;
    match slot.entity_ref.as_ref() {
        Some(MentionEntityRef::Known(entity_id)) => Some(entity_id.clone()),
        _ => mentions
            .iter()
            .find(|mention| overlaps(mention.range, slot.range))
            .map(|mention| mention.entity_id.clone()),
    }
}

fn split_sentences(text: &str) -> Vec<TextRange> {
    let mut sentences = Vec::new();
    let mut start = 0usize;
    for (offset, ch) in text.char_indices() {
        if !matches!(ch, '.' | '!' | '?') {
            continue;
        }
        let end = offset + ch.len_utf8();
        let mut token_start = offset;
        while token_start > start {
            let Some(previous) = text[..token_start].chars().next_back() else {
                break;
            };
            if previous.is_ascii_alphanumeric() || previous == '\'' || previous == '-' {
                token_start -= previous.len_utf8();
            } else {
                break;
            }
        }
        let guard = normalize_raw(text.get(token_start..end).unwrap_or_default());
        let trimmed = guard.trim_end_matches('.');
        if (guard.len() <= 3 && is_sentence_guard(trimmed)) || trimmed.len() <= 1 {
            continue;
        }
        sentences.push(TextRange {
            start: start as u32,
            end: end as u32,
        });
        start = end;
        while start < text.len() && text.as_bytes()[start].is_ascii_whitespace() {
            start += 1;
        }
    }
    if start < text.len() {
        sentences.push(TextRange {
            start: start as u32,
            end: text.len() as u32,
        });
    }
    if sentences.is_empty() && !text.is_empty() {
        sentences.push(TextRange {
            start: 0,
            end: text.len() as u32,
        });
    }
    sentences
}

fn validate_chapter_line(line: &str) -> Option<BoundaryKind> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if trimmed.starts_with('#')
        || lower.starts_with("chapter")
        || lower.starts_with("part")
        || lower.starts_with("section")
        || lower.starts_with("introduction")
        || lower.starts_with("conclusion")
        || lower.starts_with("summary")
        || lower.starts_with("appendix")
    {
        return Some(BoundaryKind::Chapter);
    }
    if validate_numbered_section(trimmed) {
        return Some(BoundaryKind::Section);
    }
    None
}

fn validate_numbered_section(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.is_empty() || !trimmed.as_bytes()[0].is_ascii_digit() {
        return false;
    }
    let mut index = 0usize;
    let bytes = trimmed.as_bytes();
    while index < bytes.len() && (bytes[index].is_ascii_digit() || bytes[index] == b'.') {
        index += 1;
    }
    index < bytes.len() && matches!(bytes[index], b' ' | b'\t' | b':' | b')')
}

fn chapter_chunk_row(document: &IngestDocument, chapter: &ChapterSpec, scope: &ScopeKey) -> Value {
    json!({
        "chunk_id": chapter.chunk_id,
        "doc_id": document.document_id.0,
        "level": 2,
        "start": chapter.start,
        "end": chapter.end,
        "text": chapter.title,
        "parent_id": null,
        "scope_narrative": scope.narrative_id,
        "scope_folder": scope.folder_id,
        "created_at": now_ms(),
    })
}

fn chapter_chunkid_row(document: &IngestDocument, chapter: &ChapterSpec) -> Value {
    json!({
        "id": chapter.chunk_id,
        "chunk_key": format!("{}:{}:chapter", document.document_id.0, chapter.chapter_id),
        "doc_id": document.document_id.0,
        "created_at": now_ms(),
    })
}

fn chapter_vertex_row(document: &IngestDocument, chapter: &ChapterSpec) -> Value {
    json!({
        "id": chapter_vertex_id(&document.document_id, chapter.chapter_id),
        "value": {
            "kind": "chapter",
            "chapterId": chapter.chapter_id,
            "title": chapter.title,
        },
        "weight": 1,
        "attributes": {
            "documentId": document.document_id.0,
            "start": chapter.start,
            "end": chapter.end,
        },
    })
}

fn parent_chunk_row(document: &IngestDocument, parent: &ParentChunk, scope: &ScopeKey) -> Value {
    json!({
        "chunk_id": parent.chunk_id,
        "doc_id": document.document_id.0,
        "level": 1,
        "start": parent.start,
        "end": parent.end,
        "text": parent.text,
        "parent_id": null,
        "scope_narrative": scope.narrative_id,
        "scope_folder": scope.folder_id,
        "created_at": now_ms(),
    })
}

fn parent_chunkid_row(document: &IngestDocument, chapter: &ChapterSpec, parent: &ParentChunk) -> Value {
    json!({
        "id": parent.chunk_id,
        "chunk_key": format!("{}:{}:parent:{}-{}", document.document_id.0, chapter.chapter_id, parent.start, parent.end),
        "doc_id": document.document_id.0,
        "created_at": now_ms(),
    })
}

fn parent_vertex_row(document: &IngestDocument, chapter: &ChapterSpec, parent: &ParentChunk) -> Value {
    json!({
        "id": parent_vertex_id(parent.chunk_id),
        "value": {
            "kind": "parent",
            "chunkId": parent.chunk_id,
            "chapterId": chapter.chapter_id,
        },
        "weight": 1,
        "attributes": {
            "documentId": document.document_id.0,
            "start": parent.start,
            "end": parent.end,
            "chapterTitle": chapter.title,
        },
    })
}

fn leaf_chunk_row(document: &IngestDocument, leaf: &LeafChunk, scope: &ScopeKey) -> Value {
    json!({
        "chunk_id": leaf.chunk_id,
        "doc_id": document.document_id.0,
        "level": 0,
        "start": leaf.start,
        "end": leaf.end,
        "text": leaf.text,
        "parent_id": leaf.parent_id,
        "scope_narrative": scope.narrative_id,
        "scope_folder": scope.folder_id,
        "created_at": now_ms(),
    })
}

fn leaf_chunkid_row(document: &IngestDocument, leaf: &LeafChunk) -> Value {
    json!({
        "id": leaf.chunk_id,
        "chunk_key": leaf.search_id,
        "doc_id": document.document_id.0,
        "created_at": now_ms(),
    })
}

fn leaf_vertex_row(document: &IngestDocument, note_id: &NoteId, chapter: &ChapterSpec, leaf: &LeafChunk) -> Value {
    json!({
        "id": leaf_vertex_id(&leaf.search_id),
        "value": {
            "kind": "leaf",
            "searchChunkId": leaf.search_id,
            "chunkId": leaf.chunk_id,
        },
        "weight": 1,
        "attributes": {
            "documentId": document.document_id.0,
            "noteId": note_id.0,
            "chapterId": leaf.chapter_id,
            "chapterTitle": chapter.title,
            "start": leaf.start,
            "end": leaf.end,
        },
    })
}

fn entity_row(entity: &EntityState, scope: &ScopeKey, note_id: &NoteId, now: i64) -> Value {
    json!({
        "id": entity.id.0,
        "label": entity.label,
        "kind": kind_to_string(&entity.kind),
        "subtype": null,
        "aliases": entity.aliases.iter().cloned().collect::<Vec<_>>(),
        "first_note": note_id.0,
        "total_mentions": entity.total_mentions,
        "narrative_id": scope.narrative_id,
        "created_by": "graptor",
        "created_at": now,
        "updated_at": now,
    })
}

fn entity_vertex_row(entity: &EntityState) -> Value {
    json!({
        "id": entity_vertex_id(&entity.id),
        "value": {
            "kind": "entity",
            "entityId": entity.id.0,
            "label": entity.label,
            "entityKind": kind_to_string(&entity.kind),
        },
        "weight": entity.total_mentions,
        "attributes": {
            "aliases": entity.aliases.iter().cloned().collect::<Vec<_>>(),
            "chapters": entity.chapters.iter().copied().collect::<Vec<_>>(),
        },
    })
}

fn mention_span_row(document: &IngestDocument, note_id: &NoteId, mention: &MentionRecord) -> Value {
    json!({
        "id": mention.span_id,
        "world_id": document.scope.world_id,
        "note_id": note_id.0,
        "narrative_id": document.scope.narrative_id,
        "start": mention.absolute_range.start as i64,
        "end": mention.absolute_range.end as i64,
        "text": mention.surface,
        "content_hash": stable_hex("spanhash", &[mention.surface.as_str()]),
        "span_kind": "entity_mention",
        "status": "resolved",
        "created_by": "graptor",
        "created_at": now_ms(),
        "updated_at": now_ms(),
    })
}

fn mention_span_mention_row(mention: &MentionRecord) -> Value {
    json!({
        "id": mention.span_mention_id,
        "span_id": mention.span_id,
        "candidate_entity_id": mention.entity_id.0,
        "match_type": "exact",
        "confidence": mention.confidence,
        "ev_frequency": null,
        "ev_capital_ratio": null,
        "ev_context_score": null,
        "ev_cooccurrence": null,
        "status": "resolved",
        "created_at": now_ms(),
        "updated_at": now_ms(),
    })
}

fn evidence_id(note_id: &NoteId, evidence: &EvidenceSpan) -> String {
    stable_hex(
        "span",
        &[
            note_id.0.as_str(),
            evidence.kind.as_deref().unwrap_or("evidence"),
            &evidence.range.start.to_string(),
            &evidence.range.end.to_string(),
            evidence.label.as_str(),
        ],
    )
}

fn evidence_row(document: &IngestDocument, note_id: &NoteId, evidence: &EvidenceSpan) -> Value {
    json!({
        "id": evidence_id(note_id, evidence),
        "world_id": document.scope.world_id,
        "note_id": note_id.0,
        "narrative_id": document.scope.narrative_id,
        "start": evidence.range.start as i64,
        "end": evidence.range.end as i64,
        "text": evidence.label,
        "content_hash": stable_hex("spanhash", &[evidence.label.as_str()]),
        "span_kind": evidence.kind.as_deref().unwrap_or("evidence"),
        "status": "derived",
        "created_by": "graptor",
        "created_at": now_ms(),
        "updated_at": now_ms(),
    })
}

fn graph_edge_row(
    source_id: &str,
    target_id: &str,
    weight: i64,
    edge_type: &str,
    attributes: Value,
    data: Option<Value>,
) -> Value {
    json!({
        "source_id": source_id,
        "target_id": target_id,
        "weight": weight,
        "attributes": attributes,
        "data": data,
        "edge_type": edge_type,
    })
}

fn document_vertex_id(document_id: &DocumentId) -> String {
    format!("doc::{}", document_id.0)
}

fn chapter_vertex_id(document_id: &DocumentId, chapter_id: u32) -> String {
    format!("chapter::{}::{}", document_id.0, chapter_id)
}

fn parent_vertex_id(parent_id: i64) -> String {
    format!("parent::{parent_id}")
}

fn leaf_vertex_id(search_id: &str) -> String {
    format!("leaf::{search_id}")
}

fn entity_vertex_id(entity_id: &EntityId) -> String {
    format!("entity::{}", entity_id.0)
}

fn normalize_key(text: &str) -> String {
    normalize_raw(text).trim().to_owned()
}

fn preserve_offsets_slice(text: &str) -> String {
    text.chars()
        .map(|ch| if ch == '\n' { ' ' } else { ch })
        .collect()
}

fn overlaps(left: TextRange, right: TextRange) -> bool {
    left.start < right.end && right.start < left.end
}

fn overlap_len(left_start: usize, left_end: usize, right_start: usize, right_end: usize) -> usize {
    min(left_end, right_end).saturating_sub(max(left_start, right_start))
}

fn line_bounds(bytes: &[u8], position: usize) -> (usize, usize) {
    let mut start = position;
    while start > 0 && bytes[start - 1] != b'\n' {
        start -= 1;
    }
    let mut end = position;
    while end < bytes.len() && bytes[end] != b'\n' {
        end += 1;
    }
    (start, end)
}

fn kind_to_string(kind: &EntityKind) -> &'static str {
    match kind {
        EntityKind::Character => "Character",
        EntityKind::Location => "Location",
        EntityKind::Npc => "Npc",
        EntityKind::Item => "Item",
        EntityKind::Faction => "Faction",
        EntityKind::Organization => "Organization",
        EntityKind::Event => "Event",
        EntityKind::Concept => "Concept",
        EntityKind::Other => "Other",
    }
}

fn kind_from_string(value: &str) -> EntityKind {
    match value {
        "Character" => EntityKind::Character,
        "Location" => EntityKind::Location,
        "Npc" => EntityKind::Npc,
        "Item" => EntityKind::Item,
        "Faction" => EntityKind::Faction,
        "Organization" => EntityKind::Organization,
        "Event" => EntityKind::Event,
        "Concept" => EntityKind::Concept,
        _ => EntityKind::Other,
    }
}

fn stable_int(prefix: &str, parts: &[&str]) -> i64 {
    (stable_hash(prefix, parts) & 0x7fff_ffff) as i64
}

fn stable_hex(prefix: &str, parts: &[&str]) -> String {
    format!("{:016x}", stable_hash(prefix, parts))
}

fn stable_hash(prefix: &str, parts: &[&str]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in prefix.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    for part in parts {
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
        for byte in part.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

fn now_ms() -> i64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() as i64
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis() as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use phoenix_scanner::PhoenixScanner;
    use phoenix_store_cozo::PhoenixCozoStore;
    use phoenix_structure::PhoenixStructure;
    use phoenix_types::IngestRequest;

    fn sample_document(text: &str) -> IngestDocument {
        IngestDocument {
            document_id: DocumentId("doc-1".to_owned()),
            note_id: Some(NoteId("note-1".to_owned())),
            title: "Sample".to_owned(),
            text: text.to_owned(),
            scope: ScopeKey::default(),
        }
    }

    #[test]
    fn chapter_detector_picks_up_headers() {
        let graptor = PhoenixGraptor::default();
        let boundaries = graptor.detect_chapter_boundaries("# Prologue\nRyan woke up.\n\nChapter 1\nRyan ran.");
        assert_eq!(boundaries.len(), 2);
    }

    #[test]
    fn chunkerx2_style_chunks_include_parents() {
        let document = sample_document(
            "Chapter 1\nRyan woke up. Ryan sharpened the blade. Ryan left.\n\nChapter 2\nRyan found Len. Len smiled.",
        );
        let boundaries = PhoenixGraptor::default().detect_chapter_boundaries(&document.text);
        let mut chapters = build_chapter_specs(&document, &boundaries);
        let mut leaves = build_leaf_chunks(&document, &GraptorConfig::default());
        assign_leaves_to_chapters(&document, &chapters, &mut leaves);
        build_parent_chunks(&document, &GraptorConfig::default(), &mut chapters, &mut leaves);

        assert!(!leaves.is_empty());
        assert!(chapters.iter().any(|chapter| !chapter.parents.is_empty()));
        assert!(leaves.iter().all(|leaf| !leaf.search_id.is_empty()));
    }

    #[test]
    fn registry_merges_aliases_across_chapters() {
        let mut registry = EntityRegistry::default();
        let id = registry.resolve_or_register("Ryan", None, Some(EntityKind::Character), 1);
        registry.add_alias(&id, "Romano");
        let resolved = registry.resolve_or_register("Romano", None, Some(EntityKind::Character), 2);
        registry.record_mention(&id, 1);
        registry.record_mention(&resolved, 2);

        assert_eq!(id, resolved);
        assert_eq!(registry.total_aliases(), 1);
        assert_eq!(registry.multi_chapter_entities(), 1);
    }

    #[test]
    fn discovery_candidates_persist_without_promoting_canonical_entities() {
        let store = PhoenixCozoStore::new().expect("store");
        let scanner = PhoenixScanner::default();
        let structure = PhoenixStructure::default();
        let graptor = PhoenixGraptor::default();

        let result = graptor
            .ingest(
                &store,
                &scanner,
                &structure,
                &IngestRequest {
                    session_id: Some(SessionId("session-discovery".to_owned())),
                    documents: vec![IngestDocument {
                        document_id: DocumentId("doc-discovery".to_owned()),
                        note_id: None,
                        title: "Discovery".to_owned(),
                        text: "Zanthor moved fast. Zanthor returned later.".to_owned(),
                        scope: ScopeKey {
                            world_id: Some("world-1".to_owned()),
                            narrative_id: None,
                            folder_id: None,
                            folder_path: None,
                        },
                    }],
                    commit: false,
                },
            )
            .expect("ingest");

        let discovery_rows = store
            .fetch_rows("discovery_candidates")
            .expect("discovery rows");
        let entity_rows = store.fetch_rows("entities").expect("entity rows");

        assert!(
            !discovery_rows.is_empty(),
            "speculative discovery should be persisted"
        );
        assert_eq!(
            result.discovery_summary.as_ref().map(|summary| summary.persisted_count),
            Some(discovery_rows.len())
        );
        assert!(
            entity_rows.is_empty(),
            "discovery-only surfaces should not be promoted into canonical entities during ingest"
        );
    }
}
