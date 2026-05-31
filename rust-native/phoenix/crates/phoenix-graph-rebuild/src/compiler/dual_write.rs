use phoenix_types::EntityId;
use serde::{Deserialize, Serialize};

use super::{compile_legacy_snapshot, GraphCompileReceipts, GraphCompilerOutput};
use crate::types::{GraphEdge, GraphRebuildSnapshot};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GraphCompilerDualWrite {
    pub legacy_snapshot: GraphRebuildSnapshot,
    pub fact_graph: GraphCompilerOutput,
    pub projected_ui_graph: Vec<GraphEdge>,
    pub receipts: GraphCompileReceipts,
}

pub fn compile_dual_write_snapshot(snapshot: &GraphRebuildSnapshot) -> GraphCompilerDualWrite {
    let fact_graph = compile_legacy_snapshot(snapshot);
    let projected_ui_graph = project_ui_edges(&fact_graph);
    GraphCompilerDualWrite {
        legacy_snapshot: snapshot.clone(),
        receipts: fact_graph.receipts.clone(),
        fact_graph,
        projected_ui_graph,
    }
}

pub fn project_ui_edges(output: &GraphCompilerOutput) -> Vec<GraphEdge> {
    output
        .projected_edges
        .iter()
        .filter_map(|edge| {
            let source_id = entity_id_from_atom(edge.source_id.as_str())?;
            let target_id = entity_id_from_atom(edge.target_id.as_str())?;
            Some(GraphEdge {
                id: edge.id.clone(),
                source_id,
                target_id,
                edge_type: edge.edge_type.clone(),
                weight: (edge.confidence.clamp(0.0, 1.0) * 1000.0) as u32,
                confidence: edge.confidence,
                evidence_anchor_ids: edge
                    .source_fact_id
                    .iter()
                    .chain(edge.source_bundle_id.iter())
                    .cloned()
                    .collect(),
                scope_keys: Vec::new(),
                note_ids: Vec::new(),
            })
        })
        .collect()
}

fn entity_id_from_atom(atom_id: &str) -> Option<EntityId> {
    atom_id
        .strip_prefix("atom:entity:")
        .map(|id| EntityId(id.to_owned()))
}
