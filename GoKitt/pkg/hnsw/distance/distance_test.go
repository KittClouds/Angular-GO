// Package distance provides vector similarity functions with loop unrolling
package distance

import (
	"math"
	"testing"
)

// ============================================================================
// Magnitude Contract Tests
// ============================================================================

func TestMagnitude_Basic(t *testing.T) {
	// Single dimension
	if got := Magnitude([]float32{3.0}); math.Abs(float64(got)-3.0) > 1e-6 {
		t.Errorf("Magnitude([3]) = %v, want 3.0", got)
	}

	// 3-4-5 triangle
	if got := Magnitude([]float32{3.0, 4.0}); math.Abs(float64(got)-5.0) > 1e-6 {
		t.Errorf("Magnitude([3,4]) = %v, want 5.0", got)
	}

	// Unit vector
	if got := Magnitude([]float32{1.0, 0.0, 0.0}); math.Abs(float64(got)-1.0) > 1e-6 {
		t.Errorf("Magnitude([1,0,0]) = %v, want 1.0", got)
	}
}

func TestMagnitude_Empty(t *testing.T) {
	if got := Magnitude([]float32{}); got != 0 {
		t.Errorf("Magnitude([]) = %v, want 0", got)
	}
}

func TestMagnitude_LargeVector(t *testing.T) {
	// 384D vector (BGE-small dimension)
	v := make([]float32, 384)
	for i := range v {
		v[i] = 1.0
	}
	// sqrt(384) ≈ 19.5959
	expected := float32(math.Sqrt(384.0))
	if got := Magnitude(v); math.Abs(float64(got)-float64(expected)) > 0.01 {
		t.Errorf("Magnitude(384D ones) = %v, want ~%v", got, expected)
	}
}

func TestMagnitude_768D(t *testing.T) {
	// 768D vector (ModernBERT dimension)
	v := make([]float32, 768)
	for i := range v {
		v[i] = 1.0
	}
	expected := float32(math.Sqrt(768.0))
	if got := Magnitude(v); math.Abs(float64(got)-float64(expected)) > 0.01 {
		t.Errorf("Magnitude(768D ones) = %v, want ~%v", got, expected)
	}
}

func TestMagnitude_1536D(t *testing.T) {
	// 1536D vector (OpenAI embedding dimension)
	v := make([]float32, 1536)
	for i := range v {
		v[i] = 1.0
	}
	expected := float32(math.Sqrt(1536.0))
	if got := Magnitude(v); math.Abs(float64(got)-float64(expected)) > 0.01 {
		t.Errorf("Magnitude(1536D ones) = %v, want ~%v", got, expected)
	}
}

func TestMagnitude_Negative(t *testing.T) {
	// Magnitude should be same for negative values
	v := []float32{-3.0, -4.0}
	if got := Magnitude(v); math.Abs(float64(got)-5.0) > 1e-6 {
		t.Errorf("Magnitude([-3,-4]) = %v, want 5.0", got)
	}
}

// ============================================================================
// Euclidean Distance Squared Contract Tests
// ============================================================================

func TestEuclideanDistanceSquared_Identical(t *testing.T) {
	v := []float32{1.0, 2.0, 3.0}
	if got := EuclideanDistanceSquared(v, v); got != 0 {
		t.Errorf("EuclideanDistanceSquared(v, v) = %v, want 0", got)
	}
}

func TestEuclideanDistanceSquared_UnitDistance(t *testing.T) {
	a := []float32{0.0}
	b := []float32{1.0}
	if got := EuclideanDistanceSquared(a, b); math.Abs(float64(got)-1.0) > 1e-6 {
		t.Errorf("EuclideanDistanceSquared([0], [1]) = %v, want 1.0", got)
	}
}

func TestEuclideanDistanceSquared_3D(t *testing.T) {
	a := []float32{1.0, 2.0, 3.0}
	b := []float32{2.0, 3.0, 5.0}
	// (2-1)^2 + (3-2)^2 + (5-3)^2 = 1 + 1 + 4 = 6
	if got := EuclideanDistanceSquared(a, b); math.Abs(float64(got)-6.0) > 1e-6 {
		t.Errorf("EuclideanDistanceSquared([1,2,3], [2,3,5]) = %v, want 6.0", got)
	}
}

func TestEuclideanDistanceSquared_Symmetric(t *testing.T) {
	a := []float32{1.0, 2.0, 3.0}
	b := []float32{4.0, 5.0, 6.0}
	dAB := EuclideanDistanceSquared(a, b)
	dBA := EuclideanDistanceSquared(b, a)
	if math.Abs(float64(dAB-dBA)) > 1e-6 {
		t.Errorf("Distance not symmetric: d(a,b)=%v, d(b,a)=%v", dAB, dBA)
	}
}

func TestEuclideanDistanceSquared_LargeVectors(t *testing.T) {
	// 768D vectors
	a := make([]float32, 768)
	b := make([]float32, 768)
	for i := range a {
		a[i] = float32(i)
		b[i] = float32(i + 1)
	}
	// Each dimension differs by 1, so sum = 768 * 1^2 = 768
	if got := EuclideanDistanceSquared(a, b); math.Abs(float64(got)-768.0) > 0.01 {
		t.Errorf("EuclideanDistanceSquared(768D) = %v, want 768.0", got)
	}
}

// ============================================================================
// Cosine Similarity Contract Tests
// ============================================================================

func TestCosineSimilarity_IdenticalDirection(t *testing.T) {
	a := []float32{1.0, 0.0, 0.0}
	b := []float32{2.0, 0.0, 0.0} // Same direction, different magnitude
	if got := CosineSimilarity(a, b, 0, 0); math.Abs(float64(got)-1.0) > 1e-6 {
		t.Errorf("CosineSimilarity([1,0,0], [2,0,0]) = %v, want 1.0", got)
	}
}

func TestCosineSimilarity_Orthogonal(t *testing.T) {
	a := []float32{1.0, 0.0}
	b := []float32{0.0, 1.0}
	if got := CosineSimilarity(a, b, 0, 0); math.Abs(float64(got)) > 1e-6 {
		t.Errorf("CosineSimilarity([1,0], [0,1]) = %v, want 0.0", got)
	}
}

func TestCosineSimilarity_Opposite(t *testing.T) {
	a := []float32{1.0, 0.0}
	b := []float32{-1.0, 0.0}
	if got := CosineSimilarity(a, b, 0, 0); math.Abs(float64(got)-(-1.0)) > 1e-6 {
		t.Errorf("CosineSimilarity([1,0], [-1,0]) = %v, want -1.0", got)
	}
}

func TestCosineSimilarity_WithPrecomputedMagnitudes(t *testing.T) {
	a := []float32{3.0, 4.0} // mag = 5
	b := []float32{6.0, 8.0} // mag = 10
	// dot = 18 + 32 = 50, cos = 50 / (5 * 10) = 1.0
	if got := CosineSimilarity(a, b, 5.0, 10.0); math.Abs(float64(got)-1.0) > 1e-6 {
		t.Errorf("CosineSimilarity with precomputed mags = %v, want 1.0", got)
	}
}

func TestCosineSimilarity_ZeroVector(t *testing.T) {
	a := []float32{0.0, 0.0}
	b := []float32{1.0, 0.0}
	if got := CosineSimilarity(a, b, 0, 0); got != 0 {
		t.Errorf("CosineSimilarity with zero vector = %v, want 0", got)
	}
}

func TestCosineSimilarity_45Degrees(t *testing.T) {
	// 45 degree angle: cos(45°) ≈ 0.707
	a := []float32{1.0, 0.0}
	b := []float32{1.0, 1.0}
	expected := float32(1.0 / math.Sqrt2)
	if got := CosineSimilarity(a, b, 0, 0); math.Abs(float64(got)-float64(expected)) > 1e-6 {
		t.Errorf("CosineSimilarity(45°) = %v, want %v", got, expected)
	}
}

func TestCosineSimilarity_LargeVectors(t *testing.T) {
	// 1536D vectors - identical direction
	a := make([]float32, 1536)
	b := make([]float32, 1536)
	for i := range a {
		a[i] = 1.0
		b[i] = 2.0 // Same direction, different magnitude
	}
	if got := CosineSimilarity(a, b, 0, 0); math.Abs(float64(got)-1.0) > 1e-6 {
		t.Errorf("CosineSimilarity(1536D identical direction) = %v, want 1.0", got)
	}
}

// ============================================================================
// Edge Cases
// ============================================================================

func TestEuclideanDistanceSquared_MismatchedLengths(t *testing.T) {
	a := []float32{1.0, 2.0, 3.0}
	b := []float32{1.0, 2.0} // Shorter
	// Should compute using minimum length: (1-1)^2 + (2-2)^2 = 0
	if got := EuclideanDistanceSquared(a, b); got != 0 {
		t.Errorf("EuclideanDistanceSquared with mismatched lengths = %v, want 0", got)
	}
}

func TestCosineSimilarity_MismatchedLengths(t *testing.T) {
	a := []float32{1.0, 2.0, 3.0}
	b := []float32{1.0, 2.0} // Shorter
	// Should compute using minimum length
	// This is a degenerate case - behavior is to use min length
	got := CosineSimilarity(a, b, 0, 0)
	if math.IsNaN(float64(got)) {
		t.Errorf("CosineSimilarity with mismatched lengths returned NaN")
	}
}

// ============================================================================
// Benchmark Tests
// ============================================================================

func BenchmarkMagnitude_768D(b *testing.B) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Magnitude(v)
	}
}

func BenchmarkEuclideanDistanceSquared_768D(b *testing.B) {
	a := make([]float32, 768)
	bv := make([]float32, 768)
	for i := range a {
		a[i] = float32(i)
		bv[i] = float32(i + 1)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		EuclideanDistanceSquared(a, bv)
	}
}

func BenchmarkCosineSimilarity_768D(b *testing.B) {
	a := make([]float32, 768)
	bv := make([]float32, 768)
	for i := range a {
		a[i] = float32(i)
		bv[i] = float32(i + 1)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CosineSimilarity(a, bv, 0, 0)
	}
}

func BenchmarkCosineSimilarity_1536D(b *testing.B) {
	a := make([]float32, 1536)
	bv := make([]float32, 1536)
	for i := range a {
		a[i] = float32(i)
		bv[i] = float32(i + 1)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CosineSimilarity(a, bv, 0, 0)
	}
}
