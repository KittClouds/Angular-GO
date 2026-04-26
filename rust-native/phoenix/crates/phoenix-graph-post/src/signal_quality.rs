use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphSignalQualityFamily {
    Lexical,
    Semantic,
    #[default]
    Graph,
    Temporal,
    Causal,
    Structural,
    Llm,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphSignalQualityStatus {
    Accepted,
    #[default]
    Deferred,
    Rejected,
    Review,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSignalLedgerAggregate {
    pub seed_score: f64,
    pub path_confidence: f64,
    pub support_score: f64,
    pub island_confidence: f64,
    pub temporal_causal_coherence: f64,
    pub contradiction_score: f64,
    pub scope_jump_penalty: f64,
    pub staleness_penalty: f64,
}

impl GraphSignalLedgerAggregate {
    pub fn rerank_score(&self) -> f64 {
        self.seed_score
            + self.path_confidence
            + self.support_score
            + self.island_confidence
            + self.temporal_causal_coherence
            - self.contradiction_score
            - self.scope_jump_penalty
            - self.staleness_penalty
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSignalQualityEntry {
    pub candidate_id: String,
    pub source_unit_id: String,
    pub target_unit_id: String,
    pub signal_family: GraphSignalQualityFamily,
    pub support_score: f64,
    pub contradiction_score: f64,
    pub freshness: f64,
    pub scope_confidence: f64,
    pub island_confidence: f64,
    pub path_confidence: f64,
    pub rerank_score: f64,
    pub status: GraphSignalQualityStatus,
    #[serde(default)]
    pub provenance: Vec<String>,
    pub generation: u64,
}

impl GraphSignalQualityEntry {
    pub fn from_aggregate(
        candidate_id: impl Into<String>,
        source_unit_id: impl Into<String>,
        target_unit_id: impl Into<String>,
        signal_family: GraphSignalQualityFamily,
        aggregate: GraphSignalLedgerAggregate,
        provenance: Vec<String>,
        generation: u64,
    ) -> Self {
        let rerank_score = aggregate.rerank_score();
        let support_score = aggregate.support_score + aggregate.path_confidence;
        let contradiction_score = aggregate.contradiction_score
            + aggregate.scope_jump_penalty
            + aggregate.staleness_penalty;
        Self {
            candidate_id: candidate_id.into(),
            source_unit_id: source_unit_id.into(),
            target_unit_id: target_unit_id.into(),
            signal_family,
            support_score,
            contradiction_score,
            freshness: 1.0 - aggregate.staleness_penalty.clamp(0.0, 1.0),
            scope_confidence: 1.0 - aggregate.scope_jump_penalty.clamp(0.0, 1.0),
            island_confidence: aggregate.island_confidence,
            path_confidence: aggregate.path_confidence,
            rerank_score,
            status: inferred_status(support_score, contradiction_score),
            provenance,
            generation,
        }
    }
}

pub(crate) fn score_ledger(aggregate: GraphSignalLedgerAggregate) -> f64 {
    aggregate.rerank_score()
}

pub(crate) fn llm_rerank_aggregate(
    positive_score: f64,
    context_score: f64,
    negative_score: f64,
    positive_weight: f64,
    context_weight: f64,
    negative_weight: f64,
) -> GraphSignalLedgerAggregate {
    GraphSignalLedgerAggregate {
        support_score: positive_score * positive_weight,
        path_confidence: context_score * context_weight,
        contradiction_score: negative_score * negative_weight,
        ..GraphSignalLedgerAggregate::default()
    }
}

pub(crate) fn structural_delta(delta_millis: i32) -> f64 {
    score_ledger(GraphSignalLedgerAggregate {
        path_confidence: (delta_millis.max(0) as f64) / 1000.0,
        scope_jump_penalty: ((-delta_millis).max(0) as f64) / 1000.0,
        ..GraphSignalLedgerAggregate::default()
    })
}

pub(crate) fn inferred_status(
    support_score: f64,
    contradiction_score: f64,
) -> GraphSignalQualityStatus {
    if contradiction_score >= 0.72 && contradiction_score > support_score + 0.18 {
        GraphSignalQualityStatus::Rejected
    } else if contradiction_score >= 0.45 && support_score >= 0.45 {
        GraphSignalQualityStatus::Review
    } else if support_score >= 0.82 {
        GraphSignalQualityStatus::Accepted
    } else {
        GraphSignalQualityStatus::Deferred
    }
}

#[cfg(test)]
mod tests {
    use super::{llm_rerank_aggregate, score_ledger, GraphSignalLedgerAggregate};

    #[test]
    fn ledger_score_rewards_support_and_charges_debt() {
        let score = score_ledger(GraphSignalLedgerAggregate {
            seed_score: 0.5,
            path_confidence: 0.4,
            support_score: 0.8,
            island_confidence: 0.2,
            temporal_causal_coherence: 0.7,
            contradiction_score: 0.3,
            scope_jump_penalty: 0.1,
            staleness_penalty: 0.05,
        });
        assert!((score - 2.15).abs() < 1e-12);
    }

    #[test]
    fn llm_delta_is_ledger_math_with_bounds() {
        let positive =
            score_ledger(llm_rerank_aggregate(1.0, 0.5, 0.0, 0.6, 0.2, 0.7)).clamp(-0.5, 0.65);
        let negative =
            score_ledger(llm_rerank_aggregate(0.0, 0.0, 1.0, 0.6, 0.2, 0.7)).clamp(-0.5, 0.65);
        assert_eq!(positive, 0.65);
        assert_eq!(negative, -0.5);
    }
}
