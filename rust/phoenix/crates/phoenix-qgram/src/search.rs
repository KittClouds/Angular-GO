use std::collections::BTreeMap;

use phoenix_types::{
    Diagnostic, ImplicitMatchHit, IndexedSpan, LexicalField, LexicalSearchResult, ScopeKey, SpanHit,
};

use crate::catalog::{SpanCatalog, SpanOrdinal};
use crate::grams::{extract_packed_grams, PackedGram};
use crate::implicit::match_implicit as match_implicit_impl;
use crate::postings::PostingSet;
use crate::query::{parse_query, Clause, ClauseType};
use crate::verifier::{PatternMatch, QueryVerifier};

#[derive(Clone, Debug)]
pub struct SearchConfig {
    pub k1: f64,
    pub b: f64,
    pub field_weights: BTreeMap<LexicalField, f64>,
    pub coverage_lambda: f64,
    pub coverage_epsilon: f64,
    pub phrase_hard: bool,
    pub proximity_alpha: f64,
    pub proximity_decay: f64,
    pub max_segments: u32,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            k1: 1.2,
            b: 0.75,
            field_weights: BTreeMap::new(),
            coverage_lambda: 3.0,
            coverage_epsilon: 0.1,
            phrase_hard: true,
            proximity_alpha: 0.5,
            proximity_decay: 0.1,
            max_segments: 32,
        }
    }
}

#[derive(Clone, Debug)]
pub struct QgramConfig {
    pub trigram_width: usize,
    pub bigram_width: usize,
    pub bitmap_threshold: usize,
    pub max_clause_candidates: usize,
    pub search: SearchConfig,
}

impl Default for QgramConfig {
    fn default() -> Self {
        Self {
            trigram_width: 3,
            bigram_width: 2,
            bitmap_threshold: 256,
            max_clause_candidates: 256,
            search: SearchConfig::default(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct QgramIndex {
    config: QgramConfig,
    catalog: SpanCatalog,
    trigram_postings: BTreeMap<PackedGram, PostingSet>,
    bigram_postings: BTreeMap<PackedGram, PostingSet>,
}

impl QgramIndex {
    pub fn build(spans: &[IndexedSpan], config: QgramConfig) -> Self {
        let catalog = SpanCatalog::build(spans);
        let mut index = Self {
            config,
            catalog,
            trigram_postings: BTreeMap::new(),
            bigram_postings: BTreeMap::new(),
        };
        index.reindex();
        index
    }

    pub fn rebuild_from_catalog(&mut self, spans: &[IndexedSpan]) {
        self.catalog = SpanCatalog::build(spans);
        self.reindex();
    }

    pub fn search(&self, query: &str, scope: &ScopeKey, limit: usize) -> LexicalSearchResult {
        let clauses = parse_query(query);
        if clauses.is_empty() {
            return LexicalSearchResult {
                span_hits: Vec::new(),
                diagnostics: vec![Diagnostic {
                    code: "PX_QGRAM_EMPTY_QUERY".to_owned(),
                    message: "No searchable clauses were produced from the query.".to_owned(),
                }],
            };
        }

        let verifier = QueryVerifier::new(&clauses);
        let mut candidate_clause_counts = BTreeMap::<u32, usize>::new();
        let clause_dfs = clauses
            .iter()
            .map(|clause| {
                let candidates = self.clause_candidates(clause, scope);
                for ordinal in &candidates {
                    *candidate_clause_counts.entry(*ordinal).or_insert(0) += 1;
                }
                candidates.len()
            })
            .collect::<Vec<_>>();

        let mut candidate_ordinals = candidate_clause_counts.into_iter().collect::<Vec<_>>();
        candidate_ordinals
            .sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));

        let idfs = self.clause_idfs(&clauses, &clause_dfs);
        let mut span_hits = Vec::new();

        for (ordinal, _) in candidate_ordinals {
            let (matches, matched_count) =
                verifier.verify_span(&self.catalog, SpanOrdinal(ordinal));
            if matched_count == 0 {
                continue;
            }
            if self.config.search.phrase_hard
                && clauses.iter().enumerate().any(|(index, clause)| {
                    clause.clause_type == ClauseType::Phrase
                        && matches.get(index).and_then(Option::as_ref).is_none()
                })
            {
                continue;
            }

            let score = self.score_span(&matches, matched_count, &idfs);
            let Some(span) = self.catalog.span(SpanOrdinal(ordinal)) else {
                continue;
            };
            span_hits.push(SpanHit {
                span_id: span.span_id.clone(),
                note_id: span.note_id.clone(),
                document_id: span.document_id.clone(),
                score,
                coverage: matched_count as f32 / clauses.len() as f32,
            });
        }

        span_hits.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.span_id.cmp(&right.span_id))
        });
        if limit > 0 && span_hits.len() > limit {
            span_hits.truncate(limit);
        }

        LexicalSearchResult {
            span_hits,
            diagnostics: vec![Diagnostic {
                code: "PX_QGRAM_OK".to_owned(),
                message: "Qgram lexical search completed.".to_owned(),
            }],
        }
    }

    pub fn match_implicit(
        &self,
        text: &str,
        scope: &ScopeKey,
        lexicon: &phoenix_alex::Lexicon,
    ) -> Vec<ImplicitMatchHit> {
        match_implicit_impl(text, scope, lexicon)
    }

    fn reindex(&mut self) {
        self.trigram_postings.clear();
        self.bigram_postings.clear();

        for ordinal in 0..self.catalog.len() as u32 {
            let Some(span) = self.catalog.span(SpanOrdinal(ordinal)) else {
                continue;
            };
            for field in &span.fields {
                let normalized = self.catalog.field_text(field);
                for gram in extract_packed_grams(normalized, self.config.trigram_width) {
                    self.trigram_postings
                        .entry(gram)
                        .or_default()
                        .add(ordinal, self.config.bitmap_threshold);
                }
                for gram in extract_packed_grams(normalized, self.config.bigram_width) {
                    self.bigram_postings
                        .entry(gram)
                        .or_default()
                        .add(ordinal, self.config.bitmap_threshold);
                }
            }
        }
    }

    fn clause_candidates(&self, clause: &Clause, scope: &ScopeKey) -> Vec<u32> {
        match clause.pattern.len() {
            0 => Vec::new(),
            1 => self.catalog.filtered_ordinals(scope),
            2 => self.candidates_for_grams(
                &extract_packed_grams(&clause.pattern, self.config.bigram_width),
                &self.bigram_postings,
                scope,
            ),
            _ => self.candidates_for_grams(
                &extract_packed_grams(&clause.pattern, self.config.trigram_width),
                &self.trigram_postings,
                scope,
            ),
        }
    }

    fn candidates_for_grams(
        &self,
        grams: &[PackedGram],
        postings: &BTreeMap<PackedGram, PostingSet>,
        scope: &ScopeKey,
    ) -> Vec<u32> {
        if grams.is_empty() {
            return self.catalog.filtered_ordinals(scope);
        }

        let mut gram_postings = grams
            .iter()
            .filter_map(|gram| postings.get(gram).map(|posting| (*gram, posting)))
            .collect::<Vec<_>>();
        if gram_postings.len() != grams.len() {
            return Vec::new();
        }

        gram_postings.sort_by_key(|(_, posting)| posting.len());

        let mut current = gram_postings[0].1.clone();
        for (_, posting) in gram_postings.into_iter().skip(1) {
            current = current.intersect(posting, self.config.bitmap_threshold);
            if current.is_empty() {
                break;
            }
            if current.len() <= self.config.max_clause_candidates {
                break;
            }
        }

        current
            .to_vec()
            .into_iter()
            .filter(|ordinal| self.catalog.scope_matches(SpanOrdinal(*ordinal), scope))
            .collect()
    }

    fn clause_idfs(&self, clauses: &[Clause], clause_dfs: &[usize]) -> Vec<f64> {
        clauses
            .iter()
            .zip(clause_dfs.iter().copied())
            .map(|(clause, fallback_df)| {
                let df = match clause.pattern.len() {
                    0 => self.catalog.stats().total_spans.max(1),
                    1 => fallback_df.max(1),
                    2 => self.gram_df(
                        &extract_packed_grams(&clause.pattern, self.config.bigram_width),
                        &self.bigram_postings,
                        fallback_df,
                    ),
                    _ => self.gram_df(
                        &extract_packed_grams(&clause.pattern, self.config.trigram_width),
                        &self.trigram_postings,
                        fallback_df,
                    ),
                };
                idf(self.catalog.stats().total_spans.max(1), df.max(1))
            })
            .collect()
    }

    fn gram_df(
        &self,
        grams: &[PackedGram],
        postings: &BTreeMap<PackedGram, PostingSet>,
        fallback_df: usize,
    ) -> usize {
        grams
            .iter()
            .filter_map(|gram| postings.get(gram).map(PostingSet::len))
            .min()
            .unwrap_or(fallback_df.max(1))
    }

    fn score_span(
        &self,
        matches: &[Option<PatternMatch>],
        matched_count: usize,
        idfs: &[f64],
    ) -> f64 {
        let mut base_sum = 0.0;
        let mut masks = Vec::new();
        let stats = self.catalog.stats();

        for (index, matched) in matches.iter().enumerate() {
            let Some(matched) = matched else {
                continue;
            };
            let mut tf_star = 0.0;
            for (field, detail) in &matched.field_matches {
                let weight = self
                    .config
                    .search
                    .field_weights
                    .get(field)
                    .copied()
                    .unwrap_or(1.0);
                let avg_len = stats
                    .average_field_lengths
                    .get(field)
                    .copied()
                    .unwrap_or(100.0);
                let normalized_tf = normalized_term_frequency(
                    detail.count,
                    detail.field_length,
                    avg_len,
                    self.config.search.b,
                );
                tf_star += weight * normalized_tf;
            }
            base_sum += idfs[index] * saturate(tf_star, self.config.search.k1);
            masks.push(matched.segment_mask);
        }

        let coverage = matched_count as f64 / matches.len().max(1) as f64;
        let coverage_mult = (self.config.search.coverage_epsilon + coverage)
            .powf(self.config.search.coverage_lambda);

        let proximity = if masks.len() > 1 {
            pattern_proximity(
                &masks,
                self.config.search.proximity_alpha,
                self.config.search.max_segments,
                self.config.search.proximity_decay,
            )
        } else {
            1.0
        };

        base_sum * coverage_mult * proximity
    }
}

fn normalized_term_frequency(tf: usize, field_len: usize, avg_len: f64, b: f64) -> f64 {
    tf as f64 / (1.0 - b + b * field_len as f64 / avg_len.max(1.0))
}

fn saturate(tf_star: f64, k1: f64) -> f64 {
    (k1 + 1.0) * tf_star / (k1 + tf_star.max(1e-9))
}

fn pattern_proximity(masks: &[u32], alpha: f64, max_segments: u32, decay_lambda: f64) -> f64 {
    let common = masks
        .iter()
        .copied()
        .reduce(|left, right| left & right)
        .unwrap_or(0);
    let overlap = common.count_ones();
    let denom = max_segments.min(masks.len() as u32).max(1) as f64;
    let decay = (-decay_lambda).exp();
    1.0 + alpha * (overlap as f64 / denom) * decay
}

fn idf(total_spans: usize, df: usize) -> f64 {
    let total = total_spans as f64;
    let doc_freq = df as f64;
    (1.0 + (total - doc_freq + 0.5) / (doc_freq + 0.5)).ln()
}

#[cfg(test)]
mod tests {
    use phoenix_types::{IndexedTextField, LexicalField, ScopeKey};

    use super::*;

    fn span(id: &str, title: &str, body: &str) -> IndexedSpan {
        IndexedSpan {
            span_id: id.to_owned(),
            note_id: Some(phoenix_types::NoteId(id.to_owned())),
            document_id: Some(phoenix_types::DocumentId(id.to_owned())),
            scope: ScopeKey::default(),
            fields: vec![
                IndexedTextField {
                    field: LexicalField::Title,
                    text: title.to_owned(),
                },
                IndexedTextField {
                    field: LexicalField::Body,
                    text: body.to_owned(),
                },
            ],
        }
    }

    #[test]
    fn bigram_sidecar_supports_two_character_queries() {
        let index = QgramIndex::build(
            &[span("doc-1", "CEO", "The C.E.O. arrived.")],
            QgramConfig::default(),
        );

        let results = index.search("ed", &ScopeKey::default(), 10);
        assert_eq!(results.span_hits.len(), 1);
        assert_eq!(results.span_hits[0].span_id, "doc-1");
    }

    #[test]
    fn phrase_and_punctuation_queries_verify_exactly() {
        let index = QgramIndex::build(
            &[
                span("doc-1", "Leader", "The C.E.O. arrived."),
                span("doc-2", "Leader", "The CEO arrived."),
            ],
            QgramConfig::default(),
        );

        let results = index.search(r#""C.E.O.""#, &ScopeKey::default(), 10);
        assert_eq!(results.span_hits.len(), 1);
        assert_eq!(results.span_hits[0].span_id, "doc-1");
    }

    #[test]
    fn coverage_and_proximity_favor_full_close_matches() {
        let index = QgramIndex::build(
            &[
                span("doc-1", "Alpha", "alpha bravo charlie"),
                span("doc-2", "Alpha", "alpha xxxxxxxxxxxxxxxxxxxxxxxxx bravo"),
                span("doc-3", "Alpha", "alpha only"),
            ],
            QgramConfig::default(),
        );

        let results = index.search("alpha bravo", &ScopeKey::default(), 10);
        assert_eq!(results.span_hits[0].span_id, "doc-1");
        assert_eq!(results.span_hits[1].span_id, "doc-2");
        assert_eq!(results.span_hits[2].span_id, "doc-3");
    }
}
