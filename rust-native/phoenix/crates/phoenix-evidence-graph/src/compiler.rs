use phoenix_dynamic_ner::{MentionGraph, MentionPacket, SurfaceNerOutput};
use thiserror::Error;

use crate::candidate::CandidateGraphBuilder;
use crate::fusion::FusionGate;
use crate::patch::OverGraphPatchBuilder;
use crate::types::{
    CandidateGraph, CompileRequest, CompileStage, CompileSummary, EvidenceCompileOutput,
    EvidenceGraphPatch,
};

#[derive(Clone, Copy, Debug, Default)]
pub struct EvidenceGraphCompilerConfig {
    pub strict_budget: bool,
}

#[derive(Debug, Error)]
pub enum EvidenceGraphError {
    #[error("compiler budget exceeded: {stage} count={count} max={max}")]
    BudgetExceeded {
        stage: &'static str,
        count: usize,
        max: usize,
    },
}

#[derive(Clone, Debug, Default)]
pub struct EvidenceGraphCompiler {
    config: EvidenceGraphCompilerConfig,
}

impl EvidenceGraphCompiler {
    #[inline]
    pub const fn new(config: EvidenceGraphCompilerConfig) -> Self {
        Self { config }
    }

    pub fn compile_ner_output(
        &self,
        request: &CompileRequest,
        ner_output: SurfaceNerOutput,
    ) -> Result<EvidenceCompileOutput, EvidenceGraphError> {
        self.compile_mentions(request, ner_output.mentions, ner_output.mention_graph)
    }

    pub fn compile_mentions(
        &self,
        request: &CompileRequest,
        mentions: Vec<MentionPacket>,
        mention_graph: MentionGraph,
    ) -> Result<EvidenceCompileOutput, EvidenceGraphError> {
        self.check_budget("mentions", mentions.len(), request.budget.max_mentions)?;

        let candidates = if request.stages.contains(CompileStage::Candidates) {
            CandidateGraphBuilder::build(
                &mentions,
                &mention_graph,
                request.budget.max_candidate_edges,
            )
        } else {
            CandidateGraph::default()
        };
        self.check_budget(
            "candidate_edges",
            candidates.edges.len(),
            request.budget.max_candidate_edges,
        )?;

        let decisions = if request.stages.contains(CompileStage::Fusion) {
            FusionGate::decide(&candidates)
        } else {
            Vec::new()
        };

        let patch = if request.stages.contains(CompileStage::Patch) {
            OverGraphPatchBuilder::build(&decisions, request.budget.max_patch_ops)
        } else {
            EvidenceGraphPatch::default()
        };
        self.check_budget("patch_ops", patch.ops.len(), request.budget.max_patch_ops)?;

        let summary = CompileSummary {
            mentions: mentions.len(),
            candidate_edges: candidates.edges.len(),
            decisions: decisions.len(),
            patch_ops: patch.ops.len(),
        };

        Ok(EvidenceCompileOutput {
            mentions,
            candidates,
            decisions,
            patch,
            summary,
        })
    }

    #[inline]
    fn check_budget(
        &self,
        stage: &'static str,
        count: usize,
        max: usize,
    ) -> Result<(), EvidenceGraphError> {
        if self.config.strict_budget && count > max {
            return Err(EvidenceGraphError::BudgetExceeded { stage, count, max });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use compact_str::CompactString;
    use phoenix_dynamic_ner::{
        EntityLabel, LocalMentionId, MentionContext, MentionGraph, MentionKind, MentionPacket,
        MentionSemantics, MentionSourceKind, MentionStatus, MentionVote, VoteReason,
    };
    use phoenix_types::{EntityId, MentionEntityRef, ScopeKey, TextRange};
    use smallvec::smallvec;

    use super::*;
    use crate::types::{CompileStageMask, CompilerBudget, CompilerModelPolicy, EvidencePatchOp};

    fn request(stages: CompileStageMask) -> CompileRequest {
        CompileRequest {
            scope: ScopeKey::default(),
            document_id: CompactString::from("doc"),
            source_fingerprint: 7,
            stages,
            budget: CompilerBudget {
                max_mentions: 64,
                max_candidate_edges: 128,
                max_patch_ops: 64,
                model_policy: CompilerModelPolicy::Never,
            },
        }
    }

    fn mention(
        id: u64,
        surface: &str,
        entity_ref: Option<MentionEntityRef>,
        status: MentionStatus,
    ) -> MentionPacket {
        MentionPacket {
            mention_id: LocalMentionId(id),
            document_id: CompactString::from("doc"),
            chunk_id: None,
            sentence_index: 0,
            range: TextRange {
                start: id as u32 * 10,
                end: id as u32 * 10 + surface.len() as u32,
            },
            surface: CompactString::from(surface),
            normalized: CompactString::from(surface.to_ascii_lowercase()),
            mention_kind: MentionKind::Named,
            label_distribution: smallvec![(EntityLabel::new("Character"), 0.91)],
            entity_ref,
            source_votes: smallvec![MentionVote {
                source: MentionSourceKind::KnownLexicon,
                label: Some(EntityLabel::new("Character")),
                entity_ref: None,
                confidence: 0.91,
                reason: VoteReason::ExactCanonical,
            }],
            context: MentionContext::default(),
            syntax: None,
            semantics: MentionSemantics::default(),
            confidence: 0.91,
            status,
        }
    }

    #[test]
    fn compiler_links_known_and_proposes_new() {
        let mentions = vec![
            mention(
                0,
                "Aella",
                Some(MentionEntityRef::Known(EntityId::from("entity:aella"))),
                MentionStatus::AcceptedKnown,
            ),
            mention(
                1,
                "Kamaria",
                Some(MentionEntityRef::Speculative("kamaria".to_owned())),
                MentionStatus::AcceptedNew,
            ),
        ];

        let output = EvidenceGraphCompiler::default()
            .compile_mentions(
                &request(CompileStageMask::ALL),
                mentions,
                MentionGraph::default(),
            )
            .unwrap();

        assert_eq!(output.summary.mentions, 2);
        assert_eq!(output.summary.decisions, 2);
        assert!(output
            .patch
            .ops
            .iter()
            .any(|op| matches!(op, EvidencePatchOp::LinkMentionToEntity { .. })));
        assert!(output
            .patch
            .ops
            .iter()
            .any(|op| matches!(op, EvidencePatchOp::ProposeEntity { .. })));
    }

    #[test]
    fn stage_mask_can_stop_before_fusion() {
        let output = EvidenceGraphCompiler::default()
            .compile_mentions(
                &request(CompileStageMask::EVIDENCE_ONLY),
                vec![mention(
                    0,
                    "Aella",
                    Some(MentionEntityRef::Known(EntityId::from("entity:aella"))),
                    MentionStatus::AcceptedKnown,
                )],
                MentionGraph::default(),
            )
            .unwrap();

        assert_eq!(output.summary.candidate_edges, 1);
        assert_eq!(output.summary.decisions, 0);
        assert_eq!(output.summary.patch_ops, 0);
    }

    #[test]
    fn strict_budget_rejects_oversized_mention_set() {
        let compiler = EvidenceGraphCompiler::new(EvidenceGraphCompilerConfig {
            strict_budget: true,
        });
        let mut req = request(CompileStageMask::ALL);
        req.budget.max_mentions = 0;

        let err = compiler
            .compile_mentions(
                &req,
                vec![mention(0, "Aella", None, MentionStatus::NeedsAdjudication)],
                MentionGraph::default(),
            )
            .unwrap_err();

        assert!(matches!(err, EvidenceGraphError::BudgetExceeded { .. }));
    }
}
