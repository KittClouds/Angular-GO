use serde::{Deserialize, Serialize};

macro_rules! string_id {
    ($name:ident) => {
        #[derive(
            Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }
    };
}

string_id!(DocumentId);
string_id!(NoteId);
string_id!(EntityId);
string_id!(EdgeId);
string_id!(SessionId);
string_id!(ThreadId);
string_id!(CommitId);

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeKey {
    pub world_id: Option<String>,
    pub narrative_id: Option<String>,
    pub folder_id: Option<String>,
    pub folder_path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TemporalSource {
    Chapter,
    Calendar,
    Story,
    Ordinal,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporalMarker {
    pub source: Option<TemporalSource>,
    pub chapter: Option<u32>,
    pub calendar: Option<i64>,
    pub story_time: Option<String>,
    pub ordinal: Option<i64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRange {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSpan {
    pub document_id: Option<DocumentId>,
    pub note_id: Option<NoteId>,
    pub label: String,
    pub kind: Option<String>,
    pub range: TextRange,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeTarget {
    Native,
    Wasm,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageMode {
    CozoMem,
    CozoSqlite,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SnapshotPolicy {
    Manual,
    OnCommit,
    Debounced,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlags {
    pub scanner: bool,
    pub structure: bool,
    pub graptor: bool,
    pub gldr: bool,
    pub semantic: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub target: RuntimeTarget,
    pub storage: StorageMode,
    pub snapshot_policy: SnapshotPolicy,
    pub feature_flags: FeatureFlags,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            target: RuntimeTarget::Native,
            storage: StorageMode::CozoMem,
            snapshot_policy: SnapshotPolicy::Manual,
            feature_flags: FeatureFlags {
                scanner: true,
                structure: true,
                graptor: true,
                gldr: true,
                semantic: false,
            },
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestDocument {
    pub document_id: DocumentId,
    pub note_id: Option<NoteId>,
    pub title: String,
    pub text: String,
    pub scope: ScopeKey,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestRequest {
    pub session_id: Option<SessionId>,
    pub documents: Vec<IngestDocument>,
    pub commit: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub session_id: Option<SessionId>,
    pub document_count: usize,
    pub warning_count: usize,
    pub relation_counts: Vec<RelationCount>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueryTarget {
    Chunks,
    Nodes,
    Graph,
    Semantic,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub session_id: Option<SessionId>,
    pub query: String,
    pub scope: ScopeKey,
    pub targets: Vec<QueryTarget>,
    pub limit: Option<usize>,
    pub temporal: Option<TemporalMarker>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkHit {
    pub chunk_id: String,
    pub score: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeHit {
    pub entity_id: Option<EntityId>,
    pub score: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationCount {
    pub relation: String,
    pub rows: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub session_id: Option<SessionId>,
    pub chunk_hits: Vec<ChunkHit>,
    pub node_hits: Vec<NodeHit>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDto {
    pub schema_version: String,
    pub created_at: i64,
    pub payload_bytes: usize,
    pub relation_counts: Vec<RelationCount>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u32)]
pub enum PacketKind {
    None = 0,
    Status = 1,
    InitRuntimeRequest = 2,
    InitRuntimeResult = 3,
    CreateSessionRequest = 4,
    CreateSessionResult = 5,
    CommitRequest = 6,
    CommitResult = 7,
    RebuildRequest = 8,
    RebuildResult = 9,
    IngestRequest = 10,
    IngestResult = 11,
    QueryRequest = 12,
    QueryResult = 13,
    SnapshotExportRequest = 14,
    SnapshotResult = 15,
    SnapshotImportRequest = 16,
    Ack = 255,
}

impl Default for PacketKind {
    fn default() -> Self {
        Self::None
    }
}

impl From<u32> for PacketKind {
    fn from(value: u32) -> Self {
        match value {
            1 => Self::Status,
            2 => Self::InitRuntimeRequest,
            3 => Self::InitRuntimeResult,
            4 => Self::CreateSessionRequest,
            5 => Self::CreateSessionResult,
            6 => Self::CommitRequest,
            7 => Self::CommitResult,
            8 => Self::RebuildRequest,
            9 => Self::RebuildResult,
            10 => Self::IngestRequest,
            11 => Self::IngestResult,
            12 => Self::QueryRequest,
            13 => Self::QueryResult,
            14 => Self::SnapshotExportRequest,
            15 => Self::SnapshotResult,
            16 => Self::SnapshotImportRequest,
            255 => Self::Ack,
            _ => Self::None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInitRequest {
    pub config: RuntimeConfig,
    pub storage_path: Option<String>,
    pub force_reset: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInitResult {
    pub ready: bool,
    pub schema_version: String,
    pub relation_count: usize,
    pub relation_counts: Vec<RelationCount>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub session_id: Option<SessionId>,
    pub label: String,
    pub scope: ScopeKey,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub session_id: SessionId,
    pub label: String,
    pub scope: ScopeKey,
    pub status: String,
    pub revision: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub session_id: SessionId,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub session_id: SessionId,
    pub commit_id: CommitId,
    pub revision: u64,
    pub committed_at: i64,
    pub relation_counts: Vec<RelationCount>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildRequest {
    pub session_id: Option<SessionId>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildResult {
    pub rebuilt_at: i64,
    pub relation_counts: Vec<RelationCount>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[repr(C)]
pub struct PacketHeader {
    pub ready: u32,
    pub kind: u32,
    pub request_id: u32,
    pub payload_len: u32,
}

impl PacketHeader {
    pub const BYTE_LEN: usize = 16;

    pub fn new(ready: u32, kind: PacketKind, request_id: u32, payload_len: u32) -> Self {
        Self {
            ready,
            kind: kind as u32,
            request_id,
            payload_len,
        }
    }

    pub fn packet_kind(&self) -> PacketKind {
        self.kind.into()
    }

    pub fn to_le_bytes(self) -> [u8; Self::BYTE_LEN] {
        let mut bytes = [0_u8; Self::BYTE_LEN];
        bytes[0..4].copy_from_slice(&self.ready.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.kind.to_le_bytes());
        bytes[8..12].copy_from_slice(&self.request_id.to_le_bytes());
        bytes[12..16].copy_from_slice(&self.payload_len.to_le_bytes());
        bytes
    }

    pub fn from_le_bytes(bytes: [u8; Self::BYTE_LEN]) -> Self {
        Self {
            ready: u32::from_le_bytes(bytes[0..4].try_into().expect("ready bytes")),
            kind: u32::from_le_bytes(bytes[4..8].try_into().expect("kind bytes")),
            request_id: u32::from_le_bytes(bytes[8..12].try_into().expect("request bytes")),
            payload_len: u32::from_le_bytes(bytes[12..16].try_into().expect("payload bytes")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_header_round_trip() {
        let header = PacketHeader::new(1, PacketKind::QueryResult, 42, 4096);
        let bytes = header.to_le_bytes();
        let decoded = PacketHeader::from_le_bytes(bytes);

        assert_eq!(decoded.ready, 1);
        assert_eq!(decoded.packet_kind(), PacketKind::QueryResult);
        assert_eq!(decoded.request_id, 42);
        assert_eq!(decoded.payload_len, 4096);
    }

    #[test]
    fn runtime_config_serializes_camel_case() {
        let config = RuntimeConfig::default();
        let json = serde_json::to_string(&config).expect("serialize runtime config");

        assert!(json.contains("snapshotPolicy"));
        assert!(json.contains("featureFlags"));
    }
}
