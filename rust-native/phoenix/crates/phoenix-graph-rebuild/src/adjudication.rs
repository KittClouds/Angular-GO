use compact_str::{format_compact, CompactString};

use crate::types::{GraphEdge, GraphRelationship};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RelationshipAdjudicationCounts {
    pub accepted: usize,
    pub review: usize,
    pub rejected: usize,
}

pub fn adjudicate_cooccurrence_edges(
    edges: &[GraphEdge],
) -> (Vec<GraphRelationship>, RelationshipAdjudicationCounts) {
    let mut counts = RelationshipAdjudicationCounts::default();
    let relationships = edges
        .iter()
        .map(|edge| {
            let decision = decide_edge(edge);
            match decision.status.as_str() {
                "accepted" => counts.accepted += 1,
                "review" => counts.review += 1,
                _ => counts.rejected += 1,
            }
            GraphRelationship {
                id: format_compact!("relationship:{}", edge.id),
                source_entity_id: edge.source_id.clone(),
                target_entity_id: edge.target_id.clone(),
                relation_type: "co_occurs_with".into(),
                evidence_anchor_ids: edge.evidence_anchor_ids.clone(),
                confidence: decision.score,
                status: decision.status,
                adjudication_source: "graph-rebuild-cooccurrence-policy".into(),
                adjudication_score: decision.score,
                rationale: decision.rationale,
                decision_evidence: decision.evidence,
            }
        })
        .collect();
    (relationships, counts)
}

struct RelationshipDecision {
    status: CompactString,
    score: f32,
    rationale: CompactString,
    evidence: Vec<CompactString>,
}

fn decide_edge(edge: &GraphEdge) -> RelationshipDecision {
    let score = relationship_score(edge);
    let evidence_count = edge.evidence_anchor_ids.len();
    let scope_count = edge.scope_keys.len();
    let status = if evidence_count >= 2 && scope_count >= 1 {
        "review"
    } else {
        "rejected"
    };
    let rationale = match status {
        "review" => format_compact!(
            "review: anchor evidence across {} bucket(s) with {} anchor evidence refs; needs typed relation/NLI confirmation before fact promotion",
            scope_count,
            evidence_count
        ),
        _ => format_compact!("rejected: insufficient anchor evidence for a relationship signal"),
    };
    let evidence = vec![
        format_compact!("weight:{}", edge.weight),
        format_compact!("scope_count:{}", scope_count),
        format_compact!("anchor_evidence_count:{}", evidence_count),
    ];
    RelationshipDecision {
        status: status.into(),
        score,
        rationale,
        evidence,
    }
}

fn relationship_score(edge: &GraphEdge) -> f32 {
    let weight_score = (edge.weight as f32 / 5.0).min(0.65);
    let evidence_score = (edge.evidence_anchor_ids.len() as f32 / 24.0).min(0.25);
    let scope_score = (edge.scope_keys.len() as f32 / 12.0).min(0.10);
    (weight_score + evidence_score + scope_score).min(1.0)
}
