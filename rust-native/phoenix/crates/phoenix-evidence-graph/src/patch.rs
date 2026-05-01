use compact_str::CompactString;

use crate::types::{
    CandidateDecision, CandidateTarget, EvidenceGraphPatch, EvidencePatchOp, EvidenceStatus,
};

pub struct OverGraphPatchBuilder;

impl OverGraphPatchBuilder {
    pub fn build(decisions: &[CandidateDecision], max_ops: usize) -> EvidenceGraphPatch {
        let mut ops = Vec::with_capacity(decisions.len().min(max_ops));
        for decision in decisions {
            if ops.len() >= max_ops {
                break;
            }
            match (&decision.status, &decision.target) {
                (EvidenceStatus::LinkKnown, CandidateTarget::KnownEntity(entity_id)) => {
                    ops.push(EvidencePatchOp::LinkMentionToEntity {
                        mention_id: decision.mention_id,
                        entity_id: entity_id.clone(),
                        confidence: decision.confidence,
                    });
                }
                (EvidenceStatus::ProposeNew, CandidateTarget::NewEntity { normalized }) => {
                    ops.push(EvidencePatchOp::ProposeEntity {
                        mention_id: decision.mention_id,
                        normalized: normalized.clone(),
                        label: normalized.clone(),
                        confidence: decision.confidence,
                    });
                }
                _ => ops.push(EvidencePatchOp::QueueReview {
                    mention_id: decision.mention_id,
                    reason: CompactString::from("fusion_deferred"),
                }),
            }
        }
        EvidenceGraphPatch { ops }
    }
}
