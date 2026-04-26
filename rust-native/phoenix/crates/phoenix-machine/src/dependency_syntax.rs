use std::sync::OnceLock;

use phoenix_types::{
    ChunkKind, ChunkSpan, DependencyArcSpan, DependencyLabel, Diagnostic, PosTag, SentenceSpan,
    SentenceSyntax, SyntaxAttachment, TextRange, TokenSpan,
};
use rustc_hash::FxHashSet;
use scirs2_text::{ArcStandardParser, DepLabel, DependencyGraph};

pub(crate) struct ParsedSyntax {
    pub sentence_syntax: Vec<SentenceSyntax>,
    pub chunks: Vec<ChunkSpan>,
}

#[derive(Clone)]
struct PrepositionalProjection {
    preposition_local: usize,
    nominal_local: usize,
    anchor_local: usize,
    target_range: TextRange,
}

pub(crate) fn build_dependency_syntax(
    text: &str,
    tokens: &[TokenSpan],
    sentences: &[SentenceSpan],
) -> ParsedSyntax {
    let mut sentence_syntax = Vec::with_capacity(sentences.len());
    let mut chunks = Vec::with_capacity(tokens.len().saturating_mul(2));
    let mut token_start = 0usize;

    for sentence in sentences {
        while token_start < tokens.len() && tokens[token_start].range.end <= sentence.range.start {
            token_start += 1;
        }
        let mut token_end = token_start;
        while token_end < tokens.len() && tokens[token_end].range.start < sentence.range.end {
            token_end += 1;
        }

        if token_start >= token_end {
            sentence_syntax.push(SentenceSyntax {
                sentence_index: sentence.index,
                clause_ranges: vec![sentence.range],
                ..SentenceSyntax::default()
            });
            continue;
        }

        let sentence_token_indexes = (token_start..token_end)
            .filter(|index| !matches!(tokens[*index].pos, Some(PosTag::Punctuation)))
            .collect::<Vec<_>>();
        if sentence_token_indexes.is_empty() {
            sentence_syntax.push(SentenceSyntax {
                sentence_index: sentence.index,
                clause_ranges: vec![sentence.range],
                ..SentenceSyntax::default()
            });
            token_start = token_end;
            continue;
        }

        let surfaces = sentence_token_indexes
            .iter()
            .map(|index| super::slice_or_empty(text, tokens[*index].range).to_owned())
            .collect::<Vec<_>>();
        let pos_tags = sentence_token_indexes
            .iter()
            .map(|index| map_pos_tag(tokens[*index].pos.as_ref()).to_owned())
            .collect::<Vec<_>>();
        let graph = dependency_parser().parse(&surfaces, &pos_tags);
        let syntax = build_sentence_syntax(text, tokens, sentence, &sentence_token_indexes, &graph);
        chunks.extend(project_chunks(
            tokens,
            sentence,
            &sentence_token_indexes,
            &graph,
            &syntax,
        ));
        sentence_syntax.push(syntax);
        token_start = token_end;
    }

    chunks.sort_by_key(|chunk| {
        (
            chunk.sentence_index,
            chunk.range.start,
            chunk.range.end,
            chunk_kind_rank(chunk.kind.as_ref()),
        )
    });
    chunks.dedup_by(|left, right| left.kind == right.kind && left.range == right.range);

    ParsedSyntax {
        sentence_syntax,
        chunks,
    }
}

fn dependency_parser() -> &'static ArcStandardParser {
    static PARSER: OnceLock<ArcStandardParser> = OnceLock::new();
    PARSER.get_or_init(ArcStandardParser::new)
}

fn build_sentence_syntax(
    text: &str,
    tokens: &[TokenSpan],
    sentence: &SentenceSpan,
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
) -> SentenceSyntax {
    let arcs = graph
        .arcs
        .iter()
        .map(|arc| {
            let dependent_index = sentence_token_indexes[arc.dependent.saturating_sub(1)];
            let head_index = arc
                .head
                .checked_sub(1)
                .map(|local| sentence_token_indexes[local])
                .filter(|_| arc.head != 0);
            DependencyArcSpan {
                head_token_index: head_index,
                dependent_token_index: dependent_index,
                head_range: head_index.map(|index| tokens[index].range),
                dependent_range: tokens[dependent_index].range,
                label: Some(map_dep_label(&arc.label)),
                confidence: arc.score as f32,
            }
        })
        .collect::<Vec<_>>();
    let root_token_index = graph
        .arcs
        .iter()
        .find(|arc| arc.head == 0)
        .map(|arc| sentence_token_indexes[arc.dependent.saturating_sub(1)]);
    let clause_ranges = derive_clause_ranges(tokens, sentence, sentence_token_indexes, graph);
    let attachments = derive_syntax_attachments(text, tokens, sentence_token_indexes, graph);
    let mut diagnostics = Vec::new();
    if root_token_index.is_none() {
        diagnostics.push(Diagnostic {
            code: "PX_MACHINE_SYNTAX_ROOT_GAP".to_owned(),
            message: "Dependency parser returned no explicit root token.".to_owned(),
        });
    }
    if !graph.is_projective() {
        diagnostics.push(Diagnostic {
            code: "PX_MACHINE_SYNTAX_NON_PROJECTIVE".to_owned(),
            message: "Dependency parse contains a non-projective arc crossing.".to_owned(),
        });
    }

    SentenceSyntax {
        sentence_index: sentence.index,
        root_token_index,
        arcs,
        clause_ranges,
        attachments,
        diagnostics,
    }
}

fn derive_clause_ranges(
    tokens: &[TokenSpan],
    sentence: &SentenceSpan,
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
) -> Vec<TextRange> {
    let mut ranges = vec![sentence.range];
    for local in 1..=graph.n_tokens {
        if !is_clause_head(tokens, sentence_token_indexes, graph, local) {
            continue;
        }
        if let Some(range) = subtree_range(
            tokens,
            sentence_token_indexes,
            graph,
            local,
            include_clause_child,
        ) {
            ranges.push(range);
        }
    }
    ranges.sort_by_key(|range| (range.start, range.end));
    ranges.dedup();
    ranges
}

fn derive_syntax_attachments(
    text: &str,
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
) -> Vec<SyntaxAttachment> {
    let mut attachments = collect_prepositional_projections(tokens, sentence_token_indexes, graph)
        .into_iter()
        .map(|projection| SyntaxAttachment {
            anchor_range: tokens[sentence_token_indexes[projection.anchor_local - 1]].range,
            target_range: projection.target_range,
            label: super::slice_or_empty(
                text,
                tokens[sentence_token_indexes[projection.preposition_local - 1]].range,
            )
            .to_ascii_lowercase(),
        })
        .collect::<Vec<_>>();
    attachments.sort_by(|left, right| {
        (
            left.anchor_range.start,
            left.anchor_range.end,
            left.target_range.start,
            left.target_range.end,
            left.label.as_str(),
        )
            .cmp(&(
                right.anchor_range.start,
                right.anchor_range.end,
                right.target_range.start,
                right.target_range.end,
                right.label.as_str(),
            ))
    });
    attachments.dedup_by(|left, right| {
        left.anchor_range == right.anchor_range
            && left.target_range == right.target_range
            && left.label == right.label
    });
    attachments
}

fn project_chunks(
    tokens: &[TokenSpan],
    sentence: &SentenceSpan,
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
    syntax: &SentenceSyntax,
) -> Vec<ChunkSpan> {
    let mut chunks = Vec::new();

    for local in 1..=graph.n_tokens {
        if is_nominal_head(tokens, sentence_token_indexes, graph, local) {
            let locals = collect_phrase_locals(graph, local, include_nominal_child);
            if let Some(range) = range_from_locals(tokens, sentence_token_indexes, &locals) {
                chunks.push(ChunkSpan {
                    kind: Some(ChunkKind::Np),
                    range,
                    head: tokens[sentence_token_indexes[local - 1]].range,
                    modifiers: locals
                        .iter()
                        .copied()
                        .filter(|candidate| *candidate != local)
                        .map(|candidate| tokens[sentence_token_indexes[candidate - 1]].range)
                        .collect(),
                    sentence_index: sentence.index,
                });
            }
        }

        if is_verb_head(tokens, sentence_token_indexes, graph, local) {
            let locals = collect_phrase_locals(graph, local, include_verbal_child);
            if let Some(range) = range_from_locals(tokens, sentence_token_indexes, &locals) {
                chunks.push(ChunkSpan {
                    kind: Some(ChunkKind::Vp),
                    range,
                    head: tokens[sentence_token_indexes[local - 1]].range,
                    modifiers: locals
                        .iter()
                        .copied()
                        .filter(|candidate| *candidate != local)
                        .map(|candidate| tokens[sentence_token_indexes[candidate - 1]].range)
                        .collect(),
                    sentence_index: sentence.index,
                });
            }
        }

        if is_adjective_head(tokens, sentence_token_indexes, graph, local) {
            let locals = collect_phrase_locals(graph, local, include_adjective_child);
            if let Some(range) = range_from_locals(tokens, sentence_token_indexes, &locals) {
                chunks.push(ChunkSpan {
                    kind: Some(ChunkKind::AdjP),
                    range,
                    head: tokens[sentence_token_indexes[local - 1]].range,
                    modifiers: locals
                        .iter()
                        .copied()
                        .filter(|candidate| *candidate != local)
                        .map(|candidate| tokens[sentence_token_indexes[candidate - 1]].range)
                        .collect(),
                    sentence_index: sentence.index,
                });
            }
        }
    }

    for projection in collect_prepositional_projections(tokens, sentence_token_indexes, graph) {
        let mut locals =
            collect_phrase_locals(graph, projection.nominal_local, include_nominal_child);
        locals.push(projection.preposition_local);
        locals.sort_unstable();
        locals.dedup();
        chunks.push(ChunkSpan {
            kind: Some(ChunkKind::Pp),
            range: projection.target_range,
            head: tokens[sentence_token_indexes[projection.preposition_local - 1]].range,
            modifiers: locals
                .iter()
                .copied()
                .filter(|candidate| *candidate != projection.preposition_local)
                .map(|candidate| tokens[sentence_token_indexes[candidate - 1]].range)
                .collect(),
            sentence_index: sentence.index,
        });
    }

    let clause_head = syntax
        .root_token_index
        .map(|index| tokens[index].range)
        .unwrap_or(sentence.range);
    chunks.extend(syntax.clause_ranges.iter().copied().map(|range| ChunkSpan {
        kind: Some(ChunkKind::Clause),
        range,
        head: clause_head,
        modifiers: Vec::new(),
        sentence_index: sentence.index,
    }));
    chunks
}

fn collect_prepositional_projections(
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
) -> Vec<PrepositionalProjection> {
    let mut projections = Vec::new();
    for local in 1..=graph.n_tokens {
        if tokens[sentence_token_indexes[local - 1]].pos != Some(PosTag::Preposition) {
            continue;
        }

        let label = graph.label_of(local);
        let head = graph.head_of(local).filter(|head| *head != 0);
        let (nominal_local, anchor_local) = if matches!(label, Some(DepLabel::Case)) {
            let Some(nominal_local) = head else {
                continue;
            };
            let anchor_local = graph
                .head_of(nominal_local)
                .filter(|candidate| *candidate != 0)
                .unwrap_or(nominal_local);
            (nominal_local, anchor_local)
        } else if let Some(nominal_local) =
            graph.dependents_of(local).into_iter().find(|candidate| {
                is_nominal_projection_target(tokens, sentence_token_indexes, *candidate)
            })
        {
            let anchor_local = head.unwrap_or(local);
            (nominal_local, anchor_local)
        } else if let Some(nominal_local) = head.filter(|candidate| {
            is_nominal_projection_target(tokens, sentence_token_indexes, *candidate)
        }) {
            let anchor_local = graph
                .head_of(nominal_local)
                .filter(|candidate| *candidate != 0)
                .unwrap_or(nominal_local);
            (nominal_local, anchor_local)
        } else {
            continue;
        };

        let mut locals = collect_phrase_locals(graph, nominal_local, include_nominal_child);
        locals.push(local);
        locals.sort_unstable();
        locals.dedup();
        let Some(target_range) = range_from_locals(tokens, sentence_token_indexes, &locals) else {
            continue;
        };
        projections.push(PrepositionalProjection {
            preposition_local: local,
            nominal_local,
            anchor_local,
            target_range,
        });
    }
    projections.sort_by_key(|projection| {
        (
            projection.anchor_local,
            projection.target_range.start,
            projection.target_range.end,
            projection.preposition_local,
        )
    });
    projections.dedup_by(|left, right| {
        left.preposition_local == right.preposition_local
            && left.nominal_local == right.nominal_local
            && left.anchor_local == right.anchor_local
            && left.target_range == right.target_range
    });
    projections
}

fn collect_phrase_locals(
    graph: &DependencyGraph,
    root_local: usize,
    include_child: fn(&DependencyGraph, usize, usize) -> bool,
) -> Vec<usize> {
    let mut seen = FxHashSet::default();
    let mut stack = vec![root_local];
    let mut locals = Vec::new();
    while let Some(local) = stack.pop() {
        if !seen.insert(local) {
            continue;
        }
        locals.push(local);
        for child in graph.dependents_of(local) {
            if include_child(graph, local, child) {
                stack.push(child);
            }
        }
    }
    locals.sort_unstable();
    locals
}

fn range_from_locals(
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    locals: &[usize],
) -> Option<TextRange> {
    let start = locals
        .iter()
        .filter_map(|local| {
            sentence_token_indexes
                .get(local - 1)
                .and_then(|index| tokens.get(*index))
        })
        .map(|token| token.range.start)
        .min()?;
    let end = locals
        .iter()
        .filter_map(|local| {
            sentence_token_indexes
                .get(local - 1)
                .and_then(|index| tokens.get(*index))
        })
        .map(|token| token.range.end)
        .max()?;
    Some(TextRange { start, end })
}

fn subtree_range(
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
    root_local: usize,
    include_child: fn(&DependencyGraph, usize, usize) -> bool,
) -> Option<TextRange> {
    let locals = collect_phrase_locals(graph, root_local, include_child);
    range_from_locals(tokens, sentence_token_indexes, &locals)
}

fn is_clause_head(
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
    local: usize,
) -> bool {
    matches!(
        tokens[sentence_token_indexes[local - 1]].pos,
        Some(PosTag::Verb | PosTag::Auxiliary | PosTag::Modal)
    ) && !matches!(graph.label_of(local), Some(DepLabel::Aux))
}

fn is_nominal_head(
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
    local: usize,
) -> bool {
    matches!(
        tokens[sentence_token_indexes[local - 1]].pos,
        Some(PosTag::Noun | PosTag::Pronoun | PosTag::ProperNoun)
    ) && !matches!(
        graph.label_of(local),
        Some(DepLabel::Det | DepLabel::Amod | DepLabel::Case | DepLabel::Punct)
    )
}

fn is_verb_head(
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
    local: usize,
) -> bool {
    matches!(
        tokens[sentence_token_indexes[local - 1]].pos,
        Some(PosTag::Verb | PosTag::Auxiliary | PosTag::Modal)
    ) && !matches!(graph.label_of(local), Some(DepLabel::Aux))
}

fn is_adjective_head(
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    graph: &DependencyGraph,
    local: usize,
) -> bool {
    matches!(
        tokens[sentence_token_indexes[local - 1]].pos,
        Some(PosTag::Adjective)
    ) && !matches!(graph.label_of(local), Some(DepLabel::Amod))
}

fn is_nominal_projection_target(
    tokens: &[TokenSpan],
    sentence_token_indexes: &[usize],
    local: usize,
) -> bool {
    matches!(
        tokens[sentence_token_indexes[local - 1]].pos,
        Some(PosTag::Noun | PosTag::Pronoun | PosTag::ProperNoun)
    )
}

fn include_nominal_child(graph: &DependencyGraph, _parent: usize, child: usize) -> bool {
    matches!(
        graph.label_of(child),
        Some(
            DepLabel::Det
                | DepLabel::Amod
                | DepLabel::Nmod
                | DepLabel::Case
                | DepLabel::Conj
                | DepLabel::Cc
                | DepLabel::Dep
        )
    )
}

fn include_verbal_child(graph: &DependencyGraph, _parent: usize, child: usize) -> bool {
    matches!(
        graph.label_of(child),
        Some(
            DepLabel::Aux
                | DepLabel::Advmod
                | DepLabel::Mark
                | DepLabel::Conj
                | DepLabel::Cc
                | DepLabel::Dep
        )
    )
}

fn include_adjective_child(graph: &DependencyGraph, _parent: usize, child: usize) -> bool {
    matches!(
        graph.label_of(child),
        Some(DepLabel::Advmod | DepLabel::Dep)
    )
}

fn include_clause_child(graph: &DependencyGraph, _parent: usize, child: usize) -> bool {
    !matches!(graph.label_of(child), Some(DepLabel::Punct | DepLabel::Cc))
}

fn map_pos_tag(tag: Option<&PosTag>) -> &'static str {
    match tag {
        Some(PosTag::Noun) => "NOUN",
        Some(PosTag::Pronoun) => "PRON",
        Some(PosTag::ProperNoun) => "PROPN",
        Some(PosTag::Verb) => "VERB",
        Some(PosTag::Auxiliary) => "AUX",
        Some(PosTag::Modal) => "AUX",
        Some(PosTag::Adjective) => "ADJ",
        Some(PosTag::Adverb) => "ADV",
        Some(PosTag::Determiner) => "DET",
        Some(PosTag::Preposition) => "ADP",
        Some(PosTag::Conjunction) => "CCONJ",
        Some(PosTag::RelativePronoun) => "SCONJ",
        Some(PosTag::Punctuation) => "PUNCT",
        Some(PosTag::Other) | None => "X",
    }
}

fn map_dep_label(label: &DepLabel) -> DependencyLabel {
    match label {
        DepLabel::Root => DependencyLabel::Root,
        DepLabel::Subj => DependencyLabel::Subject,
        DepLabel::Obj => DependencyLabel::Object,
        DepLabel::Iobj => DependencyLabel::IndirectObject,
        DepLabel::Csubj => DependencyLabel::ClausalSubject,
        DepLabel::Ccomp => DependencyLabel::ClausalComplement,
        DepLabel::Xcomp => DependencyLabel::OpenClausalComplement,
        DepLabel::Nmod => DependencyLabel::NominalModifier,
        DepLabel::Amod => DependencyLabel::AdjectivalModifier,
        DepLabel::Advmod => DependencyLabel::AdverbialModifier,
        DepLabel::Aux => DependencyLabel::Auxiliary,
        DepLabel::Det => DependencyLabel::Determiner,
        DepLabel::Case => DependencyLabel::CaseMarker,
        DepLabel::Punct => DependencyLabel::Punctuation,
        DepLabel::Conj => DependencyLabel::Conjunct,
        DepLabel::Cc => DependencyLabel::CoordinatingConjunction,
        DepLabel::Mark => DependencyLabel::Marker,
        DepLabel::Dep => DependencyLabel::Other("dep".to_owned()),
        DepLabel::Other(value) => DependencyLabel::Other(value.clone()),
    }
}

fn chunk_kind_rank(kind: Option<&ChunkKind>) -> u8 {
    match kind {
        Some(ChunkKind::Clause) => 0,
        Some(ChunkKind::Np) => 1,
        Some(ChunkKind::Vp) => 2,
        Some(ChunkKind::Pp) => 3,
        Some(ChunkKind::AdjP) => 4,
        None => 5,
    }
}
