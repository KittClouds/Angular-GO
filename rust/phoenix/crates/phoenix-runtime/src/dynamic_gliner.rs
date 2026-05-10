use std::env;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use phoenix_dynamic_ner::{
    DiscoveredSpan, DynamicNerModel, EntityLabel, LabelPack, LocalMentionId, MentionVote,
    ModelNerWindow, NerModelError, VerificationCase,
};
use phoenix_rel_post::{GlinerBiModel, GlinerBiOverlapPolicy, GlinerBiPredictOptions};
use phoenix_types::TextRange;

static GLINER_MODEL: OnceLock<Result<Arc<GlinerBiModel>, String>> = OnceLock::new();

pub fn load_default_model() -> Result<Box<dyn DynamicNerModel + Send + Sync>, String> {
    let model = GLINER_MODEL
        .get_or_init(|| {
            let root = find_default_model_root().ok_or_else(|| {
                "missing PHOENIX_DYN_NER_MODEL_ROOT and no gliner-bi-small-onnx directory found"
                    .to_owned()
            })?;
            GlinerBiModel::load(&root)
                .map(Arc::new)
                .map_err(|error| format!("failed to load {}: {error}", root.display()))
        })
        .as_ref()
        .map_err(Clone::clone)?;

    Ok(Box::new(RuntimeGlinerBiModel {
        model: Arc::clone(model),
        threshold: threshold(),
        overlap_policy: overlap_policy(),
    }))
}

struct RuntimeGlinerBiModel {
    model: Arc<GlinerBiModel>,
    threshold: f32,
    overlap_policy: GlinerBiOverlapPolicy,
}

impl DynamicNerModel for RuntimeGlinerBiModel {
    fn discover(
        &self,
        window: &ModelNerWindow<'_>,
        label_pack: &LabelPack,
    ) -> Result<Vec<DiscoveredSpan>, NerModelError> {
        let labels = model_labels(label_pack);
        if labels.is_empty() {
            return Ok(Vec::new());
        }

        let options = GlinerBiPredictOptions {
            threshold: self.threshold,
            overlap_policy: self.overlap_policy,
            ..Default::default()
        };
        let predictions = self
            .model
            .predict_with_options(window.text, &labels, &options)
            .map_err(|error| NerModelError::Inference(error.to_string()))?;

        Ok(predictions
            .into_iter()
            .map(|prediction| DiscoveredSpan {
                window_relative_range: TextRange {
                    start: prediction.span_start as u32,
                    end: prediction.span_end as u32,
                },
                surface: prediction.text.into(),
                label: EntityLabel::new(runtime_label(&prediction.label)),
                confidence: prediction.score,
            })
            .collect())
    }

    fn verify(
        &self,
        _cases: &[VerificationCase],
    ) -> Result<Vec<(LocalMentionId, MentionVote)>, NerModelError> {
        Ok(Vec::new())
    }
}

fn model_labels(label_pack: &LabelPack) -> Vec<String> {
    let mut labels = Vec::new();
    for label in &label_pack.labels {
        let mapped = match label.as_str() {
            "Character" | "Npc" | "NPC" | "Person" | "Rank" => "Person",
            "Organization" | "Faction" | "Alliance" | "Department" => "Organization",
            "Location" | "Region" | "Landmark" => "Location",
            other => other,
        };
        if !labels.iter().any(|existing| existing == mapped) {
            labels.push(mapped.to_owned());
        }
    }
    labels
}

fn runtime_label(label: &str) -> &str {
    match label {
        "Person" => "Character",
        "Organization" => "Organization",
        "Location" => "Location",
        other => other,
    }
}

fn threshold() -> f32 {
    env::var("PHOENIX_DYN_NER_THRESHOLD")
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .filter(|value| value.is_finite() && *value > 0.0 && *value < 1.0)
        .unwrap_or(0.35)
}

fn overlap_policy() -> GlinerBiOverlapPolicy {
    env::var("PHOENIX_DYN_NER_OVERLAP_POLICY")
        .ok()
        .and_then(|value| GlinerBiOverlapPolicy::parse(&value).ok())
        .unwrap_or_default()
}

fn find_default_model_root() -> Option<PathBuf> {
    if let Some(root) = env::var_os("PHOENIX_DYN_NER_MODEL_ROOT").map(PathBuf::from) {
        if root.is_dir() {
            return Some(root);
        }
    }

    let cwd = env::current_dir().ok()?;
    for base in cwd.ancestors().take(6) {
        for name in ["gliner-bi-small-onnx", "gliner-bi-onnx"] {
            let candidate = base.join(name);
            if looks_like_gliner_root(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn looks_like_gliner_root(path: &Path) -> bool {
    path.is_dir()
        && (path.join("tokenizer.json").is_file()
            || path.join("text_tokenizer").join("tokenizer.json").is_file())
}
