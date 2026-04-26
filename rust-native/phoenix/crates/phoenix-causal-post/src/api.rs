//! Stable public entrypoints for the post-ingest causal compiler.
//!
//! This stage owns causal batch derivation, deterministic causal validation,
//! sidecar persistence, replay, and causal memory-card materialization. It
//! expects archives with persisted causal substrate plus optional ER replay and
//! writes `CausalScopeSidecar` records. Prefer these functions over reaching
//! into the worker internals from orchestration code.

use phoenix_store_native_core::{
    PhoenixArchiveStoreV2, PhoenixCausalPatchStore, PhoenixScopeRuntimeStore, StoreError,
};
use phoenix_types::SessionId;

use crate::{
    apply_causal_patch_sidecar, build_causal_patch_sidecar, derive_dirty_scope_review_batches,
    derive_scope_review_batch, persist_causal_patch_sidecar,
    persist_causal_patch_sidecar_with_existing, run_causal_scope, CausalScopeReviewBatch,
};

pub fn derive_batches<S>(
    store: &S,
    session_id: Option<&SessionId>,
) -> Result<Vec<CausalScopeReviewBatch>, StoreError>
where
    S: PhoenixArchiveStoreV2 + PhoenixScopeRuntimeStore,
{
    derive_dirty_scope_review_batches(store, session_id)
}

pub fn derive_batch(
    archives: &[phoenix_semantic_v2::DocumentArchive],
    session: Option<&phoenix_semantic_v2::SessionArchive>,
    dirty: Option<&phoenix_semantic_v2::DirtyScopeRecord>,
    er_sidecar: Option<&phoenix_semantic_v2::ErScopePatchSidecar>,
) -> CausalScopeReviewBatch {
    derive_scope_review_batch(archives, session, dirty, er_sidecar)
}

pub fn derive_batch_from_analysis(
    analysis: &phoenix_scope_analysis::ScopeAnalysisContext,
    event_identity_sidecar: Option<&phoenix_semantic_v2::EventIdentityScopeSidecar>,
    temporal_sidecar: Option<&phoenix_semantic_v2::TemporalScopeSidecar>,
    causal_sidecar: Option<&phoenix_semantic_v2::CausalScopeSidecar>,
) -> CausalScopeReviewBatch {
    let mut batch = crate::worker::derive_scope_review_batch_with_sidecars(
        analysis.archives(),
        None,
        Some(&analysis.dirty),
        analysis.runtime.sidecars.er.as_ref(),
        temporal_sidecar,
    );
    batch.session_id = analysis.session_id.clone();
    batch.document_refs = analysis.document_refs.as_ref().to_vec();
    if let Some(sidecar) = event_identity_sidecar {
        crate::worker::annotate_causal_batch_with_event_identity(&mut batch, sidecar);
    }
    if let Some(sidecar) = causal_sidecar {
        apply_causal_patch_sidecar(&mut batch, sidecar);
        if let Some(event_identity_sidecar) = event_identity_sidecar {
            crate::worker::annotate_causal_batch_with_event_identity(
                &mut batch,
                event_identity_sidecar,
            );
        }
    }
    batch
}

pub fn run_batch(batch: &mut CausalScopeReviewBatch, created_at: i64) {
    run_causal_scope(batch, created_at)
}

pub fn build_patch_sidecar(
    batch: &CausalScopeReviewBatch,
    created_at: i64,
) -> phoenix_semantic_v2::CausalScopeSidecar {
    build_causal_patch_sidecar(batch, created_at)
}

pub fn persist_patch_sidecar<S>(
    store: &S,
    batch: &CausalScopeReviewBatch,
    created_at: i64,
) -> Result<phoenix_semantic_v2::CausalScopeSidecar, StoreError>
where
    S: PhoenixCausalPatchStore,
{
    persist_causal_patch_sidecar(store, batch, created_at)
}

pub fn persist_patch_sidecar_with_existing<S>(
    store: &S,
    batch: &CausalScopeReviewBatch,
    created_at: i64,
    existing: Option<&phoenix_semantic_v2::CausalScopeSidecar>,
) -> Result<phoenix_semantic_v2::CausalScopeSidecar, StoreError>
where
    S: PhoenixCausalPatchStore,
{
    persist_causal_patch_sidecar_with_existing(store, batch, created_at, existing)
}
