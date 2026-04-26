mod audio;
mod qwen_cli;
mod runtime;
mod supertonic_cli;
mod support;

use qwen_cli::synthesize_qwen_cli;
use runtime::ChatterboxRuntime;
use std::sync::mpsc;
use supertonic_cli::synthesize_supertonic_cli;

#[derive(Clone)]
pub struct NativeTtsService {
    tx: mpsc::Sender<TtsCommand>,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct NativeTtsLoadRequest {
    pub model_root: Option<String>,
    pub voice_wav: Option<String>,
    pub dtype: Option<String>,
    pub max_new_tokens: Option<u32>,
    pub repetition_penalty: Option<f32>,
    pub threads: Option<u32>,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct NativeTtsSpeakRequest {
    pub text: String,
    pub voice_wav: Option<String>,
    pub max_new_tokens: Option<u32>,
    pub repetition_penalty: Option<f32>,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct NativeSupertonicSpeakRequest {
    pub text: String,
    pub voice_style: Option<String>,
    pub runner_path: Option<String>,
    pub model_root: Option<String>,
    pub output_dir: Option<String>,
    pub total_step: Option<u32>,
    pub speed: Option<f32>,
    pub lang: Option<String>,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct NativeQwenSpeakRequest {
    pub text: String,
    pub runner_path: Option<String>,
    pub model: Option<String>,
    pub model_path: Option<String>,
    pub ref_audio: Option<String>,
    pub ref_text: Option<String>,
    pub output_dir: Option<String>,
    pub load_prompt: Option<String>,
    pub save_prompt: Option<String>,
    pub use_prompt_cache: Option<bool>,
    pub language: Option<String>,
    pub device: Option<String>,
    pub dtype: Option<String>,
    pub max_tokens: Option<u32>,
    pub greedy: Option<bool>,
    pub x_vector_only: Option<bool>,
    pub timeout_secs: Option<u32>,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct NativeTtsStatus {
    pub loaded: bool,
    pub model_root: Option<String>,
    pub voice_wav: Option<String>,
    pub dtype: Option<String>,
    pub sample_rate: u32,
    pub last_error: Option<String>,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct NativeTtsTimings {
    pub condition_ms: f64,
    pub token_ms: f64,
    pub decode_ms: f64,
    pub total_ms: f64,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct NativeTtsSynthResult {
    pub sample_rate: u32,
    pub sample_count: u32,
    pub pcm_s16le: Vec<u8>,
    pub generated_tokens: u32,
    pub stopped: bool,
    pub timings: NativeTtsTimings,
}

impl NativeTtsService {
    pub fn status(&self) -> NativeTtsStatus {
        let (tx, rx) = mpsc::channel();
        let _ = self.tx.send(TtsCommand::Status(tx));
        rx.recv()
            .unwrap_or_else(|_| empty_status(Some("native TTS worker stopped".to_owned())))
    }

    pub fn load(&mut self, request: NativeTtsLoadRequest) -> Result<NativeTtsStatus, String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(TtsCommand::Load(request, tx))
            .map_err(|_| "native TTS worker stopped".to_owned())?;
        rx.recv()
            .unwrap_or_else(|_| Err("native TTS worker stopped".to_owned()))
    }

    pub fn unload(&mut self) -> bool {
        let (tx, rx) = mpsc::channel();
        if self.tx.send(TtsCommand::Unload(tx)).is_err() {
            return false;
        }
        rx.recv().unwrap_or(false)
    }

    pub fn synthesize(
        &mut self,
        request: NativeTtsSpeakRequest,
    ) -> Result<NativeTtsSynthResult, String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(TtsCommand::Synthesize(request, tx))
            .map_err(|_| "native TTS worker stopped".to_owned())?;
        rx.recv()
            .unwrap_or_else(|_| Err("native TTS worker stopped".to_owned()))
    }

    pub fn synthesize_supertonic(
        &mut self,
        request: NativeSupertonicSpeakRequest,
    ) -> Result<NativeTtsSynthResult, String> {
        synthesize_supertonic_cli(request)
    }

    pub fn synthesize_qwen(
        &mut self,
        request: NativeQwenSpeakRequest,
    ) -> Result<NativeTtsSynthResult, String> {
        synthesize_qwen_cli(request)
    }
}

impl Default for NativeTtsService {
    fn default() -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("phoenix-native-tts".to_owned())
            .spawn(move || run_worker(rx))
            .expect("spawn native TTS worker");
        Self { tx }
    }
}

enum TtsCommand {
    Status(mpsc::Sender<NativeTtsStatus>),
    Load(
        NativeTtsLoadRequest,
        mpsc::Sender<Result<NativeTtsStatus, String>>,
    ),
    Synthesize(
        NativeTtsSpeakRequest,
        mpsc::Sender<Result<NativeTtsSynthResult, String>>,
    ),
    Unload(mpsc::Sender<bool>),
}

fn run_worker(rx: mpsc::Receiver<TtsCommand>) {
    let mut runtime: Option<ChatterboxRuntime> = None;
    let mut last_error: Option<String> = None;
    while let Ok(command) = rx.recv() {
        match command {
            TtsCommand::Status(reply) => {
                let _ = reply.send(status_from(runtime.as_ref(), last_error.clone()));
            }
            TtsCommand::Load(request, reply) => {
                let result = ChatterboxRuntime::load(request)
                    .map(|loaded| {
                        runtime = Some(loaded);
                        last_error = None;
                        status_from(runtime.as_ref(), None)
                    })
                    .map_err(|error| {
                        last_error = Some(error.clone());
                        error
                    });
                let _ = reply.send(result);
            }
            TtsCommand::Synthesize(request, reply) => {
                let result = match runtime.as_ref() {
                    Some(loaded) if !request.text.trim().is_empty() => loaded.synthesize(request),
                    Some(_) => Err("native TTS text is empty".to_owned()),
                    None => Err("native TTS model is not loaded".to_owned()),
                }
                .map_err(|error| {
                    last_error = Some(error.clone());
                    error
                });
                if result.is_ok() {
                    last_error = None;
                }
                let _ = reply.send(result);
            }
            TtsCommand::Unload(reply) => {
                let had_runtime = runtime.take().is_some();
                last_error = None;
                let _ = reply.send(had_runtime);
            }
        }
    }
}

fn status_from(runtime: Option<&ChatterboxRuntime>, last_error: Option<String>) -> NativeTtsStatus {
    let config = runtime.map(|value| value.config());
    NativeTtsStatus {
        loaded: runtime.is_some(),
        model_root: config.map(|value| value.model_root.to_string_lossy().into_owned()),
        voice_wav: config.map(|value| value.voice_wav.to_string_lossy().into_owned()),
        dtype: config.map(|value| value.dtype.clone()),
        sample_rate: audio::SAMPLE_RATE,
        last_error,
    }
}

fn empty_status(last_error: Option<String>) -> NativeTtsStatus {
    NativeTtsStatus {
        loaded: false,
        model_root: None,
        voice_wav: None,
        dtype: None,
        sample_rate: audio::SAMPLE_RATE,
        last_error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn chatterbox_q4f16_smoke() {
        let model_root = r"G:\phoenix-tts\chatterbox-turbo-onnx";
        let voice_wav = r"G:\phoenix-tts\reference-sapi.wav";
        if !std::path::Path::new(model_root).exists() || !std::path::Path::new(voice_wav).exists() {
            eprintln!("skipping Chatterbox smoke; model or voice reference is missing");
            return;
        }
        let mut service = NativeTtsService::default();
        let status = service
            .load(NativeTtsLoadRequest {
                model_root: Some(model_root.to_owned()),
                voice_wav: Some(voice_wav.to_owned()),
                dtype: Some("q4f16".to_owned()),
                max_new_tokens: Some(96),
                repetition_penalty: Some(1.2),
                threads: Some(8),
            })
            .expect("load Chatterbox q4f16");
        assert!(status.loaded);
        let audio = service
            .synthesize(NativeTtsSpeakRequest {
                text: "Phoenix native TTS smoke test.".to_owned(),
                voice_wav: None,
                max_new_tokens: Some(96),
                repetition_penalty: Some(1.2),
            })
            .expect("synthesize Chatterbox audio");
        assert_eq!(audio.sample_rate, audio::SAMPLE_RATE);
        assert!(audio.sample_count > 1_000);
        assert_eq!(audio.pcm_s16le.len(), audio.sample_count as usize * 2);
    }
}
