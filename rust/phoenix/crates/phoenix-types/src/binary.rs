#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct StringRef {
    pub offset: u32,
    pub len: u32,
}

macro_rules! binary_header {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
        #[repr(C)]
        pub struct $name {
            pub version: u32,
            pub flags: u32,
            pub session_offset: u32,
            pub session_len: u32,
            pub table1_offset: u32,
            pub table1_count: u32,
            pub table2_offset: u32,
            pub table2_count: u32,
            pub table3_offset: u32,
            pub table3_count: u32,
            pub table4_offset: u32,
            pub table4_count: u32,
            pub arena_offset: u32,
            pub arena_len: u32,
        }
    };
}

binary_header!(QueryResultHeader);
binary_header!(GraphDeltaResultHeader);
binary_header!(SessionStateResultHeader);
binary_header!(SessionStatsResultHeader);

impl QueryResultHeader {
    pub const BYTE_LEN: usize = 56;
}

impl GraphDeltaResultHeader {
    pub const BYTE_LEN: usize = 56;
}

impl SessionStateResultHeader {
    pub const BYTE_LEN: usize = 56;
}

impl SessionStatsResultHeader {
    pub const BYTE_LEN: usize = 56;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct ChunkHitRecord {
    pub chunk_id_offset: u32,
    pub chunk_id_len: u32,
    pub score_bits: u64,
}

impl ChunkHitRecord {
    pub const BYTE_LEN: usize = 16;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct NodeHitRecord {
    pub entity_id_offset: u32,
    pub entity_id_len: u32,
    pub score_bits: u64,
}

impl NodeHitRecord {
    pub const BYTE_LEN: usize = 16;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct DiagnosticRecord {
    pub code_offset: u32,
    pub code_len: u32,
    pub message_offset: u32,
    pub message_len: u32,
}

impl DiagnosticRecord {
    pub const BYTE_LEN: usize = 16;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct GraphDeltaChunkRecord {
    pub vertex_id_offset: u32,
    pub vertex_id_len: u32,
    pub chunk_id_offset: u32,
    pub chunk_id_len: u32,
    pub document_id_offset: u32,
    pub document_id_len: u32,
    pub note_id_offset: u32,
    pub note_id_len: u32,
    pub chapter_id: u32,
    pub start: u32,
    pub end: u32,
    pub flags: u32,
}

impl GraphDeltaChunkRecord {
    pub const BYTE_LEN: usize = 48;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct GraphDeltaNodeRecord {
    pub node_id_offset: u32,
    pub node_id_len: u32,
    pub kind_offset: u32,
    pub kind_len: u32,
    pub label_offset: u32,
    pub label_len: u32,
    pub entity_id_offset: u32,
    pub entity_id_len: u32,
    pub document_id_offset: u32,
    pub document_id_len: u32,
    pub chapter_id: u32,
    pub weight: i32,
    pub flags: u32,
}

impl GraphDeltaNodeRecord {
    pub const BYTE_LEN: usize = 52;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct GraphDeltaEdgeRecord {
    pub source_id_offset: u32,
    pub source_id_len: u32,
    pub target_id_offset: u32,
    pub target_id_len: u32,
    pub edge_type_offset: u32,
    pub edge_type_len: u32,
    pub weight: i32,
    pub flags: u32,
}

impl GraphDeltaEdgeRecord {
    pub const BYTE_LEN: usize = 32;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct StringRefRecord {
    pub offset: u32,
    pub len: u32,
}

impl StringRefRecord {
    pub const BYTE_LEN: usize = 8;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct SessionDocumentRecord {
    pub document_id_offset: u32,
    pub document_id_len: u32,
    pub note_id_offset: u32,
    pub note_id_len: u32,
    pub chapter_titles_start: u32,
    pub chapter_titles_count: u32,
    pub chapter_count: u32,
    pub parent_count: u32,
    pub leaf_count: u32,
    pub entity_count: u32,
    pub discovery_count: u32,
    pub flags: u32,
    pub updated_at_bits: u64,
}

impl SessionDocumentRecord {
    pub const BYTE_LEN: usize = 56;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct SessionStatsRecord {
    pub document_count: u32,
    pub chapter_count: u32,
    pub parent_count: u32,
    pub leaf_count: u32,
    pub entity_count: u32,
    pub discovery_candidate_count: u32,
    pub graph_vertex_count: u32,
    pub graph_edge_count: u32,
    pub span_count: u32,
    pub updated_at_bits: u64,
}

impl SessionStatsRecord {
    pub const BYTE_LEN: usize = 44;
}

pub const BINARY_LAYOUT_VERSION: u32 = 1;

pub const FLAG_HAS_SESSION: u32 = 1 << 0;
pub const FLAG_HAS_NOTE_ID: u32 = 1 << 1;
pub const FLAG_HAS_ENTITY_ID: u32 = 1 << 2;
pub const FLAG_HAS_DOCUMENT_ID: u32 = 1 << 3;
pub const FLAG_HAS_FRONT_MATTER: u32 = 1 << 4;
