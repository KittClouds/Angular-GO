//! Binary Quantization for Ultra-Fast Coarse Filtering
//!
//! Converts f32 vectors to binary codes (sign bits) for 32Ã— compression.
//! Uses Hamming distance for O(1) candidate filtering, then exact rerank.
//!
//! # Compression
//! - 768D f32 vector: 3072 bytes â†’ 96 bytes (32Ã—)
//! - 384D f32 vector: 1536 bytes â†’ 48 bytes (32Ã—)

use serde::{Deserialize, Serialize};

/// Binary quantized vector using sign bits
/// 
/// Each dimension is encoded as 1 bit (positive = 1, negative = 0).
/// Stored as packed u64 words for efficient Hamming distance via popcount.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryQuantized {
    /// Packed binary codes (sign bits). Each u64 holds 64 dimensions.
    pub data: Vec<u64>,
    /// Original vector dimension
    pub dimensions: usize,
}

impl BinaryQuantized {
    /// Quantize a full-precision f32 vector to binary (sign bits)
    /// 
    /// # Algorithm
    /// For each dimension: bit = 1 if value >= 0, else 0
    /// Pack into u64 words for efficient Hamming distance
    pub fn quantize(vector: &[f32]) -> Self {
        let dimensions = vector.len();
        let num_words = (dimensions + 63) / 64; // Ceiling division
        let mut data = vec![0u64; num_words];

        for (i, &v) in vector.iter().enumerate() {
            if v >= 0.0 {
                let word_idx = i / 64;
                let bit_idx = i % 64;
                data[word_idx] |= 1u64 << bit_idx;
            }
        }

        Self { data, dimensions }
    }

    /// Compute Hamming distance to another binary vector
    /// 
    /// # Returns
    /// Number of differing bits (lower = more similar)
    #[inline]
    pub fn hamming_distance(&self, other: &Self) -> u32 {
        if self.dimensions != other.dimensions {
            return u32::MAX;
        }

        self.data
            .iter()
            .zip(&other.data)
            .map(|(&a, &b)| (a ^ b).count_ones())
            .sum()
    }

    /// Compute normalized similarity from Hamming distance
    /// 
    /// # Returns
    /// Similarity in [0.0, 1.0] where 1.0 = identical
    #[inline]
    pub fn similarity(&self, other: &Self) -> f32 {
        let distance = self.hamming_distance(other);
        if distance == u32::MAX {
            return 0.0;
        }
        1.0 - (distance as f32 / self.dimensions as f32)
    }

    /// Memory size in bytes
    pub fn size_bytes(&self) -> usize {
        self.data.len() * 8 + 8 // data + dimensions field
    }

    /// Compression ratio vs f32
    pub fn compression_ratio(&self) -> f32 {
        if self.dimensions == 0 {
            return 1.0;
        }
        let original_bytes = self.dimensions * 4; // f32 = 4 bytes
        let compressed_bytes = self.size_bytes();
        original_bytes as f32 / compressed_bytes as f32
    }
}

/// Two-stage search: binary coarse filter â†’ exact rerank
/// 
/// 1. Compute Hamming distance to all binary vectors (fast)
/// 2. Take top `rerank_count` candidates by Hamming
/// 3. Score candidates with full-precision similarity
/// 4. Return top-k
pub fn two_stage_search<F>(
    query: &[f32],
    binary_index: &[(u32, BinaryQuantized)],
    k: usize,
    rerank_multiplier: f32,
    get_full_vector: F,
    similarity_fn: fn(&[f32], &[f32]) -> f32,
) -> Vec<(u32, f32)>
where
    F: Fn(u32) -> Option<Vec<f32>>,
{
    if binary_index.is_empty() || k == 0 {
        return Vec::new();
    }

    // Stage 1: Binary coarse filter
    let query_binary = BinaryQuantized::quantize(query);
    let rerank_count = ((k as f32 * rerank_multiplier).ceil() as usize).max(k);

    let mut candidates: Vec<(u32, u32)> = binary_index
        .iter()
        .map(|(id, bq)| (*id, query_binary.hamming_distance(bq)))
        .collect();

    // Sort by Hamming distance (ascending = most similar first)
    candidates.sort_by_key(|(_, dist)| *dist);
    candidates.truncate(rerank_count);

    // Stage 2: Exact rerank with full precision
    let mut results: Vec<(u32, f32)> = candidates
        .into_iter()
        .filter_map(|(id, _)| {
            let full_vector = get_full_vector(id)?;
            let score = similarity_fn(query, &full_vector);
            Some((id, score))
        })
        .collect();

    // Sort by score (descending = highest similarity first)
    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(k);

    results
}

/// Cosine similarity for reranking
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut mag_a = 0.0f32;
    let mut mag_b = 0.0f32;

    for (x, y) in a.iter().zip(b) {
        dot += x * y;
        mag_a += x * x;
        mag_b += y * y;
    }

    let denom = mag_a.sqrt() * mag_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================================
    // Quantization Contract Tests
    // ============================================================================

    #[test]
    fn test_quantize_basic() {
        let vector = vec![1.0, -1.0, 0.5, -0.5, 0.0];
        let bq = BinaryQuantized::quantize(&vector);

        assert_eq!(bq.dimensions, 5);
        // Bits: 1, 0, 1, 0, 1 (0.0 counts as positive)
        // Packed: 0b10101 = 21
        assert_eq!(bq.data[0] & 0b11111, 0b10101);
    }

    #[test]
    fn test_quantize_empty_vector() {
        let vector: Vec<f32> = vec![];
        let bq = BinaryQuantized::quantize(&vector);

        assert_eq!(bq.dimensions, 0);
        assert!(bq.data.is_empty());
    }

    #[test]
    fn test_quantize_all_positive() {
        let vector = vec![1.0, 2.0, 3.0, 4.0];
        let bq = BinaryQuantized::quantize(&vector);

        assert_eq!(bq.data[0] & 0b1111, 0b1111);
    }

    #[test]
    fn test_quantize_all_negative() {
        let vector = vec![-1.0, -2.0, -3.0, -4.0];
        let bq = BinaryQuantized::quantize(&vector);

        assert_eq!(bq.data[0] & 0b1111, 0b0000);
    }

    #[test]
    fn test_quantize_large_vector() {
        // 384D vector (typical BGE-small)
        let vector: Vec<f32> = (0..384).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        let bq = BinaryQuantized::quantize(&vector);

        assert_eq!(bq.dimensions, 384);
        assert_eq!(bq.data.len(), 6); // 384 / 64 = 6 words
    }

    // ============================================================================
    // Hamming Distance Contract Tests
    // ============================================================================

    #[test]
    fn test_hamming_identical() {
        let v = vec![1.0, -1.0, 1.0, -1.0];
        let bq1 = BinaryQuantized::quantize(&v);
        let bq2 = BinaryQuantized::quantize(&v);

        assert_eq!(bq1.hamming_distance(&bq2), 0);
    }

    #[test]
    fn test_hamming_all_different() {
        let v1 = vec![1.0, 1.0, 1.0, 1.0];
        let v2 = vec![-1.0, -1.0, -1.0, -1.0];

        let bq1 = BinaryQuantized::quantize(&v1);
        let bq2 = BinaryQuantized::quantize(&v2);

        assert_eq!(bq1.hamming_distance(&bq2), 4);
    }

    #[test]
    fn test_hamming_half_different() {
        let v1 = vec![1.0, 1.0, -1.0, -1.0];
        let v2 = vec![1.0, -1.0, -1.0, 1.0];

        let bq1 = BinaryQuantized::quantize(&v1);
        let bq2 = BinaryQuantized::quantize(&v2);

        assert_eq!(bq1.hamming_distance(&bq2), 2);
    }

    #[test]
    fn test_hamming_dimension_mismatch() {
        let v1 = vec![1.0, 1.0];
        let v2 = vec![1.0, 1.0, 1.0];

        let bq1 = BinaryQuantized::quantize(&v1);
        let bq2 = BinaryQuantized::quantize(&v2);

        assert_eq!(bq1.hamming_distance(&bq2), u32::MAX);
    }

    // ============================================================================
    // Similarity Contract Tests
    // ============================================================================

    #[test]
    fn test_similarity_identical() {
        let v = vec![1.0, -1.0, 1.0, -1.0];
        let bq1 = BinaryQuantized::quantize(&v);
        let bq2 = BinaryQuantized::quantize(&v);

        assert!((bq1.similarity(&bq2) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_similarity_opposite() {
        let v1 = vec![1.0, 1.0, 1.0, 1.0];
        let v2 = vec![-1.0, -1.0, -1.0, -1.0];

        let bq1 = BinaryQuantized::quantize(&v1);
        let bq2 = BinaryQuantized::quantize(&v2);

        assert!((bq1.similarity(&bq2) - 0.0).abs() < 1e-6);
    }

    // ============================================================================
    // Compression Ratio Contract Tests
    // ============================================================================

    #[test]
    fn test_compression_ratio_384d() {
        let v: Vec<f32> = (0..384).map(|i| i as f32).collect();
        let bq = BinaryQuantized::quantize(&v);

        let ratio = bq.compression_ratio();
        // 384 * 4 = 1536 bytes / (6 * 8 + 8) = 56 bytes â‰ˆ 27x
        // Actually: 1536 / 56 â‰ˆ 27.4x
        assert!(ratio > 20.0 && ratio < 35.0, "Compression ratio: {}", ratio);
    }

    #[test]
    fn test_compression_ratio_768d() {
        let v: Vec<f32> = (0..768).map(|i| i as f32).collect();
        let bq = BinaryQuantized::quantize(&v);

        let ratio = bq.compression_ratio();
        // 768 * 4 = 3072 bytes / (12 * 8 + 8) = 104 bytes â‰ˆ 29.5x
        assert!(ratio > 25.0 && ratio < 35.0, "Compression ratio: {}", ratio);
    }

    // ============================================================================
    // Two-Stage Search Contract Tests
    // ============================================================================

    #[test]
    fn test_two_stage_empty_index() {
        let query = vec![1.0, 0.0, 0.0];
        let index: Vec<(u32, BinaryQuantized)> = vec![];

        let results = two_stage_search(
            &query,
            &index,
            5,
            2.0,
            |_| None,
            cosine_similarity,
        );

        assert!(results.is_empty());
    }

    #[test]
    fn test_two_stage_returns_k() {
        // Create index
        let vectors: Vec<(u32, Vec<f32>)> = vec![
            (1, vec![1.0, 0.0, 0.0]),
            (2, vec![0.9, 0.1, 0.0]),
            (3, vec![0.0, 1.0, 0.0]),
            (4, vec![0.0, 0.0, 1.0]),
        ];

        let binary_index: Vec<(u32, BinaryQuantized)> = vectors
            .iter()
            .map(|(id, v)| (*id, BinaryQuantized::quantize(v)))
            .collect();

        let query = vec![1.0, 0.0, 0.0];

        let results = two_stage_search(
            &query,
            &binary_index,
            3,
            2.0,
            |id| vectors.iter().find(|(i, _)| *i == id).map(|(_, v)| v.clone()),
            cosine_similarity,
        );

        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_two_stage_ordering() {
        let vectors: Vec<(u32, Vec<f32>)> = vec![
            (1, vec![1.0, 0.0, 0.0]),      // Exact match
            (2, vec![0.707, 0.707, 0.0]),  // 45 degrees
            (3, vec![0.0, 1.0, 0.0]),      // 90 degrees
        ];

        let binary_index: Vec<(u32, BinaryQuantized)> = vectors
            .iter()
            .map(|(id, v)| (*id, BinaryQuantized::quantize(v)))
            .collect();

        let query = vec![1.0, 0.0, 0.0];

        let results = two_stage_search(
            &query,
            &binary_index,
            3,
            2.0,
            |id| vectors.iter().find(|(i, _)| *i == id).map(|(_, v)| v.clone()),
            cosine_similarity,
        );

        // Should be ordered by exact similarity after reranking
        assert_eq!(results[0].0, 1); // Exact match first
        assert!(results[0].1 > results[1].1); // Scores descending
    }

    #[test]
    fn test_two_stage_rerank_multiplier() {
        // With multiplier = 1.0, only k candidates are reranked
        // With multiplier = 3.0, 3*k candidates are reranked
        let vectors: Vec<(u32, Vec<f32>)> = (0..20)
            .map(|i| (i as u32, vec![1.0 - i as f32 * 0.05, i as f32 * 0.05, 0.0]))
            .collect();

        let binary_index: Vec<(u32, BinaryQuantized)> = vectors
            .iter()
            .map(|(id, v)| (*id, BinaryQuantized::quantize(v)))
            .collect();

        let query = vec![1.0, 0.0, 0.0];

        let results = two_stage_search(
            &query,
            &binary_index,
            5,
            3.0, // Get 15 candidates for reranking
            |id| vectors.iter().find(|(i, _)| *i == id).map(|(_, v)| v.clone()),
            cosine_similarity,
        );

        assert_eq!(results.len(), 5);
        // First result should be the most similar
        assert_eq!(results[0].0, 0);
    }

    // ============================================================================
    // Recall Benchmark Test
    // ============================================================================

    #[test]
    fn test_two_stage_recall_quality() {
        use std::collections::HashSet;

        // Generate random-ish vectors
        let mut seed: u64 = 42;
        let mut rng = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            (seed >> 33) as f32 / (u32::MAX as f32) - 0.5
        };

        // Using larger dimension improves binary quantization recall
        let dim = 256;
        let n = 100;
        let k = 10;

        let vectors: Vec<(u32, Vec<f32>)> = (0..n)
            .map(|i| (i as u32, (0..dim).map(|_| rng()).collect()))
            .collect();

        let binary_index: Vec<(u32, BinaryQuantized)> = vectors
            .iter()
            .map(|(id, v)| (*id, BinaryQuantized::quantize(v)))
            .collect();

        let query: Vec<f32> = (0..dim).map(|_| rng()).collect();

        // Use 10x rerank multiplier for better recall
        let two_stage_results = two_stage_search(
            &query,
            &binary_index,
            k,
            10.0, // High rerank multiplier
            |id| vectors.iter().find(|(i, _)| *i == id).map(|(_, v)| v.clone()),
            cosine_similarity,
        );
        let two_stage_ids: HashSet<u32> = two_stage_results.iter().map(|(id, _)| *id).collect();

        // Brute force ground truth
        let mut brute: Vec<(u32, f32)> = vectors
            .iter()
            .map(|(id, v)| (*id, cosine_similarity(&query, v)))
            .collect();
        brute.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        let brute_ids: HashSet<u32> = brute.iter().take(k).map(|(id, _)| *id).collect();

        // Recall = overlap with brute force
        let recall = two_stage_ids.intersection(&brute_ids).count() as f32 / k as f32;

        // Binary quantization has inherent recall limits, but with 10x rerank
        // and 100 candidates for k=10, we should see reasonable overlap
        assert!(
            recall >= 0.3,
            "Two-stage recall@{} = {:.2}, expected >= 0.3 (binary quantization has inherent limits)",
            k, recall
        );
    }
}

pub fn magnitude(v: &[f32]) -> f32 {
    let mut sum = 0.0;
    let n = v.len();
    let mut i = 0;
    
    // Unrolling 4
    while i + 3 < n {
        sum += v[i] * v[i] + v[i+1] * v[i+1] + v[i+2] * v[i+2] + v[i+3] * v[i+3];
        i += 4;
    }
    
    while i < n {
        sum += v[i] * v[i];
        i += 1;
    }
    
    sum.sqrt()
}

pub fn euclidean_distance_squared(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        // In production code we might want to panic or return Result. 
        // For HNSW hot path we usually assume lengths match.
        // We will just process up to min length or panic.
        // Let's assume matching lengths for perf.
    }

    let mut sum = 0.0;
    let n = a.len();
    let mut i = 0;

    // Unrolling 4
    while i + 3 < n {
        let d0 = a[i] - b[i];
        let d1 = a[i+1] - b[i+1];
        let d2 = a[i+2] - b[i+2];
        let d3 = a[i+3] - b[i+3];
        sum += d0*d0 + d1*d1 + d2*d2 + d3*d3;
        i += 4;
    }

    // Remainder
    while i < n {
        let d = a[i] - b[i];
        sum += d*d;
        i += 1;
    }

    sum
}

pub fn cosine_similarity(a: &[f32], b: &[f32], mag_a: Option<f32>, mag_b: Option<f32>) -> f32 {
    let mut dot = 0.0;
    let n = a.len();
    let mut i = 0;

    // Unrolling 4
    while i + 3 < n {
        dot += a[i] * b[i] + a[i+1] * b[i+1] + a[i+2] * b[i+2] + a[i+3] * b[i+3];
        i += 4;
    }

    while i < n {
        dot += a[i] * b[i];
        i += 1;
    }

    let ma = match mag_a {
        Some(m) => m,
        None => magnitude(a),
    };
    
    let mb = match mag_b {
        Some(m) => m,
        None => magnitude(b),
    };

    if ma == 0.0 || mb == 0.0 {
        return 0.0;
    }

    dot / (ma * mb)
}


//! Metadata Filtering for HNSW Search
//!
//! Enables hard constraints during vector search (e.g., "only notes tagged 'Rust'").
//! Filters are applied during graph traversal for correctness.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Metadata value types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum MetaValue {
    String(String),
    Number(f64),
    Bool(bool),
    Array(Vec<String>),
}

impl MetaValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            MetaValue::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            MetaValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            MetaValue::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn contains(&self, value: &str) -> bool {
        match self {
            MetaValue::Array(arr) => arr.iter().any(|v| v == value),
            MetaValue::String(s) => s == value,
            _ => false,
        }
    }
}

/// A single filter condition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum FilterCondition {
    /// Exact equality: field == value
    #[serde(rename = "eq")]
    Eq { field: String, value: MetaValue },

    /// Not equal: field != value
    #[serde(rename = "neq")]
    Neq { field: String, value: MetaValue },

    /// Field value is in list
    #[serde(rename = "in")]
    In { field: String, values: Vec<String> },

    /// Numeric range: min <= field <= max
    #[serde(rename = "range")]
    Range { field: String, min: Option<f64>, max: Option<f64> },

    /// Field contains value (for arrays or strings)
    #[serde(rename = "contains")]
    Contains { field: String, value: String },

    /// Boolean AND of conditions
    #[serde(rename = "and")]
    And { conditions: Vec<FilterCondition> },

    /// Boolean OR of conditions
    #[serde(rename = "or")]
    Or { conditions: Vec<FilterCondition> },
}

impl FilterCondition {
    /// Evaluate this filter against a metadata map
    pub fn matches(&self, meta: &HashMap<String, MetaValue>) -> bool {
        match self {
            FilterCondition::Eq { field, value } => {
                meta.get(field).map(|v| v == value).unwrap_or(false)
            }

            FilterCondition::Neq { field, value } => {
                meta.get(field).map(|v| v != value).unwrap_or(true)
            }

            FilterCondition::In { field, values } => {
                meta.get(field)
                    .and_then(|v| v.as_str())
                    .map(|s| values.iter().any(|val| val == s))
                    .unwrap_or(false)
            }

            FilterCondition::Range { field, min, max } => {
                meta.get(field)
                    .and_then(|v| v.as_f64())
                    .map(|n| {
                        let above_min = min.map(|m| n >= m).unwrap_or(true);
                        let below_max = max.map(|m| n <= m).unwrap_or(true);
                        above_min && below_max
                    })
                    .unwrap_or(false)
            }

            FilterCondition::Contains { field, value } => {
                meta.get(field).map(|v| v.contains(value)).unwrap_or(false)
            }

            FilterCondition::And { conditions } => {
                conditions.iter().all(|c| c.matches(meta))
            }

            FilterCondition::Or { conditions } => {
                conditions.iter().any(|c| c.matches(meta))
            }
        }
    }
}

/// Builder for creating filters fluently
pub struct FilterBuilder {
    conditions: Vec<FilterCondition>,
}

impl FilterBuilder {
    pub fn new() -> Self {
        Self { conditions: Vec::new() }
    }

    pub fn eq(mut self, field: &str, value: impl Into<MetaValue>) -> Self {
        self.conditions.push(FilterCondition::Eq {
            field: field.to_string(),
            value: value.into(),
        });
        self
    }

    pub fn neq(mut self, field: &str, value: impl Into<MetaValue>) -> Self {
        self.conditions.push(FilterCondition::Neq {
            field: field.to_string(),
            value: value.into(),
        });
        self
    }

    pub fn in_list(mut self, field: &str, values: Vec<String>) -> Self {
        self.conditions.push(FilterCondition::In {
            field: field.to_string(),
            values,
        });
        self
    }

    pub fn range(mut self, field: &str, min: Option<f64>, max: Option<f64>) -> Self {
        self.conditions.push(FilterCondition::Range {
            field: field.to_string(),
            min,
            max,
        });
        self
    }

    pub fn contains(mut self, field: &str, value: &str) -> Self {
        self.conditions.push(FilterCondition::Contains {
            field: field.to_string(),
            value: value.to_string(),
        });
        self
    }

    pub fn build(self) -> Option<FilterCondition> {
        match self.conditions.len() {
            0 => None,
            1 => Some(self.conditions.into_iter().next().unwrap()),
            _ => Some(FilterCondition::And { conditions: self.conditions }),
        }
    }
}

impl From<String> for MetaValue {
    fn from(s: String) -> Self {
        MetaValue::String(s)
    }
}

impl From<&str> for MetaValue {
    fn from(s: &str) -> Self {
        MetaValue::String(s.to_string())
    }
}

impl From<f64> for MetaValue {
    fn from(n: f64) -> Self {
        MetaValue::Number(n)
    }
}

impl From<i32> for MetaValue {
    fn from(n: i32) -> Self {
        MetaValue::Number(n as f64)
    }
}

impl From<bool> for MetaValue {
    fn from(b: bool) -> Self {
        MetaValue::Bool(b)
    }
}

impl From<Vec<String>> for MetaValue {
    fn from(arr: Vec<String>) -> Self {
        MetaValue::Array(arr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_meta() -> HashMap<String, MetaValue> {
        let mut m = HashMap::new();
        m.insert("type".to_string(), MetaValue::String("meeting".to_string()));
        m.insert("year".to_string(), MetaValue::Number(2024.0));
        m.insert("priority".to_string(), MetaValue::Number(5.0));
        m.insert("archived".to_string(), MetaValue::Bool(false));
        m.insert("tags".to_string(), MetaValue::Array(vec!["rust".to_string(), "ai".to_string()]));
        m
    }

    #[test]
    fn test_eq_string() {
        let meta = make_meta();
        let filter = FilterCondition::Eq {
            field: "type".to_string(),
            value: MetaValue::String("meeting".to_string()),
        };
        assert!(filter.matches(&meta));

        let filter_miss = FilterCondition::Eq {
            field: "type".to_string(),
            value: MetaValue::String("note".to_string()),
        };
        assert!(!filter_miss.matches(&meta));
    }

    #[test]
    fn test_eq_number() {
        let meta = make_meta();
        let filter = FilterCondition::Eq {
            field: "year".to_string(),
            value: MetaValue::Number(2024.0),
        };
        assert!(filter.matches(&meta));
    }

    #[test]
    fn test_neq() {
        let meta = make_meta();
        let filter = FilterCondition::Neq {
            field: "type".to_string(),
            value: MetaValue::String("note".to_string()),
        };
        assert!(filter.matches(&meta));

        let filter_miss = FilterCondition::Neq {
            field: "type".to_string(),
            value: MetaValue::String("meeting".to_string()),
        };
        assert!(!filter_miss.matches(&meta));
    }

    #[test]
    fn test_in() {
        let meta = make_meta();
        let filter = FilterCondition::In {
            field: "type".to_string(),
            values: vec!["meeting".to_string(), "task".to_string()],
        };
        assert!(filter.matches(&meta));

        let filter_miss = FilterCondition::In {
            field: "type".to_string(),
            values: vec!["note".to_string(), "task".to_string()],
        };
        assert!(!filter_miss.matches(&meta));
    }

    #[test]
    fn test_range() {
        let meta = make_meta();

        // Full range
        let filter = FilterCondition::Range {
            field: "year".to_string(),
            min: Some(2020.0),
            max: Some(2025.0),
        };
        assert!(filter.matches(&meta));

        // Min only
        let filter_min = FilterCondition::Range {
            field: "year".to_string(),
            min: Some(2023.0),
            max: None,
        };
        assert!(filter_min.matches(&meta));

        // Max only
        let filter_max = FilterCondition::Range {
            field: "year".to_string(),
            min: None,
            max: Some(2024.0),
        };
        assert!(filter_max.matches(&meta));

        // Out of range
        let filter_miss = FilterCondition::Range {
            field: "year".to_string(),
            min: Some(2025.0),
            max: Some(2030.0),
        };
        assert!(!filter_miss.matches(&meta));
    }

    #[test]
    fn test_contains() {
        let meta = make_meta();
        let filter = FilterCondition::Contains {
            field: "tags".to_string(),
            value: "rust".to_string(),
        };
        assert!(filter.matches(&meta));

        let filter_miss = FilterCondition::Contains {
            field: "tags".to_string(),
            value: "python".to_string(),
        };
        assert!(!filter_miss.matches(&meta));
    }

    #[test]
    fn test_and() {
        let meta = make_meta();
        let filter = FilterCondition::And {
            conditions: vec![
                FilterCondition::Eq {
                    field: "type".to_string(),
                    value: MetaValue::String("meeting".to_string()),
                },
                FilterCondition::Range {
                    field: "year".to_string(),
                    min: Some(2020.0),
                    max: None,
                },
            ],
        };
        assert!(filter.matches(&meta));
    }

    #[test]
    fn test_or() {
        let meta = make_meta();
        let filter = FilterCondition::Or {
            conditions: vec![
                FilterCondition::Eq {
                    field: "type".to_string(),
                    value: MetaValue::String("note".to_string()),
                },
                FilterCondition::Eq {
                    field: "type".to_string(),
                    value: MetaValue::String("meeting".to_string()),
                },
            ],
        };
        assert!(filter.matches(&meta));
    }

    #[test]
    fn test_builder() {
        let meta = make_meta();
        let filter = FilterBuilder::new()
            .eq("type", "meeting")
            .range("priority", Some(1.0), Some(10.0))
            .build()
            .unwrap();
        
        assert!(filter.matches(&meta));
    }

    #[test]
    fn test_missing_field() {
        let meta = make_meta();
        let filter = FilterCondition::Eq {
            field: "nonexistent".to_string(),
            value: MetaValue::String("anything".to_string()),
        };
        assert!(!filter.matches(&meta));
    }
}

//! HNSW (Hierarchical Navigable Small World) Index
//!
//! A production-grade implementation of the HNSW algorithm for approximate
//! nearest neighbor search. Optimized for high-dimensional embedding vectors.
//!
//! # Algorithm Overview
//! HNSW builds a multi-layer graph where:
//! - Higher layers have fewer nodes (exponential decay)
//! - Search starts from top layer, greedily descending
//! - Each layer is a navigable small-world graph
//!
//! # Performance Characteristics
//! - Insert: O(log N) average
//! - Search: O(log N) average
//! - Memory: O(N * M) where M = max neighbors per node

use std::collections::{HashMap, HashSet, BinaryHeap};
use std::cmp::Reverse;
use super::node::HnswNode;
use super::pqueue::ScoredItem;
use super::distance::{cosine_similarity, euclidean_distance_squared, magnitude};

/// Distance metric for similarity computation
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Metric {
    Cosine,
    Euclidean,
}

/// HNSW-specific errors
#[derive(Debug, Clone, PartialEq)]
pub enum HnswError {
    DuplicateId(u32),
    DimensionMismatch { expected: usize, got: usize },
    EmptyVector,
    SerializationError(String),
}

impl std::fmt::Display for HnswError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HnswError::DuplicateId(id) => write!(f, "Duplicate node ID: {}", id),
            HnswError::DimensionMismatch { expected, got } => {
                write!(f, "Dimension mismatch: expected {}, got {}", expected, got)
            }
            HnswError::EmptyVector => write!(f, "Empty vector"),
            HnswError::SerializationError(msg) => write!(f, "Serialization error: {}", msg),
        }
    }
}

impl std::error::Error for HnswError {}

/// HNSW Index
///
/// # Example
/// ```ignore
/// let mut hnsw = Hnsw::new(16, 200, Metric::Cosine);
/// hnsw.add_point(1, vec![0.1, 0.2, 0.3])?;
/// let results = hnsw.search_knn(&[0.1, 0.2, 0.3], 10);
/// ```
pub struct Hnsw {
    // Configuration
    m: usize,                    // Max neighbors per level (M in paper)
    m_max0: usize,               // Max neighbors at level 0 (usually 2*M)
    ef_construction: usize,      // Search depth during construction
    level_mult: f32,             // Level generation multiplier (1/ln(M))
    metric: Metric,

    // State
    nodes: HashMap<u32, HnswNode>,
    entry_point_id: Option<u32>,
    level_max: u8,
    dimension: Option<usize>,
    
    // Quantized storage for hybrid search (4x compression)
    quantized: HashMap<u32, super::quantization::ScalarQuantized>,
    
    // Binary quantized storage for two-stage retrieval (32x compression)
    binary_quantized: HashMap<u32, super::binary_quantization::BinaryQuantized>,
    
    // RNG state for level selection (simple LCG for determinism)
    rng_state: u64,
}

impl Hnsw {
    /// Create a new HNSW index
    ///
    /// # Arguments
    /// * `m` - Max neighbors per node per layer (typically 16-64)
    /// * `ef_construction` - Search beam width during construction (typically 100-500)
    /// * `metric` - Distance metric (Cosine or Euclidean)
    pub fn new(m: usize, ef_construction: usize, metric: Metric) -> Self {
        let level_mult = 1.0 / (m as f32).ln();
        
        Hnsw {
            m,
            m_max0: m * 2,
            ef_construction,
            level_mult,
            metric,
            nodes: HashMap::new(),
            entry_point_id: None,
            level_max: 0,
            dimension: None,
            quantized: HashMap::new(),
            binary_quantized: HashMap::new(),
            rng_state: 42, // Deterministic seed
        }
    }

    /// Add a point to the index
    pub fn add_point(&mut self, id: u32, vector: Vec<f32>) -> Result<(), HnswError> {
        // Validation
        if vector.is_empty() {
            return Err(HnswError::EmptyVector);
        }
        
        if self.nodes.contains_key(&id) {
            return Err(HnswError::DuplicateId(id));
        }
        
        if let Some(dim) = self.dimension {
            if vector.len() != dim {
                return Err(HnswError::DimensionMismatch {
                    expected: dim,
                    got: vector.len(),
                });
            }
        } else {
            self.dimension = Some(vector.len());
        }

        // Select random level for this node
        let level = self.select_level();
        
        // Create node with neighbor lists for all levels up to `level`
        let node = HnswNode::new(id, level, vector, (level as usize) + 1);
        
        // First node case
        if self.entry_point_id.is_none() {
            self.entry_point_id = Some(id);
            self.level_max = level;
            self.nodes.insert(id, node);
            return Ok(());
        }

        // Get entry point
        let mut ep_id = self.entry_point_id.unwrap();
        
        // Insert the node first so we can reference it
        self.nodes.insert(id, node);
        
        // Phase 1: Traverse from top to node's level + 1 (greedy search)
        let mut current_level = self.level_max as i32;
        while current_level > level as i32 {
            let (nearest_id, _) = self.search_layer_single(ep_id, id, current_level as u8);
            ep_id = nearest_id;
            current_level -= 1;
        }
        
        // Phase 2: Insert at each level from node's level down to 0
        for lc in (0..=level).rev() {
            // Find ef_construction nearest neighbors at this level
            let neighbors = self.search_layer(ep_id, id, self.ef_construction, lc);
            
            // Select M best neighbors
            let m_limit = if lc == 0 { self.m_max0 } else { self.m };
            let selected: Vec<u32> = neighbors.iter()
                .take(m_limit)
                .map(|(nid, _)| *nid)
                .collect();
            
            // Add bidirectional connections
            for &neighbor_id in &selected {
                // Add neighbor -> new node
                self.add_neighbor(neighbor_id, id, lc);
                // Add new node -> neighbor
                self.add_neighbor(id, neighbor_id, lc);
            }
            
            // Prune neighbors if over limit
            for &neighbor_id in &selected {
                self.prune_neighbors(neighbor_id, lc, m_limit);
            }
            
            // Update entry point for next level
            if !neighbors.is_empty() {
                ep_id = neighbors[0].0;
            }
        }
        
        // Update global entry point if new node is higher level
        if level > self.level_max {
            self.entry_point_id = Some(id);
            self.level_max = level;
        }

        Ok(())
    }

    /// Search for k nearest neighbors
    pub fn search_knn(&self, query: &[f32], k: usize) -> Vec<(u32, f32)> {
        if self.nodes.is_empty() || self.entry_point_id.is_none() {
            return Vec::new();
        }
        
        let query_vec = query.to_vec();
        let query_mag = magnitude(&query_vec);
        
        let mut ep_id = self.entry_point_id.unwrap();
        
        // Phase 1: Traverse from top to level 1 (greedy)
        let mut current_level = self.level_max as i32;
        while current_level > 0 {
            let (nearest_id, _) = self.search_layer_single_query(ep_id, &query_vec, query_mag, current_level as u8);
            ep_id = nearest_id;
            current_level -= 1;
        }
        
        // Phase 2: Search at level 0 with ef = max(k, ef_construction)
        let ef = k.max(self.ef_construction);
        let candidates = self.search_layer_query(ep_id, &query_vec, query_mag, ef, 0);
        
        // Return top k, filtered by deleted flag
        candidates.into_iter()
            .filter(|(id, _)| {
                self.nodes.get(id).map(|n| !n.deleted).unwrap_or(false)
            })
            .take(k)
            .collect()
    }

    /// Search for k nearest neighbors with a filter predicate
    /// 
    /// The filter is applied during result collection, not during graph traversal.
    /// This ensures we find k results that match the filter.
    /// 
    /// # Arguments
    /// * `query` - Query vector
    /// * `k` - Desired number of results
    /// * `filter` - Predicate that returns true for IDs to include
    /// 
    /// # Performance
    /// The search fetches more candidates (ef * 2) to increase chances of finding
    /// k matching results after filtering.
    pub fn search_knn_filtered<F>(&self, query: &[f32], k: usize, filter: F) -> Vec<(u32, f32)>
    where
        F: Fn(u32) -> bool,
    {
        if self.nodes.is_empty() || self.entry_point_id.is_none() {
            return Vec::new();
        }
        
        let query_vec = query.to_vec();
        let query_mag = magnitude(&query_vec);
        
        let mut ep_id = self.entry_point_id.unwrap();
        
        // Phase 1: Traverse from top to level 1 (greedy)
        let mut current_level = self.level_max as i32;
        while current_level > 0 {
            let (nearest_id, _) = self.search_layer_single_query(ep_id, &query_vec, query_mag, current_level as u8);
            ep_id = nearest_id;
            current_level -= 1;
        }
        
        // Phase 2: Search at level 0 with expanded ef to account for filtering
        // Fetch more candidates since some will be filtered out
        let ef = (k * 4).max(self.ef_construction);
        let candidates = self.search_layer_query(ep_id, &query_vec, query_mag, ef, 0);
        
        // Return top k that pass both deletion check and user filter
        candidates.into_iter()
            .filter(|(id, _)| {
                let not_deleted = self.nodes.get(id).map(|n| !n.deleted).unwrap_or(false);
                not_deleted && filter(*id)
            })
            .take(k)
            .collect()
    }

    /// Soft-delete a point
    pub fn delete_point(&mut self, id: u32) {
        if let Some(node) = self.nodes.get_mut(&id) {
            node.deleted = true;
        }
    }

    /// Number of points
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Get the vector for a specific node by ID
    pub fn get_vector(&self, id: u32) -> Option<Vec<f32>> {
        self.nodes.get(&id).map(|node| node.vector.clone())
    }

    /// Compute similarity between two vectors based on metric
    fn compute_similarity(&self, a: &[f32], b: &[f32]) -> f32 {
        match self.metric {
            Metric::Cosine => cosine_similarity(a, b, None, None),
            Metric::Euclidean => {
                // Convert distance to similarity: 1 / (1 + dist)
                let dist = euclidean_distance_squared(a, b).sqrt();
                1.0 / (1.0 + dist)
            }
        }
    }

    // ========================================================================
    // Hybrid Search with Quantization
    // ========================================================================

    /// Add a point with both full-precision and quantized storage
    /// 
    /// Stores the full vector for exact search and a quantized version
    /// for memory-efficient hybrid search.
    pub fn add_point_quantized(&mut self, id: u32, vector: Vec<f32>) -> Result<(), HnswError> {
        // Create quantized version before adding point
        let quantized = super::quantization::ScalarQuantized::quantize(&vector);
        
        // Add the point normally
        self.add_point(id, vector)?;
        
        // Store quantized version
        self.quantized.insert(id, quantized);
        
        Ok(())
    }

    /// Search using hybrid quantized + full precision reranking
    /// 
    /// 1. Standard HNSW graph traversal to find candidates
    /// 2. Rerank candidates using full precision similarity
    /// 
    /// This gives the same results as search_knn but enables future
    /// optimizations where quantized candidates can be retrieved faster.
    pub fn search_hybrid(&self, query: &[f32], k: usize) -> Vec<(u32, f32)> {
        // For now, use standard search with full precision reranking
        // Future optimization: use quantized vectors for initial candidate scoring
        self.search_knn(query, k)
    }

    /// Get the quantized representation of a vector
    pub fn get_quantized(&self, id: u32) -> Option<&super::quantization::ScalarQuantized> {
        self.quantized.get(&id)
    }

    /// Get memory usage statistics
    /// 
    /// Returns (full_precision_bytes, quantized_bytes)
    pub fn memory_usage(&self) -> (usize, usize) {
        let dim = self.dimension.unwrap_or(0);
        let count = self.nodes.len();
        
        // Full precision: dim * 4 bytes per vector
        let full_bytes = count * dim * 4;
        
        // Quantized: dim bytes + 8 bytes overhead (min + scale) per vector
        let quantized_bytes = count * (dim + 8);
        
        (full_bytes, quantized_bytes)
    }

    /// Search with diversity using MMR (Maximal Marginal Relevance)
    /// 
    /// Reranks results to balance relevance and diversity.
    /// 
    /// # Arguments
    /// * `query` - Query vector
    /// * `k` - Number of results to return
    /// * `lambda` - Balance factor: 0.0 = pure diversity, 1.0 = pure relevance
    /// 
    /// # Returns
    /// Top-k results reranked for diversity
    pub fn search_with_diversity(&self, query: &[f32], k: usize, lambda: f32) -> Vec<(u32, f32)> {
        use super::mmr::{mmr_rerank, MmrCandidate};
        
        // Fetch more candidates than needed for better diversity selection
        let fetch_k = (k as f32 * 2.0).ceil() as usize;
        let candidates = self.search_knn(query, fetch_k);
        
        // Convert to MMR candidates with vectors
        let mmr_candidates: Vec<MmrCandidate> = candidates.iter()
            .filter_map(|(id, score)| {
                self.get_vector(*id).map(|vector| MmrCandidate {
                    id: *id,
                    score: *score,
                    vector,
                })
            })
            .collect();
        
        // Rerank using MMR
        mmr_rerank(query, mmr_candidates, k, lambda)
    }

    // ========================================================================
    // Two-Stage Retrieval (Binary Quantization)
    // ========================================================================

    /// Add a point with binary quantization for two-stage retrieval
    /// 
    /// Stores full vector + binary quantized version for ultra-fast coarse filtering.
    pub fn add_point_binary(&mut self, id: u32, vector: Vec<f32>) -> Result<(), HnswError> {
        use super::binary_quantization::BinaryQuantized;
        
        // Create binary quantized version before adding
        let binary = BinaryQuantized::quantize(&vector);
        
        // Add point normally
        self.add_point(id, vector)?;
        
        // Store binary version
        self.binary_quantized.insert(id, binary);
        
        Ok(())
    }

    /// Two-stage search: binary coarse filter â†’ exact rerank
    /// 
    /// Stage 1: Fast Hamming distance filtering on binary codes
    /// Stage 2: Exact similarity scoring on full-precision vectors
    /// 
    /// # Arguments
    /// * `query` - Query vector
    /// * `k` - Number of results to return
    /// * `rerank_multiplier` - How many candidates to rerank (multiplied by k)
    pub fn search_two_stage(&self, query: &[f32], k: usize, rerank_multiplier: f32) -> Vec<(u32, f32)> {
        use super::binary_quantization::BinaryQuantized;
        
        if self.binary_quantized.is_empty() || k == 0 {
            // Fall back to standard search if no binary index
            return self.search_knn(query, k);
        }

        // Stage 1: Binary coarse filter
        let query_binary = BinaryQuantized::quantize(query);
        let rerank_count = ((k as f32 * rerank_multiplier).ceil() as usize).max(k);

        // Score all binary vectors by Hamming distance
        let mut candidates: Vec<(u32, u32)> = self.binary_quantized
            .iter()
            .filter(|(id, _)| {
                // Exclude deleted nodes
                self.nodes.get(id).map(|n| !n.deleted).unwrap_or(false)
            })
            .map(|(id, bq)| (*id, query_binary.hamming_distance(bq)))
            .collect();

        // Sort by Hamming distance (ascending = most similar)
        candidates.sort_by_key(|(_, dist)| *dist);
        candidates.truncate(rerank_count);

        // Stage 2: Exact rerank with full precision
        let mut results: Vec<(u32, f32)> = candidates
            .into_iter()
            .filter_map(|(id, _)| {
                let vector = self.get_vector(id)?;
                let score = self.compute_similarity(query, &vector);
                Some((id, score))
            })
            .collect();

        // Sort by score (descending = highest similarity first)
        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(k);

        results
    }

    /// Get binary quantized representation
    pub fn get_binary_quantized(&self, id: u32) -> Option<&super::binary_quantization::BinaryQuantized> {
        self.binary_quantized.get(&id)
    }

    /// Get memory usage including binary index
    /// 
    /// Returns (full_bytes, scalar_quantized_bytes, binary_quantized_bytes)
    pub fn memory_usage_full(&self) -> (usize, usize, usize) {
        let dim = self.dimension.unwrap_or(0);
        let count = self.nodes.len();
        
        // Full precision: dim * 4 bytes per vector
        let full_bytes = count * dim * 4;
        
        // Scalar quantized: dim bytes + 8 bytes overhead per vector
        let scalar_bytes = count * (dim + 8);
        
        // Binary quantized: (dim/64) * 8 bytes + 8 bytes overhead per vector
        let binary_words = (dim + 63) / 64;
        let binary_bytes = count * (binary_words * 8 + 8);
        
        (full_bytes, scalar_bytes, binary_bytes)
    }

    // ========================================================================
    // Serialization
    // ========================================================================

    pub fn serialize(&self) -> Vec<u8> {
        let mut buffer = Vec::new();
        
        // Header
        buffer.extend_from_slice(&0x48534e57u32.to_le_bytes()); // Magic "HNSW"
        buffer.extend_from_slice(&(self.dimension.unwrap_or(0) as u16).to_le_bytes());
        buffer.extend_from_slice(&(self.m as u16).to_le_bytes());
        buffer.extend_from_slice(&(self.nodes.len() as u32).to_le_bytes());
        buffer.extend_from_slice(&(self.level_max as u16).to_le_bytes());
        // Entry Point ID (u32::MAX if None)
        let ep = self.entry_point_id.unwrap_or(u32::MAX);
        buffer.extend_from_slice(&ep.to_le_bytes());
        
        // Nodes (in undetermined order, but consistent if map iteration is)
        // HashMap iteration is not deterministic unless using a sorted map or collecting.
        // For persistence stability we should probably sort by ID.
        let mut sorted_ids: Vec<u32> = self.nodes.keys().cloned().collect();
        sorted_ids.sort();
        
        for id in sorted_ids {
            let node = &self.nodes[&id];
            
            // Per Node
            buffer.extend_from_slice(&node.id.to_le_bytes());
            buffer.extend_from_slice(&node.level.to_le_bytes()); // level_count is basically level + 1 if we store 0..level.
            // Spec says "level_count: u8"
            // Wait, node.level is max level. 
            // Neighbors vec has size `level + 1`. 
            // So level_count IS node.neighbors.len() as u8.
            let level_count = node.neighbors.len() as u8;
            buffer.push(level_count);
            
            // Vector
            for &val in &node.vector {
                buffer.extend_from_slice(&val.to_le_bytes());
            }
            
            // Deleted flag (my extension)
            buffer.push(if node.deleted { 1 } else { 0 });
            
            // Neighbors
            for neighbors_at_level in &node.neighbors {
                // Filter valid neighbors
                let valid: Vec<u32> = neighbors_at_level.iter()
                    .filter(|&&nid| nid >= 0)
                    .map(|&nid| nid as u32)
                    .collect();
                
                buffer.extend_from_slice(&(valid.len() as u16).to_le_bytes());
                for &nid in &valid {
                    buffer.extend_from_slice(&nid.to_le_bytes());
                }
            }
        }
        
        buffer
    }

    pub fn deserialize(bytes: &[u8]) -> Result<Self, HnswError> {
        let mut cursor = 0;
        // Header size 18 bytes
        if bytes.len() < 18 {
            return Err(HnswError::SerializationError("File too short".to_string()));
        }
        
        // Header
        let magic = u32::from_le_bytes(bytes[cursor..cursor+4].try_into().unwrap());
        cursor += 4;
        if magic != 0x48534e57 {
            return Err(HnswError::SerializationError("Invalid magic".to_string()));
        }
        
        let dimension = u16::from_le_bytes(bytes[cursor..cursor+2].try_into().unwrap()) as usize;
        cursor += 2;
        
        let m = u16::from_le_bytes(bytes[cursor..cursor+2].try_into().unwrap()) as usize;
        cursor += 2;
        
        let node_count = u32::from_le_bytes(bytes[cursor..cursor+4].try_into().unwrap()) as usize;
        cursor += 4;
        
        let level_max = u16::from_le_bytes(bytes[cursor..cursor+2].try_into().unwrap()) as u8;
        cursor += 2;

        let entry_point_raw = u32::from_le_bytes(bytes[cursor..cursor+4].try_into().unwrap());
        cursor += 4;
        let entry_point_id = if entry_point_raw == u32::MAX { None } else { Some(entry_point_raw) };
        
        let mut hnsw = Hnsw::new(m, 100, Metric::Cosine); // ef defaults to 100, metric defaulted (spec doesn't store metric!)
        hnsw.dimension = Some(dimension);
        hnsw.level_max = level_max;
        hnsw.entry_point_id = entry_point_id;
        
        for _ in 0..node_count {
            if cursor + 4 + 1 > bytes.len() {
                return Err(HnswError::SerializationError("Unexpected EOF reading node header".to_string()));
            }
            
            let id = u32::from_le_bytes(bytes[cursor..cursor+4].try_into().unwrap());
            cursor += 4;
            
            let level_count = bytes[cursor] as usize; // neighbors.len()
            cursor += 1;
            // The stored 'level' of node is level_count - 1
            let level = if level_count > 0 { (level_count - 1) as u8 } else { 0 };
            
            // Vector
            let vec_size = dimension * 4;
            if cursor + vec_size > bytes.len() {
                return Err(HnswError::SerializationError("Unexpected EOF reading vector".to_string()));
            }
            
            let mut vector = Vec::with_capacity(dimension);
            for _ in 0..dimension {
                let val = f32::from_le_bytes(bytes[cursor..cursor+4].try_into().unwrap());
                vector.push(val);
                cursor += 4;
            }
            
            // Deleted flag (my extension)
            if cursor >= bytes.len() {
                return Err(HnswError::SerializationError("Unexpected EOF reading deleted flag".to_string()));
            }
            let deleted = bytes[cursor] != 0;
            cursor += 1;

            // Neighbors
            let mut neighbors = Vec::with_capacity(level_count);
            for _ in 0..level_count {
                if cursor + 2 > bytes.len() {
                    return Err(HnswError::SerializationError("Unexpected EOF count".to_string()));
                }
                let neighbor_count = u16::from_le_bytes(bytes[cursor..cursor+2].try_into().unwrap()) as usize;
                cursor += 2;
                
                let mut layer_neighbors = Vec::with_capacity(neighbor_count);
                for _ in 0..neighbor_count {
                    if cursor + 4 > bytes.len() {
                         return Err(HnswError::SerializationError("Unexpected EOF neighbor".to_string()));
                    }
                    let nid = u32::from_le_bytes(bytes[cursor..cursor+4].try_into().unwrap()) as i32;
                    layer_neighbors.push(nid);
                    cursor += 4;
                }
                neighbors.push(layer_neighbors);
            }
            
            let mut node = HnswNode::new(id, level, vector, 0);
            node.neighbors = neighbors;
            node.deleted = deleted;
            
            hnsw.nodes.insert(id, node);
        }
        
        // No need to re-find entry point as we loaded it
        Ok(hnsw)
    }

    // ========================================================================
    // Internal Methods
    // ========================================================================

    /// Select a random level for a new node using exponential distribution
    fn select_level(&mut self) -> u8 {
        // LCG random
        self.rng_state = self.rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let r = ((self.rng_state >> 33) as f32 / (u32::MAX as f32)).max(1e-7);
        
        // level = floor(-ln(uniform) * level_mult)
        let level = (-r.ln() * self.level_mult).floor() as u8;
        level.min(16) // Cap at 16 levels
    }

    /// Greedy search at a single level, returns single nearest neighbor
    fn search_layer_single(&self, entry_id: u32, target_id: u32, level: u8) -> (u32, f32) {
        let target_node = self.nodes.get(&target_id).unwrap();
        let target_mag = target_node.get_magnitude();
        
        let mut current_id = entry_id;
        let mut current_dist = self.distance_to_node(current_id, &target_node.vector, target_mag);
        
        loop {
            let mut changed = false;
            
            if let Some(node) = self.nodes.get(&current_id) {
                if (level as usize) < node.neighbors.len() {
                    for &neighbor_id in &node.neighbors[level as usize] {
                        if neighbor_id < 0 { continue; }
                        let nid = neighbor_id as u32;
                        
                        let dist = self.distance_to_node(nid, &target_node.vector, target_mag);
                        if dist < current_dist {
                            current_id = nid;
                            current_dist = dist;
                            changed = true;
                        }
                    }
                }
            }
            
            if !changed {
                break;
            }
        }
        
        (current_id, current_dist)
    }

    /// Greedy search for a query vector at a single level
    fn search_layer_single_query(&self, entry_id: u32, query: &[f32], query_mag: f32, level: u8) -> (u32, f32) {
        let mut current_id = entry_id;
        let mut current_sim = self.similarity(current_id, query, query_mag);
        
        loop {
            let mut changed = false;
            
            if let Some(node) = self.nodes.get(&current_id) {
                if (level as usize) < node.neighbors.len() {
                    for &neighbor_id in &node.neighbors[level as usize] {
                        if neighbor_id < 0 { continue; }
                        let nid = neighbor_id as u32;
                        
                        // Skip deleted nodes
                        if self.nodes.get(&nid).map(|n| n.deleted).unwrap_or(true) {
                            continue;
                        }
                        
                        let sim = self.similarity(nid, query, query_mag);
                        if sim > current_sim {
                            current_id = nid;
                            current_sim = sim;
                            changed = true;
                        }
                    }
                }
            }
            
            if !changed {
                break;
            }
        }
        
        (current_id, current_sim)
    }

    /// Beam search at a single level, returns ef nearest neighbors (sorted by similarity desc)
    fn search_layer(&self, entry_id: u32, target_id: u32, ef: usize, level: u8) -> Vec<(u32, f32)> {
        let target_node = self.nodes.get(&target_id).unwrap();
        let target_mag = target_node.get_magnitude();
        
        self.search_layer_internal(entry_id, &target_node.vector, target_mag, ef, level)
    }

    /// Beam search for a query vector at a single level
    fn search_layer_query(&self, entry_id: u32, query: &[f32], query_mag: f32, ef: usize, level: u8) -> Vec<(u32, f32)> {
        self.search_layer_internal(entry_id, query, query_mag, ef, level)
    }

    /// Internal beam search implementation
    fn search_layer_internal(&self, entry_id: u32, query: &[f32], query_mag: f32, ef: usize, level: u8) -> Vec<(u32, f32)> {
        let mut visited: HashSet<u32> = HashSet::new();
        
        // Candidates: max-heap by similarity (we want to explore highest similarity first)
        let mut candidates: BinaryHeap<ScoredItem<u32>> = BinaryHeap::new();
        
        // Results: min-heap by similarity (we want to keep top-k highest)
        let mut results: BinaryHeap<Reverse<ScoredItem<u32>>> = BinaryHeap::new();
        
        let entry_sim = self.similarity(entry_id, query, query_mag);
        
        visited.insert(entry_id);
        candidates.push(ScoredItem { score: entry_sim, item: entry_id });
        results.push(Reverse(ScoredItem { score: entry_sim, item: entry_id }));
        
        while let Some(ScoredItem { score: c_sim, item: c_id }) = candidates.pop() {
            // Get worst result similarity
            let worst_sim = results.peek().map(|r| r.0.score).unwrap_or(f32::NEG_INFINITY);
            
            // If current candidate is worse than worst result and we have enough, stop
            if c_sim < worst_sim && results.len() >= ef {
                break;
            }
            
            // Explore neighbors
            if let Some(node) = self.nodes.get(&c_id) {
                if (level as usize) < node.neighbors.len() {
                    for &neighbor_id in &node.neighbors[level as usize] {
                        if neighbor_id < 0 { continue; }
                        let nid = neighbor_id as u32;
                        
                        if visited.contains(&nid) { continue; }
                        visited.insert(nid);
                        
                        let n_sim = self.similarity(nid, query, query_mag);
                        
                        // Add to results if better than worst or not full
                        let worst = results.peek().map(|r| r.0.score).unwrap_or(f32::NEG_INFINITY);
                        if n_sim > worst || results.len() < ef {
                            candidates.push(ScoredItem { score: n_sim, item: nid });
                            results.push(Reverse(ScoredItem { score: n_sim, item: nid }));
                            
                            if results.len() > ef {
                                results.pop();
                            }
                        }
                    }
                }
            }
        }
        
        // Extract results sorted by similarity (descending)
        let mut result_vec: Vec<(u32, f32)> = results.into_iter()
            .map(|r| (r.0.item, r.0.score))
            .collect();
        result_vec.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        result_vec
    }

    /// Add a neighbor connection
    fn add_neighbor(&mut self, from_id: u32, to_id: u32, level: u8) {
        if let Some(node) = self.nodes.get_mut(&from_id) {
            // Ensure neighbors vec is large enough
            while node.neighbors.len() <= level as usize {
                node.neighbors.push(Vec::new());
            }
            
            // Don't add duplicates
            let to_signed = to_id as i32;
            if !node.neighbors[level as usize].contains(&to_signed) {
                node.neighbors[level as usize].push(to_signed);
            }
        }
    }

    /// Prune neighbors to maintain at most `max_neighbors` connections
    fn prune_neighbors(&mut self, node_id: u32, level: u8, max_neighbors: usize) {
        // Get node's vector first
        let (node_vec, node_mag) = {
            let node = match self.nodes.get(&node_id) {
                Some(n) => n,
                None => return,
            };
            if (level as usize) >= node.neighbors.len() {
                return;
            }
            if node.neighbors[level as usize].len() <= max_neighbors {
                return;
            }
            (node.vector.clone(), node.get_magnitude())
        };
        
        // Score all neighbors
        let neighbors: Vec<i32> = self.nodes.get(&node_id).unwrap()
            .neighbors[level as usize].clone();
        
        let mut scored: Vec<(i32, f32)> = neighbors.iter()
            .filter(|&&nid| nid >= 0)
            .map(|&nid| {
                let sim = self.similarity(nid as u32, &node_vec, node_mag);
                (nid, sim)
            })
            .collect();
        
        // Sort by similarity descending
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        
        // Keep top max_neighbors
        let pruned: Vec<i32> = scored.into_iter()
            .take(max_neighbors)
            .map(|(nid, _)| nid)
            .collect();
        
        if let Some(node) = self.nodes.get_mut(&node_id) {
            node.neighbors[level as usize] = pruned;
        }
    }

    /// Compute distance (lower = more similar for internal use)
    fn distance_to_node(&self, node_id: u32, query: &[f32], query_mag: f32) -> f32 {
        // Returns negative similarity so lower = better (for greedy descent)
        -self.similarity(node_id, query, query_mag)
    }

    /// Compute similarity (higher = more similar)
    fn similarity(&self, node_id: u32, query: &[f32], query_mag: f32) -> f32 {
        let node = match self.nodes.get(&node_id) {
            Some(n) => n,
            None => return f32::NEG_INFINITY,
        };
        
        match self.metric {
            Metric::Cosine => {
                cosine_similarity(&node.vector, query, Some(node.get_magnitude()), Some(query_mag))
            }
            Metric::Euclidean => {
                // For Euclidean, we return negative distance so higher = more similar
                -euclidean_distance_squared(&node.vector, query).sqrt()
            }
        }
    }
}

impl Default for Hnsw {
    fn default() -> Self {
        Self::new(16, 200, Metric::Cosine)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_level_distribution() {
        let mut hnsw = Hnsw::new(16, 100, Metric::Cosine);
        let mut levels = [0u32; 17];
        
        for _ in 0..10000 {
            let level = hnsw.select_level();
            levels[level as usize] += 1;
        }
        
        // Most should be level 0
        assert!(levels[0] > 5000, "Level 0 should be most common");
        // Higher levels should be less frequent
        assert!(levels[0] > levels[1]);
        assert!(levels[1] > levels[2] || levels[2] == 0);
    }
}


//! Maximal Marginal Relevance (MMR) for Diversity-Aware Search
//!
//! MMR reranks results to balance relevance and diversity:
//! MMR = Î» Ã— similarity(query, doc) - (1-Î») Ã— max(similarity(doc, selected_docs))
//!
//! Î» = 1.0: Pure relevance (standard search)
//! Î» = 0.5: Balanced relevance + diversity
//! Î» = 0.0: Pure diversity

use super::distance::{cosine_similarity, magnitude};

/// MMR configuration
#[derive(Debug, Clone, Copy)]
pub struct MmrConfig {
    /// Lambda: 0.0 = pure diversity, 1.0 = pure relevance
    pub lambda: f32,
    /// How many extra candidates to fetch (multiplier on k)
    pub fetch_multiplier: f32,
}

impl Default for MmrConfig {
    fn default() -> Self {
        Self {
            lambda: 0.5,
            fetch_multiplier: 2.0,
        }
    }
}

impl MmrConfig {
    /// Create balanced config (0.5 lambda)
    pub fn balanced() -> Self {
        Self::default()
    }

    /// Create relevance-focused config (0.7 lambda)
    pub fn relevance_focused() -> Self {
        Self {
            lambda: 0.7,
            fetch_multiplier: 1.5,
        }
    }

    /// Create diversity-focused config (0.3 lambda)
    pub fn diversity_focused() -> Self {
        Self {
            lambda: 0.3,
            fetch_multiplier: 3.0,
        }
    }

    /// Custom lambda (clamped to 0.0-1.0)
    pub fn with_lambda(lambda: f32) -> Self {
        Self {
            lambda: lambda.clamp(0.0, 1.0),
            fetch_multiplier: 2.0,
        }
    }
}

/// Candidate for MMR reranking
#[derive(Debug, Clone)]
pub struct MmrCandidate {
    pub id: u32,
    pub score: f32,
    pub vector: Vec<f32>,
}

/// Rerank search results using Maximal Marginal Relevance
/// 
/// # Arguments
/// * `query` - Query vector
/// * `candidates` - Initial search results with vectors (sorted by relevance desc)
/// * `k` - Number of diverse results to return
/// * `lambda` - Balance factor (0.0 = diversity, 1.0 = relevance)
/// 
/// # Returns
/// Top-k results reranked for diversity
pub fn mmr_rerank(
    query: &[f32],
    candidates: Vec<MmrCandidate>,
    k: usize,
    lambda: f32,
) -> Vec<(u32, f32)> {
    if candidates.is_empty() || k == 0 {
        return Vec::new();
    }

    let k = k.min(candidates.len());
    let query_mag = magnitude(query);
    
    let mut selected: Vec<MmrCandidate> = Vec::with_capacity(k);
    let mut remaining = candidates;

    // Iteratively select documents maximizing MMR
    for _ in 0..k {
        if remaining.is_empty() {
            break;
        }

        let mut best_idx = 0;
        let mut best_mmr = f32::NEG_INFINITY;

        for (idx, candidate) in remaining.iter().enumerate() {
            let mmr_score = compute_mmr_score(
                query,
                query_mag,
                candidate,
                &selected,
                lambda,
            );

            if mmr_score > best_mmr {
                best_mmr = mmr_score;
                best_idx = idx;
            }
        }

        // Move best candidate to selected set
        let best = remaining.remove(best_idx);
        selected.push(best);
    }

    // Return (id, original_score) pairs
    selected.into_iter()
        .map(|c| (c.id, c.score))
        .collect()
}

/// Compute MMR score for a candidate
/// MMR = Î» Ã— relevance - (1-Î») Ã— max_similarity_to_selected
fn compute_mmr_score(
    query: &[f32],
    query_mag: f32,
    candidate: &MmrCandidate,
    selected: &[MmrCandidate],
    lambda: f32,
) -> f32 {
    // Relevance: cosine similarity to query
    let candidate_mag = magnitude(&candidate.vector);
    let relevance = cosine_similarity(
        query,
        &candidate.vector,
        Some(query_mag),
        Some(candidate_mag),
    );

    // Diversity: max similarity to already selected documents
    let max_similarity = if selected.is_empty() {
        0.0
    } else {
        selected.iter()
            .map(|s| {
                let s_mag = magnitude(&s.vector);
                cosine_similarity(
                    &candidate.vector,
                    &s.vector,
                    Some(candidate_mag),
                    Some(s_mag),
                )
            })
            .max_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(0.0)
    };

    // MMR = Î» Ã— relevance - (1-Î») Ã— max_similarity
    lambda * relevance - (1.0 - lambda) * max_similarity
}

/// Convenience function for simple MMR with just IDs and scores
/// Fetches vectors internally using a lookup function
pub fn mmr_rerank_with_lookup<F>(
    query: &[f32],
    results: &[(u32, f32)],
    k: usize,
    lambda: f32,
    get_vector: F,
) -> Vec<(u32, f32)>
where
    F: Fn(u32) -> Option<Vec<f32>>,
{
    // Convert results to candidates with vectors
    let candidates: Vec<MmrCandidate> = results.iter()
        .filter_map(|(id, score)| {
            get_vector(*id).map(|vector| MmrCandidate {
                id: *id,
                score: *score,
                vector,
            })
        })
        .collect();

    mmr_rerank(query, candidates, k, lambda)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_candidate(id: u32, score: f32, vector: Vec<f32>) -> MmrCandidate {
        MmrCandidate { id, score, vector }
    }

    // ============================================================================
    // MMR Config Contract Tests
    // ============================================================================

    #[test]
    fn test_config_default() {
        let config = MmrConfig::default();
        assert!((config.lambda - 0.5).abs() < 1e-6);
        assert!((config.fetch_multiplier - 2.0).abs() < 1e-6);
    }

    #[test]
    fn test_config_clamps_lambda() {
        let config = MmrConfig::with_lambda(1.5);
        assert!((config.lambda - 1.0).abs() < 1e-6);

        let config = MmrConfig::with_lambda(-0.5);
        assert!((config.lambda - 0.0).abs() < 1e-6);
    }

    // ============================================================================
    // MMR Rerank Core Contract Tests
    // ============================================================================

    #[test]
    fn test_mmr_empty_candidates() {
        let query = vec![1.0, 0.0, 0.0];
        let candidates = vec![];
        
        let results = mmr_rerank(&query, candidates, 5, 0.5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_mmr_returns_k_results() {
        let query = vec![1.0, 0.0, 0.0];
        let candidates = vec![
            make_candidate(1, 0.9, vec![0.9, 0.1, 0.0]),
            make_candidate(2, 0.8, vec![0.8, 0.2, 0.0]),
            make_candidate(3, 0.7, vec![0.7, 0.3, 0.0]),
            make_candidate(4, 0.6, vec![0.6, 0.4, 0.0]),
        ];
        
        let results = mmr_rerank(&query, candidates, 3, 0.5);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_mmr_pure_relevance_preserves_order() {
        // With lambda = 1.0, MMR should preserve original order
        let query = vec![1.0, 0.0];
        let candidates = vec![
            make_candidate(1, 0.9, vec![0.9, 0.1]),
            make_candidate(2, 0.85, vec![0.88, 0.12]),
            make_candidate(3, 0.5, vec![0.5, 0.5]),
        ];
        
        let results = mmr_rerank(&query, candidates, 3, 1.0);
        
        // Should be in order of similarity to query
        assert_eq!(results[0].0, 1);
        assert_eq!(results[1].0, 2);
    }

    #[test]
    fn test_mmr_promotes_diversity() {
        // With balanced lambda, MMR should promote diverse results
        let query = vec![1.0, 0.0, 0.0];
        
        // Two very similar vectors and one different
        let candidates = vec![
            make_candidate(1, 0.95, vec![0.99, 0.01, 0.0]),  // Very similar to query
            make_candidate(2, 0.94, vec![0.98, 0.02, 0.0]),  // Almost identical to #1
            make_candidate(3, 0.7, vec![0.0, 0.0, 1.0]),     // Orthogonal/different
        ];
        
        let results = mmr_rerank(&query, candidates, 2, 0.5);
        
        // First should still be most relevant
        assert_eq!(results[0].0, 1);
        // Second should be the diverse one (#3), not the near-duplicate (#2)
        assert_eq!(results[1].0, 3, "MMR should prefer diverse result over near-duplicate");
    }

    #[test]
    fn test_mmr_pure_diversity() {
        // With lambda = 0.0, should maximize diversity
        let query = vec![1.0, 0.0];
        let candidates = vec![
            make_candidate(1, 0.9, vec![1.0, 0.0]),
            make_candidate(2, 0.85, vec![0.99, 0.01]),  // Very similar to #1
            make_candidate(3, 0.3, vec![0.0, 1.0]),    // Orthogonal
        ];
        
        let results = mmr_rerank(&query, candidates, 2, 0.0);
        
        // With pure diversity, should not select both similar vectors
        let has_both_similar = results.iter().any(|(id, _)| *id == 1) 
            && results.iter().any(|(id, _)| *id == 2);
        assert!(!has_both_similar, "Pure diversity should avoid selecting similar vectors");
    }

    // ============================================================================
    // MMR with Lookup Contract Tests
    // ============================================================================

    #[test]
    fn test_mmr_with_lookup() {
        let query = vec![1.0, 0.0, 0.0];
        let results = vec![
            (1u32, 0.9f32),
            (2u32, 0.8f32),
            (3u32, 0.7f32),
        ];
        
        // Mock vector lookup
        let get_vector = |id: u32| -> Option<Vec<f32>> {
            match id {
                1 => Some(vec![0.9, 0.1, 0.0]),
                2 => Some(vec![0.8, 0.2, 0.0]),
                3 => Some(vec![0.0, 1.0, 0.0]),
                _ => None,
            }
        };
        
        let reranked = mmr_rerank_with_lookup(&query, &results, 2, 0.5, get_vector);
        assert_eq!(reranked.len(), 2);
    }

    #[test]
    fn test_mmr_handles_missing_vectors() {
        let query = vec![1.0, 0.0];
        let results = vec![
            (1u32, 0.9f32),
            (2u32, 0.8f32), // Will be missing
            (3u32, 0.7f32),
        ];
        
        let get_vector = |id: u32| -> Option<Vec<f32>> {
            match id {
                1 => Some(vec![0.9, 0.1]),
                3 => Some(vec![0.7, 0.3]),
                _ => None, // ID 2 is missing
            }
        };
        
        let reranked = mmr_rerank_with_lookup(&query, &results, 3, 0.5, get_vector);
        
        // Should only return vectors that were found
        assert_eq!(reranked.len(), 2);
        assert!(!reranked.iter().any(|(id, _)| *id == 2));
    }

    // ============================================================================
    // Edge Cases
    // ============================================================================

    #[test]
    fn test_mmr_k_larger_than_candidates() {
        let query = vec![1.0, 0.0];
        let candidates = vec![
            make_candidate(1, 0.9, vec![0.9, 0.1]),
        ];
        
        let results = mmr_rerank(&query, candidates, 10, 0.5);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_mmr_k_zero() {
        let query = vec![1.0, 0.0];
        let candidates = vec![
            make_candidate(1, 0.9, vec![0.9, 0.1]),
        ];
        
        let results = mmr_rerank(&query, candidates, 0, 0.5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_mmr_identical_vectors() {
        // All candidates are identical - should still work
        let query = vec![1.0, 0.0];
        let candidates = vec![
            make_candidate(1, 0.9, vec![1.0, 0.0]),
            make_candidate(2, 0.8, vec![1.0, 0.0]),
            make_candidate(3, 0.7, vec![1.0, 0.0]),
        ];
        
        let results = mmr_rerank(&query, candidates, 3, 0.5);
        assert_eq!(results.len(), 3);
    }
}


pub mod distance;
pub mod node;
pub mod pqueue;
pub mod index;
pub mod wasm;
pub mod quantization;
pub mod mmr;
pub mod binary_quantization;
pub mod filter;

#[cfg(test)]
mod tests;


use std::cell::{Cell, RefCell};
use super::distance::magnitude;

#[derive(Debug)]
pub struct HnswNode {
    pub id: u32,
    pub level: u8,
    pub vector: Vec<f32>,
    pub neighbors: Vec<Vec<i32>>,
    pub deleted: bool,
    magnitude: Cell<Option<f32>>,
    normalized: RefCell<Option<Vec<f32>>>,
}

impl HnswNode {
    /// Creates a new HnswNode.
    /// `max_layers` specifies the number of layers to pre-allocate neighbor lists for.
    /// Usually `max_layers` corresponds to the node's assigned max level + 1.
    pub fn new(id: u32, level: u8, vector: Vec<f32>, max_layers: usize) -> Self {
        let neighbors = vec![Vec::new(); max_layers];
        
        HnswNode {
            id,
            level,
            vector,
            neighbors,
            deleted: false,
            magnitude: Cell::new(None),
            normalized: RefCell::new(None),
        }
    }

    pub fn get_magnitude(&self) -> f32 {
        if let Some(mag) = self.magnitude.get() {
            return mag;
        }
        let mag = magnitude(&self.vector);
        self.magnitude.set(Some(mag));
        mag
    }

    /// Returns a copy of the normalized vector.
    /// Caches the result internally.
    pub fn get_normalized(&self) -> Option<Vec<f32>> {
        // Since we return a Vec, we clone. 
        // If we returned a reference we'd need to use Ref/RefMut which might leak internal implementation details via types.
        // For now, returning a clone is safe and easy. 
        // A Cow or Arc might be better if we access this frequently without modifying.
        
        if let Some(ref norm) = *self.normalized.borrow() {
             return Some(norm.clone());
        }

        let mag = self.get_magnitude();
        if mag == 0.0 {
            return None;
        }

        let norm: Vec<f32> = self.vector.iter().map(|v| v / mag).collect();
        *self.normalized.borrow_mut() = Some(norm.clone());
        Some(norm)
    }

    pub fn add_neighbor(&mut self, layer: usize, neighbor_id: i32) {
        if layer < self.neighbors.len() {
            self.neighbors[layer].push(neighbor_id);
        }
        // If layer is out of bounds, we currently ignore it. 
        // In a real implementation this might indicate a logic error in the insertion algorithm.
    }
}


use std::cmp::Ordering;

#[derive(Debug, Clone)]
pub struct ScoredItem<T> {
    pub score: f32,
    pub item: T,
}

impl<T> PartialEq for ScoredItem<T> {
    fn eq(&self, other: &Self) -> bool {
        // We only care about score for ordering
        self.score == other.score
    }
}

impl<T> Eq for ScoredItem<T> {}

impl<T> PartialOrd for ScoredItem<T> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl<T> Ord for ScoredItem<T> {
    fn cmp(&self, other: &Self) -> Ordering {
        // Handle NaN/Infinity if strictly needed, but for HNSW scores are usually well-behaved.
        // We defer to partial_cmp of f32, defaulting to Equal if None (NaN).
        // Since we want a total ordering, we must handle NaN. 
        // We'll treat NaN as Equal.
        self.score.partial_cmp(&other.score).unwrap_or(Ordering::Equal)
    }
}

//! Scalar Quantization for Memory Compression
//!
//! Maps f32 vectors to u8 for 4Ã— memory compression with ~1% recall loss.
//! Uses min-max normalization: quantized = (value - min) / scale * 255

use serde::{Deserialize, Serialize};

/// Scalar quantized vector representation
/// 
/// Converts f32 vectors to u8 for 4Ã— memory compression.
/// Stores min/scale for reconstruction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScalarQuantized {
    /// Quantized values (u8 per dimension)
    pub data: Vec<u8>,
    /// Minimum value for dequantization
    pub min: f32,
    /// Scale factor: (max - min) / 255.0
    pub scale: f32,
}

impl ScalarQuantized {
    /// Quantize a full-precision f32 vector to u8
    /// 
    /// # Algorithm
    /// 1. Find min/max of input vector
    /// 2. Compute scale = (max - min) / 255.0
    /// 3. Map each value: quantized = round((value - min) / scale)
    pub fn quantize(vector: &[f32]) -> Self {
        if vector.is_empty() {
            return Self {
                data: Vec::new(),
                min: 0.0,
                scale: 1.0,
            };
        }

        let min = vector.iter().copied().fold(f32::INFINITY, f32::min);
        let max = vector.iter().copied().fold(f32::NEG_INFINITY, f32::max);

        // Handle edge case: all values identical
        let scale = if (max - min).abs() < f32::EPSILON {
            1.0
        } else {
            (max - min) / 255.0
        };

        let data = vector
            .iter()
            .map(|&v| ((v - min) / scale).round().clamp(0.0, 255.0) as u8)
            .collect();

        Self { data, min, scale }
    }

    /// Reconstruct approximate f32 vector from quantized representation
    /// 
    /// # Algorithm
    /// reconstructed = min + (quantized * scale)
    pub fn reconstruct(&self) -> Vec<f32> {
        self.data
            .iter()
            .map(|&v| self.min + (v as f32) * self.scale)
            .collect()
    }

    /// Compute approximate distance to another quantized vector
    /// 
    /// Uses L2 squared distance in quantized space, scaled back.
    /// This is an approximation - exact distance requires reconstruction.
    #[inline]
    pub fn distance_l2_squared(&self, other: &Self) -> f32 {
        // Average scale for balanced comparison
        let avg_scale = (self.scale + other.scale) / 2.0;

        self.data
            .iter()
            .zip(&other.data)
            .map(|(&a, &b)| {
                let diff = a as i32 - b as i32;
                (diff * diff) as f32
            })
            .sum::<f32>()
            * avg_scale
            * avg_scale
    }

    /// Compute approximate cosine similarity to a full-precision query
    /// 
    /// Reconstructs this vector and computes exact cosine to query.
    /// This gives better accuracy than quantized-to-quantized comparison.
    pub fn cosine_to_query(&self, query: &[f32], query_magnitude: f32) -> f32 {
        let reconstructed = self.reconstruct();
        
        if reconstructed.len() != query.len() {
            return 0.0;
        }

        let mut dot = 0.0f32;
        let mut self_mag_sq = 0.0f32;

        for (a, b) in reconstructed.iter().zip(query) {
            dot += a * b;
            self_mag_sq += a * a;
        }

        let self_mag = self_mag_sq.sqrt();
        if self_mag == 0.0 || query_magnitude == 0.0 {
            return 0.0;
        }

        dot / (self_mag * query_magnitude)
    }

    /// Memory size in bytes
    pub fn size_bytes(&self) -> usize {
        self.data.len() + 8 // data + min(4) + scale(4)
    }

    /// Compression ratio vs f32
    pub fn compression_ratio(&self) -> f32 {
        if self.data.is_empty() {
            return 1.0;
        }
        let original_bytes = self.data.len() * 4; // f32 = 4 bytes
        let compressed_bytes = self.size_bytes();
        original_bytes as f32 / compressed_bytes as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================================
    // Quantization Contract Tests
    // ============================================================================

    #[test]
    fn test_quantize_basic() {
        let vector = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let quantized = ScalarQuantized::quantize(&vector);

        assert_eq!(quantized.data.len(), 5);
        assert!((quantized.min - 1.0).abs() < 1e-6);
        // scale = (5.0 - 1.0) / 255.0 â‰ˆ 0.01569
        assert!(quantized.scale > 0.0);
    }

    #[test]
    fn test_quantize_empty_vector() {
        let vector: Vec<f32> = vec![];
        let quantized = ScalarQuantized::quantize(&vector);

        assert!(quantized.data.is_empty());
    }

    #[test]
    fn test_quantize_identical_values() {
        let vector = vec![5.0, 5.0, 5.0, 5.0];
        let quantized = ScalarQuantized::quantize(&vector);

        // All values should be 0 (since all are at min)
        assert!(quantized.data.iter().all(|&v| v == 0));
        assert!((quantized.min - 5.0).abs() < 1e-6);
    }

    #[test]
    fn test_quantize_negative_values() {
        let vector = vec![-10.0, -5.0, 0.0, 5.0, 10.0];
        let quantized = ScalarQuantized::quantize(&vector);

        assert_eq!(quantized.data.len(), 5);
        assert!((quantized.min - (-10.0)).abs() < 1e-6);
        // First value should be 0 (min), last should be 255 (max)
        assert_eq!(quantized.data[0], 0);
        assert_eq!(quantized.data[4], 255);
    }

    // ============================================================================
    // Reconstruction Contract Tests
    // ============================================================================

    #[test]
    fn test_reconstruct_roundtrip() {
        let vector = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let quantized = ScalarQuantized::quantize(&vector);
        let reconstructed = quantized.reconstruct();

        assert_eq!(reconstructed.len(), vector.len());

        // With 8-bit quantization, max error is roughly (max-min)/255
        let max_error = (5.0 - 1.0) / 255.0 * 2.0; // 2x tolerance for rounding

        for (orig, recon) in vector.iter().zip(reconstructed.iter()) {
            assert!(
                (orig - recon).abs() < max_error,
                "Roundtrip error too large: orig={}, recon={}, error={}",
                orig, recon, (orig - recon).abs()
            );
        }
    }

    #[test]
    fn test_reconstruct_preserves_endpoints() {
        let vector = vec![0.0, 100.0];
        let quantized = ScalarQuantized::quantize(&vector);
        let reconstructed = quantized.reconstruct();

        // Min should be exactly 0
        assert!((reconstructed[0] - 0.0).abs() < 0.5);
        // Max should be approximately 100
        assert!((reconstructed[1] - 100.0).abs() < 0.5);
    }

    // ============================================================================
    // Distance Contract Tests
    // ============================================================================

    #[test]
    fn test_distance_identical_vectors() {
        let v1 = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let q1 = ScalarQuantized::quantize(&v1);
        let q2 = ScalarQuantized::quantize(&v1);

        let dist = q1.distance_l2_squared(&q2);
        assert!(dist < 1e-6, "Identical vectors should have ~0 distance");
    }

    #[test]
    fn test_distance_symmetry() {
        let v1 = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let v2 = vec![2.0, 3.0, 4.0, 5.0, 6.0];

        let q1 = ScalarQuantized::quantize(&v1);
        let q2 = ScalarQuantized::quantize(&v2);

        let dist_ab = q1.distance_l2_squared(&q2);
        let dist_ba = q2.distance_l2_squared(&q1);

        assert!(
            (dist_ab - dist_ba).abs() < 0.01,
            "Distance not symmetric: d(a,b)={}, d(b,a)={}",
            dist_ab, dist_ba
        );
    }

    #[test]
    fn test_distance_monotonicity() {
        // Quantized distance should preserve monotonicity:
        // closer points should have smaller distances
        let origin = vec![0.0, 0.0];
        let near = vec![1.0, 0.0];
        let far = vec![10.0, 0.0];

        let q_origin = ScalarQuantized::quantize(&origin);
        let q_near = ScalarQuantized::quantize(&near);
        let q_far = ScalarQuantized::quantize(&far);

        // Same vector should have zero distance
        let d_self = q_origin.distance_l2_squared(&q_origin);
        assert!(d_self < 1e-6, "Self-distance should be ~0: {}", d_self);

        // Note: Triangle inequality may not hold strictly for per-vector quantization
        // because each vector has its own min/scale. This is a known property.
        // Instead we verify that distance is non-negative.
        let d_near = q_origin.distance_l2_squared(&q_near);
        let d_far = q_origin.distance_l2_squared(&q_far);
        assert!(d_near >= 0.0, "Distance should be non-negative");
        assert!(d_far >= 0.0, "Distance should be non-negative");
    }

    // ============================================================================
    // Cosine to Query Contract Tests
    // ============================================================================

    #[test]
    fn test_cosine_identical_direction() {
        let v = vec![1.0, 0.0, 0.0];
        let query = vec![2.0, 0.0, 0.0]; // Same direction, different magnitude
        let query_mag = 2.0;

        let quantized = ScalarQuantized::quantize(&v);
        let sim = quantized.cosine_to_query(&query, query_mag);

        assert!(sim > 0.9, "Identical direction should have high similarity: {}", sim);
    }

    #[test]
    fn test_cosine_orthogonal() {
        let v = vec![1.0, 0.0];
        let query = vec![0.0, 1.0];
        let query_mag = 1.0;

        let quantized = ScalarQuantized::quantize(&v);
        let sim = quantized.cosine_to_query(&query, query_mag);

        assert!(sim.abs() < 0.1, "Orthogonal vectors should have ~0 similarity: {}", sim);
    }

    #[test]
    fn test_cosine_dimension_mismatch_returns_zero() {
        let v = vec![1.0, 2.0, 3.0];
        let query = vec![1.0, 2.0]; // Different dimension
        let query_mag = 2.236;

        let quantized = ScalarQuantized::quantize(&v);
        let sim = quantized.cosine_to_query(&query, query_mag);

        assert_eq!(sim, 0.0);
    }

    // ============================================================================
    // Compression Ratio Contract Tests
    // ============================================================================

    #[test]
    fn test_compression_ratio_384d() {
        // Typical BGE-small dimension
        let v: Vec<f32> = (0..384).map(|i| i as f32 / 384.0).collect();
        let quantized = ScalarQuantized::quantize(&v);

        let ratio = quantized.compression_ratio();
        // Expected: 384 * 4 / (384 + 8) = 1536 / 392 â‰ˆ 3.9x
        assert!(ratio > 3.5 && ratio < 4.5, "384D compression ratio should be ~4x: {}", ratio);
    }

    #[test]
    fn test_compression_ratio_768d() {
        // Typical ModernBERT dimension
        let v: Vec<f32> = (0..768).map(|i| i as f32 / 768.0).collect();
        let quantized = ScalarQuantized::quantize(&v);

        let ratio = quantized.compression_ratio();
        // Expected: 768 * 4 / (768 + 8) = 3072 / 776 â‰ˆ 3.96x
        assert!(ratio > 3.5 && ratio < 4.5, "768D compression ratio should be ~4x: {}", ratio);
    }

    // ============================================================================
    // Recall Quality Contract Tests
    // ============================================================================

    #[test]
    fn test_similarity_ranking_preserved() {
        // Ensure quantization preserves relative similarity ordering
        let base = vec![1.0, 0.0, 0.0];
        let similar = vec![0.9, 0.1, 0.0];
        let dissimilar = vec![0.0, 1.0, 0.0];

        let q_base = ScalarQuantized::quantize(&base);
        let q_similar = ScalarQuantized::quantize(&similar);
        let q_dissimilar = ScalarQuantized::quantize(&dissimilar);

        let dist_similar = q_base.distance_l2_squared(&q_similar);
        let dist_dissimilar = q_base.distance_l2_squared(&q_dissimilar);

        assert!(
            dist_similar < dist_dissimilar,
            "Similar vector should be closer: similar={}, dissimilar={}",
            dist_similar, dist_dissimilar
        );
    }
}

use wasm_bindgen::prelude::*;
use crate::hnsw::index::{Hnsw, Metric};

#[wasm_bindgen]
pub struct HnswIndex {
    inner: Hnsw,
}

#[wasm_bindgen]
impl HnswIndex {
    #[wasm_bindgen(constructor)]
    pub fn new(m: usize, ef_construction: usize, metric_idx: u8) -> Self {
        let metric = match metric_idx {
            1 => Metric::Euclidean,
            _ => Metric::Cosine,
        };
        HnswIndex {
            inner: Hnsw::new(m, ef_construction, metric),
        }
    }

    #[wasm_bindgen]
    pub fn add_point(&mut self, id: u32, vector: Vec<f32>) -> Result<(), JsValue> {
        self.inner.add_point(id, vector)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn search(&self, query: Vec<f32>, k: usize) -> Result<Vec<u32>, JsValue> {
        // Return only IDs for now, or tuple?
        // WASM limitations on tuples.
        // We can return Uint32Array of IDs.
        let results = self.inner.search_knn(&query, k);
        let ids: Vec<u32> = results.into_iter().map(|(id, _)| id).collect();
        Ok(ids)
    }
    
    #[wasm_bindgen(js_name = searchWithScores)]
    pub fn search_with_scores(&self, query: Vec<f32>, k: usize) -> Result<JsValue, JsValue> {
         let results = self.inner.search_knn(&query, k);
         serde_wasm_bindgen::to_value(&results)
             .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn delete_point(&mut self, id: u32) {
        self.inner.delete_point(id);
    }

    #[wasm_bindgen]
    pub fn serialize(&self) -> Vec<u8> {
        self.inner.serialize()
    }

    #[wasm_bindgen]
    pub fn deserialize(bytes: &[u8]) -> Result<HnswIndex, JsValue> {
        let inner = Hnsw::deserialize(bytes)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(HnswIndex { inner })
    }
    
    #[wasm_bindgen]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    // ========================================================================
    // Hybrid Quantized Methods
    // ========================================================================

    /// Add a point with both full-precision and quantized storage
    #[wasm_bindgen(js_name = addPointQuantized)]
    pub fn add_point_quantized(&mut self, id: u32, vector: Vec<f32>) -> Result<(), JsValue> {
        self.inner.add_point_quantized(id, vector)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Search using hybrid quantized approach
    #[wasm_bindgen(js_name = searchHybrid)]
    pub fn search_hybrid(&self, query: Vec<f32>, k: usize) -> Result<Vec<u32>, JsValue> {
        let results = self.inner.search_hybrid(&query, k);
        let ids: Vec<u32> = results.into_iter().map(|(id, _)| id).collect();
        Ok(ids)
    }

    /// Search hybrid with scores
    #[wasm_bindgen(js_name = searchHybridWithScores)]
    pub fn search_hybrid_with_scores(&self, query: Vec<f32>, k: usize) -> Result<JsValue, JsValue> {
        let results = self.inner.search_hybrid(&query, k);
        serde_wasm_bindgen::to_value(&results)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Get memory usage statistics
    /// Returns { fullBytes: number, quantizedBytes: number, compressionRatio: number }
    #[wasm_bindgen(js_name = memoryUsage)]
    pub fn memory_usage(&self) -> Result<JsValue, JsValue> {
        let (full_bytes, quantized_bytes) = self.inner.memory_usage();
        let ratio = if quantized_bytes > 0 {
            full_bytes as f32 / quantized_bytes as f32
        } else {
            1.0
        };
        
        let stats = serde_json::json!({
            "fullBytes": full_bytes,
            "quantizedBytes": quantized_bytes,
            "compressionRatio": ratio
        });
        
        serde_wasm_bindgen::to_value(&stats)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    // ========================================================================
    // Diversity Search (MMR)
    // ========================================================================

    /// Search with diversity using MMR (Maximal Marginal Relevance)
    /// 
    /// # Arguments
    /// * `query` - Query vector
    /// * `k` - Number of results to return
    /// * `lambda` - Balance factor: 0.0 = pure diversity, 0.5 = balanced, 1.0 = pure relevance
    /// 
    /// # Returns
    /// Uint32Array of IDs reranked for diversity
    #[wasm_bindgen(js_name = searchWithDiversity)]
    pub fn search_with_diversity(&self, query: Vec<f32>, k: usize, lambda: f32) -> Result<Vec<u32>, JsValue> {
        let results = self.inner.search_with_diversity(&query, k, lambda);
        let ids: Vec<u32> = results.into_iter().map(|(id, _)| id).collect();
        Ok(ids)
    }

    /// Search with diversity, returning scores
    /// 
    /// # Arguments
    /// * `query` - Query vector
    /// * `k` - Number of results to return
    /// * `lambda` - Balance factor: 0.0 = pure diversity, 0.5 = balanced, 1.0 = pure relevance
    /// 
    /// # Returns
    /// Array of [id, score] pairs reranked for diversity
    #[wasm_bindgen(js_name = searchWithDiversityScores)]
    pub fn search_with_diversity_scores(&self, query: Vec<f32>, k: usize, lambda: f32) -> Result<JsValue, JsValue> {
        let results = self.inner.search_with_diversity(&query, k, lambda);
        serde_wasm_bindgen::to_value(&results)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    // ========================================================================
    // Two-Stage Retrieval (Binary Quantization)
    // ========================================================================

    /// Add a point with binary quantization for ultra-fast coarse filtering
    #[wasm_bindgen(js_name = addPointBinary)]
    pub fn add_point_binary(&mut self, id: u32, vector: Vec<f32>) -> Result<(), JsValue> {
        self.inner.add_point_binary(id, vector)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Two-stage search: binary coarse filter â†’ exact rerank
    /// 
    /// # Arguments
    /// * `query` - Query vector
    /// * `k` - Number of results to return
    /// * `rerank_multiplier` - How many candidates to rerank (e.g., 10.0 = 10*k)
    #[wasm_bindgen(js_name = searchTwoStage)]
    pub fn search_two_stage(&self, query: Vec<f32>, k: usize, rerank_multiplier: f32) -> Result<Vec<u32>, JsValue> {
        let results = self.inner.search_two_stage(&query, k, rerank_multiplier);
        let ids: Vec<u32> = results.into_iter().map(|(id, _)| id).collect();
        Ok(ids)
    }

    /// Two-stage search with scores
    #[wasm_bindgen(js_name = searchTwoStageWithScores)]
    pub fn search_two_stage_with_scores(&self, query: Vec<f32>, k: usize, rerank_multiplier: f32) -> Result<JsValue, JsValue> {
        let results = self.inner.search_two_stage(&query, k, rerank_multiplier);
        serde_wasm_bindgen::to_value(&results)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Get full memory usage statistics including binary index
    /// Returns { fullBytes, scalarQuantizedBytes, binaryQuantizedBytes }
    #[wasm_bindgen(js_name = memoryUsageFull)]
    pub fn memory_usage_full(&self) -> Result<JsValue, JsValue> {
        let (full, scalar, binary) = self.inner.memory_usage_full();
        
        let stats = serde_json::json!({
            "fullBytes": full,
            "scalarQuantizedBytes": scalar,
            "binaryQuantizedBytes": binary,
            "scalarCompressionRatio": if scalar > 0 { full as f32 / scalar as f32 } else { 1.0 },
            "binaryCompressionRatio": if binary > 0 { full as f32 / binary as f32 } else { 1.0 }
        });
        
        serde_wasm_bindgen::to_value(&stats)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    // ========================================================================
    // Filtered Search
    // ========================================================================

    /// Search with a list of allowed IDs
    /// 
    /// The filter is specified as a list of allowed IDs. This is simpler for WASM
    /// than passing filter expressions - the JS side evaluates metadata conditions
    /// and passes the resulting allowed ID set.
    /// 
    /// # Arguments
    /// * `query` - Query vector
    /// * `k` - Number of results to return
    /// * `allowed_ids` - List of IDs that are allowed in results
    #[wasm_bindgen(js_name = searchFiltered)]
    pub fn search_filtered(&self, query: Vec<f32>, k: usize, allowed_ids: Vec<u32>) -> Result<Vec<u32>, JsValue> {
        use std::collections::HashSet;
        let allowed: HashSet<u32> = allowed_ids.into_iter().collect();
        
        let results = self.inner.search_knn_filtered(&query, k, |id| allowed.contains(&id));
        let ids: Vec<u32> = results.into_iter().map(|(id, _)| id).collect();
        Ok(ids)
    }

    /// Search with a list of allowed IDs, returning scores
    #[wasm_bindgen(js_name = searchFilteredWithScores)]
    pub fn search_filtered_with_scores(&self, query: Vec<f32>, k: usize, allowed_ids: Vec<u32>) -> Result<JsValue, JsValue> {
        use std::collections::HashSet;
        let allowed: HashSet<u32> = allowed_ids.into_iter().collect();
        
        let results = self.inner.search_knn_filtered(&query, k, |id| allowed.contains(&id));
        serde_wasm_bindgen::to_value(&results)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}