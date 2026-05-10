//! Desktop workspace bridge for the native GLiNER BI relation/post model code.
//!
//! This intentionally exposes only the BI-small NER seed pieces needed by the
//! runtime dynamic NER lane, without pulling a second Phoenix workspace graph.

#[allow(dead_code)]
#[path = "../../../../../rust-native/phoenix/crates/phoenix-rel-post/src/ort_runtime.rs"]
mod ort_runtime;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-rel-post/src/gliner_bi.rs"]
mod gliner_bi;
#[path = "../../../../../rust-native/phoenix/crates/phoenix-rel-post/src/gliner_bi_tensors.rs"]
mod gliner_bi_tensors;

pub use gliner_bi::{
    GlinerBiError, GlinerBiLabelSet, GlinerBiModel, GlinerBiModelMetadata, GlinerBiOverlapPolicy,
    GlinerBiPredictOptions, GlinerBiPrediction,
};
