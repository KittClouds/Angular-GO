//! Scoring + MentionWorkspace — additive vote scoring and packet finalization.
//!
//! Source-calibrated scoring collapses votes from all lanes into a single
//! confidence and status per mention. The workspace acts as an arena-style
//! accumulator during the pipeline.

use compact_str::CompactString;
use phoenix_types::{MentionEntityRef, SentenceSpan};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use crate::known_lane::KnownCandidate;
use crate::native_lane::NativeCandidate;
use crate::traits::{AdjudicationCase, InstructTask};
use crate::types::{
    EntityLabel, LocalMentionId, MentionContext, MentionKind, MentionPacket, MentionSemantics,
    MentionSourceKind, MentionStatus, MentionVote, VoteReason,
};

// ---------------------------------------------------------------------------
// Score table — calibrated additive weights
// ---------------------------------------------------------------------------

/// Calibrated score weights per vote reason.
pub struct ScoreTable {
    pub exact_canonical: f32,
    pub exact_alias: f32,
    pub auto_alias: f32,
    pub fuzzy_anchor: f32,
    pub title_pattern: f32,
    pub cap_span: f32,
    pub nominal_role: f32,
    pub repeated_surface: f32,
    pub dependency_role: f32,
    pub dialogue_speaker: f32,
    pub model_span: f32,
    pub model_label: f32,
    pub nli_support: f32,
    pub nli_contradiction: f32,
    pub stopword_penalty: f32,
    pub guard_violation: f32,
}

impl Default for ScoreTable {
    fn default() -> Self {
        Self {
            exact_canonical: 1.00,
            exact_alias: 0.96,
            auto_alias: 0.90,
            fuzzy_anchor: 0.78,
            title_pattern: 0.70,
            cap_span: 0.42,
            nominal_role: 0.52,
            repeated_surface: 0.08,
            dependency_role: 0.10,
            dialogue_speaker: 0.06,
            model_span: 0.15,
            model_label: 0.15,
            nli_support: 0.20,
            nli_contradiction: -0.30,
            stopword_penalty: -0.60,
            guard_violation: -0.50,
        }
    }
}

impl ScoreTable {
    /// Score a single vote reason.
    #[inline]
    pub fn weight(&self, reason: VoteReason) -> f32 {
        match reason {
            VoteReason::ExactCanonical => self.exact_canonical,
            VoteReason::ExactAlias => self.exact_alias,
            VoteReason::AutoAlias => self.auto_alias,
            VoteReason::FuzzyAnchor => self.fuzzy_anchor,
            VoteReason::TitlePattern => self.title_pattern,
            VoteReason::CapSpan => self.cap_span,
            VoteReason::NominalRole => self.nominal_role,
            VoteReason::RepeatedSurface => self.repeated_surface,
            VoteReason::DependencyRole => self.dependency_role,
            VoteReason::DialogueSpeaker => self.dialogue_speaker,
            VoteReason::ModelSpan => self.model_span,
            VoteReason::ModelLabel => self.model_label,
            VoteReason::NliSupport => self.nli_support,
            VoteReason::NliContradiction => self.nli_contradiction,
            VoteReason::StopwordPenalty => self.stopword_penalty,
            VoteReason::GuardViolation => self.guard_violation,
        }
    }
}

// ---------------------------------------------------------------------------
// Workspace entry — pre-packet accumulator
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct WorkspaceEntry {
    id: LocalMentionId,
    range: phoenix_types::TextRange,
    surface: CompactString,
    normalized: CompactString,
    mention_kind: MentionKind,
    entity_ref: Option<MentionEntityRef>,
    votes: SmallVec<[MentionVote; 6]>,
    sentence_index: u32,
}

#[derive(Clone, Debug)]
struct LabelHint {
    label: EntityLabel,
    confidence: f32,
}

#[derive(Clone, Debug)]
struct SurfaceKindPrior {
    label: EntityLabel,
    confidence: f32,
    has_known: bool,
}

#[derive(Clone, Debug)]
struct SurfaceLabelEvidence {
    label: EntityLabel,
    score: f32,
    count: usize,
    known_count: usize,
}

// ---------------------------------------------------------------------------
// MentionWorkspace
// ---------------------------------------------------------------------------

/// Arena-style accumulator for mentions during the NER pipeline.
pub struct MentionWorkspace {
    document_id: CompactString,
    entries: Vec<WorkspaceEntry>,
    score_table: ScoreTable,
    next_id: u64,
}

impl MentionWorkspace {
    pub fn new(document_id: &str, id_base: u64) -> Self {
        Self {
            document_id: CompactString::from(document_id),
            entries: Vec::with_capacity(256),
            score_table: ScoreTable::default(),
            next_id: id_base,
        }
    }

    /// Ingest known-lane candidates.
    pub fn add_known(&mut self, candidates: Vec<KnownCandidate>) {
        for c in candidates {
            self.entries.push(WorkspaceEntry {
                id: c.mention_id,
                range: c.range,
                surface: c.surface,
                normalized: c.normalized,
                mention_kind: c.mention_kind,
                entity_ref: c.entity_ref,
                votes: c.votes.into_iter().collect(),
                sentence_index: c.sentence_index,
            });
        }
    }

    /// Ingest native-lane candidates.
    pub fn add_native(&mut self, candidates: Vec<NativeCandidate>) {
        for c in candidates {
            self.entries.push(WorkspaceEntry {
                id: c.mention_id,
                range: c.range,
                surface: c.surface,
                normalized: c.normalized,
                mention_kind: c.mention_kind,
                entity_ref: c.entity_ref,
                votes: c.votes.into_iter().collect(),
                sentence_index: c.sentence_index,
            });
        }
    }

    /// Add model-produced votes to existing entries or create new ones.
    pub fn add_model_votes(&mut self, votes: Vec<(LocalMentionId, MentionVote)>) {
        for (id, vote) in votes {
            if let Some(entry) = self.entries.iter_mut().find(|e| e.id == id) {
                entry.votes.push(vote);
            }
        }
    }

    /// Add a completely new span discovered by the model, or merge with existing by range.
    pub fn add_discovered_span(
        &mut self,
        range: phoenix_types::TextRange,
        surface: compact_str::CompactString,
        sentence_index: u32,
        vote: MentionVote,
    ) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.range == range) {
            entry.votes.push(vote);
            return;
        }

        let id = self.next_id();
        let normalized = compact_str::CompactString::from(surface.to_lowercase());
        self.entries.push(WorkspaceEntry {
            id,
            range,
            surface,
            normalized,
            mention_kind: crate::types::MentionKind::Named,
            entity_ref: None,
            votes: smallvec::smallvec![vote],
            sentence_index,
        });
    }

    /// Apply adjudication decisions.
    pub fn apply_adjudication(&mut self, decisions: Vec<(LocalMentionId, MentionVote)>) {
        for (id, vote) in decisions {
            if let Some(entry) = self.entries.iter_mut().find(|e| e.id == id) {
                entry.votes.push(vote);
            }
        }
    }

    pub fn build_kind_adjudication_cases(
        &self,
        text: &str,
        sentences: &[SentenceSpan],
        limit: usize,
    ) -> Vec<AdjudicationCase> {
        if limit == 0 {
            return Vec::new();
        }

        let mut cases = self
            .entries
            .iter()
            .filter_map(|entry| {
                let priority = kind_adjudication_priority(entry, text, sentences)?;
                Some((
                    priority,
                    entry.range.start,
                    self.kind_adjudication_case(entry, text, sentences),
                ))
            })
            .collect::<Vec<_>>();
        cases.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
        cases
            .into_iter()
            .take(limit)
            .map(|(_, _, case)| case)
            .collect()
    }

    fn kind_adjudication_case(
        &self,
        entry: &WorkspaceEntry,
        text: &str,
        sentences: &[SentenceSpan],
    ) -> AdjudicationCase {
        AdjudicationCase {
            mention_id: entry.id,
            task: InstructTask::SpanLabelChoice,
            surface: entry.surface.clone(),
            sentence_text: sentence_text(text, sentences, entry.sentence_index),
            neighbor_sentence: None,
            candidate_labels: candidate_labels_for_entry(entry, text, sentences),
            candidate_entities: SmallVec::new(),
        }
    }

    /// Next available mention id.
    pub fn next_id(&mut self) -> LocalMentionId {
        let id = LocalMentionId(self.next_id);
        self.next_id += 1;
        id
    }

    /// Finalize all entries into scored MentionPackets.
    pub fn finalize_packets(mut self) -> Vec<MentionPacket> {
        let mut entries = std::mem::take(&mut self.entries);
        Self::propagate_model_labels(&mut entries);
        Self::apply_surface_kind_priors(&mut entries);
        let mut packets = Vec::with_capacity(entries.len());

        for entry in entries {
            let (confidence, status) = self.score_entry(&entry);
            let label_distribution = Self::build_label_distribution(&entry.votes);

            packets.push(MentionPacket {
                mention_id: entry.id,
                document_id: self.document_id.clone(),
                chunk_id: None,
                sentence_index: entry.sentence_index,
                range: entry.range,
                surface: entry.surface,
                normalized: entry.normalized,
                mention_kind: entry.mention_kind,
                label_distribution,
                entity_ref: entry.entity_ref,
                source_votes: entry.votes,
                context: MentionContext::default(),
                syntax: None,
                semantics: MentionSemantics::default(),
                confidence,
                status,
            });
        }

        // Sort by range start for stable output.
        packets.sort_by_key(|p| p.range.start);
        packets
    }

    fn apply_surface_kind_priors(entries: &mut [WorkspaceEntry]) {
        let priors = Self::surface_kind_priors(entries);
        for entry in entries.iter_mut() {
            if entry.mention_kind != MentionKind::Named || entry_has_known_label(entry) {
                continue;
            }
            let Some(prior) = priors.get(entry.normalized.as_str()) else {
                continue;
            };
            if entry_has_label_group(entry, prior.label.as_str()) {
                continue;
            }
            if !prior.has_known && entry_has_non_model_label(entry) {
                continue;
            }
            entry.votes.push(MentionVote {
                source: MentionSourceKind::NativeDiscovery,
                label: Some(prior.label.clone()),
                entity_ref: None,
                confidence: prior.confidence,
                reason: VoteReason::RepeatedSurface,
            });
        }
    }

    fn surface_kind_priors(
        entries: &[WorkspaceEntry],
    ) -> FxHashMap<CompactString, SurfaceKindPrior> {
        let mut evidence = FxHashMap::<CompactString, Vec<SurfaceLabelEvidence>>::default();
        for entry in entries {
            if entry.mention_kind != MentionKind::Named {
                continue;
            }
            for vote in &entry.votes {
                let Some(label) = vote.label.as_ref() else {
                    continue;
                };
                if !is_entity_label(label.as_str()) || vote.reason == VoteReason::RepeatedSurface {
                    continue;
                }
                let Some(weight) = surface_evidence_weight(vote) else {
                    continue;
                };
                upsert_surface_evidence(
                    evidence.entry(entry.normalized.clone()).or_default(),
                    label,
                    weight,
                    vote.source == MentionSourceKind::KnownLexicon,
                );
            }
        }

        let mut priors = FxHashMap::<CompactString, SurfaceKindPrior>::default();
        for (surface, mut rows) in evidence {
            rows.sort_by(|left, right| {
                right
                    .score
                    .partial_cmp(&left.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| right.count.cmp(&left.count))
            });
            let Some(top) = rows.first() else {
                continue;
            };
            let runner_up = rows.get(1).map(|row| row.score).unwrap_or(0.0);
            let has_known = top.known_count > 0;
            let stable_repeat = top.count >= 2 && top.score >= runner_up + 0.45;
            if !has_known && !stable_repeat {
                continue;
            }
            let confidence = if has_known {
                0.86
            } else {
                (0.56 + top.count.min(5) as f32 * 0.04).min(0.74)
            };
            priors.insert(
                surface,
                SurfaceKindPrior {
                    label: top.label.clone(),
                    confidence,
                    has_known,
                },
            );
        }
        priors
    }

    fn propagate_model_labels(entries: &mut [WorkspaceEntry]) {
        let mut hints = FxHashMap::<CompactString, LabelHint>::default();
        for entry in entries.iter() {
            for vote in &entry.votes {
                let Some(label) = vote.label.as_ref() else {
                    continue;
                };
                if !is_surface_label_source(vote.source) || !is_entity_label(label.as_str()) {
                    continue;
                }
                let score = vote.confidence
                    + if vote.source == MentionSourceKind::KnownLexicon {
                        0.25
                    } else {
                        0.0
                    };
                let replace = hints
                    .get(entry.normalized.as_str())
                    .is_none_or(|hint| score > hint.confidence);
                if replace {
                    hints.insert(
                        entry.normalized.clone(),
                        LabelHint {
                            label: label.clone(),
                            confidence: score,
                        },
                    );
                }
            }
        }

        for entry in entries.iter_mut() {
            if entry.mention_kind != MentionKind::Named
                || entry.votes.iter().any(|vote| vote.label.is_some())
            {
                continue;
            }
            let Some(hint) = hints.get(entry.normalized.as_str()) else {
                continue;
            };
            entry.votes.push(MentionVote {
                source: MentionSourceKind::ModelVerify,
                label: Some(hint.label.clone()),
                entity_ref: None,
                confidence: hint.confidence.clamp(0.55, 0.72),
                reason: VoteReason::ModelLabel,
            });
        }
    }

    fn score_entry(&self, entry: &WorkspaceEntry) -> (f32, MentionStatus) {
        let mut score = 0.0_f32;
        let mut has_known = false;
        let mut has_model = false;
        let mut max_model_confidence = 0.0_f32;
        let mut has_contradiction = false;

        for vote in &entry.votes {
            score += self.score_table.weight(vote.reason) * vote.confidence;
            if vote.source == MentionSourceKind::KnownLexicon {
                has_known = true;
            }
            if matches!(
                vote.source,
                MentionSourceKind::ModelDiscovery | MentionSourceKind::ModelVerify
            ) {
                has_model = true;
                max_model_confidence = max_model_confidence.max(vote.confidence);
            }
            if vote.reason == VoteReason::NliContradiction {
                has_contradiction = true;
            }
        }

        let confidence = score.clamp(0.0, 1.0);

        let status = if has_contradiction && confidence < 0.3 {
            MentionStatus::Rejected
        } else if has_known && confidence >= 0.85 {
            MentionStatus::AcceptedKnown
        } else if confidence >= 0.65 {
            MentionStatus::AcceptedNew
        } else if (has_model && max_model_confidence >= 0.55) || confidence >= 0.45 {
            MentionStatus::AliasCandidate
        } else {
            MentionStatus::NeedsAdjudication
        };

        (confidence, status)
    }

    fn build_label_distribution(
        votes: &SmallVec<[MentionVote; 6]>,
    ) -> SmallVec<[(EntityLabel, f32); 4]> {
        let mut labels = Vec::<(EntityLabel, f32)>::new();
        for vote in votes {
            if let Some(label) = &vote.label {
                if let Some(existing) = labels.iter_mut().find(|(l, _)| l == label) {
                    existing.1 += vote.confidence;
                } else {
                    labels.push((label.clone(), vote.confidence));
                }
            }
        }
        labels.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        labels.truncate(4);
        // Normalize to sum=1 if possible.
        let total: f32 = labels.iter().map(|(_, w)| *w).sum();
        if total > 0.0 {
            for (_, w) in labels.iter_mut() {
                *w /= total;
            }
        }
        SmallVec::from_vec(labels)
    }
}

fn surface_evidence_weight(vote: &MentionVote) -> Option<f32> {
    match vote.source {
        MentionSourceKind::KnownLexicon => Some(3.0 + vote.confidence),
        MentionSourceKind::ModelDiscovery => Some(vote.confidence),
        _ => None,
    }
}

fn upsert_surface_evidence(
    rows: &mut Vec<SurfaceLabelEvidence>,
    label: &EntityLabel,
    score: f32,
    is_known: bool,
) {
    let group = label_group(label.as_str());
    if let Some(row) = rows
        .iter_mut()
        .find(|row| label_group(row.label.as_str()) == group)
    {
        row.score += score;
        row.count += 1;
        if is_known {
            row.known_count += 1;
            row.label = label.clone();
        }
    } else {
        rows.push(SurfaceLabelEvidence {
            label: label.clone(),
            score,
            count: 1,
            known_count: usize::from(is_known),
        });
    }
}

fn entry_has_known_label(entry: &WorkspaceEntry) -> bool {
    entry
        .votes
        .iter()
        .any(|vote| vote.source == MentionSourceKind::KnownLexicon && vote.label.is_some())
}

fn entry_has_non_model_label(entry: &WorkspaceEntry) -> bool {
    entry.votes.iter().any(|vote| {
        vote.label.is_some()
            && !matches!(
                vote.source,
                MentionSourceKind::ModelDiscovery | MentionSourceKind::ModelVerify
            )
    })
}

fn entry_has_label_group(entry: &WorkspaceEntry, label: &str) -> bool {
    let group = label_group(label);
    entry.votes.iter().any(|vote| {
        vote.label
            .as_ref()
            .is_some_and(|existing| label_group(existing.as_str()) == group)
    })
}

fn label_group(label: &str) -> &'static str {
    match label.to_ascii_lowercase().as_str() {
        "character" | "person" | "npc" => "person",
        "organization" | "faction" | "alliance" | "department" => "organization",
        "location" | "region" | "landmark" => "location",
        "artifact" | "item" | "weapon" => "item",
        "ability" | "spell" => "ability",
        "event" => "event",
        _ => "other",
    }
}

fn kind_adjudication_priority(
    entry: &WorkspaceEntry,
    text: &str,
    sentences: &[SentenceSpan],
) -> Option<u16> {
    if entry.mention_kind != MentionKind::Named
        || entry_has_known_label(entry)
        || entry
            .votes
            .iter()
            .any(|vote| vote.source == MentionSourceKind::Adjudication)
    {
        return None;
    }

    let sentence = sentence_text(text, sentences, entry.sentence_index);
    let groups = label_groups_for_entry(entry);
    if groups.len() > 1 {
        return Some(120 + groups.len().min(4) as u16);
    }

    if let Some(hint) = surface_kind_hint(entry.surface.as_str(), sentence.as_str()) {
        let hint_group = label_group(hint.as_str());
        if groups.is_empty() {
            return Some(88);
        }
        if groups.iter().any(|group| *group != hint_group) {
            return Some(110);
        }
    }

    if dialogue_speaker_hint(entry.surface.as_str(), sentence.as_str())
        && groups.iter().any(|group| *group != "person")
    {
        return Some(104);
    }

    let has_repeated = entry
        .votes
        .iter()
        .any(|vote| vote.reason == VoteReason::RepeatedSurface);
    let has_model = entry.votes.iter().any(|vote| {
        matches!(
            vote.source,
            MentionSourceKind::ModelDiscovery | MentionSourceKind::ModelVerify
        )
    });
    if has_repeated && (!has_model || groups.is_empty()) {
        return Some(72);
    }

    None
}

fn candidate_labels_for_entry(
    entry: &WorkspaceEntry,
    text: &str,
    sentences: &[SentenceSpan],
) -> SmallVec<[EntityLabel; 4]> {
    let sentence = sentence_text(text, sentences, entry.sentence_index);
    let mut labels = SmallVec::<[EntityLabel; 4]>::new();
    for vote in &entry.votes {
        let Some(label) = vote.label.as_ref() else {
            continue;
        };
        push_unique_label(&mut labels, canonical_kind_label(label.as_str()));
    }
    if let Some(label) = surface_kind_hint(entry.surface.as_str(), sentence.as_str()) {
        push_unique_label(&mut labels, label);
    }
    for fallback in ["Character", "Organization", "Location", "Event", "Artifact"] {
        if labels.len() >= 4 {
            break;
        }
        push_unique_label(&mut labels, EntityLabel::new(fallback));
    }
    labels
}

fn push_unique_label(labels: &mut SmallVec<[EntityLabel; 4]>, label: EntityLabel) {
    let group = label_group(label.as_str());
    if labels
        .iter()
        .any(|existing| label_group(existing.as_str()) == group)
    {
        return;
    }
    labels.push(label);
}

fn label_groups_for_entry(entry: &WorkspaceEntry) -> SmallVec<[&'static str; 4]> {
    let mut groups = SmallVec::<[&'static str; 4]>::new();
    for vote in &entry.votes {
        let Some(label) = vote.label.as_ref() else {
            continue;
        };
        let group = label_group(label.as_str());
        if group == "other" || groups.contains(&group) {
            continue;
        }
        groups.push(group);
    }
    groups
}

fn canonical_kind_label(label: &str) -> EntityLabel {
    match label_group(label) {
        "person" => EntityLabel::new("Character"),
        "organization" => EntityLabel::new("Organization"),
        "location" => EntityLabel::new("Location"),
        "event" => EntityLabel::new("Event"),
        "item" => EntityLabel::new("Artifact"),
        "ability" => EntityLabel::new("Ability"),
        _ => EntityLabel::new(label),
    }
}

fn surface_kind_hint(surface: &str, sentence: &str) -> Option<EntityLabel> {
    let normalized = surface.to_ascii_lowercase();
    if dialogue_speaker_hint(surface, sentence) {
        return Some(EntityLabel::new("Character"));
    }
    if contains_kind_cue(&normalized, ORG_CUES) {
        return Some(EntityLabel::new("Organization"));
    }
    if contains_kind_cue(&normalized, LOCATION_CUES) {
        return Some(EntityLabel::new("Location"));
    }
    None
}

fn contains_kind_cue(surface: &str, cues: &[&str]) -> bool {
    cues.iter().any(|cue| {
        surface
            .split(|ch: char| !ch.is_ascii_alphanumeric())
            .any(|word| !word.is_empty() && word == *cue)
    })
}

fn dialogue_speaker_hint(surface: &str, sentence: &str) -> bool {
    let surface = surface.trim().to_ascii_lowercase();
    if surface.is_empty() {
        return false;
    }
    let sentence = sentence.to_ascii_lowercase();
    let cues = [
        "said",
        "asked",
        "told",
        "replied",
        "answered",
        "whispered",
        "shouted",
    ];
    cues.iter().any(|cue| {
        sentence.starts_with(&format!("{surface} {cue}"))
            || sentence.contains(&format!(" {surface} {cue}"))
    })
}

fn sentence_text(text: &str, sentences: &[SentenceSpan], sentence_index: u32) -> CompactString {
    sentences
        .get(sentence_index as usize)
        .and_then(|sentence| text.get(sentence.range.start as usize..sentence.range.end as usize))
        .map(str::trim)
        .unwrap_or_default()
        .into()
}

const ORG_CUES: &[&str] = &[
    "academy",
    "alliance",
    "allied",
    "association",
    "clan",
    "committee",
    "company",
    "council",
    "department",
    "faction",
    "guild",
    "institute",
    "order",
    "society",
    "table",
    "team",
];

const LOCATION_CUES: &[&str] = &[
    "base", "camp", "city", "country", "district", "fort", "germany", "kingdom", "land", "mesa",
    "mount", "province", "region", "river", "station", "town", "valley",
];

fn is_surface_label_source(source: MentionSourceKind) -> bool {
    matches!(
        source,
        MentionSourceKind::KnownLexicon
            | MentionSourceKind::ModelDiscovery
            | MentionSourceKind::ModelVerify
    )
}

fn is_entity_label(label: &str) -> bool {
    matches!(
        label.to_ascii_lowercase().as_str(),
        "character"
            | "person"
            | "npc"
            | "organization"
            | "faction"
            | "location"
            | "region"
            | "landmark"
            | "event"
            | "artifact"
            | "item"
            | "weapon"
            | "ability"
            | "spell"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::VoteReason;

    #[test]
    fn score_table_positive_weights() {
        let table = ScoreTable::default();
        assert!(table.weight(VoteReason::ExactCanonical) > 0.0);
        assert!(table.weight(VoteReason::CapSpan) > 0.0);
    }

    #[test]
    fn score_table_negative_penalties() {
        let table = ScoreTable::default();
        assert!(table.weight(VoteReason::NliContradiction) < 0.0);
        assert!(table.weight(VoteReason::StopwordPenalty) < 0.0);
        assert!(table.weight(VoteReason::GuardViolation) < 0.0);
    }

    #[test]
    fn workspace_finalize_produces_sorted_packets() {
        let mut ws = MentionWorkspace::new("doc1", 0);
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(1),
            range: phoenix_types::TextRange { start: 20, end: 30 },
            surface: CompactString::from("Adrian"),
            normalized: CompactString::from("adrian"),
            mention_kind: MentionKind::Named,
            entity_ref: None,
            votes: SmallVec::from_elem(
                MentionVote {
                    source: MentionSourceKind::NativeDiscovery,
                    label: None,
                    entity_ref: None,
                    confidence: 0.78,
                    reason: VoteReason::CapSpan,
                },
                1,
            ),
            sentence_index: 0,
        });
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(0),
            range: phoenix_types::TextRange { start: 0, end: 7 },
            surface: CompactString::from("Kamaria"),
            normalized: CompactString::from("kamaria"),
            mention_kind: MentionKind::Named,
            entity_ref: None,
            votes: SmallVec::from_elem(
                MentionVote {
                    source: MentionSourceKind::KnownLexicon,
                    label: None,
                    entity_ref: None,
                    confidence: 1.0,
                    reason: VoteReason::ExactCanonical,
                },
                1,
            ),
            sentence_index: 0,
        });
        let packets = ws.finalize_packets();
        assert_eq!(packets.len(), 2);
        assert!(packets[0].range.start < packets[1].range.start);
    }

    #[test]
    fn known_entity_gets_accepted_known_status() {
        let mut ws = MentionWorkspace::new("doc1", 0);
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(0),
            range: phoenix_types::TextRange { start: 0, end: 7 },
            surface: CompactString::from("Kamaria"),
            normalized: CompactString::from("kamaria"),
            mention_kind: MentionKind::Named,
            entity_ref: Some(MentionEntityRef::Known(phoenix_types::EntityId(
                "k1".into(),
            ))),
            votes: SmallVec::from_elem(
                MentionVote {
                    source: MentionSourceKind::KnownLexicon,
                    label: Some(EntityLabel::new("Character")),
                    entity_ref: Some(MentionEntityRef::Known(phoenix_types::EntityId(
                        "k1".into(),
                    ))),
                    confidence: 1.0,
                    reason: VoteReason::ExactCanonical,
                },
                1,
            ),
            sentence_index: 0,
        });
        let packets = ws.finalize_packets();
        assert_eq!(packets[0].status, MentionStatus::AcceptedKnown);
        assert!(packets[0].confidence >= 0.95);
    }

    #[test]
    fn contradiction_drops_to_rejected() {
        let mut ws = MentionWorkspace::new("doc1", 0);
        let mut votes = SmallVec::new();
        votes.push(MentionVote {
            source: MentionSourceKind::NativeDiscovery,
            label: None,
            entity_ref: None,
            confidence: 0.5,
            reason: VoteReason::CapSpan,
        });
        votes.push(MentionVote {
            source: MentionSourceKind::Adjudication,
            label: None,
            entity_ref: None,
            confidence: 1.0,
            reason: VoteReason::NliContradiction,
        });
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(0),
            range: phoenix_types::TextRange { start: 0, end: 5 },
            surface: CompactString::from("the"),
            normalized: CompactString::from("the"),
            mention_kind: MentionKind::Named,
            entity_ref: None,
            votes,
            sentence_index: 0,
        });
        let packets = ws.finalize_packets();
        assert_eq!(packets[0].status, MentionStatus::Rejected);
    }

    #[test]
    fn weak_native_cap_span_needs_adjudication() {
        let mut ws = MentionWorkspace::new("doc1", 0);
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(0),
            range: phoenix_types::TextRange { start: 0, end: 7 },
            surface: CompactString::from("Output"),
            normalized: CompactString::from("output"),
            mention_kind: MentionKind::Named,
            entity_ref: None,
            votes: SmallVec::from_elem(
                MentionVote {
                    source: MentionSourceKind::NativeDiscovery,
                    label: None,
                    entity_ref: None,
                    confidence: 0.78,
                    reason: VoteReason::CapSpan,
                },
                1,
            ),
            sentence_index: 0,
        });
        let packets = ws.finalize_packets();
        assert_eq!(packets[0].status, MentionStatus::NeedsAdjudication);
        assert!(packets[0].confidence < 0.45);
    }

    #[test]
    fn model_label_propagates_to_same_surface_native_mentions() {
        let mut ws = MentionWorkspace::new("doc1", 0);
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(0),
            range: phoenix_types::TextRange { start: 0, end: 4 },
            surface: CompactString::from("Ryan"),
            normalized: CompactString::from("ryan"),
            mention_kind: MentionKind::Named,
            entity_ref: None,
            votes: SmallVec::from_elem(
                MentionVote {
                    source: MentionSourceKind::ModelDiscovery,
                    label: Some(EntityLabel::new("Character")),
                    entity_ref: None,
                    confidence: 0.82,
                    reason: VoteReason::ModelLabel,
                },
                1,
            ),
            sentence_index: 0,
        });
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(1),
            range: phoenix_types::TextRange { start: 20, end: 24 },
            surface: CompactString::from("Ryan"),
            normalized: CompactString::from("ryan"),
            mention_kind: MentionKind::Named,
            entity_ref: None,
            votes: SmallVec::from_elem(
                MentionVote {
                    source: MentionSourceKind::NativeDiscovery,
                    label: None,
                    entity_ref: None,
                    confidence: 0.78,
                    reason: VoteReason::CapSpan,
                },
                1,
            ),
            sentence_index: 1,
        });

        let packets = ws.finalize_packets();
        let propagated = packets
            .iter()
            .find(|packet| packet.mention_id == LocalMentionId(1))
            .unwrap();
        assert!(propagated
            .label_distribution
            .iter()
            .any(|(label, _)| label.as_str() == "Character"));
        assert_eq!(propagated.status, MentionStatus::AliasCandidate);
    }

    #[test]
    fn known_surface_kind_prior_resists_conflicting_model_label() {
        let mut ws = MentionWorkspace::new("doc1", 0);
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(0),
            range: phoenix_types::TextRange { start: 0, end: 6 },
            surface: CompactString::from("Cyoria"),
            normalized: CompactString::from("cyoria"),
            mention_kind: MentionKind::Named,
            entity_ref: Some(MentionEntityRef::Known(phoenix_types::EntityId(
                "cyoria".into(),
            ))),
            votes: SmallVec::from_elem(
                MentionVote {
                    source: MentionSourceKind::KnownLexicon,
                    label: Some(EntityLabel::new("Location")),
                    entity_ref: Some(MentionEntityRef::Known(phoenix_types::EntityId(
                        "cyoria".into(),
                    ))),
                    confidence: 1.0,
                    reason: VoteReason::ExactCanonical,
                },
                1,
            ),
            sentence_index: 0,
        });
        ws.entries.push(WorkspaceEntry {
            id: LocalMentionId(1),
            range: phoenix_types::TextRange { start: 20, end: 26 },
            surface: CompactString::from("Cyoria"),
            normalized: CompactString::from("cyoria"),
            mention_kind: MentionKind::Named,
            entity_ref: None,
            votes: SmallVec::from_elem(
                MentionVote {
                    source: MentionSourceKind::ModelDiscovery,
                    label: Some(EntityLabel::new("Person")),
                    entity_ref: None,
                    confidence: 0.74,
                    reason: VoteReason::ModelLabel,
                },
                1,
            ),
            sentence_index: 1,
        });

        let packets = ws.finalize_packets();
        let contested = packets
            .iter()
            .find(|packet| packet.mention_id == LocalMentionId(1))
            .unwrap();

        assert_eq!(contested.label_distribution[0].0.as_str(), "Location");
        assert!(contested.source_votes.iter().any(|vote| {
            vote.reason == VoteReason::RepeatedSurface
                && vote
                    .label
                    .as_ref()
                    .is_some_and(|label| label.as_str() == "Location")
        }));
    }

    #[test]
    fn label_distribution_normalizes() {
        let votes: SmallVec<[MentionVote; 6]> = SmallVec::from_vec(vec![
            MentionVote {
                source: MentionSourceKind::KnownLexicon,
                label: Some(EntityLabel::new("Character")),
                entity_ref: None,
                confidence: 0.8,
                reason: VoteReason::ExactCanonical,
            },
            MentionVote {
                source: MentionSourceKind::NativeDiscovery,
                label: Some(EntityLabel::new("Location")),
                entity_ref: None,
                confidence: 0.2,
                reason: VoteReason::CapSpan,
            },
        ]);
        let dist = MentionWorkspace::build_label_distribution(&votes);
        let total: f32 = dist.iter().map(|(_, w)| *w).sum();
        assert!((total - 1.0).abs() < 0.01);
    }
}
