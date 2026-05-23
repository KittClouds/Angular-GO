//! Clean Phoenix graph rebuild spine.
//!
//! This crate owns the explicit graph snapshot contract between trusted Alex
//! identity, text chunks, accepted anchors, graph facts, embedding targets, and
//! projection consumers. It does not call the legacy staged orchestrator.

mod adjudication;
mod builder;
mod embedding;
mod facts;
#[cfg(test)]
mod tests;
mod types;

pub use builder::{
    build_graph_rebuild_snapshot, GraphRebuildBuilder, GraphRebuildError, GraphRebuildInput,
};
pub use types::{
    GraphAnchor, GraphChunk, GraphCounters, GraphDropReasons, GraphEdge, GraphEmbeddingTarget,
    GraphEpisode, GraphEvent, GraphMemoryState, GraphMention, GraphNode, GraphProjectionRef,
    GraphRebuildSnapshot, GraphRelationship, GraphScopeKind, GraphTemporalEdge,
};
