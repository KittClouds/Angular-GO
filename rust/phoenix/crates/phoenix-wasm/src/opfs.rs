#[cfg(target_arch = "wasm32")]
const SNAPSHOT_DIR: &str = "/phoenix";
#[cfg(target_arch = "wasm32")]
const SNAPSHOT_PATH: &str = "/phoenix/runtime.snapshot.json";
#[cfg(target_arch = "wasm32")]
const BACKUP_PATH: &str = "/phoenix/runtime.snapshot.json.bak";
#[cfg(target_arch = "wasm32")]
const TEMP_PREFIX: &str = "/phoenix/runtime.snapshot.tmp";
#[cfg(target_arch = "wasm32")]
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;

#[cfg(target_arch = "wasm32")]
pub struct LoadSnapshot {
    pub bytes: Option<Vec<u8>>,
    pub recovered_from_backup: bool,
}

#[cfg(target_arch = "wasm32")]
pub async fn save_snapshot(bytes: &[u8]) -> Result<usize, String> {
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(format!(
            "snapshot too large: {} bytes exceeds {}",
            bytes.len(),
            MAX_SNAPSHOT_BYTES
        ));
    }

    let _ = tokio_fs_ext::create_dir_all(SNAPSHOT_DIR).await;

    let temp_path = format!("{}-{}", TEMP_PREFIX, js_sys::Date::now() as u64);
    tokio_fs_ext::write(&temp_path, bytes)
        .await
        .map_err(|error| format!("temp write failed: {:?}", error))?;

    let _ = copy_file(SNAPSHOT_PATH, BACKUP_PATH).await;

    if let Err(error) = copy_file(&temp_path, SNAPSHOT_PATH).await {
        let _ = tokio_fs_ext::remove_file(&temp_path).await;
        return Err(error);
    }

    let _ = tokio_fs_ext::remove_file(&temp_path).await;
    Ok(bytes.len())
}

#[cfg(target_arch = "wasm32")]
pub async fn load_snapshot() -> Result<LoadSnapshot, String> {
    if let Some(bytes) = read_file(SNAPSHOT_PATH).await? {
        return Ok(LoadSnapshot {
            bytes: Some(bytes),
            recovered_from_backup: false,
        });
    }

    if let Some(bytes) = read_file(BACKUP_PATH).await? {
        return Ok(LoadSnapshot {
            bytes: Some(bytes),
            recovered_from_backup: true,
        });
    }

    Ok(LoadSnapshot {
        bytes: None,
        recovered_from_backup: false,
    })
}

#[cfg(target_arch = "wasm32")]
pub async fn clear_snapshot() -> Result<(), String> {
    let _ = tokio_fs_ext::remove_file(SNAPSHOT_PATH).await;
    let _ = tokio_fs_ext::remove_file(BACKUP_PATH).await;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
async fn copy_file(src: &str, dst: &str) -> Result<(), String> {
    let bytes = match read_file(src).await? {
        Some(bytes) => bytes,
        None => return Ok(()),
    };
    tokio_fs_ext::write(dst, &bytes)
        .await
        .map_err(|error| format!("copy write failed: {:?}", error))?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
async fn read_file(path: &str) -> Result<Option<Vec<u8>>, String> {
    let project = opfs_project::OpfsProject::default();
    project.set_cwd(SNAPSHOT_DIR);

    let file_name = path
        .trim_start_matches(SNAPSHOT_DIR)
        .trim_start_matches('/')
        .to_owned();

    match project.read(&file_name).await {
        Ok(bytes) => Ok(Some(bytes.to_vec())),
        Err(error) => {
            if matches!(error.kind(), std::io::ErrorKind::NotFound) {
                Ok(None)
            } else {
                Err(format!("read failed: {:?}", error))
            }
        }
    }
}
