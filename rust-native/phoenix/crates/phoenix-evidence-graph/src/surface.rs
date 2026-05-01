use phoenix_machine::SurfaceCompileArtifacts;
use phoenix_types::{ChunkSpan, ScopeKey, SentenceSpan, TextRange, TokenSpan};

pub struct SurfaceFrame<'a> {
    pub document_id: &'a str,
    pub text: &'a str,
    pub scope: &'a ScopeKey,
    pub tokens: &'a [TokenSpan],
    pub sentences: &'a [SentenceSpan],
    pub chunks: &'a [ChunkSpan],
}

pub struct SurfaceFrameBuilder;

impl SurfaceFrameBuilder {
    #[inline]
    pub fn from_machine<'a>(
        document_id: &'a str,
        text: &'a str,
        scope: &'a ScopeKey,
        artifacts: &'a SurfaceCompileArtifacts,
    ) -> SurfaceFrame<'a> {
        SurfaceFrame {
            document_id,
            text,
            scope,
            tokens: &artifacts.scan.tokens,
            sentences: &artifacts.scan.sentences,
            chunks: &artifacts.scan.chunks,
        }
    }

    #[inline]
    pub fn sentence_range(sentences: &[SentenceSpan], sentence_index: u32) -> Option<TextRange> {
        sentences.get(sentence_index as usize).map(|s| s.range)
    }
}
