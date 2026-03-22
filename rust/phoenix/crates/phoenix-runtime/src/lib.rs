use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use phoenix_store_cozo::{PhoenixCozoStore, SnapshotEnvelope, StoreConfig, StoreError};
use phoenix_types::{
    ChunkHit, CommitId, CommitRequest, CommitResult, CreateSessionRequest, Diagnostic,
    IngestRequest, IngestResult, QueryRequest, QueryResult, RebuildRequest, RebuildResult,
    RuntimeConfig, RuntimeInitResult, SessionId, SessionRecord, SnapshotDto,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct PhoenixRuntime {
    pub config: RuntimeConfig,
    pub store: PhoenixCozoStore,
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
        Ok(Self { config, store })
    }

    pub fn init(&self) -> Result<RuntimeInitResult, StoreError> {
        self.store.init_schema()?;
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

        let commit_id = CommitId(format!("commit-{}-{}", session.session_id.0, session.revision));
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
        Ok(RebuildResult {
            rebuilt_at: now_ms(),
            relation_counts: self.store.relation_counts()?,
            diagnostics: vec![Diagnostic {
                code: "PX_REBUILD_STUB".to_owned(),
                message: "Rebuild currently verifies canonical relation counts only.".to_owned(),
            }],
        })
    }

    pub fn ingest_stub(&self, request: IngestRequest) -> Result<IngestResult, StoreError> {
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

        for document in &request.documents {
            let note_id = document
                .note_id
                .as_ref()
                .map(|value| value.0.clone())
                .unwrap_or_else(|| document.document_id.0.clone());

            self.store.put_row(
                "notes",
                serde_json::json!({
                    "id": note_id,
                    "version": 1,
                    "world_id": document.scope.world_id.clone().unwrap_or_default(),
                    "title": document.title,
                    "content": document.text,
                    "markdown_content": document.text,
                    "folder_id": document.scope.folder_id,
                    "entity_kind": null,
                    "entity_subtype": null,
                    "is_entity": false,
                    "is_pinned": false,
                    "favorite": false,
                    "owner_id": null,
                    "narrative_id": document.scope.narrative_id,
                    "order": null,
                    "created_at": created_at,
                    "updated_at": created_at,
                    "valid_from": created_at,
                    "valid_to": null,
                    "is_current": true,
                    "change_reason": "phoenix_stub_ingest",
                }),
            )?;
        }

        let mut diagnostics = vec![Diagnostic {
            code: "PX_INGEST_STUB".to_owned(),
            message: "Stub ingest persisted documents into canonical notes only.".to_owned(),
        }];

        if request.commit {
            if let Some(session_id) = request.session_id.clone() {
                let commit = self.commit(CommitRequest {
                    session_id,
                    reason: Some("stub-ingest".to_owned()),
                })?;
                diagnostics.extend(commit.diagnostics);
            }
        }

        Ok(IngestResult {
            session_id: request.session_id,
            document_count: request.documents.len(),
            warning_count: 0,
            relation_counts: self.store.relation_counts()?,
            diagnostics,
        })
    }

    pub fn query_stub(&self, request: QueryRequest) -> Result<QueryResult, StoreError> {
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

        let needle = request.query.to_lowercase();
        let limit = request.limit.unwrap_or(5);
        let mut chunk_hits = self
            .store
            .fetch_rows("notes")?
            .into_iter()
            .filter_map(|row| {
                let content = row.get("content")?.as_str()?.to_lowercase();
                let title = row
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_lowercase();
                if content.contains(&needle) || title.contains(&needle) {
                    let id = row.get("id")?.as_str()?.to_owned();
                    Some(ChunkHit {
                        chunk_id: id,
                        score: if title.contains(&needle) { 2.0 } else { 1.0 },
                    })
                } else {
                    None
                }
            })
            .take(limit)
            .collect::<Vec<_>>();

        chunk_hits.sort_by(|left, right| right.score.total_cmp(&left.score));

        Ok(QueryResult {
            session_id: request.session_id,
            chunk_hits,
            node_hits: Vec::new(),
            diagnostics: vec![Diagnostic {
                code: "PX_QUERY_STUB".to_owned(),
                message: "Stub query performed a naive note scan over canonical notes.".to_owned(),
            }],
        })
    }

    pub fn export_snapshot(&self) -> Result<Vec<u8>, StoreError> {
        self.store.export_snapshot()
    }

    pub fn import_snapshot(&self, bytes: &[u8]) -> Result<SnapshotEnvelope, StoreError> {
        self.store.import_snapshot(bytes)
    }

    pub fn snapshot_descriptor(&self, created_at: i64, payload_bytes: usize) -> SnapshotDto {
        self.store.snapshot_descriptor(created_at, payload_bytes)
    }

    fn load_session(&self, session_id: &SessionId) -> Result<SessionRecord, StoreError> {
        let rows = self.store.fetch_rows("phoenix_sessions")?;
        let row = rows
            .into_iter()
            .find(|row| row.get("session_id").and_then(Value::as_str) == Some(session_id.0.as_str()))
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
            world_id: object.get("world_id").and_then(Value::as_str).map(str::to_owned),
            narrative_id: object
                .get("narrative_id")
                .and_then(Value::as_str)
                .map(str::to_owned),
            folder_id: object.get("folder_id").and_then(Value::as_str).map(str::to_owned),
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
        created_at: object.get("created_at").and_then(Value::as_i64).unwrap_or_default(),
        updated_at: object.get("updated_at").and_then(Value::as_i64).unwrap_or_default(),
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_millis() as i64
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
    use phoenix_types::{CreateSessionRequest, DocumentId, QueryTarget, ScopeKey};

    #[test]
    fn fixture_manifest_loads() {
        let manifest = load_fixture_manifest();
        assert!(!manifest.fixtures.is_empty(), "fixtures should not be empty");
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
    fn stub_ingest_and_query_roundtrip() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let session = runtime
            .create_session(CreateSessionRequest {
                session_id: None,
                label: "Stub".to_owned(),
                scope: ScopeKey::default(),
            })
            .expect("session");

        let ingest = runtime
            .ingest_stub(IngestRequest {
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
            .query_stub(QueryRequest {
                session_id: Some(session.session_id),
                query: "phoenix".to_owned(),
                scope: ScopeKey::default(),
                targets: vec![QueryTarget::Chunks],
                limit: Some(3),
                temporal: None,
            })
            .expect("query");

        assert_eq!(query.chunk_hits.len(), 1);
        assert_eq!(query.chunk_hits[0].chunk_id, "doc-1");
    }

}
