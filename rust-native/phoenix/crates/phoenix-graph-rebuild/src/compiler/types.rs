use compact_str::CompactString;
use phoenix_alex::SurfaceHit;
use phoenix_chunker::{LensChunk, LensMentionGraph};
use phoenix_types::{EntityId, TextRange};
use serde::{Deserialize, Serialize};

use crate::types::{
    GraphAnchor, GraphChunk, GraphEdge, GraphEvent, GraphMemoryState, GraphMention, GraphNode,
    GraphRelationship, GraphScopeKind, GraphTemporalEdge,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FactLane {
    DocumentSpine,
    ChunkSpine,
    EntityAnchor,
    RelationshipFact,
    CooccurrenceWeak,
    EventIdentity,
    TemporalFact,
    CausalFact,
    MemoryState,
    AnchorEvidence,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphAtomKind {
    Document,
    Chunk,
    SourceSpan,
    EvidenceAnchor,
    Entity,
    Concept,
    Event,
    State,
    Claim,
    TimeAnchor,
    Root,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceKind {
    SurfaceHit,
    MentionPacket,
    CueHit,
    LensFrame,
    SourceSpan,
    UserAccepted,
    ModelVote,
    AdjudicationVote,
    EventReference,
    MentionGraphEdge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceBundleKind {
    Span,
    Frame,
    Neighborhood,
    SemanticSimilarity,
    ShadowIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAtom {
    pub id: CompactString,
    pub kind: GraphAtomKind,
    pub source_id: CompactString,
    pub label: CompactString,
    pub note_id: Option<CompactString>,
    pub chunk_id: Option<CompactString>,
    pub entity_id: Option<EntityId>,
    pub evidence_ids: Vec<CompactString>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceAnchor {
    pub id: CompactString,
    pub kind: EvidenceKind,
    pub note_id: Option<CompactString>,
    pub chunk_id: Option<CompactString>,
    pub source_range: Option<TextRange>,
    pub source_id: CompactString,
    pub confidence: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationFact {
    pub id: CompactString,
    pub lane: FactLane,
    pub predicate: CompactString,
    pub source_record_id: CompactString,
    pub status: CompactString,
    pub evidence_ids: Vec<CompactString>,
    pub confidence: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactBundle {
    pub id: CompactString,
    pub lane: FactLane,
    pub bundle_kind: EvidenceBundleKind,
    pub group_key: CompactString,
    pub predicate: CompactString,
    pub source_record_id: CompactString,
    pub status: CompactString,
    pub evidence_ids: Vec<CompactString>,
    pub confidence: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactRole {
    pub fact_id: CompactString,
    pub role: CompactString,
    pub atom_id: CompactString,
    pub confidence: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedGraphEdge {
    pub id: CompactString,
    pub source_id: CompactString,
    pub target_id: CompactString,
    pub edge_type: CompactString,
    pub projection_kind: CompactString,
    pub source_fact_id: Option<CompactString>,
    pub source_bundle_id: Option<CompactString>,
    pub confidence: f32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCompileCounters {
    pub atoms: usize,
    pub evidence_anchors: usize,
    pub bundles: usize,
    pub facts: usize,
    pub roles: usize,
    pub projected_edges: usize,
    pub invariant_failures: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRootReceipt {
    pub lane: FactLane,
    pub atoms: usize,
    pub evidence_anchors: usize,
    pub bundles: usize,
    pub facts: usize,
    pub roles: usize,
    pub projected_edges: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCompileReceipts {
    pub roots: Vec<GraphRootReceipt>,
    pub counters: GraphCompileCounters,
    pub invariant_failures: Vec<CompactString>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCompilerOutput {
    pub schema_version: CompactString,
    pub scope_kind: GraphScopeKind,
    pub scope_id: CompactString,
    pub built_at: u64,
    pub atoms: Vec<GraphAtom>,
    pub evidence_anchors: Vec<EvidenceAnchor>,
    pub bundles: Vec<FactBundle>,
    pub facts: Vec<RelationFact>,
    pub roles: Vec<FactRole>,
    pub projected_edges: Vec<ProjectedGraphEdge>,
    pub receipts: GraphCompileReceipts,
}

pub struct GraphCompilerInput<'a> {
    pub scope_kind: GraphScopeKind,
    pub scope_id: &'a str,
    pub built_at: u64,
    pub note_ids: &'a [CompactString],
    pub chunks: &'a [GraphChunk],
    pub surface_hits: &'a [SurfaceHit],
    pub mentions: &'a [GraphMention],
    pub mention_graph: Option<&'a LensMentionGraph>,
    pub lens_frames: &'a [LensChunk],
    pub entity_anchors: &'a [GraphAnchor],
    pub nodes: &'a [GraphNode],
    pub relationships: &'a [GraphRelationship],
    pub events: &'a [GraphEvent],
    pub temporal_edges: &'a [GraphTemporalEdge],
    pub causal_edges: &'a [GraphTemporalEdge],
    pub memory_state: &'a [GraphMemoryState],
    pub legacy_edges: &'a [GraphEdge],
}
