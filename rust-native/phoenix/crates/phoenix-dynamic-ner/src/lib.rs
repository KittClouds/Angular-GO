//! Phoenix Dynamic NER — Surface Intelligence Layer
//!
//! A mention compiler that produces high-quality mention evidence through
//! four lanes: known surface (Alex), native discovery, dynamic model, and
//! adjudication. NER creates mention evidence; entity identity is a later
//! graph problem.

mod engine;
mod graph;
mod hints;
mod known_lane;
mod native_lane;
mod router;
mod schema;
mod scoring;
mod surface_memory;
mod traits;
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
