//! Warped Lorentz-Hopf product manifold primitives.
//!
//! Lorentz is the canonical hierarchy body. Klein is a derived visual window.
//! Semantic anchors and Hopf-like fibers are factors attached to the body, not
//! independent projection systems.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::lorentz_tree::{hyperbolic_distance, HyperboloidPoint};
use crate::product_manifold_math::{
    cross, dot4, normalize3, normalize4, stable_hash, stable_signed_unit, stable_tangent,
    stable_unit,
};

const DEFAULT_EPS: f32 = 1e-6;
const GEOMETRY_VERSION: u64 = 1;

#[derive(Debug, Error)]
pub enum ProductManifoldError {
    #[error("empty embedding")]
    EmptyEmbedding,

    #[error("invalid config field {field}: {value}")]
    InvalidConfigField { field: &'static str, value: f32 },

    #[error(transparent)]
    Lorentz(#[from] crate::lorentz_tree::LorentzTreeError),
}

pub type ProductManifoldResult<T> = Result<T, ProductManifoldError>;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductFiberKind {
    Identity,
    Relationship,
    Location,
    Event,
    Temporal,
    Causal,
    Evidence,
    Provenance,
    Contradiction,
    Abstraction,
    DocumentStructure,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProductQueryIntent {
    Similar,
    Ancestors,
    Descendants,
    Causes,
    Effects,
    TimelineBefore,
    TimelineAfter,
    SameContext,
    ContrastiveContext,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductManifoldConfig {
    pub depth_scale: f32,
    pub min_non_root_radius: f32,
    pub max_radius: f32,
    pub fiber_radius: f32,
}

impl Default for ProductManifoldConfig {
    fn default() -> Self {
        Self {
            depth_scale: 0.72,
            min_non_root_radius: 0.12,
            max_radius: 2.35,
            fiber_radius: 0.075,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductMetricWeights {
    pub semantic: f32,
    pub hierarchy: f32,
    pub fiber: f32,
    pub document: f32,
    pub timeline: f32,
    pub causality: f32,
    pub evidence: f32,
}

impl ProductMetricWeights {
    pub fn for_intent(intent: ProductQueryIntent) -> Self {
        match intent {
            ProductQueryIntent::Causes | ProductQueryIntent::Effects => Self {
                semantic: 0.22,
                hierarchy: 0.18,
                fiber: 0.12,
                document: 0.04,
                timeline: 0.18,
                causality: 0.34,
                evidence: 0.16,
            },
            ProductQueryIntent::Ancestors | ProductQueryIntent::Descendants => Self {
                semantic: 0.16,
                hierarchy: 0.42,
                fiber: 0.08,
                document: 0.18,
                timeline: 0.04,
                causality: 0.08,
                evidence: 0.12,
            },
            ProductQueryIntent::SameContext | ProductQueryIntent::ContrastiveContext => Self {
                semantic: 0.28,
                hierarchy: 0.14,
                fiber: 0.34,
                document: 0.08,
                timeline: 0.08,
                causality: 0.06,
                evidence: 0.10,
            },
            _ => Self {
                semantic: 0.42,
                hierarchy: 0.20,
                fiber: 0.12,
                document: 0.08,
                timeline: 0.06,
                causality: 0.04,
                evidence: 0.08,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductLaneCoord {
    pub depth: f32,
    pub branch: [f32; 4],
    pub confidence: f32,
}

impl ProductLaneCoord {
    pub fn new(depth: f32, branch: [f32; 4], confidence: f32) -> Self {
        Self {
            depth: depth.max(0.0),
            branch: normalize4(branch),
            confidence: confidence.clamp(0.0, 1.0),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectedProductLaneCoord {
    pub depth: f32,
    pub forward: [f32; 4],
    pub backward: [f32; 4],
    pub confidence: f32,
}

impl DirectedProductLaneCoord {
    pub fn new(depth: f32, forward: [f32; 4], backward: [f32; 4], confidence: f32) -> Self {
        Self {
            depth: depth.max(0.0),
            forward: normalize4(forward),
            backward: normalize4(backward),
            confidence: confidence.clamp(0.0, 1.0),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductLanes {
    pub document: ProductLaneCoord,
    pub semantic: ProductLaneCoord,
    pub timeline: DirectedProductLaneCoord,
    pub causality: DirectedProductLaneCoord,
    pub evidence: ProductLaneCoord,
    pub entity: ProductLaneCoord,
    pub discourse: ProductLaneCoord,
}

impl ProductLanes {
    pub fn from_depths(
        document: f32,
        semantic: f32,
        timeline: f32,
        causality: f32,
        evidence: f32,
    ) -> Self {
        Self {
            document: ProductLaneCoord::new(document, [1.0, 0.0, 0.0, 0.0], 1.0),
            semantic: ProductLaneCoord::new(semantic, [0.0, 1.0, 0.0, 0.0], 1.0),
            timeline: DirectedProductLaneCoord::new(
                timeline,
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, -1.0, 0.0],
                1.0,
            ),
            causality: DirectedProductLaneCoord::new(
                causality,
                [0.0, 0.0, 0.0, 1.0],
                [0.0, 0.0, 0.0, -1.0],
                1.0,
            ),
            evidence: ProductLaneCoord::new(evidence, [0.5, 0.5, 0.0, 0.0], 1.0),
            entity: ProductLaneCoord::new(semantic, [0.5, 0.0, 0.5, 0.0], 1.0),
            discourse: ProductLaneCoord::new(document, [0.0, 0.5, 0.5, 0.0], 1.0),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductFiberCoord {
    pub kind: ProductFiberKind,
    pub phase: f32,
    pub radius: f32,
    pub strength: f32,
    pub confidence: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductChartCoord {
    pub chart_id: String,
    pub cell_id: String,
    pub tangent_a: [f32; 3],
    pub tangent_b: [f32; 3],
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductManifoldPoint {
    pub node_id: String,
    pub semantic_anchor: Vec<f32>,
    pub semantic_anchor_ref: Option<String>,
    pub lorentz: HyperboloidPoint,
    pub klein: [f32; 4],
    pub fibers: Vec<ProductFiberCoord>,
    pub lanes: ProductLanes,
    pub chart: ProductChartCoord,
    pub geometry_version: u64,
}

impl ProductManifoldPoint {
    pub fn project(
        node_id: impl Into<String>,
        embedding: &[f32],
        lanes: ProductLanes,
        config: ProductManifoldConfig,
    ) -> ProductManifoldResult<Self> {
        validate_config(config)?;
        let node_id = node_id.into();
        let semantic_anchor = normalize_embedding(embedding)?;
        let radius = depth_to_radius(primary_depth(&lanes), config);
        let tangent = branch_tangent(&semantic_anchor, &node_id);
        let lorentz = HyperboloidPoint::from_tangent(tangent, radius)?;
        let klein = lorentz_to_klein(lorentz);
        let fibers = build_fibers(&node_id, config);
        let chart = chart_coord(&node_id, klein);
        Ok(Self {
            node_id,
            semantic_anchor,
            semantic_anchor_ref: None,
            lorentz,
            klein,
            fibers,
            lanes,
            chart,
            geometry_version: GEOMETRY_VERSION,
        })
    }
}

pub fn lorentz_to_klein(point: HyperboloidPoint) -> [f32; 4] {
    let t = point.time().max(1.0);
    let spatial = point.spatial();
    [
        spatial[0] / t,
        spatial[1] / t,
        spatial[2] / t,
        spatial[3] / t,
    ]
}

pub fn product_distance(
    a: &ProductManifoldPoint,
    b: &ProductManifoldPoint,
    intent: ProductQueryIntent,
) -> ProductManifoldResult<f32> {
    let weights = ProductMetricWeights::for_intent(intent);
    let semantic = angular_distance(&a.semantic_anchor, &b.semantic_anchor);
    let hierarchy = hyperbolic_distance(a.lorentz, b.lorentz)?;
    let fiber = fiber_distance(a, b, intent);
    let document = lane_distance(a.lanes.document, b.lanes.document);
    let timeline = directed_lane_distance(a.lanes.timeline, b.lanes.timeline, intent);
    let causality = directed_lane_distance(a.lanes.causality, b.lanes.causality, intent);
    let evidence = lane_distance(a.lanes.evidence, b.lanes.evidence);
    Ok(weights.semantic * semantic
        + weights.hierarchy * hierarchy
        + weights.fiber * fiber
        + weights.document * document
        + weights.timeline * timeline
        + weights.causality * causality
        + weights.evidence * evidence)
}

fn validate_config(config: ProductManifoldConfig) -> ProductManifoldResult<()> {
    for (field, value) in [
        ("depth_scale", config.depth_scale),
        ("max_radius", config.max_radius),
        ("fiber_radius", config.fiber_radius),
    ] {
        if !value.is_finite() || value <= DEFAULT_EPS {
            return Err(ProductManifoldError::InvalidConfigField { field, value });
        }
    }
    Ok(())
}

fn normalize_embedding(values: &[f32]) -> ProductManifoldResult<Vec<f32>> {
    if values.is_empty() {
        return Err(ProductManifoldError::EmptyEmbedding);
    }
    let mut norm_sq = 0.0f32;
    for value in values {
        if value.is_finite() {
            norm_sq += value * value;
        }
    }
    if norm_sq <= DEFAULT_EPS {
        let mut out = vec![0.0; values.len()];
        out[0] = 1.0;
        return Ok(out);
    }
    let inv = norm_sq.sqrt().recip();
    Ok(values
        .iter()
        .map(|value| if value.is_finite() { value * inv } else { 0.0 })
        .collect())
}

fn branch_tangent(anchor: &[f32], node_id: &str) -> [f32; 4] {
    let mut out = [0.0; 4];
    for (index, slot) in out.iter_mut().enumerate() {
        let base = anchor.get(index).copied().unwrap_or(0.0);
        *slot = base + stable_signed_unit(node_id, index as u64) * 0.07;
    }
    normalize4(out)
}

fn primary_depth(lanes: &ProductLanes) -> f32 {
    lanes.semantic.depth * 0.42
        + lanes.document.depth * 0.22
        + lanes.timeline.depth * 0.12
        + lanes.causality.depth * 0.12
        + lanes.evidence.depth * 0.12
}

fn depth_to_radius(depth: f32, config: ProductManifoldConfig) -> f32 {
    if depth <= DEFAULT_EPS {
        return 0.0;
    }
    (config.depth_scale * depth.ln_1p())
        .max(config.min_non_root_radius)
        .min(config.max_radius)
}

fn build_fibers(node_id: &str, config: ProductManifoldConfig) -> Vec<ProductFiberCoord> {
    [
        ProductFiberKind::Identity,
        ProductFiberKind::DocumentStructure,
        ProductFiberKind::Temporal,
        ProductFiberKind::Causal,
        ProductFiberKind::Evidence,
    ]
    .into_iter()
    .map(|kind| ProductFiberCoord {
        kind,
        phase: stable_unit(&format!("{node_id}:{kind:?}")),
        radius: config.fiber_radius,
        strength: 1.0,
        confidence: 1.0,
    })
    .collect()
}

fn chart_coord(node_id: &str, klein: [f32; 4]) -> ProductChartCoord {
    let radial = normalize3([klein[0], klein[1], klein[2]]);
    let tangent_a = stable_tangent(radial, stable_unit(node_id));
    let tangent_b = cross(radial, tangent_a);
    ProductChartCoord {
        chart_id: format!("product:chart:{:02x}", stable_hash(node_id) & 0xff),
        cell_id: format!(
            "product:cell:{:03x}",
            stable_hash(&format!("{node_id}:cell")) & 0xfff
        ),
        tangent_a,
        tangent_b: normalize3(tangent_b),
    }
}

fn angular_distance(a: &[f32], b: &[f32]) -> f32 {
    let len = a.len().min(b.len());
    let dot = (0..len).fold(0.0f32, |acc, index| acc + a[index] * b[index]);
    dot.clamp(-1.0, 1.0).acos() / core::f32::consts::PI
}

fn fiber_distance(
    a: &ProductManifoldPoint,
    b: &ProductManifoldPoint,
    intent: ProductQueryIntent,
) -> f32 {
    let desired = match intent {
        ProductQueryIntent::Causes | ProductQueryIntent::Effects => ProductFiberKind::Causal,
        ProductQueryIntent::TimelineBefore | ProductQueryIntent::TimelineAfter => {
            ProductFiberKind::Temporal
        }
        ProductQueryIntent::Ancestors | ProductQueryIntent::Descendants => {
            ProductFiberKind::DocumentStructure
        }
        _ => ProductFiberKind::Identity,
    };
    let phase_a = a
        .fibers
        .iter()
        .find(|fiber| fiber.kind == desired)
        .map(|f| f.phase);
    let phase_b = b
        .fibers
        .iter()
        .find(|fiber| fiber.kind == desired)
        .map(|f| f.phase);
    match (phase_a, phase_b) {
        (Some(left), Some(right)) => circular_distance(left, right),
        _ => 0.0,
    }
}

fn lane_distance(a: ProductLaneCoord, b: ProductLaneCoord) -> f32 {
    (a.depth - b.depth).abs() + (1.0 - dot4(a.branch, b.branch)).max(0.0) * 0.25
}

fn directed_lane_distance(
    a: DirectedProductLaneCoord,
    b: DirectedProductLaneCoord,
    intent: ProductQueryIntent,
) -> f32 {
    let forward = matches!(
        intent,
        ProductQueryIntent::Causes
            | ProductQueryIntent::Effects
            | ProductQueryIntent::TimelineBefore
            | ProductQueryIntent::TimelineAfter
    );
    let delta = b.depth - a.depth;
    let order_cost = if forward {
        if delta >= 0.0 {
            delta
        } else {
            delta.abs() * 2.5
        }
    } else {
        delta.abs()
    };
    let direction_cost = 1.0 - dot4(a.forward, b.forward).max(dot4(a.backward, b.backward));
    order_cost + direction_cost.max(0.0) * 0.18
}

fn circular_distance(a: f32, b: f32) -> f32 {
    let direct = (a - b).abs();
    direct.min(1.0 - direct)
}
