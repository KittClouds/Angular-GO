use compact_str::{format_compact, CompactString};
use hashbrown::HashSet;
use phoenix_alex::{SurfaceHit, SurfaceHitKind};
use phoenix_chunker::{LensChunk, LensKind, LensMentionEdgeKind, LensMentionGraph};
use phoenix_types::TextRange;

use super::ids::mention_evidence_id;
use super::types::{
    EvidenceAnchor, EvidenceKind, FactLane, FactRole, GraphCompilerOutput, ProjectedGraphEdge,
    RelationFact,
};

pub(super) fn prepared_artifacts(
    output: &mut GraphCompilerOutput,
    evidence_seen: &mut HashSet<CompactString>,
    note_id: Option<CompactString>,
    surface_hits: &[SurfaceHit],
    mention_graph: Option<&LensMentionGraph>,
    lens_frames: &[LensChunk],
) {
    for hit in surface_hits {
        surface_hit_evidence(output, evidence_seen, note_id.clone(), hit);
    }
    for frame in lens_frames {
        lens_frame_evidence(output, evidence_seen, note_id.clone(), frame);
    }
    if let Some(graph) = mention_graph {
        mention_graph_facts(output, evidence_seen, graph);
    }
}

fn surface_hit_evidence(
    output: &mut GraphCompilerOutput,
    evidence_seen: &mut HashSet<CompactString>,
    note_id: Option<CompactString>,
    hit: &SurfaceHit,
) {
    let source_id = surface_hit_source_id(hit);
    push_evidence(
        output,
        evidence_seen,
        format_compact!("evidence:{}", source_id),
        if hit.kind == SurfaceHitKind::EntityAlias {
            EvidenceKind::SurfaceHit
        } else {
            EvidenceKind::CueHit
        },
        note_id,
        None,
        source_id,
        Some(hit.source_range),
        hit.confidence,
    );
}

fn lens_frame_evidence(
    output: &mut GraphCompilerOutput,
    evidence_seen: &mut HashSet<CompactString>,
    note_id: Option<CompactString>,
    frame: &LensChunk,
) {
    push_evidence(
        output,
        evidence_seen,
        lens_frame_evidence_id(&frame.id),
        EvidenceKind::LensFrame,
        note_id,
        None,
        frame.id.as_str().into(),
        Some(TextRange {
            start: frame.start as u32,
            end: frame.end as u32,
        }),
        lens_confidence(frame.lens),
    );
}

fn mention_graph_facts(
    output: &mut GraphCompilerOutput,
    evidence_seen: &mut HashSet<CompactString>,
    graph: &LensMentionGraph,
) {
    for (index, edge) in graph.edges.iter().enumerate() {
        let source_id = format_compact!(
            "mention-graph:{}:{}:{}:{:?}",
            index,
            edge.left,
            edge.right,
            edge.kind
        );
        let evidence_id = format_compact!("evidence:{}", source_id);
        push_evidence(
            output,
            evidence_seen,
            evidence_id.clone(),
            EvidenceKind::MentionGraphEdge,
            None,
            None,
            source_id.clone(),
            None,
            edge.weight,
        );

        let fact_id = format_compact!("fact:{}", source_id);
        output.facts.push(RelationFact {
            id: fact_id.clone(),
            lane: mention_edge_lane(edge.kind),
            predicate: format_compact!("{:?}", edge.kind),
            source_record_id: source_id,
            status: "prepared".into(),
            evidence_ids: vec![evidence_id.clone()],
            confidence: edge.weight,
        });

        let left_evidence = ensure_mention_evidence(output, evidence_seen, edge.left);
        let right_evidence = ensure_mention_evidence(output, evidence_seen, edge.right);
        output.roles.push(FactRole {
            fact_id: fact_id.clone(),
            role: "leftMention".into(),
            atom_id: left_evidence.clone(),
            confidence: edge.weight,
        });
        output.roles.push(FactRole {
            fact_id: fact_id.clone(),
            role: "rightMention".into(),
            atom_id: right_evidence.clone(),
            confidence: edge.weight,
        });
        output.roles.push(FactRole {
            fact_id: fact_id.clone(),
            role: "evidence".into(),
            atom_id: evidence_id,
            confidence: edge.weight,
        });
        output.projected_edges.push(ProjectedGraphEdge {
            id: format_compact!("projection:{}", fact_id),
            source_id: left_evidence,
            target_id: right_evidence,
            edge_type: format_compact!("{:?}", edge.kind),
            projection_kind: "mentionGraph".into(),
            source_fact_id: Some(fact_id),
            source_bundle_id: None,
            confidence: edge.weight,
        });
    }
}

fn ensure_mention_evidence(
    output: &mut GraphCompilerOutput,
    evidence_seen: &mut HashSet<CompactString>,
    mention_id: u64,
) -> CompactString {
    let source_id = CompactString::from(mention_id.to_string());
    let evidence_id = mention_evidence_id(&source_id);
    push_evidence(
        output,
        evidence_seen,
        evidence_id.clone(),
        EvidenceKind::MentionPacket,
        None,
        None,
        source_id,
        None,
        0.62,
    );
    evidence_id
}

fn push_evidence(
    output: &mut GraphCompilerOutput,
    evidence_seen: &mut HashSet<CompactString>,
    id: CompactString,
    kind: EvidenceKind,
    note_id: Option<CompactString>,
    chunk_id: Option<CompactString>,
    source_id: CompactString,
    source_range: Option<TextRange>,
    confidence: f32,
) {
    if !evidence_seen.insert(id.clone()) {
        return;
    }
    output.evidence_anchors.push(EvidenceAnchor {
        id,
        kind,
        note_id,
        chunk_id,
        source_range,
        source_id,
        confidence,
    });
}

fn surface_hit_source_id(hit: &SurfaceHit) -> CompactString {
    format_compact!(
        "surface-hit:{}:{}:{}-{}",
        hit.snapshot_id.0,
        hit.pattern_id.0,
        hit.source_range.start,
        hit.source_range.end
    )
}

fn lens_frame_evidence_id(id: &str) -> CompactString {
    format_compact!("evidence:lens-frame:{}", id)
}

fn mention_edge_lane(kind: LensMentionEdgeKind) -> FactLane {
    match kind {
        LensMentionEdgeKind::SameNormalizedSurface | LensMentionEdgeKind::NearbyRepetition => {
            FactLane::CooccurrenceWeak
        }
        _ => FactLane::RelationshipFact,
    }
}

fn lens_confidence(lens: LensKind) -> f32 {
    match lens {
        LensKind::Entity => 0.86,
        LensKind::Relationship => 0.84,
        LensKind::Event => 0.82,
        LensKind::Temporal | LensKind::Causal => 0.8,
        LensKind::Attribute | LensKind::Worldbuilding | LensKind::Evidence => 0.78,
    }
}
