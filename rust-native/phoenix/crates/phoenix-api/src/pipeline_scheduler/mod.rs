mod context;
mod post_ingest;
mod types;

pub use context::PipelineGenerationContext;
pub use post_ingest::{
    run_causal_pipeline, run_continuity_pipeline, run_event_identity_pipeline, run_graph_pipeline,
    run_late_sidecar_pipeline, run_post_ingest_pipeline, run_sidecar_continuity_pipeline,
    run_temporal_pipeline,
};
pub use types::{
    PipelineRunMetrics, PipelineRunRequest, PipelineRunShape, PipelineStage, PipelineStageStatus,
    ScopeGenerationKey, StageProductEnvelope,
};
