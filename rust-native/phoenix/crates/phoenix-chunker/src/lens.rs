use std::collections::{BTreeMap, BTreeSet};

use phoenix_types::TextRange;
use scirs2_text::dependency::ArcStandardParser;
use scirs2_text::information_extraction::{Entity, EntityType, Event, TemporalExtractor};
use scirs2_text::keyword_extraction::{extract_keywords, KeywordMethod};
use scirs2_text::string_metrics::{DamerauLevenshteinMetric, StringMetric};
use scirs2_text::topic_modeling::{LatentDirichletAllocation, LdaConfig};
use scirs2_text::vectorize::{CountVectorizer, Vectorizer};
use serde::{Deserialize, Serialize};

use crate::{split_sentence_ranges, BaseChunk};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LensKind {
    Entity,
    Relationship,
    Event,
    Temporal,
    Causal,
    Attribute,
    Worldbuilding,
    Evidence,
}

impl Default for LensKind {
    fn default() -> Self {
        Self::Entity
    }
}

pub type ChunkLens = LensKind;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LensChunk {
    pub id: String,
    pub lens: LensKind,
    pub start: usize,
    pub end: usize,
    pub base_chunk_start: usize,
    pub base_chunk_end: usize,
    pub sentence_start: usize,
    pub sentence_end: usize,
    pub mention_ids: Vec<u64>,
    pub surfaces: Vec<String>,
    pub trigger_terms: Vec<String>,
    pub source_hint_ids: Vec<String>,
    pub content_hash: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphBuildContext {
    pub graph_name: String,
    pub document_id: Option<String>,
    pub scope_key: Option<String>,
    pub created_at: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDelta {
    pub consumer: String,
    pub lens: ChunkLens,
    pub graph_name: String,
    pub input_chunk_count: usize,
    pub consumed_chunk_count: usize,
    pub chunk_ids: Vec<String>,
    pub node_count: usize,
    pub edge_count: usize,
    pub diagnostics: Vec<String>,
}

pub trait LensChunkConsumer {
    fn lens(&self) -> ChunkLens;
    fn consume(&self, chunks: &[LensChunk], context: GraphBuildContext) -> GraphDelta;
}

pub fn build_graph_delta_for_lens(
    consumer: impl Into<String>,
    lens: ChunkLens,
    chunks: &[LensChunk],
    context: GraphBuildContext,
) -> GraphDelta {
    let lens_chunks = chunks
        .iter()
        .filter(|chunk| chunk.lens == lens)
        .collect::<Vec<_>>();
    let mut node_keys = BTreeSet::new();
    let mut edge_count = 0usize;
    for chunk in &lens_chunks {
        node_keys.extend(chunk.surfaces.iter().cloned());
        node_keys.extend(chunk.trigger_terms.iter().cloned());
        edge_count += chunk.mention_ids.len().saturating_sub(1);
        edge_count += chunk.source_hint_ids.len();
    }
    if lens_chunks.len() > 1 {
        edge_count += lens_chunks.len() - 1;
    }
    let mut diagnostics = Vec::new();
    if lens_chunks.is_empty() {
        diagnostics.push(format!("no {:?} lens chunks supplied", lens));
    }
    GraphDelta {
        consumer: consumer.into(),
        lens,
        graph_name: context.graph_name,
        input_chunk_count: chunks.len(),
        consumed_chunk_count: lens_chunks.len(),
        chunk_ids: lens_chunks.iter().map(|chunk| chunk.id.clone()).collect(),
        node_count: node_keys.len(),
        edge_count,
        diagnostics,
    }
}

pub struct LensChunkInput<'a> {
    pub text: &'a str,
    pub base_chunks: &'a [BaseChunk],
    pub mentions: &'a [LensMention],
    pub ner_hints: &'a [LensChunkHint],
    pub mention_graph: &'a LensMentionGraph,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LensMentionKind {
    Named,
    Nominal,
    Pronoun,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LensVoteReason {
    ExactCanonical,
    ExactAlias,
    AutoAlias,
    FuzzyAnchor,
    TitlePattern,
    CapSpan,
    NominalRole,
    DependencyRole,
    DialogueSpeaker,
    ModelSpan,
    ModelLabel,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LensMention {
    pub mention_id: u64,
    pub range: TextRange,
    pub sentence_index: u32,
    pub surface: String,
    pub normalized: String,
    pub mention_kind: LensMentionKind,
    pub vote_reasons: Vec<LensVoteReason>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LensChunkHintKind {
    EntityDenseRegion,
    EntityPair,
    NamedEventCandidate,
    RoleTitleAppositive,
    AliasIdentity,
    DialogueSpeaker,
    Relationship,
    Adjudication,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LensChunkHintSource {
    SurfaceRouter,
    MentionWorkspace,
    MentionGraph,
    NativeDiscovery,
    ModelDiscovery,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LensChunkHint {
    pub id: String,
    pub kind: LensChunkHintKind,
    pub source: LensChunkHintSource,
    pub range: TextRange,
    pub sentence_start: u32,
    pub sentence_end: u32,
    pub mention_ids: Vec<u64>,
    pub surfaces: Vec<String>,
    pub score_millis: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LensMentionEdgeKind {
    SameNormalizedSurface,
    KnownAliasMatch,
    FuzzyAliasMatch,
    Apposition,
    DependencyCoreArgument,
    SpeakerContinuity,
    PronounCandidate,
    NearbyRepetition,
    ModelLabelCompatibility,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LensMentionEdge {
    pub left: u64,
    pub right: u64,
    pub kind: LensMentionEdgeKind,
    pub weight: f32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LensMentionGraph {
    pub edges: Vec<LensMentionEdge>,
}

#[derive(Clone, Debug)]
pub struct LensChunkerConfig {
    pub enabled_lenses: Vec<LensKind>,
    pub entity_context_sentences: usize,
    pub relationship_context_sentences: usize,
    pub event_context_sentences: usize,
    pub temporal_context_sentences: usize,
    pub causal_context_sentences: usize,
    pub attribute_context_sentences: usize,
    pub worldbuilding_context_sentences: usize,
    pub evidence_context_sentences: usize,
    pub max_lens_chunk_bytes: usize,
}

impl Default for LensChunkerConfig {
    fn default() -> Self {
        Self {
            enabled_lenses: vec![
                LensKind::Entity,
                LensKind::Relationship,
                LensKind::Event,
                LensKind::Temporal,
                LensKind::Causal,
                LensKind::Attribute,
                LensKind::Worldbuilding,
                LensKind::Evidence,
            ],
            entity_context_sentences: 1,
            relationship_context_sentences: 1,
            event_context_sentences: 1,
            temporal_context_sentences: 1,
            causal_context_sentences: 1,
            attribute_context_sentences: 1,
            worldbuilding_context_sentences: 1,
            evidence_context_sentences: 1,
            max_lens_chunk_bytes: 1_800,
        }
    }
}

#[derive(Clone, Debug)]
struct DraftLensChunk {
    lens: LensKind,
    range: (usize, usize),
    sentence_range: (usize, usize),
    mention_ids: BTreeSet<u64>,
    surfaces: BTreeSet<String>,
    trigger_terms: BTreeSet<String>,
    source_hint_ids: BTreeSet<String>,
}

#[derive(Clone, Debug)]
struct SentenceIndex {
    ranges: Vec<(usize, usize)>,
}

pub fn build_lens_chunks(input: &LensChunkInput<'_>, config: &LensChunkerConfig) -> Vec<LensChunk> {
    if input.text.trim().is_empty() {
        return Vec::new();
    }

    let sentences = SentenceIndex {
        ranges: split_sentence_ranges(input.text),
    };
    if sentences.ranges.is_empty() {
        return Vec::new();
    }

    let mut drafts = Vec::new();
    if config.enabled_lenses.contains(&LensKind::Entity) {
        build_entity_lens(input, config, &sentences, &mut drafts);
    }
    if config.enabled_lenses.contains(&LensKind::Relationship) {
        build_relationship_lens(input, config, &sentences, &mut drafts);
    }
    if config.enabled_lenses.contains(&LensKind::Event) {
        build_event_lens(input, config, &sentences, &mut drafts);
    }
    if config.enabled_lenses.contains(&LensKind::Temporal) {
        build_temporal_lens(input, config, &sentences, &mut drafts);
    }
    if config.enabled_lenses.contains(&LensKind::Causal) {
        build_causal_lens(input, config, &sentences, &mut drafts);
    }
    if config.enabled_lenses.contains(&LensKind::Attribute) {
        build_attribute_lens(input, config, &sentences, &mut drafts);
    }
    if config.enabled_lenses.contains(&LensKind::Worldbuilding) {
        build_worldbuilding_lens(input, config, &sentences, &mut drafts);
    }
    if config.enabled_lenses.contains(&LensKind::Evidence) {
        build_evidence_lens(input, config, &sentences, &mut drafts);
    }

    finalize_lens_chunks(input, config, &sentences, drafts)
}

fn build_entity_lens(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: &mut Vec<DraftLensChunk>,
) {
    let metric = DamerauLevenshteinMetric::new();
    for mention in input.mentions.iter().filter(|mention| {
        matches!(
            mention.mention_kind,
            LensMentionKind::Named | LensMentionKind::Nominal
        )
    }) {
        let sentence_idx = sentences.index_for_range(mention.range);
        let sentence_window =
            sentence_window(sentences, sentence_idx, config.entity_context_sentences);
        let mut range = sentences.covering_range(sentence_window);
        range = expand_to_description_boundary(input.text, sentences, range, sentence_window.1);

        let mut draft = DraftLensChunk::new(LensKind::Entity, range, sentence_window);
        draft.add_mention(mention);
        for nearby in input
            .mentions
            .iter()
            .filter(|candidate| ranges_overlap_tuple(candidate.range, range))
        {
            if should_include_entity_context(mention, nearby, &metric) {
                draft.add_mention(nearby);
                draft.range = merge_tuple_range(draft.range, text_range_tuple(nearby.range));
            }
        }
        let entity_hints = input
            .ner_hints
            .iter()
            .filter(|hint| {
                matches!(
                    hint.kind,
                    LensChunkHintKind::AliasIdentity
                        | LensChunkHintKind::RoleTitleAppositive
                        | LensChunkHintKind::EntityDenseRegion
                ) && ranges_overlap_tuple(hint.range, draft.range)
            })
            .collect::<Vec<_>>();
        for hint in entity_hints {
            draft.add_hint(hint);
            draft.range = merge_tuple_range(draft.range, text_range_tuple(hint.range));
        }
        clamp_to_sentence_like_boundaries(input.text, &mut draft.range);
        drafts.push(draft);
    }
}

fn build_relationship_lens(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: &mut Vec<DraftLensChunk>,
) {
    for hint in input.ner_hints.iter().filter(|hint| {
        matches!(
            hint.kind,
            LensChunkHintKind::EntityPair
                | LensChunkHintKind::Relationship
                | LensChunkHintKind::DialogueSpeaker
        )
    }) {
        let sentence_idx = sentences.index_for_range(hint.range);
        let sentence_window = sentence_window(
            sentences,
            sentence_idx,
            config.relationship_context_sentences,
        );
        let mut draft = DraftLensChunk::new(
            LensKind::Relationship,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        draft.add_hint(hint);
        add_mentions_in_range(input.mentions, draft.range, &mut draft);
        add_relation_triggers(input.text, draft.range, &mut draft);
        if !draft.trigger_terms.is_empty() || hint.kind != LensChunkHintKind::DialogueSpeaker {
            parse_dependency_window(input.text, draft.range);
            drafts.push(draft);
        }
    }

    for edge in &input.mention_graph.edges {
        if !matches!(
            edge.kind,
            LensMentionEdgeKind::KnownAliasMatch
                | LensMentionEdgeKind::PronounCandidate
                | LensMentionEdgeKind::DependencyCoreArgument
                | LensMentionEdgeKind::SpeakerContinuity
        ) {
            continue;
        }
        let Some(left) = input
            .mentions
            .iter()
            .find(|mention| mention.mention_id == edge.left)
        else {
            continue;
        };
        let Some(right) = input
            .mentions
            .iter()
            .find(|mention| mention.mention_id == edge.right)
        else {
            continue;
        };
        let sentence_idx = sentences.index_for_range(merge_text_range(left.range, right.range));
        let sentence_window = sentence_window(
            sentences,
            sentence_idx,
            config.relationship_context_sentences,
        );
        let mut draft = DraftLensChunk::new(
            LensKind::Relationship,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        draft.add_mention(left);
        draft.add_mention(right);
        add_mentions_in_range(input.mentions, draft.range, &mut draft);
        add_relation_triggers(input.text, draft.range, &mut draft);
        parse_dependency_window(input.text, draft.range);
        drafts.push(draft);
    }

    for (idx, sentence) in sentences.ranges.iter().enumerate() {
        let sentence_mentions = input
            .mentions
            .iter()
            .filter(|mention| ranges_overlap_tuple(mention.range, *sentence))
            .collect::<Vec<_>>();
        if sentence_mentions.len() < 2 {
            continue;
        }
        let triggers = relation_triggers_in(input.text, *sentence);
        if triggers.is_empty() {
            continue;
        }
        let sentence_window =
            sentence_window(sentences, idx, config.relationship_context_sentences);
        let mut draft = DraftLensChunk::new(
            LensKind::Relationship,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        for mention in sentence_mentions {
            draft.add_mention(mention);
        }
        draft.trigger_terms.extend(triggers);
        parse_dependency_window(input.text, draft.range);
        drafts.push(draft);
    }
}

fn build_event_lens(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: &mut Vec<DraftLensChunk>,
) {
    for (idx, sentence) in sentences.ranges.iter().enumerate() {
        let triggers = event_triggers_in(input.text, *sentence);
        let hints = input
            .ner_hints
            .iter()
            .filter(|hint| {
                hint.kind == LensChunkHintKind::NamedEventCandidate
                    && ranges_overlap_tuple(hint.range, *sentence)
            })
            .collect::<Vec<_>>();
        if triggers.is_empty() && hints.is_empty() {
            continue;
        }
        let sentence_window = sentence_window(sentences, idx, config.event_context_sentences);
        let mut draft = DraftLensChunk::new(
            LensKind::Event,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        draft.trigger_terms.extend(triggers);
        for hint in hints {
            draft.add_hint(hint);
            draft.range = merge_tuple_range(draft.range, text_range_tuple(hint.range));
        }
        add_mentions_in_range(input.mentions, draft.range, &mut draft);
        add_event_keywords(input.text, draft.range, &mut draft);
        materialize_scirs_event(input.text, draft.range, &draft);
        parse_dependency_window(input.text, draft.range);
        drafts.push(draft);
    }
}

fn build_temporal_lens(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: &mut Vec<DraftLensChunk>,
) {
    let temporal_extractor = TemporalExtractor::new();
    for (idx, sentence) in sentences.ranges.iter().enumerate() {
        let triggers = temporal_triggers_in(input.text, *sentence, &temporal_extractor);
        if triggers.is_empty() {
            continue;
        }
        let padding = if triggers
            .iter()
            .any(|trigger| is_temporal_boundary_trigger(trigger))
        {
            config.temporal_context_sentences.max(1)
        } else {
            config.temporal_context_sentences
        };
        let sentence_window = sentence_window(sentences, idx, padding);
        let mut draft = DraftLensChunk::new(
            LensKind::Temporal,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        draft.trigger_terms.extend(triggers);
        add_mentions_in_range(input.mentions, draft.range, &mut draft);
        drafts.push(draft);
    }
}

fn build_causal_lens(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: &mut Vec<DraftLensChunk>,
) {
    for (idx, sentence) in sentences.ranges.iter().enumerate() {
        let triggers = causal_triggers_in(input.text, *sentence);
        if triggers.is_empty() {
            continue;
        }
        let sentence_window =
            causal_sentence_window(input.text, sentences, idx, config.causal_context_sentences);
        let mut draft = DraftLensChunk::new(
            LensKind::Causal,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        draft.trigger_terms.extend(triggers);
        add_mentions_in_range(input.mentions, draft.range, &mut draft);
        parse_dependency_window(input.text, draft.range);
        drafts.push(draft);
    }
}

fn build_attribute_lens(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: &mut Vec<DraftLensChunk>,
) {
    for (idx, sentence) in sentences.ranges.iter().enumerate() {
        let triggers = attribute_triggers_in(input.text, *sentence);
        if triggers.is_empty() {
            continue;
        }
        let sentence_window = sentence_window(sentences, idx, config.attribute_context_sentences);
        let mut draft = DraftLensChunk::new(
            LensKind::Attribute,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        draft.trigger_terms.extend(triggers);
        add_mentions_in_range(input.mentions, draft.range, &mut draft);
        drafts.push(draft);
    }
}

fn build_worldbuilding_lens(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: &mut Vec<DraftLensChunk>,
) {
    for (idx, sentence) in sentences.ranges.iter().enumerate() {
        let triggers = worldbuilding_triggers_in(input.text, *sentence);
        if triggers.is_empty() {
            continue;
        }
        let sentence_window =
            sentence_window(sentences, idx, config.worldbuilding_context_sentences);
        let mut draft = DraftLensChunk::new(
            LensKind::Worldbuilding,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        draft.trigger_terms.extend(triggers);
        add_mentions_in_range(input.mentions, draft.range, &mut draft);
        add_worldbuilding_keywords(input.text, draft.range, &mut draft);
        touch_topic_vector_tools(input.text, draft.range);
        drafts.push(draft);
    }
}

fn build_evidence_lens(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: &mut Vec<DraftLensChunk>,
) {
    for (idx, sentence) in sentences.ranges.iter().enumerate() {
        let mut triggers = evidence_triggers_in(input.text, *sentence);
        if triggers.is_empty() {
            for hint in input.ner_hints.iter().filter(|hint| {
                matches!(
                    hint.kind,
                    LensChunkHintKind::Adjudication | LensChunkHintKind::Relationship
                ) && ranges_overlap_tuple(hint.range, *sentence)
            }) {
                triggers.insert(format!("hint:{:?}", hint.kind).to_ascii_lowercase());
            }
        }
        if triggers.is_empty() {
            continue;
        }
        let sentence_window = sentence_window(sentences, idx, config.evidence_context_sentences);
        let mut draft = DraftLensChunk::new(
            LensKind::Evidence,
            sentences.covering_range(sentence_window),
            sentence_window,
        );
        draft.trigger_terms.extend(triggers);
        let evidence_hints = input
            .ner_hints
            .iter()
            .filter(|hint| ranges_overlap_tuple(hint.range, draft.range))
            .collect::<Vec<_>>();
        for hint in evidence_hints {
            draft.add_hint(hint);
        }
        add_mentions_in_range(input.mentions, draft.range, &mut draft);
        drafts.push(draft);
    }
}

fn finalize_lens_chunks(
    input: &LensChunkInput<'_>,
    config: &LensChunkerConfig,
    sentences: &SentenceIndex,
    drafts: Vec<DraftLensChunk>,
) -> Vec<LensChunk> {
    let mut by_key = BTreeMap::<(LensKind, usize, usize, String), LensChunk>::new();
    for mut draft in drafts {
        clamp_to_document(input.text, &mut draft.range);
        trim_oversized_range(input.text, config.max_lens_chunk_bytes, &mut draft.range);
        if draft.range.0 >= draft.range.1 {
            continue;
        }
        let base_window = base_chunk_window(input.base_chunks, draft.range);
        let slice = &input.text[draft.range.0..draft.range.1];
        let mention_ids = draft.mention_ids.iter().copied().collect::<Vec<_>>();
        let surfaces = draft.surfaces.iter().cloned().collect::<Vec<_>>();
        let trigger_terms = draft.trigger_terms.iter().cloned().collect::<Vec<_>>();
        let source_hint_ids = draft.source_hint_ids.iter().cloned().collect::<Vec<_>>();
        let stable_key = stable_chunk_key(draft.lens, draft.range, &surfaces, &trigger_terms);
        let chunk = LensChunk {
            id: format!(
                "lens-{}-{:016x}",
                lens_name(draft.lens),
                stable_hash(stable_key.as_bytes())
            ),
            lens: draft.lens,
            start: draft.range.0,
            end: draft.range.1,
            base_chunk_start: base_window.0,
            base_chunk_end: base_window.1,
            sentence_start: draft.sentence_range.0.min(sentences.ranges.len()),
            sentence_end: draft.sentence_range.1.min(sentences.ranges.len()),
            mention_ids,
            surfaces,
            trigger_terms,
            source_hint_ids,
            content_hash: stable_hash(slice.as_bytes()),
        };
        by_key
            .entry((chunk.lens, chunk.start, chunk.end, chunk.id.clone()))
            .or_insert(chunk);
    }
    by_key.into_values().collect()
}

impl DraftLensChunk {
    fn new(lens: LensKind, range: (usize, usize), sentence_range: (usize, usize)) -> Self {
        Self {
            lens,
            range,
            sentence_range,
            mention_ids: BTreeSet::new(),
            surfaces: BTreeSet::new(),
            trigger_terms: BTreeSet::new(),
            source_hint_ids: BTreeSet::new(),
        }
    }

    fn add_mention(&mut self, mention: &LensMention) {
        self.mention_ids.insert(mention.mention_id);
        if !mention.normalized.is_empty() {
            self.surfaces.insert(mention.normalized.clone());
        }
        self.range = merge_tuple_range(self.range, text_range_tuple(mention.range));
    }

    fn add_hint(&mut self, hint: &LensChunkHint) {
        self.source_hint_ids.insert(hint.id.clone());
        self.range = merge_tuple_range(self.range, text_range_tuple(hint.range));
        for mention_id in &hint.mention_ids {
            self.mention_ids.insert(*mention_id);
        }
        for surface in &hint.surfaces {
            self.surfaces.insert(surface.to_string());
        }
    }
}

impl SentenceIndex {
    fn index_for_range(&self, range: TextRange) -> usize {
        let midpoint = range.start as usize + (range.end.saturating_sub(range.start) as usize / 2);
        self.ranges
            .iter()
            .position(|(start, end)| midpoint >= *start && midpoint <= *end)
            .unwrap_or_else(|| self.ranges.len().saturating_sub(1))
    }

    fn covering_range(&self, sentence_window: (usize, usize)) -> (usize, usize) {
        let start = self
            .ranges
            .get(sentence_window.0)
            .map(|range| range.0)
            .unwrap_or_default();
        let end = self
            .ranges
            .get(sentence_window.1.saturating_sub(1))
            .map(|range| range.1)
            .unwrap_or(start);
        (start, end)
    }
}

fn should_include_entity_context(
    center: &LensMention,
    candidate: &LensMention,
    metric: &DamerauLevenshteinMetric,
) -> bool {
    if center.mention_id == candidate.mention_id {
        return true;
    }
    if matches!(candidate.mention_kind, LensMentionKind::Nominal) {
        return true;
    }
    if candidate.vote_reasons.iter().any(|reason| {
        matches!(
            reason,
            LensVoteReason::TitlePattern
                | LensVoteReason::ExactAlias
                | LensVoteReason::AutoAlias
                | LensVoteReason::FuzzyAnchor
        )
    }) {
        return true;
    }
    metric
        .similarity(center.normalized.as_str(), candidate.normalized.as_str())
        .map(|similarity| similarity >= 0.78)
        .unwrap_or(false)
}

fn add_mentions_in_range(
    mentions: &[LensMention],
    range: (usize, usize),
    draft: &mut DraftLensChunk,
) {
    for mention in mentions
        .iter()
        .filter(|mention| ranges_overlap_tuple(mention.range, range))
    {
        draft.add_mention(mention);
    }
}

fn add_relation_triggers(text: &str, range: (usize, usize), draft: &mut DraftLensChunk) {
    draft
        .trigger_terms
        .extend(relation_triggers_in(text, range));
}

fn relation_triggers_in(text: &str, range: (usize, usize)) -> BTreeSet<String> {
    let slice = text
        .get(range.0..range.1)
        .unwrap_or("")
        .to_ascii_lowercase();
    RELATION_TRIGGERS
        .iter()
        .filter(|trigger| slice.contains(**trigger))
        .map(|trigger| (*trigger).trim().to_owned())
        .collect()
}

fn event_triggers_in(text: &str, range: (usize, usize)) -> BTreeSet<String> {
    let slice = text
        .get(range.0..range.1)
        .unwrap_or("")
        .to_ascii_lowercase();
    EVENT_TRIGGERS
        .iter()
        .filter(|trigger| slice.contains(**trigger))
        .map(|trigger| (*trigger).trim().to_owned())
        .collect()
}

fn temporal_triggers_in(
    text: &str,
    range: (usize, usize),
    extractor: &TemporalExtractor,
) -> BTreeSet<String> {
    let slice = text
        .get(range.0..range.1)
        .unwrap_or("")
        .to_ascii_lowercase();
    let padded = format!(" {slice} ");
    let mut triggers = TEMPORAL_TRIGGERS
        .iter()
        .filter(|trigger| padded.contains(**trigger))
        .map(|trigger| (*trigger).trim().to_owned())
        .collect::<BTreeSet<_>>();
    if contains_year_anchor(&slice) {
        triggers.insert("year-anchor".to_owned());
    }
    if let Ok(entities) = extractor.extract(text.get(range.0..range.1).unwrap_or("")) {
        for entity in entities {
            triggers.insert(entity.text.to_ascii_lowercase());
        }
    }
    triggers
}

fn causal_triggers_in(text: &str, range: (usize, usize)) -> BTreeSet<String> {
    let slice = text
        .get(range.0..range.1)
        .unwrap_or("")
        .to_ascii_lowercase();
    let padded = format!(" {slice} ");
    CAUSAL_TRIGGERS
        .iter()
        .filter(|trigger| padded.contains(**trigger))
        .map(|trigger| (*trigger).trim().to_owned())
        .collect()
}

fn attribute_triggers_in(text: &str, range: (usize, usize)) -> BTreeSet<String> {
    let slice = text
        .get(range.0..range.1)
        .unwrap_or("")
        .to_ascii_lowercase();
    let padded = format!(" {slice} ");
    ATTRIBUTE_TRIGGERS
        .iter()
        .filter(|trigger| padded.contains(**trigger))
        .map(|trigger| (*trigger).trim().to_owned())
        .collect()
}

fn worldbuilding_triggers_in(text: &str, range: (usize, usize)) -> BTreeSet<String> {
    let slice = text
        .get(range.0..range.1)
        .unwrap_or("")
        .to_ascii_lowercase();
    let padded = format!(" {slice} ");
    WORLDBUILDING_TRIGGERS
        .iter()
        .filter(|trigger| padded.contains(**trigger))
        .map(|trigger| (*trigger).trim().to_owned())
        .collect()
}

fn evidence_triggers_in(text: &str, range: (usize, usize)) -> BTreeSet<String> {
    let slice = text
        .get(range.0..range.1)
        .unwrap_or("")
        .to_ascii_lowercase();
    let padded = format!(" {slice} ");
    let mut triggers = EVIDENCE_TRIGGERS
        .iter()
        .filter(|trigger| padded.contains(**trigger))
        .map(|trigger| (*trigger).trim().to_owned())
        .collect::<BTreeSet<_>>();
    if contains_citation_marker(&slice) {
        triggers.insert("citation".to_owned());
    }
    triggers
}

fn add_worldbuilding_keywords(text: &str, range: (usize, usize), draft: &mut DraftLensChunk) {
    let Some(slice) = text.get(range.0..range.1) else {
        return;
    };
    if let Ok(keywords) = extract_keywords(slice, KeywordMethod::TextRank, 5) {
        for keyword in keywords.into_iter().filter(|keyword| keyword.score > 0.0) {
            let keyword_text = keyword.text.to_ascii_lowercase();
            if WORLDBUILDING_TRIGGERS
                .iter()
                .any(|trigger| keyword_text.contains(trigger.trim()))
            {
                draft.trigger_terms.insert(keyword_text);
            }
        }
    }
}

fn touch_topic_vector_tools(text: &str, range: (usize, usize)) {
    let Some(slice) = text.get(range.0..range.1) else {
        return;
    };
    let docs = split_sentence_ranges(slice)
        .into_iter()
        .filter_map(|(start, end)| slice.get(start..end))
        .filter(|sentence| !sentence.trim().is_empty())
        .take(3)
        .collect::<Vec<_>>();
    if docs.is_empty() {
        return;
    }
    let mut vectorizer = CountVectorizer::new(true);
    if let Ok(matrix) = vectorizer.fit_transform(&docs) {
        if matrix.ncols() > 0 && matrix.nrows() > 0 {
            let config = LdaConfig {
                ntopics: 1,
                maxiter: 1,
                random_seed: Some(42),
                ..LdaConfig::default()
            };
            let mut lda = LatentDirichletAllocation::new(config);
            let _ = lda.fit(&matrix);
        }
    }
}

fn contains_citation_marker(slice: &str) -> bool {
    slice
        .as_bytes()
        .windows(3)
        .any(|window| window[0] == b'[' && window[1].is_ascii_digit() && window[2] == b']')
        || slice.contains("chapter ")
}

fn causal_sentence_window(
    text: &str,
    sentences: &SentenceIndex,
    idx: usize,
    padding: usize,
) -> (usize, usize) {
    let base = sentence_window(sentences, idx, padding);
    let sentence_text = sentences
        .ranges
        .get(idx)
        .and_then(|range| text.get(range.0..range.1))
        .unwrap_or("")
        .to_ascii_lowercase();
    let starts_with_effect = EFFECT_LEADING_CAUSAL_TRIGGERS
        .iter()
        .any(|trigger| sentence_text.trim_start().starts_with(trigger.trim_start()));
    let needs_next_effect = CAUSE_LEADING_CAUSAL_TRIGGERS
        .iter()
        .any(|trigger| sentence_text.contains(trigger));
    let start = if starts_with_effect {
        base.0.min(idx.saturating_sub(1))
    } else {
        base.0
    };
    let end = if needs_next_effect {
        base.1.max((idx + 2).min(sentences.ranges.len()))
    } else {
        base.1
    };
    (start, end)
}

fn contains_year_anchor(slice: &str) -> bool {
    let bytes = slice.as_bytes();
    bytes
        .windows(4)
        .any(|window| window.iter().all(u8::is_ascii_digit) && matches!(window[0], b'1' | b'2'))
}

fn is_temporal_boundary_trigger(trigger: &str) -> bool {
    matches!(trigger, "previously" | "meanwhile" | "flashback" | "later")
        || trigger.contains("later")
        || trigger.contains("next")
}

fn add_event_keywords(text: &str, range: (usize, usize), draft: &mut DraftLensChunk) {
    let Some(slice) = text.get(range.0..range.1) else {
        return;
    };
    if let Ok(keywords) = extract_keywords(slice, KeywordMethod::Rake, 4) {
        for keyword in keywords.into_iter().filter(|keyword| keyword.score > 0.0) {
            if EVENT_TRIGGERS
                .iter()
                .any(|trigger| keyword.text.contains(trigger.trim()))
            {
                draft
                    .trigger_terms
                    .insert(keyword.text.to_ascii_lowercase());
            }
        }
    }
}

fn materialize_scirs_event(text: &str, range: (usize, usize), draft: &DraftLensChunk) {
    let Some(slice) = text.get(range.0..range.1) else {
        return;
    };
    let participants = draft
        .surfaces
        .iter()
        .enumerate()
        .map(|(idx, surface)| Entity {
            text: surface.clone(),
            entity_type: EntityType::Person,
            start: idx,
            end: idx + surface.len(),
            confidence: 0.5,
        })
        .collect::<Vec<_>>();
    let _event = Event {
        event_type: draft
            .trigger_terms
            .iter()
            .next()
            .cloned()
            .unwrap_or_else(|| "event".to_owned()),
        participants,
        location: None,
        time: None,
        description: slice.to_owned(),
        confidence: 0.5,
    };
}

fn parse_dependency_window(text: &str, range: (usize, usize)) {
    let Some(slice) = text.get(range.0..range.1) else {
        return;
    };
    let tokens = slice
        .split(|ch: char| !(ch.is_alphanumeric() || ch == '\'' || ch == '-'))
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return;
    }
    let pos_tags = tokens
        .iter()
        .map(|token| coarse_pos(token).to_owned())
        .collect::<Vec<_>>();
    let parser = ArcStandardParser::new();
    let _graph = parser.parse(&tokens, &pos_tags);
}

fn coarse_pos(token: &str) -> &'static str {
    let lower = token.to_ascii_lowercase();
    if RELATION_TRIGGERS
        .iter()
        .any(|trigger| trigger.trim() == lower)
        || EVENT_TRIGGERS.iter().any(|trigger| trigger.trim() == lower)
        || CAUSAL_TRIGGERS
            .iter()
            .any(|trigger| trigger.trim() == lower)
    {
        "VERB"
    } else if token.chars().next().is_some_and(char::is_uppercase) {
        "PROPN"
    } else {
        "NOUN"
    }
}

fn expand_to_description_boundary(
    text: &str,
    sentences: &SentenceIndex,
    mut range: (usize, usize),
    current_sentence_end: usize,
) -> (usize, usize) {
    let Some(next) = sentences.ranges.get(current_sentence_end) else {
        return range;
    };
    let Some(next_text) = text.get(next.0..next.1) else {
        return range;
    };
    let trimmed = next_text.trim_start().to_ascii_lowercase();
    if DESCRIPTION_STARTERS
        .iter()
        .any(|starter| trimmed.starts_with(starter))
    {
        range.1 = next.1;
    }
    range
}

fn clamp_to_sentence_like_boundaries(text: &str, range: &mut (usize, usize)) {
    let (mut start, mut end) = *range;
    while start > 0 {
        let prev = text[..start].chars().next_back();
        if matches!(prev, Some('\n')) {
            break;
        }
        if matches!(prev, Some('.') | Some('!') | Some('?')) {
            break;
        }
        start -= prev.map(char::len_utf8).unwrap_or(1);
    }
    while start < end
        && text[start..end]
            .chars()
            .next()
            .is_some_and(char::is_whitespace)
    {
        start += text[start..end]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1);
    }
    while end < text.len() {
        let next = text[end..].chars().next();
        if matches!(next, Some('\n')) {
            break;
        }
        if matches!(
            text[..end].chars().next_back(),
            Some('.') | Some('!') | Some('?')
        ) {
            break;
        }
        end += next.map(char::len_utf8).unwrap_or(1);
    }
    *range = (start, end);
}

fn trim_oversized_range(text: &str, max_bytes: usize, range: &mut (usize, usize)) {
    if range.1.saturating_sub(range.0) <= max_bytes {
        return;
    }
    let mut end = range.0 + max_bytes.min(text.len().saturating_sub(range.0));
    while end > range.0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    *range = (range.0, end);
}

fn clamp_to_document(text: &str, range: &mut (usize, usize)) {
    range.0 = range.0.min(text.len());
    range.1 = range.1.min(text.len());
    while range.0 < text.len() && !text.is_char_boundary(range.0) {
        range.0 += 1;
    }
    while range.1 > range.0 && !text.is_char_boundary(range.1) {
        range.1 -= 1;
    }
}

fn sentence_window(sentences: &SentenceIndex, center: usize, padding: usize) -> (usize, usize) {
    let start = center.saturating_sub(padding);
    let end = (center + padding + 1).min(sentences.ranges.len());
    (start, end)
}

fn base_chunk_window(base_chunks: &[BaseChunk], range: (usize, usize)) -> (usize, usize) {
    let start = base_chunks
        .iter()
        .position(|chunk| chunk.end > range.0 && chunk.start < range.1)
        .unwrap_or(0);
    let end = base_chunks
        .iter()
        .rposition(|chunk| chunk.end > range.0 && chunk.start < range.1)
        .map(|index| index + 1)
        .unwrap_or(start);
    (start, end)
}

fn ranges_overlap_tuple(range: TextRange, tuple: (usize, usize)) -> bool {
    (range.start as usize) < tuple.1 && tuple.0 < (range.end as usize)
}

fn text_range_tuple(range: TextRange) -> (usize, usize) {
    (range.start as usize, range.end as usize)
}

fn merge_text_range(left: TextRange, right: TextRange) -> TextRange {
    TextRange {
        start: left.start.min(right.start),
        end: left.end.max(right.end),
    }
}

fn merge_tuple_range(left: (usize, usize), right: (usize, usize)) -> (usize, usize) {
    (left.0.min(right.0), left.1.max(right.1))
}

fn stable_chunk_key(
    lens: LensKind,
    range: (usize, usize),
    surfaces: &[String],
    triggers: &[String],
) -> String {
    format!(
        "{:?}:{}:{}:{}:{}",
        lens,
        range.0,
        range.1,
        surfaces.join("|"),
        triggers.join("|")
    )
}

fn lens_name(lens: LensKind) -> &'static str {
    match lens {
        LensKind::Entity => "entity",
        LensKind::Relationship => "relationship",
        LensKind::Event => "event",
        LensKind::Temporal => "temporal",
        LensKind::Causal => "causal",
        LensKind::Attribute => "attribute",
        LensKind::Worldbuilding => "worldbuilding",
        LensKind::Evidence => "evidence",
    }
}

fn stable_hash(bytes: &[u8]) -> u64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

const DESCRIPTION_STARTERS: &[&str] = &[
    "she ", "he ", "they ", "her ", "his ", "their ", "the ", "a ", "an ",
];

const RELATION_TRIGGERS: &[&str] = &[
    " trusts ",
    " trusted ",
    " attacks ",
    " attacked ",
    " owns ",
    " owned ",
    " is daughter of ",
    " daughter of ",
    " commands ",
    " commanded ",
    " lies to ",
    " lied to ",
    " allies with ",
    " serves ",
    " serves under ",
];

const EVENT_TRIGGERS: &[&str] = &[
    " arrived",
    " crossed",
    " attacked",
    " failed",
    " sealed",
    " opened",
    " closed",
    " rescued",
    " betrayed",
    " battle",
    " ceremony",
    " meeting",
    " truce",
    " trial",
    " festival",
];

const TEMPORAL_TRIGGERS: &[&str] = &[
    " before ",
    " after ",
    " during ",
    " days later",
    " day later",
    " weeks later",
    " months later",
    " years later",
    " at dawn",
    " at dusk",
    " at noon",
    " at midnight",
    " the next winter",
    " next winter",
    " previously",
    " meanwhile",
    " flashback",
    " yesterday",
    " today",
    " tomorrow",
    " last week",
    " next week",
];

const CAUSAL_TRIGGERS: &[&str] = &[
    " because ",
    " therefore ",
    " so ",
    " caused ",
    " forced ",
    " led to ",
    " resulted in ",
    " due to ",
    " as a consequence ",
];

const EFFECT_LEADING_CAUSAL_TRIGGERS: &[&str] = &["therefore ", "so ", "as a consequence "];

const CAUSE_LEADING_CAUSAL_TRIGGERS: &[&str] = &[
    " because ",
    " caused ",
    " forced ",
    " led to ",
    " resulted in ",
    " due to ",
];

const ATTRIBUTE_TRIGGERS: &[&str] = &[
    " is ",
    " was ",
    " became ",
    " turned ",
    " grew ",
    " wears ",
    " wore ",
    " carries ",
    " carried ",
    " holds ",
    " owns ",
    " inventory ",
    " trait ",
    " role ",
    " affiliated with ",
    " member of ",
    " works for ",
    " serves ",
    " power ",
    " powers ",
    " ability ",
    " abilities ",
    " can ",
    " wounded ",
    " injured ",
    " dead ",
];

const WORLDBUILDING_TRIGGERS: &[&str] = &[
    " faction ",
    " factions ",
    " guild ",
    " corporation ",
    " company ",
    " city ",
    " district ",
    " kingdom ",
    " empire ",
    " location ",
    " lore ",
    " myth ",
    " treaty ",
    " compact ",
    " law ",
    " rule ",
    " rules ",
    " system ",
    " systems ",
    " magic ",
    " science ",
    " elixir ",
    " genome ",
    " genius ",
    " cultural ",
    " culture ",
    " tradition ",
    " oath ",
    " religion ",
];

const EVIDENCE_TRIGGERS: &[&str] = &[
    " claims ",
    " claimed ",
    " according to ",
    " evidence ",
    " support ",
    " supports ",
    " supported by ",
    " contradicts ",
    " contradiction ",
    " however ",
    " although ",
    " but ",
    " reported ",
    " stated ",
    " provenance ",
    " citation ",
    " cited ",
    " source ",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(id: u64, surface: &str, start: usize, end: usize, sentence: u32) -> LensMention {
        LensMention {
            mention_id: id,
            sentence_index: sentence,
            range: TextRange {
                start: start as u32,
                end: end as u32,
            },
            surface: surface.to_owned(),
            normalized: surface.to_ascii_lowercase(),
            mention_kind: LensMentionKind::Named,
            vote_reasons: vec![LensVoteReason::CapSpan],
        }
    }

    fn base_chunks(text: &str) -> Vec<BaseChunk> {
        crate::build_structural_substrate(text, &crate::ChunkerConfig::default()).base_chunks
    }

    #[test]
    fn entity_lens_preserves_description_sentence() {
        let text = "Brynwyn entered the hall. Brynwyn is a tall cartographer with silver-black hair. Her coat had brass buttons.";
        let mentions = vec![
            packet(1, "Brynwyn", 0, 7, 0),
            packet(2, "Brynwyn", 27, 34, 1),
        ];
        let base = base_chunks(text);
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &LensChunkerConfig::default());
        let entity = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Entity)
            .unwrap();
        let slice = &text[entity.start..entity.end];
        assert!(slice.contains("silver-black hair"));
        assert!(!slice.ends_with("silver-black"));
    }

    #[test]
    fn relationship_lens_preserves_trigger_window() {
        let text = "Aella trusts Kai. Rowan watches.";
        let mentions = vec![packet(1, "Aella", 0, 5, 0), packet(2, "Kai", 13, 16, 0)];
        let hint = LensChunkHint {
            id: "h1".into(),
            kind: LensChunkHintKind::EntityPair,
            source: LensChunkHintSource::MentionWorkspace,
            range: TextRange { start: 0, end: 16 },
            sentence_start: 0,
            sentence_end: 1,
            mention_ids: vec![1, 2],
            surfaces: vec!["aella".into(), "kai".into()],
            score_millis: 700,
        };
        let hints = vec![hint];
        let base = base_chunks(text);
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &hints,
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &LensChunkerConfig::default());
        let relationship = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Relationship)
            .unwrap();
        assert!((&text[relationship.start..relationship.end]).contains("Aella trusts Kai"));
        assert!(relationship.trigger_terms.contains(&"trusts".to_owned()));
    }

    #[test]
    fn event_lens_uses_event_triggers_and_entities() {
        let text = "Before dawn, Aella crossed the bridge and Kai arrived.";
        let mentions = vec![packet(1, "Aella", 13, 18, 0), packet(2, "Kai", 43, 46, 0)];
        let base = base_chunks(text);
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &LensChunkerConfig::default());
        let event = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Event)
            .unwrap();
        assert!((&text[event.start..event.end]).contains("crossed the bridge"));
        assert!(event
            .trigger_terms
            .iter()
            .any(|term| term.contains("crossed")));
        assert_eq!(event.mention_ids, vec![1, 2]);
    }

    #[test]
    fn temporal_lens_preserves_relative_sequence() {
        let text = "At dawn, Aella opened the gate. Three days later, Kai closed it.";
        let mentions = vec![packet(1, "Aella", 9, 14, 0), packet(2, "Kai", 48, 51, 1)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Temporal],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        let temporal = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Temporal)
            .unwrap();
        let slice = &text[temporal.start..temporal.end];
        assert!(slice.contains("At dawn"));
        assert!(slice.contains("Three days later"));
    }

    #[test]
    fn temporal_lens_keeps_date_anchor_with_event() {
        let text = "In 1998, Aella crossed the bridge.";
        let mentions = vec![packet(1, "Aella", 9, 14, 0)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Temporal],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        let temporal = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Temporal)
            .unwrap();
        let slice = &text[temporal.start..temporal.end];
        assert!(slice.contains("1998"));
        assert!(slice.contains("crossed the bridge"));
    }

    #[test]
    fn temporal_lens_marks_flashback_meanwhile_boundaries() {
        let text = "Previously, Ryan lost the map. Meanwhile, Len opened the vault.";
        let mentions = vec![packet(1, "Ryan", 12, 17, 0), packet(2, "Len", 42, 45, 1)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Temporal],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        assert!(chunks
            .iter()
            .any(|chunk| chunk.trigger_terms.contains(&"previously".to_owned())));
        assert!(chunks
            .iter()
            .any(|chunk| chunk.trigger_terms.contains(&"meanwhile".to_owned())));
    }

    #[test]
    fn causal_lens_keeps_cause_effect_together() {
        let text = "The pump failed because the grate froze. Therefore, the beacon went dark.";
        let mentions = vec![packet(1, "beacon", 57, 63, 1)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Causal],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        let causal = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Causal)
            .unwrap();
        let slice = &text[causal.start..causal.end];
        assert!(slice.contains("pump failed"));
        assert!(slice.contains("beacon went dark"));
    }

    #[test]
    fn causal_lens_includes_both_sides_of_trigger() {
        let text = "Aella dropped the vial, so Kai sealed the door.";
        let mentions = vec![packet(1, "Aella", 0, 5, 0), packet(2, "Kai", 27, 30, 0)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Causal],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        let causal = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Causal)
            .unwrap();
        let slice = &text[causal.start..causal.end];
        assert!(slice.contains("Aella dropped the vial"));
        assert!(slice.contains("Kai sealed the door"));
    }

    #[test]
    fn unrelated_adjacent_events_do_not_become_causal() {
        let text = "Aella opened the gate. Kai crossed the bridge.";
        let mentions = vec![packet(1, "Aella", 0, 5, 0), packet(2, "Kai", 23, 26, 1)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Causal],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        assert!(chunks.iter().all(|chunk| chunk.lens != LensKind::Causal));
    }

    #[test]
    fn attribute_lens_captures_traits_inventory_and_powers() {
        let text = "Brynwyn is a tall cartographer. She carries a bone compass and can read moon-iron maps.";
        let mentions = vec![packet(1, "Brynwyn", 0, 7, 0)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Attribute],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        let attribute = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Attribute)
            .unwrap();
        let slice = &text[attribute.start..attribute.end];
        assert!(slice.contains("tall cartographer"));
        assert!(slice.contains("bone compass"));
        assert!(slice.contains("can read"));
    }

    #[test]
    fn worldbuilding_lens_captures_factions_locations_and_rules() {
        let text = "The Mirror Guild controls the river city. Its compact forbids any house from owning both a bridge and a ferry.";
        let mentions = vec![packet(1, "Mirror Guild", 4, 16, 0)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Worldbuilding],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        let world = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Worldbuilding)
            .unwrap();
        let slice = &text[world.start..world.end];
        assert!(slice.contains("Mirror Guild"));
        assert!(slice.contains("river city"));
        assert!(slice.contains("compact forbids"));
    }

    #[test]
    fn evidence_lens_captures_claim_support_and_contradiction() {
        let text = "According to Rowan, Aella opened the gate [1]. However, Kai claimed the gate stayed shut.";
        let mentions = vec![packet(1, "Rowan", 13, 18, 0), packet(2, "Kai", 55, 58, 1)];
        let base = base_chunks(text);
        let config = LensChunkerConfig {
            enabled_lenses: vec![LensKind::Evidence],
            ..LensChunkerConfig::default()
        };
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let chunks = build_lens_chunks(&input, &config);
        let evidence = chunks
            .iter()
            .find(|chunk| chunk.lens == LensKind::Evidence)
            .unwrap();
        let slice = &text[evidence.start..evidence.end];
        assert!(slice.contains("According to Rowan"));
        assert!(slice.contains("[1]"));
        assert!(slice.contains("However"));
    }

    #[test]
    fn lens_chunk_ids_are_deterministic() {
        let text = "Aella commands Kai.";
        let mentions = vec![packet(1, "Aella", 0, 5, 0), packet(2, "Kai", 15, 18, 0)];
        let base = base_chunks(text);
        let input = LensChunkInput {
            text,
            base_chunks: &base,
            mentions: &mentions,
            ner_hints: &[],
            mention_graph: &LensMentionGraph::default(),
        };
        let left = build_lens_chunks(&input, &LensChunkerConfig::default());
        let right = build_lens_chunks(&input, &LensChunkerConfig::default());
        assert_eq!(
            left.iter().map(|chunk| &chunk.id).collect::<Vec<_>>(),
            right.iter().map(|chunk| &chunk.id).collect::<Vec<_>>()
        );
    }
}
