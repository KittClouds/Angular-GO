use std::sync::Arc;

use bm25_turbo::{persistence, BM25Builder, BM25Index};
use phoenix_graph_kernel::{KernelQuerySurface, KernelVertex};
use phoenix_store_native_core::ScopeLexicalQuerySidecar;
use rustc_hash::FxHashSet;

use crate::retrieval::GraphRetrievedSeed;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct QueryUnitIndexCacheKey {
    pub valid_at: Option<i64>,
    pub recorded_at: Option<i64>,
    pub include_candidate_graph: bool,
    pub kinds: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct QueryUnitDoc {
    pub node_id: String,
    pub node_kind: String,
    pub text: String,
    pub document_id: Option<String>,
    pub evidence_refs: Vec<String>,
}

pub(crate) struct QueryUnitLexicalIndex {
    docs: Arc<[QueryUnitDoc]>,
    index: QueryUnitLexicalBackend,
}

enum QueryUnitLexicalBackend {
    Owned(BM25Index),
    Mmap(persistence::MmapBM25Index),
}

impl QueryUnitLexicalIndex {
    pub(crate) fn search(&self, query_text: &str, limit: usize) -> Vec<GraphRetrievedSeed> {
        let limit = limit.clamp(1, 96);
        let results = match &self.index {
            QueryUnitLexicalBackend::Owned(index) => index.search_cached(query_text, limit),
            QueryUnitLexicalBackend::Mmap(index) => index.search(query_text, limit),
        };
        let Ok(results) = results else {
            return Vec::new();
        };
        if results.doc_ids.is_empty() {
            return Vec::new();
        }
        let max_score = results
            .scores
            .iter()
            .copied()
            .fold(0.0_f32, f32::max)
            .max(1e-6);
        results
            .doc_ids
            .iter()
            .zip(results.scores.iter())
            .filter_map(|(doc_id, score)| {
                let doc = self.docs.get(*doc_id as usize)?;
                let score_millis = (((*score / max_score).clamp(0.0, 1.0)) * 1000.0).round() as u32;
                Some(GraphRetrievedSeed {
                    node_id: doc.node_id.clone(),
                    node_kind: doc.node_kind.clone(),
                    score_millis,
                    distance_millis: 1000_u32.saturating_sub(score_millis),
                    document_id: doc.document_id.clone(),
                    narrative_id: None,
                    evidence_refs: doc.evidence_refs.clone(),
                })
            })
            .collect()
    }

    pub(crate) fn from_persisted_sidecar(
        sidecar: &ScopeLexicalQuerySidecar,
    ) -> Option<QueryUnitLexicalIndex> {
        if sidecar.docs.is_empty() || !sidecar.index_path.exists() {
            return None;
        }
        let docs = sidecar
            .docs
            .iter()
            .map(|doc| QueryUnitDoc {
                node_id: doc.node_id.clone(),
                node_kind: doc.node_kind.clone(),
                text: String::new(),
                document_id: doc.document_id.clone(),
                evidence_refs: doc.evidence_refs.clone(),
            })
            .collect::<Vec<_>>();
        let index = persistence::load_mmap(&sidecar.index_path)
            .map(QueryUnitLexicalBackend::Mmap)
            .or_else(|_| {
                persistence::mmap_or_load(&sidecar.index_path).map(QueryUnitLexicalBackend::Owned)
            })
            .ok()?;
        let doc_count = match &index {
            QueryUnitLexicalBackend::Owned(index) => index.num_docs() as usize,
            QueryUnitLexicalBackend::Mmap(index) => index.num_docs as usize,
        };
        if doc_count != docs.len() {
            return None;
        }
        Some(QueryUnitLexicalIndex {
            docs: Arc::<[QueryUnitDoc]>::from(docs),
            index,
        })
    }

    #[cfg(test)]
    pub(crate) fn for_tests(rows: &[(&str, &str, &str)]) -> Self {
        let docs = rows
            .iter()
            .map(|(node_id, node_kind, text)| QueryUnitDoc {
                node_id: (*node_id).to_owned(),
                node_kind: (*node_kind).to_owned(),
                text: (*text).to_owned(),
                document_id: Some("doc-1".to_owned()),
                evidence_refs: vec![format!("graph_vertex:{node_id}")],
            })
            .collect::<Vec<_>>();
        let corpus = docs.iter().map(|doc| doc.text.as_str()).collect::<Vec<_>>();
        let index = BM25Builder::new()
            .cache_capacity(64)
            .build_from_corpus(&corpus)
            .expect("bm25 index");
        Self {
            docs: Arc::<[QueryUnitDoc]>::from(docs),
            index: QueryUnitLexicalBackend::Owned(index),
        }
    }
}

pub(crate) fn build_query_unit_index(
    view: &KernelQuerySurface,
    kinds: &[String],
) -> Option<QueryUnitLexicalIndex> {
    let kind_filter = kinds.iter().map(String::as_str).collect::<FxHashSet<_>>();
    let docs = collect_query_unit_docs(view, &kind_filter);
    if docs.is_empty() {
        return None;
    }
    let corpus = docs.iter().map(|doc| doc.text.as_str()).collect::<Vec<_>>();
    let Ok(index) = BM25Builder::new()
        .cache_capacity(64)
        .build_from_corpus(&corpus)
    else {
        return None;
    };
    Some(QueryUnitLexicalIndex {
        docs: Arc::<[QueryUnitDoc]>::from(docs),
        index: QueryUnitLexicalBackend::Owned(index),
    })
}

fn collect_query_unit_docs(
    view: &KernelQuerySurface,
    kind_filter: &FxHashSet<&str>,
) -> Vec<QueryUnitDoc> {
    let mut seen = FxHashSet::<&str>::default();
    view.vertices()
        .iter()
        .filter(|vertex| kind_filter.contains(vertex.kind.as_str()))
        .filter(|vertex| seen.insert(vertex.id.0.as_str()))
        .filter_map(query_unit_doc)
        .collect()
}

fn query_unit_doc(vertex: &KernelVertex) -> Option<QueryUnitDoc> {
    let text = vertex_query_text(vertex)?;
    let evidence_refs = if vertex.provenance.evidence_refs.is_empty() {
        vec![format!("graph_vertex:{}", vertex.id.0)]
    } else {
        vertex.provenance.evidence_refs.clone()
    };
    Some(QueryUnitDoc {
        node_id: vertex.id.0.clone(),
        node_kind: vertex.kind.clone(),
        text,
        document_id: vertex.document_id.clone(),
        evidence_refs,
    })
}

fn vertex_query_text(vertex: &KernelVertex) -> Option<String> {
    let direct = string_field(&vertex.value, "text")
        .or_else(|| string_field(&vertex.value, "label"))
        .or_else(|| string_field(&vertex.value, "title"))
        .or_else(|| string_field(&vertex.value, "name"))
        .or_else(|| string_field(&vertex.attributes, "text"))
        .or_else(|| string_field(&vertex.attributes, "label"))
        .or_else(|| string_field(&vertex.attributes, "title"))
        .or_else(|| string_field(&vertex.attributes, "name"));
    let text = direct
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
        .or_else(|| fallback_label_text(vertex));
    text.map(|text| truncate_query_text(&text))
}

fn fallback_label_text(vertex: &KernelVertex) -> Option<String> {
    let label = vertex.labels.iter().map(String::as_str).find(|label| {
        let trimmed = label.trim();
        !trimmed.is_empty()
            && !trimmed.contains("::")
            && !trimmed.starts_with("chunk:")
            && !trimmed.starts_with("claim:")
            && !trimmed.starts_with("state:")
            && !trimmed.starts_with("event:")
    })?;
    Some(label.to_owned())
}

fn string_field<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(serde_json::Value::as_str)
}

fn truncate_query_text(text: &str) -> String {
    const MAX_CHARS: usize = 768;
    if text.len() <= MAX_CHARS {
        return text.to_owned();
    }
    let mut end = MAX_CHARS;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

#[cfg(test)]
mod tests {
    use phoenix_graph_kernel::{
        KernelBiTemporal, KernelGraphSnapshot, KernelProvenance, KernelVertex, KernelVertexClass,
        KernelVertexId, KernelViewRequest, PhoenixGraphKernel,
    };
    use serde_json::json;

    use super::*;

    fn vertex(id: &str, kind: &str, text: &str) -> KernelVertex {
        KernelVertex {
            id: KernelVertexId(id.to_owned()),
            kind: kind.to_owned(),
            class: KernelVertexClass::Generic,
            labels: Vec::new(),
            weight: 1,
            value: json!({"text": text}),
            attributes: json!({}),
            temporal: KernelBiTemporal::default(),
            provenance: KernelProvenance::default(),
            entity_id: None,
            search_chunk_id: None,
            document_id: Some("doc-1".to_owned()),
            note_id: None,
            narrative_id: None,
            folder_id: None,
            folder_path: None,
            chapter_id: None,
            chapters: Vec::new(),
            boundary_id: None,
            boundary_ordinal: None,
            boundary_kind: None,
            boundary_ordinals: Vec::new(),
            entity_facet: None,
            calendar_facet: None,
        }
    }

    #[test]
    fn builds_query_unit_index_from_text_vertices() {
        let kernel = PhoenixGraphKernel::from_snapshot(
            KernelGraphSnapshot {
                vertices: vec![
                    vertex("graph::chunk::1", "chunk", "Alice moved to the harbor"),
                    vertex(
                        "semantic-unit::state::doc-1::state-1",
                        "state",
                        "alice location harbor",
                    ),
                ],
                asserted_edges: Vec::new(),
                candidate_edges: Vec::new(),
            },
            None,
        );
        let view = kernel.query_surface(KernelViewRequest {
            include_candidate_graph: true,
            ..KernelViewRequest::default()
        });

        let index = build_query_unit_index(&view, &["chunk".to_owned(), "state".to_owned()])
            .expect("lexical index");
        let hits = index.search("harbor", 4);

        assert_eq!(hits.len(), 2);
        assert!(hits.iter().any(|hit| hit.node_id == "graph::chunk::1"));
        assert!(hits
            .iter()
            .any(|hit| hit.node_id == "semantic-unit::state::doc-1::state-1"));
    }

    #[test]
    fn ignores_vertices_without_query_text() {
        let mut blank = vertex("graph::entity::1", "entity", "");
        blank.labels = vec!["entity::alice".to_owned()];
        let kernel = PhoenixGraphKernel::from_snapshot(
            KernelGraphSnapshot {
                vertices: vec![blank],
                asserted_edges: Vec::new(),
                candidate_edges: Vec::new(),
            },
            None,
        );
        let view = kernel.query_surface(KernelViewRequest {
            include_candidate_graph: true,
            ..KernelViewRequest::default()
        });

        assert!(build_query_unit_index(&view, &["entity".to_owned()]).is_none());
    }
}
