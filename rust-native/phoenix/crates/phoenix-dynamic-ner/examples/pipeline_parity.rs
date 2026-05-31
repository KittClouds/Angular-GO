mod pipeline_parity_support;

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::Path;
use std::time::Instant;

use compact_str::CompactString;
use phoenix_dynamic_ner::{
    DiscoveredSpan, DynamicNerModel, DynamicSchemaBuilder, EntityLabel, LabelPack, LocalMentionId,
    MentionVote, ModelNerWindow, NerModelError, PhoenixNerEngineBuilder, SurfaceNerInput,
    SurfaceRouter, VerificationCase,
};
use phoenix_rel_post::{
    GlinerBiModel, GlinerBiOverlapPolicy, GlinerBiPredictOptions, GlinerXModel,
};
use phoenix_types::{ScopeKey, TextRange};

use pipeline_parity_support::{
    clean, print_delta, print_summary, story_lexicon, summarize, tokenize, DocSummary,
};

struct BiBackend {
    model: GlinerBiModel,
    threshold: f32,
    overlap_policy: GlinerBiOverlapPolicy,
}

struct XBackend {
    model: GlinerXModel,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let docs = args_or_default();
    let threshold = env_f32("PHOENIX_DYN_NER_THRESHOLD", 0.35);
    let max_labels = env_usize(
        "PHOENIX_DYN_NER_MAX_LABELS",
        DynamicSchemaBuilder::default().max_labels,
    );
    let max_model_windows = env_usize("PHOENIX_DYN_NER_MAX_MODEL_WINDOWS", 256);
    let bi_path = env::var("PHOENIX_DYN_NER_BI_MODEL_PATH")
        .or_else(|_| env::var("PHOENIX_DYN_NER_MODEL_PATH"))
        .unwrap_or_else(|_| "gliner-bi-small-onnx".to_owned());
    let x_path = env::var("PHOENIX_DYN_NER_X_MODEL_PATH")
        .unwrap_or_else(|_| "G:\\hf-models\\gliner-x-small".to_owned());
    let backend_selection = env::var("PHOENIX_DYN_NER_BACKENDS").unwrap_or_else(|_| "both".into());
    let run_bi = backend_selection != "x";
    let run_x = backend_selection != "bi";
    let overlap_policy = env::var("PHOENIX_DYN_NER_OVERLAP_POLICY")
        .ok()
        .map(|value| GlinerBiOverlapPolicy::parse(&value))
        .transpose()?
        .unwrap_or_default();
    println!(
        "PARITY_CONFIG\tbackends={backend_selection}\tthreshold={threshold:.3}\tmax_labels={max_labels}\tmax_model_windows={max_model_windows}\tbi_model={}\tx_model={}",
        clean(&bi_path),
        clean(&x_path)
    );

    let bi = if run_bi {
        Some(load_bi(
            &bi_path,
            threshold,
            overlap_policy,
            max_labels,
            max_model_windows,
        )?)
    } else {
        None
    };
    let x = if run_x {
        Some(load_x(&x_path, threshold, max_labels, max_model_windows)?)
    } else {
        None
    };
    let mut by_doc = BTreeMap::<String, Vec<DocSummary>>::new();

    for doc in &docs {
        if let Some(engine) = bi.as_ref() {
            by_doc
                .entry(doc.clone())
                .or_default()
                .push(run_doc("bi", engine, doc)?);
        }
        if let Some(engine) = x.as_ref() {
            by_doc
                .entry(doc.clone())
                .or_default()
                .push(run_doc("x", engine, doc)?);
        }
    }

    for summaries in by_doc.values() {
        for summary in summaries {
            print_summary(summary);
        }
        if let [left, right] = summaries.as_slice() {
            print_delta(left, right);
        }
    }
    Ok(())
}

fn load_bi(
    path: &str,
    threshold: f32,
    overlap_policy: GlinerBiOverlapPolicy,
    max_labels: usize,
    max_model_windows: usize,
) -> Result<phoenix_dynamic_ner::PhoenixNerEngine, String> {
    let started = Instant::now();
    let backend = BiBackend {
        model: GlinerBiModel::load(Path::new(path)).map_err(|err| format!("{err:?}"))?,
        threshold,
        overlap_policy,
    };
    println!(
        "BACKEND_LOAD\tbackend=bi\tload_ms={}\tmodel={}",
        started.elapsed().as_millis(),
        clean(path)
    );
    Ok(engine(Box::new(backend), max_labels, max_model_windows))
}

fn load_x(
    path: &str,
    threshold: f32,
    max_labels: usize,
    max_model_windows: usize,
) -> Result<phoenix_dynamic_ner::PhoenixNerEngine, String> {
    let started = Instant::now();
    let backend = XBackend {
        model: GlinerXModel::load(Path::new(path), threshold).map_err(|err| format!("{err:?}"))?,
    };
    println!(
        "BACKEND_LOAD\tbackend=x\tload_ms={}\tmodel={}",
        started.elapsed().as_millis(),
        clean(path)
    );
    Ok(engine(Box::new(backend), max_labels, max_model_windows))
}

fn engine(
    model: Box<dyn DynamicNerModel>,
    max_labels: usize,
    max_model_windows: usize,
) -> phoenix_dynamic_ner::PhoenixNerEngine {
    PhoenixNerEngineBuilder::new()
        .schema(DynamicSchemaBuilder {
            max_labels,
            ..Default::default()
        })
        .router(SurfaceRouter { max_model_windows })
        .model(model)
        .build()
}

impl DynamicNerModel for BiBackend {
    fn discover(
        &self,
        window: &ModelNerWindow<'_>,
        label_pack: &LabelPack,
    ) -> Result<Vec<DiscoveredSpan>, NerModelError> {
        let labels = model_labels(label_pack);
        self.model
            .predict_with_options(
                window.text,
                &labels,
                &GlinerBiPredictOptions {
                    threshold: self.threshold,
                    overlap_policy: self.overlap_policy,
                },
            )
            .map(map_bi_predictions)
            .map_err(|err| NerModelError::Inference(format!("{err:?}")))
    }

    fn verify(
        &self,
        _cases: &[VerificationCase],
    ) -> Result<Vec<(LocalMentionId, MentionVote)>, NerModelError> {
        Ok(Vec::new())
    }
}

impl DynamicNerModel for XBackend {
    fn discover(
        &self,
        window: &ModelNerWindow<'_>,
        label_pack: &LabelPack,
    ) -> Result<Vec<DiscoveredSpan>, NerModelError> {
        let labels = x_model_labels(label_pack);
        let refs = labels
            .iter()
            .map(|(model_label, _)| model_label.as_str())
            .collect::<Vec<_>>();
        self.model
            .predict_texts(&[window.text], &refs)
            .map(|predictions| {
                predictions
                    .into_iter()
                    .map(|prediction| DiscoveredSpan {
                        window_relative_range: TextRange {
                            start: prediction.span_start as u32,
                            end: prediction.span_end as u32,
                        },
                        surface: CompactString::new(prediction.text),
                        label: EntityLabel::new(&canonical_x_label(&prediction.label, &labels)),
                        confidence: prediction.score,
                    })
                    .collect()
            })
            .map_err(|err| NerModelError::Inference(format!("{err:?}")))
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
        let mapped = canonical_model_label(label.as_str());
        if !labels
            .iter()
            .any(|existing: &String| existing.as_str() == mapped.as_str())
        {
            labels.push(mapped);
        }
    }
    labels
}

fn x_model_labels(label_pack: &LabelPack) -> Vec<(String, String)> {
    let mut labels = Vec::new();
    for label in &label_pack.labels {
        let canonical = canonical_model_label(label.as_str());
        let model = canonical.to_ascii_lowercase();
        if !labels
            .iter()
            .any(|(existing, _): &(String, String)| existing == &model)
        {
            labels.push((model, canonical));
        }
    }
    labels
}

fn canonical_model_label(label: &str) -> String {
    match label {
        "Character" | "Npc" | "NPC" | "Person" | "Rank" => "Person".to_owned(),
        "Organization" | "Faction" | "Alliance" | "Department" => "Organization".to_owned(),
        "Location" | "Region" | "Landmark" => "Location".to_owned(),
        other => other.to_owned(),
    }
}

fn canonical_x_label(label: &str, labels: &[(String, String)]) -> String {
    labels
        .iter()
        .find(|(model_label, _)| model_label == label)
        .map(|(_, canonical)| canonical.clone())
        .unwrap_or_else(|| label.to_owned())
}

fn map_bi_predictions(
    predictions: Vec<phoenix_rel_post::GlinerBiPrediction>,
) -> Vec<DiscoveredSpan> {
    predictions
        .into_iter()
        .map(|prediction| DiscoveredSpan {
            window_relative_range: TextRange {
                start: prediction.span_start as u32,
                end: prediction.span_end as u32,
            },
            surface: CompactString::new(prediction.text),
            label: EntityLabel::new(prediction.label.as_str()),
            confidence: prediction.score,
        })
        .collect()
}

fn run_doc(
    backend: &'static str,
    engine: &phoenix_dynamic_ner::PhoenixNerEngine,
    doc: &str,
) -> Result<DocSummary, Box<dyn std::error::Error>> {
    let text = fs::read_to_string(doc)?;
    let (tokens, sentences) = tokenize(&text);
    let lexicon = story_lexicon()?;
    let scope = ScopeKey::default();
    let input = SurfaceNerInput {
        document_id: "ner-pipeline-parity",
        text: &text,
        tokens: &tokens,
        sentences: &sentences,
        scope: &scope,
        lexicon: Some(&lexicon),
        surface_hits: &[],
    };
    let started = Instant::now();
    let output = engine.extract_mentions(&input)?;
    Ok(summarize(
        backend,
        doc,
        started.elapsed().as_millis(),
        &output.mentions,
        &output.surface_memory,
    ))
}

fn args_or_default() -> Vec<String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        vec![
            "docs\\shortrun.md".to_owned(),
            "docs\\mother2.md".to_owned(),
        ]
    } else {
        args
    }
}

fn env_usize(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn env_f32(name: &str, default: f32) -> f32 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}
