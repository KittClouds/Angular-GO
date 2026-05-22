use phoenix_types::{EntityId, EntityKind, LexiconEntry, ScopeKey};

use crate::{build_graph_rebuild_snapshot, GraphRebuildInput, GraphScopeKind};

#[test]
fn builds_chunks_anchors_edges_and_embedding_targets() {
    let text = "Kai watched Hazel. Hazel answered Kai. Rift watched Kai.";
    let entities = vec![
        entry("e-kai", "Kai", &["Captain Kai"]),
        entry("e-hazel", "Hazel", &[]),
        entry("e-rift", "Rift", &[]),
    ];
    let snapshot = build_graph_rebuild_snapshot(GraphRebuildInput {
        scope_kind: GraphScopeKind::Note,
        scope_id: "note:one",
        note_id: "note-1",
        text,
        scope: ScopeKey::default(),
        entities: &entities,
        candidate_count: 3,
        built_at: Some(10),
    })
    .expect("snapshot");

    assert_eq!(snapshot.schema_version, "phoenix-graph-rebuild/v1");
    assert!(!snapshot.chunks.is_empty());
    assert_eq!(snapshot.counters.accepted_anchors, 6);
    assert_eq!(snapshot.counters.nodes, 3);
    assert_eq!(snapshot.counters.edges, 3);
    assert_eq!(snapshot.counters.relationship_candidates, 3);
    assert_eq!(snapshot.counters.relationships, 3);
    assert_eq!(
        snapshot.counters.accepted_relationships + snapshot.counters.review_relationships,
        3
    );
    assert!(snapshot.relationships.iter().all(
        |relationship| relationship.adjudication_source == "graph-rebuild-cooccurrence-policy"
    ));
    assert!(snapshot.counters.embedding_targets >= snapshot.counters.chunks + 6 + 3);
}

#[test]
fn reports_empty_reasons_without_inventing_nodes() {
    let text = "No known names here.";
    let entities = vec![entry("e-kai", "Kai", &[])];
    let snapshot = build_graph_rebuild_snapshot(GraphRebuildInput {
        scope_kind: GraphScopeKind::Note,
        scope_id: "note:empty",
        note_id: "note-1",
        text,
        scope: ScopeKey::default(),
        entities: &entities,
        candidate_count: 0,
        built_at: Some(11),
    })
    .expect("snapshot");

    assert_eq!(snapshot.counters.accepted_anchors, 0);
    assert_eq!(snapshot.counters.nodes, 0);
    assert_eq!(snapshot.counters.edges, 0);
}

fn entry(id: &str, label: &str, aliases: &[&str]) -> LexiconEntry {
    LexiconEntry {
        entity_id: EntityId(id.to_owned()),
        label: label.to_owned(),
        aliases: aliases.iter().map(|alias| (*alias).to_owned()).collect(),
        kind: Some(EntityKind::Character),
        scope: ScopeKey::default(),
        ..LexiconEntry::default()
    }
}
