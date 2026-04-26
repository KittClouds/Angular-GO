use hashbrown::HashSet;
use phoenix_semantic_v2::{
    GraphScopeSidecar, SemanticCandidateFamilyThreshold, SemanticCandidateLifecyclePolicy,
    SemanticCandidateStatus, SemanticEdgeFamily, SemanticGraphEdgeCandidate,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SemanticCandidateLifecycleStats {
    pub expired_count: usize,
    pub rejected_count: usize,
    pub superseded_asserted_count: usize,
}

#[derive(Default)]
struct AssertedGraphEdgeIndex {
    direct_pairs: HashSet<(String, String)>,
    event_entity_pairs: HashSet<(String, String)>,
    state_entity_pairs: HashSet<(String, String)>,
}

impl AssertedGraphEdgeIndex {
    fn from_sidecar(sidecar: Option<&GraphScopeSidecar>) -> Self {
        let mut index = Self::default();
        let Some(sidecar) = sidecar else {
            return index;
        };
        for edge in &sidecar.graph_batch.edges {
            let source = edge.source_id.0.clone();
            let target = edge.target_id.0.clone();
            index
                .direct_pairs
                .insert(normalized_pair(source.clone(), target.clone()));
            match edge.edge_type.0.as_str() {
                "subject" | "object" => {
                    index.event_entity_pairs.insert((source, target));
                }
                "state_of" => {
                    index.state_entity_pairs.insert((source, target));
                }
                _ => {}
            }
        }
        index
    }

    fn has_direct_pair(&self, left: &str, right: &str) -> bool {
        self.direct_pairs
            .contains(&normalized_pair(left.to_owned(), right.to_owned()))
    }
}

pub(crate) fn default_candidate_lifecycle_policy(
    min_score_millis: u32,
) -> SemanticCandidateLifecyclePolicy {
    fn threshold(
        family: SemanticEdgeFamily,
        min_score_millis: u32,
    ) -> SemanticCandidateFamilyThreshold {
        SemanticCandidateFamilyThreshold {
            family,
            min_score_millis,
        }
    }

    SemanticCandidateLifecyclePolicy {
        generated_min_score_millis: min_score_millis,
        deferred_min_score_millis: min_score_millis.saturating_add(80).min(1000),
        family_thresholds: vec![
            threshold(
                SemanticEdgeFamily::ContradictorySupportRegion,
                min_score_millis.saturating_add(140).min(1000),
            ),
            threshold(
                SemanticEdgeFamily::MissingIntermediateCause,
                min_score_millis.saturating_add(90).min(1000),
            ),
            threshold(
                SemanticEdgeFamily::ClaimContradiction,
                min_score_millis.saturating_add(80).min(1000),
            ),
            threshold(
                SemanticEdgeFamily::StateContradiction,
                min_score_millis.saturating_add(80).min(1000),
            ),
            threshold(
                SemanticEdgeFamily::EntityStateSupport,
                min_score_millis.saturating_add(70).min(1000),
            ),
            threshold(
                SemanticEdgeFamily::EntityEventSupport,
                min_score_millis.saturating_add(70).min(1000),
            ),
            threshold(
                SemanticEdgeFamily::ClaimSupport,
                min_score_millis.saturating_add(40).min(1000),
            ),
            threshold(
                SemanticEdgeFamily::StateSupport,
                min_score_millis.saturating_add(40).min(1000),
            ),
            threshold(
                SemanticEdgeFamily::EventNeighbor,
                min_score_millis.saturating_add(30).min(1000),
            ),
        ],
    }
}

pub(crate) fn retain_live_candidates(
    mut candidates: Vec<SemanticGraphEdgeCandidate>,
    graph_sidecar: Option<&GraphScopeSidecar>,
    policy: &SemanticCandidateLifecyclePolicy,
) -> (
    Vec<SemanticGraphEdgeCandidate>,
    SemanticCandidateLifecycleStats,
) {
    let asserted_index = AssertedGraphEdgeIndex::from_sidecar(graph_sidecar);
    let mut stats = SemanticCandidateLifecycleStats::default();
    candidates.retain(|candidate| {
        if candidate.candidate_status == SemanticCandidateStatus::Rejected {
            stats.rejected_count += 1;
            return false;
        }
        if is_superseded_by_asserted_graph(candidate, &asserted_index) {
            stats.superseded_asserted_count += 1;
            return false;
        }
        if let Some(min_score_millis) = min_score_for_candidate(candidate, policy) {
            if candidate.score_millis < min_score_millis {
                stats.expired_count += 1;
                return false;
            }
        }
        true
    });
    (candidates, stats)
}

fn min_score_for_candidate(
    candidate: &SemanticGraphEdgeCandidate,
    policy: &SemanticCandidateLifecyclePolicy,
) -> Option<u32> {
    let family_min = policy
        .family_thresholds
        .iter()
        .find(|row| row.family == candidate.family)
        .map(|row| row.min_score_millis)
        .unwrap_or(policy.generated_min_score_millis);
    match candidate.candidate_status {
        SemanticCandidateStatus::Generated => {
            Some(family_min.max(policy.generated_min_score_millis))
        }
        SemanticCandidateStatus::Deferred => Some(family_min.max(policy.deferred_min_score_millis)),
        SemanticCandidateStatus::ReviewedSupport
        | SemanticCandidateStatus::ReviewedContradiction
        | SemanticCandidateStatus::Rejected => None,
    }
}

fn is_superseded_by_asserted_graph(
    candidate: &SemanticGraphEdgeCandidate,
    asserted_index: &AssertedGraphEdgeIndex,
) -> bool {
    match candidate.family {
        SemanticEdgeFamily::EntityStateSupport => asserted_index.state_entity_pairs.contains(&(
            candidate.target_node_id.clone(),
            candidate.source_node_id.clone(),
        )),
        SemanticEdgeFamily::EntityEventSupport => asserted_index.event_entity_pairs.contains(&(
            candidate.target_node_id.clone(),
            candidate.source_node_id.clone(),
        )),
        SemanticEdgeFamily::SameProcess
        | SemanticEdgeFamily::RelatedEvent
        | SemanticEdgeFamily::EventNeighbor
        | SemanticEdgeFamily::EntityRoleNeighbor => asserted_index.has_direct_pair(
            candidate.source_node_id.as_str(),
            candidate.target_node_id.as_str(),
        ),
        SemanticEdgeFamily::ChunkNeighbor
        | SemanticEdgeFamily::ClaimSupport
        | SemanticEdgeFamily::ClaimContradiction
        | SemanticEdgeFamily::StateSupport
        | SemanticEdgeFamily::StateContradiction
        | SemanticEdgeFamily::ContradictorySupportRegion
        | SemanticEdgeFamily::SameSlotFamily
        | SemanticEdgeFamily::MissingIntermediateCause
        | SemanticEdgeFamily::Unknown => false,
    }
}

fn normalized_pair(left: String, right: String) -> (String, String) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}
