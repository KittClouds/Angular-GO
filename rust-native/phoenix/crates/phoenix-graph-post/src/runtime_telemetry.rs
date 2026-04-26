use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use serde::Serialize;

#[derive(Clone, Copy, Debug)]
pub(crate) enum GraphRuntimeMetric {
    LoadProjectionKernel,
    BuildProjectionKernel,
    RankedWorldState,
    RankedHistory,
    RankedCausalExplanation,
    RetrievedWorldState,
    RetrievedHistory,
    RetrievedCausalExplanation,
    RetrieveQuerySeeds,
    BuildRegionFromSnapshot,
    BuildRegionFromView,
    BuildQueryView,
    CollectRegionAnchors,
    FilterRegionSeeds,
    ExpandRegionFromView,
    AssembleRegionFromView,
    EmbedQuery,
    QueryEmbedderLoad,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRuntimeTiming {
    pub count: u64,
    pub total_us: u64,
    pub mean_us: f64,
    pub max_us: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRuntimeTelemetrySnapshot {
    pub load_projection_kernel: GraphRuntimeTiming,
    pub build_projection_kernel: GraphRuntimeTiming,
    pub ranked_world_state: GraphRuntimeTiming,
    pub ranked_history: GraphRuntimeTiming,
    pub ranked_causal_explanation: GraphRuntimeTiming,
    pub retrieved_world_state: GraphRuntimeTiming,
    pub retrieved_history: GraphRuntimeTiming,
    pub retrieved_causal_explanation: GraphRuntimeTiming,
    pub retrieve_query_seeds: GraphRuntimeTiming,
    pub build_region_from_snapshot: GraphRuntimeTiming,
    pub build_region_from_view: GraphRuntimeTiming,
    pub build_query_view: GraphRuntimeTiming,
    pub collect_region_anchors: GraphRuntimeTiming,
    pub filter_region_seeds: GraphRuntimeTiming,
    pub expand_region_from_view: GraphRuntimeTiming,
    pub assemble_region_from_view: GraphRuntimeTiming,
    pub embed_query: GraphRuntimeTiming,
    pub query_embedder_load: GraphRuntimeTiming,
    pub embed_query_cache_hit_total: u64,
    pub embed_query_cache_miss_total: u64,
    pub seed_query_request_total: u64,
    pub seed_query_cache_hit_total: u64,
    pub seed_query_cache_miss_total: u64,
    pub loaded_asserted_vertex_total: u64,
    pub loaded_asserted_edge_total: u64,
    pub loaded_candidate_edge_total: u64,
    pub seed_query_kind_total: u64,
    pub seed_query_hit_total: u64,
    pub region_input_vertex_total: u64,
    pub region_input_asserted_edge_total: u64,
    pub region_input_candidate_edge_total: u64,
    pub region_anchor_total: u64,
    pub region_seed_total: u64,
    pub built_region_vertex_total: u64,
    pub built_region_asserted_edge_total: u64,
    pub built_region_candidate_edge_total: u64,
}

#[derive(Default)]
struct AtomicTiming {
    count: AtomicU64,
    total_us: AtomicU64,
    max_us: AtomicU64,
}

impl AtomicTiming {
    fn record(&self, elapsed_us: u64) {
        self.count.fetch_add(1, Ordering::Relaxed);
        self.total_us.fetch_add(elapsed_us, Ordering::Relaxed);
        self.max_us.fetch_max(elapsed_us, Ordering::Relaxed);
    }

    fn snapshot(&self) -> GraphRuntimeTiming {
        let count = self.count.load(Ordering::Relaxed);
        let total_us = self.total_us.load(Ordering::Relaxed);
        GraphRuntimeTiming {
            count,
            total_us,
            mean_us: if count == 0 {
                0.0
            } else {
                total_us as f64 / count as f64
            },
            max_us: self.max_us.load(Ordering::Relaxed),
        }
    }

    fn reset(&self) {
        self.count.store(0, Ordering::Relaxed);
        self.total_us.store(0, Ordering::Relaxed);
        self.max_us.store(0, Ordering::Relaxed);
    }
}

#[derive(Default)]
struct GraphRuntimeTelemetryState {
    load_projection_kernel: AtomicTiming,
    build_projection_kernel: AtomicTiming,
    ranked_world_state: AtomicTiming,
    ranked_history: AtomicTiming,
    ranked_causal_explanation: AtomicTiming,
    retrieved_world_state: AtomicTiming,
    retrieved_history: AtomicTiming,
    retrieved_causal_explanation: AtomicTiming,
    retrieve_query_seeds: AtomicTiming,
    build_region_from_snapshot: AtomicTiming,
    build_region_from_view: AtomicTiming,
    build_query_view: AtomicTiming,
    collect_region_anchors: AtomicTiming,
    filter_region_seeds: AtomicTiming,
    expand_region_from_view: AtomicTiming,
    assemble_region_from_view: AtomicTiming,
    embed_query: AtomicTiming,
    query_embedder_load: AtomicTiming,
    embed_query_cache_hit_total: AtomicU64,
    embed_query_cache_miss_total: AtomicU64,
    seed_query_request_total: AtomicU64,
    seed_query_cache_hit_total: AtomicU64,
    seed_query_cache_miss_total: AtomicU64,
    loaded_asserted_vertex_total: AtomicU64,
    loaded_asserted_edge_total: AtomicU64,
    loaded_candidate_edge_total: AtomicU64,
    seed_query_kind_total: AtomicU64,
    seed_query_hit_total: AtomicU64,
    region_input_vertex_total: AtomicU64,
    region_input_asserted_edge_total: AtomicU64,
    region_input_candidate_edge_total: AtomicU64,
    region_anchor_total: AtomicU64,
    region_seed_total: AtomicU64,
    built_region_vertex_total: AtomicU64,
    built_region_asserted_edge_total: AtomicU64,
    built_region_candidate_edge_total: AtomicU64,
}

impl GraphRuntimeTelemetryState {
    fn timing(&self, metric: GraphRuntimeMetric) -> &AtomicTiming {
        match metric {
            GraphRuntimeMetric::LoadProjectionKernel => &self.load_projection_kernel,
            GraphRuntimeMetric::BuildProjectionKernel => &self.build_projection_kernel,
            GraphRuntimeMetric::RankedWorldState => &self.ranked_world_state,
            GraphRuntimeMetric::RankedHistory => &self.ranked_history,
            GraphRuntimeMetric::RankedCausalExplanation => &self.ranked_causal_explanation,
            GraphRuntimeMetric::RetrievedWorldState => &self.retrieved_world_state,
            GraphRuntimeMetric::RetrievedHistory => &self.retrieved_history,
            GraphRuntimeMetric::RetrievedCausalExplanation => &self.retrieved_causal_explanation,
            GraphRuntimeMetric::RetrieveQuerySeeds => &self.retrieve_query_seeds,
            GraphRuntimeMetric::BuildRegionFromSnapshot => &self.build_region_from_snapshot,
            GraphRuntimeMetric::BuildRegionFromView => &self.build_region_from_view,
            GraphRuntimeMetric::BuildQueryView => &self.build_query_view,
            GraphRuntimeMetric::CollectRegionAnchors => &self.collect_region_anchors,
            GraphRuntimeMetric::FilterRegionSeeds => &self.filter_region_seeds,
            GraphRuntimeMetric::ExpandRegionFromView => &self.expand_region_from_view,
            GraphRuntimeMetric::AssembleRegionFromView => &self.assemble_region_from_view,
            GraphRuntimeMetric::EmbedQuery => &self.embed_query,
            GraphRuntimeMetric::QueryEmbedderLoad => &self.query_embedder_load,
        }
    }

    fn snapshot(&self) -> GraphRuntimeTelemetrySnapshot {
        GraphRuntimeTelemetrySnapshot {
            load_projection_kernel: self.load_projection_kernel.snapshot(),
            build_projection_kernel: self.build_projection_kernel.snapshot(),
            ranked_world_state: self.ranked_world_state.snapshot(),
            ranked_history: self.ranked_history.snapshot(),
            ranked_causal_explanation: self.ranked_causal_explanation.snapshot(),
            retrieved_world_state: self.retrieved_world_state.snapshot(),
            retrieved_history: self.retrieved_history.snapshot(),
            retrieved_causal_explanation: self.retrieved_causal_explanation.snapshot(),
            retrieve_query_seeds: self.retrieve_query_seeds.snapshot(),
            build_region_from_snapshot: self.build_region_from_snapshot.snapshot(),
            build_region_from_view: self.build_region_from_view.snapshot(),
            build_query_view: self.build_query_view.snapshot(),
            collect_region_anchors: self.collect_region_anchors.snapshot(),
            filter_region_seeds: self.filter_region_seeds.snapshot(),
            expand_region_from_view: self.expand_region_from_view.snapshot(),
            assemble_region_from_view: self.assemble_region_from_view.snapshot(),
            embed_query: self.embed_query.snapshot(),
            query_embedder_load: self.query_embedder_load.snapshot(),
            embed_query_cache_hit_total: self.embed_query_cache_hit_total.load(Ordering::Relaxed),
            embed_query_cache_miss_total: self.embed_query_cache_miss_total.load(Ordering::Relaxed),
            seed_query_request_total: self.seed_query_request_total.load(Ordering::Relaxed),
            seed_query_cache_hit_total: self.seed_query_cache_hit_total.load(Ordering::Relaxed),
            seed_query_cache_miss_total: self.seed_query_cache_miss_total.load(Ordering::Relaxed),
            loaded_asserted_vertex_total: self.loaded_asserted_vertex_total.load(Ordering::Relaxed),
            loaded_asserted_edge_total: self.loaded_asserted_edge_total.load(Ordering::Relaxed),
            loaded_candidate_edge_total: self.loaded_candidate_edge_total.load(Ordering::Relaxed),
            seed_query_kind_total: self.seed_query_kind_total.load(Ordering::Relaxed),
            seed_query_hit_total: self.seed_query_hit_total.load(Ordering::Relaxed),
            region_input_vertex_total: self.region_input_vertex_total.load(Ordering::Relaxed),
            region_input_asserted_edge_total: self
                .region_input_asserted_edge_total
                .load(Ordering::Relaxed),
            region_input_candidate_edge_total: self
                .region_input_candidate_edge_total
                .load(Ordering::Relaxed),
            region_anchor_total: self.region_anchor_total.load(Ordering::Relaxed),
            region_seed_total: self.region_seed_total.load(Ordering::Relaxed),
            built_region_vertex_total: self.built_region_vertex_total.load(Ordering::Relaxed),
            built_region_asserted_edge_total: self
                .built_region_asserted_edge_total
                .load(Ordering::Relaxed),
            built_region_candidate_edge_total: self
                .built_region_candidate_edge_total
                .load(Ordering::Relaxed),
        }
    }

    fn reset(&self) {
        self.load_projection_kernel.reset();
        self.build_projection_kernel.reset();
        self.ranked_world_state.reset();
        self.ranked_history.reset();
        self.ranked_causal_explanation.reset();
        self.retrieved_world_state.reset();
        self.retrieved_history.reset();
        self.retrieved_causal_explanation.reset();
        self.retrieve_query_seeds.reset();
        self.build_region_from_snapshot.reset();
        self.build_region_from_view.reset();
        self.build_query_view.reset();
        self.collect_region_anchors.reset();
        self.filter_region_seeds.reset();
        self.expand_region_from_view.reset();
        self.assemble_region_from_view.reset();
        self.embed_query.reset();
        self.query_embedder_load.reset();
        self.embed_query_cache_hit_total.store(0, Ordering::Relaxed);
        self.embed_query_cache_miss_total
            .store(0, Ordering::Relaxed);
        self.seed_query_request_total.store(0, Ordering::Relaxed);
        self.seed_query_cache_hit_total.store(0, Ordering::Relaxed);
        self.seed_query_cache_miss_total.store(0, Ordering::Relaxed);
        self.loaded_asserted_vertex_total
            .store(0, Ordering::Relaxed);
        self.loaded_asserted_edge_total.store(0, Ordering::Relaxed);
        self.loaded_candidate_edge_total.store(0, Ordering::Relaxed);
        self.seed_query_kind_total.store(0, Ordering::Relaxed);
        self.seed_query_hit_total.store(0, Ordering::Relaxed);
        self.region_input_vertex_total.store(0, Ordering::Relaxed);
        self.region_input_asserted_edge_total
            .store(0, Ordering::Relaxed);
        self.region_input_candidate_edge_total
            .store(0, Ordering::Relaxed);
        self.region_anchor_total.store(0, Ordering::Relaxed);
        self.region_seed_total.store(0, Ordering::Relaxed);
        self.built_region_vertex_total.store(0, Ordering::Relaxed);
        self.built_region_asserted_edge_total
            .store(0, Ordering::Relaxed);
        self.built_region_candidate_edge_total
            .store(0, Ordering::Relaxed);
    }
}

fn telemetry() -> &'static GraphRuntimeTelemetryState {
    static TELEMETRY: OnceLock<GraphRuntimeTelemetryState> = OnceLock::new();
    TELEMETRY.get_or_init(GraphRuntimeTelemetryState::default)
}

pub(crate) struct GraphRuntimeMeasure {
    metric: GraphRuntimeMetric,
    started_at: Instant,
}

impl Drop for GraphRuntimeMeasure {
    fn drop(&mut self) {
        let elapsed_us = self.started_at.elapsed().as_micros() as u64;
        telemetry().timing(self.metric).record(elapsed_us);
    }
}

pub(crate) fn measure_graph_runtime(metric: GraphRuntimeMetric) -> GraphRuntimeMeasure {
    GraphRuntimeMeasure {
        metric,
        started_at: Instant::now(),
    }
}

pub(crate) fn record_projection_kernel_load(
    asserted_vertices: usize,
    asserted_edges: usize,
    candidate_edges: usize,
) {
    let telemetry = telemetry();
    telemetry
        .loaded_asserted_vertex_total
        .fetch_add(asserted_vertices as u64, Ordering::Relaxed);
    telemetry
        .loaded_asserted_edge_total
        .fetch_add(asserted_edges as u64, Ordering::Relaxed);
    telemetry
        .loaded_candidate_edge_total
        .fetch_add(candidate_edges as u64, Ordering::Relaxed);
}

pub(crate) fn record_seed_query_request(kind_count: usize) {
    let telemetry = telemetry();
    telemetry
        .seed_query_request_total
        .fetch_add(1, Ordering::Relaxed);
    telemetry
        .seed_query_kind_total
        .fetch_add(kind_count as u64, Ordering::Relaxed);
}

pub(crate) fn record_embed_query_cache_hit() {
    telemetry()
        .embed_query_cache_hit_total
        .fetch_add(1, Ordering::Relaxed);
}

pub(crate) fn record_embed_query_cache_miss(count: usize) {
    telemetry()
        .embed_query_cache_miss_total
        .fetch_add(count as u64, Ordering::Relaxed);
}

pub(crate) fn record_seed_query_cache_hit() {
    telemetry()
        .seed_query_cache_hit_total
        .fetch_add(1, Ordering::Relaxed);
}

pub(crate) fn record_seed_query_cache_miss() {
    telemetry()
        .seed_query_cache_miss_total
        .fetch_add(1, Ordering::Relaxed);
}

pub(crate) fn record_seed_query_stats(_kind_count: usize, hit_count: usize) {
    let telemetry = telemetry();
    telemetry
        .seed_query_hit_total
        .fetch_add(hit_count as u64, Ordering::Relaxed);
}

pub(crate) fn record_region_build(
    vertex_count: usize,
    asserted_edge_count: usize,
    candidate_edge_count: usize,
) {
    let telemetry = telemetry();
    telemetry
        .built_region_vertex_total
        .fetch_add(vertex_count as u64, Ordering::Relaxed);
    telemetry
        .built_region_asserted_edge_total
        .fetch_add(asserted_edge_count as u64, Ordering::Relaxed);
    telemetry
        .built_region_candidate_edge_total
        .fetch_add(candidate_edge_count as u64, Ordering::Relaxed);
}

pub(crate) fn record_region_input(
    vertex_count: usize,
    asserted_edge_count: usize,
    candidate_edge_count: usize,
    anchor_count: usize,
    seed_count: usize,
) {
    let telemetry = telemetry();
    telemetry
        .region_input_vertex_total
        .fetch_add(vertex_count as u64, Ordering::Relaxed);
    telemetry
        .region_input_asserted_edge_total
        .fetch_add(asserted_edge_count as u64, Ordering::Relaxed);
    telemetry
        .region_input_candidate_edge_total
        .fetch_add(candidate_edge_count as u64, Ordering::Relaxed);
    telemetry
        .region_anchor_total
        .fetch_add(anchor_count as u64, Ordering::Relaxed);
    telemetry
        .region_seed_total
        .fetch_add(seed_count as u64, Ordering::Relaxed);
}

pub fn reset_graph_runtime_telemetry() {
    telemetry().reset();
}

pub fn snapshot_graph_runtime_telemetry() -> GraphRuntimeTelemetrySnapshot {
    telemetry().snapshot()
}

#[cfg(test)]
mod tests {
    use super::{
        measure_graph_runtime, record_embed_query_cache_hit, record_embed_query_cache_miss,
        record_projection_kernel_load, record_region_build, record_region_input,
        record_seed_query_cache_hit, record_seed_query_cache_miss, record_seed_query_request,
        record_seed_query_stats, reset_graph_runtime_telemetry, snapshot_graph_runtime_telemetry,
        GraphRuntimeMetric,
    };

    #[test]
    fn telemetry_snapshot_tracks_counts_and_volume() {
        reset_graph_runtime_telemetry();
        {
            let _timer = measure_graph_runtime(GraphRuntimeMetric::LoadProjectionKernel);
        }
        {
            let _timer = measure_graph_runtime(GraphRuntimeMetric::BuildProjectionKernel);
        }
        record_projection_kernel_load(3, 5, 7);
        record_embed_query_cache_miss(2);
        record_embed_query_cache_hit();
        record_seed_query_request(5);
        record_seed_query_cache_miss();
        record_seed_query_cache_hit();
        record_seed_query_stats(5, 21);
        record_region_input(19, 23, 29, 2, 3);
        record_region_build(11, 13, 17);

        let snapshot = snapshot_graph_runtime_telemetry();
        assert!(snapshot.load_projection_kernel.count >= 1);
        assert!(snapshot.build_projection_kernel.count >= 1);
        assert!(snapshot.embed_query_cache_hit_total >= 1);
        assert!(snapshot.embed_query_cache_miss_total >= 2);
        assert!(snapshot.seed_query_request_total >= 1);
        assert!(snapshot.seed_query_cache_hit_total >= 1);
        assert!(snapshot.seed_query_cache_miss_total >= 1);
        assert!(snapshot.loaded_asserted_vertex_total >= 3);
        assert!(snapshot.loaded_asserted_edge_total >= 5);
        assert!(snapshot.loaded_candidate_edge_total >= 7);
        assert!(snapshot.seed_query_kind_total >= 5);
        assert!(snapshot.seed_query_hit_total >= 21);
        assert!(snapshot.region_input_vertex_total >= 19);
        assert!(snapshot.region_input_asserted_edge_total >= 23);
        assert!(snapshot.region_input_candidate_edge_total >= 29);
        assert!(snapshot.region_anchor_total >= 2);
        assert!(snapshot.region_seed_total >= 3);
        assert!(snapshot.built_region_vertex_total >= 11);
        assert!(snapshot.built_region_asserted_edge_total >= 13);
        assert!(snapshot.built_region_candidate_edge_total >= 17);
    }
}
