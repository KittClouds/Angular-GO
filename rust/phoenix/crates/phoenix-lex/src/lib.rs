use phoenix_qgram::{QgramConfig, QgramIndex};
use phoenix_store_cozo::{PhoenixCozoStore, StoreError};
use phoenix_types::{
    DocumentId, ImplicitMatchHit, IndexedSpan, IndexedTextField, LexicalField,
    LexicalSearchResult, NoteId, ScopeKey,
};
use serde_json::Value;
use std::collections::BTreeMap;

pub use phoenix_qgram::{CatalogSpan, CorpusStats, PackedGram, PostingSet, SpanCatalog, SpanOrdinal};
pub use phoenix_qgram::{parse_query, Clause, ClauseType, SearchConfig};

pub type LexConfig = QgramConfig;

#[derive(Clone, Debug)]
pub struct LexIndex {
    engine: QgramIndex,
    config: LexConfig,
}

impl Default for LexIndex {
    fn default() -> Self {
        let config = LexConfig::default();
        Self {
            engine: QgramIndex::build(&[], config.clone()),
            config,
        }
    }
}

impl LexIndex {
    pub fn build(spans: &[IndexedSpan], config: LexConfig) -> Self {
        Self {
            engine: QgramIndex::build(spans, config.clone()),
            config,
        }
    }

    pub fn from_store(store: &PhoenixCozoStore, config: LexConfig) -> Result<Self, StoreError> {
        let spans = indexed_spans_from_store(store)?;
        Ok(Self::build(&spans, config))
    }

    pub fn rebuild_from_spans(&mut self, spans: &[IndexedSpan]) {
        self.engine.rebuild_from_catalog(spans);
    }

    pub fn rebuild_from_store(&mut self, store: &PhoenixCozoStore) -> Result<usize, StoreError> {
        let spans = indexed_spans_from_store(store)?;
        let count = spans.len();
        self.rebuild_from_spans(&spans);
        Ok(count)
    }

    pub fn search(&self, query: &str, scope: &ScopeKey, limit: usize) -> LexicalSearchResult {
        self.engine.search(query, scope, limit)
    }

    pub fn match_implicit(
        &self,
        text: &str,
        scope: &ScopeKey,
        lexicon: &phoenix_alex::Lexicon,
    ) -> Vec<ImplicitMatchHit> {
        self.engine.match_implicit(text, scope, lexicon)
    }

    pub fn config(&self) -> &LexConfig {
        &self.config
    }
}

pub fn indexed_spans_from_store(store: &PhoenixCozoStore) -> Result<Vec<IndexedSpan>, StoreError> {
    let chunks = store.fetch_rows("chunks")?;
    let chunk_keys = store
        .fetch_rows("chunkid_map")?
        .into_iter()
        .filter_map(|row| {
            Some((
                row.get("id")?.as_i64()?,
                row.get("chunk_key")?.as_str()?.to_owned(),
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let notes = store.fetch_rows("notes")?;
    let note_titles = notes
        .into_iter()
        .filter_map(|row| {
            let note_id = row.get("id")?.as_str()?.to_owned();
            let owner_id = row
                .get("owner_id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| note_id.clone());
            Some((owner_id, (NoteId(note_id), row)))
        })
        .collect::<BTreeMap<_, _>>();
    let chunk_rows = chunks
        .into_iter()
        .filter(|row| row.get("level").and_then(Value::as_i64) == Some(0))
        .collect::<Vec<_>>();
    if chunk_rows.is_empty() {
        return indexed_spans_from_notes(store);
    }

    let parent_text_by_chunk_id = chunk_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get("chunk_id")?.as_i64()?,
                row.get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            ))
        })
        .collect::<BTreeMap<_, _>>();

    Ok(chunk_rows
        .into_iter()
        .filter_map(|row| {
            let chunk_id = row.get("chunk_id")?.as_i64()?;
            let span_id = chunk_keys
                .get(&chunk_id)
                .cloned()
                .unwrap_or_else(|| format!("chunk:{chunk_id}"));
            let doc_id = row.get("doc_id")?.as_str()?.to_owned();
            let (note_id, note_row) = note_titles.get(&doc_id)?;
            let body = row.get("text").and_then(Value::as_str)?.to_owned();
            let mut fields = Vec::new();
            if let Some(title) = note_row
                .get("title")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                fields.push(IndexedTextField {
                    field: LexicalField::Title,
                    text: title.to_owned(),
                });
            }
            if !body.trim().is_empty() {
                fields.push(IndexedTextField {
                    field: LexicalField::Body,
                    text: body,
                });
            }
            if let Some(parent_id) = row.get("parent_id").and_then(Value::as_i64) {
                if let Some(parent_text) = parent_text_by_chunk_id
                    .get(&parent_id)
                    .filter(|value| !value.trim().is_empty())
                {
                    fields.push(IndexedTextField {
                        field: LexicalField::Summary,
                        text: parent_text.to_owned(),
                    });
                }
            }
            if fields.is_empty() {
                return None;
            }

            Some(IndexedSpan {
                span_id,
                note_id: Some(note_id.clone()),
                document_id: Some(DocumentId(doc_id.clone())),
                scope: ScopeKey {
                    world_id: note_row
                        .get("world_id")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned),
                    narrative_id: note_row
                        .get("narrative_id")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned),
                    folder_id: note_row
                        .get("folder_id")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned),
                    folder_path: note_row
                        .get("folder_path")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned),
                },
                fields,
            })
        })
        .collect())
}

fn indexed_spans_from_notes(store: &PhoenixCozoStore) -> Result<Vec<IndexedSpan>, StoreError> {
    let rows = store.fetch_rows("notes")?;
    Ok(rows
        .into_iter()
        .filter(|row| row.get("is_current").and_then(Value::as_bool).unwrap_or(true))
        .filter_map(|row| note_row_to_indexed_span(&row))
        .collect())
}

fn note_row_to_indexed_span(row: &Value) -> Option<IndexedSpan> {
    let id = row.get("id")?.as_str()?.to_owned();
    let title = row
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let body = row
        .get("content")
        .and_then(Value::as_str)
        .or_else(|| row.get("markdown_content").and_then(Value::as_str))
        .unwrap_or_default()
        .to_owned();

    let mut fields = Vec::new();
    if !title.trim().is_empty() {
        fields.push(IndexedTextField {
            field: LexicalField::Title,
            text: title,
        });
    }
    if !body.trim().is_empty() {
        fields.push(IndexedTextField {
            field: LexicalField::Body,
            text: body,
        });
    }
    if fields.is_empty() {
        return None;
    }

    Some(IndexedSpan {
        span_id: id.clone(),
        note_id: Some(NoteId(id.clone())),
        document_id: Some(DocumentId(id)),
        scope: ScopeKey {
            world_id: optional_row_string(row, "world_id"),
            narrative_id: optional_row_string(row, "narrative_id"),
            folder_id: optional_row_string(row, "folder_id"),
            folder_path: optional_row_string(row, "folder_path"),
        },
        fields,
    })
}

fn optional_row_string(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facade_builds_and_searches() {
        let spans = vec![IndexedSpan {
            span_id: "doc-1:0:0:0-24".to_owned(),
            note_id: Some(NoteId("note-1".to_owned())),
            document_id: Some(DocumentId("doc-1".to_owned())),
            scope: ScopeKey::default(),
            fields: vec![IndexedTextField {
                field: LexicalField::Body,
                text: "The phoenix woke again.".to_owned(),
            }],
        }];

        let lex = LexIndex::build(&spans, LexConfig::default());
        let result = lex.search("phoenix", &ScopeKey::default(), 5);

        assert_eq!(result.span_hits.len(), 1);
        assert_eq!(result.span_hits[0].span_id, "doc-1:0:0:0-24");
    }

    #[test]
    fn public_qgram_query_types_stay_exposed() {
        let clauses: Vec<Clause> = parse_query("\"sea king\"");
        assert_eq!(clauses.len(), 1);
        assert_eq!(clauses[0].clause_type, ClauseType::Phrase);
        let _config = SearchConfig::default();
    }
}
