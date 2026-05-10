//! Phoenix Evidence Graph Compiler.
//!
//! Modular evidence-to-truth body between Dynamic NER and OverGraph.
//! This crate deliberately does not depend on the legacy ingest crate.

mod candidate;
mod compiler;
mod fusion;
mod lens_consumer;
mod patch;
mod surface;
mod types;

pub use candidate::{CandidateGraphBuilder, CandidateIndex};
pub use compiler::{EvidenceGraphCompiler, EvidenceGraphCompilerConfig, EvidenceGraphError};
pub use fusion::FusionGate;
pub use lens_consumer::EvidenceLensChunkConsumer;
pub use patch::OverGraphPatchBuilder;
pub use surface::{SurfaceFrame, SurfaceFrameBuilder};
pub use types::{
    CandidateDecision, CandidateEdge, CandidateEdgeKind, CandidateGraph, CandidateTarget,
    ClaimDurability, CompileRequest, CompileStage, CompileStageMask, CompileSummary,
    CompilerBudget, CompilerModelPolicy, EvidenceCompileOutput, EvidenceGraphPatch,
    EvidencePatchOp, EvidenceStatus, PatchIntent,
};
