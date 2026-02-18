// Package distance provides vector similarity functions with loop unrolling
// Ported from Rust HNSW implementation
package distance

import (
	"math"
)

// Magnitude computes L2 norm with 4x loop unrolling
// Equivalent to Rust: magnitude(v: &[f32]) -> f32
func Magnitude(v []float32) float32 {
	var sum float32
	n := len(v)
	i := 0

	// Unroll 4
	for i+3 < n {
		sum += v[i]*v[i] + v[i+1]*v[i+1] + v[i+2]*v[i+2] + v[i+3]*v[i+3]
		i += 4
	}

	// Remainder
	for i < n {
		sum += v[i] * v[i]
		i++
	}

	return float32(math.Sqrt(float64(sum)))
}

// EuclideanDistanceSquared computes L2^2 distance with 4x loop unrolling
// Equivalent to Rust: euclidean_distance_squared(a: &[f32], b: &[f32]) -> f32
func EuclideanDistanceSquared(a, b []float32) float32 {
	// Handle mismatched lengths by using minimum
	n := len(a)
	if len(b) < n {
		n = len(b)
	}

	var sum float32
	i := 0

	// Unroll 4
	for i+3 < n {
		d0 := a[i] - b[i]
		d1 := a[i+1] - b[i+1]
		d2 := a[i+2] - b[i+2]
		d3 := a[i+3] - b[i+3]
		sum += d0*d0 + d1*d1 + d2*d2 + d3*d3
		i += 4
	}

	// Remainder
	for i < n {
		d := a[i] - b[i]
		sum += d * d
		i++
	}

	return sum
}

// CosineSimilarity computes cosine similarity with optional precomputed magnitudes
// If magA or magB is 0, it will be computed from the vector
// Equivalent to Rust: cosine_similarity(a, b, mag_a, mag_b)
func CosineSimilarity(a, b []float32, magA, magB float32) float32 {
	// Handle mismatched lengths
	n := len(a)
	if len(b) < n {
		n = len(b)
	}

	var dot float32
	i := 0

	// Unroll 4
	for i+3 < n {
		dot += a[i]*b[i] + a[i+1]*b[i+1] + a[i+2]*b[i+2] + a[i+3]*b[i+3]
		i += 4
	}

	// Remainder
	for i < n {
		dot += a[i] * b[i]
		i++
	}

	// Compute magnitudes if not provided
	ma := magA
	if ma == 0 {
		ma = Magnitude(a)
	}
	mb := magB
	if mb == 0 {
		mb = Magnitude(b)
	}

	if ma == 0 || mb == 0 {
		return 0
	}

	return dot / (ma * mb)
}
