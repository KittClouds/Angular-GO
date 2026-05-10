use phoenix_chunker::{
    build_graph_delta_for_lens, ChunkLens, GraphBuildContext, GraphDelta, LensChunk,
    LensChunkConsumer,
};

#[derive(Clone, Copy, Debug, Default)]
pub struct EvidenceLensChunkConsumer;

impl LensChunkConsumer for EvidenceLensChunkConsumer {
    fn lens(&self) -> ChunkLens {
        ChunkLens::Evidence
    }

    fn consume(&self, chunks: &[LensChunk], context: GraphBuildContext) -> GraphDelta {
        build_graph_delta_for_lens(
            "phoenix-evidence-graph/evidence",
            self.lens(),
            chunks,
            context,
        )
    }
}
