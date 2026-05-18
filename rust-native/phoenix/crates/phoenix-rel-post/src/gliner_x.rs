use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::gliner_bi::{
    GlinerBiModel, GlinerBiOverlapPolicy, GlinerBiPredictOptions, GlinerBiPrediction,
};

#[derive(Debug, Error)]
pub enum GlinerXError {
    #[error("failed to load GLiNER-X model: {0}")]
    ModelLoad(String),
    #[error("GLiNER-X inference failed: {0}")]
    Inference(String),
    #[error("invalid GLiNER-X input: {0}")]
    InvalidInput(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlinerXPrediction {
    pub sequence: usize,
    pub text: String,
    pub label: String,
    pub score: f32,
    pub span_start: usize,
    pub span_end: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlinerXMetadata {
    pub model_path: String,
    pub tokenizer_path: String,
    pub threshold: f32,
}

pub struct GlinerXModel {
    model: GlinerBiModel,
    threshold: f32,
    metadata: GlinerXMetadata,
}

impl GlinerXModel {
    pub fn load(model_root: &Path, threshold: f32) -> Result<Self, GlinerXError> {
        if !(0.0..=1.0).contains(&threshold) {
            return Err(GlinerXError::InvalidInput(format!(
                "threshold must be in [0, 1], got {threshold}"
            )));
        }
        let model = GlinerBiModel::load(model_root)
            .map_err(|error| GlinerXError::ModelLoad(error.to_string()))?;
        let bi_metadata = model.metadata();
        let model_path = bi_metadata.model_path.clone();
        let tokenizer_path = bi_metadata.text_tokenizer_path.clone();
        Ok(Self {
            model,
            threshold,
            metadata: GlinerXMetadata {
                model_path,
                tokenizer_path,
                threshold,
            },
        })
    }

    pub fn metadata(&self) -> &GlinerXMetadata {
        &self.metadata
    }

    pub fn predict_texts(
        &self,
        texts: &[&str],
        labels: &[&str],
    ) -> Result<Vec<GlinerXPrediction>, GlinerXError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        if labels.is_empty() {
            return Err(GlinerXError::InvalidInput(
                "at least one label is required".to_owned(),
            ));
        }
        let label_map = labels
            .iter()
            .map(|label| ((*label).to_owned(), model_label_for_requested(label)))
            .collect::<Vec<_>>();
        let label_strings = label_map
            .iter()
            .map(|(_, model_label)| model_label.clone())
            .collect::<Vec<_>>();
        let options = GlinerBiPredictOptions {
            threshold: self.threshold,
            overlap_policy: GlinerBiOverlapPolicy::HighestScore,
        };
        let mut predictions = Vec::new();
        for (sequence, text) in texts.iter().enumerate() {
            predictions.extend(
                self.model
                    .predict_with_options(text, &label_strings, &options)
                    .map_err(|error| GlinerXError::Inference(error.to_string()))?
                    .into_iter()
                    .map(|prediction| map_prediction(sequence, prediction, &label_map)),
            );
        }
        Ok(predictions)
    }
}

fn model_label_for_requested(label: &str) -> String {
    match label.trim().to_ascii_lowercase().as_str() {
        "person" => "Person".to_owned(),
        "organization" | "organisation" => "Organization".to_owned(),
        "location" => "Location".to_owned(),
        _ => label.to_owned(),
    }
}

fn map_prediction(
    sequence: usize,
    prediction: GlinerBiPrediction,
    label_map: &[(String, String)],
) -> GlinerXPrediction {
    let label = label_map
        .iter()
        .find(|(_, model_label)| model_label == &prediction.label)
        .map(|(requested, _)| requested.clone())
        .unwrap_or(prediction.label);
    GlinerXPrediction {
        sequence,
        text: prediction.text,
        label,
        score: prediction.score,
        span_start: prediction.span_start,
        span_end: prediction.span_end,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_bi_prediction_with_sequence_index() {
        let mapped = map_prediction(
            3,
            GlinerBiPrediction {
                text: "New Rome".to_owned(),
                label: "Location".to_owned(),
                span_start: 12,
                span_end: 20,
                score: 0.91,
            },
            &[("location".to_owned(), "Location".to_owned())],
        );
        assert_eq!(mapped.sequence, 3);
        assert_eq!(mapped.text, "New Rome");
        assert_eq!(mapped.label, "location");
        assert_eq!(mapped.span_start, 12);
        assert_eq!(mapped.span_end, 20);
        assert_eq!(mapped.score, 0.91);
    }

    #[test]
    fn canonicalizes_seed_labels_for_bi_embeddings() {
        assert_eq!(model_label_for_requested("person"), "Person");
        assert_eq!(model_label_for_requested("organization"), "Organization");
        assert_eq!(model_label_for_requested("location"), "Location");
        assert_eq!(model_label_for_requested("Artifact"), "Artifact");
    }
}
