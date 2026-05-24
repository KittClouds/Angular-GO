use crate::lorentz_tree::lorentz_dot;
use crate::product_manifold::{
    product_distance, ProductLanes, ProductManifoldConfig, ProductManifoldPoint,
    ProductManifoldResult, ProductQueryIntent,
};

#[test]
fn product_point_keeps_canonical_invariants() {
    let point = sample_point("kai", 1.0, 2.0).unwrap();
    let anchor_norm = point
        .semantic_anchor
        .iter()
        .fold(0.0f32, |sum, value| sum + value * value)
        .sqrt();
    let klein_radius = point
        .klein
        .iter()
        .fold(0.0f32, |sum, value| sum + value * value)
        .sqrt();

    assert!((anchor_norm - 1.0).abs() <= 1e-5);
    assert!((lorentz_dot(point.lorentz, point.lorentz) + 1.0).abs() <= 1e-3);
    assert!(klein_radius < 1.0);
    assert_eq!(point.fibers.len(), 5);
}

#[test]
fn product_projection_is_deterministic() {
    let first = sample_point("red-mesa", 2.0, 3.0).unwrap();
    let second = sample_point("red-mesa", 2.0, 3.0).unwrap();

    assert_eq!(first.klein, second.klein);
    assert_eq!(first.fibers, second.fibers);
    assert_eq!(first.chart, second.chart);
}

#[test]
fn causality_lane_is_directional() {
    let cause = sample_point("cause", 1.0, 1.0).unwrap();
    let effect = sample_point("effect", 1.0, 5.0).unwrap();

    let forward = product_distance(&cause, &effect, ProductQueryIntent::Causes).unwrap();
    let backward = product_distance(&effect, &cause, ProductQueryIntent::Causes).unwrap();

    assert!(forward < backward);
}

#[test]
fn semantic_similarity_stays_symmetric() {
    let a = sample_point("a", 1.0, 1.0).unwrap();
    let b = sample_point("b", 1.5, 2.0).unwrap();

    let ab = product_distance(&a, &b, ProductQueryIntent::Similar).unwrap();
    let ba = product_distance(&b, &a, ProductQueryIntent::Similar).unwrap();

    assert!((ab - ba).abs() <= 1e-4);
}

fn sample_point(
    id: &str,
    semantic_depth: f32,
    causal_depth: f32,
) -> ProductManifoldResult<ProductManifoldPoint> {
    ProductManifoldPoint::project(
        id,
        &[0.25, 0.4, 0.7, 0.1, 0.2, 0.3],
        ProductLanes::from_depths(1.0, semantic_depth, 0.5, causal_depth, 0.8),
        ProductManifoldConfig::default(),
    )
}
