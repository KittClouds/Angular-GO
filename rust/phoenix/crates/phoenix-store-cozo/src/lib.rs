use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use cozo;
use phoenix_types::{RelationCount, SnapshotDto, StorageMode};
use schema::{PhoenixColumnSpec, PhoenixColumnType, PhoenixRelationSpec, ALL_RELATIONS};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub mod schema;

pub const SCHEMA_VERSION: &str = "phoenix.cozo.v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreConfig {
    pub mode: StorageMode,
    pub path: Option<PathBuf>,
}

impl Default for StoreConfig {
    fn default() -> Self {
        Self {
            mode: StorageMode::CozoMem,
            path: None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEnvelope {
    pub schema_version: String,
    pub relation_count: usize,
    pub created_at: i64,
    pub relations: BTreeMap<String, Vec<Value>>,
    pub checksum: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("unsupported storage mode on this target: {0:?}")]
    UnsupportedMode(StorageMode),
    #[error("sqlite path is required for persistent Cozo storage")]
    MissingPath,
    #[error("unknown relation: {0}")]
    UnknownRelation(String),
    #[error("row must be a JSON object")]
    InvalidRow,
    #[error("missing required column '{column}' in relation '{relation}'")]
    MissingColumn { relation: String, column: String },
    #[error("cozo init failed: {0}")]
    Init(String),
    #[error("cozo schema failed: {0}")]
    Schema(String),
    #[error("cozo query failed: {0}")]
    Query(String),
    #[error("snapshot decode failed: {0}")]
    Snapshot(String),
}

pub struct PhoenixCozoStore {
    db: cozo::DbInstance,
    config: StoreConfig,
    schema_version: &'static str,
}

impl PhoenixCozoStore {
    pub fn new() -> Result<Self, StoreError> {
        Self::open(StoreConfig::default())
    }

    pub fn open(config: StoreConfig) -> Result<Self, StoreError> {
        let db = open_db(&config)?;
        let store = Self {
            db,
            config,
            schema_version: SCHEMA_VERSION,
        };
        store.init_schema()?;
        Ok(store)
    }

    pub fn config(&self) -> &StoreConfig {
        &self.config
    }

    pub fn schema_version(&self) -> &'static str {
        self.schema_version
    }

    pub fn relation_names(&self) -> Vec<&'static str> {
        ALL_RELATIONS.iter().map(|relation| relation.name).collect()
    }

    pub fn init_schema(&self) -> Result<(), StoreError> {
        for relation in ALL_RELATIONS {
            let script = build_create_relation_script(relation);
            match self
                .db
                .run_script(&script, Default::default(), cozo::ScriptMutability::Mutable)
            {
                Ok(_) => {}
                Err(error) if relation_already_exists(&error.to_string()) => {}
                Err(error) => return Err(StoreError::Schema(error.to_string())),
            }
        }

        self.put_row(
            "phoenix_schema_state",
            serde_json::json!({
                "version": self.schema_version,
                "updated_at": now_ms(),
            }),
        )?;

        Ok(())
    }

    pub fn put_row(&self, relation: &str, row: Value) -> Result<(), StoreError> {
        let spec = relation_spec(relation)?;
        let object = row.as_object().ok_or(StoreError::InvalidRow)?;
        let script = build_put_script(spec, object)?;
        self.db
            .run_script(&script, Default::default(), cozo::ScriptMutability::Mutable)
            .map_err(|error| StoreError::Query(error.to_string()))?;
        Ok(())
    }

    pub fn fetch_rows(&self, relation: &str) -> Result<Vec<Value>, StoreError> {
        let spec = relation_spec(relation)?;
        let script = build_fetch_script(spec);
        let rows = self
            .db
            .run_script(&script, Default::default(), cozo::ScriptMutability::Immutable)
            .map_err(|error| StoreError::Query(error.to_string()))?;
        Ok(named_rows_to_json_objects(rows))
    }

    pub fn clear_relation(&self, relation: &str) -> Result<(), StoreError> {
        let spec = relation_spec(relation)?;
        let script = build_clear_script(spec);
        self.db
            .run_script(&script, Default::default(), cozo::ScriptMutability::Mutable)
            .map_err(|error| StoreError::Query(error.to_string()))?;
        Ok(())
    }

    pub fn clear_all_relations(&self) -> Result<(), StoreError> {
        for relation in ALL_RELATIONS.iter().rev() {
            self.clear_relation(relation.name)?;
        }
        self.put_row(
            "phoenix_schema_state",
            serde_json::json!({
                "version": self.schema_version,
                "updated_at": now_ms(),
            }),
        )?;
        Ok(())
    }

    pub fn relation_counts(&self) -> Result<Vec<RelationCount>, StoreError> {
        let mut counts = Vec::with_capacity(ALL_RELATIONS.len());
        for relation in ALL_RELATIONS {
            let rows = self.fetch_rows(relation.name)?;
            counts.push(RelationCount {
                relation: relation.name.to_owned(),
                rows: rows.len(),
            });
        }
        Ok(counts)
    }

    pub fn snapshot_descriptor(&self, created_at: i64, payload_bytes: usize) -> SnapshotDto {
        let relation_counts = self.relation_counts().unwrap_or_default();
        SnapshotDto {
            schema_version: self.schema_version.to_owned(),
            created_at,
            payload_bytes,
            relation_counts,
        }
    }

    pub fn export_snapshot(&self) -> Result<Vec<u8>, StoreError> {
        let mut relations = BTreeMap::new();
        for relation in ALL_RELATIONS {
            relations.insert(relation.name.to_owned(), self.fetch_rows(relation.name)?);
        }
        let envelope = SnapshotEnvelope {
            schema_version: self.schema_version.to_owned(),
            relation_count: relations.len(),
            created_at: now_ms(),
            relations,
            checksum: None,
        };
        serde_json::to_vec(&envelope).map_err(|error| StoreError::Snapshot(error.to_string()))
    }

    pub fn import_snapshot(&self, bytes: &[u8]) -> Result<SnapshotEnvelope, StoreError> {
        let envelope: SnapshotEnvelope =
            serde_json::from_slice(bytes).map_err(|error| StoreError::Snapshot(error.to_string()))?;
        self.clear_all_relations()?;

        for (relation, rows) in &envelope.relations {
            relation_spec(relation)?;
            for row in rows {
                self.put_row(relation, row.clone())?;
            }
        }

        self.put_row(
            "phoenix_schema_state",
            serde_json::json!({
                "version": envelope.schema_version,
                "updated_at": now_ms(),
            }),
        )?;

        Ok(envelope)
    }
}

fn open_db(config: &StoreConfig) -> Result<cozo::DbInstance, StoreError> {
    match config.mode {
        StorageMode::CozoMem => cozo::DbInstance::new("mem", "", "")
            .map_err(|error| StoreError::Init(error.to_string())),
        StorageMode::CozoSqlite => Err(StoreError::UnsupportedMode(StorageMode::CozoSqlite)),
    }
}

fn relation_spec(name: &str) -> Result<&'static PhoenixRelationSpec, StoreError> {
    ALL_RELATIONS
        .iter()
        .find(|relation| relation.name == name)
        .ok_or_else(|| StoreError::UnknownRelation(name.to_owned()))
}

fn build_create_relation_script(spec: &PhoenixRelationSpec) -> String {
    let keys = spec
        .key_columns()
        .map(column_declaration)
        .collect::<Vec<_>>()
        .join(",\n    ");
    let values = spec
        .value_columns()
        .map(column_declaration)
        .collect::<Vec<_>>()
        .join(",\n    ");

    if values.is_empty() {
        format!(":create {} {{\n    {}\n}}", spec.name, keys)
    } else {
        format!(":create {} {{\n    {}\n    =>\n    {}\n}}", spec.name, keys, values)
    }
}

fn build_put_script(spec: &PhoenixRelationSpec, row: &Map<String, Value>) -> Result<String, StoreError> {
    let column_names = spec
        .columns
        .iter()
        .map(|column| column.name)
        .collect::<Vec<_>>();
    let literals = spec
        .columns
        .iter()
        .map(|column| row_literal(spec, column, row))
        .collect::<Result<Vec<_>, _>>()?;
    let keys = spec.key_columns().map(|column| column.name).collect::<Vec<_>>();
    let values = spec
        .value_columns()
        .map(|column| column.name)
        .collect::<Vec<_>>();

    let put_clause = if values.is_empty() {
        format!(":put {} {{ {} }}", spec.name, keys.join(", "))
    } else {
        format!(
            ":put {} {{ {} => {} }}",
            spec.name,
            keys.join(", "),
            values.join(", ")
        )
    };

    Ok(format!(
        "?[{}] <- [[{}]]\n{}",
        column_names.join(", "),
        literals.join(", "),
        put_clause
    ))
}

fn build_fetch_script(spec: &PhoenixRelationSpec) -> String {
    let columns = spec
        .columns
        .iter()
        .map(|column| column.name)
        .collect::<Vec<_>>()
        .join(", ");
    format!("?[{}] := *{}{{{}}}", columns, spec.name, columns)
}

fn build_clear_script(spec: &PhoenixRelationSpec) -> String {
    let keys = spec
        .key_columns()
        .map(|column| column.name)
        .collect::<Vec<_>>()
        .join(", ");
    format!("?[{keys}] := *{}{{{keys}}} :rm {}{{{keys}}}", spec.name, spec.name)
}

fn column_declaration(column: &PhoenixColumnSpec) -> String {
    if column.optional {
        format!("{}: {}?", column.name, column.ty.as_cozo())
    } else {
        format!("{}: {}", column.name, column.ty.as_cozo())
    }
}

fn row_literal(
    spec: &PhoenixRelationSpec,
    column: &PhoenixColumnSpec,
    row: &Map<String, Value>,
) -> Result<String, StoreError> {
    let value = row.get(column.name).unwrap_or(&Value::Null);
    if value.is_null() && !column.optional {
        return Err(StoreError::MissingColumn {
            relation: spec.name.to_owned(),
            column: column.name.to_owned(),
        });
    }
    Ok(value_to_cozo_literal(column.ty, value))
}

fn value_to_cozo_literal(column_ty: PhoenixColumnType, value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => match column_ty {
            PhoenixColumnType::Json => serde_json::to_string(value).expect("json string"),
            _ => serde_json::to_string(value).expect("string literal"),
        },
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

fn named_rows_to_json_objects(rows: cozo::NamedRows) -> Vec<Value> {
    let headers = rows.headers.clone();
    rows.rows
        .into_iter()
        .map(|row| {
            let object = headers
                .iter()
                .cloned()
                .zip(row.into_iter().map(datavalue_to_json))
                .collect::<Map<String, Value>>();
            Value::Object(object)
        })
        .collect()
}

fn datavalue_to_json(value: cozo::DataValue) -> Value {
    use cozo::DataValue;

    match value {
        DataValue::Null | DataValue::Bot => Value::Null,
        DataValue::Json(json) => serde_json::to_value(json).unwrap_or(Value::Null),
        other => match serde_json::to_value(&other) {
            Ok(Value::Object(map)) if map.len() == 1 => {
                let inner = map.into_iter().next().expect("one value").1;
                match inner {
                    Value::Object(map) if map.len() == 1 => {
                        map.into_iter().next().expect("inner value").1
                    }
                    value => value,
                }
            }
            Ok(value) => value,
            Err(_) => Value::Null,
        },
    }
}

fn relation_already_exists(message: &str) -> bool {
    message.contains("exists")
        || message.contains("already")
        || message.contains("conflicts with an existing one")
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::CORE_RELATIONS;

    fn sample_note() -> Value {
        serde_json::json!({
            "id": "note-1",
            "version": 1,
            "world_id": "world-1",
            "title": "Phoenix",
            "content": "Ash and rebirth",
            "markdown_content": "Ash and rebirth",
            "folder_id": "folder-1",
            "entity_kind": null,
            "entity_subtype": null,
            "is_entity": false,
            "is_pinned": false,
            "favorite": false,
            "owner_id": null,
            "narrative_id": "nar-1",
            "order": 1000.0,
            "created_at": 10,
            "updated_at": 10,
            "valid_from": 10,
            "valid_to": null,
            "is_current": true,
            "change_reason": "seed"
        })
    }

    #[test]
    fn core_relations_include_ui_backbone_tables() {
        assert!(CORE_RELATIONS.contains(&"notes"));
        assert!(CORE_RELATIONS.contains(&"entities"));
        assert!(CORE_RELATIONS.contains(&"edges"));
        assert!(CORE_RELATIONS.contains(&"folders"));
        assert!(CORE_RELATIONS.contains(&"graph_vertices"));
    }

    #[test]
    fn schema_init_is_idempotent() {
        let store = PhoenixCozoStore::new().expect("mem store");
        store.init_schema().expect("second init");
        let rows = store
            .fetch_rows("phoenix_schema_state")
            .expect("schema rows");
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn snapshot_export_import_restores_rows() {
        let store = PhoenixCozoStore::new().expect("mem store");
        store.put_row("notes", sample_note()).expect("seed note");

        let snapshot = store.export_snapshot().expect("snapshot bytes");

        let restored = PhoenixCozoStore::new().expect("restored store");
        restored.import_snapshot(&snapshot).expect("import snapshot");

        let rows = restored.fetch_rows("notes").expect("restored notes");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "note-1");
    }

    #[test]
    fn wasm_in_memory_restore_uses_same_snapshot_format() {
        let store = PhoenixCozoStore::open(StoreConfig {
            mode: StorageMode::CozoMem,
            path: None,
        })
        .expect("mem store");
        store.put_row("notes", sample_note()).expect("seed note");
        let snapshot = store.export_snapshot().expect("snapshot");

        let restored = PhoenixCozoStore::open(StoreConfig {
            mode: StorageMode::CozoMem,
            path: None,
        })
        .expect("restored store");
        let envelope = restored.import_snapshot(&snapshot).expect("import");
        assert_eq!(envelope.schema_version, SCHEMA_VERSION);
        assert_eq!(restored.fetch_rows("notes").expect("rows").len(), 1);
    }
}
