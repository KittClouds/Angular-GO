//! Dynamic Schema Builder — constructs scoped label packs.
//!
//! Builds tiny, local label sets for model NER based on context signals:
//! domain profile, gazetteer-proximal labels, chunk-local labels.
//! GLiNER gets a scalpel, not a junk drawer.

use smallvec::SmallVec;

use crate::known_lane::KnownCandidate;
use crate::native_lane::NativeCandidate;
use crate::types::{DomainProfile, EntityLabel, LabelPack, MentionKind};

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
        _window_start: u32,
        _window_end: u32,
        known: &[KnownCandidate],
        native: &[NativeCandidate],
    ) -> LabelPack {
        let domain = self.detect_domain(known, native);
        let mut labels = SmallVec::new();

        // Layer 1: Universal core (always present).
        Self::add_universal_core(&mut labels);

        // Layer 2: Domain profile labels.
        Self::add_domain_labels(&mut labels, domain);

        // Layer 3: Gazetteer-proximal labels from known entities.
        Self::add_gazetteer_proximal(&mut labels, known);

        // Cap to max.
        labels.truncate(self.max_labels);

        // Seed surfaces from known candidates.
        let seed_surfaces = known.iter().map(|c| c.surface.clone()).collect();

        LabelPack {
            domain,
            labels,
            seed_surfaces,
            negative_labels: SmallVec::new(),
            max_labels: self.max_labels,
        }
    }

    /// Detect domain profile from known + native signals.
    fn detect_domain(&self, known: &[KnownCandidate], native: &[NativeCandidate]) -> DomainProfile {
        // Check known entity kinds for domain signal.
        let mut fantasy_score = 0u16;
        let mut corporate_score = 0u16;
        let technical_score = 0u16;

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
        }

        if fantasy_score > corporate_score && fantasy_score > technical_score {
            if fantasy_score >= 3 {
                DomainProfile::Fantasy
            } else {
                DomainProfile::Story
            }
        } else if corporate_score > fantasy_score {
            DomainProfile::Corporate
        } else if technical_score > 0 {
            DomainProfile::Technical
        } else {
            self.default_domain
        }
    }

    fn add_universal_core(labels: &mut SmallVec<[EntityLabel; 16]>) {
        for label in UNIVERSAL_CORE {
            labels.push(EntityLabel::new(label));
        }
    }

    fn add_domain_labels(labels: &mut SmallVec<[EntityLabel; 16]>, domain: DomainProfile) {
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
            labels.push(EntityLabel::new(label));
        }
    }

    fn add_gazetteer_proximal(labels: &mut SmallVec<[EntityLabel; 16]>, known: &[KnownCandidate]) {
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
                labels.push(EntityLabel::new(label));
            }
        }
        if has_location {
            for label in &["Region", "Landmark"] {
                labels.push(EntityLabel::new(label));
            }
        }
    }
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
}
