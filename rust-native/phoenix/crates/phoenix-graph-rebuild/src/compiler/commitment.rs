use hashbrown::HashMap;
use phoenix_hyperbolic::hybrid_space::{
    busemann_signature, BusemannConfig, BusemannPrototype, PrototypeFamily,
};
use std::borrow::Cow;

use super::types::{
    BundleCommitmentInput, BundleCommitmentPoint, FactBundle, FactBundleCommitment,
    FactBundlePrototypeScore, GraphCompilerOutput, GraphPrototypeFamily,
};

pub(super) fn score_fact_bundle_commitments(
    output: &mut GraphCompilerOutput,
    input: Option<&BundleCommitmentInput<'_>>,
) {
    let Some(input) = input else {
        return;
    };
    if input.prototypes.is_empty() || input.points.is_empty() || output.bundles.is_empty() {
        return;
    }

    let family = input.policy.family;
    let prototypes = input
        .prototypes
        .iter()
        .filter(|prototype| prototype.family == family)
        .collect::<Vec<_>>();
    if prototypes.is_empty() {
        return;
    }

    let prototype_by_hash = prototypes
        .iter()
        .map(|prototype| (prototype_hash(prototype.prototype_id), *prototype))
        .collect::<HashMap<_, _>>();
    let hyperbolic_prototypes = prototypes
        .iter()
        .map(|prototype| BusemannPrototype {
            prototype_id: prototype_hash(prototype.prototype_id),
            family: to_hyperbolic_family(prototype.family),
            direction: prototype.direction.to_vec(),
        })
        .collect::<Vec<_>>();
    let points = input
        .points
        .iter()
        .map(|point| (point.bundle_id, point))
        .collect::<HashMap<_, _>>();
    let config = BusemannConfig {
        family: to_hyperbolic_family(family),
        commitment_weight: input.policy.commitment_weight,
        radial_weight: input.policy.radial_weight,
        ambiguity_threshold: input.policy.ambiguity_threshold,
        promotion_margin: input.policy.promotion_margin,
        top_k: input.policy.top_k,
        ..BusemannConfig::default()
    };

    for bundle in &mut output.bundles {
        let Some(point) = bundle_lookup(bundle, &points) else {
            continue;
        };
        let Some(point) = poincare_point(point.point) else {
            continue;
        };
        let Ok(signature) = busemann_signature(
            point.as_ref(),
            input.policy.curvature,
            &hyperbolic_prototypes,
            config,
        ) else {
            continue;
        };
        let Some(top) = prototype_by_hash.get(&signature.top_prototype_id) else {
            continue;
        };

        let commitment = FactBundleCommitment {
            family,
            top_prototype_id: top.prototype_id.into(),
            top_label: top.label.into(),
            top_score: signature.top_score,
            top_probability: signature.top_probability,
            second_prototype_id: signature
                .second_prototype_id
                .and_then(|id| prototype_by_hash.get(&id))
                .map(|prototype| prototype.prototype_id.into()),
            second_score: signature.second_score,
            second_probability: signature.second_probability,
            margin: signature.margin,
            entropy: signature.entropy,
            ambiguity_score: signature.ambiguity_score,
            classification_confidence: signature.classification_confidence,
            promotion_ready: signature.promotion_ready,
            radial_strength: signature.radial_strength,
            top_k_scores: signature
                .top_k_scores
                .into_iter()
                .filter_map(|score| {
                    let prototype = prototype_by_hash.get(&score.prototype_id)?;
                    Some(FactBundlePrototypeScore {
                        prototype_id: prototype.prototype_id.into(),
                        family: prototype.family,
                        score: score.score,
                        probability: score.probability,
                    })
                })
                .collect(),
        };

        if commitment.promotion_ready {
            bundle.confidence = (bundle.confidence * 0.78
                + commitment.classification_confidence * 0.22)
                .clamp(0.0, 1.0);
        }
        bundle.commitment = Some(commitment);
    }
}

fn bundle_lookup<'a>(
    bundle: &FactBundle,
    values: &HashMap<&'a str, &'a BundleCommitmentPoint<'a>>,
) -> Option<&'a BundleCommitmentPoint<'a>> {
    values
        .get(bundle.id.as_str())
        .copied()
        .or_else(|| values.get(bundle.source_record_id.as_str()).copied())
}

fn poincare_point(point: &[f32]) -> Option<Cow<'_, [f32]>> {
    if point.is_empty() {
        return None;
    }

    let mut norm_sq = 0.0_f32;
    for value in point {
        if !value.is_finite() {
            return None;
        }
        norm_sq += *value * *value;
    }

    if norm_sq < 0.92_f32 * 0.92_f32 {
        return Some(Cow::Borrowed(point));
    }

    let norm = norm_sq.sqrt();
    if norm <= f32::EPSILON {
        return Some(Cow::Borrowed(point));
    }

    let scale = 0.92_f32 / norm;
    let mut mapped = Vec::with_capacity(point.len());
    for value in point {
        mapped.push(*value * scale);
    }
    Some(Cow::Owned(mapped))
}

fn to_hyperbolic_family(family: GraphPrototypeFamily) -> PrototypeFamily {
    match family {
        GraphPrototypeFamily::EntityKind => PrototypeFamily::EntityKind,
        GraphPrototypeFamily::RelationFamily => PrototypeFamily::RelationFamily,
        GraphPrototypeFamily::EvidenceAuthority => PrototypeFamily::EvidenceAuthority,
        GraphPrototypeFamily::GraphStage => PrototypeFamily::GraphStage,
        GraphPrototypeFamily::ConceptDomain => PrototypeFamily::ConceptDomain,
    }
}

fn prototype_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use compact_str::format_compact;

    use super::*;
    use crate::compiler::types::{
        BundleCommitmentInput, BundleCommitmentPoint, BundleCommitmentPolicy, BundlePrototype,
        EvidenceBundleKind, FactLane,
    };

    #[test]
    fn busemann_commitment_scores_bundle_promotion_readiness() {
        let mut output = GraphCompilerOutput {
            schema_version: "test".into(),
            scope_kind: crate::types::GraphScopeKind::Note,
            scope_id: "scope".into(),
            built_at: 1,
            atoms: Vec::new(),
            evidence_anchors: Vec::new(),
            bundles: vec![bundle("bundle:approval", 0.62), bundle("bundle:mixed", 0.6)],
            facts: Vec::new(),
            roles: Vec::new(),
            projected_edges: Vec::new(),
            receipts: Default::default(),
        };
        let prototypes = [
            BundlePrototype {
                prototype_id: "relation:approval",
                family: GraphPrototypeFamily::RelationFamily,
                label: "approval",
                direction: &[1.0, 0.0],
            },
            BundlePrototype {
                prototype_id: "relation:transfer",
                family: GraphPrototypeFamily::RelationFamily,
                label: "transfer",
                direction: &[-1.0, 0.0],
            },
        ];
        let points = [
            BundleCommitmentPoint {
                bundle_id: "bundle:approval",
                point: &[0.48, 0.0],
            },
            BundleCommitmentPoint {
                bundle_id: "bundle:mixed",
                point: &[0.0, 0.0],
            },
        ];
        let input = BundleCommitmentInput {
            prototypes: &prototypes,
            points: &points,
            policy: BundleCommitmentPolicy {
                commitment_weight: 2.0,
                radial_weight: 0.0,
                ambiguity_threshold: 0.55,
                promotion_margin: 0.25,
                top_k: 2,
                ..BundleCommitmentPolicy::default()
            },
        };

        score_fact_bundle_commitments(&mut output, Some(&input));

        let ready = output
            .bundles
            .iter()
            .find(|bundle| bundle.id == "bundle:approval")
            .and_then(|bundle| bundle.commitment.as_ref())
            .expect("ready commitment");
        let mixed = output
            .bundles
            .iter()
            .find(|bundle| bundle.id == "bundle:mixed")
            .and_then(|bundle| bundle.commitment.as_ref())
            .expect("mixed commitment");
        assert_eq!(ready.top_prototype_id, "relation:approval");
        assert!(ready.promotion_ready);
        assert!(ready.margin > mixed.margin);
        assert!(!mixed.promotion_ready);
        assert!(mixed.entropy > 0.9);
    }

    fn bundle(id: &str, confidence: f32) -> FactBundle {
        FactBundle {
            id: id.into(),
            lane: FactLane::CooccurrenceWeak,
            bundle_kind: EvidenceBundleKind::SemanticSimilarity,
            group_key: "group".into(),
            predicate: "co_occurs_with".into(),
            source_record_id: id.into(),
            status: "prepared".into(),
            evidence_ids: vec![format_compact!("evidence:{id}")],
            confidence,
            compression: None,
            commitment: None,
        }
    }
}
