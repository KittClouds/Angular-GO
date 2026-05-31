use compact_str::{format_compact, CompactString};
use hashbrown::HashMap;

use super::ids::{edge_key, entity_atom_id};
use super::types::{GraphCompilerOutput, ProjectedGraphEdge};
use crate::types::GraphEdge;

#[derive(Clone, Debug, Default)]
pub(super) struct ProjectionProvenance {
    pub fact_id: Option<CompactString>,
    pub bundle_id: Option<CompactString>,
}

pub(super) fn legacy_projections(
    output: &mut GraphCompilerOutput,
    edges: &[GraphEdge],
    by_edge: &HashMap<CompactString, ProjectionProvenance>,
) {
    for edge in edges {
        let provenance = by_edge
            .get(&edge_key(&edge.source_id, &edge.target_id, &edge.edge_type))
            .cloned()
            .unwrap_or_default();
        output.projected_edges.push(ProjectedGraphEdge {
            id: format_compact!("projection:legacy:{}", edge.id),
            source_id: entity_atom_id(&edge.source_id),
            target_id: entity_atom_id(&edge.target_id),
            edge_type: edge.edge_type.clone(),
            projection_kind: "legacyBinary".into(),
            source_fact_id: provenance.fact_id,
            source_bundle_id: provenance.bundle_id,
            confidence: edge.confidence,
        });
    }
}
