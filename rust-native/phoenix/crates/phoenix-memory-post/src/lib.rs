pub mod api;

mod compile;
mod lens_consumer;
mod normalize;
pub mod registry;
pub mod views;
pub mod worker;

pub use compile::{compile_memory, CompiledMemory};
pub use lens_consumer::WorldbuildingLensChunkConsumer;
pub use normalize::{build_entity_profiles, normalize_memory_inputs, MemoryEntityProfile};
pub use worker::{
    apply_memory_patch_sidecar, build_memory_patch_sidecar, derive_dirty_scope_review_batches,
    derive_scope_review_batch, derive_scope_review_batch_from_analysis,
    derive_scope_review_batch_from_store, persist_memory_patch_sidecar,
    persist_memory_patch_sidecar_with_existing, MemoryScopeReviewBatch,
};

#[cfg(test)]
mod relationship_conflict_tests;
#[cfg(test)]
mod scalar_conflict_tests;
#[cfg(test)]
mod tests;
