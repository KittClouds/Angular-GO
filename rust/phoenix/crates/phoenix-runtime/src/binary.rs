use phoenix_store_cozo::StoreError;
use phoenix_types::{
    ChunkHitRecord, Diagnostic, DiagnosticRecord, FLAG_HAS_DOCUMENT_ID, FLAG_HAS_ENTITY_ID,
    FLAG_HAS_FRONT_MATTER, FLAG_HAS_NOTE_ID, FLAG_HAS_SESSION, GraphDeltaChunk,
    GraphDeltaChunkRecord, GraphDeltaEdge, GraphDeltaEdgeRecord, GraphDeltaNode,
    GraphDeltaNodeRecord, GraphDeltaResult, GraphDeltaResultHeader, NodeHitRecord, QueryResult,
    QueryResultHeader, SessionDocumentRecord, SessionState, SessionStateResultHeader,
    SessionStats, SessionStatsRecord, SessionStatsResultHeader, StringRefRecord,
    BINARY_LAYOUT_VERSION,
};

pub fn encode_query_result(result: &QueryResult) -> Result<Vec<u8>, StoreError> {
    let mut builder = BinaryBuilder::new();
    let session = result
        .session_id
        .as_ref()
        .map(|session_id| builder.push_string(&session_id.0))
        .unwrap_or_default();
    let chunk_offset = QueryResultHeader::BYTE_LEN as u32;
    let mut chunk_records = Vec::with_capacity(result.chunk_hits.len());
    for hit in &result.chunk_hits {
        let chunk_id = builder.push_string(&hit.chunk_id);
        chunk_records.push(ChunkHitRecord {
            chunk_id_offset: chunk_id.offset,
            chunk_id_len: chunk_id.len,
            score_bits: hit.score.to_bits(),
        });
    }
    let node_offset = chunk_offset + (chunk_records.len() * ChunkHitRecord::BYTE_LEN) as u32;
    let mut node_records = Vec::with_capacity(result.node_hits.len());
    for hit in &result.node_hits {
        let entity_id = hit
            .entity_id
            .as_ref()
            .map(|entity_id| builder.push_string(&entity_id.0))
            .unwrap_or_default();
        node_records.push(NodeHitRecord {
            entity_id_offset: entity_id.offset,
            entity_id_len: entity_id.len,
            score_bits: hit.score.to_bits(),
        });
    }
    let diagnostic_offset = node_offset + (node_records.len() * NodeHitRecord::BYTE_LEN) as u32;
    let diagnostic_records = diagnostics_to_records(&mut builder, &result.diagnostics);
    let arena_offset =
        diagnostic_offset + (diagnostic_records.len() * DiagnosticRecord::BYTE_LEN) as u32;
    let header = QueryResultHeader {
        version: BINARY_LAYOUT_VERSION,
        flags: if result.session_id.is_some() {
            FLAG_HAS_SESSION
        } else {
            0
        },
        session_offset: session.offset,
        session_len: session.len,
        table1_offset: chunk_offset,
        table1_count: chunk_records.len() as u32,
        table2_offset: node_offset,
        table2_count: node_records.len() as u32,
        table3_offset: diagnostic_offset,
        table3_count: diagnostic_records.len() as u32,
        table4_offset: 0,
        table4_count: 0,
        arena_offset,
        arena_len: builder.len() as u32,
    };

    let mut bytes = Vec::with_capacity(arena_offset as usize + builder.len());
    header.write_to(&mut bytes);
    for record in &chunk_records {
        record.write_to(&mut bytes);
    }
    for record in &node_records {
        record.write_to(&mut bytes);
    }
    for record in &diagnostic_records {
        record.write_to(&mut bytes);
    }
    bytes.extend_from_slice(builder.bytes());
    Ok(bytes)
}

pub fn encode_graph_delta(result: &GraphDeltaResult) -> Result<Vec<u8>, StoreError> {
    let mut builder = BinaryBuilder::new();
    let session = builder.push_string(&result.session_id.0);
    let header_size = GraphDeltaResultHeader::BYTE_LEN as u32;
    let mut chunk_records = Vec::with_capacity(result.chunks.len());
    for chunk in &result.chunks {
        chunk_records.push(graph_delta_chunk_record(&mut builder, chunk));
    }
    let table2_offset = header_size + (chunk_records.len() * GraphDeltaChunkRecord::BYTE_LEN) as u32;
    let mut node_records = Vec::with_capacity(result.nodes.len());
    for node in &result.nodes {
        node_records.push(graph_delta_node_record(&mut builder, node));
    }
    let table3_offset = table2_offset + (node_records.len() * GraphDeltaNodeRecord::BYTE_LEN) as u32;
    let mut edge_records = Vec::with_capacity(result.edges.len());
    for edge in &result.edges {
        edge_records.push(graph_delta_edge_record(&mut builder, edge));
    }
    let table4_offset = table3_offset + (edge_records.len() * GraphDeltaEdgeRecord::BYTE_LEN) as u32;
    let diagnostic_records = diagnostics_to_records(&mut builder, &result.diagnostics);
    let arena_offset = table4_offset + (diagnostic_records.len() * DiagnosticRecord::BYTE_LEN) as u32;
    let header = GraphDeltaResultHeader {
        version: BINARY_LAYOUT_VERSION,
        flags: FLAG_HAS_SESSION,
        session_offset: session.offset,
        session_len: session.len,
        table1_offset: header_size,
        table1_count: chunk_records.len() as u32,
        table2_offset,
        table2_count: node_records.len() as u32,
        table3_offset,
        table3_count: edge_records.len() as u32,
        table4_offset,
        table4_count: diagnostic_records.len() as u32,
        arena_offset,
        arena_len: builder.len() as u32,
    };

    let mut bytes = Vec::with_capacity(arena_offset as usize + builder.len());
    header.write_to(&mut bytes);
    for record in &chunk_records {
        record.write_to(&mut bytes);
    }
    for record in &node_records {
        record.write_to(&mut bytes);
    }
    for record in &edge_records {
        record.write_to(&mut bytes);
    }
    for record in &diagnostic_records {
        record.write_to(&mut bytes);
    }
    bytes.extend_from_slice(builder.bytes());
    Ok(bytes)
}

pub fn encode_session_state(state: &SessionState) -> Result<Vec<u8>, StoreError> {
    let mut builder = BinaryBuilder::new();
    let session = builder.push_string(&state.session_id.0);
    let header_size = SessionStateResultHeader::BYTE_LEN as u32;
    let mut title_records = Vec::new();
    let mut document_records = Vec::with_capacity(state.documents.len());
    for document in &state.documents {
        let title_start = title_records.len() as u32;
        for title in &document.chapter_titles {
            let title_ref = builder.push_string(title);
            title_records.push(StringRefRecord {
                offset: title_ref.offset,
                len: title_ref.len,
            });
        }
        let document_id = builder.push_string(&document.document_id.0);
        let note_id = document
            .note_id
            .as_ref()
            .map(|note_id| builder.push_string(&note_id.0))
            .unwrap_or_default();
        let mut flags = 0;
        if document.note_id.is_some() {
            flags |= FLAG_HAS_NOTE_ID;
        }
        if document.has_front_matter_chapter {
            flags |= FLAG_HAS_FRONT_MATTER;
        }
        document_records.push(SessionDocumentRecord {
            document_id_offset: document_id.offset,
            document_id_len: document_id.len,
            note_id_offset: note_id.offset,
            note_id_len: note_id.len,
            chapter_titles_start: title_start,
            chapter_titles_count: document.chapter_titles.len() as u32,
            chapter_count: document.chapter_count as u32,
            parent_count: document.parent_count as u32,
            leaf_count: document.leaf_count as u32,
            entity_count: document.entity_count as u32,
            discovery_count: document.discovery_count as u32,
            flags,
            updated_at_bits: document.updated_at as u64,
        });
    }
    let table2_offset =
        header_size + (document_records.len() * SessionDocumentRecord::BYTE_LEN) as u32;
    let namespace_records = state
        .manifest_namespaces
        .iter()
        .map(|namespace| {
            let string_ref = builder.push_string(namespace);
            StringRefRecord {
                offset: string_ref.offset,
                len: string_ref.len,
            }
        })
        .collect::<Vec<_>>();
    let arena_offset =
        table2_offset + (title_records.len() * StringRefRecord::BYTE_LEN) as u32
            + (namespace_records.len() * StringRefRecord::BYTE_LEN) as u32;
    let header = SessionStateResultHeader {
        version: BINARY_LAYOUT_VERSION,
        flags: FLAG_HAS_SESSION,
        session_offset: session.offset,
        session_len: session.len,
        table1_offset: header_size,
        table1_count: document_records.len() as u32,
        table2_offset,
        table2_count: title_records.len() as u32,
        table3_offset: table2_offset + (title_records.len() * StringRefRecord::BYTE_LEN) as u32,
        table3_count: namespace_records.len() as u32,
        table4_offset: 0,
        table4_count: 0,
        arena_offset,
        arena_len: builder.len() as u32,
    };

    let mut bytes = Vec::with_capacity(arena_offset as usize + builder.len());
    header.write_to(&mut bytes);
    for record in &document_records {
        record.write_to(&mut bytes);
    }
    for record in &title_records {
        record.write_to(&mut bytes);
    }
    for record in &namespace_records {
        record.write_to(&mut bytes);
    }
    bytes.extend_from_slice(builder.bytes());
    Ok(bytes)
}

pub fn encode_session_stats(stats: &SessionStats) -> Result<Vec<u8>, StoreError> {
    let mut builder = BinaryBuilder::new();
    let session = builder.push_string(&stats.session_id.0);
    let header = SessionStatsResultHeader {
        version: BINARY_LAYOUT_VERSION,
        flags: FLAG_HAS_SESSION,
        session_offset: session.offset,
        session_len: session.len,
        table1_offset: SessionStatsResultHeader::BYTE_LEN as u32,
        table1_count: 1,
        table2_offset: 0,
        table2_count: 0,
        table3_offset: 0,
        table3_count: 0,
        table4_offset: 0,
        table4_count: 0,
        arena_offset: (SessionStatsResultHeader::BYTE_LEN + SessionStatsRecord::BYTE_LEN) as u32,
        arena_len: builder.len() as u32,
    };
    let record = SessionStatsRecord {
        document_count: stats.document_count as u32,
        chapter_count: stats.chapter_count as u32,
        parent_count: stats.parent_count as u32,
        leaf_count: stats.leaf_count as u32,
        entity_count: stats.entity_count as u32,
        discovery_candidate_count: stats.discovery_candidate_count as u32,
        graph_vertex_count: stats.graph_vertex_count as u32,
        graph_edge_count: stats.graph_edge_count as u32,
        span_count: stats.span_count as u32,
        updated_at_bits: stats.updated_at as u64,
    };

    let mut bytes = Vec::with_capacity(header.arena_offset as usize + builder.len());
    header.write_to(&mut bytes);
    record.write_to(&mut bytes);
    bytes.extend_from_slice(builder.bytes());
    Ok(bytes)
}

fn diagnostics_to_records(
    builder: &mut BinaryBuilder,
    diagnostics: &[Diagnostic],
) -> Vec<DiagnosticRecord> {
    diagnostics
        .iter()
        .map(|diagnostic| {
            let code = builder.push_string(&diagnostic.code);
            let message = builder.push_string(&diagnostic.message);
            DiagnosticRecord {
                code_offset: code.offset,
                code_len: code.len,
                message_offset: message.offset,
                message_len: message.len,
            }
        })
        .collect()
}

fn graph_delta_chunk_record(
    builder: &mut BinaryBuilder,
    chunk: &GraphDeltaChunk,
) -> GraphDeltaChunkRecord {
    let vertex_id = builder.push_string(&chunk.vertex_id);
    let chunk_id = builder.push_string(&chunk.chunk_id);
    let document_id = builder.push_string(&chunk.document_id.0);
    let note_id = chunk
        .note_id
        .as_ref()
        .map(|note_id| builder.push_string(&note_id.0))
        .unwrap_or_default();
    GraphDeltaChunkRecord {
        vertex_id_offset: vertex_id.offset,
        vertex_id_len: vertex_id.len,
        chunk_id_offset: chunk_id.offset,
        chunk_id_len: chunk_id.len,
        document_id_offset: document_id.offset,
        document_id_len: document_id.len,
        note_id_offset: note_id.offset,
        note_id_len: note_id.len,
        chapter_id: chunk.chapter_id,
        start: chunk.range.start,
        end: chunk.range.end,
        flags: if chunk.note_id.is_some() {
            FLAG_HAS_NOTE_ID
        } else {
            0
        },
    }
}

fn graph_delta_node_record(builder: &mut BinaryBuilder, node: &GraphDeltaNode) -> GraphDeltaNodeRecord {
    let node_id = builder.push_string(&node.node_id);
    let kind = builder.push_string(&node.kind);
    let label = builder.push_string(&node.label);
    let entity_id = node
        .entity_id
        .as_ref()
        .map(|entity_id| builder.push_string(&entity_id.0))
        .unwrap_or_default();
    let document_id = node
        .document_id
        .as_ref()
        .map(|document_id| builder.push_string(&document_id.0))
        .unwrap_or_default();
    let mut flags = 0;
    if node.entity_id.is_some() {
        flags |= FLAG_HAS_ENTITY_ID;
    }
    if node.document_id.is_some() {
        flags |= FLAG_HAS_DOCUMENT_ID;
    }
    GraphDeltaNodeRecord {
        node_id_offset: node_id.offset,
        node_id_len: node_id.len,
        kind_offset: kind.offset,
        kind_len: kind.len,
        label_offset: label.offset,
        label_len: label.len,
        entity_id_offset: entity_id.offset,
        entity_id_len: entity_id.len,
        document_id_offset: document_id.offset,
        document_id_len: document_id.len,
        chapter_id: node.chapter_id.unwrap_or_default(),
        weight: node.weight,
        flags,
    }
}

fn graph_delta_edge_record(builder: &mut BinaryBuilder, edge: &GraphDeltaEdge) -> GraphDeltaEdgeRecord {
    let source_id = builder.push_string(&edge.source_id);
    let target_id = builder.push_string(&edge.target_id);
    let edge_type = builder.push_string(&edge.edge_type);
    GraphDeltaEdgeRecord {
        source_id_offset: source_id.offset,
        source_id_len: source_id.len,
        target_id_offset: target_id.offset,
        target_id_len: target_id.len,
        edge_type_offset: edge_type.offset,
        edge_type_len: edge_type.len,
        weight: edge.weight,
        flags: 0,
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct PackedStringRef {
    offset: u32,
    len: u32,
}

#[derive(Default)]
struct BinaryBuilder {
    arena: Vec<u8>,
}

impl BinaryBuilder {
    fn new() -> Self {
        Self { arena: Vec::new() }
    }

    fn push_string(&mut self, value: &str) -> PackedStringRef {
        let offset = self.arena.len() as u32;
        self.arena.extend_from_slice(value.as_bytes());
        PackedStringRef {
            offset,
            len: value.len() as u32,
        }
    }

    fn len(&self) -> usize {
        self.arena.len()
    }

    fn bytes(&self) -> &[u8] {
        &self.arena
    }
}

trait WriteBinary {
    fn write_to(&self, bytes: &mut Vec<u8>);
}

macro_rules! impl_header_writer {
    ($name:ident) => {
        impl WriteBinary for $name {
            fn write_to(&self, bytes: &mut Vec<u8>) {
                bytes.extend_from_slice(&self.version.to_le_bytes());
                bytes.extend_from_slice(&self.flags.to_le_bytes());
                bytes.extend_from_slice(&self.session_offset.to_le_bytes());
                bytes.extend_from_slice(&self.session_len.to_le_bytes());
                bytes.extend_from_slice(&self.table1_offset.to_le_bytes());
                bytes.extend_from_slice(&self.table1_count.to_le_bytes());
                bytes.extend_from_slice(&self.table2_offset.to_le_bytes());
                bytes.extend_from_slice(&self.table2_count.to_le_bytes());
                bytes.extend_from_slice(&self.table3_offset.to_le_bytes());
                bytes.extend_from_slice(&self.table3_count.to_le_bytes());
                bytes.extend_from_slice(&self.table4_offset.to_le_bytes());
                bytes.extend_from_slice(&self.table4_count.to_le_bytes());
                bytes.extend_from_slice(&self.arena_offset.to_le_bytes());
                bytes.extend_from_slice(&self.arena_len.to_le_bytes());
            }
        }
    };
}

impl_header_writer!(QueryResultHeader);
impl_header_writer!(GraphDeltaResultHeader);
impl_header_writer!(SessionStateResultHeader);
impl_header_writer!(SessionStatsResultHeader);

macro_rules! impl_record_writer {
    ($name:ident, $len:expr, |$value:ident, $bytes:ident| $body:block) => {
        impl WriteBinary for $name {
            fn write_to(&self, $bytes: &mut Vec<u8>) {
                let $value = self;
                $body
            }
        }
    };
}

impl_record_writer!(ChunkHitRecord, 16, |value, bytes| {
    bytes.extend_from_slice(&value.chunk_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.chunk_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.score_bits.to_le_bytes());
});
impl_record_writer!(NodeHitRecord, 16, |value, bytes| {
    bytes.extend_from_slice(&value.entity_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.entity_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.score_bits.to_le_bytes());
});
impl_record_writer!(DiagnosticRecord, 16, |value, bytes| {
    bytes.extend_from_slice(&value.code_offset.to_le_bytes());
    bytes.extend_from_slice(&value.code_len.to_le_bytes());
    bytes.extend_from_slice(&value.message_offset.to_le_bytes());
    bytes.extend_from_slice(&value.message_len.to_le_bytes());
});
impl_record_writer!(GraphDeltaChunkRecord, 48, |value, bytes| {
    bytes.extend_from_slice(&value.vertex_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.vertex_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.chunk_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.chunk_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.document_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.document_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.note_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.note_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.chapter_id.to_le_bytes());
    bytes.extend_from_slice(&value.start.to_le_bytes());
    bytes.extend_from_slice(&value.end.to_le_bytes());
    bytes.extend_from_slice(&value.flags.to_le_bytes());
});
impl_record_writer!(GraphDeltaNodeRecord, 52, |value, bytes| {
    bytes.extend_from_slice(&value.node_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.node_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.kind_offset.to_le_bytes());
    bytes.extend_from_slice(&value.kind_len.to_le_bytes());
    bytes.extend_from_slice(&value.label_offset.to_le_bytes());
    bytes.extend_from_slice(&value.label_len.to_le_bytes());
    bytes.extend_from_slice(&value.entity_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.entity_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.document_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.document_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.chapter_id.to_le_bytes());
    bytes.extend_from_slice(&value.weight.to_le_bytes());
    bytes.extend_from_slice(&value.flags.to_le_bytes());
});
impl_record_writer!(GraphDeltaEdgeRecord, 32, |value, bytes| {
    bytes.extend_from_slice(&value.source_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.source_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.target_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.target_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.edge_type_offset.to_le_bytes());
    bytes.extend_from_slice(&value.edge_type_len.to_le_bytes());
    bytes.extend_from_slice(&value.weight.to_le_bytes());
    bytes.extend_from_slice(&value.flags.to_le_bytes());
});
impl_record_writer!(StringRefRecord, 8, |value, bytes| {
    bytes.extend_from_slice(&value.offset.to_le_bytes());
    bytes.extend_from_slice(&value.len.to_le_bytes());
});
impl_record_writer!(SessionDocumentRecord, 56, |value, bytes| {
    bytes.extend_from_slice(&value.document_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.document_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.note_id_offset.to_le_bytes());
    bytes.extend_from_slice(&value.note_id_len.to_le_bytes());
    bytes.extend_from_slice(&value.chapter_titles_start.to_le_bytes());
    bytes.extend_from_slice(&value.chapter_titles_count.to_le_bytes());
    bytes.extend_from_slice(&value.chapter_count.to_le_bytes());
    bytes.extend_from_slice(&value.parent_count.to_le_bytes());
    bytes.extend_from_slice(&value.leaf_count.to_le_bytes());
    bytes.extend_from_slice(&value.entity_count.to_le_bytes());
    bytes.extend_from_slice(&value.discovery_count.to_le_bytes());
    bytes.extend_from_slice(&value.flags.to_le_bytes());
    bytes.extend_from_slice(&value.updated_at_bits.to_le_bytes());
});
impl_record_writer!(SessionStatsRecord, 44, |value, bytes| {
    bytes.extend_from_slice(&value.document_count.to_le_bytes());
    bytes.extend_from_slice(&value.chapter_count.to_le_bytes());
    bytes.extend_from_slice(&value.parent_count.to_le_bytes());
    bytes.extend_from_slice(&value.leaf_count.to_le_bytes());
    bytes.extend_from_slice(&value.entity_count.to_le_bytes());
    bytes.extend_from_slice(&value.discovery_candidate_count.to_le_bytes());
    bytes.extend_from_slice(&value.graph_vertex_count.to_le_bytes());
    bytes.extend_from_slice(&value.graph_edge_count.to_le_bytes());
    bytes.extend_from_slice(&value.span_count.to_le_bytes());
    bytes.extend_from_slice(&value.updated_at_bits.to_le_bytes());
});
