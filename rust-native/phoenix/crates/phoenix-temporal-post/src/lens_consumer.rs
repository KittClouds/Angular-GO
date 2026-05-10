use phoenix_chunker::{
    build_graph_delta_for_lens, ChunkLens, GraphBuildContext, GraphDelta, LensChunk,
    LensChunkConsumer,
};

#[derive(Clone, Copy, Debug, Default)]
pub struct TemporalLensChunkConsumer;

impl LensChunkConsumer for TemporalLensChunkConsumer {
    fn lens(&self) -> ChunkLens {
        ChunkLens::Temporal
    }

    fn consume(&self, chunks: &[LensChunk], context: GraphBuildContext) -> GraphDelta {
        build_graph_delta_for_lens(
            "phoenix-temporal-post/temporal",
            self.lens(),
            chunks,
            context,
        )
    }
}
