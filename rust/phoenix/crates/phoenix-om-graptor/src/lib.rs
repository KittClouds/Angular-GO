use std::collections::BTreeSet;

use phoenix_graptor::{
    BorrowedIngestDocument, BorrowedIngestRequest, BorrowedIngestThread, BorrowedThreadMessage,
    GraptorConfig, PhoenixGraptor,
};
use phoenix_scanner::PhoenixScanner;
use phoenix_store_cozo::{CompactRowView, PhoenixCozoStore, StoreError};
use phoenix_structure::PhoenixStructure;
use phoenix_types::{
    DocumentId, OmGraphIndexRecord, OmIndexResult, OmLostMemoryHit, OmMemorySearchHit, ScopeKey,
    ThreadMessage,
};
use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::{json, Value};

const KIND_MESSAGES: &str = "messages";
const KIND_OBSERVATION: &str = "observation";
const KIND_REFLECTION: &str = "reflection";
const MAX_RELATION_SUMMARIES: usize = 4;
const MAX_SNIPPET_CHARS: usize = 240;
const MAX_SOURCE_KEYS_PER_HIT: usize = 4;

const OM_GRAPH_INDEX_COLUMNS: &[&str] = &[
    "thread_id",
    "kind",
    "source_key",
    "document_id",
    "entity_count",
    "edge_count",
    "created_at",
];
const ENTITY_COLUMNS: &[&str] = &["id", "label", "aliases", "total_mentions"];
const SPAN_COLUMNS: &[&str] = &["id", "note_id", "text"];
const SPAN_MENTION_COLUMNS: &[&str] = &["span_id", "candidate_entity_id"];
const GRAPH_EDGE_COLUMNS: &[&str] = &["source_id", "target_id", "edge_type", "document_id"];
const GRAPH_VERTEX_COLUMNS: &[&str] = &["id", "value"];

#[derive(Debug, thiserror::Error)]
pub enum OmGraptorError {
    #[error(transparent)]
    Store(#[from] StoreError),
}

pub struct OmGraptorBridge {
    message_graptor: PhoenixGraptor,
    summary_graptor: PhoenixGraptor,
}

impl Default for OmGraptorBridge {
    fn default() -> Self {
        let mut message_config = GraptorConfig::default().without_chapter_detection();
        message_config.chunk_size = 600;
        message_config.overlap = 150;
        message_config.parent_chunk_size = 1_800;
        message_config.parent_overlap = 450;
        let message_graptor = PhoenixGraptor::new(message_config);

        let mut summary_config = GraptorConfig::default().without_chapter_detection();
        summary_config.chunk_size = 300;
        summary_config.overlap = 50;
        summary_config.parent_chunk_size = 900;
        summary_config.parent_overlap = 200;
        let summary_graptor = PhoenixGraptor::new(summary_config);
        Self {
            message_graptor,
            summary_graptor,
        }
    }
}

impl OmGraptorBridge {
    pub fn index_message_window(
        &self,
        store: &PhoenixCozoStore,
        scanner: &PhoenixScanner,
        structure: &PhoenixStructure,
        thread_id: &str,
        source_key: &str,
        messages: &[ThreadMessage],
    ) -> Result<OmIndexResult, OmGraptorError> {
        if messages.is_empty() {
            return Ok(OmIndexResult {
                kind: KIND_MESSAGES.to_owned(),
                source_key: source_key.to_owned(),
                ..OmIndexResult::default()
            });
        }

        let document_id = message_document_id(thread_id, source_key);
        let title = format!("Thread Messages {thread_id} {source_key}");
        let borrowed_messages = messages
            .iter()
            .map(|message| BorrowedThreadMessage {
                message_id: &message.id,
                role: &message.role,
                content: &message.content,
                created_at: message.created_at,
            })
            .collect::<Vec<_>>();
        let thread = BorrowedIngestThread {
            document_id: DocumentId(document_id.clone()),
            title: &title,
            messages: &borrowed_messages,
            scope: thread_scope(thread_id),
        };
        let result = self
            .message_graptor
            .ingest_message_thread_view(store, scanner, structure, &thread)?;
        let index = OmIndexResult {
            kind: KIND_MESSAGES.to_owned(),
            source_key: source_key.to_owned(),
            document_id: document_id.clone(),
            entity_count: result
                .entity_summary
                .as_ref()
                .map(|summary| summary.total_entities as i64)
                .unwrap_or_default(),
            edge_count: result
                .graph_summary
                .as_ref()
                .map(|summary| summary.total_edges as i64)
                .unwrap_or_default(),
        };
        self.upsert_index_record(store, thread_id, &index)?;
        Ok(index)
    }

    pub fn index_observation_delta(
        &self,
        store: &PhoenixCozoStore,
        scanner: &PhoenixScanner,
        structure: &PhoenixStructure,
        thread_id: &str,
        source_key: &str,
        observation_text: &str,
    ) -> Result<OmIndexResult, OmGraptorError> {
        self.index_text_document(
            store,
            scanner,
            structure,
            thread_id,
            KIND_OBSERVATION,
            source_key,
            &format!("Observations {thread_id} {source_key}"),
            observation_text,
        )
    }

    pub fn index_reflection_summary(
        &self,
        store: &PhoenixCozoStore,
        scanner: &PhoenixScanner,
        structure: &PhoenixStructure,
        thread_id: &str,
        source_key: &str,
        reflection_text: &str,
    ) -> Result<OmIndexResult, OmGraptorError> {
        self.index_text_document(
            store,
            scanner,
            structure,
            thread_id,
            KIND_REFLECTION,
            source_key,
            &format!("Reflection {thread_id} {source_key}"),
            reflection_text,
        )
    }

    pub fn recover_lost_memory(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
        limit: usize,
        focus: Option<&str>,
    ) -> Result<Vec<OmLostMemoryHit>, OmGraptorError> {
        let indices = self.load_index_rows(store, thread_id)?;
        let message_docs = indices_for_kind(&indices, KIND_MESSAGES);
        if message_docs.is_empty() {
            return Ok(Vec::new());
        }
        let summary_docs = indices
            .iter()
            .filter(|row| row.kind == KIND_OBSERVATION || row.kind == KIND_REFLECTION)
            .map(|row| row.document_id.clone())
            .collect::<Vec<_>>();
        let message_doc_ids = message_docs.keys().cloned().collect::<Vec<_>>();
        let message_mentions = entity_mentions_by_document(store, &message_doc_ids)?;
        if message_mentions.is_empty() {
            return Ok(Vec::new());
        }
        let summary_mentions = entity_mentions_by_document(store, &summary_docs)?;
        let entity_ids = message_mentions.keys().cloned().collect::<Vec<_>>();
        let entity_rows = load_entity_rows(store, &entity_ids)?;
        let normalized_focus = focus.map(|value| value.trim().to_ascii_lowercase());

        let mut lost = Vec::new();
        for (entity_id, documents) in message_mentions {
            if summary_mentions.contains_key(&entity_id) {
                continue;
            }
            let Some(row) = entity_rows.get(&entity_id) else {
                continue;
            };
            let label_matches = normalized_focus
                .as_deref()
                .map(|needle| label_or_alias_matches(row, needle))
                .unwrap_or(true);
            if !label_matches {
                continue;
            }
            let mut source_keys = documents
                .iter()
                .filter_map(|document_id| message_docs.get(document_id).cloned())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .take(MAX_SOURCE_KEYS_PER_HIT)
                .collect::<Vec<_>>();
            source_keys.sort();
            lost.push(OmLostMemoryHit {
                entity_id: entity_id.clone(),
                label: row.label.clone(),
                total_mentions: row.total_mentions,
                source_keys,
                relation_summaries: relation_summaries_for_entity(
                    store,
                    &entity_id,
                    &documents,
                    MAX_RELATION_SUMMARIES,
                )?,
            });
        }
        lost.sort_by(|left, right| {
            right
                .total_mentions
                .cmp(&left.total_mentions)
                .then_with(|| left.label.cmp(&right.label))
        });
        lost.truncate(limit.max(1));
        Ok(lost)
    }

    pub fn memory_graph_search(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<OmMemorySearchHit>, OmGraptorError> {
        let query = query.trim().to_ascii_lowercase();
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let indices = self.load_index_rows(store, thread_id)?;
        if indices.is_empty() {
            return Ok(Vec::new());
        }
        let allowed_docs = indices
            .into_iter()
            .map(|row| (row.document_id, (row.kind, row.source_key)))
            .collect::<FxHashMap<_, _>>();
        let allowed_doc_ids = allowed_docs.keys().cloned().collect::<Vec<_>>();
        let mentions = entity_mentions_by_document(store, &allowed_doc_ids)?;
        if mentions.is_empty() {
            return Ok(Vec::new());
        }
        let entity_ids = mentions.keys().cloned().collect::<Vec<_>>();
        let entity_rows = load_entity_rows(store, &entity_ids)?;
        let snippets = first_snippet_by_entity(store, &allowed_doc_ids)?;

        let mut hits = Vec::new();
        for (entity_id, documents) in mentions {
            let Some(entity) = entity_rows.get(&entity_id) else {
                continue;
            };
            let alias_match = entity
                .aliases
                .iter()
                .any(|alias| alias.to_ascii_lowercase().contains(&query));
            let relation_summaries = relation_summaries_for_entity(
                store,
                &entity_id,
                &documents,
                MAX_RELATION_SUMMARIES,
            )?;
            let relation_match = relation_summaries
                .iter()
                .any(|summary| summary.to_ascii_lowercase().contains(&query));
            if !entity.label.to_ascii_lowercase().contains(&query)
                && !alias_match
                && !relation_match
            {
                continue;
            }

            let Some(document_id) = documents.iter().next().cloned() else {
                continue;
            };
            let Some((source_kind, source_key)) = allowed_docs.get(&document_id).cloned() else {
                continue;
            };
            hits.push(OmMemorySearchHit {
                label: entity.label.clone(),
                kind: "entity".to_owned(),
                document_id: document_id.clone(),
                source_kind,
                source_key,
                snippet: snippets.get(&entity_id).cloned().unwrap_or_default(),
                relation_summaries,
            });
        }
        hits.sort_by(|left, right| left.label.cmp(&right.label));
        hits.truncate(limit.max(1));
        Ok(hits)
    }

    fn index_text_document(
        &self,
        store: &PhoenixCozoStore,
        scanner: &PhoenixScanner,
        structure: &PhoenixStructure,
        thread_id: &str,
        kind: &str,
        source_key: &str,
        title: &str,
        text: &str,
    ) -> Result<OmIndexResult, OmGraptorError> {
        let document_id = summary_document_id(thread_id, kind, source_key);
        let document = BorrowedIngestDocument {
            document_id: DocumentId(document_id.clone()),
            note_id: None,
            title,
            text,
            scope: thread_scope(thread_id),
        };
        let result = self.summary_graptor.ingest_view(
            store,
            scanner,
            structure,
            &BorrowedIngestRequest {
                session_id: None,
                documents: &[document],
            },
        )?;
        let index = OmIndexResult {
            kind: kind.to_owned(),
            source_key: source_key.to_owned(),
            document_id: document_id.clone(),
            entity_count: result
                .entity_summary
                .as_ref()
                .map(|summary| summary.total_entities as i64)
                .unwrap_or_default(),
            edge_count: result
                .graph_summary
                .as_ref()
                .map(|summary| summary.total_edges as i64)
                .unwrap_or_default(),
        };
        self.upsert_index_record(store, thread_id, &index)?;
        Ok(index)
    }

    fn upsert_index_record(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
        index: &OmIndexResult,
    ) -> Result<(), OmGraptorError> {
        store.put_row(
            "om_graph_index",
            json!({
                "thread_id": thread_id,
                "kind": index.kind,
                "source_key": index.source_key,
                "document_id": index.document_id,
                "entity_count": index.entity_count,
                "edge_count": index.edge_count,
                "created_at": now_ms(),
            }),
        )?;
        Ok(())
    }

    fn load_index_rows(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
    ) -> Result<Vec<OmGraphIndexRecord>, OmGraptorError> {
        let rows = store.fetch_compact_rows_where_str(
            "om_graph_index",
            OM_GRAPH_INDEX_COLUMNS,
            "thread_id",
            thread_id,
        )?;
        let mut records = rows
            .iter()
            .map(|row| graph_index_from_row(&CompactRowView::new(OM_GRAPH_INDEX_COLUMNS, row)))
            .collect::<Result<Vec<_>, _>>()?;
        records.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        Ok(records)
    }
}

#[derive(Clone, Debug, Default)]
struct EntityRow {
    label: String,
    aliases: Vec<String>,
    total_mentions: i64,
}

fn thread_scope(thread_id: &str) -> ScopeKey {
    ScopeKey {
        narrative_id: Some(thread_id.to_owned()),
        ..ScopeKey::default()
    }
}

fn message_document_id(thread_id: &str, source_key: &str) -> String {
    format!("om::thread::{thread_id}::messages::{source_key}")
}

fn summary_document_id(thread_id: &str, kind: &str, source_key: &str) -> String {
    format!("om::thread::{thread_id}::{kind}::{source_key}")
}

fn indices_for_kind(rows: &[OmGraphIndexRecord], kind: &str) -> FxHashMap<String, String> {
    rows.iter()
        .filter(|row| row.kind == kind)
        .map(|row| (row.document_id.clone(), row.source_key.clone()))
        .collect()
}

fn load_entity_rows(
    store: &PhoenixCozoStore,
    entity_ids: &[String],
) -> Result<FxHashMap<String, EntityRow>, OmGraptorError> {
    if entity_ids.is_empty() {
        return Ok(FxHashMap::default());
    }
    let rows =
        store.fetch_compact_rows_where_in_strings("entities", ENTITY_COLUMNS, "id", entity_ids)?;
    Ok(rows
        .iter()
        .map(|row| {
            let row = CompactRowView::new(ENTITY_COLUMNS, row);
            (
                row.get_str("id").unwrap_or_default().to_owned(),
                EntityRow {
                    label: row.get_str("label").unwrap_or_default().to_owned(),
                    aliases: row
                        .get_json("aliases")
                        .and_then(|value| {
                            value.as_array().map(|items| {
                                items
                                    .iter()
                                    .filter_map(Value::as_str)
                                    .map(str::to_owned)
                                    .collect::<Vec<_>>()
                            })
                        })
                        .unwrap_or_default(),
                    total_mentions: row.get_i64("total_mentions").unwrap_or_default(),
                },
            )
        })
        .collect())
}

fn entity_mentions_by_document(
    store: &PhoenixCozoStore,
    allowed_documents: &[String],
) -> Result<FxHashMap<String, FxHashSet<String>>, OmGraptorError> {
    if allowed_documents.is_empty() {
        return Ok(FxHashMap::default());
    }

    let span_rows = store.fetch_compact_rows_where_in_strings(
        "spans",
        SPAN_COLUMNS,
        "note_id",
        allowed_documents,
    )?;
    let mut span_to_document = FxHashMap::<String, String>::default();
    let mut span_ids = Vec::new();
    for row in &span_rows {
        let row = CompactRowView::new(SPAN_COLUMNS, row);
        let span_id = row.get_str("id").unwrap_or_default().to_owned();
        let document_id = row.get_str("note_id").unwrap_or_default().to_owned();
        if !span_id.is_empty() && !document_id.is_empty() {
            span_ids.push(span_id.clone());
            span_to_document.insert(span_id, document_id);
        }
    }
    if span_ids.is_empty() {
        return Ok(FxHashMap::default());
    }

    let mention_rows = store.fetch_compact_rows_where_in_strings(
        "span_mentions",
        SPAN_MENTION_COLUMNS,
        "span_id",
        &span_ids,
    )?;
    let mut mentions = FxHashMap::<String, FxHashSet<String>>::default();
    for row in &mention_rows {
        let row = CompactRowView::new(SPAN_MENTION_COLUMNS, row);
        let span_id = row.get_str("span_id").unwrap_or_default();
        let entity_id = row.get_str("candidate_entity_id").unwrap_or_default();
        if span_id.is_empty() || entity_id.is_empty() {
            continue;
        }
        let Some(document_id) = span_to_document.get(span_id) else {
            continue;
        };
        mentions
            .entry(entity_id.to_owned())
            .or_default()
            .insert(document_id.clone());
    }
    Ok(mentions)
}

fn first_snippet_by_entity(
    store: &PhoenixCozoStore,
    allowed_documents: &[String],
) -> Result<FxHashMap<String, String>, OmGraptorError> {
    if allowed_documents.is_empty() {
        return Ok(FxHashMap::default());
    }
    let span_rows = store.fetch_compact_rows_where_in_strings(
        "spans",
        SPAN_COLUMNS,
        "note_id",
        allowed_documents,
    )?;
    let mut span_text = FxHashMap::<String, String>::default();
    let mut span_ids = Vec::new();
    for row in &span_rows {
        let row = CompactRowView::new(SPAN_COLUMNS, row);
        let span_id = row.get_str("id").unwrap_or_default().to_owned();
        if span_id.is_empty() {
            continue;
        }
        span_ids.push(span_id.clone());
        span_text.insert(
            span_id,
            clip_text(row.get_str("text").unwrap_or_default(), MAX_SNIPPET_CHARS),
        );
    }
    if span_ids.is_empty() {
        return Ok(FxHashMap::default());
    }

    let mention_rows = store.fetch_compact_rows_where_in_strings(
        "span_mentions",
        SPAN_MENTION_COLUMNS,
        "span_id",
        &span_ids,
    )?;
    let mut snippets = FxHashMap::<String, String>::default();
    for row in &mention_rows {
        let row = CompactRowView::new(SPAN_MENTION_COLUMNS, row);
        let span_id = row.get_str("span_id").unwrap_or_default();
        let entity_id = row.get_str("candidate_entity_id").unwrap_or_default();
        if span_id.is_empty() || entity_id.is_empty() || snippets.contains_key(entity_id) {
            continue;
        }
        if let Some(text) = span_text.get(span_id) {
            snippets.insert(entity_id.to_owned(), text.clone());
        }
    }
    Ok(snippets)
}

fn relation_summaries_for_entity(
    store: &PhoenixCozoStore,
    entity_id: &str,
    allowed_documents: &FxHashSet<String>,
    limit: usize,
) -> Result<Vec<String>, OmGraptorError> {
    if allowed_documents.is_empty() {
        return Ok(Vec::new());
    }
    let document_ids = allowed_documents.iter().cloned().collect::<Vec<_>>();
    let edge_rows = store.fetch_compact_rows_where_in_strings(
        "graph_edges",
        GRAPH_EDGE_COLUMNS,
        "document_id",
        &document_ids,
    )?;
    let entity_vertex_id = format!("entity::{entity_id}");
    let mut relevant_edges = Vec::new();
    let mut vertex_ids = FxHashSet::<String>::default();
    for row in &edge_rows {
        let row = CompactRowView::new(GRAPH_EDGE_COLUMNS, row);
        let source_id = row.get_str("source_id").unwrap_or_default();
        let target_id = row.get_str("target_id").unwrap_or_default();
        if source_id != entity_vertex_id && target_id != entity_vertex_id {
            continue;
        }
        let other_id = if source_id == entity_vertex_id {
            target_id
        } else {
            source_id
        };
        vertex_ids.insert(other_id.to_owned());
        relevant_edges.push((
            row.get_str("edge_type").unwrap_or_default().to_owned(),
            other_id.to_owned(),
        ));
        if relevant_edges.len() >= limit {
            break;
        }
    }
    if relevant_edges.is_empty() {
        return Ok(Vec::new());
    }

    let vertex_rows = store.fetch_compact_rows_where_in_strings(
        "graph_vertices",
        GRAPH_VERTEX_COLUMNS,
        "id",
        &vertex_ids.into_iter().collect::<Vec<_>>(),
    )?;
    let vertex_labels = vertex_rows
        .iter()
        .map(|row| {
            let row = CompactRowView::new(GRAPH_VERTEX_COLUMNS, row);
            let vertex_id = row.get_str("id").unwrap_or_default().to_owned();
            let label = row
                .get_json("value")
                .as_ref()
                .and_then(vertex_label_from_value)
                .unwrap_or_else(|| vertex_id.clone());
            (vertex_id, label)
        })
        .collect::<FxHashMap<_, _>>();

    Ok(relevant_edges
        .into_iter()
        .map(|(edge_type, other_id)| {
            let other_label = vertex_labels
                .get(&other_id)
                .cloned()
                .unwrap_or(other_id.clone());
            format!("{edge_type}: {other_label}")
        })
        .take(limit)
        .collect())
}

fn label_or_alias_matches(row: &EntityRow, needle: &str) -> bool {
    row.label.to_ascii_lowercase().contains(needle)
        || row
            .aliases
            .iter()
            .any(|alias| alias.to_ascii_lowercase().contains(needle))
}

fn vertex_label_from_value(value: &Value) -> Option<String> {
    value
        .get("label")
        .and_then(Value::as_str)
        .or_else(|| value.get("lemma").and_then(Value::as_str))
        .or_else(|| value.get("kind").and_then(Value::as_str))
        .map(str::to_owned)
}

fn clip_text(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_owned();
    }
    let clipped = text.chars().take(limit).collect::<String>();
    format!("{clipped}...")
}

fn graph_index_from_row(row: &CompactRowView<'_>) -> Result<OmGraphIndexRecord, StoreError> {
    Ok(OmGraphIndexRecord {
        thread_id: row.get_str("thread_id").unwrap_or_default().to_owned(),
        kind: row.get_str("kind").unwrap_or_default().to_owned(),
        source_key: row.get_str("source_key").unwrap_or_default().to_owned(),
        document_id: row.get_str("document_id").unwrap_or_default().to_owned(),
        entity_count: row.get_i64("entity_count").unwrap_or_default(),
        edge_count: row.get_i64("edge_count").unwrap_or_default(),
        created_at: row.get_i64("created_at").unwrap_or_default(),
    })
}

fn now_ms() -> i64 {
    js_sys_time().unwrap_or_else(fallback_now_ms)
}

#[cfg(target_arch = "wasm32")]
fn js_sys_time() -> Option<i64> {
    Some(js_sys::Date::now() as i64)
}

#[cfg(not(target_arch = "wasm32"))]
fn js_sys_time() -> Option<i64> {
    None
}

#[cfg(not(target_arch = "wasm32"))]
fn fallback_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(target_arch = "wasm32")]
fn fallback_now_ms() -> i64 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use phoenix_scanner::PhoenixScanner;
    use phoenix_store_cozo::{PhoenixCozoStore, StoreConfig};
    use phoenix_structure::PhoenixStructure;
    use phoenix_types::StorageMode;

    fn store() -> PhoenixCozoStore {
        let store = PhoenixCozoStore::open(StoreConfig {
            mode: StorageMode::CozoMem,
            path: None,
        })
        .expect("open store");
        store.init_schema().expect("init schema");
        store
    }

    #[test]
    fn indexing_message_window_writes_graph_index_rows() {
        let store = store();
        let bridge = OmGraptorBridge::default();
        let scanner = PhoenixScanner::default();
        let structure = PhoenixStructure::default();
        let messages = vec![
            ThreadMessage {
                id: "msg-1".to_owned(),
                thread_id: "thread-1".to_owned(),
                role: "user".to_owned(),
                content: "Ryan met Len at the harbor and took the artifact.".to_owned(),
                narrative_id: String::new(),
                created_at: 1,
                updated_at: 1,
                is_streaming: false,
                token_count: Some(10),
                is_observed: false,
            },
            ThreadMessage {
                id: "msg-2".to_owned(),
                thread_id: "thread-1".to_owned(),
                role: "assistant".to_owned(),
                content: "Ryan promised to return before dawn.".to_owned(),
                narrative_id: String::new(),
                created_at: 2,
                updated_at: 2,
                is_streaming: false,
                token_count: Some(10),
                is_observed: false,
            },
        ];

        bridge
            .index_message_window(
                &store,
                &scanner,
                &structure,
                "thread-1",
                "msg:msg-1:msg-2",
                &messages,
            )
            .expect("message index");
        bridge
            .index_observation_delta(
                &store,
                &scanner,
                &structure,
                "thread-1",
                "obs:2",
                "Ryan remembers enough.",
            )
            .expect("observation index");

        let index_rows = store
            .fetch_compact_rows_where_str(
                "om_graph_index",
                OM_GRAPH_INDEX_COLUMNS,
                "thread_id",
                "thread-1",
            )
            .expect("index rows");
        assert_eq!(index_rows.len(), 2);
    }

    #[test]
    fn recover_lost_memory_surfaces_message_only_entities() {
        let store = store();
        let bridge = OmGraptorBridge::default();
        store
            .put_row(
                "om_graph_index",
                json!({
                    "thread_id": "thread-1",
                    "kind": "messages",
                    "source_key": "msg:1:2",
                    "document_id": "doc-msg",
                    "entity_count": 2,
                    "edge_count": 1,
                    "created_at": 1,
                }),
            )
            .expect("message index row");
        store
            .put_row(
                "om_graph_index",
                json!({
                    "thread_id": "thread-1",
                    "kind": "observation",
                    "source_key": "obs:2",
                    "document_id": "doc-obs",
                    "entity_count": 1,
                    "edge_count": 0,
                    "created_at": 2,
                }),
            )
            .expect("observation index row");
        store
            .put_row(
                "entities",
                json!({
                    "id": "entity-len",
                    "label": "Len",
                    "kind": "Character",
                    "subtype": null,
                    "aliases": [],
                    "first_note": "doc-msg",
                    "total_mentions": 3,
                    "narrative_id": "thread-1",
                    "created_by": "test",
                    "created_at": 1,
                    "updated_at": 1,
                }),
            )
            .expect("entity row");
        store
            .put_row(
                "spans",
                json!({
                    "id": "span-msg",
                    "world_id": null,
                    "note_id": "doc-msg",
                    "narrative_id": "thread-1",
                    "start": 0,
                    "end": 3,
                    "text": "Len",
                    "content_hash": "x",
                    "span_kind": "entity_mention",
                    "status": "resolved",
                    "created_by": "test",
                    "created_at": 1,
                    "updated_at": 1,
                }),
            )
            .expect("message span");
        store
            .put_row(
                "span_mentions",
                json!({
                    "id": "mention-msg",
                    "span_id": "span-msg",
                    "candidate_entity_id": "entity-len",
                    "match_type": "exact",
                    "confidence": 0.9,
                    "ev_frequency": null,
                    "ev_capital_ratio": null,
                    "ev_context_score": null,
                    "ev_cooccurrence": null,
                    "status": "resolved",
                    "created_at": 1,
                    "updated_at": 1,
                }),
            )
            .expect("message mention");

        let lost = bridge
            .recover_lost_memory(&store, "thread-1", 10, Some("Len"))
            .expect("recover lost");

        assert_eq!(lost.len(), 1);
        assert_eq!(lost[0].label, "Len");
        assert_eq!(lost[0].source_keys, vec!["msg:1:2".to_owned()]);
    }

    #[test]
    fn memory_graph_search_is_thread_local() {
        let store = store();
        let bridge = OmGraptorBridge::default();
        for (thread_id, document_id, source_key, entity_id, label) in [
            (
                "thread-a",
                "doc-a",
                "msg:msg-a:msg-a",
                "entity-ryan",
                "Ryan",
            ),
            (
                "thread-b",
                "doc-b",
                "msg:msg-b:msg-b",
                "entity-mara",
                "Mara",
            ),
        ] {
            store
                .put_row(
                    "om_graph_index",
                    json!({
                        "thread_id": thread_id,
                        "kind": "messages",
                        "source_key": source_key,
                        "document_id": document_id,
                        "entity_count": 1,
                        "edge_count": 1,
                        "created_at": 1,
                    }),
                )
                .expect("index row");
            store
                .put_row(
                    "entities",
                    json!({
                        "id": entity_id,
                        "label": label,
                        "kind": "Character",
                        "subtype": null,
                        "aliases": [],
                        "first_note": document_id,
                        "total_mentions": 2,
                        "narrative_id": thread_id,
                        "created_by": "test",
                        "created_at": 1,
                        "updated_at": 1,
                    }),
                )
                .expect("entity row");
            store
                .put_row(
                    "spans",
                    json!({
                        "id": format!("span-{thread_id}"),
                        "world_id": null,
                        "note_id": document_id,
                        "narrative_id": thread_id,
                        "start": 0,
                        "end": label.len(),
                        "text": label,
                        "content_hash": format!("hash-{thread_id}"),
                        "span_kind": "entity_mention",
                        "status": "resolved",
                        "created_by": "test",
                        "created_at": 1,
                        "updated_at": 1,
                    }),
                )
                .expect("span row");
            store
                .put_row(
                    "span_mentions",
                    json!({
                        "id": format!("mention-{thread_id}"),
                        "span_id": format!("span-{thread_id}"),
                        "candidate_entity_id": entity_id,
                        "match_type": "exact",
                        "confidence": 0.9,
                        "ev_frequency": null,
                        "ev_capital_ratio": null,
                        "ev_context_score": null,
                        "ev_cooccurrence": null,
                        "status": "resolved",
                        "created_at": 1,
                        "updated_at": 1,
                    }),
                )
                .expect("mention row");
        }

        let hits = bridge
            .memory_graph_search(&store, "thread-a", "Ryan", 10)
            .expect("search hits");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].label, "Ryan");
        assert_eq!(hits[0].source_key, "msg:msg-a:msg-a");
    }
}
