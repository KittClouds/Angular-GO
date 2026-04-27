//! Surface Router — the brain of NER routing decisions.
//!
//! Builds `NerNeedVector` per sentence/window from workspace state, then
//! emits `NerRoute` decisions. Cheap and merciless: only routes to expensive
//! model lanes when the evidence demands it.

use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use crate::known_lane::KnownCandidate;
use crate::native_lane::{NativeCandidate, NativeDiscoveryLane};
use crate::schema::DynamicSchemaBuilder;
use crate::types::{AdjudicateCase, MentionKind, NerNeedVector, NerRoute};
use phoenix_types::SentenceSpan;

/// Budget cap: max model-discovery windows per document.
const MAX_MODEL_WINDOWS: usize = 64;
/// Sentence padding around a target sentence for model windows.
const MODEL_SENTENCE_PAD: usize = 1;

/// The surface router that plans NER routes for each text window.
pub struct SurfaceRouter {
    /// Max model windows allowed per call.
    pub max_model_windows: usize,
}

impl Default for SurfaceRouter {
    fn default() -> Self {
        Self {
            max_model_windows: MAX_MODEL_WINDOWS,
        }
    }
}

impl SurfaceRouter {
    /// Build per-sentence need vectors from known + native candidates.
    pub fn build_need_vectors(
        &self,
        text: &str,
        sentences: &[SentenceSpan],
        known: &[KnownCandidate],
        native: &[NativeCandidate],
    ) -> Vec<NerNeedVector> {
        let num_sentences = sentences.len();
        if num_sentences == 0 {
            return Vec::new();
        }
        let mut needs = vec![NerNeedVector::default(); num_sentences];

        // Count normalized surface frequencies across native candidates.
        let mut surface_counts = FxHashMap::<&str, u16>::default();
        for c in native {
            if c.mention_kind != MentionKind::Pronoun {
                *surface_counts.entry(c.normalized.as_str()).or_insert(0) += 1;
            }
        }

        // Accumulate known-lane signals.
        for c in known {
            let idx = c.sentence_index as usize;
            if let Some(need) = needs.get_mut(idx) {
                need.has_known_seed = true;
                need.candidate_count = need.candidate_count.saturating_add(1);
            }
        }

        // Accumulate native-lane signals.
        for c in native {
            let idx = c.sentence_index as usize;
            let Some(need) = needs.get_mut(idx) else {
                continue;
            };
            need.candidate_count = need.candidate_count.saturating_add(1);
            match c.mention_kind {
                MentionKind::Pronoun => need.has_pronoun = true,
                MentionKind::Nominal => need.has_nominal_role = true,
                MentionKind::Named => {
                    need.has_unknown_cap_span = true;
                    need.unknown_named_count = need.unknown_named_count.saturating_add(1);
                }
            }
            if surface_counts
                .get(c.normalized.as_str())
                .copied()
                .unwrap_or(0)
                > 1
            {
                need.has_repeated_unknown_surface = true;
            }
        }

        // Dialogue cue detection (SIMD).
        for sentence in sentences {
            if let Some(need) = needs.get_mut(sentence.index) {
                need.has_dialogue_structure = NativeDiscoveryLane::has_dialogue_cue(text, sentence);
            }
        }

        needs
    }

    /// Plan routes from need vectors.
    pub fn plan_routes(
        &self,
        sentences: &[SentenceSpan],
        needs: &[NerNeedVector],
        schema_builder: &DynamicSchemaBuilder,
        known: &[KnownCandidate],
        native: &[NativeCandidate],
    ) -> Vec<NerRoute> {
        let mut routes = Vec::new();
        let mut model_window_count = 0usize;

        // Score and sort sentences by priority (descending).
        let mut scored: Vec<(usize, u16)> = needs
            .iter()
            .enumerate()
            .map(|(i, need)| (i, Self::need_priority(need)))
            .collect();
        scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        let mut marked_model = vec![false; sentences.len()];

        for (sent_idx, _priority) in &scored {
            let need = &needs[*sent_idx];

            // Already enough model windows?
            if model_window_count >= self.max_model_windows {
                break;
            }

            if Self::needs_model_discovery(need) {
                // Mark this sentence + padding for model discovery.
                let start = sent_idx.saturating_sub(MODEL_SENTENCE_PAD);
                let end = (*sent_idx + MODEL_SENTENCE_PAD + 1).min(sentences.len());
                for slot in &mut marked_model[start..end] {
                    *slot = true;
                }
                model_window_count += 1;
            }
        }

        // Merge contiguous marked sentences into model-discovery windows.
        let mut i = 0usize;
        while i < marked_model.len() {
            if !marked_model[i] {
                i += 1;
                continue;
            }
            let start = i;
            while i < marked_model.len() && marked_model[i] {
                i += 1;
            }
            let label_pack =
                schema_builder.build_pack_for_window(start as u32, i as u32, known, native);
            routes.push(NerRoute::ModelDiscovery {
                window_start_sentence: start as u32,
                window_end_sentence: i as u32,
                label_pack,
            });
        }

        // Check for adjudication-worthy sentences (many candidates, low agreement).
        for (sent_idx, need) in needs.iter().enumerate() {
            if Self::needs_adjudication(need) {
                let cases = Self::gather_adjudication_cases(sent_idx as u32, native);
                if !cases.is_empty() {
                    routes.push(NerRoute::Adjudicate { cases });
                }
            }
        }

        routes
    }

    /// Priority score for a sentence — higher means more likely to need model.
    fn need_priority(need: &NerNeedVector) -> u16 {
        let mut p = 0u16;
        if need.has_repeated_unknown_surface {
            p += 5;
        }
        p += need.unknown_named_count.min(4);
        if need.has_dialogue_structure {
            p += 3;
        }
        if need.has_nominal_role {
            p += 2;
        }
        if need.has_pronoun {
            p += 1;
        }
        if need.has_known_seed {
            p += 1;
        }
        p
    }

    /// Should we send this sentence to model discovery?
    fn needs_model_discovery(need: &NerNeedVector) -> bool {
        need.has_repeated_unknown_surface
            || need.unknown_named_count >= 3
            || (need.has_pronoun
                && need.unknown_named_count > 0
                && (need.has_known_seed
                    || need.has_dialogue_structure
                    || need.has_repeated_unknown_surface))
            || (need.has_nominal_role && (need.has_unknown_cap_span || need.has_dialogue_structure))
            || (need.has_known_seed && need.has_repeated_unknown_surface)
    }

    /// Should we route this sentence to adjudication?
    fn needs_adjudication(need: &NerNeedVector) -> bool {
        need.candidate_count >= 4 && need.unknown_named_count >= 2 && need.has_known_seed
    }

    fn gather_adjudication_cases(
        sentence_index: u32,
        native: &[NativeCandidate],
    ) -> SmallVec<[AdjudicateCase; 8]> {
        native
            .iter()
            .filter(|c| c.sentence_index == sentence_index && c.mention_kind == MentionKind::Named)
            .take(8)
            .map(|c| AdjudicateCase {
                mention_id: c.mention_id,
                surface: c.surface.clone(),
                sentence_index,
                candidate_entity_refs: c.entity_ref.iter().cloned().collect(),
                candidate_labels: SmallVec::new(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn need_priority_empty_is_zero() {
        let need = NerNeedVector::default();
        assert_eq!(SurfaceRouter::need_priority(&need), 0);
    }

    #[test]
    fn need_priority_accumulates() {
        let need = NerNeedVector {
            has_repeated_unknown_surface: true,
            unknown_named_count: 2,
            has_dialogue_structure: true,
            ..Default::default()
        };
        // 5 + 2 + 3 = 10
        assert_eq!(SurfaceRouter::need_priority(&need), 10);
    }

    #[test]
    fn needs_model_discovery_for_repeated() {
        let need = NerNeedVector {
            has_repeated_unknown_surface: true,
            ..Default::default()
        };
        assert!(SurfaceRouter::needs_model_discovery(&need));
    }

    #[test]
    fn no_model_for_clean_known() {
        let need = NerNeedVector {
            has_known_seed: true,
            ..Default::default()
        };
        assert!(!SurfaceRouter::needs_model_discovery(&need));
    }

    #[test]
    fn adjudication_needs_high_candidate_count() {
        let need = NerNeedVector {
            candidate_count: 4,
            unknown_named_count: 2,
            has_known_seed: true,
            ..Default::default()
        };
        assert!(SurfaceRouter::needs_adjudication(&need));
    }

    #[test]
    fn no_adjudication_for_low_candidates() {
        let need = NerNeedVector {
            candidate_count: 1,
            unknown_named_count: 0,
            has_known_seed: false,
            ..Default::default()
        };
        assert!(!SurfaceRouter::needs_adjudication(&need));
    }
}
