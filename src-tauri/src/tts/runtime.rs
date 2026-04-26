use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use half::f16;
use ort::memory::MemoryInfo;
use ort::session::{Session, SessionInputValue};
use ort::value::DynValue;
use tokenizers::Tokenizer;

use super::audio::{pcm_s16le, read_reference_wav, SAMPLE_RATE};
use super::support::{
    configure_ort, cpu_memory_info, default_model_root, default_threads, default_voice_wav,
    elapsed_ms, extract_f32_tensor, extract_i64_tensor, extract_last_logits, load_session,
    model_path, tensor_f16, tensor_f32, tensor_i64, validate_model_files,
};
use super::{NativeTtsLoadRequest, NativeTtsSpeakRequest, NativeTtsSynthResult, NativeTtsTimings};

const START_SPEECH_TOKEN: i64 = 6561;
const STOP_SPEECH_TOKEN: i64 = 6562;
const SILENCE_TOKEN: i64 = 4299;
const NUM_KV_HEADS: usize = 16;
const HEAD_DIM: usize = 64;
const HIDDEN_DIM: usize = 1024;

pub struct ChatterboxRuntime {
    config: ChatterboxConfig,
    tokenizer: Tokenizer,
    speech_encoder: Session,
    embed_tokens: Session,
    language_model: Session,
    conditional_decoder: Session,
    memory_info: MemoryInfo,
}

#[derive(Clone, Debug)]
pub struct ChatterboxConfig {
    pub model_root: PathBuf,
    pub voice_wav: PathBuf,
    pub dtype: String,
    pub max_new_tokens: usize,
    pub repetition_penalty: f32,
    pub threads: usize,
}

#[derive(Default)]
struct Scratch {
    ids: Vec<i64>,
    audio: Vec<f32>,
    embeds: Vec<f32>,
    speech_tokens: Vec<i64>,
}

struct CacheSlot {
    input_name: String,
    output_name: String,
    shape: [usize; 4],
    values: Vec<f16>,
}

struct SpeechCondition {
    features: Vec<f32>,
    prompt_tokens: Vec<i64>,
    speaker_embeddings: Vec<f32>,
    speaker_features: Vec<f32>,
    speaker_feature_shape: Vec<i64>,
}

impl ChatterboxRuntime {
    pub fn load(request: NativeTtsLoadRequest) -> Result<Self, String> {
        configure_ort();
        let config = ChatterboxConfig::from_request(request);
        validate_model_files(&config)?;
        let tokenizer_path = config.model_root.join("tokenizer.json");
        let tokenizer = Tokenizer::from_file(&tokenizer_path)
            .map_err(|error| format!("load tokenizer {}: {error}", tokenizer_path.display()))?;
        let speech_encoder = load_session(&model_path(&config, "speech_encoder"), config.threads)?;
        let embed_tokens = load_session(&model_path(&config, "embed_tokens"), config.threads)?;
        let language_model = load_session(&model_path(&config, "language_model"), config.threads)?;
        let conditional_decoder =
            load_session(&model_path(&config, "conditional_decoder"), config.threads)?;
        let memory_info = cpu_memory_info()?;
        Ok(Self {
            config,
            tokenizer,
            speech_encoder,
            embed_tokens,
            language_model,
            conditional_decoder,
            memory_info,
        })
    }

    pub fn config(&self) -> &ChatterboxConfig {
        &self.config
    }

    pub fn synthesize(
        &self,
        request: NativeTtsSpeakRequest,
    ) -> Result<NativeTtsSynthResult, String> {
        let total_start = std::time::Instant::now();
        let max_new_tokens = request
            .max_new_tokens
            .map(|value| value as usize)
            .unwrap_or(self.config.max_new_tokens)
            .max(1);
        let repetition_penalty = request
            .repetition_penalty
            .unwrap_or(self.config.repetition_penalty)
            .max(1.0);
        let voice_wav = request
            .voice_wav
            .as_deref()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.config.voice_wav.clone());
        let mut scratch = Scratch::default();

        let condition_start = std::time::Instant::now();
        let condition = self.prepare_condition(&voice_wav, &mut scratch)?;
        let condition_ms = elapsed_ms(condition_start);

        let token_start = std::time::Instant::now();
        let mut input_ids = self.encode_text(&request.text, &mut scratch)?;
        let mut generated = Vec::with_capacity(max_new_tokens + 1);
        generated.push(START_SPEECH_TOKEN);
        let mut cache = self.initial_cache();
        let mut attention_mask = Vec::<i64>::new();
        let mut position_ids = Vec::<i64>::new();
        let mut stopped = false;

        for step in 0..max_new_tokens {
            let mut input_embeds = self.embed(&mut input_ids, &mut scratch)?;
            let seq_len = if step == 0 {
                prepend_condition(&mut input_embeds, &condition.features);
                let seq_len = input_embeds.len() / HIDDEN_DIM;
                attention_mask.resize(seq_len, 1);
                position_ids.clear();
                position_ids.extend((0..seq_len).map(|value| value as i64));
                seq_len
            } else {
                1
            };

            let logits = self.language_step(
                &mut input_embeds,
                seq_len,
                &mut attention_mask,
                &mut position_ids,
                &mut cache,
            )?;
            let next = next_token(&generated, &logits, repetition_penalty)?;
            generated.push(next);
            if next == STOP_SPEECH_TOKEN {
                stopped = true;
                break;
            }
            input_ids.clear();
            input_ids.push(next);
            attention_mask.push(1);
            let next_pos = position_ids.last().copied().unwrap_or_default() + 1;
            position_ids.clear();
            position_ids.push(next_pos);
        }
        let token_ms = elapsed_ms(token_start);

        let decode_start = std::time::Instant::now();
        let waveform = self.decode_waveform(&condition, &generated, &mut scratch)?;
        let decode_ms = elapsed_ms(decode_start);
        let sample_count = waveform.len() as u32;
        let pcm_s16le = pcm_s16le(&waveform);

        Ok(NativeTtsSynthResult {
            sample_rate: SAMPLE_RATE,
            sample_count,
            pcm_s16le,
            generated_tokens: generated.len().saturating_sub(1) as u32,
            stopped,
            timings: NativeTtsTimings {
                condition_ms,
                token_ms,
                decode_ms,
                total_ms: elapsed_ms(total_start),
            },
        })
    }

    fn prepare_condition(
        &self,
        voice_wav: &Path,
        scratch: &mut Scratch,
    ) -> Result<SpeechCondition, String> {
        scratch.audio = read_reference_wav(voice_wav)?;
        let shape = vec![1, scratch.audio.len() as i64];
        let audio = tensor_f32(&self.memory_info, &mut scratch.audio, shape, "audio_values")?;
        let outputs = self
            .speech_encoder
            .run([SessionInputValue::from(audio)])
            .map_err(|error| format!("speech encoder: {error}"))?;
        let (features, _) = extract_f32_tensor(&outputs[0], "audio_features")?;
        let (prompt_tokens, _) = extract_i64_tensor(&outputs[1], "audio_tokens")?;
        let (speaker_embeddings, _) = extract_f32_tensor(&outputs[2], "speaker_embeddings")?;
        let (speaker_features, speaker_feature_shape) =
            extract_f32_tensor(&outputs[3], "speaker_features")?;
        Ok(SpeechCondition {
            features,
            prompt_tokens,
            speaker_embeddings,
            speaker_features,
            speaker_feature_shape,
        })
    }

    fn encode_text(&self, text: &str, scratch: &mut Scratch) -> Result<Vec<i64>, String> {
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|error| format!("tokenize TTS text: {error}"))?;
        scratch.ids.clear();
        scratch
            .ids
            .extend(encoding.get_ids().iter().map(|&value| i64::from(value)));
        Ok(scratch.ids.clone())
    }

    fn embed(&self, ids: &mut Vec<i64>, scratch: &mut Scratch) -> Result<Vec<f32>, String> {
        let shape = vec![1, ids.len() as i64];
        let input = tensor_i64(&self.memory_info, ids, shape, "input_ids")?;
        let outputs = self
            .embed_tokens
            .run([SessionInputValue::from(input)])
            .map_err(|error| format!("embed tokens: {error}"))?;
        let (values, _) = extract_f32_tensor(&outputs[0], "inputs_embeds")?;
        scratch.embeds.clear();
        scratch.embeds.extend_from_slice(&values);
        Ok(std::mem::take(&mut scratch.embeds))
    }

    fn initial_cache(&self) -> Vec<CacheSlot> {
        self.language_model
            .inputs
            .iter()
            .filter_map(|input| {
                input
                    .name
                    .strip_prefix("past_key_values.")
                    .map(|suffix| CacheSlot {
                        input_name: input.name.clone(),
                        output_name: format!("present.{suffix}"),
                        shape: [1, NUM_KV_HEADS, 0, HEAD_DIM],
                        values: Vec::new(),
                    })
            })
            .collect()
    }

    fn language_step(
        &self,
        inputs_embeds: &mut Vec<f32>,
        seq_len: usize,
        attention_mask: &mut Vec<i64>,
        position_ids: &mut Vec<i64>,
        cache: &mut [CacheSlot],
    ) -> Result<Vec<f32>, String> {
        let embeds = tensor_f32(
            &self.memory_info,
            inputs_embeds,
            vec![1, seq_len as i64, HIDDEN_DIM as i64],
            "inputs_embeds",
        )?;
        let mask = tensor_i64(
            &self.memory_info,
            attention_mask,
            vec![1, attention_mask.len() as i64],
            "attention_mask",
        )?;
        let positions = tensor_i64(
            &self.memory_info,
            position_ids,
            vec![1, seq_len as i64],
            "position_ids",
        )?;
        let mut feeds = Vec::with_capacity(self.language_model.inputs.len());
        feeds.push(("inputs_embeds", SessionInputValue::from(embeds)));
        feeds.push(("attention_mask", SessionInputValue::from(mask)));
        feeds.push(("position_ids", SessionInputValue::from(positions)));
        for slot in cache.iter_mut() {
            feeds.push((
                slot.input_name.as_str(),
                SessionInputValue::from(tensor_f16(
                    &self.memory_info,
                    &mut slot.values,
                    slot.shape.iter().map(|&value| value as i64).collect(),
                    &slot.input_name,
                )?),
            ));
        }

        let outputs = self
            .language_model
            .run(feeds)
            .map_err(|error| format!("language model: {error}"))?;
        let mut logits = None;
        let mut present = BTreeMap::new();
        for (name, value) in outputs.into_iter() {
            if name == "logits" {
                logits = Some(extract_last_logits(&value)?);
            } else {
                present.insert(name.to_owned(), value);
            }
        }
        for slot in cache.iter_mut() {
            if let Some(value) = present.get(&slot.output_name) {
                assign_cache(slot, value)?;
            }
        }
        logits.ok_or_else(|| "language model did not return logits".to_owned())
    }

    fn decode_waveform(
        &self,
        condition: &SpeechCondition,
        generated: &[i64],
        scratch: &mut Scratch,
    ) -> Result<Vec<f32>, String> {
        scratch.speech_tokens.clear();
        scratch
            .speech_tokens
            .extend_from_slice(&condition.prompt_tokens);
        let speech = generated
            .iter()
            .skip(1)
            .take_while(|&&value| value != STOP_SPEECH_TOKEN);
        scratch.speech_tokens.extend(speech.copied());
        scratch
            .speech_tokens
            .extend_from_slice(&[SILENCE_TOKEN, SILENCE_TOKEN, SILENCE_TOKEN]);
        let token_shape = vec![1, scratch.speech_tokens.len() as i64];
        let speech_tokens = tensor_i64(
            &self.memory_info,
            &mut scratch.speech_tokens,
            token_shape,
            "speech_tokens",
        )?;
        let mut speaker_embeddings = condition.speaker_embeddings.clone();
        let mut speaker_features = condition.speaker_features.clone();
        let embeddings = tensor_f32(
            &self.memory_info,
            &mut speaker_embeddings,
            vec![1, 192],
            "speaker_embeddings",
        )?;
        let features = tensor_f32(
            &self.memory_info,
            &mut speaker_features,
            condition.speaker_feature_shape.clone(),
            "speaker_features",
        )?;
        let outputs = self
            .conditional_decoder
            .run([
                SessionInputValue::from(speech_tokens),
                SessionInputValue::from(embeddings),
                SessionInputValue::from(features),
            ])
            .map_err(|error| format!("conditional decoder: {error}"))?;
        let (waveform, _) = extract_f32_tensor(&outputs[0], "waveform")?;
        Ok(waveform)
    }
}

impl ChatterboxConfig {
    fn from_request(request: NativeTtsLoadRequest) -> Self {
        Self {
            model_root: request
                .model_root
                .map(PathBuf::from)
                .unwrap_or_else(default_model_root),
            voice_wav: request
                .voice_wav
                .map(PathBuf::from)
                .unwrap_or_else(default_voice_wav),
            dtype: request.dtype.unwrap_or_else(|| "q4f16".to_owned()),
            max_new_tokens: request.max_new_tokens.unwrap_or(1024) as usize,
            repetition_penalty: request.repetition_penalty.unwrap_or(1.2),
            threads: request
                .threads
                .map(|value| value as usize)
                .unwrap_or_else(default_threads)
                .max(1),
        }
    }
}

fn prepend_condition(input_embeds: &mut Vec<f32>, condition: &[f32]) {
    let mut merged = Vec::with_capacity(condition.len() + input_embeds.len());
    merged.extend_from_slice(condition);
    merged.extend_from_slice(input_embeds);
    *input_embeds = merged;
}

fn next_token(generated: &[i64], logits: &[f32], penalty: f32) -> Result<i64, String> {
    let mut scores = logits.to_vec();
    for &id in generated {
        let index = id as usize;
        if let Some(score) = scores.get_mut(index) {
            *score = if *score < 0.0 {
                *score * penalty
            } else {
                *score / penalty
            };
        }
    }
    scores
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(right.1))
        .map(|(index, _)| index as i64)
        .ok_or_else(|| "empty logits".to_owned())
}

fn assign_cache(slot: &mut CacheSlot, value: &DynValue) -> Result<(), String> {
    let tensor = value
        .try_extract_tensor::<f16>()
        .map_err(|error| format!("extract {}: {error}", slot.output_name))?;
    let view = tensor.view();
    let shape = view.shape();
    let [a, b, c, d] = shape else {
        return Err(format!(
            "unsupported cache shape for {}: {shape:?}",
            slot.output_name
        ));
    };
    let values = view
        .as_slice()
        .ok_or_else(|| format!("cache tensor {} was non-contiguous", slot.output_name))?;
    slot.shape = [*a, *b, *c, *d];
    slot.values.clear();
    slot.values.extend_from_slice(values);
    Ok(())
}
