use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::audio::{pcm_s16le, read_reference_wav, SAMPLE_RATE};
use super::{NativeQwenSpeakRequest, NativeTtsSynthResult, NativeTtsTimings};

const DEFAULT_RUNNER_PATH: &str = r"G:\phoenix-tts\qwen3-tts-rs\bin\qwen-tts.exe";
const DEFAULT_MODEL_ID: &str = "Qwen/Qwen3-TTS-12Hz-0.6B-Base";
const DEFAULT_REF_AUDIO: &str = r"G:\phoenix-tts\reference-sapi.wav";
const DEFAULT_PROMPT_CACHE: &str = r"G:\phoenix-tts\qwen-reference-prompt.json";
const DEFAULT_OUTPUT_DIR: &str = r"G:\phoenix-tts\qwen-tts-outputs";
const DEFAULT_LANGUAGE: &str = "english";
const DEFAULT_DEVICE: &str = "cpu";
const DEFAULT_DTYPE: &str = "f32";
const DEFAULT_MAX_TOKENS: u32 = 1536;
const DEFAULT_TIMEOUT_SECS: u64 = 600;

pub fn synthesize_qwen_cli(
    request: NativeQwenSpeakRequest,
) -> Result<NativeTtsSynthResult, String> {
    let text = request.text.trim().to_owned();
    if text.is_empty() {
        return Err("Qwen TTS text is empty".to_owned());
    }

    let total_start = Instant::now();
    let config = QwenCliConfig::from_request(request)?;
    let session_dir = config.output_dir.join(unique_session_name());
    fs::create_dir_all(&session_dir).map_err(|error| {
        format!(
            "create Qwen TTS output dir {}: {error}",
            session_dir.display()
        )
    })?;
    let output_wav = session_dir.join("output.wav");

    let process_start = Instant::now();
    let output = run_qwen(&config, &text, &output_wav);
    let process_ms = elapsed_ms(process_start);
    let result = match output {
        Ok(()) => read_generated_audio(&output_wav, elapsed_ms(total_start), process_ms),
        Err(error) => Err(error),
    };

    let _ = fs::remove_dir_all(&session_dir);
    result
}

struct QwenCliConfig {
    runner_path: PathBuf,
    model: String,
    model_path: Option<PathBuf>,
    ref_audio: Option<PathBuf>,
    ref_text: Option<String>,
    output_dir: PathBuf,
    load_prompt: Option<PathBuf>,
    save_prompt: Option<PathBuf>,
    language: String,
    device: String,
    dtype: String,
    max_tokens: u32,
    greedy: bool,
    x_vector_only: bool,
    timeout: Duration,
}

impl QwenCliConfig {
    fn from_request(request: NativeQwenSpeakRequest) -> Result<Self, String> {
        let runner_path = request
            .runner_path
            .as_deref()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_RUNNER_PATH));
        require_file(&runner_path, "Qwen TTS CLI runner")?;

        let model = request.model.unwrap_or_else(|| DEFAULT_MODEL_ID.to_owned());
        if model != DEFAULT_MODEL_ID && request.model_path.is_none() {
            return Err(format!(
                "Qwen TTS model must be {DEFAULT_MODEL_ID}; refusing unsupported model {model}"
            ));
        }

        let model_path = request.model_path.as_deref().map(PathBuf::from);
        if let Some(path) = model_path.as_ref() {
            require_dir(path, "Qwen TTS local model")?;
        }

        let use_prompt_cache = request.use_prompt_cache.unwrap_or(true);
        let requested_load_prompt = request.load_prompt.as_deref().map(PathBuf::from);
        let requested_save_prompt = request.save_prompt.as_deref().map(PathBuf::from);
        let requested_prompt_cache = requested_load_prompt
            .clone()
            .or_else(|| requested_save_prompt.clone());
        let default_prompt_cache = PathBuf::from(DEFAULT_PROMPT_CACHE);
        let load_prompt = if use_prompt_cache {
            let candidate = requested_prompt_cache
                .clone()
                .unwrap_or_else(|| default_prompt_cache.clone());
            if candidate.is_file() {
                Some(candidate)
            } else {
                None
            }
        } else {
            None
        };

        let ref_audio = if load_prompt.is_some() {
            None
        } else {
            let path = request
                .ref_audio
                .as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(DEFAULT_REF_AUDIO));
            require_file(&path, "Qwen TTS reference audio")?;
            Some(path)
        };

        let output_dir = request
            .output_dir
            .as_deref()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_OUTPUT_DIR));
        let save_prompt = save_prompt_path(
            use_prompt_cache,
            load_prompt.as_ref(),
            requested_prompt_cache.as_ref(),
        );

        Ok(Self {
            runner_path,
            model,
            model_path,
            ref_audio,
            ref_text: trim_opt(request.ref_text),
            output_dir,
            load_prompt,
            save_prompt,
            language: normalize_language(request.language.as_deref()),
            device: normalize_device(request.device.as_deref()),
            dtype: normalize_dtype(request.dtype.as_deref()),
            max_tokens: request.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS).max(64),
            greedy: request.greedy.unwrap_or(false),
            x_vector_only: request.x_vector_only.unwrap_or(false),
            timeout: Duration::from_secs(u64::from(
                request
                    .timeout_secs
                    .unwrap_or(DEFAULT_TIMEOUT_SECS as u32)
                    .max(30),
            )),
        })
    }
}

fn save_prompt_path(
    use_prompt_cache: bool,
    load_prompt: Option<&PathBuf>,
    requested: Option<&PathBuf>,
) -> Option<PathBuf> {
    if !use_prompt_cache || load_prompt.is_some() {
        return None;
    }
    requested
        .cloned()
        .or_else(|| Some(PathBuf::from(DEFAULT_PROMPT_CACHE)))
}

fn run_qwen(config: &QwenCliConfig, text: &str, output_wav: &Path) -> Result<(), String> {
    let mut command = Command::new(&config.runner_path);
    if let Some(model_path) = config.model_path.as_ref() {
        command.arg("--model-path").arg(model_path);
    } else {
        command.arg("--model").arg(&config.model);
    }

    command
        .arg("--text")
        .arg(text)
        .arg("--output")
        .arg(output_wav)
        .arg("--language")
        .arg(&config.language)
        .arg("--device")
        .arg(&config.device)
        .arg("--dtype")
        .arg(&config.dtype)
        .arg("--max-tokens")
        .arg(config.max_tokens.to_string());

    let mut x_vector_arg_sent = false;
    if let Some(prompt) = config.load_prompt.as_ref() {
        command.arg("--load-prompt").arg(prompt);
    } else if let Some(ref_audio) = config.ref_audio.as_ref() {
        command.arg("--ref-audio").arg(ref_audio);
        if let Some(ref_text) = config.ref_text.as_ref() {
            command.arg("--ref-text").arg(ref_text);
        } else {
            command.arg("--x-vector-only");
            x_vector_arg_sent = true;
        }
    }

    if let Some(save_prompt) = config.save_prompt.as_ref() {
        if let Some(parent) = save_prompt.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("create Qwen TTS prompt dir {}: {error}", parent.display())
            })?;
        }
        command.arg("--save-prompt").arg(save_prompt);
    }
    if config.greedy {
        command.arg("--greedy");
    }
    if config.x_vector_only && !x_vector_arg_sent {
        command.arg("--x-vector-only");
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(parent) = config.runner_path.parent() {
        command.current_dir(parent);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|error| {
        format!(
            "spawn Qwen TTS runner {}: {error}",
            config.runner_path.display()
        )
    })?;
    let start = Instant::now();
    loop {
        if start.elapsed() > config.timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Qwen TTS synthesis timed out after {}s",
                config.timeout.as_secs()
            ));
        }
        if child
            .try_wait()
            .map_err(|error| format!("poll Qwen TTS runner: {error}"))?
            .is_some()
        {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("collect Qwen TTS output: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    Err(format!(
        "Qwen TTS runner failed with status {}. stdout: {} stderr: {}",
        output.status,
        truncate_lossy(&output.stdout),
        truncate_lossy(&output.stderr)
    ))
}

fn read_generated_audio(
    wav_path: &Path,
    total_ms: f64,
    process_ms: f64,
) -> Result<NativeTtsSynthResult, String> {
    let samples = read_reference_wav(wav_path)?;
    let sample_count = samples.len() as u32;
    Ok(NativeTtsSynthResult {
        sample_rate: SAMPLE_RATE,
        sample_count,
        pcm_s16le: pcm_s16le(&samples),
        generated_tokens: 0,
        stopped: true,
        timings: NativeTtsTimings {
            condition_ms: 0.0,
            token_ms: process_ms,
            decode_ms: 0.0,
            total_ms,
        },
    })
}

fn normalize_language(value: Option<&str>) -> String {
    match value
        .unwrap_or(DEFAULT_LANGUAGE)
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "chinese" | "zh" | "cn" => "chinese".to_owned(),
        "japanese" | "ja" => "japanese".to_owned(),
        "korean" | "ko" => "korean".to_owned(),
        "french" | "fr" => "french".to_owned(),
        "german" | "de" => "german".to_owned(),
        "spanish" | "es" => "spanish".to_owned(),
        "auto" => "auto".to_owned(),
        _ => "english".to_owned(),
    }
}

fn normalize_device(value: Option<&str>) -> String {
    match value
        .unwrap_or(DEFAULT_DEVICE)
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "cuda" | "cuda:0" => "cuda".to_owned(),
        "metal" => "metal".to_owned(),
        _ => "cpu".to_owned(),
    }
}

fn normalize_dtype(value: Option<&str>) -> String {
    match value
        .unwrap_or(DEFAULT_DTYPE)
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "f16" | "float16" | "half" => "f16".to_owned(),
        "bf16" | "bfloat16" => "bf16".to_owned(),
        _ => "f32".to_owned(),
    }
}

fn trim_opt(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn require_file(path: &Path, label: &str) -> Result<(), String> {
    if path.is_file() {
        Ok(())
    } else {
        Err(format!("{label} not found: {}", path.display()))
    }
}

fn require_dir(path: &Path, label: &str) -> Result<(), String> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(format!("{label} not found: {}", path.display()))
    }
}

fn unique_session_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("phoenix-qwen-{}-{nanos}", std::process::id())
}

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn truncate_lossy(bytes: &[u8]) -> String {
    const LIMIT: usize = 800;
    let text = String::from_utf8_lossy(bytes);
    if text.len() <= LIMIT {
        return text.into_owned();
    }
    let prefix = text.chars().take(LIMIT).collect::<String>();
    format!("{prefix}...")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_language_for_qwen_cli() {
        assert_eq!(normalize_language(Some("en")), "english");
        assert_eq!(normalize_language(Some("fr")), "french");
        assert_eq!(normalize_language(Some("not-real")), "english");
    }

    #[test]
    fn normalizes_device_and_dtype_safely() {
        assert_eq!(normalize_device(Some("cuda:0")), "cuda");
        assert_eq!(normalize_device(Some("weird")), "cpu");
        assert_eq!(normalize_dtype(Some("half")), "f16");
        assert_eq!(normalize_dtype(Some("int4")), "f32");
    }
}
