use rustc_hash::FxHashMap;

use crate::types::{
    CandidateDecision, CandidateEdge, CandidateGraph, CandidateTarget, EvidenceStatus,
};

pub struct FusionGate;

impl FusionGate {
    pub fn decide(graph: &CandidateGraph) -> Vec<CandidateDecision> {
        let mut best = FxHashMap::<_, &CandidateEdge>::default();
        for edge in &graph.edges {
            best.entry(edge.mention_id)
                .and_modify(|current| {
                    if edge.confidence > current.confidence {
                        *current = edge;
                    }
                })
                .or_insert(edge);
        }

        let mut decisions = Vec::with_capacity(best.len());
        for edge in best.into_values() {
            decisions.push(CandidateDecision {
                mention_id: edge.mention_id,
                status: status_for(edge),
                target: edge.target.clone(),
                confidence: edge.confidence,
            });
        }
        decisions.sort_by_key(|d| d.mention_id);
        decisions
    }
}

fn status_for(edge: &CandidateEdge) -> EvidenceStatus {
    match &edge.target {
        CandidateTarget::KnownEntity(_) if edge.confidence >= 0.80 => EvidenceStatus::LinkKnown,
        CandidateTarget::AliasOf(_) if edge.confidence >= 0.86 => EvidenceStatus::ConfirmAlias,
        CandidateTarget::NewEntity { .. } if edge.confidence >= 0.72 => EvidenceStatus::ProposeNew,
        CandidateTarget::DeferredReview => EvidenceStatus::NeedsReview,
        _ => EvidenceStatus::NeedsReview,
    }
}
