use std::collections::BTreeMap;

use phoenix_types::{EntityId, EntityKind, LexiconEntry, ScopeKey};
use serde::Deserialize;

use crate::{build_graph_rebuild_snapshot, GraphRebuildInput, GraphScopeKind};

const PARITY_FIXTURE: &str =
    include_str!("../../../../../src/app/graph-rebuild/fixtures/graph-rebuild-parity-smoke.json");

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
    assert_eq!(
        snapshot
            .edges
            .iter()
            .filter(|edge| edge.edge_type == "anchored-cooccurrence")
            .count(),
        3
    );
    assert!(snapshot.counters.edges >= 3);
    assert!(snapshot.counters.relationship_candidates >= 3);
    assert!(snapshot.counters.relationships >= 3);
    assert_eq!(
        snapshot.counters.accepted_relationships + snapshot.counters.review_relationships,
        snapshot.counters.relationships
    );
    assert!(snapshot.relationships.iter().any(
        |relationship| relationship.adjudication_source == "graph-rebuild-cooccurrence-policy"
    ));
    assert!(snapshot
        .relationships
        .iter()
        .any(|relationship| relationship.adjudication_source == "graph-rebuild-typed-cue-policy"));
    assert!(!snapshot.events.is_empty());
    assert!(snapshot.counters.embedding_targets >= snapshot.counters.chunks + 6 + 3);
}

#[test]
fn emits_memory_state_and_graph_fact_targets() {
    let text =
        "Tempest stood as Diamond. Kai approved the packet with Tempest because Nemo warned Kai.";
    let entities = vec![
        entry("e-kai", "Kai", &[]),
        entry("e-tempest", "Tempest", &[]),
        entry("e-nemo", "Nemo", &[]),
    ];
    let snapshot = build_graph_rebuild_snapshot(GraphRebuildInput {
        scope_kind: GraphScopeKind::Note,
        scope_id: "note:facts",
        note_id: "note-2",
        text,
        scope: ScopeKey::default(),
        entities: &entities,
        candidate_count: 3,
        built_at: Some(12),
    })
    .expect("snapshot");

    assert!(snapshot.counters.events > 0);
    assert!(snapshot.counters.memory_state > 0);
    assert!(snapshot
        .relationships
        .iter()
        .any(|relationship| relationship.relation_type == "approves_or_accepts"));
    assert!(snapshot
        .embedding_targets
        .iter()
        .any(|target| target.kind == "memoryState"));
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

#[test]
fn matches_shared_frontend_structural_parity_fixture() {
    let fixture: ParityFixture = serde_json::from_str(PARITY_FIXTURE).expect("parity fixture json");
    let entities = fixture
        .entities
        .iter()
        .map(entry_from_fixture)
        .collect::<Vec<_>>();
    let snapshot = build_graph_rebuild_snapshot(GraphRebuildInput {
        scope_kind: fixture.scope_kind,
        scope_id: &fixture.scope_id,
        note_id: &fixture.note_id,
        text: &fixture.text,
        scope: ScopeKey::default(),
        entities: &entities,
        candidate_count: 0,
        built_at: Some(fixture.built_at),
    })
    .expect("snapshot");

    assert_eq!(structural_digest(&snapshot), fixture.expected);
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

fn entry_from_fixture(entity: &FixtureEntity) -> LexiconEntry {
    LexiconEntry {
        entity_id: EntityId(entity.id.clone()),
        label: entity.label.clone(),
        aliases: entity.aliases.clone(),
        kind: Some(parse_kind(&entity.kind)),
        scope: ScopeKey::default(),
        ..LexiconEntry::default()
    }
}

fn parse_kind(kind: &str) -> EntityKind {
    match kind.to_ascii_lowercase().as_str() {
        "location" => EntityKind::Location,
        "item" => EntityKind::Item,
        "faction" => EntityKind::Faction,
        "organization" => EntityKind::Organization,
        "event" => EntityKind::Event,
        "concept" => EntityKind::Concept,
        "npc" => EntityKind::Npc,
        _ => EntityKind::Character,
    }
}

fn structural_digest(snapshot: &crate::GraphRebuildSnapshot) -> StructuralDigest {
    let mut relationships = snapshot
        .relationships
        .iter()
        .map(|relationship| RelationshipDigest {
            id: relationship.id.to_string(),
            relation_type: relationship.relation_type.to_string(),
            status: relationship.status.to_string(),
        })
        .collect::<Vec<_>>();
    relationships.sort();

    StructuralDigest {
        relationships,
        event_count: snapshot.events.len(),
        memory_state_count: snapshot.memory_state.len(),
        embedding_target_kind_counts: kind_counts(snapshot),
    }
}

fn kind_counts(snapshot: &crate::GraphRebuildSnapshot) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for target in &snapshot.embedding_targets {
        *counts.entry(target.kind.to_string()).or_default() += 1;
    }
    counts
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParityFixture {
    note_id: String,
    scope_kind: GraphScopeKind,
    scope_id: String,
    built_at: u64,
    text: String,
    entities: Vec<FixtureEntity>,
    expected: StructuralDigest,
}

#[derive(Debug, Deserialize)]
struct FixtureEntity {
    id: String,
    label: String,
    kind: String,
    aliases: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StructuralDigest {
    relationships: Vec<RelationshipDigest>,
    event_count: usize,
    memory_state_count: usize,
    embedding_target_kind_counts: BTreeMap<String, usize>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
struct RelationshipDigest {
    id: String,
    relation_type: String,
    status: String,
}
