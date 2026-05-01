use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ort::session::Session;
use ort::value::Tensor;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokenizers::Tokenizer;

use crate::gliner_bi_tensors::{
    build_label_set, build_span_tensors, build_text_tensors, decode_predictions, extract_logits,
};
use crate::ort_runtime::{load_session_with_intra_threads, recommended_thread_count};

#[derive(Debug, Error)]
pub enum GlinerBiError {
    #[error("failed to load GLiNER Bi-Encoder model: {0}")]
    ModelLoad(String),
    #[error("GLiNER inference failed: {0}")]
    Inference(String),
    #[error("invalid GLiNER input: {0}")]
    InvalidInput(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlinerBiPrediction {
    pub text: String,
    pub label: String,
    pub span_start: usize,
    pub span_end: usize,
    pub score: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlinerBiModelMetadata {
    pub max_width: usize,
    pub model_path: String,
    pub text_tokenizer_path: String,
    pub labels_tokenizer_path: String,
    pub input_names: Vec<String>,
    pub output_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlinerBiLabelSet {
    pub(crate) labels: Vec<String>,
    pub(crate) input_ids: Vec<i64>,
    pub(crate) attention_mask: Vec<i64>,
    pub(crate) max_label_len: usize,
}

impl GlinerBiLabelSet {
    pub fn labels(&self) -> &[String] {
        &self.labels
    }

    pub fn label_count(&self) -> usize {
        self.labels.len()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GlinerBiOverlapPolicy {
    KeepAll,
    HighestScore,
    LongestThenScore,
}

impl Default for GlinerBiOverlapPolicy {
    fn default() -> Self {
        Self::HighestScore
    }
}

impl GlinerBiOverlapPolicy {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "keep-all" | "keep_all" | "all" => Ok(Self::KeepAll),
            "highest-score" | "highest_score" | "flat" => Ok(Self::HighestScore),
            "longest-then-score" | "longest_then_score" | "longest" => Ok(Self::LongestThenScore),
            other => Err(format!("unknown GLiNER-BI overlap policy '{other}'")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlinerBiPredictOptions {
    pub threshold: f32,
    pub overlap_policy: GlinerBiOverlapPolicy,
}

impl Default for GlinerBiPredictOptions {
    fn default() -> Self {
        Self {
            threshold: 0.5,
            overlap_policy: GlinerBiOverlapPolicy::HighestScore,
        }
    }
}

pub struct GlinerBiModel {
    session: Session,
    text_tokenizer: Tokenizer,
    labels_tokenizer: Tokenizer,
    max_width: usize,
    text_cls_id: i64,
    text_sep_id: i64,
    labels_cls_id: i64,
    labels_sep_id: i64,
    label_cache: Mutex<GlinerBiLabelCache>,
    span_cache: Mutex<GlinerBiSpanCache>,
    label_inputs: GlinerBiLabelInputs,
    metadata: GlinerBiModelMetadata,
}

#[derive(Default)]
struct GlinerBiLabelCache {
    entries: Vec<(Vec<String>, Arc<GlinerBiLabelSet>)>,
}

#[derive(Clone, Debug)]
struct CachedSpanTensors {
    span_idx: Arc<Vec<i64>>,
    span_mask: Arc<Vec<bool>>,
}

#[derive(Default)]
struct GlinerBiSpanCache {
    entries: Vec<(usize, CachedSpanTensors)>,
}

enum GlinerBiLabelInputs {
    Tokenized,
    Embeddings(Arc<GlinerBiLabelEmbeddingStore>),
}

#[derive(Clone, Debug)]
struct GlinerBiLabelEmbeddingStore {
    hidden_size: usize,
    labels: HashMap<String, Arc<Vec<f32>>>,
}

#[derive(Debug, Deserialize)]
struct GlinerBiLabelEmbeddingsFile {
    hidden_size: usize,
    labels: Vec<GlinerBiLabelEmbeddingRow>,
}

#[derive(Debug, Deserialize)]
struct GlinerBiLabelEmbeddingRow {
    label: String,
    embedding: Vec<f32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct GlinerEncoderConfig {
    #[serde(default)]
    bos_token_id: Option<i64>,
    #[serde(default)]
    eos_token_id: Option<i64>,
    #[serde(default)]
    cls_token_id: Option<i64>,
    #[serde(default)]
    sep_token_id: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct GlinerLabelsEncoderConfig {
    #[serde(default)]
    bos_token_id: Option<i64>,
    #[serde(default)]
    eos_token_id: Option<i64>,
    #[serde(default)]
    cls_token_id: Option<i64>,
    #[serde(default)]
    sep_token_id: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct GlinerRootConfig {
    #[serde(default)]
    max_width: Option<usize>,
    #[serde(default)]
    encoder_config: Option<GlinerEncoderConfig>,
    #[serde(default)]
    labels_encoder_config: Option<GlinerLabelsEncoderConfig>,
}

impl GlinerBiModel {
    pub fn load(model_dir: &Path) -> Result<Self, GlinerBiError> {
        let model_path = find_model_asset(model_dir)?;
        let text_tokenizer_path =
            find_existing_path(model_dir, &["tokenizer.json", "onnx/tokenizer.json"])?;
        let labels_tokenizer_path = find_existing_path(
            model_dir,
            &[
                "labels_tokenizer/tokenizer.json",
                "labels_tokenizer.json",
                "onnx/labels_tokenizer.json",
            ],
        )?;

        let text_tokenizer = Tokenizer::from_file(&text_tokenizer_path)
            .map_err(|error| GlinerBiError::ModelLoad(format!("text tokenizer: {error}")))?;
        let labels_tokenizer = Tokenizer::from_file(&labels_tokenizer_path)
            .map_err(|error| GlinerBiError::ModelLoad(format!("labels tokenizer: {error}")))?;
        let session = load_session_with_intra_threads(&model_path, gliner_bi_thread_count())
            .map_err(|error| GlinerBiError::ModelLoad(format!("session: {error}")))?;
        let label_inputs = detect_label_input_mode(model_dir, &session)?;

        let root_config = load_json::<GlinerRootConfig>(&model_dir.join("gliner_config.json"))
            .or_else(|| load_json::<GlinerRootConfig>(&model_dir.join("config.json")))
            .unwrap_or_default();
        let max_width = root_config.max_width.unwrap_or(12);
        let text_cls_id = root_config
            .encoder_config
            .as_ref()
            .and_then(|config| config.cls_token_id.or(config.bos_token_id))
            .unwrap_or(50281);
        let text_sep_id = root_config
            .encoder_config
            .as_ref()
            .and_then(|config| config.sep_token_id.or(config.eos_token_id))
            .unwrap_or(50282);
        let labels_cls_id = root_config
            .labels_encoder_config
            .as_ref()
            .and_then(|config| config.cls_token_id.or(config.bos_token_id))
            .unwrap_or(101);
        let labels_sep_id = root_config
            .labels_encoder_config
            .as_ref()
            .and_then(|config| config.sep_token_id.or(config.eos_token_id))
            .unwrap_or(102);

        let metadata = GlinerBiModelMetadata {
            max_width,
            model_path: model_path.display().to_string(),
            text_tokenizer_path: text_tokenizer_path.display().to_string(),
            labels_tokenizer_path: labels_tokenizer_path.display().to_string(),
            input_names: session
                .inputs
                .iter()
                .map(|input| input.name.clone())
                .collect(),
            output_names: session
                .outputs
                .iter()
                .map(|output| output.name.clone())
                .collect(),
        };

        Ok(Self {
            session,
            text_tokenizer,
            labels_tokenizer,
            max_width,
            text_cls_id,
            text_sep_id,
            labels_cls_id,
            labels_sep_id,
            label_cache: Mutex::default(),
            span_cache: Mutex::default(),
            label_inputs,
            metadata,
        })
    }

    pub fn metadata(&self) -> &GlinerBiModelMetadata {
        &self.metadata
    }

    pub fn prepare_labels(&self, labels: &[String]) -> Result<GlinerBiLabelSet, GlinerBiError> {
        build_label_set(
            labels,
            &self.labels_tokenizer,
            self.labels_cls_id,
            self.labels_sep_id,
        )
    }

    pub fn predict(
        &self,
        text: &str,
        labels: &[String],
        threshold: f32,
        flat_ner: bool,
    ) -> Result<Vec<GlinerBiPrediction>, GlinerBiError> {
        if text.trim().is_empty() || labels.is_empty() {
            return Ok(Vec::new());
        }
        let label_set = self.cached_label_set(labels)?;
        let options = GlinerBiPredictOptions {
            threshold,
            overlap_policy: if flat_ner {
                GlinerBiOverlapPolicy::HighestScore
            } else {
                GlinerBiOverlapPolicy::KeepAll
            },
        };
        self.predict_with_label_set(text, label_set.as_ref(), &options)
    }

    pub fn predict_with_options(
        &self,
        text: &str,
        labels: &[String],
        options: &GlinerBiPredictOptions,
    ) -> Result<Vec<GlinerBiPrediction>, GlinerBiError> {
        if text.trim().is_empty() || labels.is_empty() {
            return Ok(Vec::new());
        }
        let label_set = self.cached_label_set(labels)?;
        self.predict_with_label_set(text, label_set.as_ref(), options)
    }

    pub fn predict_with_label_set(
        &self,
        text: &str,
        label_set: &GlinerBiLabelSet,
        options: &GlinerBiPredictOptions,
    ) -> Result<Vec<GlinerBiPrediction>, GlinerBiError> {
        if text.trim().is_empty() || label_set.label_count() == 0 {
            return Ok(Vec::new());
        }
        let Some(text_tensors) = build_text_tensors(
            text,
            &self.text_tokenizer,
            self.text_cls_id,
            self.text_sep_id,
        )?
        else {
            return Ok(Vec::new());
        };
        let text_seq_len = text_tensors.seq_len();
        let num_words = text_tensors.word_count();
        let span_tensors = self.cached_span_tensors(num_words)?;
        let num_spans = num_words * self.max_width;

        let input_ids_tensor = Tensor::from_array(([1, text_seq_len], text_tensors.input_ids))
            .map_err(|error| GlinerBiError::Inference(format!("input_ids: {error}")))?;
        let attention_mask_tensor =
            Tensor::from_array(([1, text_seq_len], text_tensors.attention_mask))
                .map_err(|error| GlinerBiError::Inference(format!("attention_mask: {error}")))?;
        let words_mask_tensor = Tensor::from_array(([1, text_seq_len], text_tensors.words_mask))
            .map_err(|error| GlinerBiError::Inference(format!("words_mask: {error}")))?;
        let text_lengths_tensor = Tensor::from_array(([1, 1], vec![num_words as i64]))
            .map_err(|error| GlinerBiError::Inference(format!("text_lengths: {error}")))?;
        let span_idx_tensor =
            Tensor::from_array(([1, num_spans, 2], span_tensors.span_idx.as_ref().clone()))
                .map_err(|error| GlinerBiError::Inference(format!("span_idx: {error}")))?;
        let span_mask_tensor =
            Tensor::from_array(([1, num_spans], span_tensors.span_mask.as_ref().clone()))
                .map_err(|error| GlinerBiError::Inference(format!("span_mask: {error}")))?;
        let outputs = match &self.label_inputs {
            GlinerBiLabelInputs::Tokenized => {
                let labels_input_ids_tensor = Tensor::from_array((
                    [label_set.label_count(), label_set.max_label_len],
                    label_set.input_ids.clone(),
                ))
                .map_err(|error| GlinerBiError::Inference(format!("labels_input_ids: {error}")))?;
                let labels_attention_mask_tensor = Tensor::from_array((
                    [label_set.label_count(), label_set.max_label_len],
                    label_set.attention_mask.clone(),
                ))
                .map_err(|error| {
                    GlinerBiError::Inference(format!("labels_attention_mask: {error}"))
                })?;

                let inputs = ort::inputs! {
                    "input_ids" => input_ids_tensor,
                    "attention_mask" => attention_mask_tensor,
                    "words_mask" => words_mask_tensor,
                    "text_lengths" => text_lengths_tensor,
                    "span_idx" => span_idx_tensor,
                    "span_mask" => span_mask_tensor,
                    "labels_input_ids" => labels_input_ids_tensor,
                    "labels_attention_mask" => labels_attention_mask_tensor,
                }
                .map_err(|error| GlinerBiError::Inference(format!("build inputs: {error}")))?;

                self.session
                    .run(inputs)
                    .map_err(|error| GlinerBiError::Inference(format!("session run: {error}")))?
            }
            GlinerBiLabelInputs::Embeddings(store) => {
                let labels_embeds = store.embeddings_for(&label_set.labels)?;
                let labels_embeds_tensor = Tensor::from_array((
                    [label_set.label_count(), store.hidden_size],
                    labels_embeds,
                ))
                .map_err(|error| GlinerBiError::Inference(format!("labels_embeds: {error}")))?;

                let inputs = ort::inputs! {
                    "input_ids" => input_ids_tensor,
                    "attention_mask" => attention_mask_tensor,
                    "words_mask" => words_mask_tensor,
                    "text_lengths" => text_lengths_tensor,
                    "span_idx" => span_idx_tensor,
                    "span_mask" => span_mask_tensor,
                    "labels_embeds" => labels_embeds_tensor,
                }
                .map_err(|error| GlinerBiError::Inference(format!("build inputs: {error}")))?;

                self.session
                    .run(inputs)
                    .map_err(|error| GlinerBiError::Inference(format!("session run: {error}")))?
            }
        };
        let logits = extract_logits(
            outputs
                .get("logits")
                .ok_or_else(|| GlinerBiError::Inference("missing logits output".to_owned()))?,
        )?;
        decode_predictions(
            text,
            &text_tensors.words,
            label_set,
            self.max_width,
            options.threshold,
            options.overlap_policy,
            &logits,
        )
    }

    fn cached_label_set(&self, labels: &[String]) -> Result<Arc<GlinerBiLabelSet>, GlinerBiError> {
        {
            let cache = self.label_cache.lock().map_err(|_| {
                GlinerBiError::Inference("GLiNER-BI label cache lock poisoned".to_owned())
            })?;
            if let Some((_, label_set)) = cache
                .entries
                .iter()
                .find(|(cached_labels, _)| cached_labels.as_slice() == labels)
            {
                return Ok(Arc::clone(label_set));
            }
        }

        let label_set = Arc::new(self.prepare_labels(labels)?);
        let mut cache = self.label_cache.lock().map_err(|_| {
            GlinerBiError::Inference("GLiNER-BI label cache lock poisoned".to_owned())
        })?;
        if let Some((_, existing)) = cache
            .entries
            .iter()
            .find(|(cached_labels, _)| cached_labels.as_slice() == labels)
        {
            return Ok(Arc::clone(existing));
        }
        if cache.entries.len() >= 16 {
            cache.entries.remove(0);
        }
        cache
            .entries
            .push((labels.to_vec(), Arc::clone(&label_set)));
        Ok(label_set)
    }

    fn cached_span_tensors(&self, num_words: usize) -> Result<CachedSpanTensors, GlinerBiError> {
        {
            let cache = self.span_cache.lock().map_err(|_| {
                GlinerBiError::Inference("GLiNER-BI span cache lock poisoned".to_owned())
            })?;
            if let Some((_, tensors)) = cache
                .entries
                .iter()
                .find(|(word_count, _)| *word_count == num_words)
            {
                return Ok(tensors.clone());
            }
        }

        let (span_idx, span_mask) = build_span_tensors(num_words, self.max_width);
        let tensors = CachedSpanTensors {
            span_idx: Arc::new(span_idx),
            span_mask: Arc::new(span_mask),
        };
        let mut cache = self.span_cache.lock().map_err(|_| {
            GlinerBiError::Inference("GLiNER-BI span cache lock poisoned".to_owned())
        })?;
        if let Some((_, existing)) = cache
            .entries
            .iter()
            .find(|(word_count, _)| *word_count == num_words)
        {
            return Ok(existing.clone());
        }
        if cache.entries.len() >= 128 {
            cache.entries.remove(0);
        }
        cache.entries.push((num_words, tensors.clone()));
        Ok(tensors)
    }
}

impl GlinerBiLabelEmbeddingStore {
    fn load(model_dir: &Path) -> Result<Self, GlinerBiError> {
        let path = env::var("PHOENIX_GLINER_BI_LABEL_EMBEDDINGS")
            .map(PathBuf::from)
            .unwrap_or_else(|_| model_dir.join("labels_embeddings.json"));
        let contents = fs::read_to_string(&path).map_err(|error| {
            GlinerBiError::ModelLoad(format!(
                "failed to read label embeddings {}: {error}",
                path.display()
            ))
        })?;
        let file: GlinerBiLabelEmbeddingsFile =
            serde_json::from_str(&contents).map_err(|error| {
                GlinerBiError::ModelLoad(format!(
                    "failed to parse label embeddings {}: {error}",
                    path.display()
                ))
            })?;
        let mut labels = HashMap::with_capacity(file.labels.len());
        for row in file.labels {
            if row.embedding.len() != file.hidden_size {
                return Err(GlinerBiError::ModelLoad(format!(
                    "label embedding '{}' has width {}, expected {}",
                    row.label,
                    row.embedding.len(),
                    file.hidden_size
                )));
            }
            labels.insert(row.label, Arc::new(row.embedding));
        }
        Ok(Self {
            hidden_size: file.hidden_size,
            labels,
        })
    }

    fn embeddings_for(&self, labels: &[String]) -> Result<Vec<f32>, GlinerBiError> {
        let mut out = Vec::with_capacity(labels.len() * self.hidden_size);
        for label in labels {
            let Some(embedding) = self.labels.get(label.as_str()) else {
                return Err(GlinerBiError::InvalidInput(format!(
                    "no precomputed GLiNER-BI label embedding for '{label}'"
                )));
            };
            out.extend_from_slice(embedding);
        }
        Ok(out)
    }
}

fn find_model_asset(root: &Path) -> Result<PathBuf, GlinerBiError> {
    if let Ok(file_name) = env::var("PHOENIX_GLINER_BI_ONNX_FILE") {
        let path = root.join(file_name);
        if path.exists() {
            return Ok(path);
        }
        return Err(GlinerBiError::ModelLoad(format!(
            "PHOENIX_GLINER_BI_ONNX_FILE points to missing asset under {}",
            root.display()
        )));
    }
    find_existing_path(
        root,
        &[
            "model.onnx",
            "onnx/model.onnx",
            "model_quantized.onnx",
            "onnx/model_quantized.onnx",
        ],
    )
}

fn detect_label_input_mode(
    model_dir: &Path,
    session: &Session,
) -> Result<GlinerBiLabelInputs, GlinerBiError> {
    let has_label_embeds = session
        .inputs
        .iter()
        .any(|input| input.name == "labels_embeds");
    if has_label_embeds {
        return Ok(GlinerBiLabelInputs::Embeddings(Arc::new(
            GlinerBiLabelEmbeddingStore::load(model_dir)?,
        )));
    }
    Ok(GlinerBiLabelInputs::Tokenized)
}

fn gliner_bi_thread_count() -> usize {
    env::var("PHOENIX_GLINER_BI_THREADS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|&value| value > 0)
        .unwrap_or_else(recommended_thread_count)
}

fn load_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn find_existing_path(dir: &Path, candidates: &[&str]) -> Result<PathBuf, GlinerBiError> {
    for &candidate in candidates {
        let path = dir.join(candidate);
        if path.exists() {
            return Ok(path);
        }
    }
    Err(GlinerBiError::ModelLoad(format!(
        "none of the candidates {:?} found in {}",
        candidates,
        dir.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlap_policy_parser_accepts_cli_friendly_names() {
        assert_eq!(
            GlinerBiOverlapPolicy::parse("keep-all").unwrap(),
            GlinerBiOverlapPolicy::KeepAll
        );
        assert_eq!(
            GlinerBiOverlapPolicy::parse("longest").unwrap(),
            GlinerBiOverlapPolicy::LongestThenScore
        );
    }
}
