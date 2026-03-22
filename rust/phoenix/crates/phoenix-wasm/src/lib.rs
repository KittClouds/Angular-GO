use std::cell::RefCell;

use phoenix_runtime::PhoenixRuntime;
use phoenix_types::{
    CommitRequest, CreateSessionRequest, Diagnostic, IngestRequest, PacketHeader, PacketKind,
    QueryRequest, RebuildRequest, RuntimeInitRequest,
};
#[cfg(target_arch = "wasm32")]
use serde::Serialize;
#[cfg(target_arch = "wasm32")]
use phoenix_types::SnapshotPolicy;

#[cfg(target_arch = "wasm32")]
mod opfs;

pub const PHOENIX_PROTOCOL_VERSION: u32 = 2;
pub const DEFAULT_PACKET_REGION_SIZE: usize = 64 * 1024;

thread_local! {
    static RUNTIME: RefCell<Option<PhoenixRuntime>> = const { RefCell::new(None) };
    #[cfg(target_arch = "wasm32")]
    static OPFS_STATUS: RefCell<OpfsStatus> = RefCell::new(OpfsStatus::idle());
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpfsStatus {
    phase: &'static str,
    operation: &'static str,
    snapshot_bytes: usize,
    recovered_from_backup: bool,
    message: String,
}

#[cfg(target_arch = "wasm32")]
impl OpfsStatus {
    const fn idle() -> Self {
        Self {
            phase: "idle",
            operation: "none",
            snapshot_bytes: 0,
            recovered_from_backup: false,
            message: String::new(),
        }
    }

    fn pending(operation: &'static str, message: &str) -> Self {
        Self {
            phase: "pending",
            operation,
            snapshot_bytes: 0,
            recovered_from_backup: false,
            message: message.to_owned(),
        }
    }

    fn success(
        operation: &'static str,
        snapshot_bytes: usize,
        recovered_from_backup: bool,
        message: &str,
    ) -> Self {
        Self {
            phase: "succeeded",
            operation,
            snapshot_bytes,
            recovered_from_backup,
            message: message.to_owned(),
        }
    }

    fn failed(operation: &'static str, message: &str) -> Self {
        Self {
            phase: "failed",
            operation,
            snapshot_bytes: 0,
            recovered_from_backup: false,
            message: message.to_owned(),
        }
    }
}

pub fn packet_header_size() -> usize {
    PacketHeader::BYTE_LEN
}

#[cfg(target_arch = "wasm32")]
fn opfs_status_json() -> String {
    OPFS_STATUS.with(|cell| {
        serde_json::to_string(&*cell.borrow()).expect("serialize opfs status")
    })
}

#[cfg(target_arch = "wasm32")]
fn set_opfs_status(status: OpfsStatus) {
    OPFS_STATUS.with(|cell| {
        *cell.borrow_mut() = status;
    });
}

#[cfg(target_arch = "wasm32")]
fn should_auto_save_on_commit() -> bool {
    RUNTIME.with(|cell| {
        cell.borrow()
            .as_ref()
            .map(|runtime| runtime.config.snapshot_policy == SnapshotPolicy::OnCommit)
            .unwrap_or(false)
    })
}

pub fn process_packet_buffer(buffer: &mut [u8]) -> Result<(), String> {
    if buffer.len() < PacketHeader::BYTE_LEN {
        return Err("buffer too small for packet header".to_owned());
    }

    let header_bytes: [u8; PacketHeader::BYTE_LEN] = buffer[..PacketHeader::BYTE_LEN]
        .try_into()
        .map_err(|_| "invalid packet header".to_owned())?;
    let header = PacketHeader::from_le_bytes(header_bytes);
    let payload_end = PacketHeader::BYTE_LEN + header.payload_len as usize;
    if payload_end > buffer.len() {
        return Err("payload length exceeds packet region".to_owned());
    }

    match header.packet_kind() {
        PacketKind::InitRuntimeRequest => {
            let request: RuntimeInitRequest = decode_json(&buffer[PacketHeader::BYTE_LEN..payload_end])?;
            let runtime = PhoenixRuntime::open(
                request.config.clone(),
                request.storage_path.map(Into::into),
            )
            .map_err(|error| error.to_string())?;
            let result = runtime.init().map_err(|error| error.to_string())?;
            RUNTIME.with(|cell| {
                *cell.borrow_mut() = Some(runtime);
            });
            write_json_response(buffer, PacketKind::InitRuntimeResult, header.request_id, &result)
        }
        PacketKind::CreateSessionRequest => with_runtime(|runtime| {
            let request: CreateSessionRequest =
                decode_json(&buffer[PacketHeader::BYTE_LEN..payload_end])?;
            let result = runtime
                .create_session(request)
                .map_err(|error| error.to_string())?;
            write_json_response(buffer, PacketKind::CreateSessionResult, header.request_id, &result)
        }),
        PacketKind::CommitRequest => with_runtime(|runtime| {
            let request: CommitRequest =
                decode_json(&buffer[PacketHeader::BYTE_LEN..payload_end])?;
            let result = runtime.commit(request).map_err(|error| error.to_string())?;
            write_json_response(buffer, PacketKind::CommitResult, header.request_id, &result)?;
            #[cfg(target_arch = "wasm32")]
            if should_auto_save_on_commit() {
                let _ = phoenix_opfs_save_snapshot();
            }
            Ok(())
        }),
        PacketKind::RebuildRequest => with_runtime(|runtime| {
            let request: RebuildRequest =
                decode_json(&buffer[PacketHeader::BYTE_LEN..payload_end])?;
            let result = runtime.rebuild(request).map_err(|error| error.to_string())?;
            write_json_response(buffer, PacketKind::RebuildResult, header.request_id, &result)
        }),
        PacketKind::IngestRequest => with_runtime(|runtime| {
            let request: IngestRequest =
                decode_json(&buffer[PacketHeader::BYTE_LEN..payload_end])?;
            #[cfg(target_arch = "wasm32")]
            let should_auto_save = request.commit;
            let result = runtime
                .ingest_stub(request)
                .map_err(|error| error.to_string())?;
            write_json_response(buffer, PacketKind::IngestResult, header.request_id, &result)?;
            #[cfg(target_arch = "wasm32")]
            if should_auto_save && should_auto_save_on_commit() {
                let _ = phoenix_opfs_save_snapshot();
            }
            Ok(())
        }),
        PacketKind::QueryRequest => with_runtime(|runtime| {
            let request: QueryRequest =
                decode_json(&buffer[PacketHeader::BYTE_LEN..payload_end])?;
            let result = runtime.query_stub(request).map_err(|error| error.to_string())?;
            write_json_response(buffer, PacketKind::QueryResult, header.request_id, &result)
        }),
        PacketKind::SnapshotExportRequest => with_runtime(|runtime| {
            let bytes = runtime.export_snapshot().map_err(|error| error.to_string())?;
            write_binary_response(buffer, PacketKind::SnapshotResult, header.request_id, &bytes)
        }),
        PacketKind::SnapshotImportRequest => with_runtime(|runtime| {
            let snapshot_len = header.payload_len as usize;
            let envelope = runtime
                .import_snapshot(&buffer[PacketHeader::BYTE_LEN..payload_end])
                .map_err(|error| error.to_string())?;
            let descriptor = runtime.snapshot_descriptor(envelope.created_at, snapshot_len);
            write_json_response(buffer, PacketKind::SnapshotResult, header.request_id, &descriptor)
        }),
        kind => write_error_response(
            buffer,
            header.request_id,
            &format!("unsupported packet kind: {kind:?}"),
        ),
    }
}

fn with_runtime<T>(
    operation: impl FnOnce(&PhoenixRuntime) -> Result<T, String>,
) -> Result<T, String> {
    RUNTIME.with(|cell| {
        let borrow = cell.borrow();
        let runtime = borrow.as_ref().ok_or_else(|| "runtime not initialized".to_owned())?;
        operation(runtime)
    })
}

fn decode_json<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    serde_json::from_slice(bytes).map_err(|error| error.to_string())
}

fn write_json_response<T: serde::Serialize>(
    buffer: &mut [u8],
    kind: PacketKind,
    request_id: u32,
    payload: &T,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    write_binary_response(buffer, kind, request_id, &bytes)
}

fn write_error_response(buffer: &mut [u8], request_id: u32, message: &str) -> Result<(), String> {
    let diagnostic = Diagnostic {
        code: "PX_PACKET_ERROR".to_owned(),
        message: message.to_owned(),
    };
    write_json_response(buffer, PacketKind::Status, request_id, &diagnostic)
}

fn write_binary_response(
    buffer: &mut [u8],
    kind: PacketKind,
    request_id: u32,
    payload: &[u8],
) -> Result<(), String> {
    let total_len = PacketHeader::BYTE_LEN + payload.len();
    if total_len > buffer.len() {
        return Err("response payload exceeds packet region".to_owned());
    }

    let header = PacketHeader::new(1, kind, request_id, payload.len() as u32);
    buffer[..PacketHeader::BYTE_LEN].copy_from_slice(&header.to_le_bytes());
    buffer[PacketHeader::BYTE_LEN..total_len].copy_from_slice(payload);
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_wasm_protocol_version() -> u32 {
    PHOENIX_PROTOCOL_VERSION
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_packet_header_size() -> usize {
    packet_header_size()
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_alloc(size: usize) -> *mut u8 {
    let mut bytes = Vec::<u8>::with_capacity(size.max(1));
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_dealloc(ptr: *mut u8, capacity: usize) {
    if !ptr.is_null() {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, 0, capacity.max(1));
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_process_packet_at(offset: usize, capacity: usize) -> i32 {
    let result = unsafe {
        let slice = std::slice::from_raw_parts_mut(offset as *mut u8, capacity);
        process_packet_buffer(slice)
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            unsafe {
                let slice = std::slice::from_raw_parts_mut(offset as *mut u8, capacity);
                let _ = write_error_response(slice, 0, &error);
            }
            -1
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_opfs_save_snapshot() -> i32 {
    let snapshot = match with_runtime(|runtime| runtime.export_snapshot().map_err(|error| error.to_string())) {
        Ok(bytes) => bytes,
        Err(error) => {
            set_opfs_status(OpfsStatus::failed("save", &error));
            return -1;
        }
    };

    set_opfs_status(OpfsStatus::pending("save", "Saving Phoenix snapshot to OPFS"));
    wasm_bindgen_futures::spawn_local(async move {
        match opfs::save_snapshot(&snapshot).await {
            Ok(snapshot_bytes) => {
                set_opfs_status(OpfsStatus::success(
                    "save",
                    snapshot_bytes,
                    false,
                    "Phoenix snapshot saved to OPFS",
                ));
            }
            Err(error) => {
                set_opfs_status(OpfsStatus::failed("save", &error));
            }
        }
    });

    0
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_opfs_load_snapshot() -> i32 {
    if with_runtime(|_| Ok(())).is_err() {
        let message = "runtime not initialized";
        set_opfs_status(OpfsStatus::failed("load", message));
        return -1;
    }

    set_opfs_status(OpfsStatus::pending("load", "Loading Phoenix snapshot from OPFS"));
    wasm_bindgen_futures::spawn_local(async move {
        match opfs::load_snapshot().await {
            Ok(load) => match load.bytes {
                Some(bytes) => {
                    let recovered_from_backup = load.recovered_from_backup;
                    let snapshot_bytes = bytes.len();
                    let import_result =
                        with_runtime(|runtime| runtime.import_snapshot(&bytes).map_err(|error| error.to_string()));

                    match import_result {
                        Ok(_) => {
                            let message = if recovered_from_backup {
                                "Phoenix snapshot restored from OPFS backup"
                            } else {
                                "Phoenix snapshot restored from OPFS"
                            };
                            set_opfs_status(OpfsStatus::success(
                                "load",
                                snapshot_bytes,
                                recovered_from_backup,
                                message,
                            ));
                        }
                        Err(error) => {
                            set_opfs_status(OpfsStatus::failed("load", &error));
                        }
                    }
                }
                None => {
                    set_opfs_status(OpfsStatus::success(
                        "load",
                        0,
                        false,
                        "No Phoenix snapshot found in OPFS",
                    ));
                }
            },
            Err(error) => {
                set_opfs_status(OpfsStatus::failed("load", &error));
            }
        }
    });

    0
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_opfs_clear_snapshot() -> i32 {
    set_opfs_status(OpfsStatus::pending("clear", "Clearing Phoenix snapshot from OPFS"));
    wasm_bindgen_futures::spawn_local(async move {
        match opfs::clear_snapshot().await {
            Ok(()) => {
                set_opfs_status(OpfsStatus::success(
                    "clear",
                    0,
                    false,
                    "Phoenix snapshot cleared from OPFS",
                ));
            }
            Err(error) => {
                set_opfs_status(OpfsStatus::failed("clear", &error));
            }
        }
    });

    0
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_opfs_status_len() -> usize {
    opfs_status_json().len()
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn phoenix_opfs_write_status_at(offset: usize, capacity: usize) -> usize {
    let bytes = opfs_status_json().into_bytes();
    let write_len = bytes.len().min(capacity);
    unsafe {
        let dest = std::slice::from_raw_parts_mut(offset as *mut u8, capacity);
        dest[..write_len].copy_from_slice(&bytes[..write_len]);
    }
    bytes.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use phoenix_types::{
        CreateSessionRequest, DocumentId, QueryTarget, RuntimeConfig, RuntimeInitResult, ScopeKey,
        SessionRecord, SnapshotDto,
    };

    fn packet(kind: PacketKind, request_id: u32, payload: &[u8]) -> Vec<u8> {
        let mut buffer = vec![0_u8; DEFAULT_PACKET_REGION_SIZE];
        let header = PacketHeader::new(1, kind, request_id, payload.len() as u32);
        buffer[..PacketHeader::BYTE_LEN].copy_from_slice(&header.to_le_bytes());
        buffer[PacketHeader::BYTE_LEN..PacketHeader::BYTE_LEN + payload.len()]
            .copy_from_slice(payload);
        buffer
    }

    fn decode_header(buffer: &[u8]) -> PacketHeader {
        PacketHeader::from_le_bytes(buffer[..PacketHeader::BYTE_LEN].try_into().expect("header"))
    }

    #[test]
    fn packet_header_size_matches_shared_contract() {
        assert_eq!(packet_header_size(), 16);
    }

    #[test]
    fn shared_memory_runtime_init_and_session_round_trip() {
        let init_payload = serde_json::to_vec(&RuntimeInitRequest {
            config: RuntimeConfig::default(),
            storage_path: None,
            force_reset: false,
        })
        .expect("init payload");
        let mut init_packet = packet(PacketKind::InitRuntimeRequest, 7, &init_payload);
        process_packet_buffer(&mut init_packet).expect("init packet");

        let init_header = decode_header(&init_packet);
        assert_eq!(init_header.packet_kind(), PacketKind::InitRuntimeResult);
        let init_result: RuntimeInitResult = serde_json::from_slice(
            &init_packet[PacketHeader::BYTE_LEN..PacketHeader::BYTE_LEN + init_header.payload_len as usize],
        )
        .expect("init result");
        assert!(init_result.ready);

        let session_payload = serde_json::to_vec(&CreateSessionRequest {
            session_id: None,
            label: "Shared".to_owned(),
            scope: ScopeKey::default(),
        })
        .expect("session payload");
        let mut session_packet = packet(PacketKind::CreateSessionRequest, 8, &session_payload);
        process_packet_buffer(&mut session_packet).expect("session packet");

        let session_header = decode_header(&session_packet);
        assert_eq!(session_header.packet_kind(), PacketKind::CreateSessionResult);
        let session: SessionRecord = serde_json::from_slice(
            &session_packet[PacketHeader::BYTE_LEN
                ..PacketHeader::BYTE_LEN + session_header.payload_len as usize],
        )
        .expect("session result");
        assert_eq!(session.label, "Shared");
    }

    #[test]
    fn shared_memory_ingest_query_and_snapshot_round_trip() {
        let init_payload = serde_json::to_vec(&RuntimeInitRequest {
            config: RuntimeConfig::default(),
            storage_path: None,
            force_reset: false,
        })
        .expect("init payload");
        let mut init_packet = packet(PacketKind::InitRuntimeRequest, 1, &init_payload);
        process_packet_buffer(&mut init_packet).expect("init packet");

        let session_payload = serde_json::to_vec(&CreateSessionRequest {
            session_id: None,
            label: "RoundTrip".to_owned(),
            scope: ScopeKey::default(),
        })
        .expect("session payload");
        let mut session_packet = packet(PacketKind::CreateSessionRequest, 2, &session_payload);
        process_packet_buffer(&mut session_packet).expect("session packet");
        let session_header = decode_header(&session_packet);
        let session: SessionRecord = serde_json::from_slice(
            &session_packet[PacketHeader::BYTE_LEN
                ..PacketHeader::BYTE_LEN + session_header.payload_len as usize],
        )
        .expect("session result");

        let ingest_payload = serde_json::to_vec(&IngestRequest {
            session_id: Some(session.session_id.clone()),
            documents: vec![phoenix_types::IngestDocument {
                document_id: DocumentId("packet-doc".to_owned()),
                note_id: None,
                title: "Packet Note".to_owned(),
                text: "Phoenix packets are alive.".to_owned(),
                scope: ScopeKey::default(),
            }],
            commit: false,
        })
        .expect("ingest payload");
        let mut ingest_packet = packet(PacketKind::IngestRequest, 3, &ingest_payload);
        process_packet_buffer(&mut ingest_packet).expect("ingest packet");

        let query_payload = serde_json::to_vec(&QueryRequest {
            session_id: Some(session.session_id),
            query: "phoenix".to_owned(),
            scope: ScopeKey::default(),
            targets: vec![QueryTarget::Chunks],
            limit: Some(3),
            temporal: None,
        })
        .expect("query payload");
        let mut query_packet = packet(PacketKind::QueryRequest, 4, &query_payload);
        process_packet_buffer(&mut query_packet).expect("query packet");
        let query_header = decode_header(&query_packet);
        let query: phoenix_types::QueryResult = serde_json::from_slice(
            &query_packet[PacketHeader::BYTE_LEN
                ..PacketHeader::BYTE_LEN + query_header.payload_len as usize],
        )
        .expect("query result");
        assert_eq!(query.chunk_hits.len(), 1);

        let mut export_packet = packet(PacketKind::SnapshotExportRequest, 5, &[]);
        process_packet_buffer(&mut export_packet).expect("snapshot export");
        let export_header = decode_header(&export_packet);
        assert_eq!(export_header.packet_kind(), PacketKind::SnapshotResult);

        let snapshot_bytes =
            export_packet[PacketHeader::BYTE_LEN..PacketHeader::BYTE_LEN + export_header.payload_len as usize]
                .to_vec();
        let mut import_packet = packet(PacketKind::SnapshotImportRequest, 6, &snapshot_bytes);
        process_packet_buffer(&mut import_packet).expect("snapshot import");
        let import_header = decode_header(&import_packet);
        let snapshot_result: SnapshotDto = serde_json::from_slice(
            &import_packet[PacketHeader::BYTE_LEN
                ..PacketHeader::BYTE_LEN + import_header.payload_len as usize],
        )
        .expect("snapshot descriptor");
        assert_eq!(snapshot_result.schema_version, "phoenix.cozo.v1");
    }
}
