//! Scoring + MentionWorkspace — additive vote scoring and packet finalization.
//!
//! Source-calibrated scoring collapses votes from all lanes into a single
//! confidence and status per mention. The workspace acts as an arena-style
//! accumulator during the pipeline.

use compact_str::CompactString;
use phoenix_types::MentionEntityRef;
use smallvec::SmallVec;

use crate::known_lane::KnownCandidate;
use crate::native_lane::NativeCandidate;
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
            cap_span: 0.68,
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

    /// Next available mention id.
    pub fn next_id(&mut self) -> LocalMentionId {
        let id = LocalMentionId(self.next_id);
        self.next_id += 1;
        id
    }

    /// Finalize all entries into scored MentionPackets.
    pub fn finalize_packets(mut self) -> Vec<MentionPacket> {
        let entries = std::mem::take(&mut self.entries);
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

    fn score_entry(&self, entry: &WorkspaceEntry) -> (f32, MentionStatus) {
        let mut score = 0.0_f32;
        let mut has_known = false;
        let mut has_model = false;
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
        } else if has_model || confidence >= 0.45 {
            MentionStatus::AliasCandidate
        } else {
            MentionStatus::NeedsAdjudication
        };

        (confidence, status)
    }

    fn build_label_distribution(
        votes: &SmallVec<[MentionVote; 6]>,
    ) -> SmallVec<[(EntityLabel, f32); 4]> {
        let mut labels = SmallVec::<[(EntityLabel, f32); 4]>::new();
        for vote in votes {
            if let Some(label) = &vote.label {
                if let Some(existing) = labels.iter_mut().find(|(l, _)| l == label) {
                    existing.1 += vote.confidence;
                } else if labels.len() < 4 {
                    labels.push((label.clone(), vote.confidence));
                }
            }
        }
        // Normalize to sum=1 if possible.
        let total: f32 = labels.iter().map(|(_, w)| *w).sum();
        if total > 0.0 {
            for (_, w) in labels.iter_mut() {
                *w /= total;
            }
        }
        labels
    }
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
