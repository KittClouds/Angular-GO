use compact_str::{format_compact, CompactString};
use phoenix_types::EntityId;

use super::types::FactLane;
use crate::types::GraphRelationship;

pub(super) fn relationship_lane(relationship: &GraphRelationship) -> FactLane {
    if relationship.relation_type.contains("co_occurs")
        || relationship.relation_type.contains("co-occurs")
    {
        FactLane::CooccurrenceWeak
    } else {
        FactLane::RelationshipFact
    }
}

pub(super) fn atom_id(kind: &str, source_id: &CompactString) -> CompactString {
    format_compact!("atom:{}:{}", kind, source_id)
}

pub(super) fn entity_atom_id(entity_id: &EntityId) -> CompactString {
    format_compact!("atom:entity:{}", entity_id.0)
}

pub(super) fn anchor_evidence_id(source_id: &CompactString) -> CompactString {
    format_compact!("evidence:anchor:{}", source_id)
}

pub(super) fn mention_evidence_id(source_id: &CompactString) -> CompactString {
    format_compact!("evidence:mention:{}", source_id)
}

pub(super) fn event_evidence_id(source_id: &CompactString) -> CompactString {
    format_compact!("evidence:event:{}", source_id)
}

pub(super) fn relationship_edge_key(relationship: &GraphRelationship) -> CompactString {
    edge_key(
        &relationship.source_entity_id,
        &relationship.target_entity_id,
        &relationship.relation_type,
    )
}

pub(super) fn legacy_relation_key(relationship: &GraphRelationship) -> CompactString {
    let edge_type = if relationship.relation_type == "co_occurs_with" {
        CompactString::from("anchored-cooccurrence")
    } else {
        relationship.relation_type.clone()
    };
    edge_key(
        &relationship.source_entity_id,
        &relationship.target_entity_id,
        &edge_type,
    )
}

pub(super) fn edge_key(
    left: &EntityId,
    right: &EntityId,
    edge_type: &CompactString,
) -> CompactString {
    let (source, target) = if left <= right {
        (left, right)
    } else {
        (right, left)
    };
    format_compact!("{}:{}:{}", source.0, edge_type, target.0)
}
