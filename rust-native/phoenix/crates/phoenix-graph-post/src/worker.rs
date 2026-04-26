use phoenix_semantic_v2::{
    scope_storage_key, CausalScopeSidecar, DirtyScopeRecord, DocumentArchive, DocumentRevisionRef,
    EventIdentityScopeSidecar, GraphDependencyManifest, GraphScopeSidecar, ScopeOrd,
    SessionArchive, TemporalScopeSidecar,
};
use phoenix_store_native_core::{
    PhoenixArchiveStoreV2, PhoenixGraphPatchStore, PhoenixScopeRuntimeStore, ScopeImageSpec,
    StoreError,
};
use phoenix_types::{ScopeKey, SessionId};
use serde::{Deserialize, Serialize};

use crate::compile::{compile_graph_projection_with_archives, CompiledGraphProjection};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphScopeReviewBatch {
    pub scope: ScopeKey,
    pub scope_key: String,
    pub scope_ord: ScopeOrd,
    pub session_id: Option<SessionId>,
    pub dirty: Option<DirtyScopeRecord>,
    #[serde(default)]
    pub document_refs: Vec<DocumentRevisionRef>,
    pub event_identity_generation: Option<u64>,
    pub temporal_generation: Option<u64>,
    pub causal_generation: Option<u64>,
    pub memory_generation: Option<u64>,
    pub graph_generation: Option<u64>,
    pub compiled: CompiledGraphProjection,
}

pub fn derive_scope_review_batch(
    archives: &[DocumentArchive],
    session: Option<&SessionArchive>,
    dirty: Option<&DirtyScopeRecord>,
    event_identity_sidecar: Option<&EventIdentityScopeSidecar>,
    temporal_sidecar: Option<&TemporalScopeSidecar>,
    causal_sidecar: Option<&CausalScopeSidecar>,
    memory_sidecar: Option<&phoenix_semantic_v2::MemoryScopeSidecar>,
) -> GraphScopeReviewBatch {
    let scope = archives
        .first()
        .map(|archive| archive.manifest.scope.clone())
        .or_else(|| dirty.as_ref().map(|record| record.scope.clone()))
        .or_else(|| {
            event_identity_sidecar
                .as_ref()
                .map(|value| value.scope.clone())
        })
        .or_else(|| temporal_sidecar.as_ref().map(|value| value.scope.clone()))
        .or_else(|| causal_sidecar.as_ref().map(|value| value.scope.clone()))
        .or_else(|| memory_sidecar.as_ref().map(|value| value.scope.clone()))
        .unwrap_or_default();
    let scope_key = archives
        .first()
        .map(|archive| archive.manifest.scope_key.clone())
        .or_else(|| dirty.as_ref().map(|record| record.scope_key.clone()))
        .or_else(|| {
            event_identity_sidecar
                .as_ref()
                .map(|value| value.scope_key.clone())
        })
        .or_else(|| {
            temporal_sidecar
                .as_ref()
                .map(|value| value.scope_key.clone())
        })
        .or_else(|| causal_sidecar.as_ref().map(|value| value.scope_key.clone()))
        .or_else(|| memory_sidecar.as_ref().map(|value| value.scope_key.clone()))
        .unwrap_or_else(|| scope_storage_key(&scope));
    let scope_ord = archives
        .first()
        .map(|archive| archive.manifest.scope_ord)
        .or_else(|| dirty.as_ref().map(|record| record.scope_ord))
        .or_else(|| {
            event_identity_sidecar
                .as_ref()
                .and_then(|value| value.scope_ord)
        })
        .or_else(|| temporal_sidecar.as_ref().and_then(|value| value.scope_ord))
        .or_else(|| causal_sidecar.as_ref().and_then(|value| value.scope_ord))
        .or_else(|| memory_sidecar.as_ref().and_then(|value| value.scope_ord))
        .unwrap_or_default();
    let session_id = archives
        .iter()
        .find_map(|archive| archive.manifest.session_id.clone())
        .or_else(|| session.map(|value| value.session_id.clone()));
    let document_refs = session
        .map(|value| {
            value
                .document_refs
                .iter()
                .filter(|reference| scope_storage_key(&reference.scope) == scope_key)
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let recorded_at = [
        event_identity_sidecar.map(|value| value.updated_at),
        temporal_sidecar.map(|value| value.updated_at),
        causal_sidecar.map(|value| value.updated_at),
        memory_sidecar.map(|value| value.updated_at),
    ]
    .into_iter()
    .flatten()
    .max();
    let compiled = compile_graph_projection_with_archives(
        &scope_key,
        archives,
        event_identity_sidecar,
        temporal_sidecar,
        causal_sidecar,
        memory_sidecar,
        recorded_at,
    );

    GraphScopeReviewBatch {
        scope,
        scope_key,
        scope_ord,
        session_id,
        dirty: dirty.cloned(),
        document_refs,
        event_identity_generation: event_identity_sidecar.map(|value| value.generation),
        temporal_generation: temporal_sidecar.map(|value| value.generation),
        causal_generation: causal_sidecar.map(|value| value.generation),
        memory_generation: memory_sidecar.map(|value| value.generation),
        graph_generation: None,
        compiled,
    }
}

pub fn derive_scope_review_batch_from_store<S>(
    store: &S,
    dirty: &DirtyScopeRecord,
    session: Option<&SessionArchive>,
) -> Result<GraphScopeReviewBatch, StoreError>
where
    S: PhoenixScopeRuntimeStore,
{
    let runtime = store.load_scope_runtime_image(dirty, ScopeImageSpec::graph())?;
    let analysis =
        phoenix_scope_analysis::ScopeAnalysisContext::from_runtime_image(runtime, session);
    let mut batch = derive_scope_review_batch(
        analysis.archives(),
        None,
        Some(&analysis.dirty),
        analysis.runtime.sidecars.event_identity.as_ref(),
        analysis.runtime.sidecars.temporal.as_ref(),
        analysis.runtime.sidecars.causal.as_ref(),
        analysis.runtime.sidecars.memory.as_ref(),
    );
    batch.session_id = analysis.session_id.clone();
    batch.document_refs = analysis.document_refs.as_ref().to_vec();
    Ok(batch)
}

pub fn derive_dirty_scope_review_batches<S>(
    store: &S,
    session_id: Option<&SessionId>,
) -> Result<Vec<GraphScopeReviewBatch>, StoreError>
where
    S: PhoenixArchiveStoreV2 + PhoenixScopeRuntimeStore,
{
    let session = match session_id {
        Some(value) => store.load_latest_session_archive(value)?,
        None => None,
    };
    let mut dirty = store.list_dirty_scopes()?;
    dirty.sort_by(|left, right| left.scope_key.cmp(&right.scope_key));
    dirty
        .into_iter()
        .map(|record| derive_scope_review_batch_from_store(store, &record, session.as_ref()))
        .collect()
}

pub fn build_graph_patch_sidecar(
    batch: &GraphScopeReviewBatch,
    created_at: i64,
) -> GraphScopeSidecar {
    let dependency_manifest = graph_dependency_manifest(
        batch.event_identity_generation,
        batch.temporal_generation,
        batch.causal_generation,
        batch.memory_generation,
    );
    GraphScopeSidecar {
        scope: batch.scope.clone(),
        scope_key: batch.scope_key.clone(),
        scope_ord: Some(batch.scope_ord),
        session_id: batch.session_id.clone(),
        updated_at: created_at,
        generation: created_at as u64,
        graph_batch: batch.compiled.graph_batch.clone(),
        dependency_manifest,
        event_identity_generation: dependency_manifest.event_identity_generation,
        temporal_generation: dependency_manifest.temporal_generation,
        causal_generation: dependency_manifest.causal_generation,
        memory_generation: dependency_manifest.memory_generation,
        summary: batch.compiled.summary.clone(),
    }
}

pub fn persist_graph_patch_sidecar<S>(
    store: &S,
    batch: &GraphScopeReviewBatch,
    created_at: i64,
) -> Result<GraphScopeSidecar, StoreError>
where
    S: PhoenixGraphPatchStore,
{
    let existing = store.load_graph_patch_sidecar(&batch.scope)?;
    persist_graph_patch_sidecar_with_existing(store, batch, created_at, existing.as_ref())
}

pub fn persist_graph_patch_sidecar_with_existing<S>(
    store: &S,
    batch: &GraphScopeReviewBatch,
    created_at: i64,
    existing: Option<&GraphScopeSidecar>,
) -> Result<GraphScopeSidecar, StoreError>
where
    S: PhoenixGraphPatchStore,
{
    let updates = build_graph_patch_sidecar(batch, created_at);
    let merged = match existing {
        Some(existing) => merge_graph_patch_sidecars(existing.clone(), updates),
        None => updates,
    };
    store.persist_graph_patch_sidecar(&merged)?;
    Ok(merged)
}

pub fn apply_graph_patch_sidecar(batch: &mut GraphScopeReviewBatch, sidecar: &GraphScopeSidecar) {
    batch.graph_generation = Some(sidecar.generation);
    batch.compiled = CompiledGraphProjection {
        graph_batch: sidecar.graph_batch.clone(),
        summary: sidecar.summary.clone(),
    };
}

fn merge_graph_patch_sidecars(
    mut existing: GraphScopeSidecar,
    updates: GraphScopeSidecar,
) -> GraphScopeSidecar {
    let updates_manifest = updates.resolved_dependency_manifest();
    existing.updated_at = existing.updated_at.max(updates.updated_at);
    existing.generation = existing.generation.max(updates.generation);
    existing.graph_batch = updates.graph_batch;
    existing.dependency_manifest = updates_manifest;
    existing.event_identity_generation = updates.event_identity_generation;
    existing.temporal_generation = updates.temporal_generation;
    existing.causal_generation = updates.causal_generation;
    existing.memory_generation = updates.memory_generation;
    existing.summary = updates.summary;
    existing
}

fn graph_dependency_manifest(
    event_identity_generation: Option<u64>,
    temporal_generation: Option<u64>,
    causal_generation: Option<u64>,
    memory_generation: Option<u64>,
) -> GraphDependencyManifest {
    GraphDependencyManifest {
        event_identity_generation,
        temporal_generation,
        causal_generation,
        memory_generation,
        graph_generation: None,
    }
}

#[cfg(test)]
mod tests {
    use phoenix_graph_kernel::KernelMutationBatch;
    use phoenix_semantic_v2::GraphCompilerSummary;

    use super::*;

    #[test]
    fn merge_graph_sidecar_keeps_fresh_projection_payload() {
        let existing = GraphScopeSidecar {
            updated_at: 100,
            generation: 100,
            graph_batch: KernelMutationBatch {
                recorded_at: Some(100),
                ..Default::default()
            },
            summary: GraphCompilerSummary {
                projection_vertex_count: 1,
                ..Default::default()
            },
            ..Default::default()
        };
        let updates = GraphScopeSidecar {
            updated_at: 50,
            generation: 50,
            graph_batch: KernelMutationBatch {
                recorded_at: Some(200),
                ..Default::default()
            },
            dependency_manifest: graph_dependency_manifest(Some(2), Some(3), Some(4), Some(5)),
            event_identity_generation: Some(2),
            temporal_generation: Some(3),
            causal_generation: Some(4),
            memory_generation: Some(5),
            summary: GraphCompilerSummary {
                projection_vertex_count: 2,
                projection_edge_count: 3,
                ..Default::default()
            },
            ..Default::default()
        };

        let merged = merge_graph_patch_sidecars(existing, updates);

        assert_eq!(merged.updated_at, 100);
        assert_eq!(merged.generation, 100);
        assert_eq!(merged.graph_batch.recorded_at, Some(200));
        assert_eq!(
            merged.dependency_manifest,
            graph_dependency_manifest(Some(2), Some(3), Some(4), Some(5))
        );
        assert_eq!(merged.event_identity_generation, Some(2));
        assert_eq!(merged.temporal_generation, Some(3));
        assert_eq!(merged.causal_generation, Some(4));
        assert_eq!(merged.memory_generation, Some(5));
        assert_eq!(merged.summary.projection_vertex_count, 2);
        assert_eq!(merged.summary.projection_edge_count, 3);
    }
}
