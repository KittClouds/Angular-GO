//! Desktop workspace bridge for the canonical dynamic NER engine.

#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/engine.rs"]
mod engine;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/graph.rs"]
mod graph;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/hints.rs"]
mod hints;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/known_lane.rs"]
mod known_lane;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/native_lane.rs"]
mod native_lane;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/router.rs"]
mod router;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/schema.rs"]
mod schema;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/scoring.rs"]
mod scoring;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/surface_memory.rs"]
mod surface_memory;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/traits.rs"]
mod traits;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-dynamic-ner/src/types.rs"]
mod types;

pub use engine::{
    NerError, PhoenixNerEngine, PhoenixNerEngineBuilder, SurfaceNerInput, SurfaceNerOutput,
};
pub use graph::{MentionEdge, MentionEdgeKind, MentionGraph, MentionGraphBuilder};
pub use hints::{ChunkHint, ChunkHintKind, ChunkHintSource};
pub use known_lane::KnownSurfaceLane;
pub use native_lane::NativeDiscoveryLane;
pub use router::SurfaceRouter;
pub use schema::DynamicSchemaBuilder;
pub use scoring::{MentionWorkspace, ScoreTable};
pub use surface_memory::{
    SurfaceCandidateEdge, SurfaceCandidateKind, SurfaceCandidateTarget, SurfaceMemoryEntry,
    SurfaceMemoryReport,
};
pub use traits::{
    AdjudicationCase, AdjudicationDecision, AdjudicationError, DecisionKind, DiscoveredSpan,
    DynamicNerModel, InstructTask, MentionAdjudicator, Modality, ModelNerWindow, NerModelError,
    Polarity, VerificationCase,
};
pub use types::{
    DomainProfile, EntityLabel, LabelPack, LocalMentionId, MentionContext, MentionKind,
    MentionPacket, MentionSemantics, MentionSourceKind, MentionStatus, MentionSyntax, MentionVote,
    NerNeedVector, NerRoute, VoteReason,
};
