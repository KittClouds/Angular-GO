use std::collections::HashMap;

use overgraph::{
    ComponentOptions, DatabaseEngine, DegreeOptions, Direction, EdgeInput, GraphPatch, NodeInput,
    PropValue, ShortestPathOptions,
};
use phoenix_kernel::{KernelEdge, KernelGraphLayer, KernelGraphSnapshot, KernelVertex};
use phoenix_store_native_core::StoreError;

use super::{
    btree_props, optional_string_prop, store_query_error, PhoenixOvergraphStore,
    EDGE_KERNEL_TOPOLOGY_ASSERTED, EDGE_KERNEL_TOPOLOGY_CANDIDATE, PROP_DOCUMENT_ID, PROP_KIND,
    PROP_NODE_ID, PROP_RECORD, TYPE_KERNEL_TOPOLOGY_VERTEX,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KernelTopologyCounts {
    pub vertices: usize,
    pub asserted_edges: usize,
    pub candidate_edges: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KernelTopologyShortestPath {
    pub nodes: Vec<String>,
    pub edges: Vec<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KernelTopologyVertexId {
    pub stable_id: String,
    pub overgraph_id: u64,
}

impl PhoenixOvergraphStore {
    pub fn publish_kernel_topology(
        &self,
        snapshot: &KernelGraphSnapshot,
    ) -> Result<KernelTopologyCounts, StoreError> {
        self.with_engine(|engine| self.publish_kernel_topology_with_engine(engine, snapshot))
    }

    pub(crate) fn publish_kernel_topology_with_engine(
        &self,
        engine: &mut DatabaseEngine,
        snapshot: &KernelGraphSnapshot,
    ) -> Result<KernelTopologyCounts, StoreError> {
        let stale_nodes = engine
            .get_nodes_by_type(TYPE_KERNEL_TOPOLOGY_VERTEX)
            .map_err(store_query_error)?
            .into_iter()
            .map(|node| node.id)
            .collect::<Vec<_>>();
        let stale_edges = engine
            .get_edges_by_type(EDGE_KERNEL_TOPOLOGY_ASSERTED)
            .map_err(store_query_error)?
            .into_iter()
            .chain(
                engine
                    .get_edges_by_type(EDGE_KERNEL_TOPOLOGY_CANDIDATE)
                    .map_err(store_query_error)?,
            )
            .map(|edge| edge.id)
            .collect::<Vec<_>>();
        if !stale_nodes.is_empty() || !stale_edges.is_empty() {
            engine
                .graph_patch(&GraphPatch {
                    delete_node_ids: stale_nodes,
                    delete_edge_ids: stale_edges,
                    ..Default::default()
                })
                .map_err(store_query_error)?;
        }

        let node_inputs = snapshot
            .vertices
            .iter()
            .map(vertex_input)
            .collect::<Result<Vec<_>, _>>()?;
        let node_ids = engine
            .batch_upsert_nodes(&node_inputs)
            .map_err(store_query_error)?;
        let mut ids = HashMap::with_capacity(node_ids.len());
        for (vertex, overgraph_id) in snapshot.vertices.iter().zip(node_ids) {
            ids.insert(vertex.id.0.as_str(), overgraph_id);
        }

        let mut edge_inputs =
            Vec::with_capacity(snapshot.asserted_edges.len() + snapshot.candidate_edges.len());
        push_edge_inputs(
            &mut edge_inputs,
            &ids,
            &snapshot.asserted_edges,
            EDGE_KERNEL_TOPOLOGY_ASSERTED,
            KernelGraphLayer::Asserted,
        )?;
        push_edge_inputs(
            &mut edge_inputs,
            &ids,
            &snapshot.candidate_edges,
            EDGE_KERNEL_TOPOLOGY_CANDIDATE,
            KernelGraphLayer::Candidate,
        )?;
        if !edge_inputs.is_empty() {
            engine
                .batch_upsert_edges(&edge_inputs)
                .map_err(store_query_error)?;
        }

        Ok(KernelTopologyCounts {
            vertices: snapshot.vertices.len(),
            asserted_edges: snapshot.asserted_edges.len(),
            candidate_edges: snapshot.candidate_edges.len(),
        })
    }

    pub fn kernel_topology_counts(&self) -> Result<KernelTopologyCounts, StoreError> {
        self.with_engine(|engine| {
            Ok(KernelTopologyCounts {
                vertices: engine
                    .get_nodes_by_type(TYPE_KERNEL_TOPOLOGY_VERTEX)
                    .map_err(store_query_error)?
                    .len(),
                asserted_edges: engine
                    .get_edges_by_type(EDGE_KERNEL_TOPOLOGY_ASSERTED)
                    .map_err(store_query_error)?
                    .len(),
                candidate_edges: engine
                    .get_edges_by_type(EDGE_KERNEL_TOPOLOGY_CANDIDATE)
                    .map_err(store_query_error)?
                    .len(),
            })
        })
    }

    pub fn kernel_topology_vertex_id(
        &self,
        stable_id: &str,
    ) -> Result<Option<KernelTopologyVertexId>, StoreError> {
        self.with_engine(|engine| {
            Ok(engine
                .get_node_by_key(TYPE_KERNEL_TOPOLOGY_VERTEX, &vertex_storage_key(stable_id))
                .map_err(store_query_error)?
                .map(|node| KernelTopologyVertexId {
                    stable_id: stable_id.to_owned(),
                    overgraph_id: node.id,
                }))
        })
    }

    pub fn kernel_topology_degree(&self, stable_id: &str) -> Result<Option<u64>, StoreError> {
        self.with_engine(|engine| {
            let Some(node) = engine
                .get_node_by_key(TYPE_KERNEL_TOPOLOGY_VERTEX, &vertex_storage_key(stable_id))
                .map_err(store_query_error)?
            else {
                return Ok(None);
            };
            engine
                .degree(
                    node.id,
                    &DegreeOptions {
                        direction: Direction::Both,
                        type_filter: Some(vec![
                            EDGE_KERNEL_TOPOLOGY_ASSERTED,
                            EDGE_KERNEL_TOPOLOGY_CANDIDATE,
                        ]),
                        ..Default::default()
                    },
                )
                .map(Some)
                .map_err(store_query_error)
        })
    }

    pub fn kernel_topology_shortest_path(
        &self,
        from: &str,
        to: &str,
    ) -> Result<Option<KernelTopologyShortestPath>, StoreError> {
        self.with_engine(|engine| {
            let Some(from_node) = engine
                .get_node_by_key(TYPE_KERNEL_TOPOLOGY_VERTEX, &vertex_storage_key(from))
                .map_err(store_query_error)?
            else {
                return Ok(None);
            };
            let Some(to_node) = engine
                .get_node_by_key(TYPE_KERNEL_TOPOLOGY_VERTEX, &vertex_storage_key(to))
                .map_err(store_query_error)?
            else {
                return Ok(None);
            };
            let Some(path) = engine
                .shortest_path(
                    from_node.id,
                    to_node.id,
                    &ShortestPathOptions {
                        direction: Direction::Outgoing,
                        type_filter: Some(vec![EDGE_KERNEL_TOPOLOGY_ASSERTED]),
                        ..Default::default()
                    },
                )
                .map_err(store_query_error)?
            else {
                return Ok(None);
            };
            let nodes = engine
                .get_nodes(&path.nodes)
                .map_err(store_query_error)?
                .into_iter()
                .flatten()
                .filter_map(|node| optional_string_prop(&node, PROP_NODE_ID))
                .collect();
            Ok(Some(KernelTopologyShortestPath {
                nodes,
                edges: path.edges,
            }))
        })
    }

    pub fn kernel_topology_component_count(&self) -> Result<usize, StoreError> {
        self.with_engine(|engine| {
            let components = engine
                .connected_components(&ComponentOptions {
                    edge_type_filter: Some(vec![
                        EDGE_KERNEL_TOPOLOGY_ASSERTED,
                        EDGE_KERNEL_TOPOLOGY_CANDIDATE,
                    ]),
                    node_type_filter: Some(vec![TYPE_KERNEL_TOPOLOGY_VERTEX]),
                    ..Default::default()
                })
                .map_err(store_query_error)?;
            Ok(components.values().copied().max().unwrap_or(0) as usize)
        })
    }
}

fn vertex_input(vertex: &KernelVertex) -> Result<NodeInput, StoreError> {
    Ok(NodeInput {
        type_id: TYPE_KERNEL_TOPOLOGY_VERTEX,
        key: vertex_storage_key(&vertex.id.0),
        props: btree_props([
            (PROP_NODE_ID, PropValue::String(vertex.id.0.clone())),
            (PROP_KIND, PropValue::String(vertex.kind.clone())),
            (
                PROP_DOCUMENT_ID,
                vertex
                    .document_id
                    .clone()
                    .map(PropValue::String)
                    .unwrap_or(PropValue::Null),
            ),
            (PROP_RECORD, PropValue::Bytes(super::encode_record(vertex)?)),
        ]),
        weight: vertex.weight.max(1) as f32,
        dense_vector: None,
        sparse_vector: None,
    })
}

fn push_edge_inputs(
    out: &mut Vec<EdgeInput>,
    ids: &HashMap<&str, u64>,
    edges: &[KernelEdge],
    edge_type_id: u32,
    layer: KernelGraphLayer,
) -> Result<(), StoreError> {
    for edge in edges {
        let (Some(&from), Some(&to)) = (
            ids.get(edge.source_id.0.as_str()),
            ids.get(edge.target_id.0.as_str()),
        ) else {
            continue;
        };
        out.push(EdgeInput {
            from,
            to,
            type_id: edge_type_id,
            props: btree_props([
                (PROP_KIND, PropValue::String(edge.edge_type.0.clone())),
                (
                    "layer",
                    PropValue::String(match layer {
                        KernelGraphLayer::Asserted => "asserted".to_owned(),
                        KernelGraphLayer::Candidate => "candidate".to_owned(),
                    }),
                ),
                (
                    PROP_DOCUMENT_ID,
                    edge.document_id
                        .clone()
                        .map(PropValue::String)
                        .unwrap_or(PropValue::Null),
                ),
                (PROP_RECORD, PropValue::Bytes(super::encode_record(edge)?)),
            ]),
            weight: edge.weight.max(1) as f32,
            valid_from: edge.temporal.valid_from,
            valid_to: edge.temporal.valid_to,
        });
    }
    Ok(())
}

fn vertex_storage_key(stable_id: &str) -> String {
    format!("kernel-topology:{stable_id}")
}

#[cfg(test)]
mod tests {
    use phoenix_kernel::{
        KernelEdge, KernelEdgeType, KernelGraphSnapshot, KernelVertex, KernelVertexId,
    };
    use phoenix_store_native_core::PhoenixGraphKernelStoreV2;

    use super::*;

    fn temp_store(name: &str) -> PhoenixOvergraphStore {
        let path = std::env::temp_dir().join(format!(
            "phoenix-overgraph-topology-{name}-{}-{}",
            std::process::id(),
            super::super::now_ms()
        ));
        let _ = std::fs::remove_dir_all(&path);
        PhoenixOvergraphStore::open(&path).expect("open overgraph store")
    }

    fn vertex(id: &str, doc: &str) -> KernelVertex {
        KernelVertex {
            id: KernelVertexId(id.to_owned()),
            kind: "entity".to_owned(),
            weight: 1,
            document_id: Some(doc.to_owned()),
            ..Default::default()
        }
    }

    fn edge(source: &str, target: &str, doc: &str) -> KernelEdge {
        KernelEdge {
            source_id: KernelVertexId(source.to_owned()),
            target_id: KernelVertexId(target.to_owned()),
            edge_type: KernelEdgeType("mentions".to_owned()),
            weight: 1,
            document_id: Some(doc.to_owned()),
            ..Default::default()
        }
    }

    #[test]
    fn topology_publish_replaces_stale_vertices_and_edges() {
        let store = temp_store("replace");
        store
            .publish_kernel_topology(&KernelGraphSnapshot {
                vertices: vec![vertex("doc::old", "old"), vertex("entity::a", "old")],
                asserted_edges: vec![edge("doc::old", "entity::a", "old")],
                candidate_edges: Vec::new(),
            })
            .expect("publish old");

        store
            .publish_kernel_topology(&KernelGraphSnapshot {
                vertices: vec![vertex("doc::live", "live"), vertex("entity::b", "live")],
                asserted_edges: vec![edge("doc::live", "entity::b", "live")],
                candidate_edges: Vec::new(),
            })
            .expect("publish live");

        assert_eq!(
            store.kernel_topology_counts().expect("counts"),
            KernelTopologyCounts {
                vertices: 2,
                asserted_edges: 1,
                candidate_edges: 0,
            }
        );
        assert!(store
            .kernel_topology_vertex_id("doc::old")
            .expect("old lookup")
            .is_none());
        assert!(store
            .kernel_topology_shortest_path("doc::live", "entity::b")
            .expect("path")
            .is_some());
    }

    #[test]
    fn topology_publish_skips_dangling_edges() {
        let store = temp_store("dangling");
        store
            .publish_kernel_topology(&KernelGraphSnapshot {
                vertices: vec![vertex("entity::a", "doc")],
                asserted_edges: vec![edge("entity::a", "entity::missing", "doc")],
                candidate_edges: Vec::new(),
            })
            .expect("publish");

        assert_eq!(
            store.kernel_topology_counts().expect("counts"),
            KernelTopologyCounts {
                vertices: 1,
                asserted_edges: 0,
                candidate_edges: 0,
            }
        );
        assert_eq!(
            store.kernel_topology_degree("entity::a").expect("degree"),
            Some(0)
        );
    }

    #[test]
    fn kernel_checkpoint_publish_refreshes_overgraph_topology() {
        let store = temp_store("checkpoint-refresh");
        store
            .write_kernel_checkpoint(
                1,
                "old",
                &KernelGraphSnapshot {
                    vertices: vec![vertex("doc::old", "old"), vertex("entity::a", "old")],
                    asserted_edges: vec![edge("doc::old", "entity::a", "old")],
                    candidate_edges: Vec::new(),
                },
            )
            .expect("write old checkpoint");
        store
            .write_kernel_checkpoint(
                2,
                "live",
                &KernelGraphSnapshot {
                    vertices: vec![vertex("doc::live", "live")],
                    asserted_edges: Vec::new(),
                    candidate_edges: Vec::new(),
                },
            )
            .expect("write live checkpoint");

        assert_eq!(
            store.kernel_topology_counts().expect("counts"),
            KernelTopologyCounts {
                vertices: 1,
                asserted_edges: 0,
                candidate_edges: 0,
            }
        );
        assert!(store
            .kernel_topology_vertex_id("entity::a")
            .expect("stale lookup")
            .is_none());
    }
}
