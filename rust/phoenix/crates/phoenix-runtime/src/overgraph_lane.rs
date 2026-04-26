#[cfg(feature = "legacy-cozo-graph")]
use std::cell::RefCell;
#[cfg(feature = "legacy-cozo-graph")]
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(feature = "legacy-cozo-graph")]
use overgraph::{DatabaseEngine, DbOptions};
#[cfg(feature = "legacy-cozo-graph")]
use overgraph::{EdgeInput, NodeInput, PropValue};
#[cfg(feature = "legacy-cozo-graph")]
use phoenix_store_cozo::{CompactRowView, PhoenixCozoStore};
use phoenix_store_native_core::StoreError;
#[cfg(feature = "legacy-cozo-graph")]
use rustc_hash::FxHashMap;
#[cfg(feature = "legacy-cozo-graph")]
use serde::Serialize;
#[cfg(feature = "legacy-cozo-graph")]
use serde_json::Value;

#[cfg(feature = "legacy-cozo-graph")]
const TYPE_GRAPH_VERTEX: u32 = 10_001;
#[cfg(feature = "legacy-cozo-graph")]
const EDGE_TYPE_FNV_OFFSET: u32 = 0x811c9dc5;
#[cfg(feature = "legacy-cozo-graph")]
const EDGE_TYPE_FNV_PRIME: u32 = 0x01000193;

#[cfg(feature = "legacy-cozo-graph")]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OvergraphLaneSyncReport {
    pub path: String,
    pub nodes: usize,
    pub edges: usize,
}

pub struct PhoenixOvergraphLane {
    path: PathBuf,
    #[cfg(feature = "legacy-cozo-graph")]
    engine: RefCell<DatabaseEngine>,
}

impl PhoenixOvergraphLane {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref().to_path_buf();
        fs::create_dir_all(&path).map_err(|error| StoreError::Init(error.to_string()))?;
        #[cfg(feature = "legacy-cozo-graph")]
        let engine = DatabaseEngine::open(
            &path,
            &DbOptions {
                create_if_missing: true,
                ..DbOptions::default()
            },
        )
        .map_err(overgraph_init_error)?;
        Ok(Self {
            path,
            #[cfg(feature = "legacy-cozo-graph")]
            engine: RefCell::new(engine),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    #[cfg(feature = "legacy-cozo-graph")]
    pub fn sync_from_legacy_relation_rows(
        &self,
        store: &PhoenixCozoStore,
    ) -> Result<OvergraphLaneSyncReport, StoreError> {
        const VERTEX_COLUMNS: &[&str] = &["id", "document_id", "weight", "value", "attributes"];
        const EDGE_COLUMNS: &[&str] = &[
            "source_id",
            "target_id",
            "edge_type",
            "weight",
            "attributes",
        ];

        let mut node_inputs = Vec::new();
        let mut vertex_keys = Vec::new();
        for row in store.fetch_compact_rows_with_columns("graph_vertices", VERTEX_COLUMNS)? {
            let row = CompactRowView::new(VERTEX_COLUMNS, &row);
            let Some(id) = row.get_str("id") else {
                continue;
            };
            vertex_keys.push(id.to_owned());
            node_inputs.push(NodeInput {
                type_id: TYPE_GRAPH_VERTEX,
                key: id.to_owned(),
                props: graph_vertex_props(&row),
                weight: row.get_i64("weight").unwrap_or(1) as f32,
                dense_vector: None,
                sparse_vector: None,
            });
        }

        let mut engine = self.engine.borrow_mut();
        let node_ids = engine
            .batch_upsert_nodes(&node_inputs)
            .map_err(overgraph_query_error)?;
        let mut ids_by_key = FxHashMap::default();
        for (key, id) in vertex_keys.into_iter().zip(node_ids.into_iter()) {
            ids_by_key.insert(key, id);
        }

        let mut edge_inputs = Vec::new();
        for row in store.fetch_compact_rows_with_columns("graph_edges", EDGE_COLUMNS)? {
            let row = CompactRowView::new(EDGE_COLUMNS, &row);
            let Some(source_id) = row.get_str("source_id") else {
                continue;
            };
            let Some(target_id) = row.get_str("target_id") else {
                continue;
            };
            let (Some(from), Some(to)) = (ids_by_key.get(source_id), ids_by_key.get(target_id))
            else {
                continue;
            };
            edge_inputs.push(EdgeInput {
                from: *from,
                to: *to,
                type_id: graph_edge_type_id(row.get_str("edge_type").unwrap_or("edge")),
                props: graph_edge_props(&row),
                weight: row.get_i64("weight").unwrap_or(1) as f32,
                valid_from: None,
                valid_to: None,
            });
        }
        engine
            .batch_upsert_edges(&edge_inputs)
            .map_err(overgraph_query_error)?;
        Ok(OvergraphLaneSyncReport {
            path: self.path.to_string_lossy().into_owned(),
            nodes: node_inputs.len(),
            edges: edge_inputs.len(),
        })
    }
}

#[cfg(feature = "legacy-cozo-graph")]
fn graph_vertex_props(row: &CompactRowView<'_>) -> BTreeMap<String, PropValue> {
    let mut props = BTreeMap::new();
    props.insert(
        "source".to_owned(),
        PropValue::String("phoenix-runtime".to_owned()),
    );
    if let Some(document_id) = row.get_str("document_id") {
        props.insert(
            "document_id".to_owned(),
            PropValue::String(document_id.to_owned()),
        );
    }
    let value = row.get_json("value").unwrap_or(Value::Null);
    if let Some(kind) = value.get("kind").and_then(Value::as_str) {
        props.insert("kind".to_owned(), PropValue::String(kind.to_owned()));
    }
    if let Some(label) = value.get("label").and_then(Value::as_str) {
        props.insert("label".to_owned(), PropValue::String(label.to_owned()));
    }
    props
}

#[cfg(feature = "legacy-cozo-graph")]
fn graph_edge_props(row: &CompactRowView<'_>) -> BTreeMap<String, PropValue> {
    let mut props = BTreeMap::new();
    props.insert(
        "source".to_owned(),
        PropValue::String("phoenix-runtime".to_owned()),
    );
    if let Some(edge_type) = row.get_str("edge_type") {
        props.insert(
            "edge_type".to_owned(),
            PropValue::String(edge_type.to_owned()),
        );
    }
    if let Some(attributes) = row.get_json("attributes") {
        props.insert(
            "attributes_json".to_owned(),
            PropValue::String(attributes.to_string()),
        );
    }
    props
}

#[cfg(feature = "legacy-cozo-graph")]
fn graph_edge_type_id(edge_type: &str) -> u32 {
    let mut hash = EDGE_TYPE_FNV_OFFSET;
    for byte in edge_type.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(EDGE_TYPE_FNV_PRIME);
    }
    hash.max(1)
}

#[cfg(feature = "legacy-cozo-graph")]
fn overgraph_init_error(error: overgraph::EngineError) -> StoreError {
    StoreError::Init(format!("overgraph lane: {error}"))
}

#[cfg(feature = "legacy-cozo-graph")]
fn overgraph_query_error(error: overgraph::EngineError) -> StoreError {
    StoreError::Query(format!("overgraph lane: {error}"))
}
