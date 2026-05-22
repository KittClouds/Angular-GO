use std::time::{SystemTime, UNIX_EPOCH};

use compact_str::{format_compact, CompactString};
use hashbrown::{HashMap, HashSet};
use phoenix_alex::api as alex;
use phoenix_chunker::api::default_chunk_ranges;
use phoenix_types::{EntityId, KnownMatch, LexiconEntry, ScopeKey};
use smallvec::SmallVec;
use thiserror::Error;

use crate::adjudication::adjudicate_cooccurrence_edges;
use crate::types::{
    GraphAnchor, GraphChunk, GraphCounters, GraphDropReasons, GraphEdge, GraphEmbeddingTarget,
    GraphMention, GraphNode, GraphRebuildSnapshot, GraphRelationship, GraphScopeKind,
};

#[derive(Debug, Error)]
pub enum GraphRebuildError {
    #[error("Alex lexicon build failed: {0}")]
    Alex(#[from] phoenix_alex::AlexError),
}

#[derive(Clone, Debug)]
pub struct GraphRebuildInput<'a> {
    pub scope_kind: GraphScopeKind,
    pub scope_id: &'a str,
    pub note_id: &'a str,
    pub text: &'a str,
    pub scope: ScopeKey,
    pub entities: &'a [LexiconEntry],
    pub candidate_count: usize,
    pub built_at: Option<u64>,
}

pub struct GraphRebuildBuilder;

impl GraphRebuildBuilder {
    pub fn build(input: GraphRebuildInput<'_>) -> Result<GraphRebuildSnapshot, GraphRebuildError> {
        build_graph_rebuild_snapshot(input)
    }
}

pub fn build_graph_rebuild_snapshot(
    input: GraphRebuildInput<'_>,
) -> Result<GraphRebuildSnapshot, GraphRebuildError> {
    let built_at = input.built_at.unwrap_or_else(now_ms);
    let chunks = build_chunks(input.note_id, input.text);
    let chunk_ranges = chunks
        .iter()
        .map(|chunk| (chunk.start, chunk.end, chunk.id.clone()))
        .collect::<Vec<_>>();
    let lexicon = alex::build_lexicon(input.entities)?;
    let matches = alex::scan_text(&lexicon, input.text, &input.scope);
    let mut drops = GraphDropReasons::default();
    let mut seen = HashSet::<CompactString>::new();
    let mut mentions = Vec::with_capacity(matches.len());
    let mut anchors = Vec::with_capacity(matches.len());

    for known in matches {
        let mention = known_to_mention(input.note_id, &chunk_ranges, &known);
        let Some(entry) = known.entries.first() else {
            drops.missing_entity += 1;
            mentions.push(GraphMention {
                status: "dropped".into(),
                ..mention
            });
            continue;
        };
        if known.range.end <= known.range.start {
            drops.invalid_span += 1;
            mentions.push(GraphMention {
                entity_id: Some(entry.entity_id.clone()),
                status: "dropped".into(),
                ..mention
            });
            continue;
        }
        let anchor_id = format_compact!(
            "{}:{}:{}:{}:{}",
            input.note_id,
            entry.entity_id.0,
            known.range.start,
            known.range.end,
            mention.source
        );
        if !seen.insert(anchor_id.clone()) {
            drops.duplicate_anchor += 1;
            mentions.push(GraphMention {
                id: anchor_id,
                entity_id: Some(entry.entity_id.clone()),
                status: "dropped".into(),
                ..mention
            });
            continue;
        }
        let anchor = GraphAnchor {
            id: anchor_id,
            entity_id: entry.entity_id.clone(),
            note_id: input.note_id.into(),
            chunk_id: mention.chunk_id.clone(),
            surface: mention.surface.clone(),
            source_start: known.range.start,
            source_end: known.range.end,
            source: mention.source.clone(),
            confidence: known.confidence,
            generation: built_at,
        };
        mentions.push(GraphMention {
            id: anchor.id.clone(),
            entity_id: Some(entry.entity_id.clone()),
            status: "accepted".into(),
            ..mention
        });
        anchors.push(anchor);
    }

    let nodes = build_nodes(&anchors, input.entities);
    let edges = build_edges(&anchors, &mut drops);
    let relationship_candidates = edges.len();
    let (relationships, adjudication_counts) = adjudicate_cooccurrence_edges(&edges);
    let embedding_targets =
        build_embedding_targets(input.note_id, &chunks, &anchors, &nodes, &relationships);
    let counters = GraphCounters {
        entities: input.entities.len(),
        aliases: input.entities.iter().map(|entry| entry.aliases.len()).sum(),
        candidates: input.candidate_count,
        mentions: mentions.len(),
        accepted_anchors: anchors.len(),
        chunks: chunks.len(),
        relationship_candidates,
        relationships: relationships.len(),
        accepted_relationships: adjudication_counts.accepted,
        review_relationships: adjudication_counts.review,
        rejected_relationships: adjudication_counts.rejected,
        embedding_targets: embedding_targets.len(),
        nodes: nodes.len(),
        edges: edges.len(),
        drop_reasons: drops,
        ..GraphCounters::default()
    };

    Ok(GraphRebuildSnapshot {
        schema_version: "phoenix-graph-rebuild/v1".into(),
        id: format_compact!(
            "graph-rebuild:{}:{}:{}",
            input.note_id,
            input.scope_id,
            built_at
        ),
        source: "phoenix-graph-rebuild".into(),
        scope_kind: input.scope_kind,
        scope_id: input.scope_id.into(),
        note_ids: vec![input.note_id.into()],
        built_at,
        chunks,
        mentions,
        entity_anchors: anchors,
        relationships,
        events: Vec::new(),
        episodes: Vec::new(),
        temporal_edges: Vec::new(),
        causal_edges: Vec::new(),
        memory_state: Vec::new(),
        embedding_targets,
        embedding_vectors: Vec::new(),
        projection_refs: Vec::new(),
        nodes,
        edges,
        counters,
    })
}

fn build_chunks(note_id: &str, text: &str) -> Vec<GraphChunk> {
    let sentence_like = memchr::memchr_iter(b'.', text.as_bytes()).count();
    let mut chunks = default_chunk_ranges(text);
    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(phoenix_chunker::Chunk {
            start: 0,
            end: text.len(),
        });
    }
    chunks
        .into_iter()
        .enumerate()
        .map(|(ordinal, chunk)| GraphChunk {
            id: format_compact!("{note_id}:chunk:{ordinal}"),
            note_id: note_id.into(),
            start: chunk.start as u32,
            end: chunk.end as u32,
            ordinal: ordinal as u32,
            source: if sentence_like > 0 {
                "dynamic-chunking"
            } else {
                "note-fallback"
            }
            .into(),
        })
        .collect()
}

fn known_to_mention(
    note_id: &str,
    chunks: &[(u32, u32, CompactString)],
    known: &KnownMatch,
) -> GraphMention {
    GraphMention {
        id: format_compact!(
            "mention:{}:{}:{}",
            note_id,
            known.range.start,
            known.range.end
        ),
        note_id: note_id.into(),
        chunk_id: chunk_for_span(chunks, known.range.start, known.range.end),
        surface: known.surface.as_str().into(),
        source_start: known.range.start,
        source_end: known.range.end,
        source: format_compact!("{:?}", known.source),
        confidence: known.confidence,
        entity_id: known.entries.first().map(|entry| entry.entity_id.clone()),
        status: "candidate".into(),
    }
}

fn chunk_for_span(
    chunks: &[(u32, u32, CompactString)],
    start: u32,
    end: u32,
) -> Option<CompactString> {
    chunks
        .iter()
        .find(|(chunk_start, chunk_end, _)| start >= *chunk_start && end <= *chunk_end)
        .or_else(|| {
            chunks
                .iter()
                .find(|(chunk_start, chunk_end, _)| start >= *chunk_start && start < *chunk_end)
        })
        .map(|(_, _, id)| id.clone())
}

fn build_nodes(anchors: &[GraphAnchor], entities: &[LexiconEntry]) -> Vec<GraphNode> {
    let entries = entities
        .iter()
        .map(|entry| (entry.entity_id.clone(), entry))
        .collect::<HashMap<_, _>>();
    let mut by_entity = HashMap::<EntityId, GraphNode>::new();
    for anchor in anchors {
        let Some(entry) = entries.get(&anchor.entity_id) else {
            continue;
        };
        let node = by_entity
            .entry(anchor.entity_id.clone())
            .or_insert_with(|| GraphNode {
                id: entry.entity_id.clone(),
                entity_id: entry.entity_id.clone(),
                label: entry.label.as_str().into(),
                kind: format_compact!("{:?}", entry.kind),
                aliases: entry
                    .aliases
                    .iter()
                    .map(|alias| alias.as_str().into())
                    .collect(),
                anchor_ids: Vec::new(),
                note_ids: Vec::new(),
                total_mentions: 0,
            });
        node.anchor_ids.push(anchor.id.clone());
        if !node.note_ids.iter().any(|note| note == &anchor.note_id) {
            node.note_ids.push(anchor.note_id.clone());
        }
        node.total_mentions += 1;
    }
    let mut nodes = by_entity.into_values().collect::<Vec<_>>();
    nodes.sort_by(|left, right| {
        right
            .total_mentions
            .cmp(&left.total_mentions)
            .then_with(|| left.label.cmp(&right.label))
    });
    nodes
}

fn build_edges(anchors: &[GraphAnchor], drops: &mut GraphDropReasons) -> Vec<GraphEdge> {
    let mut buckets = HashMap::<CompactString, SmallVec<[usize; 4]>>::new();
    for (index, anchor) in anchors.iter().enumerate() {
        let key = anchor
            .chunk_id
            .clone()
            .unwrap_or_else(|| format_compact!("note:{}", anchor.note_id));
        buckets.entry(key).or_default().push(index);
    }
    let mut edges = HashMap::<CompactString, GraphEdge>::new();
    for (scope_key, indexes) in buckets {
        let entity_ids = unique_entity_ids(anchors, &indexes);
        if entity_ids.len() < 2 {
            drops.singleton_bucket += 1;
            continue;
        }
        for left_index in 0..entity_ids.len() {
            for right_index in (left_index + 1)..entity_ids.len() {
                upsert_edge(
                    &mut edges,
                    entity_ids[left_index].clone(),
                    entity_ids[right_index].clone(),
                    anchors,
                    &indexes,
                    &scope_key,
                );
            }
        }
    }
    let mut out = edges.into_values().collect::<Vec<_>>();
    out.sort_by(|left, right| {
        right
            .weight
            .cmp(&left.weight)
            .then_with(|| left.id.cmp(&right.id))
    });
    out
}

fn unique_entity_ids(anchors: &[GraphAnchor], indexes: &[usize]) -> Vec<EntityId> {
    let mut seen = HashSet::<EntityId>::new();
    let mut out = Vec::new();
    for index in indexes {
        let id = anchors[*index].entity_id.clone();
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out
}

fn upsert_edge(
    edges: &mut HashMap<CompactString, GraphEdge>,
    left: EntityId,
    right: EntityId,
    anchors: &[GraphAnchor],
    indexes: &[usize],
    scope_key: &CompactString,
) {
    let (source_id, target_id) = if left <= right {
        (left, right)
    } else {
        (right, left)
    };
    let id = format_compact!("{}:anchored-cooccurrence:{}", source_id.0, target_id.0);
    let edge = edges.entry(id.clone()).or_insert_with(|| GraphEdge {
        id,
        source_id: source_id.clone(),
        target_id: target_id.clone(),
        edge_type: "anchored-cooccurrence".into(),
        weight: 0,
        confidence: 0.0,
        evidence_anchor_ids: Vec::new(),
        scope_keys: Vec::new(),
        note_ids: Vec::new(),
    });
    edge.weight += 1;
    edge.confidence = (edge.confidence + 0.2).min(1.0);
    if !edge.scope_keys.iter().any(|key| key == scope_key) {
        edge.scope_keys.push(scope_key.clone());
    }
    for index in indexes {
        let anchor = &anchors[*index];
        if anchor.entity_id == source_id || anchor.entity_id == target_id {
            push_unique(&mut edge.evidence_anchor_ids, anchor.id.clone());
            push_unique(&mut edge.note_ids, anchor.note_id.clone());
        }
    }
}

fn build_embedding_targets(
    note_id: &str,
    chunks: &[GraphChunk],
    anchors: &[GraphAnchor],
    nodes: &[GraphNode],
    relationships: &[GraphRelationship],
) -> Vec<GraphEmbeddingTarget> {
    let mut targets =
        Vec::with_capacity(chunks.len() + anchors.len() + nodes.len() + relationships.len() + 1);
    targets.push(GraphEmbeddingTarget {
        id: format_compact!("embed:note:{note_id}"),
        kind: "note".into(),
        source_id: note_id.into(),
        note_id: Some(note_id.into()),
        chunk_id: None,
        entity_id: None,
        label: format_compact!("Note {note_id}"),
        text: format_compact!("note:{note_id}"),
        evidence_ids: Vec::new(),
    });
    targets.extend(chunks.iter().map(|chunk| GraphEmbeddingTarget {
        id: format_compact!("embed:chunk:{}", chunk.id),
        kind: "chunk".into(),
        source_id: chunk.id.clone(),
        note_id: Some(chunk.note_id.clone()),
        chunk_id: Some(chunk.id.clone()),
        entity_id: None,
        label: format_compact!("Chunk {}", chunk.ordinal + 1),
        text: format_compact!("{}:{}-{}", chunk.note_id, chunk.start, chunk.end),
        evidence_ids: Vec::new(),
    }));
    targets.extend(nodes.iter().map(|node| GraphEmbeddingTarget {
        id: format_compact!("embed:entity:{}", node.entity_id.0),
        kind: "entity".into(),
        source_id: node.entity_id.0.as_str().into(),
        note_id: None,
        chunk_id: None,
        entity_id: Some(node.entity_id.clone()),
        label: node.label.clone(),
        text: node.label.clone(),
        evidence_ids: node.anchor_ids.clone(),
    }));
    targets.extend(anchors.iter().map(|anchor| GraphEmbeddingTarget {
        id: format_compact!("embed:anchor:{}", anchor.id),
        kind: "anchor".into(),
        source_id: anchor.id.clone(),
        note_id: Some(anchor.note_id.clone()),
        chunk_id: anchor.chunk_id.clone(),
        entity_id: Some(anchor.entity_id.clone()),
        label: anchor.surface.clone(),
        text: anchor.surface.clone(),
        evidence_ids: vec![anchor.id.clone()],
    }));
    targets.extend(
        relationships
            .iter()
            .filter(|relationship| relationship.status != "rejected")
            .map(|relationship| GraphEmbeddingTarget {
                id: format_compact!("embed:graph-fact:{}", relationship.id),
                kind: "graphFact".into(),
                source_id: relationship.id.clone(),
                note_id: None,
                chunk_id: None,
                entity_id: None,
                label: format_compact!(
                    "{} {} {}",
                    relationship.source_entity_id.0,
                    relationship.relation_type,
                    relationship.target_entity_id.0
                ),
                text: format_compact!(
                    "{} {} {} [{}]",
                    relationship.source_entity_id.0,
                    relationship.relation_type,
                    relationship.target_entity_id.0,
                    relationship.status
                ),
                evidence_ids: relationship.evidence_anchor_ids.clone(),
            }),
    );
    targets
}

fn push_unique(values: &mut Vec<CompactString>, value: CompactString) {
    if !values.iter().any(|item| item == &value) {
        values.push(value);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
