use std::ops::Range;
use std::sync::OnceLock;

use phoenix_types::{PosTag, SentenceSpan, TokenClass, TokenSpan};
use rustling::perceptron_pos_tagger::{AveragedPerceptron, BaseTagger};

use crate::TokenizedDocument;

const TAG_NOUN: &str = "NOUN";
const TAG_PRON: &str = "PRON";
const TAG_PROPN: &str = "PROPN";
const TAG_VERB: &str = "VERB";
const TAG_AUX: &str = "AUX";
const TAG_MODAL: &str = "MODAL";
const TAG_ADJ: &str = "ADJ";
const TAG_ADV: &str = "ADV";
const TAG_DET: &str = "DET";
const TAG_ADP: &str = "ADP";
const TAG_CONJ: &str = "CONJ";
const TAG_REL: &str = "REL";
const TAG_PUNCT: &str = "PUNCT";

pub(crate) fn retag_with_rustling_pos(
    text: &str,
    tokenized: &mut TokenizedDocument,
    sentences: &[SentenceSpan],
) {
    if tokenized.tokens.is_empty() || sentences.is_empty() {
        return;
    }

    let runs = sentence_token_runs(&tokenized.tokens, sentences);
    if runs.is_empty() {
        return;
    }

    let mut sequences = Vec::with_capacity(runs.len());
    for run in &runs {
        let mut words = Vec::with_capacity(run.end - run.start);
        for index in run.clone() {
            words.push(crate::slice_or_empty(text, tokenized.tokens[index].range).to_owned());
        }
        sequences.push(words);
    }

    for (run, predicted) in runs
        .into_iter()
        .zip(rustling_pos_tagger().predict(sequences))
    {
        if predicted.len() != run.end - run.start {
            continue;
        }
        for (offset, tag) in predicted.iter().enumerate() {
            let index = run.start + offset;
            if let Some(next) = merge_pos_tag(
                &tokenized.tokens,
                &tokenized.normalized_tokens,
                index,
                tag.as_str(),
            ) {
                tokenized.tokens[index].pos = Some(next);
            }
        }
    }
}

fn rustling_pos_tagger() -> &'static AveragedPerceptron {
    static TAGGER: OnceLock<AveragedPerceptron> = OnceLock::new();
    TAGGER.get_or_init(build_rustling_pos_tagger)
}

fn build_rustling_pos_tagger() -> AveragedPerceptron {
    let mut tagger = AveragedPerceptron::new(1, 0.97, 8, Some(0x5048_4f45_4e49_5825), None);
    if let Ok(path) = std::env::var("PHOENIX_RUSTLING_POS_MODEL") {
        if !path.trim().is_empty() && tagger.load_from_path(path.trim()).is_ok() {
            return tagger;
        }
    }

    let (sequences, tags) = rustling_seed_corpus();
    tagger.fit(sequences, tags);
    tagger
}

fn sentence_token_runs(tokens: &[TokenSpan], sentences: &[SentenceSpan]) -> Vec<Range<usize>> {
    let mut runs = Vec::with_capacity(sentences.len());
    let mut token_start = 0usize;
    for sentence in sentences {
        while token_start < tokens.len() && tokens[token_start].range.end <= sentence.range.start {
            token_start += 1;
        }
        let mut token_end = token_start;
        while token_end < tokens.len() && tokens[token_end].range.start < sentence.range.end {
            token_end += 1;
        }
        if token_start < token_end {
            runs.push(token_start..token_end);
        }
        token_start = token_end;
    }
    runs
}

fn merge_pos_tag(
    tokens: &[TokenSpan],
    normalized_tokens: &[String],
    index: usize,
    predicted: &str,
) -> Option<PosTag> {
    let token = tokens.get(index)?;
    if token.token_class == Some(TokenClass::Punctuation) {
        return Some(PosTag::Punctuation);
    }

    let predicted = map_rustling_tag(predicted)?;
    let current = token.pos.clone().unwrap_or(PosTag::Other);
    if predicted == current {
        return Some(current);
    }

    let normalized = normalized_tokens
        .get(index)
        .map(String::as_str)
        .unwrap_or("");
    let lexical_verb_surface = is_lexical_verb_surface(normalized);
    if preserves_hard_lexical_tag(&current, normalized) {
        return Some(current);
    }

    let previous = index
        .checked_sub(1)
        .and_then(|slot| tokens.get(slot))
        .and_then(|value| value.pos.as_ref());
    let next = tokens.get(index + 1).and_then(|value| value.pos.as_ref());

    match predicted {
        PosTag::Noun => {
            if current == PosTag::Verb
                && lexical_verb_surface
                && previous != Some(&PosTag::Determiner)
            {
                return Some(current);
            }
            if matches!(
                current,
                PosTag::Other
                    | PosTag::Verb
                    | PosTag::Auxiliary
                    | PosTag::Modal
                    | PosTag::Adjective
                    | PosTag::ProperNoun
            ) || previous == Some(&PosTag::Determiner)
            {
                Some(PosTag::Noun)
            } else {
                Some(current)
            }
        }
        PosTag::ProperNoun => Some(PosTag::ProperNoun),
        PosTag::Verb => {
            if current == PosTag::ProperNoun && token.capitalized && !lexical_verb_surface {
                return Some(current);
            }
            if matches!(
                current,
                PosTag::Other | PosTag::Noun | PosTag::ProperNoun | PosTag::Adjective
            ) || matches!(previous, Some(&PosTag::Auxiliary | &PosTag::Modal))
            {
                Some(PosTag::Verb)
            } else {
                Some(current)
            }
        }
        PosTag::Adjective => {
            if current == PosTag::Verb
                && lexical_verb_surface
                && previous != Some(&PosTag::Determiner)
            {
                return Some(current);
            }
            if matches!(
                current,
                PosTag::Other | PosTag::Noun | PosTag::Verb | PosTag::ProperNoun
            ) && (previous == Some(&PosTag::Determiner)
                || matches!(next, Some(&PosTag::Noun | &PosTag::ProperNoun)))
            {
                Some(PosTag::Adjective)
            } else {
                Some(current)
            }
        }
        PosTag::Adverb => {
            if matches!(current, PosTag::Other | PosTag::Noun | PosTag::Adjective) {
                Some(PosTag::Adverb)
            } else {
                Some(current)
            }
        }
        PosTag::Auxiliary | PosTag::Modal => {
            if current == PosTag::Verb && lexical_verb_surface && !is_hard_modal_surface(normalized)
            {
                return Some(current);
            }
            if matches!(current, PosTag::Other | PosTag::Noun | PosTag::Verb) {
                Some(predicted)
            } else {
                Some(current)
            }
        }
        _ => Some(predicted),
    }
}

fn preserves_hard_lexical_tag(current: &PosTag, normalized: &str) -> bool {
    if is_hard_modal_surface(normalized) {
        return false;
    }
    matches!(
        current,
        PosTag::Pronoun
            | PosTag::Determiner
            | PosTag::Preposition
            | PosTag::Conjunction
            | PosTag::RelativePronoun
            | PosTag::Punctuation
    )
}

fn is_hard_modal_surface(normalized: &str) -> bool {
    matches!(
        normalized,
        "can" | "could" | "may" | "might" | "will" | "would" | "should" | "must"
    )
}

fn is_lexical_verb_surface(normalized: &str) -> bool {
    super::is_verb_token(normalized)
        || normalized.ends_with("ed")
        || normalized.ends_with("ing")
        || matches!(
            normalized,
            "left" | "met" | "built" | "felt" | "led" | "told" | "said"
        )
}

fn map_rustling_tag(tag: &str) -> Option<PosTag> {
    match tag {
        TAG_NOUN => Some(PosTag::Noun),
        TAG_PRON => Some(PosTag::Pronoun),
        TAG_PROPN => Some(PosTag::ProperNoun),
        TAG_VERB => Some(PosTag::Verb),
        TAG_AUX => Some(PosTag::Auxiliary),
        TAG_MODAL => Some(PosTag::Modal),
        TAG_ADJ => Some(PosTag::Adjective),
        TAG_ADV => Some(PosTag::Adverb),
        TAG_DET => Some(PosTag::Determiner),
        TAG_ADP => Some(PosTag::Preposition),
        TAG_CONJ => Some(PosTag::Conjunction),
        TAG_REL => Some(PosTag::RelativePronoun),
        TAG_PUNCT => Some(PosTag::Punctuation),
        _ => None,
    }
}

fn rustling_seed_corpus() -> (Vec<Vec<String>>, Vec<Vec<String>>) {
    let rows = [
        &[
            ("Luffy", TAG_PROPN),
            ("held", TAG_VERB),
            ("the", TAG_DET),
            ("map", TAG_NOUN),
            (".", TAG_PUNCT),
        ][..],
        &[
            ("Nami", TAG_PROPN),
            ("can", TAG_MODAL),
            ("chart", TAG_VERB),
            ("the", TAG_DET),
            ("route", TAG_NOUN),
            (".", TAG_PUNCT),
        ],
        &[
            ("The", TAG_DET),
            ("can", TAG_NOUN),
            ("rusted", TAG_VERB),
            ("near", TAG_ADP),
            ("the", TAG_DET),
            ("door", TAG_NOUN),
            (".", TAG_PUNCT),
        ],
        &[
            ("The", TAG_DET),
            ("left", TAG_ADJ),
            ("door", TAG_NOUN),
            ("opened", TAG_VERB),
            (".", TAG_PUNCT),
        ],
        &[
            ("Zoro", TAG_PROPN),
            ("left", TAG_VERB),
            ("the", TAG_DET),
            ("harbor", TAG_NOUN),
            (".", TAG_PUNCT),
        ],
        &[
            ("The", TAG_DET),
            ("watch", TAG_NOUN),
            ("broke", TAG_VERB),
            (".", TAG_PUNCT),
        ],
        &[
            ("Sanji", TAG_PROPN),
            ("will", TAG_MODAL),
            ("cook", TAG_VERB),
            ("dinner", TAG_NOUN),
            (".", TAG_PUNCT),
        ],
        &[
            ("The", TAG_DET),
            ("will", TAG_NOUN),
            ("changed", TAG_VERB),
            ("quickly", TAG_ADV),
            (".", TAG_PUNCT),
        ],
        &[
            ("The", TAG_DET),
            ("silent", TAG_ADJ),
            ("guard", TAG_NOUN),
            ("watched", TAG_VERB),
            ("carefully", TAG_ADV),
            (".", TAG_PUNCT),
        ],
        &[
            ("Robin", TAG_PROPN),
            ("was", TAG_AUX),
            ("quietly", TAG_ADV),
            ("reading", TAG_VERB),
            (".", TAG_PUNCT),
        ],
        &[
            ("Who", TAG_REL),
            ("carried", TAG_VERB),
            ("the", TAG_DET),
            ("lantern", TAG_NOUN),
            ("?", TAG_PUNCT),
        ],
        &[
            ("Usopp", TAG_PROPN),
            ("and", TAG_CONJ),
            ("Franky", TAG_PROPN),
            ("built", TAG_VERB),
            ("a", TAG_DET),
            ("bridge", TAG_NOUN),
            (".", TAG_PUNCT),
        ],
        &[
            ("The", TAG_DET),
            ("old", TAG_ADJ),
            ("engine", TAG_NOUN),
            ("could", TAG_MODAL),
            ("fail", TAG_VERB),
            (".", TAG_PUNCT),
        ],
        &[
            ("They", TAG_PRON),
            ("have", TAG_AUX),
            ("already", TAG_ADV),
            ("found", TAG_VERB),
            ("evidence", TAG_NOUN),
            (".", TAG_PUNCT),
        ],
    ];

    let mut sequences = Vec::with_capacity(rows.len());
    let mut tags = Vec::with_capacity(rows.len());
    for row in rows {
        sequences.push(row.iter().map(|(word, _)| (*word).to_owned()).collect());
        tags.push(row.iter().map(|(_, tag)| (*tag).to_owned()).collect());
    }
    (sequences, tags)
}
