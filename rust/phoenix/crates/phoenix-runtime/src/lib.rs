use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};

mod binary;

use phoenix_gldr::PhoenixGldr;
use phoenix_graptor::PhoenixGraptor;
use phoenix_lex::LexIndex;
use phoenix_scanner::PhoenixScanner;
use phoenix_store_cozo::{PhoenixCozoStore, SnapshotEnvelope, StoreConfig, StoreError};
use phoenix_structure::PhoenixStructure;
use phoenix_types::{
    CommitId, CommitRequest, CommitResult, CreateSessionRequest, Diagnostic, GraphDeltaRequest,
    GraphDeltaResult, IngestRequest, IngestResult, QueryRequest, QueryResult, RebuildRequest,
    RebuildResult, RuntimeConfig, RuntimeInitResult, ScanArtifact, ScanRequest, SessionId,
    SessionRecord, SessionState, SessionStats, SnapshotDto,
    StructureArtifact, StructureRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct PhoenixRuntime {
    pub config: RuntimeConfig,
    pub store: PhoenixCozoStore,
    pub scanner: PhoenixScanner,
    pub structure: PhoenixStructure,
    pub graptor: PhoenixGraptor,
    pub lex: RefCell<Option<LexIndex>>,
    pub gldr: PhoenixGldr,
}

impl PhoenixRuntime {
    pub fn new(config: RuntimeConfig) -> Result<Self, StoreError> {
        Self::open(config, None)
    }

    pub fn open(config: RuntimeConfig, storage_path: Option<PathBuf>) -> Result<Self, StoreError> {
        let store = PhoenixCozoStore::open(StoreConfig {
            mode: config.storage.clone(),
            path: storage_path,
        })?;
        Ok(Self {
            config,
            store,
            scanner: PhoenixScanner::default(),
            structure: PhoenixStructure::default(),
            graptor: PhoenixGraptor::default(),
            lex: RefCell::new(None),
            gldr: PhoenixGldr::default(),
        })
    }

    pub fn init(&self) -> Result<RuntimeInitResult, StoreError> {
        self.store.init_schema()?;
        self.rebuild_lex_index()?;
        let relation_counts = self.store.relation_counts()?;
        Ok(RuntimeInitResult {
            ready: true,
            schema_version: self.store.schema_version().to_owned(),
            relation_count: relation_counts.len(),
            relation_counts,
            diagnostics: Vec::new(),
        })
    }

    pub fn create_session(
        &self,
        request: CreateSessionRequest,
    ) -> Result<SessionRecord, StoreError> {
        let now = now_ms();
        let session_id = request
            .session_id
            .unwrap_or_else(|| SessionId(format!("session-{}", now)));
        let record = SessionRecord {
            session_id,
            label: request.label,
            scope: request.scope,
            status: "active".to_owned(),
            revision: 0,
            created_at: now,
            updated_at: now,
        };

        self.store.put_row(
            "phoenix_sessions",
            serde_json::json!({
                "session_id": record.session_id.0,
                "label": record.label,
                "world_id": record.scope.world_id,
                "narrative_id": record.scope.narrative_id,
                "folder_id": record.scope.folder_id,
                "folder_path": record.scope.folder_path,
                "status": record.status,
                "revision": record.revision,
                "created_at": record.created_at,
                "updated_at": record.updated_at,
            }),
        )?;

        Ok(record)
    }

    pub fn commit(&self, request: CommitRequest) -> Result<CommitResult, StoreError> {
        let mut session = self.load_session(&request.session_id)?;
        let committed_at = now_ms();
        session.revision += 1;
        session.updated_at = committed_at;

        self.store.put_row(
            "phoenix_sessions",
            serde_json::json!({
                "session_id": session.session_id.0,
                "label": session.label,
                "world_id": session.scope.world_id,
                "narrative_id": session.scope.narrative_id,
                "folder_id": session.scope.folder_id,
                "folder_path": session.scope.folder_path,
                "status": session.status,
                "revision": session.revision,
                "created_at": session.created_at,
                "updated_at": session.updated_at,
            }),
        )?;

        let commit_id = CommitId(format!(
            "commit-{}-{}",
            session.session_id.0, session.revision
        ));
        self.store.put_row(
            "phoenix_commits",
            serde_json::json!({
                "commit_id": commit_id.0,
                "session_id": session.session_id.0,
                "reason": request.reason,
                "revision": session.revision,
                "committed_at": committed_at,
            }),
        )?;

        Ok(CommitResult {
            session_id: session.session_id,
            commit_id,
            revision: session.revision,
            committed_at,
            relation_counts: self.store.relation_counts()?,
            diagnostics: Vec::new(),
        })
    }

    pub fn rebuild(&self, _request: RebuildRequest) -> Result<RebuildResult, StoreError> {
        let span_count = self.rebuild_lex_index()?;
        Ok(RebuildResult {
            rebuilt_at: now_ms(),
            relation_counts: self.store.relation_counts()?,
            diagnostics: vec![Diagnostic {
                code: "PX_REBUILD_LEX".to_owned(),
                message: format!("Rebuilt lexical index from {span_count} canonical spans."),
            }],
        })
    }

    pub fn ingest(&self, request: IngestRequest) -> Result<IngestResult, StoreError> {
        let created_at = now_ms();
        self.store.put_row(
            "phoenix_ingest_log",
            serde_json::json!({
                "id": format!("ingest-{}", created_at),
                "session_id": request.session_id.as_ref().map(|value| value.0.clone()),
                "document_count": request.documents.len(),
                "commit_requested": request.commit,
                "request_json": serde_json::to_value(&request).expect("ingest request json"),
                "created_at": created_at,
            }),
        )?;
        let mut ingest = self
            .graptor
            .ingest(&self.store, &self.scanner, &self.structure, &request)?;
        let mut diagnostics = ingest.diagnostics.clone();
        diagnostics.push(Diagnostic {
            code: "PX_INGEST_GRAPTOR".to_owned(),
            message: "Phoenix Graptor ingested canonical chunk and graph facts.".to_owned(),
        });

        if request.commit {
            if let Some(session_id) = request.session_id.clone() {
                let commit = self.commit(CommitRequest {
                    session_id,
                    reason: Some("graptor-ingest".to_owned()),
                })?;
                diagnostics.extend(commit.diagnostics);
            }
        }

        let span_count = self.rebuild_lex_index()?;
        diagnostics.push(Diagnostic {
            code: "PX_LEX_REBUILT".to_owned(),
            message: format!("Rebuilt lexical index from {span_count} canonical spans."),
        });
        ingest.diagnostics = diagnostics;
        ingest.warning_count = ingest.diagnostics.len();
        ingest.relation_counts = self.store.relation_counts()?;
        Ok(ingest)
    }

    pub fn query(&self, request: QueryRequest) -> Result<QueryResult, StoreError> {
        let created_at = now_ms();
        self.store.put_row(
            "phoenix_query_log",
            serde_json::json!({
                "id": format!("query-{}", created_at),
                "session_id": request.session_id.as_ref().map(|value| value.0.clone()),
                "query": request.query,
                "limit": request.limit,
                "request_json": serde_json::to_value(&request).expect("query request json"),
                "created_at": created_at,
            }),
        )?;

        self.ensure_lex_index()?;
        let graph_requested = request.targets.iter().any(|target| {
            matches!(
                target,
                phoenix_types::QueryTarget::Nodes
                    | phoenix_types::QueryTarget::Graph
                    | phoenix_types::QueryTarget::Semantic
            )
        });
        if graph_requested {
            let mut result = self.gldr.query(
                &self.store,
                self.lex
                    .borrow()
                    .as_ref()
                    .expect("lex should exist after ensure"),
                &request,
            )?;
            if request
                .targets
                .iter()
                .any(|target| matches!(target, phoenix_types::QueryTarget::Semantic))
            {
                result.diagnostics.push(Diagnostic {
                    code: "PX_QUERY_SEMANTIC_OFF".to_owned(),
                    message: "Semantic retrieval is still disabled; GLDR returned deterministic graph results only.".to_owned(),
                });
            }
            return Ok(result);
        }

        let lexical = self
            .lex
            .borrow()
            .as_ref()
            .expect("lex should exist after ensure")
            .search(&request.query, &request.scope, request.limit.unwrap_or(5));

        Ok(QueryResult {
            session_id: request.session_id,
            chunk_hits: lexical
                .span_hits
                .into_iter()
                .map(|hit| phoenix_types::ChunkHit {
                    chunk_id: hit.span_id,
                    score: hit.score,
                })
                .collect(),
            node_hits: Vec::new(),
            diagnostics: {
                let mut diagnostics = lexical.diagnostics;
                diagnostics.push(Diagnostic {
                    code: "PX_QUERY_LEX".to_owned(),
                    message: "Query executed via the Phoenix lexical facade.".to_owned(),
                });
                diagnostics
            },
        })
    }

    pub fn query_binary(&self, request: QueryRequest) -> Result<Vec<u8>, StoreError> {
        let result = self.query(request)?;
        binary::encode_query_result(&result)
    }

    pub fn graph_delta(&self, request: GraphDeltaRequest) -> Result<GraphDeltaResult, StoreError> {
        self.graptor.graph_delta(&self.store, &request)
    }

    pub fn graph_delta_binary(&self, request: GraphDeltaRequest) -> Result<Vec<u8>, StoreError> {
        let result = self.graph_delta(request)?;
        binary::encode_graph_delta(&result)
    }

    pub fn ingest_stub(&self, request: IngestRequest) -> Result<IngestResult, StoreError> {
        self.ingest(request)
    }

    pub fn query_stub(&self, request: QueryRequest) -> Result<QueryResult, StoreError> {
        self.query(request)
    }

    pub fn scan_text(&self, request: ScanRequest) -> ScanArtifact {
        self.scanner.scan(&request)
    }

    pub fn build_structure(&self, request: StructureRequest) -> StructureArtifact {
        self.structure.build(&request)
    }

    pub fn export_snapshot(&self) -> Result<Vec<u8>, StoreError> {
        self.store.export_snapshot()
    }

    pub fn import_snapshot(&self, bytes: &[u8]) -> Result<SnapshotEnvelope, StoreError> {
        let envelope = self.store.import_snapshot(bytes)?;
        *self.lex.borrow_mut() = None;
        self.rebuild_lex_index()?;
        Ok(envelope)
    }

    pub fn snapshot_descriptor(&self, created_at: i64, payload_bytes: usize) -> SnapshotDto {
        self.store.snapshot_descriptor(created_at, payload_bytes)
    }

    pub fn session_state(&self, session_id: &SessionId) -> Result<SessionState, StoreError> {
        self.graptor.session_state(&self.store, session_id)
    }

    pub fn session_stats(&self, session_id: &SessionId) -> Result<SessionStats, StoreError> {
        self.graptor.session_stats(&self.store, session_id)
    }

    pub fn session_state_binary(&self, session_id: &SessionId) -> Result<Vec<u8>, StoreError> {
        let state = self.session_state(session_id)?;
        binary::encode_session_state(&state)
    }

    pub fn session_stats_binary(&self, session_id: &SessionId) -> Result<Vec<u8>, StoreError> {
        let stats = self.session_stats(session_id)?;
        binary::encode_session_stats(&stats)
    }

    fn ensure_lex_index(&self) -> Result<(), StoreError> {
        if self.lex.borrow().is_none() {
            self.rebuild_lex_index()?;
        }
        Ok(())
    }

    fn rebuild_lex_index(&self) -> Result<usize, StoreError> {
        let mut borrow = self.lex.borrow_mut();
        let span_count = if let Some(index) = borrow.as_mut() {
            index.rebuild_from_store(&self.store)?
        } else {
            let mut index = LexIndex::default();
            let count = index.rebuild_from_store(&self.store)?;
            *borrow = Some(index);
            count
        };
        Ok(span_count)
    }

    fn load_session(&self, session_id: &SessionId) -> Result<SessionRecord, StoreError> {
        let rows = self.store.fetch_rows("phoenix_sessions")?;
        let row = rows
            .into_iter()
            .find(|row| {
                row.get("session_id").and_then(Value::as_str) == Some(session_id.0.as_str())
            })
            .ok_or_else(|| StoreError::Query(format!("session not found: {}", session_id.0)))?;
        session_record_from_row(&row)
    }
}

fn session_record_from_row(row: &Value) -> Result<SessionRecord, StoreError> {
    let object = row.as_object().ok_or(StoreError::InvalidRow)?;
    Ok(SessionRecord {
        session_id: SessionId(
            object
                .get("session_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        ),
        label: object
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        scope: phoenix_types::ScopeKey {
            world_id: object
                .get("world_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
            narrative_id: object
                .get("narrative_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
            folder_id: object
                .get("folder_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
            folder_path: object
                .get("folder_path")
                .and_then(Value::as_str)
                .map(str::to_owned),
        },
        status: object
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("active")
            .to_owned(),
        revision: object.get("revision").and_then(Value::as_u64).unwrap_or(0),
        created_at: object
            .get("created_at")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        updated_at: object
            .get("updated_at")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
    })
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

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureManifest {
    pub fixtures: Vec<GoldenFixture>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenFixture {
    pub id: String,
    pub title: String,
    pub source_path: String,
    pub document_id: String,
    pub file_path: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedFixtureBaseline {
    pub fixture_id: String,
    pub source_path: String,
    pub expected_scanner: Option<serde_json::Value>,
    pub expected_structure: Option<serde_json::Value>,
    pub expected_ingest: Option<serde_json::Value>,
    pub expected_query: Option<serde_json::Value>,
}

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .canonicalize()
        .expect("workspace root")
}

pub fn fixtures_root() -> PathBuf {
    workspace_root().join("fixtures")
}

pub fn load_fixture_manifest() -> FixtureManifest {
    let path = fixtures_root().join("manifest.json");
    let content = fs::read_to_string(path).expect("fixture manifest");
    serde_json::from_str(&content).expect("fixture manifest json")
}

pub fn load_expected_baseline(fixture_id: &str) -> ExpectedFixtureBaseline {
    let path = fixtures_root()
        .join("expected")
        .join(format!("{fixture_id}.json"));
    let content = fs::read_to_string(path).expect("expected baseline");
    serde_json::from_str(&content).expect("expected baseline json")
}

pub fn fixture_body(fixture: &GoldenFixture) -> String {
    let path = fixtures_root().join(&fixture.file_path);
    fs::read_to_string(path).expect("fixture body")
}

#[cfg(test)]
mod tests {
    use super::*;
    use phoenix_types::{
        CreateSessionRequest, DocumentId, EntityId, EntityKind, GenderHint, GraphDeltaRequest,
        MentionEntityRef, QueryResultHeader, QueryTarget, ScopeKey, SessionStateResultHeader,
        SessionStatsResultHeader,
    };
    use serde_json::{json, Value};

    #[test]
    fn fixture_manifest_loads() {
        let manifest = load_fixture_manifest();
        assert!(
            !manifest.fixtures.is_empty(),
            "fixtures should not be empty"
        );
    }

    #[test]
    fn fixture_bodies_exist_and_are_non_empty() {
        let manifest = load_fixture_manifest();

        for fixture in &manifest.fixtures {
            let body = fixture_body(fixture);
            assert!(
                !body.trim().is_empty(),
                "fixture {} should have non-empty body",
                fixture.id
            );
        }
    }

    #[test]
    fn expected_baselines_match_manifest() {
        let manifest = load_fixture_manifest();

        for fixture in &manifest.fixtures {
            let baseline = load_expected_baseline(&fixture.id);
            assert_eq!(baseline.fixture_id, fixture.id);
            assert_eq!(baseline.source_path, fixture.source_path);
        }
    }

    #[test]
    fn runtime_init_reports_schema() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let init = runtime.init().expect("init");
        assert!(init.ready);
        assert_eq!(init.schema_version, phoenix_store_cozo::SCHEMA_VERSION);
    }

    #[test]
    fn session_commit_cycle_updates_revision() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let session = runtime
            .create_session(CreateSessionRequest {
                session_id: None,
                label: "Foundation".to_owned(),
                scope: ScopeKey::default(),
            })
            .expect("session");

        let commit = runtime
            .commit(CommitRequest {
                session_id: session.session_id,
                reason: Some("phase-2".to_owned()),
            })
            .expect("commit");

        assert_eq!(commit.revision, 1);
    }

    #[test]
    fn ingest_and_query_roundtrip() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let session = runtime
            .create_session(CreateSessionRequest {
                session_id: None,
                label: "Stub".to_owned(),
                scope: ScopeKey::default(),
            })
            .expect("session");

        let ingest = runtime
            .ingest(IngestRequest {
                session_id: Some(session.session_id.clone()),
                documents: vec![phoenix_types::IngestDocument {
                    document_id: DocumentId("doc-1".to_owned()),
                    note_id: None,
                    title: "Ash Song".to_owned(),
                    text: "The phoenix rose from ash.".to_owned(),
                    scope: ScopeKey::default(),
                }],
                commit: true,
            })
            .expect("ingest");
        assert_eq!(ingest.document_count, 1);

        let query = runtime
            .query(QueryRequest {
                session_id: Some(session.session_id),
                query: "phoenix".to_owned(),
                scope: ScopeKey::default(),
                targets: vec![QueryTarget::Chunks],
                limit: Some(3),
                temporal: None,
            })
            .expect("query");

        assert_eq!(query.chunk_hits.len(), 1);
        assert!(query.chunk_hits[0].chunk_id.starts_with("doc-1:"));
    }

    #[test]
    fn session_state_and_stats_persist_after_ingest() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let session = runtime
            .create_session(CreateSessionRequest {
                session_id: None,
                label: "State".to_owned(),
                scope: ScopeKey::default(),
            })
            .expect("session");

        runtime
            .ingest(IngestRequest {
                session_id: Some(session.session_id.clone()),
                documents: vec![phoenix_types::IngestDocument {
                    document_id: DocumentId("doc-state".to_owned()),
                    note_id: None,
                    title: "Stateful".to_owned(),
                    text: "# Prologue\nRyan woke up.\n\nChapter 1\nRyan met Len.".to_owned(),
                    scope: ScopeKey::default(),
                }],
                commit: false,
            })
            .expect("ingest");

        let state = runtime
            .session_state(&session.session_id)
            .expect("session state");
        let stats = runtime
            .session_stats(&session.session_id)
            .expect("session stats");

        assert_eq!(state.documents.len(), 1);
        assert!(stats.chapter_count >= 1);
        assert!(stats.graph_vertex_count >= 1);
    }

    #[test]
    fn graph_delta_and_binary_payloads_are_rebuildable_from_canonical_state() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let session = runtime
            .create_session(CreateSessionRequest {
                session_id: None,
                label: "Binary".to_owned(),
                scope: ScopeKey::default(),
            })
            .expect("session");

        runtime
            .ingest(IngestRequest {
                session_id: Some(session.session_id.clone()),
                documents: vec![phoenix_types::IngestDocument {
                    document_id: DocumentId("doc-binary".to_owned()),
                    note_id: None,
                    title: "Binary".to_owned(),
                    text: "Ryan attacked Len. Ryan gave Len a blade.".to_owned(),
                    scope: ScopeKey::default(),
                }],
                commit: false,
            })
            .expect("ingest");

        let graph_delta = runtime
            .graph_delta(GraphDeltaRequest {
                session_id: session.session_id.clone(),
                scope: ScopeKey::default(),
                changed_documents: vec![DocumentId("doc-binary".to_owned())],
                limit: Some(8),
                since_commit: None,
            })
            .expect("graph delta");
        assert!(!graph_delta.chunks.is_empty());
        assert!(!graph_delta.edges.is_empty());

        let query_bytes = runtime
            .query_binary(QueryRequest {
                session_id: Some(session.session_id.clone()),
                query: "Ryan".to_owned(),
                scope: ScopeKey::default(),
                targets: vec![QueryTarget::Chunks],
                limit: Some(5),
                temporal: None,
            })
            .expect("query bytes");
        let graph_bytes = runtime
            .graph_delta_binary(GraphDeltaRequest {
                session_id: session.session_id.clone(),
                scope: ScopeKey::default(),
                changed_documents: vec![DocumentId("doc-binary".to_owned())],
                limit: Some(8),
                since_commit: None,
            })
            .expect("graph bytes");
        let state_bytes = runtime
            .session_state_binary(&session.session_id)
            .expect("state bytes");
        let stats_bytes = runtime
            .session_stats_binary(&session.session_id)
            .expect("stats bytes");

        assert!(query_bytes.len() >= QueryResultHeader::BYTE_LEN);
        assert!(graph_bytes.len() >= phoenix_types::GraphDeltaResultHeader::BYTE_LEN);
        assert!(state_bytes.len() >= SessionStateResultHeader::BYTE_LEN);
        assert!(stats_bytes.len() >= SessionStatsResultHeader::BYTE_LEN);
    }

    #[test]
    fn runtime_scan_and_structure_roundtrip() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let scan = runtime.scan_text(ScanRequest {
            text: "Luffy attacked Zoro.".to_owned(),
            scope: ScopeKey::default(),
            session_id: Some(SessionId("scan-1".to_owned())),
            resolver_seed: vec![
                phoenix_types::ResolverEntitySeed {
                    entity_id: EntityId("luffy".to_owned()),
                    canonical_name: "Luffy".to_owned(),
                    aliases: Vec::new(),
                    kind: Some(EntityKind::Character),
                    gender: Some(GenderHint::Male),
                    number: None,
                    scope: ScopeKey::default(),
                },
                phoenix_types::ResolverEntitySeed {
                    entity_id: EntityId("zoro".to_owned()),
                    canonical_name: "Zoro".to_owned(),
                    aliases: Vec::new(),
                    kind: Some(EntityKind::Character),
                    gender: Some(GenderHint::Male),
                    number: None,
                    scope: ScopeKey::default(),
                },
            ],
        });
        assert_eq!(scan.mentions.len(), 2);
        assert!(scan.mentions.iter().any(|mention| mention.entity_ref
            == Some(MentionEntityRef::Known(EntityId("luffy".to_owned())))));

        let structure = runtime.build_structure(StructureRequest {
            text: "Luffy attacked Zoro.".to_owned(),
            scan,
        });
        assert_eq!(structure.sentence_frames.len(), 1);
        assert_eq!(structure.sentence_frames[0].verb_frames.len(), 1);
    }

    #[test]
    fn fixture_structure_relations_match_expected_baselines() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let manifest = load_fixture_manifest();

        for fixture in &manifest.fixtures {
            let text = fixture_body(fixture);
            let scan = runtime.scan_text(ScanRequest {
                text: text.clone(),
                scope: ScopeKey::default(),
                session_id: Some(SessionId(format!("fixture-{}", fixture.id))),
                resolver_seed: fixture_resolver_seed(&fixture.id),
            });
            let structure = runtime.build_structure(StructureRequest { text, scan });
            let normalized = normalize_structure_relations(&structure);
            let baseline = load_expected_baseline(&fixture.id);
            assert_eq!(
                baseline.expected_structure,
                Some(normalized),
                "fixture {} structure relations drifted",
                fixture.id
            );
        }
    }

    fn fixture_resolver_seed(fixture_id: &str) -> Vec<phoenix_types::ResolverEntitySeed> {
        match fixture_id {
            "shortrun-opening" => vec![
                fixture_seed("ryan", "Ryan", EntityKind::Character),
                fixture_seed("bakuto", "Bakuto", EntityKind::Faction),
            ],
            "perfect-run-dialogue" => vec![
                fixture_seed("ryan", "Ryan", EntityKind::Character),
                fixture_seed("zanbato", "Zanbato", EntityKind::Character),
                fixture_seed("ghoul", "Ghoul", EntityKind::Character),
                fixture_seed("augusti", "Augusti", EntityKind::Organization),
                fixture_seed("meta_gang", "Meta-Gang", EntityKind::Faction),
                fixture_seed("len", "Len", EntityKind::Character),
            ],
            _ => Vec::new(),
        }
    }

    fn fixture_seed(
        id: &str,
        canonical_name: &str,
        kind: EntityKind,
    ) -> phoenix_types::ResolverEntitySeed {
        phoenix_types::ResolverEntitySeed {
            entity_id: EntityId(id.to_owned()),
            canonical_name: canonical_name.to_owned(),
            aliases: Vec::new(),
            kind: Some(kind),
            gender: Some(GenderHint::Unknown),
            number: None,
            scope: ScopeKey::default(),
        }
    }

    fn normalize_structure_relations(structure: &StructureArtifact) -> Value {
        json!({
            "relations": structure.relations.iter().map(|relation| {
                json!({
                    "sentenceIndex": relation.sentence_index,
                    "lemma": relation.lemma,
                    "eventClass": relation.event_class,
                    "relationType": relation.relation_type,
                    "subjectEntity": frame_slot_entity_id(relation.subject.as_ref()),
                    "objectEntity": frame_slot_entity_id(relation.object.as_ref()),
                    "recipientEntity": frame_slot_entity_id(relation.recipient.as_ref()),
                    "subjectRange": frame_slot_range(relation.subject.as_ref()),
                    "objectRange": frame_slot_range(relation.object.as_ref()),
                    "recipientRange": frame_slot_range(relation.recipient.as_ref()),
                })
            }).collect::<Vec<_>>()
        })
    }

    fn frame_slot_entity_id(slot: Option<&phoenix_types::FrameSlot>) -> Option<String> {
        slot.and_then(|slot| match &slot.entity_ref {
            Some(MentionEntityRef::Known(entity_id)) => Some(entity_id.0.clone()),
            Some(MentionEntityRef::Speculative(key)) => Some(format!("spec:{key}")),
            None => None,
        })
    }

    fn frame_slot_range(slot: Option<&phoenix_types::FrameSlot>) -> Option<Value> {
        slot.map(|slot| {
            json!({
                "start": slot.range.start,
                "end": slot.range.end,
            })
        })
    }
}
