use std::collections::BTreeMap;

use compact_str::CompactString;
use phoenix_types::{SentenceSpan, TextRange};
use serde::{Deserialize, Serialize};

use crate::graph::{MentionEdgeKind, MentionGraph};
use crate::types::{MentionKind, MentionPacket, MentionSourceKind, NerNeedVector, VoteReason};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChunkHintKind {
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
pub enum ChunkHintSource {
    SurfaceRouter,
    MentionWorkspace,
    MentionGraph,
    NativeDiscovery,
    ModelDiscovery,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkHint {
    pub id: CompactString,
    pub kind: ChunkHintKind,
    pub source: ChunkHintSource,
    pub range: TextRange,
    pub sentence_start: u32,
    pub sentence_end: u32,
    pub mention_ids: Vec<u64>,
    pub surfaces: Vec<CompactString>,
    pub score_millis: u16,
}

#[derive(Clone, Debug)]
struct HintDraft {
    kind: ChunkHintKind,
    source: ChunkHintSource,
    range: TextRange,
    sentence_start: u32,
    sentence_end: u32,
    mention_ids: Vec<u64>,
    surfaces: Vec<CompactString>,
    score_millis: u16,
}

pub(crate) fn build_chunk_hints(
    text: &str,
    sentences: &[SentenceSpan],
    packets: &[MentionPacket],
    mention_graph: &MentionGraph,
    needs: &[NerNeedVector],
) -> Vec<ChunkHint> {
    if packets.is_empty() {
        return Vec::new();
    }

    let mut drafts = Vec::<HintDraft>::new();
    add_sentence_region_hints(&mut drafts, text, sentences, packets, needs);
    add_pair_and_relationship_hints(&mut drafts, packets);
    add_graph_hints(&mut drafts, packets, mention_graph);
    add_role_alias_dialogue_hints(&mut drafts, text, sentences, packets);

    dedupe_and_sort(drafts)
}

fn add_sentence_region_hints(
    drafts: &mut Vec<HintDraft>,
    text: &str,
    sentences: &[SentenceSpan],
    packets: &[MentionPacket],
    needs: &[NerNeedVector],
) {
    for sentence in sentences {
        let sentence_packets = packets
            .iter()
            .filter(|packet| packet.sentence_index == sentence.index as u32)
            .collect::<Vec<_>>();
        if sentence_packets.is_empty() {
            continue;
        }
        let named_count = sentence_packets
            .iter()
            .filter(|packet| packet.mention_kind == MentionKind::Named)
            .count();
        let entity_like_count = sentence_packets
            .iter()
            .filter(|packet| packet.mention_kind != MentionKind::Pronoun)
            .count();
        let need = needs.get(sentence.index);
        if entity_like_count >= 3
            || named_count >= 2
            || need.is_some_and(|need| need.has_entity_pair)
        {
            push_hint(
                drafts,
                ChunkHintKind::EntityDenseRegion,
                ChunkHintSource::SurfaceRouter,
                sentence.range,
                sentence.index as u32,
                sentence.index as u32 + 1,
                &sentence_packets,
                650,
            );
        }
        if sentence_contains_event_cue(text, sentence)
            || need.is_some_and(|need| need.has_named_event_candidate)
        {
            let named = sentence_packets
                .iter()
                .filter(|packet| packet.mention_kind == MentionKind::Named)
                .copied()
                .collect::<Vec<_>>();
            if !named.is_empty() {
                push_hint(
                    drafts,
                    ChunkHintKind::NamedEventCandidate,
                    ChunkHintSource::SurfaceRouter,
                    covering_range(&named),
                    sentence.index as u32,
                    sentence.index as u32 + 1,
                    &named,
                    580,
                );
            }
        }
        if need.is_some_and(|need| need.has_ambiguous_reference) {
            push_hint(
                drafts,
                ChunkHintKind::Adjudication,
                ChunkHintSource::SurfaceRouter,
                sentence.range,
                sentence.index as u32,
                sentence.index as u32 + 1,
                &sentence_packets,
                560,
            );
        }
    }
}

fn add_pair_and_relationship_hints(drafts: &mut Vec<HintDraft>, packets: &[MentionPacket]) {
    let mut by_sentence = BTreeMap::<u32, Vec<&MentionPacket>>::new();
    for packet in packets {
        by_sentence
            .entry(packet.sentence_index)
            .or_default()
            .push(packet);
    }

    for (sentence_index, mut sentence_packets) in by_sentence {
        sentence_packets
            .sort_by_key(|packet| (packet.range.start, packet.range.end, packet.mention_id.0));
        let entities = sentence_packets
            .iter()
            .copied()
            .filter(|packet| packet.mention_kind == MentionKind::Named)
            .collect::<Vec<_>>();
        for (left_index, left) in entities.iter().enumerate() {
            for right in entities.iter().skip(left_index + 1) {
                if left.normalized == right.normalized {
                    continue;
                }
                push_hint(
                    drafts,
                    ChunkHintKind::EntityPair,
                    ChunkHintSource::MentionWorkspace,
                    merge_ranges(left.range, right.range),
                    sentence_index,
                    sentence_index + 1,
                    &[*left, *right],
                    700,
                );
            }
        }

        let ambiguous = sentence_packets
            .iter()
            .copied()
            .filter(|packet| {
                matches!(
                    packet.mention_kind,
                    MentionKind::Pronoun | MentionKind::Nominal
                )
            })
            .collect::<Vec<_>>();
        if !ambiguous.is_empty() {
            let mut nearby_entities = entities.clone();
            if nearby_entities.is_empty() {
                nearby_entities.extend(packets.iter().filter(|packet| {
                    packet.mention_kind == MentionKind::Named
                        && packet.sentence_index < sentence_index
                        && sentence_index.saturating_sub(packet.sentence_index) <= 1
                }));
            }
            if nearby_entities.is_empty() {
                continue;
            }
            let mut participants = nearby_entities;
            participants.extend(ambiguous);
            push_hint(
                drafts,
                ChunkHintKind::Relationship,
                ChunkHintSource::MentionWorkspace,
                covering_range(&participants),
                sentence_index,
                sentence_index + 1,
                &participants,
                610,
            );
        }
    }
}

fn add_graph_hints(
    drafts: &mut Vec<HintDraft>,
    packets: &[MentionPacket],
    mention_graph: &MentionGraph,
) {
    for edge in &mention_graph.edges {
        let Some(left) = packets.iter().find(|packet| packet.mention_id == edge.left) else {
            continue;
        };
        let Some(right) = packets
            .iter()
            .find(|packet| packet.mention_id == edge.right)
        else {
            continue;
        };
        match edge.kind {
            MentionEdgeKind::SameNormalizedSurface
            | MentionEdgeKind::KnownAliasMatch
            | MentionEdgeKind::FuzzyAliasMatch => {
                push_hint(
                    drafts,
                    ChunkHintKind::AliasIdentity,
                    ChunkHintSource::MentionGraph,
                    merge_ranges(left.range, right.range),
                    left.sentence_index.min(right.sentence_index),
                    left.sentence_index.max(right.sentence_index) + 1,
                    &[left, right],
                    680,
                );
            }
            MentionEdgeKind::PronounCandidate
            | MentionEdgeKind::DependencyCoreArgument
            | MentionEdgeKind::SpeakerContinuity => {
                push_hint(
                    drafts,
                    ChunkHintKind::Relationship,
                    ChunkHintSource::MentionGraph,
                    merge_ranges(left.range, right.range),
                    left.sentence_index.min(right.sentence_index),
                    left.sentence_index.max(right.sentence_index) + 1,
                    &[left, right],
                    640,
                );
            }
            MentionEdgeKind::Apposition
            | MentionEdgeKind::NearbyRepetition
            | MentionEdgeKind::ModelLabelCompatibility => {}
        }
    }
}

fn add_role_alias_dialogue_hints(
    drafts: &mut Vec<HintDraft>,
    text: &str,
    sentences: &[SentenceSpan],
    packets: &[MentionPacket],
) {
    for packet in packets {
        if packet.source_votes.iter().any(|vote| {
            matches!(
                vote.reason,
                VoteReason::TitlePattern | VoteReason::NominalRole
            )
        }) {
            push_hint(
                drafts,
                ChunkHintKind::RoleTitleAppositive,
                ChunkHintSource::NativeDiscovery,
                packet.range,
                packet.sentence_index,
                packet.sentence_index + 1,
                &[packet],
                590,
            );
        }
        if packet.source_votes.iter().any(|vote| {
            matches!(
                vote.reason,
                VoteReason::ExactAlias | VoteReason::AutoAlias | VoteReason::FuzzyAnchor
            )
        }) {
            push_hint(
                drafts,
                ChunkHintKind::AliasIdentity,
                ChunkHintSource::MentionWorkspace,
                packet.range,
                packet.sentence_index,
                packet.sentence_index + 1,
                &[packet],
                620,
            );
        }
        if packet
            .source_votes
            .iter()
            .any(|vote| vote.source == MentionSourceKind::ModelDiscovery)
        {
            let kind = if packet
                .label_distribution
                .iter()
                .any(|(label, _)| label.as_str().eq_ignore_ascii_case("event"))
            {
                ChunkHintKind::NamedEventCandidate
            } else {
                ChunkHintKind::EntityDenseRegion
            };
            push_hint(
                drafts,
                kind,
                ChunkHintSource::ModelDiscovery,
                packet.range,
                packet.sentence_index,
                packet.sentence_index + 1,
                &[packet],
                600,
            );
        }
        if packet.mention_kind == MentionKind::Named
            && sentence_for(sentences, packet.sentence_index)
                .is_some_and(|sentence| sentence_has_dialogue_cue(text, sentence))
        {
            push_hint(
                drafts,
                ChunkHintKind::DialogueSpeaker,
                ChunkHintSource::NativeDiscovery,
                packet.range,
                packet.sentence_index,
                packet.sentence_index + 1,
                &[packet],
                540,
            );
        }
    }
}

fn push_hint(
    drafts: &mut Vec<HintDraft>,
    kind: ChunkHintKind,
    source: ChunkHintSource,
    range: TextRange,
    sentence_start: u32,
    sentence_end: u32,
    packets: &[&MentionPacket],
    score_millis: u16,
) {
    if range.start >= range.end {
        return;
    }
    let mut mention_ids = packets
        .iter()
        .map(|packet| packet.mention_id.0)
        .collect::<Vec<_>>();
    mention_ids.sort_unstable();
    mention_ids.dedup();

    let mut surfaces = packets
        .iter()
        .map(|packet| packet.normalized.clone())
        .collect::<Vec<_>>();
    surfaces.sort();
    surfaces.dedup();

    drafts.push(HintDraft {
        kind,
        source,
        range,
        sentence_start,
        sentence_end,
        mention_ids,
        surfaces,
        score_millis,
    });
}

fn dedupe_and_sort(drafts: Vec<HintDraft>) -> Vec<ChunkHint> {
    let mut by_id = BTreeMap::<CompactString, ChunkHint>::new();
    for draft in drafts {
        let id = hint_id(&draft);
        let hint = ChunkHint {
            id: id.clone(),
            kind: draft.kind,
            source: draft.source,
            range: draft.range,
            sentence_start: draft.sentence_start,
            sentence_end: draft.sentence_end,
            mention_ids: draft.mention_ids,
            surfaces: draft.surfaces,
            score_millis: draft.score_millis,
        };
        by_id
            .entry(id)
            .and_modify(|existing| {
                if hint.score_millis > existing.score_millis {
                    existing.score_millis = hint.score_millis;
                    existing.source = hint.source;
                }
            })
            .or_insert(hint);
    }
    by_id.into_values().collect()
}

fn hint_id(draft: &HintDraft) -> CompactString {
    let mut key = format!(
        "{:?}:{}:{}:{}:{}",
        draft.kind, draft.range.start, draft.range.end, draft.sentence_start, draft.sentence_end
    );
    for surface in &draft.surfaces {
        key.push(':');
        key.push_str(surface.as_str());
    }
    CompactString::from(format!("chunk-hint-{:016x}", stable_hash(key.as_bytes())))
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

fn sentence_for(sentences: &[SentenceSpan], index: u32) -> Option<&SentenceSpan> {
    sentences
        .iter()
        .find(|sentence| sentence.index as u32 == index)
}

fn sentence_has_dialogue_cue(text: &str, sentence: &SentenceSpan) -> bool {
    let slice = safe_slice(text, sentence.range).to_ascii_lowercase();
    slice.contains('"')
        || slice.contains('\u{201c}')
        || slice.contains(" said")
        || slice.contains(" asked")
        || slice.contains(" replied")
        || slice.contains(" whispered")
        || slice.contains(" shouted")
}

fn sentence_contains_event_cue(text: &str, sentence: &SentenceSpan) -> bool {
    let slice = safe_slice(text, sentence.range).to_ascii_lowercase();
    EVENT_CUES.iter().any(|cue| slice.contains(cue))
}

const EVENT_CUES: &[&str] = &[
    " battle",
    " ceremony",
    " meeting",
    " attack",
    " rescue",
    " truce",
    " trial",
    " festival",
    " coronation",
    " arrived",
    " failed",
    " crossed",
    " sealed",
];

fn merge_ranges(left: TextRange, right: TextRange) -> TextRange {
    TextRange {
        start: left.start.min(right.start),
        end: left.end.max(right.end),
    }
}

fn covering_range(packets: &[&MentionPacket]) -> TextRange {
    let start = packets
        .iter()
        .map(|packet| packet.range.start)
        .min()
        .unwrap_or_default();
    let end = packets
        .iter()
        .map(|packet| packet.range.end)
        .max()
        .unwrap_or(start);
    TextRange { start, end }
}

fn safe_slice(text: &str, range: TextRange) -> &str {
    let start = (range.start as usize).min(text.len());
    let end = (range.end as usize).min(text.len());
    text.get(start..end).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::MentionGraphBuilder;
    use crate::types::{
        LocalMentionId, MentionContext, MentionSemantics, MentionSourceKind, MentionStatus,
        MentionVote,
    };
    use phoenix_types::MentionEntityRef;
    use smallvec::{smallvec, SmallVec};
    use std::collections::BTreeSet;

    fn packet(
        id: u64,
        surface: &str,
        start: u32,
        end: u32,
        sentence: u32,
        kind: MentionKind,
    ) -> MentionPacket {
        MentionPacket {
            mention_id: LocalMentionId(id),
            document_id: CompactString::from("doc"),
            chunk_id: None,
            sentence_index: sentence,
            range: TextRange { start, end },
            surface: CompactString::from(surface),
            normalized: CompactString::from(surface.to_ascii_lowercase()),
            mention_kind: kind,
            label_distribution: SmallVec::new(),
            entity_ref: Some(MentionEntityRef::Speculative(surface.to_ascii_lowercase())),
            source_votes: smallvec![MentionVote {
                source: MentionSourceKind::NativeDiscovery,
                label: None,
                entity_ref: None,
                confidence: 0.8,
                reason: VoteReason::CapSpan,
            }],
            context: MentionContext::default(),
            syntax: None,
            semantics: MentionSemantics::default(),
            confidence: 0.8,
            status: MentionStatus::AcceptedNew,
        }
    }

    #[test]
    fn dedupe_prevents_duplicate_hint_ids() {
        let text = "Aella met Kai.";
        let packets = vec![
            packet(1, "Aella", 0, 5, 0, MentionKind::Named),
            packet(2, "Kai", 10, 13, 0, MentionKind::Named),
        ];
        let graph = MentionGraphBuilder::build(&packets);
        let sentences = vec![SentenceSpan {
            index: 0,
            range: TextRange {
                start: 0,
                end: text.len() as u32,
            },
        }];
        let hints = build_chunk_hints(
            text,
            &sentences,
            &packets,
            &graph,
            &[NerNeedVector::default()],
        );
        let unique = hints
            .iter()
            .map(|hint| hint.id.clone())
            .collect::<BTreeSet<_>>();
        assert_eq!(unique.len(), hints.len());
    }
}
