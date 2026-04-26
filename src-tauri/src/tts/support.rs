use std::env;
use std::path::{Path, PathBuf};
use std::sync::Once;
use std::time::Instant;

use half::f16;
use ort::memory::{AllocationDevice, AllocatorType, MemoryInfo, MemoryType};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::{DynValue, TensorRefMut};

use super::runtime::ChatterboxConfig;

static ORT_INIT: Once = Once::new();

pub fn configure_ort() {
    ORT_INIT.call_once(|| {
        if env::var_os("ORT_DYLIB_PATH").is_some() {
            return;
        }
        if let Some(path) = default_ort_dylib_path(&project_root()) {
            env::set_var("ORT_DYLIB_PATH", path);
        }
    });
}

pub fn cpu_memory_info() -> Result<MemoryInfo, String> {
    MemoryInfo::new(
        AllocationDevice::CPU,
        0,
        AllocatorType::Arena,
        MemoryType::CPUInput,
    )
    .map_err(|error| format!("cpu memory info: {error}"))
}

pub fn load_session(path: &Path, threads: usize) -> Result<Session, String> {
    Session::builder()
        .and_then(|builder| builder.with_optimization_level(GraphOptimizationLevel::Level3))
        .and_then(|builder| builder.with_parallel_execution(false))
        .and_then(|builder| builder.with_inter_threads(1))
        .and_then(|builder| builder.with_intra_threads(threads.max(1)))
        .and_then(|builder| builder.commit_from_file(path))
        .map_err(|error| format!("load ONNX session {}: {error}", path.display()))
}

pub fn validate_model_files(config: &ChatterboxConfig) -> Result<(), String> {
    let mut missing = Vec::new();
    for name in [
        "speech_encoder",
        "embed_tokens",
        "language_model",
        "conditional_decoder",
    ] {
        let path = model_path(config, name);
        if !path.exists() {
            missing.push(path.display().to_string());
        }
        let data_path = PathBuf::from(format!("{}_data", path.display()));
        if !data_path.exists() {
            missing.push(data_path.display().to_string());
        }
    }
    let tokenizer = config.model_root.join("tokenizer.json");
    if !tokenizer.exists() {
        missing.push(tokenizer.display().to_string());
    }
    if !config.voice_wav.exists() {
        missing.push(config.voice_wav.display().to_string());
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "missing Chatterbox TTS files: {}",
            missing.join(", ")
        ))
    }
}

pub fn model_path(config: &ChatterboxConfig, name: &str) -> PathBuf {
    config
        .model_root
        .join("onnx")
        .join(format!("{name}{}.onnx", dtype_suffix(&config.dtype)))
}

pub fn default_model_root() -> PathBuf {
    env::var_os("PHOENIX_TTS_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"G:\phoenix-tts\chatterbox-turbo-onnx"))
}

pub fn default_voice_wav() -> PathBuf {
    env::var_os("PHOENIX_TTS_VOICE_WAV")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"G:\phoenix-tts\reference-sapi.wav"))
}

pub fn default_threads() -> usize {
    std::thread::available_parallelism()
        .map(|value| value.get().min(8))
        .unwrap_or(1)
}

pub fn extract_f32_tensor(value: &DynValue, label: &str) -> Result<(Vec<f32>, Vec<i64>), String> {
    let tensor = value
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("extract {label}: {error}"))?;
    let view = tensor.view();
    let shape = view
        .shape()
        .iter()
        .map(|&value| value as i64)
        .collect::<Vec<_>>();
    let values = view
        .as_slice()
        .ok_or_else(|| format!("{label} tensor was non-contiguous"))?
        .to_vec();
    Ok((values, shape))
}

pub fn extract_i64_tensor(value: &DynValue, label: &str) -> Result<(Vec<i64>, Vec<i64>), String> {
    let tensor = value
        .try_extract_tensor::<i64>()
        .map_err(|error| format!("extract {label}: {error}"))?;
    let view = tensor.view();
    let shape = view
        .shape()
        .iter()
        .map(|&value| value as i64)
        .collect::<Vec<_>>();
    let values = view
        .as_slice()
        .ok_or_else(|| format!("{label} tensor was non-contiguous"))?
        .to_vec();
    Ok((values, shape))
}

pub fn extract_last_logits(value: &DynValue) -> Result<Vec<f32>, String> {
    let (values, shape) = extract_f32_tensor(value, "logits")?;
    let Some(&vocab) = shape.last() else {
        return Err("logits had no vocabulary dimension".to_owned());
    };
    let vocab = vocab as usize;
    if vocab == 0 || values.len() < vocab {
        return Err("logits tensor too short".to_owned());
    }
    Ok(values[values.len() - vocab..].to_vec())
}

pub fn tensor_i64<'a>(
    memory_info: &MemoryInfo,
    buffer: &'a mut Vec<i64>,
    shape: Vec<i64>,
    label: &str,
) -> Result<TensorRefMut<'a, i64>, String> {
    unsafe {
        TensorRefMut::from_raw(memory_info.clone(), buffer.as_mut_ptr().cast(), shape)
            .map_err(|error| format!("{label}: {error}"))
    }
}

pub fn tensor_f32<'a>(
    memory_info: &MemoryInfo,
    buffer: &'a mut Vec<f32>,
    shape: Vec<i64>,
    label: &str,
) -> Result<TensorRefMut<'a, f32>, String> {
    unsafe {
        TensorRefMut::from_raw(memory_info.clone(), buffer.as_mut_ptr().cast(), shape)
            .map_err(|error| format!("{label}: {error}"))
    }
}

pub fn tensor_f16<'a>(
    memory_info: &MemoryInfo,
    buffer: &'a mut Vec<f16>,
    shape: Vec<i64>,
    label: &str,
) -> Result<TensorRefMut<'a, f16>, String> {
    if shape.iter().any(|&dim| dim == 0) {
        return empty_f16(memory_info, shape, label);
    }
    unsafe {
        TensorRefMut::from_raw(memory_info.clone(), buffer.as_mut_ptr().cast(), shape)
            .map_err(|error| format!("{label}: {error}"))
    }
}

pub fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn empty_f16<'a>(
    memory_info: &MemoryInfo,
    shape: Vec<i64>,
    label: &str,
) -> Result<TensorRefMut<'a, f16>, String> {
    static ZERO: [f16; 1] = [f16::from_bits(0)];
    unsafe {
        TensorRefMut::from_raw(memory_info.clone(), ZERO.as_ptr().cast_mut().cast(), shape)
            .map_err(|error| format!("{label}: {error}"))
    }
}

fn dtype_suffix(dtype: &str) -> &'static str {
    match dtype {
        "fp32" => "",
        "fp16" => "_fp16",
        "q8" | "quantized" => "_quantized",
        "q4" => "_q4",
        "q4f16" => "_q4f16",
        _ => "_q4f16",
    }
}

fn default_ort_dylib_path(project_root: &Path) -> Option<PathBuf> {
    [
        project_root
            .join("node_modules")
            .join("@huggingface")
            .join("transformers")
            .join("node_modules")
            .join("onnxruntime-node")
            .join("bin")
            .join("napi-v6")
            .join("win32")
            .join("x64")
            .join("onnxruntime.dll"),
        project_root
            .join("node_modules")
            .join("onnxruntime-node")
            .join("bin")
            .join("napi-v3")
            .join("win32")
            .join("x64")
            .join("onnxruntime.dll"),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent project root")
        .to_path_buf()
}
