//! Phoenix NER Engine — the Surface Intelligence Layer orchestrator.
//!
//! Pipeline: known lane → native lane → router plans → model lane →
//! adjudication → scoring → graph build → SurfaceNerOutput.

use phoenix_alex::Lexicon;
use phoenix_types::{Diagnostic, ScopeKey, SentenceSpan, TextRange, TokenSpan};
use thiserror::Error;

use crate::graph::{MentionGraph, MentionGraphBuilder};
use crate::hints::{build_chunk_hints, ChunkHint};
use crate::known_lane::KnownSurfaceLane;
use crate::native_lane::NativeDiscoveryLane;
use crate::router::SurfaceRouter;
use crate::schema::DynamicSchemaBuilder;
use crate::scoring::MentionWorkspace;
use crate::traits::{DynamicNerModel, MentionAdjudicator, ModelNerWindow};
use crate::types::{MentionPacket, NerRoute};

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

/// Input to the NER engine.
pub struct SurfaceNerInput<'a> {
    pub document_id: &'a str,
    pub text: &'a str,
    pub tokens: &'a [TokenSpan],
    pub sentences: &'a [SentenceSpan],
    pub scope: &'a ScopeKey,
    pub lexicon: Option<&'a Lexicon>,
}

/// Output from the NER engine.
#[derive(Clone, Debug)]
pub struct SurfaceNerOutput {
    pub mentions: Vec<MentionPacket>,
    pub mention_graph: MentionGraph,
    pub chunk_hints: Vec<ChunkHint>,
    pub diagnostics: Vec<Diagnostic>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum NerError {
    #[error("known-lane error: {0}")]
    KnownLane(String),
    #[error("native-lane error: {0}")]
    NativeLane(String),
    #[error("model error: {0}")]
    Model(String),
    #[error("adjudication error: {0}")]
    Adjudication(String),
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/// The Phoenix NER engine — orchestrates four lanes into mention evidence.
pub struct PhoenixNerEngine {
    router: SurfaceRouter,
    dynamic_schema: DynamicSchemaBuilder,
    adjudicator: Option<Box<dyn MentionAdjudicator + Send + Sync>>,
    model_ner: Option<Box<dyn DynamicNerModel + Send + Sync>>,
}

/// Builder for PhoenixNerEngine.
pub struct PhoenixNerEngineBuilder {
    router: SurfaceRouter,
    schema: DynamicSchemaBuilder,
    adjudicator: Option<Box<dyn MentionAdjudicator + Send + Sync>>,
    model_ner: Option<Box<dyn DynamicNerModel + Send + Sync>>,
}

impl PhoenixNerEngineBuilder {
    pub fn new() -> Self {
        Self {
            router: SurfaceRouter::default(),
            schema: DynamicSchemaBuilder::default(),
            adjudicator: None,
            model_ner: None,
        }
    }

    pub fn router(mut self, router: SurfaceRouter) -> Self {
        self.router = router;
        self
    }

    pub fn schema(mut self, schema: DynamicSchemaBuilder) -> Self {
        self.schema = schema;
        self
    }

    pub fn adjudicator(mut self, adj: Box<dyn MentionAdjudicator + Send + Sync>) -> Self {
        self.adjudicator = Some(adj);
        self
    }

    pub fn model(mut self, model: Box<dyn DynamicNerModel + Send + Sync>) -> Self {
        self.model_ner = Some(model);
        self
    }

    pub fn build(self) -> PhoenixNerEngine {
        PhoenixNerEngine {
            router: self.router,
            dynamic_schema: self.schema,
            adjudicator: self.adjudicator,
            model_ner: self.model_ner,
        }
    }
}

impl Default for PhoenixNerEngineBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl PhoenixNerEngine {
    /// Run the full NER pipeline.
    pub fn extract_mentions(
        &self,
        input: &SurfaceNerInput<'_>,
    ) -> Result<SurfaceNerOutput, NerError> {
        let mut diagnostics = Vec::new();

        // === Lane 1: Known Surface ===
        let known_candidates = if let Some(lexicon) = input.lexicon {
            KnownSurfaceLane::scan(lexicon, input.scope, input.text, input.sentences, 0)
        } else {
            Vec::new()
        };
        let known_count = known_candidates.len();

        // === Lane 2: Native Discovery ===
        let known_ranges: Vec<TextRange> = known_candidates.iter().map(|c| c.range).collect();
        let native_id_base = known_count as u64;
        let native_candidates = NativeDiscoveryLane::discover(
            input.text,
            input.tokens,
            input.sentences,
            &known_ranges,
            native_id_base,
        );
        let workspace_id_base = native_id_base + native_candidates.len() as u64;

        // === Router: plan routes ===
        let needs = self.router.build_need_vectors(
            input.text,
            input.sentences,
            &known_candidates,
            &native_candidates,
        );
        let routes = self.router.plan_routes(
            input.sentences,
            &needs,
            &self.dynamic_schema,
            &known_candidates,
            &native_candidates,
        );

        // Ingest deterministic lanes into workspace.
        let mut workspace = MentionWorkspace::new(input.document_id, workspace_id_base);
        workspace.add_known(known_candidates);
        workspace.add_native(native_candidates);

        // === Lane 3 + 4: Model + Adjudication (optional) ===
        for route in routes {
            match route {
                NerRoute::DeterministicOnly | NerRoute::NativeDiscovery => {}

                NerRoute::ModelDiscovery {
                    window_start_sentence,
                    window_end_sentence,
                    label_pack,
                } => {
                    if let Some(model) = self.model_ner.as_ref() {
                        let (window_text, window_start_offset) = Self::extract_window_text(
                            input.text,
                            input.sentences,
                            window_start_sentence,
                            window_end_sentence,
                        );
                        let window = ModelNerWindow {
                            text: window_text,
                            window_start_sentence,
                            window_end_sentence,
                        };
                        match model.discover(&window, &label_pack) {
                            Ok(spans) => {
                                for span in spans {
                                    let doc_start =
                                        window_start_offset + span.window_relative_range.start;
                                    let doc_end =
                                        window_start_offset + span.window_relative_range.end;

                                    // Find sentence index
                                    let mut sent_idx = window_start_sentence;
                                    for idx in window_start_sentence..window_end_sentence {
                                        if let Some(s) = input.sentences.get(idx as usize) {
                                            if doc_start >= s.range.start && doc_start < s.range.end
                                            {
                                                sent_idx = idx;
                                                break;
                                            }
                                        }
                                    }

                                    let vote = crate::types::MentionVote {
                                        source: crate::types::MentionSourceKind::ModelDiscovery,
                                        label: Some(span.label.clone()),
                                        entity_ref: None,
                                        confidence: span.confidence,
                                        reason: crate::types::VoteReason::ModelLabel,
                                    };
                                    workspace.add_discovered_span(
                                        phoenix_types::TextRange {
                                            start: doc_start,
                                            end: doc_end,
                                        },
                                        span.surface.clone(),
                                        sent_idx,
                                        vote,
                                    );
                                }
                            }
                            Err(e) => diagnostics.push(Diagnostic {
                                code: "NER_MODEL_FAIL".into(),
                                message: e.to_string(),
                            }),
                        }
                    }
                }

                NerRoute::ModelVerify { cases } => {
                    if let Some(model) = self.model_ner.as_ref() {
                        let verify_cases: Vec<_> = cases
                            .iter()
                            .map(|c| crate::traits::VerificationCase {
                                mention_id: c.mention_id,
                                surface: c.surface.clone(),
                                sentence_text: compact_str::CompactString::new(""),
                                candidate_labels: c.candidate_labels.clone(),
                            })
                            .collect();
                        match model.verify(&verify_cases) {
                            Ok(votes) => workspace.add_model_votes(votes),
                            Err(e) => diagnostics.push(Diagnostic {
                                code: "NER_VERIFY_FAIL".into(),
                                message: e.to_string(),
                            }),
                        }
                    }
                }

                NerRoute::Adjudicate { cases } => {
                    if let Some(adj) = self.adjudicator.as_ref() {
                        let adj_cases: Vec<_> = cases
                            .iter()
                            .map(|c| crate::traits::AdjudicationCase {
                                mention_id: c.mention_id,
                                task: crate::traits::InstructTask::SpanIsEntity,
                                surface: c.surface.clone(),
                                sentence_text: compact_str::CompactString::new(""),
                                neighbor_sentence: None,
                                candidate_labels: c.candidate_labels.clone(),
                                candidate_entities: c.candidate_entity_refs.clone(),
                            })
                            .collect();
                        match adj.adjudicate(&adj_cases) {
                            Ok(decisions) => {
                                let votes: Vec<_> = decisions
                                    .into_iter()
                                    .map(|d| {
                                        let reason = match d.decision {
                                            crate::traits::DecisionKind::Accept => {
                                                crate::types::VoteReason::NliSupport
                                            }
                                            crate::traits::DecisionKind::Reject => {
                                                crate::types::VoteReason::NliContradiction
                                            }
                                            _ => crate::types::VoteReason::NliSupport,
                                        };
                                        (
                                            d.mention_id,
                                            crate::types::MentionVote {
                                                source:
                                                    crate::types::MentionSourceKind::Adjudication,
                                                label: d.chosen_label,
                                                entity_ref: d.chosen_entity,
                                                confidence: d.confidence,
                                                reason,
                                            },
                                        )
                                    })
                                    .collect();
                                workspace.apply_adjudication(votes);
                            }
                            Err(e) => diagnostics.push(Diagnostic {
                                code: "NER_ADJUDICATE_FAIL".into(),
                                message: e.to_string(),
                            }),
                        }
                    }
                }
            }
        }

        // === Finalize ===
        let packets = workspace.finalize_packets();
        let mention_graph = MentionGraphBuilder::build(&packets);
        let chunk_hints = build_chunk_hints(
            input.text,
            input.sentences,
            &packets,
            &mention_graph,
            &needs,
        );

        Ok(SurfaceNerOutput {
            mentions: packets,
            mention_graph,
            chunk_hints,
            diagnostics,
        })
    }

    fn extract_window_text<'a>(
        text: &'a str,
        sentences: &[SentenceSpan],
        start_sent: u32,
        end_sent: u32,
    ) -> (&'a str, u32) {
        let first = sentences.get(start_sent as usize);
        let last = sentences.get((end_sent as usize).saturating_sub(1));
        match (first, last) {
            (Some(f), Some(l)) => {
                let s = f.range.start as usize;
                let e = l.range.end as usize;
                (text.get(s..e).unwrap_or(""), f.range.start)
            }
            _ => ("", 0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ChunkHintKind, MentionKind};
    use phoenix_types::{PosTag, TokenClass, TokenSpan};

    #[test]
    fn engine_builds_with_defaults() {
        let engine = PhoenixNerEngineBuilder::new().build();
        let input = SurfaceNerInput {
            document_id: "doc1",
            text: "",
            tokens: &[],
            sentences: &[],
            scope: &ScopeKey::default(),
            lexicon: None,
        };
        let result = engine.extract_mentions(&input).unwrap();
        assert!(result.mentions.is_empty());
        assert_eq!(result.mention_graph.edge_count(), 0);
        assert!(result.chunk_hints.is_empty());
    }

    #[test]
    fn engine_processes_known_entities() {
        use phoenix_types::{EntityId, EntityKind, GenderHint, LexiconEntry};

        let entries = vec![LexiconEntry {
            entity_id: EntityId("k1".into()),
            label: "Kamaria".into(),
            aliases: vec![],
            kind: Some(EntityKind::Character),
            gender: Some(GenderHint::Female),
            number: None,
            scope: ScopeKey::default(),
        }];
        let lexicon = Lexicon::from_entries(&entries).unwrap();
        let text = "Kamaria drew her blade.";
        let sentences = vec![SentenceSpan {
            index: 0,
            range: TextRange {
                start: 0,
                end: text.len() as u32,
            },
        }];

        let engine = PhoenixNerEngineBuilder::new().build();
        let input = SurfaceNerInput {
            document_id: "doc1",
            text,
            tokens: &[],
            sentences: &sentences,
            scope: &ScopeKey::default(),
            lexicon: Some(&lexicon),
        };
        let result = engine.extract_mentions(&input).unwrap();
        assert!(!result.mentions.is_empty());
        assert_eq!(result.mentions[0].surface.as_str(), "Kamaria");
    }

    #[test]
    fn repeated_scan_produces_identical_hint_ids() {
        let (lexicon, scope) = test_lexicon(&["Aella", "Kai"]);
        let text = "Aella met Kai at the bridge.";
        let sentences = one_sentence(text);
        let engine = PhoenixNerEngineBuilder::new().build();
        let input = SurfaceNerInput {
            document_id: "doc1",
            text,
            tokens: &[],
            sentences: &sentences,
            scope: &scope,
            lexicon: Some(&lexicon),
        };
        let left = engine.extract_mentions(&input).unwrap();
        let right = engine.extract_mentions(&input).unwrap();
        let left_ids = left
            .chunk_hints
            .iter()
            .map(|hint| hint.id.clone())
            .collect::<Vec<_>>();
        let right_ids = right
            .chunk_hints
            .iter()
            .map(|hint| hint.id.clone())
            .collect::<Vec<_>>();
        assert_eq!(left_ids, right_ids);
    }

    #[test]
    fn known_entity_pair_creates_entity_pair_hint() {
        let (lexicon, scope) = test_lexicon(&["Aella", "Kai"]);
        let text = "Aella met Kai at the bridge.";
        let sentences = one_sentence(text);
        let engine = PhoenixNerEngineBuilder::new().build();
        let input = SurfaceNerInput {
            document_id: "doc1",
            text,
            tokens: &[],
            sentences: &sentences,
            scope: &scope,
            lexicon: Some(&lexicon),
        };
        let result = engine.extract_mentions(&input).unwrap();
        assert!(result
            .chunk_hints
            .iter()
            .any(|hint| hint.kind == ChunkHintKind::EntityPair));
    }

    #[test]
    fn pronoun_or_nominal_ambiguity_creates_relationship_or_adjudication_hint() {
        let (lexicon, scope) = test_lexicon(&["Aella"]);
        let text = "Aella thanked the captain. She trusted the captain.";
        let sentences = period_sentences(text);
        let tokens = simple_tokens(text);
        let engine = PhoenixNerEngineBuilder::new().build();
        let input = SurfaceNerInput {
            document_id: "doc1",
            text,
            tokens: &tokens,
            sentences: &sentences,
            scope: &scope,
            lexicon: Some(&lexicon),
        };
        let result = engine.extract_mentions(&input).unwrap();
        assert!(result
            .mentions
            .iter()
            .any(|mention| mention.mention_kind == MentionKind::Nominal));
        assert!(result.chunk_hints.iter().any(|hint| {
            matches!(
                hint.kind,
                ChunkHintKind::Relationship | ChunkHintKind::Adjudication
            )
        }));
    }

    #[test]
    fn unchanged_text_produces_no_duplicate_hint_ids() {
        let (lexicon, scope) = test_lexicon(&["Aella", "Kai"]);
        let text = "Aella met Kai. Aella warned Kai.";
        let sentences = period_sentences(text);
        let engine = PhoenixNerEngineBuilder::new().build();
        let input = SurfaceNerInput {
            document_id: "doc1",
            text,
            tokens: &[],
            sentences: &sentences,
            scope: &scope,
            lexicon: Some(&lexicon),
        };
        let result = engine.extract_mentions(&input).unwrap();
        let unique = result
            .chunk_hints
            .iter()
            .map(|hint| hint.id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), result.chunk_hints.len());
    }

    #[test]
    fn deterministic_ner_path_stays_under_one_second_budget() {
        let (lexicon, scope) = test_lexicon(&["Aella", "Kai"]);
        let text = "Aella met Kai at the bridge. ".repeat(80);
        let sentences = repeated_sentences(&text, "Aella met Kai at the bridge. ");
        let engine = PhoenixNerEngineBuilder::new().build();
        let input = SurfaceNerInput {
            document_id: "doc1",
            text: &text,
            tokens: &[],
            sentences: &sentences,
            scope: &scope,
            lexicon: Some(&lexicon),
        };
        let started = std::time::Instant::now();
        let result = engine.extract_mentions(&input).unwrap();
        assert!(!result.chunk_hints.is_empty());
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    fn test_lexicon(names: &[&str]) -> (Lexicon, ScopeKey) {
        use phoenix_types::{EntityId, EntityKind, GenderHint, LexiconEntry};

        let scope = ScopeKey::default();
        let entries = names
            .iter()
            .map(|name| LexiconEntry {
                entity_id: EntityId(name.to_ascii_lowercase()),
                label: (*name).to_owned(),
                aliases: vec![],
                kind: Some(EntityKind::Character),
                gender: Some(GenderHint::Unknown),
                number: None,
                scope: scope.clone(),
            })
            .collect::<Vec<_>>();
        (Lexicon::from_entries(&entries).unwrap(), scope)
    }

    fn one_sentence(text: &str) -> Vec<SentenceSpan> {
        vec![SentenceSpan {
            index: 0,
            range: TextRange {
                start: 0,
                end: text.len() as u32,
            },
        }]
    }

    fn period_sentences(text: &str) -> Vec<SentenceSpan> {
        let mut sentences = Vec::new();
        let mut start = 0usize;
        for (idx, ch) in text.char_indices() {
            if ch == '.' {
                sentences.push(SentenceSpan {
                    index: sentences.len(),
                    range: TextRange {
                        start: start as u32,
                        end: (idx + 1) as u32,
                    },
                });
                start = idx + 1;
                while start < text.len() && text.as_bytes()[start].is_ascii_whitespace() {
                    start += 1;
                }
            }
        }
        sentences
    }

    fn repeated_sentences(text: &str, sentence: &str) -> Vec<SentenceSpan> {
        let mut start = 0u32;
        let mut sentences = Vec::new();
        while (start as usize) < text.len() {
            let end = (start as usize + sentence.trim_end().len()) as u32;
            sentences.push(SentenceSpan {
                index: sentences.len(),
                range: TextRange { start, end },
            });
            start = (start as usize + sentence.len()) as u32;
        }
        sentences
    }

    fn simple_tokens(text: &str) -> Vec<TokenSpan> {
        let mut tokens = Vec::new();
        let mut start = None;
        for (idx, ch) in text.char_indices() {
            if ch.is_alphanumeric() || ch == '\'' || ch == '-' {
                start.get_or_insert(idx);
            } else if let Some(s) = start.take() {
                tokens.push(token(text, s, idx));
            }
        }
        if let Some(s) = start {
            tokens.push(token(text, s, text.len()));
        }
        tokens
    }

    fn token(text: &str, start: usize, end: usize) -> TokenSpan {
        let surface = &text[start..end];
        TokenSpan {
            range: TextRange {
                start: start as u32,
                end: end as u32,
            },
            capitalized: surface.starts_with(|ch: char| ch.is_uppercase()),
            pos: matches!(
                surface.to_ascii_lowercase().as_str(),
                "she" | "he" | "they" | "her" | "him"
            )
            .then_some(PosTag::Pronoun),
            token_class: Some(TokenClass::Word),
            masked: false,
        }
    }
}
