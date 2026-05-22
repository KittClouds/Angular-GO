use compact_str::CompactString;
use phoenix_types::EntityId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphScopeKind {
    Global,
    Narrative,
    Note,
    MultiNote,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphChunk {
    pub id: CompactString,
    pub note_id: CompactString,
    pub start: u32,
    pub end: u32,
    pub ordinal: u32,
    pub source: CompactString,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMention {
    pub id: CompactString,
    pub note_id: CompactString,
    pub chunk_id: Option<CompactString>,
    pub surface: CompactString,
    pub source_start: u32,
    pub source_end: u32,
    pub source: CompactString,
    pub confidence: f32,
    pub entity_id: Option<EntityId>,
    pub status: CompactString,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAnchor {
    pub id: CompactString,
    pub entity_id: EntityId,
    pub note_id: CompactString,
    pub chunk_id: Option<CompactString>,
    pub surface: CompactString,
    pub source_start: u32,
    pub source_end: u32,
    pub source: CompactString,
    pub confidence: f32,
    pub generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: EntityId,
    pub entity_id: EntityId,
    pub label: CompactString,
    pub kind: CompactString,
    pub aliases: Vec<CompactString>,
    pub anchor_ids: Vec<CompactString>,
    pub note_ids: Vec<CompactString>,
    pub total_mentions: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: CompactString,
    pub source_id: EntityId,
    pub target_id: EntityId,
    pub edge_type: CompactString,
    pub weight: u32,
    pub confidence: f32,
    pub evidence_anchor_ids: Vec<CompactString>,
    pub scope_keys: Vec<CompactString>,
    pub note_ids: Vec<CompactString>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRelationship {
    pub id: CompactString,
    pub source_entity_id: EntityId,
    pub target_entity_id: EntityId,
    pub relation_type: CompactString,
    pub evidence_anchor_ids: Vec<CompactString>,
    pub confidence: f32,
    pub status: CompactString,
    pub adjudication_source: CompactString,
    pub adjudication_score: f32,
    pub rationale: CompactString,
    pub decision_evidence: Vec<CompactString>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEvent {
    pub id: CompactString,
    pub note_id: CompactString,
    pub chunk_id: Option<CompactString>,
    pub label: CompactString,
    pub entity_ids: Vec<EntityId>,
    pub evidence_anchor_ids: Vec<CompactString>,
    pub confidence: f32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEpisode {
    pub id: CompactString,
    pub note_id: CompactString,
    pub event_ids: Vec<CompactString>,
    pub entity_ids: Vec<EntityId>,
    pub label: CompactString,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTemporalEdge {
    pub id: CompactString,
    pub source_id: CompactString,
    pub target_id: CompactString,
    pub relation_type: CompactString,
    pub evidence_ids: Vec<CompactString>,
    pub confidence: f32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMemoryState {
    pub id: CompactString,
    pub entity_id: EntityId,
    pub note_id: Option<CompactString>,
    pub key: CompactString,
    pub value: CompactString,
    pub evidence_ids: Vec<CompactString>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEmbeddingTarget {
    pub id: CompactString,
    pub kind: CompactString,
    pub source_id: CompactString,
    pub note_id: Option<CompactString>,
    pub chunk_id: Option<CompactString>,
    pub entity_id: Option<EntityId>,
    pub label: CompactString,
    pub text: CompactString,
    pub evidence_ids: Vec<CompactString>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphProjectionRef {
    pub target_id: CompactString,
    pub manifold: CompactString,
    pub projection_id: CompactString,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDropReasons {
    pub missing_entity: usize,
    pub invalid_span: usize,
    pub duplicate_anchor: usize,
    pub singleton_bucket: usize,
    pub missing_chunk: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCounters {
    pub entities: usize,
    pub aliases: usize,
    pub candidates: usize,
    pub mentions: usize,
    pub accepted_anchors: usize,
    pub chunks: usize,
    pub relationship_candidates: usize,
    pub relationships: usize,
    pub accepted_relationships: usize,
    pub review_relationships: usize,
    pub rejected_relationships: usize,
    pub events: usize,
    pub episodes: usize,
    pub temporal_edges: usize,
    pub causal_edges: usize,
    pub memory_state: usize,
    pub embedding_targets: usize,
    pub embedding_vectors: usize,
    pub projection_refs: usize,
    pub nodes: usize,
    pub edges: usize,
    pub drop_reasons: GraphDropReasons,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRebuildSnapshot {
    pub schema_version: CompactString,
    pub id: CompactString,
    pub source: CompactString,
    pub scope_kind: GraphScopeKind,
    pub scope_id: CompactString,
    pub note_ids: Vec<CompactString>,
    pub built_at: u64,
    pub chunks: Vec<GraphChunk>,
    pub mentions: Vec<GraphMention>,
    pub entity_anchors: Vec<GraphAnchor>,
    pub relationships: Vec<GraphRelationship>,
    pub events: Vec<GraphEvent>,
    pub episodes: Vec<GraphEpisode>,
    pub temporal_edges: Vec<GraphTemporalEdge>,
    pub causal_edges: Vec<GraphTemporalEdge>,
    pub memory_state: Vec<GraphMemoryState>,
    pub embedding_targets: Vec<GraphEmbeddingTarget>,
    pub embedding_vectors: Vec<CompactString>,
    pub projection_refs: Vec<GraphProjectionRef>,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub counters: GraphCounters,
}
