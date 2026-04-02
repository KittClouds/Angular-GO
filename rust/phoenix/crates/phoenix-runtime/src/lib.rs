use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

mod binary;
mod planner;
mod view;

use phoenix_analytics::TextAnalytics;
use phoenix_chat::PhoenixChat;
use phoenix_gldr::PhoenixGldr;
use phoenix_graptor::{BorrowedIngestDocument, BorrowedIngestRequest, PhoenixGraptor};
use phoenix_lex::LexIndex;
use phoenix_om::OmEngine;
use phoenix_om_graptor::OmGraptorBridge;
use phoenix_scanner::PhoenixScanner;
pub use phoenix_store_cozo::SnapshotPartition;
use phoenix_store_cozo::{
    schema::{CONTENT_SNAPSHOT_RELATIONS, DERIVED_SNAPSHOT_RELATIONS},
    CompactRow, CompactRowView, PhoenixCozoStore, SnapshotEnvelope, StoreConfig, StoreError,
};
use phoenix_structure::PhoenixStructure;
use phoenix_types::{
    ChatPlannerModelResponse, ChatRuntimeConfig, CommitId, CommitRequest, CommitResult,
    CreateSessionRequest, Diagnostic, EntityCard, FolderSchema, GraphDeltaRequest,
    GraphDeltaResult, IngestRequest, IngestResult, NetworkInstance, OmPendingAction,
    OmReflectorModelResponse, OmReflectorToolResult, QueryRequest, QueryResult, RebuildRequest,
    RebuildResult, RunOptions, RuntimeConfig, RuntimeInitResult, SavedNetworkView, ScanArtifact,
    ScanRequest, SessionId, SessionRecord, SessionState, SessionStats, SnapshotDto,
    StoreCommandRequest, StoreCommandResult, StructureArtifact, StructureRequest,
    ToolResultSubmission,
};
use planner::{list_run_artifacts, set_artifact_pinned, ChatPlannerRunner};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub use view::{
    AnalyzeTextRequestView, IngestDocumentView, IngestRequestView, QueryRequestView,
    ScanRequestView, ScopeKeyView, StructureRequestView,
};

pub struct PhoenixRuntime {
    pub config: RuntimeConfig,
    pub store: PhoenixCozoStore,
    pub scanner: PhoenixScanner,
    pub structure: PhoenixStructure,
    pub graptor: PhoenixGraptor,
    pub om_engine: OmEngine,
    pub om_bridge: OmGraptorBridge,
    pub chat: PhoenixChat,
    pub planner: ChatPlannerRunner,
    pub lex: RefCell<Option<LexIndex>>,
    pub gldr: PhoenixGldr,
}

const STORE_API_VERSION: u32 = 1;
const RUNTIME_CAPABILITIES: &[&str] = &[
    "note:list",
    "note:get",
    "note:listByIds",
    "persistence:applyWalBatch",
    "persistence:clearDerived",
    "session:close",
];
const DERIVED_EPHEMERA_RELATIONS: &[&str] = &[
    "phoenix_sessions",
    "phoenix_commits",
    "phoenix_ingest_log",
    "phoenix_query_log",
];

#[derive(Debug, Deserialize)]
struct PersistenceWalBatchRequest {
    records: Vec<PersistenceWalRecord>,
}

#[derive(Debug, Deserialize)]
struct PersistenceWalRecord {
    seq: u64,
    command: String,
    payload: Value,
    partition: String,
    #[serde(rename = "writtenAt")]
    written_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticDocumentVectorUpsertRow {
    document_id: String,
    values: Vec<f32>,
    leaf_count: usize,
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
            om_engine: OmEngine::default(),
            om_bridge: OmGraptorBridge::default(),
            chat: PhoenixChat::default(),
            planner: ChatPlannerRunner::default(),
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
        self.ingest_view(IngestRequestView::from(&request))
    }

    pub fn ingest_view(&self, request: IngestRequestView<'_>) -> Result<IngestResult, StoreError> {
        let created_at = now_ms();
        let request_summary = serde_json::json!({
            "sessionId": request.session_id.as_ref().map(|value| value.0.clone()),
            "documentCount": request.documents.len(),
            "documentIds": request.documents.iter().map(|document| document.document_id.0.clone()).collect::<Vec<_>>(),
            "titles": request.documents.iter().map(|document| document.title.to_owned()).collect::<Vec<_>>(),
            "commit": request.commit,
        });
        self.store.put_row(
            "phoenix_ingest_log",
            serde_json::json!({
                "id": format!("ingest-{}", created_at),
                "session_id": request.session_id.as_ref().map(|value| value.0.clone()),
                "document_count": request.documents.len(),
                "commit_requested": request.commit,
                "request_json": request_summary,
                "created_at": created_at,
            }),
        )?;
        let documents = request
            .documents
            .iter()
            .map(|document| BorrowedIngestDocument {
                document_id: document.document_id.clone(),
                note_id: document.note_id.clone(),
                title: document.title,
                text: document.text,
                scope: document.scope.to_owned(),
            })
            .collect::<Vec<_>>();
        let mut ingest = self.graptor.ingest_view(
            &self.store,
            &self.scanner,
            &self.structure,
            &BorrowedIngestRequest {
                session_id: request.session_id.clone(),
                documents: &documents,
            },
        )?;
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
        self.query_view(QueryRequestView::from(&request))
    }

    pub fn query_view(&self, request: QueryRequestView<'_>) -> Result<QueryResult, StoreError> {
        let created_at = now_ms();
        self.store.put_row(
            "phoenix_query_log",
            serde_json::json!({
                "id": format!("query-{}", created_at),
                "session_id": request.session_id.as_ref().map(|value| value.0.clone()),
                "query": request.query,
                "limit": request.limit,
                "request_json": serde_json::json!({
                    "sessionId": request.session_id.as_ref().map(|value| value.0.clone()),
                    "query": request.query,
                    "scope": request.scope.to_owned(),
                    "targets": request.targets,
                    "limit": request.limit,
                    "temporal": request.temporal,
                    "hasSemanticVector": request.semantic_query_vector.is_some(),
                }),
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
            let semantic_requested = request
                .targets
                .iter()
                .any(|target| matches!(target, phoenix_types::QueryTarget::Semantic));
            let mut owned_request = request.to_owned();
            if semantic_requested && !self.config.feature_flags.semantic {
                owned_request.semantic_query_vector = None;
                owned_request
                    .targets
                    .retain(|target| !matches!(target, phoenix_types::QueryTarget::Semantic));
            }
            let mut result = self.gldr.query(
                &self.store,
                self.lex
                    .borrow()
                    .as_ref()
                    .expect("lex should exist after ensure"),
                &owned_request,
            )?;
            if semantic_requested && !self.config.feature_flags.semantic {
                result.diagnostics.push(Diagnostic {
                    code: "PX_QUERY_SEMANTIC_DISABLED".to_owned(),
                    message: "Semantic retrieval is disabled in runtime feature flags; GLDR used lexical and graph retrieval only.".to_owned(),
                });
            }
            return Ok(result);
        }

        let lexical = self
            .lex
            .borrow()
            .as_ref()
            .expect("lex should exist after ensure")
            .search(
                request.query,
                &request.scope.to_owned(),
                request.limit.unwrap_or(5),
            );

        Ok(QueryResult {
            session_id: request.session_id.clone(),
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
        let result = self.query_view(QueryRequestView::from(&request))?;
        binary::encode_query_result(&result)
    }

    pub fn query_binary_into(
        &self,
        request: QueryRequestView<'_>,
        buffer: &mut [u8],
    ) -> Result<usize, StoreError> {
        let result = self.query_view(request)?;
        binary::encode_query_result_into(buffer, &result)
    }

    pub fn encode_query_result_into(
        &self,
        result: &QueryResult,
        buffer: &mut [u8],
    ) -> Result<usize, StoreError> {
        binary::encode_query_result_into(buffer, result)
    }

    pub fn graph_delta(&self, request: GraphDeltaRequest) -> Result<GraphDeltaResult, StoreError> {
        self.graptor.graph_delta(&self.store, &request)
    }

    pub fn graph_delta_binary(&self, request: GraphDeltaRequest) -> Result<Vec<u8>, StoreError> {
        let result = self.graph_delta(request)?;
        binary::encode_graph_delta(&result)
    }

    pub fn graph_delta_binary_into(
        &self,
        request: GraphDeltaRequest,
        buffer: &mut [u8],
    ) -> Result<usize, StoreError> {
        let result = self.graph_delta(request)?;
        binary::encode_graph_delta_into(buffer, &result)
    }

    pub fn ingest_stub(&self, request: IngestRequest) -> Result<IngestResult, StoreError> {
        self.ingest(request)
    }

    pub fn query_stub(&self, request: QueryRequest) -> Result<QueryResult, StoreError> {
        self.query(request)
    }

    pub fn scan_text(&self, request: ScanRequest) -> ScanArtifact {
        self.scan_text_view(ScanRequestView::from(&request))
    }

    pub fn scan_text_view(&self, request: ScanRequestView<'_>) -> ScanArtifact {
        self.scanner.scan_parts(
            request.text,
            &request.scope.to_owned(),
            request.session_id.as_ref(),
            request.resolver_seed,
        )
    }

    pub fn build_structure(&self, request: StructureRequest) -> StructureArtifact {
        self.build_structure_view(StructureRequestView::from(&request))
    }

    pub fn build_structure_view(&self, request: StructureRequestView<'_>) -> StructureArtifact {
        self.structure.build_parts(request.text, request.scan)
    }

    pub fn analyze_text(&self, text: &str) -> TextAnalytics {
        self.analyze_text_view(AnalyzeTextRequestView { text })
    }

    pub fn analyze_text_view(&self, request: AnalyzeTextRequestView<'_>) -> TextAnalytics {
        phoenix_analytics::analyze_text(request.text)
    }

    pub fn export_snapshot(&self) -> Result<Vec<u8>, StoreError> {
        self.export_snapshot_partition(SnapshotPartition::All)
    }

    pub fn export_snapshot_partition(
        &self,
        partition: SnapshotPartition,
    ) -> Result<Vec<u8>, StoreError> {
        self.store.export_snapshot_partition(partition)
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

    pub fn upsert_entity_card(&self, card: &EntityCard) -> Result<(), StoreError> {
        self.store.upsert_entity_card(card)
    }

    pub fn upsert_entity_cards_batch(&self, cards: &[EntityCard]) -> Result<(), StoreError> {
        self.store.upsert_entity_cards_batch(cards)
    }

    pub fn get_entity_cards(
        &self,
        entity_id: &phoenix_types::EntityId,
    ) -> Result<Vec<EntityCard>, StoreError> {
        self.store.get_entity_cards(entity_id)
    }

    pub fn upsert_folder_schema(&self, schema: &FolderSchema) -> Result<(), StoreError> {
        self.store.upsert_folder_schema(schema)
    }

    pub fn get_folder_schema(&self, id: &str) -> Result<Option<FolderSchema>, StoreError> {
        self.store.get_folder_schema(id)
    }

    pub fn save_network_view(&self, view: &SavedNetworkView) -> Result<(), StoreError> {
        let existing = self.get_network_view(&view.instance.id)?;

        self.store.upsert_network_instance(&view.instance)?;
        self.store.upsert_network_memberships(&view.members)?;
        self.store
            .upsert_network_relationships(&view.relationships)?;

        if let Some(existing) = existing {
            let new_member_keys = view
                .members
                .iter()
                .map(|member| (member.network_id.clone(), member.entity_id.0.clone()))
                .collect::<BTreeSet<_>>();
            let stale_members = existing
                .members
                .into_iter()
                .filter(|member| {
                    !new_member_keys
                        .contains(&(member.network_id.clone(), member.entity_id.0.clone()))
                })
                .collect::<Vec<_>>();
            self.store.delete_network_memberships(&stale_members)?;

            let new_relationship_keys = view
                .relationships
                .iter()
                .map(|relationship| {
                    (
                        relationship.network_id.clone(),
                        relationship.relationship_id.clone(),
                    )
                })
                .collect::<BTreeSet<_>>();
            let stale_relationships = existing
                .relationships
                .into_iter()
                .filter(|relationship| {
                    !new_relationship_keys.contains(&(
                        relationship.network_id.clone(),
                        relationship.relationship_id.clone(),
                    ))
                })
                .collect::<Vec<_>>();
            self.store
                .delete_network_relationships(&stale_relationships)?;
        }

        Ok(())
    }

    pub fn get_network_view(&self, id: &str) -> Result<Option<SavedNetworkView>, StoreError> {
        let Some(instance) = self.store.get_network_instance(id)? else {
            return Ok(None);
        };
        let members = self.store.get_network_members(id)?;
        let relationships = self.store.get_network_relationships(id)?;
        Ok(Some(SavedNetworkView {
            instance,
            members,
            relationships,
        }))
    }

    pub fn list_network_views(&self) -> Result<Vec<NetworkInstance>, StoreError> {
        self.store.list_network_instances()
    }

    pub fn delete_network_view(&self, id: &str) -> Result<(), StoreError> {
        let members = self.store.get_network_members(id)?;
        let relationships = self.store.get_network_relationships(id)?;
        self.store.delete_network_relationships(&relationships)?;
        self.store.delete_network_memberships(&members)?;
        self.store.delete_network_instance(id)
    }

    fn clear_derived_partition(&self) -> Result<(), StoreError> {
        self.store.clear_relations(DERIVED_SNAPSHOT_RELATIONS)?;
        self.store.clear_relations(DERIVED_EPHEMERA_RELATIONS)?;
        self.rebuild_lex_index()?;
        Ok(())
    }

    fn clear_derived_ephemera(&self) -> Result<(), StoreError> {
        self.store.clear_relations(DERIVED_EPHEMERA_RELATIONS)?;
        Ok(())
    }

    fn delete_rows_by_session(
        &self,
        relation: &str,
        key_columns: &[&str],
        session_id: &str,
    ) -> Result<usize, StoreError> {
        let rows = self.store.fetch_compact_rows_where_str(
            relation,
            key_columns,
            "session_id",
            session_id,
        )?;
        let count = rows.len();
        self.store.delete_key_rows(relation, &rows)?;
        Ok(count)
    }

    fn close_session(&self, session_id: &str) -> Result<usize, StoreError> {
        let mut deleted = 0usize;
        deleted += self.delete_rows_by_session("phoenix_commits", &["commit_id"], session_id)?;
        deleted += self.delete_rows_by_session("phoenix_ingest_log", &["id"], session_id)?;
        deleted += self.delete_rows_by_session("phoenix_query_log", &["id"], session_id)?;
        deleted += self.delete_rows_by_session("phoenix_sessions", &["session_id"], session_id)?;
        Ok(deleted)
    }

    fn apply_persistence_wal_batch(
        &self,
        records: &[PersistenceWalRecord],
    ) -> Result<(), StoreError> {
        for record in records {
            if record.seq == 0 {
                return Err(StoreError::Query("invalid WAL seq: 0".to_owned()));
            }
            if record.partition != "content" {
                return Err(StoreError::Query(format!(
                    "unsupported WAL partition: {}",
                    record.partition
                )));
            }
            let _written_at = record.written_at;

            match record.command.as_str() {
                "note:upsert" => {
                    let row = require_payload_value(&record.payload, "row")?;
                    self.upsert_note_row(row)?;
                }
                "note:delete" => {
                    let id = require_payload_str(&record.payload, "id")?;
                    self.delete_note_rows(id)?;
                }
                "relation:upsert" => {
                    let relation = require_payload_str(&record.payload, "relation")?;
                    ensure_allowed_content_relation(relation)?;
                    let row = require_payload_value(&record.payload, "row")?;
                    self.store.put_row(relation, row.clone())?;
                }
                "relation:delete" => {
                    let relation = require_payload_str(&record.payload, "relation")?;
                    ensure_allowed_content_relation(relation)?;
                    let filter = payload_object(record.payload.get("filter"));
                    let rows = self.store.fetch_rows(relation)?;
                    let compact_rows = self.store.fetch_compact_rows(relation)?;
                    let matched = rows
                        .iter()
                        .zip(compact_rows.into_iter())
                        .filter_map(|(row, compact)| {
                            row_matches_filter(row, filter).then_some(compact)
                        })
                        .collect::<Vec<_>>();
                    self.store.delete_key_rows(relation, &matched)?;
                }
                "entityCards:upsertBatch" => {
                    let cards: Vec<EntityCard> = serde_json::from_value(
                        record
                            .payload
                            .get("cards")
                            .cloned()
                            .unwrap_or_else(|| Value::Array(Vec::new())),
                    )
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                    self.upsert_entity_cards_batch(&cards)?;
                }
                "folderSchema:upsert" => {
                    let schema: FolderSchema = serde_json::from_value(
                        record.payload.get("schema").cloned().unwrap_or(Value::Null),
                    )
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                    self.upsert_folder_schema(&schema)?;
                }
                "networkView:save" => {
                    let view: SavedNetworkView = serde_json::from_value(
                        record.payload.get("view").cloned().unwrap_or(Value::Null),
                    )
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                    self.save_network_view(&view)?;
                }
                "networkView:delete" => {
                    let id = require_payload_str(&record.payload, "id")?;
                    self.delete_network_view(id)?;
                }
                other => {
                    return Err(StoreError::Query(format!(
                        "unsupported WAL command: {other}"
                    )));
                }
            }
        }

        self.rebuild_lex_index()?;
        Ok(())
    }

    pub fn init_chat_config(&self, config: ChatRuntimeConfig) -> ChatRuntimeConfig {
        self.chat.init_config(config)
    }

    pub fn store_command(
        &self,
        request: StoreCommandRequest,
    ) -> Result<StoreCommandResult, StoreError> {
        match request.command.as_str() {
            "relation:upsert" => {
                let relation = require_payload_str(&request.payload, "relation")?;
                let row = require_payload_value(&request.payload, "row")?;
                self.store.put_row(relation, row.clone())?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "relation:getFirst" => {
                let relation = require_payload_str(&request.payload, "relation")?;
                let filter = payload_object(request.payload.get("filter"));
                let row = self
                    .store
                    .fetch_rows(relation)?
                    .into_iter()
                    .find(|row| row_matches_filter(row, filter));
                Ok(StoreCommandResult {
                    success: true,
                    payload: row,
                    error: None,
                })
            }
            "relation:list" => {
                let relation = require_payload_str(&request.payload, "relation")?;
                let filter = payload_object(request.payload.get("filter"));
                let rows = self
                    .store
                    .fetch_rows(relation)?
                    .into_iter()
                    .filter(|row| row_matches_filter(row, filter))
                    .collect::<Vec<_>>();
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(Value::Array(rows)),
                    error: None,
                })
            }
            "relation:delete" => {
                let relation = require_payload_str(&request.payload, "relation")?;
                let filter = payload_object(request.payload.get("filter"));
                let rows = self.store.fetch_rows(relation)?;
                let compact_rows = self.store.fetch_compact_rows(relation)?;
                let matched = rows
                    .iter()
                    .zip(compact_rows.into_iter())
                    .filter_map(|(row, compact)| row_matches_filter(row, filter).then_some(compact))
                    .collect::<Vec<_>>();
                self.store.delete_key_rows(relation, &matched)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(serde_json::json!({ "deleted": matched.len() })),
                    error: None,
                })
            }
            "note:upsert" => {
                let row = require_payload_value(&request.payload, "row")?;
                self.upsert_note_row(row)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "note:get" => {
                let id = require_payload_str(&request.payload, "id")?;
                let include_body = payload_bool(request.payload.get("includeBody"), true);
                let note = self.get_note_value(id, include_body)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: note,
                    error: None,
                })
            }
            "note:list" => {
                let folder_id = request.payload.get("folderId").and_then(Value::as_str);
                let include_body = payload_bool(request.payload.get("includeBody"), true);
                let notes = self.list_note_values(folder_id, include_body)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(Value::Array(notes)),
                    error: None,
                })
            }
            "note:listByIds" => {
                let ids = payload_string_array(request.payload.get("ids"));
                let include_body = payload_bool(request.payload.get("includeBody"), true);
                let notes = self.list_note_values_by_ids(&ids, include_body)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(Value::Array(notes)),
                    error: None,
                })
            }
            "note:delete" => {
                let id = require_payload_str(&request.payload, "id")?;
                let deleted = self.delete_note_rows(id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(serde_json::json!({ "deleted": deleted })),
                    error: None,
                })
            }
            "runtime:capabilities" => Ok(StoreCommandResult {
                success: true,
                payload: Some(serde_json::json!({
                    "storeApiVersion": STORE_API_VERSION,
                    "capabilities": RUNTIME_CAPABILITIES,
                })),
                error: None,
            }),
            "session:close" => {
                let session_id = require_payload_str(&request.payload, "sessionId")?;
                let deleted = self.close_session(session_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(serde_json::json!({ "deleted": deleted })),
                    error: None,
                })
            }
            "persistence:applyWalBatch" => {
                let batch: PersistenceWalBatchRequest = serde_json::from_value(request.payload)
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                self.apply_persistence_wal_batch(&batch.records)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(serde_json::json!({ "replayed": batch.records.len() })),
                    error: None,
                })
            }
            "persistence:clearDerived" => {
                self.clear_derived_partition()?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "persistence:clearDerivedEphemera" => {
                self.clear_derived_ephemera()?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "chat:init" => {
                let config: ChatRuntimeConfig = serde_json::from_value(
                    request
                        .payload
                        .get("config")
                        .cloned()
                        .unwrap_or(Value::Null),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                let config = self.init_chat_config(config);
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(config)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:createThread" => {
                let world_id = request.payload.get("worldId").and_then(Value::as_str);
                let narrative_id = request.payload.get("narrativeId").and_then(Value::as_str);
                let title = request.payload.get("title").and_then(Value::as_str);
                let thread = self
                    .chat
                    .create_thread(&self.store, world_id, narrative_id, title)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(thread)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:getThread" => {
                let id = require_payload_str(&request.payload, "id")?;
                let thread = self.chat.get_thread(&self.store, id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: thread
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:listThreads" => {
                let world_id = request.payload.get("worldId").and_then(Value::as_str);
                let threads = self.chat.list_threads(&self.store, world_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(threads)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:deleteThread" => {
                let id = require_payload_str(&request.payload, "id")?;
                self.chat.delete_thread(&self.store, id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "chat:addMessage" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let role = require_payload_str(&request.payload, "role")?;
                let content = request
                    .payload
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let narrative_id = request.payload.get("narrativeId").and_then(Value::as_str);
                let message =
                    self.chat
                        .add_message(&self.store, thread_id, role, content, narrative_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(message)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:listMessages" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let messages = self.chat.list_messages(&self.store, thread_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(messages)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:updateMessage" => {
                let message_id = require_payload_str(&request.payload, "messageId")?;
                let content = request
                    .payload
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let message = self.chat.update_message(&self.store, message_id, content)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: message
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:appendMessage" => {
                let message_id = require_payload_str(&request.payload, "messageId")?;
                let chunk = request
                    .payload
                    .get("chunk")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let message = self.chat.append_message(&self.store, message_id, chunk)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: message
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:startStreamingMessage" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let narrative_id = request.payload.get("narrativeId").and_then(Value::as_str);
                let message =
                    self.chat
                        .start_streaming_message(&self.store, thread_id, narrative_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(message)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:clearThread" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                self.chat.clear_thread(&self.store, thread_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "chat:exportThread" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let exported = self.chat.export_thread(&self.store, thread_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(Value::String(exported)),
                    error: None,
                })
            }
            "chat:startRun" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let prompt = request
                    .payload
                    .get("prompt")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let options: RunOptions = serde_json::from_value(
                    request
                        .payload
                        .get("options")
                        .cloned()
                        .unwrap_or(Value::Null),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                let run = self
                    .chat
                    .start_run(&self.store, thread_id, prompt, options)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(run)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:pollRun" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let snapshot = self
                    .chat
                    .poll_run(&self.store, run_id)?
                    .map(|mut snapshot| {
                        snapshot.planner_step = self.planner.peek_step(run_id);
                        if let Ok(artifacts) = list_run_artifacts(self, &snapshot.run) {
                            snapshot.artifacts = artifacts;
                        }
                        snapshot
                    });
                Ok(StoreCommandResult {
                    success: true,
                    payload: snapshot
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:resumeRun" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let run = self.chat.resume_run(&self.store, run_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: run
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:cancelRun" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                self.planner.drop_session(run_id);
                let run = self.chat.cancel_run(&self.store, run_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: run
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:listRunEvents" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let limit = request
                    .payload
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(100) as usize;
                let events = self
                    .chat
                    .list_run_events_for_thread(&self.store, thread_id, limit)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(events)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:markRunStreaming" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let assistant_message_id =
                    require_payload_str(&request.payload, "assistantMessageId")?;
                let snapshot =
                    self.chat
                        .mark_run_streaming(&self.store, run_id, assistant_message_id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: snapshot
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:completeRun" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                self.planner.drop_session(run_id);
                let assistant_message_id =
                    require_payload_str(&request.payload, "assistantMessageId")?;
                let final_response = request
                    .payload
                    .get("finalResponse")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let final_error = request.payload.get("finalError").and_then(Value::as_str);
                let snapshot = self.chat.complete_run(
                    &self.store,
                    run_id,
                    assistant_message_id,
                    final_response,
                    final_error,
                )?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: snapshot
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:getPlannerStep" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let run = self
                    .chat
                    .get_run(&self.store, run_id)?
                    .ok_or_else(|| StoreError::Query(format!("run not found: {run_id}")))?;
                let step = self.planner.get_step(self, &run)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: step
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:submitPlannerModelResponse" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let response: ChatPlannerModelResponse = serde_json::from_value(
                    request
                        .payload
                        .get("response")
                        .cloned()
                        .unwrap_or(Value::Null),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                let run = self
                    .chat
                    .get_run(&self.store, run_id)?
                    .ok_or_else(|| StoreError::Query(format!("run not found: {run_id}")))?;
                let step = self.planner.submit_model_response(self, &run, response)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: step
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:advancePlannerRun" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let run = self
                    .chat
                    .get_run(&self.store, run_id)?
                    .ok_or_else(|| StoreError::Query(format!("run not found: {run_id}")))?;
                let step = self.planner.advance(self, &run)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: step
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:degradePlannerRun" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let reason = request
                    .payload
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("Planner failed.");
                let run = self
                    .chat
                    .get_run(&self.store, run_id)?
                    .ok_or_else(|| StoreError::Query(format!("run not found: {run_id}")))?;
                self.planner.degrade_run(self, &run, reason, None)?;
                self.planner.drop_session(run_id);
                let snapshot = self
                    .chat
                    .poll_run(&self.store, run_id)?
                    .map(|mut snapshot| {
                        snapshot.planner_step = self.planner.peek_step(run_id);
                        if let Ok(artifacts) = list_run_artifacts(self, &snapshot.run) {
                            snapshot.artifacts = artifacts;
                        }
                        snapshot
                    });
                Ok(StoreCommandResult {
                    success: true,
                    payload: snapshot
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:listPlannerArtifacts" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let run = self
                    .chat
                    .get_run(&self.store, run_id)?
                    .ok_or_else(|| StoreError::Query(format!("run not found: {run_id}")))?;
                let artifacts = list_run_artifacts(self, &run)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(artifacts)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:pinPlannerArtifact" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let key = require_payload_str(&request.payload, "key")?;
                let pinned = request
                    .payload
                    .get("pinned")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let run = self
                    .chat
                    .get_run(&self.store, run_id)?
                    .ok_or_else(|| StoreError::Query(format!("run not found: {run_id}")))?;
                let Some(artifact) = set_artifact_pinned(self, &run, key, pinned)? else {
                    return Err(StoreError::Query(format!("artifact not found: {key}")));
                };
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(artifact)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:prepareOm" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let config = OmEngine::config_from_runtime(&self.chat.current_config());
                let action = self
                    .om_engine
                    .prepare_pending_action_with_graph(
                        &self.store,
                        &self.scanner,
                        &self.structure,
                        &self.om_bridge,
                        thread_id,
                        &config,
                    )
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: action
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "chat:applyOmAction" => {
                let action: OmPendingAction = serde_json::from_value(
                    request
                        .payload
                        .get("action")
                        .cloned()
                        .unwrap_or(Value::Null),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                let response = request
                    .payload
                    .get("response")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let config = OmEngine::config_from_runtime(&self.chat.current_config());
                let applied = self
                    .om_engine
                    .apply_pending_action_with_graph(
                        &self.store,
                        &self.scanner,
                        &self.structure,
                        &self.om_bridge,
                        &config,
                        &action,
                        response,
                    )
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(Value::Bool(applied)),
                    error: None,
                })
            }
            "om:startReflector" => {
                let action: OmPendingAction = serde_json::from_value(
                    request
                        .payload
                        .get("action")
                        .cloned()
                        .unwrap_or(Value::Null),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                let step = self
                    .om_engine
                    .start_reflector(&action)
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(step)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "om:submitReflectorModelResponse" => {
                let session_id = require_payload_str(&request.payload, "sessionId")?;
                let response: OmReflectorModelResponse = serde_json::from_value(
                    request
                        .payload
                        .get("response")
                        .cloned()
                        .unwrap_or(Value::Null),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                let step = self
                    .om_engine
                    .submit_reflector_model_response(session_id, response)
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(step)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "om:submitReflectorToolResults" => {
                let session_id = require_payload_str(&request.payload, "sessionId")?;
                let results: Vec<OmReflectorToolResult> = serde_json::from_value(
                    request
                        .payload
                        .get("results")
                        .cloned()
                        .unwrap_or_else(|| Value::Array(Vec::new())),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                let step = self
                    .om_engine
                    .submit_reflector_tool_results(session_id, &results)
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(step)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "om:dropReflectorSession" => {
                let session_id = require_payload_str(&request.payload, "sessionId")?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(Value::Bool(
                        self.om_engine.drop_reflector_session(session_id),
                    )),
                    error: None,
                })
            }
            "om:recoverLostMemory" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let limit = request
                    .payload
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(10) as usize;
                let focus = request.payload.get("focus").and_then(Value::as_str);
                let hits = self
                    .om_bridge
                    .recover_lost_memory(&self.store, thread_id, limit, focus)
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(hits)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "om:memoryGraphSearch" => {
                let thread_id = require_payload_str(&request.payload, "threadId")?;
                let query = request
                    .payload
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let limit = request
                    .payload
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(10) as usize;
                let hits = self
                    .om_bridge
                    .memory_graph_search(&self.store, thread_id, query, limit)
                    .map_err(|error| StoreError::Query(error.to_string()))?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(hits)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "semantic:listLeafChunks" => {
                let document_ids = request
                    .payload
                    .get("documentIds")
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let chunks = self.store.list_leaf_chunks_for_documents(&document_ids)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(chunks)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "semantic:upsertDocumentVectors" => {
                let rows: Vec<SemanticDocumentVectorUpsertRow> = serde_json::from_value(
                    request
                        .payload
                        .get("rows")
                        .cloned()
                        .unwrap_or_else(|| Value::Array(Vec::new())),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                let updated_at = now_ms();
                let vectors = rows
                    .iter()
                    .map(|row| phoenix_store_cozo::SemanticDocumentVectorRow {
                        document_id: row.document_id.as_str(),
                        values: row.values.as_slice(),
                        model_id: phoenix_store_cozo::SEMANTIC_MODEL_ID,
                        leaf_count: row.leaf_count,
                        updated_at,
                    })
                    .collect::<Vec<_>>();
                self.store.upsert_semantic_document_vectors(&vectors)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(serde_json::json!({
                        "inserted": vectors.len(),
                        "modelId": phoenix_store_cozo::SEMANTIC_MODEL_ID,
                        "dimension": phoenix_store_cozo::SEMANTIC_VECTOR_DIM,
                    })),
                    error: None,
                })
            }
            "chat:submitToolResults" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let results: Vec<ToolResultSubmission> = serde_json::from_value(
                    request
                        .payload
                        .get("results")
                        .cloned()
                        .unwrap_or_else(|| Value::Array(Vec::new())),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                self.planner.drop_session(run_id);
                let snapshot = self
                    .chat
                    .submit_tool_results(&self.store, run_id, &results)
                    .map(|mut snapshot| {
                        snapshot.planner_step = self.planner.peek_step(run_id);
                        if let Ok(artifacts) = list_run_artifacts(self, &snapshot.run) {
                            snapshot.artifacts = artifacts;
                        }
                        snapshot
                    })?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(snapshot)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "chat:submitApproval" => {
                let run_id = require_payload_str(&request.payload, "runId")?;
                let approval_id = require_payload_str(&request.payload, "approvalId")?;
                let approved = request
                    .payload
                    .get("approved")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let decision_json = request.payload.get("decisionJson").and_then(Value::as_str);
                self.planner.drop_session(run_id);
                let snapshot = self
                    .chat
                    .submit_approval(&self.store, run_id, approval_id, approved, decision_json)
                    .map(|mut snapshot| {
                        snapshot.planner_step = self.planner.peek_step(run_id);
                        if let Ok(artifacts) = list_run_artifacts(self, &snapshot.run) {
                            snapshot.artifacts = artifacts;
                        }
                        snapshot
                    })?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(snapshot)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "entityCards:upsertBatch" => {
                let cards: Vec<EntityCard> = serde_json::from_value(
                    request
                        .payload
                        .get("cards")
                        .cloned()
                        .unwrap_or_else(|| Value::Array(Vec::new())),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                self.upsert_entity_cards_batch(&cards)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "entityCards:get" => {
                let entity_id = require_payload_str(&request.payload, "entityId")?;
                let cards =
                    self.get_entity_cards(&phoenix_types::EntityId(entity_id.to_owned()))?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(cards)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "folderSchema:upsert" => {
                let schema: FolderSchema = serde_json::from_value(
                    request
                        .payload
                        .get("schema")
                        .cloned()
                        .unwrap_or(Value::Null),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                self.upsert_folder_schema(&schema)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "folderSchema:get" => {
                let id = require_payload_str(&request.payload, "id")?;
                let schema = self.get_folder_schema(id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: schema
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "networkView:save" => {
                let view: SavedNetworkView = serde_json::from_value(
                    request.payload.get("view").cloned().unwrap_or(Value::Null),
                )
                .map_err(|error| StoreError::Query(error.to_string()))?;
                self.save_network_view(&view)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            "networkView:get" => {
                let id = require_payload_str(&request.payload, "id")?;
                let view = self.get_network_view(id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: view
                        .map(|value| {
                            serde_json::to_value(value)
                                .map_err(|error| StoreError::Query(error.to_string()))
                        })
                        .transpose()?,
                    error: None,
                })
            }
            "networkView:list" => {
                let views = self.list_network_views()?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: Some(
                        serde_json::to_value(views)
                            .map_err(|error| StoreError::Query(error.to_string()))?,
                    ),
                    error: None,
                })
            }
            "networkView:delete" => {
                let id = require_payload_str(&request.payload, "id")?;
                self.delete_network_view(id)?;
                Ok(StoreCommandResult {
                    success: true,
                    payload: None,
                    error: None,
                })
            }
            other => Ok(StoreCommandResult {
                success: false,
                payload: None,
                error: Some(format!("unsupported store command: {other}")),
            }),
        }
    }

    fn upsert_note_row(&self, row: &Value) -> Result<(), StoreError> {
        let id = row
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| StoreError::Query("missing store command field: row.id".to_owned()))?;
        let existing =
            self.store
                .fetch_compact_rows_where_str("notes", NOTE_KEY_COLUMNS, "id", id)?;
        if !existing.is_empty() {
            self.store.delete_key_rows("notes", &existing)?;
        }
        self.store.put_row("notes", row.clone())
    }

    pub(crate) fn get_note_value(
        &self,
        id: &str,
        include_body: bool,
    ) -> Result<Option<Value>, StoreError> {
        let columns = note_columns(include_body);
        let rows = self
            .store
            .fetch_compact_rows_where_str("notes", columns, "id", id)?;
        Ok(select_latest_note(&rows, columns).map(|view| note_value_from_row(view, include_body)))
    }

    pub(crate) fn list_note_values(
        &self,
        folder_id: Option<&str>,
        include_body: bool,
    ) -> Result<Vec<Value>, StoreError> {
        let columns = note_columns(include_body);
        let rows = match folder_id {
            Some(value) if !value.is_empty() => {
                self.store
                    .fetch_compact_rows_where_str("notes", columns, "folder_id", value)?
            }
            _ => self
                .store
                .fetch_compact_rows_with_columns("notes", columns)?,
        };
        Ok(note_values_from_rows(
            rows,
            columns,
            folder_id,
            include_body,
        ))
    }

    pub(crate) fn list_note_values_by_ids(
        &self,
        ids: &[String],
        include_body: bool,
    ) -> Result<Vec<Value>, StoreError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let columns = note_columns(include_body);
        let rows = self
            .store
            .fetch_compact_rows_where_in_strings("notes", columns, "id", ids)?;
        Ok(note_values_from_rows(rows, columns, None, include_body))
    }

    fn delete_note_rows(&self, id: &str) -> Result<usize, StoreError> {
        let rows = self
            .store
            .fetch_compact_rows_where_str("notes", NOTE_KEY_COLUMNS, "id", id)?;
        let deleted = rows.len();
        if deleted > 0 {
            self.store.delete_key_rows("notes", &rows)?;
        }
        Ok(deleted)
    }

    pub fn session_state_binary(&self, session_id: &SessionId) -> Result<Vec<u8>, StoreError> {
        let state = self.session_state(session_id)?;
        binary::encode_session_state(&state)
    }

    pub fn session_state_binary_into(
        &self,
        session_id: &SessionId,
        buffer: &mut [u8],
    ) -> Result<usize, StoreError> {
        let state = self.session_state(session_id)?;
        binary::encode_session_state_into(buffer, &state)
    }

    pub fn session_stats_binary(&self, session_id: &SessionId) -> Result<Vec<u8>, StoreError> {
        let stats = self.session_stats(session_id)?;
        binary::encode_session_stats(&stats)
    }

    pub fn session_stats_binary_into(
        &self,
        session_id: &SessionId,
        buffer: &mut [u8],
    ) -> Result<usize, StoreError> {
        let stats = self.session_stats(session_id)?;
        binary::encode_session_stats_into(buffer, &stats)
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
        let rows = self.store.fetch_rows_with_columns(
            "phoenix_sessions",
            &[
                "session_id",
                "label",
                "world_id",
                "narrative_id",
                "folder_id",
                "folder_path",
                "status",
                "revision",
                "created_at",
                "updated_at",
            ],
        )?;
        let row = rows
            .into_iter()
            .find(|row| {
                row.get("session_id").and_then(Value::as_str) == Some(session_id.0.as_str())
            })
            .ok_or_else(|| StoreError::Query(format!("session not found: {}", session_id.0)))?;
        session_record_from_row(&row)
    }
}

const NOTE_KEY_COLUMNS: &[&str] = &["id", "version"];
const ALLOWED_WAL_RELATIONS: &[&str] = &[
    "entities",
    "edges",
    "folders",
    "scoped_documents",
    "scoped_entity_fields",
    "scoped_definitions",
    "discovery_candidates",
];
const NOTE_HEADER_COLUMNS: &[&str] = &[
    "id",
    "version",
    "world_id",
    "title",
    "folder_id",
    "entity_kind",
    "entity_subtype",
    "is_entity",
    "is_pinned",
    "favorite",
    "owner_id",
    "narrative_id",
    "order",
    "created_at",
    "updated_at",
    "is_current",
];
const NOTE_BODY_COLUMNS: &[&str] = &[
    "id",
    "version",
    "world_id",
    "title",
    "content",
    "markdown_content",
    "folder_id",
    "entity_kind",
    "entity_subtype",
    "is_entity",
    "is_pinned",
    "favorite",
    "owner_id",
    "narrative_id",
    "order",
    "created_at",
    "updated_at",
    "is_current",
];

fn note_columns(include_body: bool) -> &'static [&'static str] {
    if include_body {
        NOTE_BODY_COLUMNS
    } else {
        NOTE_HEADER_COLUMNS
    }
}

fn payload_bool(value: Option<&Value>, default: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(default)
}

fn payload_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn note_priority(row: &CompactRowView<'_>) -> (u8, i64, i64) {
    (
        u8::from(row.get_bool("is_current").unwrap_or(false)),
        row.get_i64("version").unwrap_or_default(),
        row.get_i64("updated_at").unwrap_or_default(),
    )
}

fn select_latest_note<'a>(
    rows: &'a [CompactRow],
    columns: &'a [&'a str],
) -> Option<CompactRowView<'a>> {
    let mut best: Option<CompactRowView<'a>> = None;
    for row in rows {
        let candidate = CompactRowView::new(columns, row);
        let is_better = best
            .as_ref()
            .map(|current| note_priority(&candidate) > note_priority(current))
            .unwrap_or(true);
        if is_better {
            best = Some(candidate);
        }
    }
    best
}

fn note_value_from_row(row: CompactRowView<'_>, include_body: bool) -> Value {
    let mut object = serde_json::Map::new();
    object.insert(
        "id".to_owned(),
        Value::String(row.get_str("id").unwrap_or_default().to_owned()),
    );
    object.insert(
        "version".to_owned(),
        Value::from(row.get_i64("version").unwrap_or_default()),
    );
    object.insert(
        "world_id".to_owned(),
        Value::String(row.get_str("world_id").unwrap_or_default().to_owned()),
    );
    object.insert(
        "title".to_owned(),
        Value::String(row.get_str("title").unwrap_or_default().to_owned()),
    );
    if include_body {
        object.insert(
            "content".to_owned(),
            Value::String(row.get_str("content").unwrap_or_default().to_owned()),
        );
        object.insert(
            "markdown_content".to_owned(),
            Value::String(
                row.get_str("markdown_content")
                    .unwrap_or_default()
                    .to_owned(),
            ),
        );
    }
    object.insert(
        "folder_id".to_owned(),
        row.get_str("folder_id")
            .map(|value| Value::String(value.to_owned()))
            .unwrap_or(Value::Null),
    );
    object.insert(
        "entity_kind".to_owned(),
        row.get_str("entity_kind")
            .map(|value| Value::String(value.to_owned()))
            .unwrap_or(Value::Null),
    );
    object.insert(
        "entity_subtype".to_owned(),
        row.get_str("entity_subtype")
            .map(|value| Value::String(value.to_owned()))
            .unwrap_or(Value::Null),
    );
    object.insert(
        "is_entity".to_owned(),
        Value::Bool(row.get_bool("is_entity").unwrap_or(false)),
    );
    object.insert(
        "is_pinned".to_owned(),
        Value::Bool(row.get_bool("is_pinned").unwrap_or(false)),
    );
    object.insert(
        "favorite".to_owned(),
        Value::Bool(row.get_bool("favorite").unwrap_or(false)),
    );
    object.insert(
        "owner_id".to_owned(),
        row.get_str("owner_id")
            .map(|value| Value::String(value.to_owned()))
            .unwrap_or(Value::Null),
    );
    object.insert(
        "narrative_id".to_owned(),
        row.get_str("narrative_id")
            .map(|value| Value::String(value.to_owned()))
            .unwrap_or(Value::Null),
    );
    object.insert(
        "order".to_owned(),
        row.get_json("order").unwrap_or(Value::from(0)),
    );
    object.insert(
        "created_at".to_owned(),
        Value::from(row.get_i64("created_at").unwrap_or_default()),
    );
    object.insert(
        "updated_at".to_owned(),
        Value::from(row.get_i64("updated_at").unwrap_or_default()),
    );
    Value::Object(object)
}

fn note_values_from_rows(
    rows: Vec<CompactRow>,
    columns: &[&str],
    folder_id: Option<&str>,
    include_body: bool,
) -> Vec<Value> {
    let mut best_by_id = HashMap::<String, CompactRow>::new();

    for row in rows {
        let candidate = CompactRowView::new(columns, &row);
        if let Some(expected_folder_id) = folder_id {
            let actual_folder_id = candidate.get_str("folder_id").unwrap_or_default();
            let folder_matches = if expected_folder_id.is_empty() {
                actual_folder_id.is_empty()
            } else {
                actual_folder_id == expected_folder_id
            };
            if !folder_matches {
                continue;
            }
        }

        let Some(id) = candidate.get_str("id").map(str::to_owned) else {
            continue;
        };
        match best_by_id.get(&id) {
            Some(existing) => {
                let existing_view = CompactRowView::new(columns, existing);
                if note_priority(&candidate) > note_priority(&existing_view) {
                    best_by_id.insert(id, row);
                }
            }
            None => {
                best_by_id.insert(id, row);
            }
        }
    }

    let mut values = best_by_id
        .values()
        .map(|row| note_value_from_row(CompactRowView::new(columns, row), include_body))
        .collect::<Vec<_>>();
    values.sort_by(|left, right| {
        let left_updated = left
            .get("updated_at")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let right_updated = right
            .get("updated_at")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        right_updated.cmp(&left_updated).then_with(|| {
            left.get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .cmp(
                    right
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                )
        })
    });
    values
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

fn require_payload_str<'a>(payload: &'a Value, key: &str) -> Result<&'a str, StoreError> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| StoreError::Query(format!("missing store command field: {key}")))
}

fn require_payload_value<'a>(payload: &'a Value, key: &str) -> Result<&'a Value, StoreError> {
    payload
        .get(key)
        .ok_or_else(|| StoreError::Query(format!("missing store command field: {key}")))
}

fn payload_object(value: Option<&Value>) -> Option<&serde_json::Map<String, Value>> {
    value.and_then(Value::as_object)
}

fn ensure_allowed_content_relation(relation: &str) -> Result<(), StoreError> {
    if ALLOWED_WAL_RELATIONS.contains(&relation) && CONTENT_SNAPSHOT_RELATIONS.contains(&relation) {
        return Ok(());
    }
    Err(StoreError::Query(format!(
        "unsupported WAL relation: {relation}"
    )))
}

fn row_matches_filter(row: &Value, filter: Option<&serde_json::Map<String, Value>>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let Some(object) = row.as_object() else {
        return false;
    };
    filter
        .iter()
        .all(|(key, expected)| object.get(key) == Some(expected))
}

pub(crate) fn now_ms() -> i64 {
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
        ChatPlannerModelResponse, ChatPlannerStep, ChatRunSnapshot, ChatRunStatus,
        ChatWorkspaceArtifact, CreateSessionRequest, DocumentId, EntityId, EntityKind, GenderHint,
        GraphDeltaRequest, MentionEntityRef, QueryResultHeader, QueryTarget, RunOptions, ScopeKey,
        SessionStateResultHeader, SessionStatsResultHeader,
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
    fn runtime_capabilities_report_required_store_contract() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        runtime.init().expect("init");

        let result = runtime
            .store_command(StoreCommandRequest {
                command: "runtime:capabilities".to_owned(),
                payload: json!({}),
            })
            .expect("runtime capabilities");

        let payload = result.payload.expect("payload");
        let object = payload.as_object().expect("object");
        let store_api_version = object
            .get("storeApiVersion")
            .and_then(Value::as_u64)
            .expect("storeApiVersion");
        let capabilities = object
            .get("capabilities")
            .and_then(Value::as_array)
            .expect("capabilities");

        assert_eq!(store_api_version, STORE_API_VERSION as u64);
        for capability in RUNTIME_CAPABILITIES {
            assert!(
                capabilities
                    .iter()
                    .any(|candidate| candidate.as_str() == Some(*capability)),
                "missing capability {}",
                capability
            );
        }
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
                semantic_query_vector: None,
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
                semantic_query_vector: None,
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
    fn entity_cards_and_folder_schema_persist() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");

        runtime
            .upsert_entity_cards_batch(&[
                phoenix_types::EntityCard {
                    entity_id: EntityId("CHARACTER".to_owned()),
                    card_id: "summary".to_owned(),
                    name: "Summary".to_owned(),
                    color: "#ff8800".to_owned(),
                    icon: "spark".to_owned(),
                    display_order: 2,
                    is_collapsed: false,
                    created_at: 10,
                    updated_at: 10,
                },
                phoenix_types::EntityCard {
                    entity_id: EntityId("CHARACTER".to_owned()),
                    card_id: "traits".to_owned(),
                    name: "Traits".to_owned(),
                    color: "#00aaff".to_owned(),
                    icon: "bolt".to_owned(),
                    display_order: 1,
                    is_collapsed: true,
                    created_at: 11,
                    updated_at: 11,
                },
            ])
            .expect("cards");

        runtime
            .upsert_folder_schema(&phoenix_types::FolderSchema {
                id: "schema-character".to_owned(),
                entity_kind: "character".to_owned(),
                subtype: "crew".to_owned(),
                name: "Character Vault".to_owned(),
                description: "Stores character notes.".to_owned(),
                allowed_subfolders: "[\"profiles\",\"chapters\"]".to_owned(),
                allowed_note_types: "[\"bio\",\"scene\"]".to_owned(),
                is_vault_root: true,
                container_only: false,
                propagate_kind_to_children: true,
                icon: "user".to_owned(),
                is_system: false,
                created_at: 20,
                updated_at: 21,
            })
            .expect("schema");

        let cards = runtime
            .get_entity_cards(&EntityId("CHARACTER".to_owned()))
            .expect("entity cards");
        let schema = runtime
            .get_folder_schema("schema-character")
            .expect("folder schema")
            .expect("folder schema present");

        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].card_id, "traits");
        assert_eq!(schema.allowed_subfolders, "[\"profiles\",\"chapters\"]");
        assert_eq!(schema.allowed_note_types, "[\"bio\",\"scene\"]");
    }

    #[test]
    fn saved_network_view_replaces_members_and_relationships() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");

        runtime
            .save_network_view(&phoenix_types::SavedNetworkView {
                instance: phoenix_types::NetworkInstance {
                    id: "net-1".to_owned(),
                    name: "Crew".to_owned(),
                    schema_id: "schema-character".to_owned(),
                    network_kind: "mindmap".to_owned(),
                    network_subtype: "entity".to_owned(),
                    root_folder_id: "folder-1".to_owned(),
                    root_entity_id: String::new(),
                    namespace: "world".to_owned(),
                    description: "Crew graph".to_owned(),
                    tags: vec!["crew".to_owned(), "battle".to_owned()],
                    member_count: 2,
                    relationship_count: 1,
                    max_depth: 2,
                    created_at: 100,
                    updated_at: 100,
                    group_id: String::new(),
                    scope_type: "folder".to_owned(),
                    narrative_id: "nar-1".to_owned(),
                },
                members: vec![
                    phoenix_types::NetworkMembership {
                        network_id: "net-1".to_owned(),
                        entity_id: EntityId("luffy".to_owned()),
                        x: 10.0,
                        y: 20.0,
                        fixed: true,
                    },
                    phoenix_types::NetworkMembership {
                        network_id: "net-1".to_owned(),
                        entity_id: EntityId("zoro".to_owned()),
                        x: 30.0,
                        y: 40.0,
                        fixed: false,
                    },
                ],
                relationships: vec![phoenix_types::NetworkRelationship {
                    network_id: "net-1".to_owned(),
                    source_entity_id: EntityId("luffy".to_owned()),
                    target_entity_id: EntityId("zoro".to_owned()),
                    relationship_id: "edge-1".to_owned(),
                }],
            })
            .expect("initial save");

        runtime
            .save_network_view(&phoenix_types::SavedNetworkView {
                instance: phoenix_types::NetworkInstance {
                    id: "net-1".to_owned(),
                    name: "Crew Revised".to_owned(),
                    schema_id: "schema-character".to_owned(),
                    network_kind: "mindmap".to_owned(),
                    network_subtype: "entity".to_owned(),
                    root_folder_id: "folder-1".to_owned(),
                    root_entity_id: String::new(),
                    namespace: "world".to_owned(),
                    description: "Crew graph revised".to_owned(),
                    tags: vec!["crew".to_owned()],
                    member_count: 1,
                    relationship_count: 0,
                    max_depth: 1,
                    created_at: 100,
                    updated_at: 200,
                    group_id: String::new(),
                    scope_type: "folder".to_owned(),
                    narrative_id: "nar-1".to_owned(),
                },
                members: vec![phoenix_types::NetworkMembership {
                    network_id: "net-1".to_owned(),
                    entity_id: EntityId("luffy".to_owned()),
                    x: 12.0,
                    y: 24.0,
                    fixed: false,
                }],
                relationships: Vec::new(),
            })
            .expect("replacement save");

        let view = runtime
            .get_network_view("net-1")
            .expect("network fetch")
            .expect("network exists");
        let listed = runtime.list_network_views().expect("network list");

        assert_eq!(view.instance.name, "Crew Revised");
        assert_eq!(view.members.len(), 1);
        assert_eq!(view.members[0].entity_id.0, "luffy");
        assert!(view.relationships.is_empty());
        assert_eq!(listed.len(), 1);

        runtime
            .delete_network_view("net-1")
            .expect("delete network");
        assert!(runtime
            .get_network_view("net-1")
            .expect("network fetch after delete")
            .is_none());
    }

    #[test]
    fn persistence_batch_replays_content_mutations_in_order() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        runtime.init().expect("init");

        let result = runtime
            .store_command(StoreCommandRequest {
                command: "persistence:applyWalBatch".to_owned(),
                payload: json!({
                    "records": [
                        {
                            "seq": 1,
                            "command": "note:upsert",
                            "partition": "content",
                            "writtenAt": 100,
                            "payload": {
                                "row": {
                                    "id": "note-1",
                                    "version": 1,
                                    "world_id": "world-1",
                                    "title": "Alpha",
                                    "content": "Hello",
                                    "markdown_content": "Hello",
                                    "folder_id": null,
                                    "entity_kind": null,
                                    "entity_subtype": null,
                                    "is_entity": false,
                                    "is_pinned": false,
                                    "favorite": false,
                                    "owner_id": null,
                                    "narrative_id": null,
                                    "order": 0,
                                    "created_at": 10,
                                    "updated_at": 10,
                                    "valid_from": 10,
                                    "valid_to": null,
                                    "is_current": true,
                                    "change_reason": null
                                }
                            }
                        },
                        {
                            "seq": 2,
                            "command": "relation:upsert",
                            "partition": "content",
                            "writtenAt": 101,
                            "payload": {
                                "relation": "entities",
                                "row": {
                                    "id": "entity-1",
                                    "label": "Hero",
                                    "kind": "character",
                                    "subtype": null,
                                    "aliases": [],
                                    "first_note": "note-1",
                                    "total_mentions": 1,
                                    "narrative_id": null,
                                    "created_by": "user",
                                    "created_at": 10,
                                    "updated_at": 10
                                }
                            }
                        }
                    ]
                }),
            })
            .expect("wal batch");

        assert!(result.success);
        let note = runtime.get_note_value("note-1", true).expect("note");
        let entity = runtime
            .store
            .fetch_rows("entities")
            .expect("entities")
            .into_iter()
            .find(|row| row.get("id").and_then(Value::as_str) == Some("entity-1"));

        assert_eq!(
            note.and_then(|value| value
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_owned)),
            Some("Alpha".to_owned())
        );
        assert!(entity.is_some());
    }

    #[test]
    fn persistence_clear_derived_keeps_content_rows() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        runtime.init().expect("init");

        runtime
            .store
            .put_row(
                "notes",
                json!({
                    "id": "note-keep",
                    "version": 1,
                    "world_id": "world-1",
                    "title": "Keep",
                    "content": "persist",
                    "markdown_content": "persist",
                    "folder_id": null,
                    "entity_kind": null,
                    "entity_subtype": null,
                    "is_entity": false,
                    "is_pinned": false,
                    "favorite": false,
                    "owner_id": null,
                    "narrative_id": null,
                    "order": 0,
                    "created_at": 10,
                    "updated_at": 10,
                    "valid_from": 10,
                    "valid_to": null,
                    "is_current": true,
                    "change_reason": null
                }),
            )
            .expect("note row");
        runtime
            .store
            .put_row(
                "phoenix_sessions",
                json!({
                    "session_id": "session-1",
                    "label": "Derived",
                    "world_id": null,
                    "narrative_id": null,
                    "folder_id": null,
                    "folder_path": null,
                    "status": "active",
                    "revision": 0,
                    "created_at": 1,
                    "updated_at": 1
                }),
            )
            .expect("session row");

        runtime
            .store_command(StoreCommandRequest {
                command: "persistence:clearDerived".to_owned(),
                payload: json!({}),
            })
            .expect("clear derived");

        assert!(runtime
            .store
            .fetch_rows("phoenix_sessions")
            .expect("derived rows")
            .is_empty());
        assert_eq!(
            runtime
                .get_note_value("note-keep", true)
                .expect("note")
                .is_some(),
            true
        );
    }

    #[test]
    fn session_close_drops_session_and_session_logs() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        runtime.init().expect("init");
        let session = runtime
            .create_session(CreateSessionRequest {
                session_id: Some(SessionId("session-close".to_owned())),
                label: "Closable".to_owned(),
                scope: Default::default(),
            })
            .expect("session");

        runtime
            .store
            .put_row(
                "phoenix_ingest_log",
                json!({
                    "id": "ingest-1",
                    "session_id": session.session_id.0,
                    "document_count": 1,
                    "commit_requested": false,
                    "request_json": {"sessionId": session.session_id.0},
                    "created_at": 1
                }),
            )
            .expect("ingest log");
        runtime
            .store
            .put_row(
                "phoenix_query_log",
                json!({
                    "id": "query-1",
                    "session_id": session.session_id.0,
                    "query": "kai",
                    "limit": 10,
                    "request_json": {"sessionId": session.session_id.0},
                    "created_at": 1
                }),
            )
            .expect("query log");

        let result = runtime
            .store_command(StoreCommandRequest {
                command: "session:close".to_owned(),
                payload: json!({ "sessionId": session.session_id.0 }),
            })
            .expect("close session");

        assert_eq!(result.success, true);
        assert!(runtime
            .store
            .fetch_rows("phoenix_sessions")
            .expect("sessions")
            .is_empty());
        assert!(runtime
            .store
            .fetch_rows("phoenix_ingest_log")
            .expect("ingest logs")
            .is_empty());
        assert!(runtime
            .store
            .fetch_rows("phoenix_query_log")
            .expect("query logs")
            .is_empty());
    }

    #[test]
    fn planner_disabled_runs_stay_ready_to_answer() {
        let runtime = chat_runtime();
        let thread = runtime
            .chat
            .create_thread(
                &runtime.store,
                Some("world-1"),
                Some("nar-1"),
                Some("Thread"),
            )
            .expect("thread");
        runtime
            .chat
            .add_message(
                &runtime.store,
                &thread.id.0,
                "user",
                "Summarize the scoped notes.",
                Some("nar-1"),
            )
            .expect("message");

        let run = runtime
            .chat
            .start_run(
                &runtime.store,
                &thread.id.0,
                "Summarize the scoped notes.",
                run_options("nar-1", false, false),
            )
            .expect("run");

        assert_eq!(run.status, ChatRunStatus::ReadyToAnswer);

        let snapshot = runtime
            .chat
            .poll_run(&runtime.store, &run.id)
            .expect("snapshot")
            .expect("run snapshot");
        assert_eq!(snapshot.run.status, ChatRunStatus::ReadyToAnswer);
        assert!(snapshot.planner_step.is_none());
        assert!(snapshot.artifacts.is_empty());
    }

    #[test]
    fn planner_run_executes_tools_and_promotes_scoped_artifacts() {
        let runtime = chat_runtime();
        let thread = runtime
            .chat
            .create_thread(
                &runtime.store,
                Some("world-1"),
                Some("nar-1"),
                Some("Thread"),
            )
            .expect("thread");
        runtime
            .chat
            .add_message(
                &runtime.store,
                &thread.id.0,
                "user",
                "Find the in-scope note and prepare a grounded answer.",
                Some("nar-1"),
            )
            .expect("message");

        insert_note(
            &runtime,
            "note-in",
            "nar-1",
            "Inside scope",
            "Ryan waited at the harbor.",
        );
        insert_note(
            &runtime,
            "note-out",
            "nar-2",
            "Outside scope",
            "This note should never be surfaced.",
        );

        let run = runtime
            .chat
            .start_run(
                &runtime.store,
                &thread.id.0,
                "Find the in-scope note and prepare a grounded answer.",
                run_options("nar-1", true, false),
            )
            .expect("run");
        assert_eq!(run.status, ChatRunStatus::Planning);
        let run_id = run.id.clone();

        let step =
            planner_step_command(&runtime, "chat:getPlannerStep", json!({ "runId": run_id }));
        let request = match step {
            ChatPlannerStep::ModelRequest { request } => request,
            other => panic!("expected initial model request, got {other:?}"),
        };
        assert!(request.allow_tools);

        let tool_step = planner_step_from_payload(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:submitPlannerModelResponse".to_owned(),
                    payload: json!({
                        "runId": run_id,
                        "response": ChatPlannerModelResponse {
                            content: String::new(),
                            tool_calls: vec![
                                phoenix_types::ChatPlannerToolCall {
                                    id: "tool-note-list".to_owned(),
                                    name: "note_list".to_owned(),
                                    arguments_json: r#"{"limit":10}"#.to_owned(),
                                },
                                phoenix_types::ChatPlannerToolCall {
                                    id: "tool-artifact-put".to_owned(),
                                    name: "artifact_put".to_owned(),
                                    arguments_json: r#"{"kind":"claim_list","payload":{"claim":"Ryan waited at the harbor."},"pinned":false}"#.to_owned(),
                                },
                            ],
                        },
                    }),
                })
                .expect("submit planner response")
                .payload
                .expect("tool step payload"),
        );

        match tool_step {
            ChatPlannerStep::ToolCalls { tool_calls, .. } => assert_eq!(tool_calls.len(), 2),
            other => panic!("expected tool calls step, got {other:?}"),
        }

        let step_after_tools = planner_step_command(
            &runtime,
            "chat:advancePlannerRun",
            json!({ "runId": run_id }),
        );
        let request_after_tools = match step_after_tools {
            ChatPlannerStep::ModelRequest { request } => request,
            other => panic!("expected follow-up model request, got {other:?}"),
        };
        let note_list_message = request_after_tools
            .messages
            .iter()
            .find(|message| message.tool_call_id.as_deref() == Some("tool-note-list"))
            .expect("note_list tool message");
        let note_list_payload: Value =
            serde_json::from_str(&note_list_message.content).expect("note list payload");
        let note_ids = note_list_payload
            .get("notes")
            .and_then(Value::as_array)
            .expect("notes array")
            .iter()
            .filter_map(|note| note.get("id").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(note_ids, vec!["note-in"]);

        let complete_step = planner_step_from_payload(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:submitPlannerModelResponse".to_owned(),
                    payload: json!({
                        "runId": run_id,
                        "response": ChatPlannerModelResponse {
                            content: "Ground the answer in note-in and the saved claims.".to_owned(),
                            tool_calls: Vec::new(),
                        },
                    }),
                })
                .expect("submit planner summary")
                .payload
                .expect("complete payload"),
        );
        match complete_step {
            ChatPlannerStep::Complete { response, .. } => {
                assert_eq!(
                    response,
                    "Ground the answer in note-in and the saved claims."
                )
            }
            other => panic!("expected planner completion, got {other:?}"),
        }

        let snapshot: ChatRunSnapshot = serde_json::from_value(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:pollRun".to_owned(),
                    payload: json!({ "runId": run_id }),
                })
                .expect("poll run")
                .payload
                .expect("snapshot payload"),
        )
        .expect("snapshot");
        assert_eq!(snapshot.run.status, ChatRunStatus::ReadyToAnswer);
        assert!(snapshot
            .run
            .prepared_system_prompt
            .contains("Ground the answer in note-in and the saved claims."));
        assert!(snapshot.planner_step.is_none());
        assert!(snapshot
            .artifacts
            .iter()
            .any(|artifact| artifact.kind == "draft_answer" && artifact.pinned));
        let claim_artifact = snapshot
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "claim_list")
            .cloned()
            .expect("claim_list artifact");
        assert!(!claim_artifact.pinned);

        let artifacts: Vec<ChatWorkspaceArtifact> = serde_json::from_value(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:listPlannerArtifacts".to_owned(),
                    payload: json!({ "runId": run_id }),
                })
                .expect("list artifacts")
                .payload
                .expect("artifacts payload"),
        )
        .expect("artifacts");
        assert!(artifacts
            .iter()
            .any(|artifact| artifact.key == claim_artifact.key));

        let pinned: ChatWorkspaceArtifact = serde_json::from_value(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:pinPlannerArtifact".to_owned(),
                    payload: json!({
                        "runId": run_id,
                        "key": claim_artifact.key,
                        "pinned": true,
                    }),
                })
                .expect("pin artifact")
                .payload
                .expect("pin payload"),
        )
        .expect("pinned artifact");
        assert!(pinned.pinned);
    }

    #[test]
    fn planner_canvas_tools_pause_for_ts_host_and_resume_after_approval() {
        let runtime = chat_runtime();
        let thread = runtime
            .chat
            .create_thread(
                &runtime.store,
                Some("world-1"),
                Some("nar-1"),
                Some("Thread"),
            )
            .expect("thread");
        runtime
            .chat
            .add_message(
                &runtime.store,
                &thread.id.0,
                "user",
                "Rewrite the highlighted paragraph in the open note.",
                Some("nar-1"),
            )
            .expect("message");

        let run = runtime
            .chat
            .start_run(
                &runtime.store,
                &thread.id.0,
                "Rewrite the highlighted paragraph in the open note.",
                run_options("nar-1", true, true),
            )
            .expect("run");
        let run_id = run.id.clone();

        let initial_step =
            planner_step_command(&runtime, "chat:getPlannerStep", json!({ "runId": run_id }));
        let initial_request = match initial_step {
            ChatPlannerStep::ModelRequest { request } => request,
            other => panic!("expected initial model request, got {other:?}"),
        };
        assert!(initial_request
            .tools
            .iter()
            .any(|tool| tool.name == "get_active_note_snapshot"));
        assert!(initial_request
            .tools
            .iter()
            .any(|tool| tool.name == "replace_text_proposal"));

        let tool_step = planner_step_from_payload(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:submitPlannerModelResponse".to_owned(),
                    payload: json!({
                        "runId": run_id,
                        "response": ChatPlannerModelResponse {
                            content: String::new(),
                            tool_calls: vec![
                                phoenix_types::ChatPlannerToolCall {
                                    id: "tool-note-snapshot".to_owned(),
                                    name: "get_active_note_snapshot".to_owned(),
                                    arguments_json: "{}".to_owned(),
                                },
                                phoenix_types::ChatPlannerToolCall {
                                    id: "tool-highlight".to_owned(),
                                    name: "highlight_range".to_owned(),
                                    arguments_json: r#"{"from":12,"to":48}"#.to_owned(),
                                },
                                phoenix_types::ChatPlannerToolCall {
                                    id: "tool-replace".to_owned(),
                                    name: "replace_text_proposal".to_owned(),
                                    arguments_json: r#"{"from":12,"to":48,"replacement":"Rewritten paragraph.","expectedRevision":42}"#.to_owned(),
                                },
                            ],
                        },
                    }),
                })
                .expect("submit planner response")
                .payload
                .expect("tool step payload"),
        );
        match tool_step {
            ChatPlannerStep::ToolCalls { tool_calls, .. } => assert_eq!(tool_calls.len(), 3),
            other => panic!("expected tool calls step, got {other:?}"),
        }

        let after_advance = runtime
            .store_command(StoreCommandRequest {
                command: "chat:advancePlannerRun".to_owned(),
                payload: json!({ "runId": run_id }),
            })
            .expect("advance planner run");
        assert!(after_advance.payload.is_none());

        let awaiting_host: ChatRunSnapshot = serde_json::from_value(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:pollRun".to_owned(),
                    payload: json!({ "runId": run_id }),
                })
                .expect("poll awaiting host")
                .payload
                .expect("awaiting host payload"),
        )
        .expect("awaiting host snapshot");
        assert_eq!(awaiting_host.run.status, ChatRunStatus::AwaitingToolHost);
        assert_eq!(awaiting_host.tool_calls.len(), 3);
        assert!(awaiting_host
            .tool_calls
            .iter()
            .all(|call| call.host == "typescript" && call.status == "pending_host"));

        let after_tools: ChatRunSnapshot = serde_json::from_value(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:submitToolResults".to_owned(),
                    payload: json!({
                        "runId": run_id,
                        "results": [
                            {
                                "toolCallId": "tool-note-snapshot",
                                "resultJson": "{\"noteId\":\"note-1\",\"revision\":42,\"text\":\"Original paragraph.\"}"
                            },
                            {
                                "toolCallId": "tool-highlight",
                                "resultJson": "{\"ok\":true}"
                            },
                            {
                                "toolCallId": "tool-replace",
                                "proposal": {
                                    "proposalId": "approval-1",
                                    "toolName": "replace_text_proposal",
                                    "affectedNoteId": "note-1",
                                    "summary": "Replace the highlighted paragraph",
                                    "diffPreview": "Replace the highlighted paragraph with a tighter rewrite.",
                                    "expectedRevision": 42,
                                    "rollbackToken": "note-1:42",
                                    "payloadJson": "{\"kind\":\"replace_text\",\"from\":12,\"to\":48,\"replacement\":\"Rewritten paragraph.\",\"expectedRevision\":42}"
                                }
                            }
                        ]
                    }),
                })
                .expect("submit tool results")
                .payload
                .expect("tool results payload"),
        )
        .expect("after tools snapshot");
        assert_eq!(after_tools.run.status, ChatRunStatus::AwaitingApproval);
        assert_eq!(after_tools.approvals.len(), 1);
        assert!(after_tools
            .tool_calls
            .iter()
            .any(|call| call.tool_call_id == "tool-replace" && call.status == "awaiting_approval"));

        let approval_id = after_tools.approvals[0].id.clone();
        let after_approval: ChatRunSnapshot = serde_json::from_value(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:submitApproval".to_owned(),
                    payload: json!({
                        "runId": run_id,
                        "approvalId": approval_id,
                        "approved": true,
                        "decisionJson": "{\"approved\":true,\"applied\":true,\"autoApplied\":false}"
                    }),
                })
                .expect("submit approval")
                .payload
                .expect("approval payload"),
        )
        .expect("after approval snapshot");
        assert_eq!(after_approval.run.status, ChatRunStatus::Planning);

        let resumed_step =
            planner_step_command(&runtime, "chat:getPlannerStep", json!({ "runId": run_id }));
        let resumed_request = match resumed_step {
            ChatPlannerStep::ModelRequest { request } => request,
            other => panic!("expected resumed model request, got {other:?}"),
        };
        assert!(resumed_request
            .messages
            .iter()
            .any(|message| message.tool_call_id.as_deref() == Some("tool-note-snapshot")));
        assert!(resumed_request
            .messages
            .iter()
            .any(|message| message.tool_call_id.as_deref() == Some("tool-replace")));

        let complete_step = planner_step_from_payload(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:submitPlannerModelResponse".to_owned(),
                    payload: json!({
                        "runId": run_id,
                        "response": ChatPlannerModelResponse {
                            content: "The active note edit has been planned and approved.".to_owned(),
                            tool_calls: Vec::new(),
                        },
                    }),
                })
                .expect("submit final planner response")
                .payload
                .expect("final planner payload"),
        );
        match complete_step {
            ChatPlannerStep::Complete { response, .. } => {
                assert_eq!(
                    response,
                    "The active note edit has been planned and approved."
                )
            }
            other => panic!("expected completion after approval, got {other:?}"),
        }

        let final_snapshot: ChatRunSnapshot = serde_json::from_value(
            runtime
                .store_command(StoreCommandRequest {
                    command: "chat:pollRun".to_owned(),
                    payload: json!({ "runId": run_id }),
                })
                .expect("poll final snapshot")
                .payload
                .expect("final snapshot payload"),
        )
        .expect("final snapshot");
        assert_eq!(final_snapshot.run.status, ChatRunStatus::ReadyToAnswer);
    }

    #[test]
    fn runtime_text_analytics_matches_gokitt_shape() {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        let analytics = runtime.analyze_text(
            "The iron gate slammed shut. The iron gate rattled again. The iron gate shook against the wall. \
Bright embers glowed beside the ember-lit grate. Bright embers hissed in the ash.",
        );

        assert!(analytics.word_count > 0);
        assert!(!analytics.repetition.items.is_empty());
        assert!(!analytics.proximity.items.is_empty());
        assert_eq!(analytics.cadence.sentences.len(), 5);
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

    fn chat_runtime() -> PhoenixRuntime {
        let runtime = PhoenixRuntime::new(RuntimeConfig::default()).expect("runtime");
        runtime.init().expect("init");
        runtime
    }

    fn run_options(
        narrative_id: &str,
        planner_enabled: bool,
        mutations_enabled: bool,
    ) -> RunOptions {
        RunOptions {
            final_provider: "openrouter".to_owned(),
            final_model: "meta-llama/llama-3.3-70b-instruct:free".to_owned(),
            planner_model: Some("meta-llama/llama-3.3-70b-instruct:free".to_owned()),
            om_model: None,
            planner_enabled,
            om_enabled: false,
            workspace_enabled: planner_enabled,
            mutations_enabled,
            deadline_ms: 8_000,
            mutation_policy: "confirm".to_owned(),
            narrative_id: Some(narrative_id.to_owned()),
            folder_id: None,
            scope_id: Some(narrative_id.to_owned()),
            base_system_prompt: Some("You are Kammi.".to_owned()),
            initial_external_context: None,
        }
    }

    fn insert_note(
        runtime: &PhoenixRuntime,
        note_id: &str,
        narrative_id: &str,
        title: &str,
        content: &str,
    ) {
        runtime
            .store
            .put_row(
                "notes",
                json!({
                    "id": note_id,
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
                    "owner_id": null,
                    "narrative_id": narrative_id,
                    "order": 0,
                    "created_at": 10,
                    "updated_at": 10,
                    "valid_from": 10,
                    "valid_to": null,
                    "is_current": true,
                    "change_reason": null
                }),
            )
            .expect("note row");
    }

    fn planner_step_command(
        runtime: &PhoenixRuntime,
        command: &str,
        payload: Value,
    ) -> ChatPlannerStep {
        planner_step_from_payload(
            runtime
                .store_command(StoreCommandRequest {
                    command: command.to_owned(),
                    payload,
                })
                .expect("planner command")
                .payload
                .expect("planner payload"),
        )
    }

    fn planner_step_from_payload(payload: Value) -> ChatPlannerStep {
        serde_json::from_value(payload).expect("planner step")
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
