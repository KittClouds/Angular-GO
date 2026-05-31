use compact_str::{format_compact, CompactString};
use hashbrown::HashMap;

use super::types::{
    BundleCompressionInput, BundleRerankScore, FactBundle, FactBundleCompression,
    GraphCompilerOutput,
};

pub(super) fn compress_fact_bundles(
    output: &mut GraphCompilerOutput,
    input: Option<&BundleCompressionInput<'_>>,
) {
    let Some(input) = input else {
        return;
    };
    if input.embeddings.is_empty() || output.bundles.is_empty() {
        return;
    }

    let embeddings = input
        .embeddings
        .iter()
        .map(|embedding| (embedding.bundle_id, embedding.vector))
        .collect::<HashMap<_, _>>();
    let reranks = input
        .rerank_scores
        .iter()
        .map(|score| (score.bundle_id, score))
        .collect::<HashMap<_, _>>();
    let mut rows = Vec::with_capacity(output.bundles.len());
    for (bundle_index, bundle) in output.bundles.iter().enumerate() {
        let Some(vector) = bundle_lookup(bundle, &embeddings) else {
            continue;
        };
        let norm = vector_norm(vector);
        if norm <= f32::EPSILON {
            continue;
        }
        rows.push(BundleRow {
            bundle_index,
            vector,
            norm,
            neighbor_count: 0,
            similarity_sum: 0.0,
        });
    }
    if rows.is_empty() {
        return;
    }

    let mut union = UnionFind::new(rows.len());
    let mut similarities = HashMap::<(usize, usize), f32>::new();
    for left in 0..rows.len() {
        for right in left + 1..rows.len() {
            let similarity = cosine(
                rows[left].vector,
                rows[left].norm,
                rows[right].vector,
                rows[right].norm,
            );
            similarities.insert((left, right), similarity);
            if similarity >= input.policy.cluster_similarity_threshold {
                union.union(left, right);
                rows[left].neighbor_count += 1;
                rows[right].neighbor_count += 1;
                rows[left].similarity_sum += similarity;
                rows[right].similarity_sum += similarity;
            }
        }
    }

    let mut clusters = HashMap::<usize, Vec<usize>>::new();
    for row_index in 0..rows.len() {
        clusters
            .entry(union.find(row_index))
            .or_insert_with(Vec::new)
            .push(row_index);
    }

    let mut cluster_rows = clusters.into_values().collect::<Vec<_>>();
    cluster_rows.sort_by(|left, right| {
        cluster_sort_key(left, &rows, &output.bundles).cmp(&cluster_sort_key(
            right,
            &rows,
            &output.bundles,
        ))
    });

    for (cluster_index, members) in cluster_rows.iter().enumerate() {
        let cluster_id = format_compact!("jina-bundle-cluster:{}", cluster_index);
        let canonical = canonical_member(members, &rows, &output.bundles, &reranks);
        let canonical_bundle_id = output.bundles[rows[canonical].bundle_index].id.clone();
        let mut ranked = members.clone();
        ranked.sort_by(|left, right| {
            member_score(*right, &rows, &output.bundles, &reranks)
                .total_cmp(&member_score(*left, &rows, &output.bundles, &reranks))
                .then_with(|| {
                    output.bundles[rows[*left].bundle_index]
                        .id
                        .cmp(&output.bundles[rows[*right].bundle_index].id)
                })
        });

        for (rank, row_index) in ranked.into_iter().enumerate() {
            let bundle_index = rows[row_index].bundle_index;
            let bundle_id = output.bundles[bundle_index].id.clone();
            let canonical_similarity = if row_index == canonical {
                1.0
            } else {
                pair_similarity(row_index, canonical, &similarities)
            };
            let duplicate_of = (row_index != canonical
                && canonical_similarity >= input.policy.duplicate_similarity_threshold)
                .then(|| canonical_bundle_id.clone());
            let outlier_score = outlier_score(&rows[row_index]);
            let rerank = bundle_lookup(&output.bundles[bundle_index], &reranks).copied();
            if let Some(score) = rerank {
                output.bundles[bundle_index].confidence =
                    blend_rerank(output.bundles[bundle_index].confidence, score.score);
            }

            let mut signals = Vec::with_capacity(5);
            signals.push(format_compact!("jina:cluster:{}", cluster_id));
            signals.push(format_compact!(
                "jina:neighbors:{}",
                rows[row_index].neighbor_count
            ));
            if duplicate_of.is_some() {
                signals.push(format_compact!("jina:duplicate_of:{}", canonical_bundle_id));
            }
            if outlier_score >= input.policy.outlier_score_threshold {
                signals.push("jina:outlier_review".into());
            }
            if let Some(score) = rerank {
                signals.push(format_compact!("gliclass:rerank:{:.3}", score.score));
            }

            output.bundles[bundle_index].compression = Some(FactBundleCompression {
                model: input.model,
                cluster_id: cluster_id.clone(),
                canonical_bundle_id: canonical_bundle_id.clone(),
                duplicate_of_bundle_id: duplicate_of,
                outlier_score,
                neighbor_count: rows[row_index].neighbor_count.min(u16::MAX as usize) as u16,
                semantic_rank: rank.min(u16::MAX as usize) as u16,
                rerank_score: rerank.map(|score| score.score.clamp(0.0, 1.0)),
                rerank_source: rerank.map(|score| score.source),
                signals,
            });

            debug_assert_eq!(output.bundles[bundle_index].id, bundle_id);
        }
    }

    output.bundles.sort_by(|left, right| {
        bundle_order_score(right)
            .total_cmp(&bundle_order_score(left))
            .then_with(|| left.id.cmp(&right.id))
    });
}

struct BundleRow<'a> {
    bundle_index: usize,
    vector: &'a [f32],
    norm: f32,
    neighbor_count: usize,
    similarity_sum: f32,
}

fn bundle_lookup<'a, T>(bundle: &FactBundle, values: &'a HashMap<&str, T>) -> Option<&'a T> {
    values
        .get(bundle.id.as_str())
        .or_else(|| values.get(bundle.source_record_id.as_str()))
}

fn canonical_member(
    members: &[usize],
    rows: &[BundleRow<'_>],
    bundles: &[FactBundle],
    reranks: &HashMap<&str, &BundleRerankScore<'_>>,
) -> usize {
    members
        .iter()
        .copied()
        .max_by(|left, right| {
            member_score(*left, rows, bundles, reranks)
                .total_cmp(&member_score(*right, rows, bundles, reranks))
                .then_with(|| {
                    bundles[rows[*right].bundle_index]
                        .id
                        .cmp(&bundles[rows[*left].bundle_index].id)
                })
        })
        .unwrap_or(0)
}

fn member_score(
    row_index: usize,
    rows: &[BundleRow<'_>],
    bundles: &[FactBundle],
    reranks: &HashMap<&str, &BundleRerankScore<'_>>,
) -> f32 {
    let bundle = &bundles[rows[row_index].bundle_index];
    let rerank = bundle_lookup(bundle, reranks)
        .map(|score| score.score.clamp(0.0, 1.0))
        .unwrap_or(0.0);
    let hub = (rows[row_index].neighbor_count as f32 / 6.0).min(1.0);
    bundle.confidence.clamp(0.0, 1.0) * 0.46 + rerank * 0.42 + hub * 0.12
}

fn bundle_order_score(bundle: &FactBundle) -> f32 {
    let rerank = bundle
        .compression
        .as_ref()
        .and_then(|compression| compression.rerank_score)
        .unwrap_or(0.0);
    let duplicate_penalty = bundle
        .compression
        .as_ref()
        .and_then(|compression| compression.duplicate_of_bundle_id.as_ref())
        .map(|_| 0.08)
        .unwrap_or(0.0);
    bundle.confidence.clamp(0.0, 1.0) + rerank * 0.24 - duplicate_penalty
}

fn cluster_sort_key(
    members: &[usize],
    rows: &[BundleRow<'_>],
    bundles: &[FactBundle],
) -> CompactString {
    members
        .iter()
        .map(|member| bundles[rows[*member].bundle_index].id.clone())
        .min()
        .unwrap_or_else(|| CompactString::new(""))
}

fn pair_similarity(left: usize, right: usize, similarities: &HashMap<(usize, usize), f32>) -> f32 {
    if left == right {
        return 1.0;
    }
    let key = if left < right {
        (left, right)
    } else {
        (right, left)
    };
    similarities.get(&key).copied().unwrap_or(0.0)
}

fn outlier_score(row: &BundleRow<'_>) -> f32 {
    if row.neighbor_count == 0 {
        return 1.0;
    }
    let mean = row.similarity_sum / row.neighbor_count as f32;
    (1.0 - mean * 1.15).clamp(0.0, 1.0)
}

fn blend_rerank(confidence: f32, rerank: f32) -> f32 {
    (confidence.clamp(0.0, 1.0) * 0.72 + rerank.clamp(0.0, 1.0) * 0.28).clamp(0.0, 1.0)
}

fn cosine(left: &[f32], left_norm: f32, right: &[f32], right_norm: f32) -> f32 {
    let dims = left.len().min(right.len());
    if dims == 0 {
        return 0.0;
    }
    let mut dot = 0.0;
    for index in 0..dims {
        dot += left[index] * right[index];
    }
    (dot / (left_norm * right_norm).max(1e-12)).clamp(-1.0, 1.0)
}

fn vector_norm(values: &[f32]) -> f32 {
    values.iter().map(|value| value * value).sum::<f32>().sqrt()
}

struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(len: usize) -> Self {
        Self {
            parent: (0..len).collect(),
        }
    }

    fn find(&mut self, value: usize) -> usize {
        let parent = self.parent[value];
        if parent == value {
            return value;
        }
        let root = self.find(parent);
        self.parent[value] = root;
        root
    }

    fn union(&mut self, left: usize, right: usize) {
        let left_root = self.find(left);
        let right_root = self.find(right);
        if left_root != right_root {
            self.parent[right_root] = left_root;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compiler::types::{
        BundleCompressionModel, BundleCompressionPolicy, BundleEmbedding, BundleRerankSource,
        EvidenceBundleKind, FactLane,
    };

    #[test]
    fn jina_clusters_dedupes_outliers_and_gliclass_reranks() {
        let mut output = GraphCompilerOutput {
            schema_version: "test".into(),
            scope_kind: crate::types::GraphScopeKind::Note,
            scope_id: "scope".into(),
            built_at: 1,
            atoms: Vec::new(),
            evidence_anchors: Vec::new(),
            bundles: vec![
                bundle("bundle:a", "rel:a", 0.62),
                bundle("bundle:b", "rel:b", 0.58),
                bundle("bundle:c", "rel:c", 0.74),
            ],
            facts: Vec::new(),
            roles: Vec::new(),
            projected_edges: Vec::new(),
            receipts: Default::default(),
        };
        let embeddings = [
            BundleEmbedding {
                bundle_id: "bundle:a",
                vector: &[1.0, 0.02, 0.0],
            },
            BundleEmbedding {
                bundle_id: "bundle:b",
                vector: &[0.99, 0.03, 0.0],
            },
            BundleEmbedding {
                bundle_id: "bundle:c",
                vector: &[0.0, 1.0, 0.0],
            },
        ];
        let reranks = [BundleRerankScore {
            bundle_id: "bundle:b",
            source: BundleRerankSource::GliClass,
            score: 0.94,
        }];
        let input = BundleCompressionInput {
            model: BundleCompressionModel::JinaV5Nano,
            embeddings: &embeddings,
            rerank_scores: &reranks,
            policy: BundleCompressionPolicy::default(),
        };

        compress_fact_bundles(&mut output, Some(&input));

        let a = output
            .bundles
            .iter()
            .find(|bundle| bundle.id == "bundle:a")
            .unwrap();
        let b = output
            .bundles
            .iter()
            .find(|bundle| bundle.id == "bundle:b")
            .unwrap();
        let c = output
            .bundles
            .iter()
            .find(|bundle| bundle.id == "bundle:c")
            .unwrap();
        let a_compression = a.compression.as_ref().unwrap();
        let b_compression = b.compression.as_ref().unwrap();
        let c_compression = c.compression.as_ref().unwrap();
        assert_eq!(a_compression.cluster_id, b_compression.cluster_id);
        assert_eq!(
            a_compression.duplicate_of_bundle_id.as_deref(),
            Some("bundle:b")
        );
        assert_eq!(
            b_compression.rerank_source,
            Some(BundleRerankSource::GliClass)
        );
        assert!(b.confidence > 0.58);
        assert!(c_compression.outlier_score >= 0.72);
        assert!(c_compression.rerank_score.is_none());
        assert!(a_compression
            .signals
            .iter()
            .any(|signal| signal.as_str().starts_with("jina:duplicate_of")));
        assert!(b_compression
            .signals
            .iter()
            .any(|signal| signal.as_str().starts_with("gliclass:rerank")));
    }

    fn bundle(id: &str, source_record_id: &str, confidence: f32) -> FactBundle {
        FactBundle {
            id: id.into(),
            lane: FactLane::CooccurrenceWeak,
            bundle_kind: EvidenceBundleKind::SemanticSimilarity,
            group_key: "group".into(),
            predicate: "co_occurs_with".into(),
            source_record_id: source_record_id.into(),
            status: "prepared".into(),
            evidence_ids: vec!["evidence:a".into()],
            confidence,
            compression: None,
            commitment: None,
        }
    }
}
