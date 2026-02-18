// Package quantization provides vector compression for HNSW
package quantization

import (
	"math"
	"testing"
)

// ============================================================================
// QuantizeScalar Contract Tests
// ============================================================================

func TestQuantizeScalar_Basic(t *testing.T) {
	vector := []float32{1.0, 2.0, 3.0, 4.0, 5.0}
	sq := QuantizeScalar(vector)

	if len(sq.Data) != 5 {
		t.Errorf("Data length = %v, want 5", len(sq.Data))
	}
	if math.Abs(float64(sq.Min)-1.0) > 1e-6 {
		t.Errorf("Min = %v, want 1.0", sq.Min)
	}
	if sq.Scale <= 0 {
		t.Errorf("Scale should be positive, got %v", sq.Scale)
	}
}

func TestQuantizeScalar_EmptyVector(t *testing.T) {
	vector := []float32{}
	sq := QuantizeScalar(vector)

	if len(sq.Data) != 0 {
		t.Errorf("Empty vector data should be empty, got %v", sq.Data)
	}
}

func TestQuantizeScalar_IdenticalValues(t *testing.T) {
	vector := []float32{5.0, 5.0, 5.0, 5.0}
	sq := QuantizeScalar(vector)

	// All values should be 0 (since all are at min)
	for i, v := range sq.Data {
		if v != 0 {
			t.Errorf("Identical values should quantize to 0, got %v at index %d", v, i)
		}
	}
	if math.Abs(float64(sq.Min)-5.0) > 1e-6 {
		t.Errorf("Min = %v, want 5.0", sq.Min)
	}
}

func TestQuantizeScalar_NegativeValues(t *testing.T) {
	vector := []float32{-10.0, -5.0, 0.0, 5.0, 10.0}
	sq := QuantizeScalar(vector)

	if len(sq.Data) != 5 {
		t.Errorf("Data length = %v, want 5", len(sq.Data))
	}
	if math.Abs(float64(sq.Min)-(-10.0)) > 1e-6 {
		t.Errorf("Min = %v, want -10.0", sq.Min)
	}
	// First value should be 0 (min), last should be 255 (max)
	if sq.Data[0] != 0 {
		t.Errorf("Min value should quantize to 0, got %v", sq.Data[0])
	}
	if sq.Data[4] != 255 {
		t.Errorf("Max value should quantize to 255, got %v", sq.Data[4])
	}
}

func TestQuantizeScalar_768D(t *testing.T) {
	vector := make([]float32, 768)
	for i := range vector {
		vector[i] = float32(i) / 768.0
	}
	sq := QuantizeScalar(vector)

	if len(sq.Data) != 768 {
		t.Errorf("768D data length = %v, want 768", len(sq.Data))
	}
}

func TestQuantizeScalar_1536D(t *testing.T) {
	vector := make([]float32, 1536)
	for i := range vector {
		vector[i] = float32(i) / 1536.0
	}
	sq := QuantizeScalar(vector)

	if len(sq.Data) != 1536 {
		t.Errorf("1536D data length = %v, want 1536", len(sq.Data))
	}
}

// ============================================================================
// Reconstruct Contract Tests
// ============================================================================

func TestReconstruct_Roundtrip(t *testing.T) {
	vector := []float32{1.0, 2.0, 3.0, 4.0, 5.0}
	sq := QuantizeScalar(vector)
	reconstructed := sq.Reconstruct()

	if len(reconstructed) != len(vector) {
		t.Errorf("Reconstructed length = %v, want %v", len(reconstructed), len(vector))
	}

	// With 8-bit quantization, max error is roughly (max-min)/255
	maxError := (5.0 - 1.0) / 255.0 * 2.0 // 2x tolerance for rounding

	for i, orig := range vector {
		if math.Abs(float64(reconstructed[i]-orig)) > float64(maxError) {
			t.Errorf("Roundtrip error at %d: orig=%v, recon=%v, error=%v",
				i, orig, reconstructed[i], math.Abs(float64(reconstructed[i]-orig)))
		}
	}
}

func TestReconstruct_PreservesEndpoints(t *testing.T) {
	vector := []float32{0.0, 100.0}
	sq := QuantizeScalar(vector)
	reconstructed := sq.Reconstruct()

	// Min should be approximately 0
	if math.Abs(float64(reconstructed[0])) > 0.5 {
		t.Errorf("Min endpoint = %v, want ~0", reconstructed[0])
	}
	// Max should be approximately 100
	if math.Abs(float64(reconstructed[1])-100.0) > 0.5 {
		t.Errorf("Max endpoint = %v, want ~100", reconstructed[1])
	}
}

func TestReconstruct_768D(t *testing.T) {
	vector := make([]float32, 768)
	for i := range vector {
		vector[i] = float32(i) / 768.0
	}
	sq := QuantizeScalar(vector)
	reconstructed := sq.Reconstruct()

	if len(reconstructed) != 768 {
		t.Errorf("Reconstructed length = %v, want 768", len(reconstructed))
	}
}

// ============================================================================
// DistanceL2Squared Contract Tests
// ============================================================================

func TestDistanceL2Squared_IdenticalVectors(t *testing.T) {
	v := []float32{1.0, 2.0, 3.0, 4.0, 5.0}
	sq1 := QuantizeScalar(v)
	sq2 := QuantizeScalar(v)

	dist := sq1.DistanceL2Squared(&sq2)
	if dist > 1e-6 {
		t.Errorf("Identical vectors distance = %v, want ~0", dist)
	}
}

func TestDistanceL2Squared_Symmetric(t *testing.T) {
	v1 := []float32{1.0, 2.0, 3.0, 4.0, 5.0}
	v2 := []float32{2.0, 3.0, 4.0, 5.0, 6.0}

	sq1 := QuantizeScalar(v1)
	sq2 := QuantizeScalar(v2)

	dAB := sq1.DistanceL2Squared(&sq2)
	dBA := sq2.DistanceL2Squared(&sq1)

	if math.Abs(float64(dAB-dBA)) > 0.01 {
		t.Errorf("Distance not symmetric: d(a,b)=%v, d(b,a)=%v", dAB, dBA)
	}
}

func TestDistanceL2Squared_NonNegative(t *testing.T) {
	v1 := []float32{0.0, 0.0}
	v2 := []float32{1.0, 0.0}
	v3 := []float32{10.0, 0.0}

	sq1 := QuantizeScalar(v1)
	sq2 := QuantizeScalar(v2)
	sq3 := QuantizeScalar(v3)

	dSelf := sq1.DistanceL2Squared(&sq1)
	if dSelf < 0 {
		t.Errorf("Self-distance should be non-negative, got %v", dSelf)
	}

	dNear := sq1.DistanceL2Squared(&sq2)
	dFar := sq1.DistanceL2Squared(&sq3)

	if dNear < 0 || dFar < 0 {
		t.Errorf("Distances should be non-negative: near=%v, far=%v", dNear, dFar)
	}
}

// ============================================================================
// CosineToQuery Contract Tests
// ============================================================================

func TestCosineToQuery_IdenticalDirection(t *testing.T) {
	v := []float32{1.0, 0.0, 0.0}
	query := []float32{2.0, 0.0, 0.0} // Same direction, different magnitude
	queryMag := float32(2.0)

	sq := QuantizeScalar(v)
	sim := sq.CosineToQuery(query, queryMag)

	if sim < 0.9 {
		t.Errorf("Identical direction similarity = %v, want > 0.9", sim)
	}
}

func TestCosineToQuery_Orthogonal(t *testing.T) {
	v := []float32{1.0, 0.0}
	query := []float32{0.0, 1.0}
	queryMag := float32(1.0)

	sq := QuantizeScalar(v)
	sim := sq.CosineToQuery(query, queryMag)

	if math.Abs(float64(sim)) > 0.1 {
		t.Errorf("Orthogonal vectors similarity = %v, want ~0", sim)
	}
}

func TestCosineToQuery_DimensionMismatch(t *testing.T) {
	v := []float32{1.0, 2.0, 3.0}
	query := []float32{1.0, 2.0} // Different dimension
	queryMag := float32(2.236)

	sq := QuantizeScalar(v)
	sim := sq.CosineToQuery(query, queryMag)

	if sim != 0.0 {
		t.Errorf("Dimension mismatch should return 0, got %v", sim)
	}
}

// ============================================================================
// Compression Ratio Contract Tests
// ============================================================================

func TestScalarCompressionRatio_384D(t *testing.T) {
	v := make([]float32, 384)
	for i := range v {
		v[i] = float32(i) / 384.0
	}
	sq := QuantizeScalar(v)

	ratio := sq.CompressionRatio()
	// Expected: 384 * 4 / (384 + 8) = 1536 / 392 ≈ 3.9x
	if ratio < 3.5 || ratio > 4.5 {
		t.Errorf("384D compression ratio = %v, expected 3.5-4.5x", ratio)
	}
}

func TestScalarCompressionRatio_768D(t *testing.T) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i) / 768.0
	}
	sq := QuantizeScalar(v)

	ratio := sq.CompressionRatio()
	// Expected: 768 * 4 / (768 + 8) = 3072 / 776 ≈ 3.96x
	if ratio < 3.5 || ratio > 4.5 {
		t.Errorf("768D compression ratio = %v, expected 3.5-4.5x", ratio)
	}
}

func TestScalarCompressionRatio_1536D(t *testing.T) {
	v := make([]float32, 1536)
	sq := QuantizeScalar(v)

	ratio := sq.CompressionRatio()
	// Expected: 1536 * 4 / (1536 + 8) = 6144 / 1544 ≈ 3.98x
	if ratio < 3.5 || ratio > 4.5 {
		t.Errorf("1536D compression ratio = %v, expected 3.5-4.5x", ratio)
	}
}

// ============================================================================
// SizeBytes Contract Tests
// ============================================================================

func TestScalarSizeBytes_384D(t *testing.T) {
	v := make([]float32, 384)
	sq := QuantizeScalar(v)

	size := sq.SizeBytes()
	// 384 bytes + 8 bytes overhead = 392
	if size != 392 {
		t.Errorf("384D size = %v bytes, want 392", size)
	}
}

func TestScalarSizeBytes_768D(t *testing.T) {
	v := make([]float32, 768)
	sq := QuantizeScalar(v)

	size := sq.SizeBytes()
	// 768 bytes + 8 bytes overhead = 776
	if size != 776 {
		t.Errorf("768D size = %v bytes, want 776", size)
	}
}

// ============================================================================
// Similarity Ranking Preservation Test
// ============================================================================

func TestSimilarityRankingPreserved(t *testing.T) {
	// Ensure quantization preserves relative similarity ordering
	base := []float32{1.0, 0.0, 0.0}
	similar := []float32{0.9, 0.1, 0.0}
	dissimilar := []float32{0.0, 1.0, 0.0}

	sqBase := QuantizeScalar(base)
	sqSimilar := QuantizeScalar(similar)
	sqDissimilar := QuantizeScalar(dissimilar)

	distSimilar := sqBase.DistanceL2Squared(&sqSimilar)
	distDissimilar := sqBase.DistanceL2Squared(&sqDissimilar)

	if distSimilar >= distDissimilar {
		t.Errorf("Similar vector should be closer: similar=%v, dissimilar=%v",
			distSimilar, distDissimilar)
	}
}

// ============================================================================
// Dimensions Contract Test
// ============================================================================

func TestDimensions(t *testing.T) {
	v := []float32{1.0, 2.0, 3.0, 4.0, 5.0}
	sq := QuantizeScalar(v)

	if sq.Dimensions() != 5 {
		t.Errorf("Dimensions() = %v, want 5", sq.Dimensions())
	}
}

// ============================================================================
// CosineSimilarity Contract Tests
// ============================================================================

func TestCosineSimilarityQuantized_Identical(t *testing.T) {
	v := []float32{1.0, 2.0, 3.0}
	sq := QuantizeScalar(v)

	sim := CosineSimilarity(&sq, &sq)
	if math.Abs(float64(sim)-1.0) > 0.01 {
		t.Errorf("Identical vectors similarity = %v, want ~1.0", sim)
	}
}

func TestCosineSimilarityQuantized_Orthogonal(t *testing.T) {
	v1 := []float32{1.0, 0.0}
	v2 := []float32{0.0, 1.0}

	sq1 := QuantizeScalar(v1)
	sq2 := QuantizeScalar(v2)

	sim := CosineSimilarity(&sq1, &sq2)
	if math.Abs(float64(sim)) > 0.1 {
		t.Errorf("Orthogonal vectors similarity = %v, want ~0", sim)
	}
}

// ============================================================================
// Benchmark Tests
// ============================================================================

func BenchmarkQuantizeScalar_768D(b *testing.B) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		QuantizeScalar(v)
	}
}

func BenchmarkQuantizeScalar_1536D(b *testing.B) {
	v := make([]float32, 1536)
	for i := range v {
		v[i] = float32(i)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		QuantizeScalar(v)
	}
}

func BenchmarkReconstruct_768D(b *testing.B) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
	}
	sq := QuantizeScalar(v)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sq.Reconstruct()
	}
}

func BenchmarkDistanceL2Squared_768D(b *testing.B) {
	v1 := make([]float32, 768)
	v2 := make([]float32, 768)
	for i := range v1 {
		v1[i] = float32(i)
		v2[i] = float32(i + 1)
	}
	sq1 := QuantizeScalar(v1)
	sq2 := QuantizeScalar(v2)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sq1.DistanceL2Squared(&sq2)
	}
}

func BenchmarkCosineToQuery_768D(b *testing.B) {
	v := make([]float32, 768)
	query := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
		query[i] = float32(i + 1)
	}
	sq := QuantizeScalar(v)
	queryMag := float32(math.Sqrt(float64(768.0)))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sq.CosineToQuery(query, queryMag)
	}
}
