use phoenix_dynamic_ner::{
    MentionEdgeKind, MentionGraph, MentionPacket, MentionStatus, MentionVote,
};
use phoenix_types::MentionEntityRef;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use crate::types::{CandidateEdge, CandidateEdgeKind, CandidateGraph, CandidateTarget};

#[derive(Default)]
pub struct CandidateIndex {
    by_normalized: FxHashMap<String, SmallVec<[usize; 8]>>,
}

pub struct CandidateGraphBuilder;

impl CandidateGraphBuilder {
    pub fn build(
        mentions: &[MentionPacket],
        graph: &MentionGraph,
        max_edges: usize,
    ) -> CandidateGraph {
        let mut edges = Vec::with_capacity(mentions.len().min(max_edges));
        let mut index = CandidateIndex::default();

        for (ix, mention) in mentions.iter().enumerate() {
            index
                .by_normalized
                .entry(mention.normalized.to_string())
                .or_default()
                .push(ix);
            if edges.len() < max_edges {
                push_primary_edge(&mut edges, mention);
            }
        }

        if edges.len() < max_edges {
            push_cluster_edges(&mut edges, mentions, &index, max_edges);
        }
        if edges.len() < max_edges {
            push_graph_support_edges(&mut edges, mentions, graph, max_edges);
        }

        CandidateGraph { edges }
    }
}

fn push_primary_edge(edges: &mut Vec<CandidateEdge>, mention: &MentionPacket) {
    let evidence = SmallVec::from_buf([mention.range, mention.range]);
    match mention.entity_ref.as_ref() {
        Some(MentionEntityRef::Known(entity_id)) => edges.push(CandidateEdge {
            mention_id: mention.mention_id,
            target: CandidateTarget::KnownEntity(entity_id.clone()),
            kind: strongest_known_kind(&mention.source_votes),
            confidence: mention.confidence.max(0.90),
            evidence,
        }),
        Some(MentionEntityRef::Speculative(value)) => edges.push(CandidateEdge {
            mention_id: mention.mention_id,
            target: CandidateTarget::NewEntity {
                normalized: value.as_str().into(),
            },
            kind: CandidateEdgeKind::SameSurfaceCluster,
            confidence: mention.confidence,
            evidence,
        }),
        None if mention.status == MentionStatus::Rejected => {}
        None => edges.push(CandidateEdge {
            mention_id: mention.mention_id,
            target: CandidateTarget::DeferredReview,
            kind: CandidateEdgeKind::ReviewOnly,
            confidence: mention.confidence,
            evidence,
        }),
    }
}

fn strongest_known_kind(votes: &[MentionVote]) -> CandidateEdgeKind {
    if votes
        .iter()
        .any(|v| matches!(v.reason, phoenix_dynamic_ner::VoteReason::ExactCanonical))
    {
        CandidateEdgeKind::KnownExact
    } else {
        CandidateEdgeKind::KnownAlias
    }
}

fn push_cluster_edges(
    edges: &mut Vec<CandidateEdge>,
    mentions: &[MentionPacket],
    index: &CandidateIndex,
    max_edges: usize,
) {
    for (normalized, mention_indexes) in &index.by_normalized {
        if mention_indexes.len() < 2 {
            continue;
        }
        let support = (mention_indexes.len() as f32).min(8.0) / 8.0;
        for &ix in mention_indexes {
            if edges.len() >= max_edges {
                return;
            }
            let mention = &mentions[ix];
            edges.push(CandidateEdge {
                mention_id: mention.mention_id,
                target: CandidateTarget::NewEntity {
                    normalized: normalized.as_str().into(),
                },
                kind: CandidateEdgeKind::SameSurfaceCluster,
                confidence: (mention.confidence + support * 0.20).min(0.95),
                evidence: SmallVec::from_buf([mention.range, mention.range]),
            });
        }
    }
}

fn push_graph_support_edges(
    edges: &mut Vec<CandidateEdge>,
    mentions: &[MentionPacket],
    graph: &MentionGraph,
    max_edges: usize,
) {
    let by_id: FxHashMap<_, _> = mentions.iter().map(|m| (m.mention_id, m)).collect();
    for edge in &graph.edges {
        if edges.len() >= max_edges {
            return;
        }
        if matches!(
            edge.kind,
            MentionEdgeKind::PronounCandidate | MentionEdgeKind::KnownAliasMatch
        ) {
            if let Some(left) = by_id.get(&edge.left) {
                if let Some(MentionEntityRef::Known(entity_id)) = left.entity_ref.as_ref() {
                    edges.push(CandidateEdge {
                        mention_id: edge.right,
                        target: CandidateTarget::KnownEntity(entity_id.clone()),
                        kind: CandidateEdgeKind::MentionGraphSupport,
                        confidence: edge.weight.min(0.80),
                        evidence: edge.evidence.clone(),
                    });
                }
            }
        }
    }
}
