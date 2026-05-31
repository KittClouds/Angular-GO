//! Dynamic Schema Builder — constructs scoped label packs.
//!
//! Builds tiny, local label sets for model NER based on context signals:
//! domain profile, gazetteer-proximal labels, chunk-local labels.
//! GLiNER gets a scalpel, not a junk drawer.

use smallvec::{smallvec, SmallVec};

use crate::known_lane::KnownCandidate;
use crate::native_lane::NativeCandidate;
use crate::types::{
    DomainProfile, EntityLabel, LabelBankContext, LabelBankSource, LabelPack, MentionKind,
};

/// Builds label packs from context signals.
pub struct DynamicSchemaBuilder {
    /// Hard cap on labels in any pack.
    pub max_labels: usize,
    /// Default domain profile when detection is ambiguous.
    pub default_domain: DomainProfile,
}

impl Default for DynamicSchemaBuilder {
    fn default() -> Self {
        Self {
            max_labels: 14,
            default_domain: DomainProfile::General,
        }
    }
}

impl DynamicSchemaBuilder {
    /// Build a label pack for a sentence window.
    pub fn build_pack_for_window(
        &self,
        window_start: u32,
        window_end: u32,
        known: &[KnownCandidate],
        native: &[NativeCandidate],
    ) -> LabelPack {
        self.build_pack_for_window_v2(window_start, window_end, known, native, None)
    }

    pub fn build_pack_for_window_v2(
        &self,
        _window_start: u32,
        _window_end: u32,
        known: &[KnownCandidate],
        native: &[NativeCandidate],
        context: Option<&LabelBankContext<'_>>,
    ) -> LabelPack {
        let domain = context
            .and_then(|ctx| ctx.domain_profile)
            .unwrap_or_else(|| self.detect_domain(known, native));
        let mut bank = LabelBankDraft::default();

        Self::add_universal_core(&mut bank);
        if let Some(ctx) = context {
            Self::add_context_labels(&mut bank, ctx.user_type_labels, LabelBankSource::UserType);
            Self::add_context_labels(
                &mut bank,
                ctx.source_frame_labels,
                LabelBankSource::SourceFrameContext,
            );
            Self::add_context_labels(
                &mut bank,
                ctx.graph_context_labels,
                LabelBankSource::GraphContext,
            );
        }
        Self::add_domain_labels(&mut bank, domain);
        Self::add_gazetteer_proximal(&mut bank, known);

        bank.truncate(self.max_labels);
        LabelPack {
            domain,
            labels: bank.labels,
            label_sources: bank.sources,
            seed_surfaces: known.iter().map(|c| c.surface.clone()).collect(),
            negative_labels: negative_labels_for(domain),
            max_labels: self.max_labels,
        }
    }

    /// Detect domain profile from known + native signals.
    fn detect_domain(&self, known: &[KnownCandidate], native: &[NativeCandidate]) -> DomainProfile {
        // Check known entity kinds for domain signal.
        let mut fantasy_score = 0u16;
        let mut corporate_score = 0u16;
        let mut technical_score = 0u16;

        for c in known {
            match c.type_hint.as_ref() {
                Some(phoenix_types::EntityKind::Character)
                | Some(phoenix_types::EntityKind::Npc) => fantasy_score += 2,
                Some(phoenix_types::EntityKind::Faction) => fantasy_score += 3,
                Some(phoenix_types::EntityKind::Organization) => corporate_score += 2,
                Some(phoenix_types::EntityKind::Item) => fantasy_score += 1,
                _ => {}
            }
        }

        // Nominal roles hint at fantasy/story domain.
        for c in native {
            if c.mention_kind == MentionKind::Nominal {
                fantasy_score += 1;
            }
            if is_technical_surface(c.surface.as_str()) {
                technical_score += 2;
            }
        }

        if fantasy_score > corporate_score && fantasy_score > technical_score {
            if fantasy_score >= 3 {
                DomainProfile::Fantasy
            } else {
                DomainProfile::Story
            }
        } else if corporate_score > fantasy_score {
            DomainProfile::Corporate
        } else if technical_score >= 3 {
            DomainProfile::Technical
        } else {
            self.default_domain
        }
    }

    fn add_universal_core(bank: &mut LabelBankDraft) {
        for label in UNIVERSAL_CORE {
            bank.push(EntityLabel::new(label), LabelBankSource::Schema);
        }
    }

    fn add_domain_labels(bank: &mut LabelBankDraft, domain: DomainProfile) {
        let domain_labels: &[&str] = match domain {
            DomainProfile::Fantasy => {
                &["Weapon", "Artifact", "Creature", "Ability", "Rank", "Spell"]
            }
            DomainProfile::Corporate => &[
                "Executive",
                "Department",
                "Product",
                "Metric",
                "Initiative",
                "Risk",
            ],
            DomainProfile::Technical => &[
                "Library",
                "Function",
                "Module",
                "Error",
                "Benchmark",
                "Algorithm",
            ],
            DomainProfile::Legal => &[
                "Statute",
                "Court",
                "Ruling",
                "Party",
                "Jurisdiction",
                "Claim",
            ],
            DomainProfile::Academic => &[
                "Researcher",
                "Institution",
                "Paper",
                "Theory",
                "Dataset",
                "Method",
            ],
            DomainProfile::Memory | DomainProfile::Story => &[
                "State",
                "Goal",
                "Relationship",
                "Object",
                "Ability",
                "Emotion",
            ],
            DomainProfile::General => &["Role", "Object", "Attribute"],
        };
        for label in domain_labels {
            bank.push(EntityLabel::new(label), LabelBankSource::DomainProfile);
        }
    }

    fn add_gazetteer_proximal(bank: &mut LabelBankDraft, known: &[KnownCandidate]) {
        let mut has_faction = false;
        let mut has_location = false;

        for c in known {
            match c.type_hint.as_ref() {
                Some(phoenix_types::EntityKind::Faction)
                | Some(phoenix_types::EntityKind::Organization) => has_faction = true,
                Some(phoenix_types::EntityKind::Location) => has_location = true,
                _ => {}
            }
        }

        if has_faction {
            for label in &["Member", "Enemy", "Alliance"] {
                bank.push(EntityLabel::new(label), LabelBankSource::Gazetteer);
            }
        }
        if has_location {
            for label in &["Region", "Landmark"] {
                bank.push(EntityLabel::new(label), LabelBankSource::Gazetteer);
            }
        }
    }

    fn add_context_labels(
        bank: &mut LabelBankDraft,
        labels: &[EntityLabel],
        source: LabelBankSource,
    ) {
        for label in labels {
            bank.push(label.clone(), source);
        }
    }
}

#[derive(Default)]
struct LabelBankDraft {
    labels: SmallVec<[EntityLabel; 16]>,
    sources: SmallVec<[(EntityLabel, LabelBankSource); 16]>,
}

impl LabelBankDraft {
    fn push(&mut self, label: EntityLabel, source: LabelBankSource) {
        if label.as_str().trim().is_empty() {
            return;
        }
        if self
            .labels
            .iter()
            .any(|existing| existing.as_str().eq_ignore_ascii_case(label.as_str()))
        {
            return;
        }
        self.sources.push((label.clone(), source));
        self.labels.push(label);
    }

    fn truncate(&mut self, max_labels: usize) {
        self.labels.truncate(max_labels);
        self.sources.truncate(max_labels);
    }
}

fn negative_labels_for(domain: DomainProfile) -> SmallVec<[EntityLabel; 8]> {
    match domain {
        DomainProfile::Technical => smallvec![
            EntityLabel::new("FilePath"),
            EntityLabel::new("CliFlag"),
            EntityLabel::new("LogLevel")
        ],
        DomainProfile::Legal => smallvec![EntityLabel::new("Boilerplate")],
        _ => SmallVec::new(),
    }
}

fn is_technical_surface(surface: &str) -> bool {
    let lower = surface.to_ascii_lowercase();
    lower.contains('_')
        || lower.contains("cli")
        || lower.contains("benchmark")
        || lower.contains("chunk")
        || lower.contains("embedding")
        || lower.contains("geometry")
        || lower.contains("manifold")
        || lower.contains("projection")
        || lower.contains("vector")
        || lower.contains("hash")
        || lower.contains("assertion")
}

const UNIVERSAL_CORE: &[&str] = &["Character", "Organization", "Location", "Event", "Artifact"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn universal_core_always_present() {
        let builder = DynamicSchemaBuilder::default();
        let pack = builder.build_pack_for_window(0, 1, &[], &[]);
        assert!(pack.labels.iter().any(|l| l.as_str() == "Character"));
        assert!(pack.labels.iter().any(|l| l.as_str() == "Location"));
        assert!(pack.labels.iter().any(|l| l.as_str() == "Event"));
        assert!(pack
            .label_sources
            .iter()
            .any(|(_, source)| *source == LabelBankSource::Schema));
    }

    #[test]
    fn label_pack_respects_max_cap() {
        let builder = DynamicSchemaBuilder {
            max_labels: 6,
            ..Default::default()
        };
        let pack = builder.build_pack_for_window(0, 1, &[], &[]);
        assert!(pack.labels.len() <= 6);
    }

    #[test]
    fn default_domain_is_general() {
        let builder = DynamicSchemaBuilder::default();
        let domain = builder.detect_domain(&[], &[]);
        assert_eq!(domain, DomainProfile::General);
    }

    #[test]
    fn label_bank_v2_layers_context_with_provenance() {
        let builder = DynamicSchemaBuilder {
            max_labels: 14,
            ..Default::default()
        };
        let source_frame_labels = [EntityLabel::new("EvidenceBundle")];
        let graph_context_labels = [EntityLabel::new("RelationshipLane")];
        let user_type_labels = [EntityLabel::new("DragonHouse")];
        let context = LabelBankContext {
            domain_profile: Some(DomainProfile::Technical),
            source_frame_labels: &source_frame_labels,
            graph_context_labels: &graph_context_labels,
            user_type_labels: &user_type_labels,
        };

        let pack = builder.build_pack_for_window_v2(0, 1, &[], &[], Some(&context));

        for expected in [
            "Character",
            "EvidenceBundle",
            "RelationshipLane",
            "DragonHouse",
            "Library",
        ] {
            assert!(
                pack.labels.iter().any(|label| label.as_str() == expected),
                "missing {expected} in {:?}",
                pack.labels
            );
        }
        assert!(has_source(&pack, "DragonHouse", LabelBankSource::UserType));
        assert!(has_source(
            &pack,
            "EvidenceBundle",
            LabelBankSource::SourceFrameContext
        ));
        assert!(has_source(
            &pack,
            "RelationshipLane",
            LabelBankSource::GraphContext
        ));
        assert!(has_source(&pack, "Library", LabelBankSource::DomainProfile));
        assert!(pack
            .negative_labels
            .iter()
            .any(|label| label.as_str() == "FilePath"));
    }

    #[test]
    fn label_bank_v2_dedupes_case_insensitively() {
        let builder = DynamicSchemaBuilder::default();
        let user_type_labels = [EntityLabel::new("character")];
        let context = LabelBankContext {
            user_type_labels: &user_type_labels,
            ..Default::default()
        };

        let pack = builder.build_pack_for_window_v2(0, 1, &[], &[], Some(&context));
        assert_eq!(
            pack.labels
                .iter()
                .filter(|label| label.as_str().eq_ignore_ascii_case("character"))
                .count(),
            1
        );
    }

    #[test]
    fn fantasy_domain_detected_from_factions() {
        use crate::types::{LocalMentionId, MentionSourceKind, MentionVote, VoteReason};
        use compact_str::CompactString;
        use phoenix_types::{EntityKind, MentionEntityRef, TextRange};
        use smallvec::SmallVec;

        let known = vec![KnownCandidate {
            mention_id: LocalMentionId(0),
            range: TextRange::default(),
            surface: CompactString::from("Crimson Veil"),
            normalized: CompactString::from("crimson veil"),
            mention_kind: MentionKind::Named,
            entity_ref: Some(MentionEntityRef::Known(phoenix_types::EntityId(
                "cv".to_owned(),
            ))),
            type_hint: Some(EntityKind::Faction),
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
        }];
        let builder = DynamicSchemaBuilder::default();
        let domain = builder.detect_domain(&known, &[]);
        assert_eq!(domain, DomainProfile::Fantasy);
    }

    #[test]
    fn technical_domain_detected_from_native_surfaces() {
        use crate::types::{LocalMentionId, MentionSourceKind, MentionVote, VoteReason};
        use compact_str::CompactString;
        use phoenix_types::TextRange;
        use smallvec::SmallVec;

        let native = vec![
            NativeCandidate {
                mention_id: LocalMentionId(0),
                range: TextRange::default(),
                surface: CompactString::from("CLI Shape"),
                normalized: CompactString::from("cli shape"),
                mention_kind: MentionKind::Named,
                entity_ref: None,
                votes: SmallVec::from_elem(
                    MentionVote {
                        source: MentionSourceKind::NativeDiscovery,
                        label: None,
                        entity_ref: None,
                        confidence: 0.7,
                        reason: VoteReason::CapSpan,
                    },
                    1,
                ),
                sentence_index: 0,
            },
            NativeCandidate {
                mention_id: LocalMentionId(1),
                range: TextRange::default(),
                surface: CompactString::from("Vector Hashes"),
                normalized: CompactString::from("vector hashes"),
                mention_kind: MentionKind::Named,
                entity_ref: None,
                votes: SmallVec::new(),
                sentence_index: 0,
            },
        ];
        let builder = DynamicSchemaBuilder::default();
        assert_eq!(
            builder.detect_domain(&[], &native),
            DomainProfile::Technical
        );
    }

    fn has_source(pack: &LabelPack, label: &str, source: LabelBankSource) -> bool {
        pack.label_sources
            .iter()
            .any(|(actual, actual_source)| actual.as_str() == label && *actual_source == source)
    }
}
