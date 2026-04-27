//! Native Discovery Lane — cheap, broad, ugly-fast.
//!
//! Spots suspicious surfaces without any model: capitalized spans, title+name
//! patterns, nominal roles, pronouns, dialogue speaker cues, repeated unknowns.
//! Uses `memchr` for SIMD-accelerated cue scanning.

use compact_str::CompactString;
use memchr::memmem;
use phoenix_alex::normalize_raw;
use phoenix_types::{MentionEntityRef, PosTag, SentenceSpan, TextRange, TokenClass, TokenSpan};
use smallvec::SmallVec;

use crate::known_lane::locate_sentence;
use crate::types::{LocalMentionId, MentionKind, MentionSourceKind, MentionVote, VoteReason};

/// A candidate produced by native heuristic discovery.
#[derive(Clone, Debug)]
pub struct NativeCandidate {
    pub mention_id: LocalMentionId,
    pub range: TextRange,
    pub surface: CompactString,
    pub normalized: CompactString,
    pub mention_kind: MentionKind,
    pub entity_ref: Option<MentionEntityRef>,
    pub votes: SmallVec<[MentionVote; 2]>,
    pub sentence_index: u32,
}

/// The native discovery scanner.
pub struct NativeDiscoveryLane;

impl NativeDiscoveryLane {
    /// Run the full native discovery pass over tokenized text.
    pub fn discover(
        text: &str,
        tokens: &[TokenSpan],
        sentences: &[SentenceSpan],
        known_ranges: &[TextRange],
        id_base: u64,
    ) -> Vec<NativeCandidate> {
        let mut candidates = Vec::new();
        let mut next_id = id_base;
        let mut idx = 0usize;

        while idx < tokens.len() {
            let token = &tokens[idx];

            // Skip tokens already covered by known-lane matches.
            if range_overlaps_any(token.range, known_ranges) {
                idx += 1;
                continue;
            }

            let token_text = safe_slice(text, token.range);
            let sent_idx = locate_sentence(sentences, token.range);

            // --- Pronoun harvesting ---
            if matches!(token.pos, Some(PosTag::Pronoun)) {
                candidates.push(NativeCandidate {
                    mention_id: LocalMentionId(next_id),
                    range: token.range,
                    surface: CompactString::from(token_text),
                    normalized: CompactString::from(normalize_raw(token_text)),
                    mention_kind: MentionKind::Pronoun,
                    entity_ref: None,
                    votes: SmallVec::from_elem(
                        MentionVote {
                            source: MentionSourceKind::Pronoun,
                            label: None,
                            entity_ref: None,
                            confidence: 0.65,
                            reason: VoteReason::NominalRole,
                        },
                        1,
                    ),
                    sentence_index: sent_idx,
                });
                next_id += 1;
                idx += 1;
                continue;
            }

            // --- Title + name pattern ---
            if is_title_token(token_text) {
                if let Some((end_idx, range)) = extend_title_span(text, tokens, idx) {
                    let surface = safe_slice(text, range);
                    candidates.push(NativeCandidate {
                        mention_id: LocalMentionId(next_id),
                        range,
                        surface: CompactString::from(surface),
                        normalized: CompactString::from(normalize_raw(surface)),
                        mention_kind: MentionKind::Named,
                        entity_ref: Some(MentionEntityRef::Speculative(
                            normalize_raw(surface).to_string(),
                        )),
                        votes: SmallVec::from_elem(
                            MentionVote {
                                source: MentionSourceKind::NativeDiscovery,
                                label: None,
                                entity_ref: None,
                                confidence: 0.80,
                                reason: VoteReason::TitlePattern,
                            },
                            1,
                        ),
                        sentence_index: sent_idx,
                    });
                    next_id += 1;
                    idx = end_idx + 1;
                    continue;
                }
            }

            // --- Capitalized span detection ---
            if token.capitalized && matches!(token.token_class, Some(TokenClass::Word)) {
                let (end_idx, range) = extend_cap_span(text, tokens, idx);
                let surface = safe_slice(text, range);
                if !surface.is_empty() {
                    candidates.push(NativeCandidate {
                        mention_id: LocalMentionId(next_id),
                        range,
                        surface: CompactString::from(surface),
                        normalized: CompactString::from(normalize_raw(surface)),
                        mention_kind: MentionKind::Named,
                        entity_ref: Some(MentionEntityRef::Speculative(
                            normalize_raw(surface).to_string(),
                        )),
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
                        sentence_index: sent_idx,
                    });
                    next_id += 1;
                    idx = end_idx + 1;
                    continue;
                }
            }

            // --- Nominal role detection ---
            if is_nominal_role(token_text) {
                candidates.push(NativeCandidate {
                    mention_id: LocalMentionId(next_id),
                    range: token.range,
                    surface: CompactString::from(token_text),
                    normalized: CompactString::from(normalize_raw(token_text)),
                    mention_kind: MentionKind::Nominal,
                    entity_ref: None,
                    votes: SmallVec::from_elem(
                        MentionVote {
                            source: MentionSourceKind::NativeDiscovery,
                            label: None,
                            entity_ref: None,
                            confidence: 0.52,
                            reason: VoteReason::NominalRole,
                        },
                        1,
                    ),
                    sentence_index: sent_idx,
                });
                next_id += 1;
            }

            idx += 1;
        }

        candidates
    }

    /// Detect dialogue speaker cues in a sentence using SIMD memmem.
    pub fn has_dialogue_cue(text: &str, sentence: &SentenceSpan) -> bool {
        let slice = safe_slice(text, sentence.range);
        let lowered = slice.to_ascii_lowercase();
        let bytes = lowered.as_bytes();
        DIALOGUE_CUES
            .iter()
            .any(|cue| memmem::find(bytes, cue.as_bytes()).is_some())
    }
}

const DIALOGUE_CUES: &[&str] = &[
    " said ",
    " told ",
    " asked ",
    " called ",
    " known as ",
    " according to ",
    " wrote ",
    " says ",
    " says,",
    " replied ",
    " answered ",
    " whispered ",
    " shouted ",
    " muttered ",
    " exclaimed ",
];

// ---------------------------------------------------------------------------
// Span extension helpers
// ---------------------------------------------------------------------------

fn extend_title_span(text: &str, tokens: &[TokenSpan], start: usize) -> Option<(usize, TextRange)> {
    let mut last = start;
    let mut end = tokens[start].range.end;
    while let Some(next) = tokens.get(last + 1) {
        let next_text = safe_slice(text, next.range);
        if looks_like_entity_token(next_text) || is_connective(next_text) {
            end = next.range.end;
            last += 1;
        } else {
            break;
        }
    }
    if last > start {
        Some((
            last,
            TextRange {
                start: tokens[start].range.start,
                end,
            },
        ))
    } else {
        None
    }
}

fn extend_cap_span(text: &str, tokens: &[TokenSpan], start: usize) -> (usize, TextRange) {
    let mut last = start;
    let mut end = tokens[start].range.end;
    while let Some(next) = tokens.get(last + 1) {
        let next_text = safe_slice(text, next.range);
        if (next.capitalized && matches!(next.token_class, Some(TokenClass::Word)))
            || is_connective(next_text)
        {
            end = next.range.end;
            last += 1;
        } else {
            break;
        }
    }
    (
        last,
        TextRange {
            start: tokens[start].range.start,
            end,
        },
    )
}

// ---------------------------------------------------------------------------
// Token classifiers
// ---------------------------------------------------------------------------

fn is_title_token(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().trim_end_matches('.'),
        "mr" | "mrs"
            | "ms"
            | "dr"
            | "prof"
            | "captain"
            | "capt"
            | "sir"
            | "lord"
            | "lady"
            | "king"
            | "queen"
            | "prince"
            | "princess"
    )
}

fn is_nominal_role(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "manager"
            | "captain"
            | "doctor"
            | "professor"
            | "teacher"
            | "brother"
            | "sister"
            | "mother"
            | "father"
            | "leader"
            | "chief"
            | "assistant"
            | "guard"
            | "agent"
            | "priest"
            | "king"
            | "queen"
            | "commander"
            | "general"
            | "elder"
            | "healer"
            | "warrior"
            | "mage"
            | "sorcerer"
            | "witch"
    )
}

fn is_connective(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "of" | "the" | "and" | "&"
    )
}

fn looks_like_entity_token(value: &str) -> bool {
    value
        .chars()
        .next()
        .map(|ch| ch.is_uppercase())
        .unwrap_or(false)
        && value.chars().any(|ch| ch.is_alphabetic())
}

fn range_overlaps_any(r: TextRange, ranges: &[TextRange]) -> bool {
    ranges
        .iter()
        .any(|other| r.start < other.end && other.start < r.end)
}

pub(crate) fn safe_slice(text: &str, range: TextRange) -> &str {
    let start = (range.start as usize).min(text.len());
    let end = (range.end as usize).min(text.len());
    text.get(start..end).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_token_matches() {
        assert!(is_title_token("Dr."));
        assert!(is_title_token("Captain"));
        assert!(!is_title_token("hello"));
    }

    #[test]
    fn nominal_role_matches() {
        assert!(is_nominal_role("captain"));
        assert!(is_nominal_role("warrior"));
        assert!(!is_nominal_role("quickly"));
    }

    #[test]
    fn connective_matches() {
        assert!(is_connective("of"));
        assert!(is_connective("The"));
        assert!(!is_connective("ran"));
    }

    #[test]
    fn entity_token_detection() {
        assert!(looks_like_entity_token("Kamaria"));
        assert!(!looks_like_entity_token("quickly"));
        assert!(!looks_like_entity_token("123"));
    }

    #[test]
    fn dialogue_cue_detection() {
        let span = SentenceSpan {
            index: 0,
            range: TextRange { start: 0, end: 30 },
        };
        assert!(NativeDiscoveryLane::has_dialogue_cue(
            "\"Hello,\" she said quietly.",
            &span
        ));
        assert!(!NativeDiscoveryLane::has_dialogue_cue(
            "The sky was blue and calm.",
            &SentenceSpan {
                index: 0,
                range: TextRange { start: 0, end: 25 }
            }
        ));
    }

    #[test]
    fn range_overlap_check() {
        let r = TextRange { start: 5, end: 10 };
        let others = [TextRange { start: 8, end: 15 }];
        assert!(range_overlaps_any(r, &others));
        let others2 = [TextRange { start: 10, end: 15 }];
        assert!(!range_overlaps_any(r, &others2));
    }
}
