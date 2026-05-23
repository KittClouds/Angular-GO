use compact_str::{format_compact, CompactString};
use hashbrown::{HashMap, HashSet};
use phoenix_types::EntityId;
use smallvec::SmallVec;

use crate::types::{
    GraphAnchor, GraphChunk, GraphEdge, GraphEpisode, GraphEvent, GraphMemoryState,
    GraphRelationship, GraphTemporalEdge,
};

#[derive(Default)]
pub struct DerivedGraphFacts {
    pub relationships: Vec<GraphRelationship>,
    pub edges: Vec<GraphEdge>,
    pub events: Vec<GraphEvent>,
    pub episodes: Vec<GraphEpisode>,
    pub temporal_edges: Vec<GraphTemporalEdge>,
    pub causal_edges: Vec<GraphTemporalEdge>,
    pub memory_state: Vec<GraphMemoryState>,
}

struct EntityInChunk {
    id: EntityId,
    first_start: u32,
    first_end: u32,
    anchor_ids: SmallVec<[CompactString; 4]>,
}

pub fn derive_graph_facts(
    note_id: &str,
    text: &str,
    chunks: &[GraphChunk],
    anchors: &[GraphAnchor],
) -> DerivedGraphFacts {
    let mut by_chunk = HashMap::<CompactString, SmallVec<[usize; 8]>>::new();
    for (index, anchor) in anchors.iter().enumerate() {
        if let Some(chunk_id) = &anchor.chunk_id {
            by_chunk.entry(chunk_id.clone()).or_default().push(index);
        }
    }

    let mut facts = DerivedGraphFacts::default();
    let mut typed_edges = HashMap::<CompactString, GraphEdge>::new();
    let mut memory_seen = HashSet::<CompactString>::new();

    for chunk in chunks {
        let Some(indexes) = by_chunk.get(&chunk.id) else {
            continue;
        };
        let entities = unique_entities_for_chunk(anchors, indexes);
        if entities.is_empty() {
            continue;
        }
        let chunk_text = text
            .get(chunk.start as usize..chunk.end as usize)
            .unwrap_or_default();
        let lower = chunk_text.to_ascii_lowercase();

        derive_typed_relationships(
            note_id,
            chunk,
            &lower,
            &entities,
            &mut facts.relationships,
            &mut typed_edges,
        );
        derive_event(chunk, &lower, &entities, &mut facts.events);
        derive_memory(
            chunk,
            &lower,
            &entities,
            &mut memory_seen,
            &mut facts.memory_state,
        );
    }

    facts.edges = typed_edges.into_values().collect();
    facts.edges.sort_by(|left, right| {
        right
            .weight
            .cmp(&left.weight)
            .then_with(|| left.edge_type.cmp(&right.edge_type))
            .then_with(|| left.id.cmp(&right.id))
    });
    facts.episodes = build_episodes(note_id, &facts.events);
    facts.temporal_edges = build_temporal_edges(&facts.events);
    facts.causal_edges = build_causal_edges(chunks, text, &facts.events);
    facts
}

fn unique_entities_for_chunk(anchors: &[GraphAnchor], indexes: &[usize]) -> Vec<EntityInChunk> {
    let mut positions = HashMap::<EntityId, usize>::new();
    let mut out = Vec::<EntityInChunk>::new();
    for index in indexes {
        let anchor = &anchors[*index];
        if let Some(existing) = positions.get(&anchor.entity_id).copied() {
            out[existing].anchor_ids.push(anchor.id.clone());
            out[existing].first_start = out[existing].first_start.min(anchor.source_start);
            out[existing].first_end = out[existing].first_end.min(anchor.source_end);
            continue;
        }
        positions.insert(anchor.entity_id.clone(), out.len());
        out.push(EntityInChunk {
            id: anchor.entity_id.clone(),
            first_start: anchor.source_start,
            first_end: anchor.source_end,
            anchor_ids: smallvec::smallvec![anchor.id.clone()],
        });
    }
    out.sort_by_key(|entity| entity.first_start);
    out
}

fn derive_typed_relationships(
    note_id: &str,
    chunk: &GraphChunk,
    lower: &str,
    entities: &[EntityInChunk],
    relationships: &mut Vec<GraphRelationship>,
    edges: &mut HashMap<CompactString, GraphEdge>,
) {
    if entities.len() < 2 {
        return;
    }
    for left_index in 0..entities.len() {
        for right_index in (left_index + 1)..entities.len() {
            let left = &entities[left_index];
            let right = &entities[right_index];
            let evidence_window = pair_window(lower, chunk, left, right);
            let Some(relation_type) = infer_relation_type(evidence_window) else {
                continue;
            };
            let evidence = pair_evidence(left, right);
            let id = format_compact!(
                "typed:{}:{}:{}:{}:{}",
                note_id,
                chunk.ordinal,
                left.id.0,
                relation_type,
                right.id.0
            );
            relationships.push(GraphRelationship {
                id: id.clone(),
                source_entity_id: left.id.clone(),
                target_entity_id: right.id.clone(),
                relation_type: relation_type.clone(),
                evidence_anchor_ids: evidence.clone(),
                confidence: relation_confidence(&relation_type),
                status: "accepted".into(),
                adjudication_source: "graph-rebuild-typed-cue-policy".into(),
                adjudication_score: relation_confidence(&relation_type),
                rationale: format_compact!(
                    "accepted: anchored chunk cue promoted {} fact",
                    relation_type
                ),
                decision_evidence: vec![
                    format_compact!("chunk:{}", chunk.id),
                    format_compact!("cue:{}", relation_type),
                ],
            });
            upsert_typed_edge(edges, left, right, &relation_type, &evidence, &chunk.id);
        }
    }
}

fn pair_window<'a>(
    lower: &'a str,
    chunk: &GraphChunk,
    left: &EntityInChunk,
    right: &EntityInChunk,
) -> &'a str {
    let start = left.first_start.min(right.first_start);
    let end = left.first_end.max(right.first_end);
    let local_start = start.saturating_sub(chunk.start) as usize;
    let local_end = end.saturating_sub(chunk.start) as usize;
    let window_start = floor_char_boundary(lower, local_start.saturating_sub(160));
    let window_end = ceil_char_boundary(lower, (local_end + 160).min(lower.len()));
    lower.get(window_start..window_end).unwrap_or(lower)
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

fn infer_relation_type(lower: &str) -> Option<CompactString> {
    let relation = if has_any(lower, &[" father", " daughter", " grandfather", " family"]) {
        "family_or_house_tie"
    } else if has_any(lower, &["command", "admiral", "phantom", "military"]) {
        "command_or_service_tie"
    } else if has_any(
        lower,
        &["approved", "approval", "accepted", "agreed", "proceed"],
    ) {
        "approves_or_accepts"
    } else if has_any(
        lower,
        &["packet", "release", "terms", "warning", "coercion"],
    ) {
        "discusses_release_terms"
    } else if has_any(
        lower,
        &["kiss", "took his hand", "stood beside", "close enough"],
    ) {
        "intimate_or_close_contact"
    } else if has_any(lower, &["looked at", "watched", "saw ", "noticed"]) {
        "observes"
    } else if has_any(lower, &["gave", "handed", "took it from", "received"]) {
        "transfers_or_receives"
    } else if has_any(lower, &["entered", "arrived", "came in", "stood near"]) {
        "scene_presence"
    } else {
        return None;
    };
    Some(relation.into())
}

fn relation_confidence(relation_type: &str) -> f32 {
    match relation_type {
        "family_or_house_tie" | "command_or_service_tie" | "approves_or_accepts" => 0.82,
        "transfers_or_receives" | "intimate_or_close_contact" => 0.76,
        "discusses_release_terms" => 0.70,
        _ => 0.64,
    }
}

fn pair_evidence(left: &EntityInChunk, right: &EntityInChunk) -> Vec<CompactString> {
    let mut evidence = Vec::with_capacity(left.anchor_ids.len() + right.anchor_ids.len());
    push_all_unique(&mut evidence, &left.anchor_ids);
    push_all_unique(&mut evidence, &right.anchor_ids);
    evidence
}

fn upsert_typed_edge(
    edges: &mut HashMap<CompactString, GraphEdge>,
    left: &EntityInChunk,
    right: &EntityInChunk,
    relation_type: &CompactString,
    evidence: &[CompactString],
    scope_key: &CompactString,
) {
    let (source_id, target_id) = if left.id <= right.id {
        (left.id.clone(), right.id.clone())
    } else {
        (right.id.clone(), left.id.clone())
    };
    let id = format_compact!("{}:{}:{}", source_id.0, relation_type, target_id.0);
    let edge = edges.entry(id.clone()).or_insert_with(|| GraphEdge {
        id,
        source_id,
        target_id,
        edge_type: relation_type.clone(),
        weight: 0,
        confidence: 0.0,
        evidence_anchor_ids: Vec::new(),
        scope_keys: Vec::new(),
        note_ids: Vec::new(),
    });
    edge.weight += 1;
    edge.confidence = (edge.confidence + 0.25).min(1.0);
    push_unique(&mut edge.scope_keys, scope_key.clone());
    for id in evidence {
        push_unique(&mut edge.evidence_anchor_ids, id.clone());
    }
}

fn derive_event(
    chunk: &GraphChunk,
    lower: &str,
    entities: &[EntityInChunk],
    events: &mut Vec<GraphEvent>,
) {
    let Some(event_type) = infer_event_type(lower) else {
        return;
    };
    let mut entity_ids = Vec::new();
    let mut evidence = Vec::new();
    for entity in entities.iter().take(6) {
        push_entity_unique(&mut entity_ids, entity.id.clone());
        push_all_unique(&mut evidence, &entity.anchor_ids);
    }
    events.push(GraphEvent {
        id: format_compact!("event:{}:{}:{}", chunk.note_id, chunk.ordinal, event_type),
        note_id: chunk.note_id.clone(),
        chunk_id: Some(chunk.id.clone()),
        label: format_compact!("{} in chunk {}", event_type, chunk.ordinal + 1),
        entity_ids,
        evidence_anchor_ids: evidence,
        confidence: 0.68,
    });
}

fn infer_event_type(lower: &str) -> Option<CompactString> {
    let event_type = if has_any(lower, &["approved", "signed", "proceed"]) {
        "approval_event"
    } else if has_any(lower, &["warn", "coercion", "risk", "prohibited"]) {
        "warning_event"
    } else if has_any(lower, &["entered", "arrived", "came in", "opened the door"]) {
        "arrival_event"
    } else if has_any(lower, &["asked", "answered", "said", "spoke", "read"]) {
        "dialogue_event"
    } else if has_any(lower, &["kiss", "took his hand", "handed", "gave"]) {
        "contact_or_transfer_event"
    } else if has_any(lower, &["stood", "watched", "looked", "turned"]) {
        "positioning_event"
    } else {
        return None;
    };
    Some(event_type.into())
}

fn derive_memory(
    chunk: &GraphChunk,
    lower: &str,
    entities: &[EntityInChunk],
    seen: &mut HashSet<CompactString>,
    memory: &mut Vec<GraphMemoryState>,
) {
    let Some(key) = infer_memory_key(lower) else {
        return;
    };
    for entity in entities.iter().take(4) {
        let id = format_compact!("memory:{}:{}:{}", entity.id.0, key, chunk.ordinal);
        if !seen.insert(id.clone()) {
            continue;
        }
        memory.push(GraphMemoryState {
            id,
            entity_id: entity.id.clone(),
            note_id: Some(chunk.note_id.clone()),
            key: key.clone(),
            value: format_compact!("chunk:{} cue:{}", chunk.ordinal, key),
            evidence_ids: entity.anchor_ids.iter().cloned().collect(),
        });
    }
}

fn infer_memory_key(lower: &str) -> Option<CompactString> {
    let key = if has_any(lower, &["diamond", "sapphire", "black rank", "queen"]) {
        "rank_or_status"
    } else if has_any(lower, &["family", "father", "grandfather", "daughter"]) {
        "family_context"
    } else if has_any(lower, &["phantom", "admiral", "command", "military"]) {
        "service_context"
    } else if has_any(lower, &["approved", "accepted", "agreed", "proceed"]) {
        "decision_state"
    } else if has_any(
        lower,
        &["germany", "atlas", "barish", "clayne", "blazefell"],
    ) {
        "affiliation_context"
    } else {
        return None;
    };
    Some(key.into())
}

fn build_episodes(note_id: &str, events: &[GraphEvent]) -> Vec<GraphEpisode> {
    events
        .chunks(12)
        .enumerate()
        .map(|(index, group)| {
            let mut entity_ids = Vec::new();
            for event in group {
                for entity_id in &event.entity_ids {
                    push_entity_unique(&mut entity_ids, entity_id.clone());
                }
            }
            GraphEpisode {
                id: format_compact!("episode:{note_id}:{index}"),
                note_id: note_id.into(),
                event_ids: group.iter().map(|event| event.id.clone()).collect(),
                entity_ids,
                label: format_compact!("Episode {}", index + 1),
            }
        })
        .collect()
}

fn build_temporal_edges(events: &[GraphEvent]) -> Vec<GraphTemporalEdge> {
    events
        .windows(2)
        .enumerate()
        .map(|(index, pair)| GraphTemporalEdge {
            id: format_compact!("temporal:{}:{}", pair[0].id, pair[1].id),
            source_id: pair[0].id.clone(),
            target_id: pair[1].id.clone(),
            relation_type: "before".into(),
            evidence_ids: vec![pair[0].id.clone(), pair[1].id.clone()],
            confidence: (0.74_f32 - (index as f32 * 0.0001)).max(0.62),
        })
        .collect()
}

fn build_causal_edges(
    chunks: &[GraphChunk],
    text: &str,
    events: &[GraphEvent],
) -> Vec<GraphTemporalEdge> {
    let mut out = Vec::new();
    for pair in events.windows(2) {
        let Some(chunk_id) = &pair[1].chunk_id else {
            continue;
        };
        let Some(chunk) = chunks.iter().find(|chunk| &chunk.id == chunk_id) else {
            continue;
        };
        let chunk_text = text
            .get(chunk.start as usize..chunk.end as usize)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !has_any(
            &chunk_text,
            &["because", "therefore", "which meant", "that meant", "so "],
        ) {
            continue;
        }
        out.push(GraphTemporalEdge {
            id: format_compact!("causal:{}:{}", pair[0].id, pair[1].id),
            source_id: pair[0].id.clone(),
            target_id: pair[1].id.clone(),
            relation_type: "causes_or_explains".into(),
            evidence_ids: vec![pair[0].id.clone(), pair[1].id.clone()],
            confidence: 0.66,
        });
    }
    out
}

fn has_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn push_all_unique(out: &mut Vec<CompactString>, values: &[CompactString]) {
    for value in values {
        push_unique(out, value.clone());
    }
}

fn push_unique(out: &mut Vec<CompactString>, value: CompactString) {
    if !out.iter().any(|existing| existing == &value) {
        out.push(value);
    }
}

fn push_entity_unique(out: &mut Vec<EntityId>, value: EntityId) {
    if !out.iter().any(|existing| existing == &value) {
        out.push(value);
    }
}
