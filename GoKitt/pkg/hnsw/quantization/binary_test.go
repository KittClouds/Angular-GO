// Package quantization provides vector compression for HNSW
package quantization

import (
	"math"
	"testing"
)

// ============================================================================
// Quantize Contract Tests
// ============================================================================

func TestQuantizeBinary_Basic(t *testing.T) {
	vector := []float32{1.0, -1.0, 0.5, -0.5, 0.0}
	bq := QuantizeBinary(vector)

	if bq.Dimensions != 5 {
		t.Errorf("Dimensions = %v, want 5", bq.Dimensions)
	}
	// Bits: 1, 0, 1, 0, 1 (0.0 counts as positive)
	// Packed: 0b10101 = 21
	if bq.Data[0]&0b11111 != 0b10101 {
		t.Errorf("Low bits = %b, want 10101", bq.Data[0]&0b11111)
	}
}

func TestQuantizeBinary_EmptyVector(t *testing.T) {
	vector := []float32{}
	bq := QuantizeBinary(vector)

	if bq.Dimensions != 0 {
		t.Errorf("Empty vector dimensions = %v, want 0", bq.Dimensions)
	}
	if len(bq.Data) != 0 {
		t.Errorf("Empty vector data should be empty, got %v", bq.Data)
	}
}

func TestQuantizeBinary_AllPositive(t *testing.T) {
	vector := []float32{1.0, 2.0, 3.0, 4.0}
	bq := QuantizeBinary(vector)

	if bq.Data[0]&0b1111 != 0b1111 {
		t.Errorf("All positive bits = %b, want 1111", bq.Data[0]&0b1111)
	}
}

func TestQuantizeBinary_AllNegative(t *testing.T) {
	vector := []float32{-1.0, -2.0, -3.0, -4.0}
	bq := QuantizeBinary(vector)

	if bq.Data[0]&0b1111 != 0b0000 {
		t.Errorf("All negative bits = %b, want 0000", bq.Data[0]&0b1111)
	}
}

func TestQuantizeBinary_64D(t *testing.T) {
	// 64D - fits in 1 uint64
	vector := make([]float32, 64)
	for i := range vector {
		vector[i] = 1.0
	}
	bq := QuantizeBinary(vector)

	if len(bq.Data) != 1 {
		t.Errorf("64D should use 1 uint64, got %v", len(bq.Data))
	}
	if bq.Data[0] != math.MaxUint64 {
		t.Errorf("All ones should be MaxUint64, got %v", bq.Data[0])
	}
}

func TestQuantizeBinary_384D(t *testing.T) {
	// 384D - needs 6 uint64s (384/64 = 6)
	vector := make([]float32, 384)
	for i := range vector {
		if i%2 == 0 {
			vector[i] = 1.0
		} else {
			vector[i] = -1.0
		}
	}
	bq := QuantizeBinary(vector)

	if bq.Dimensions != 384 {
		t.Errorf("Dimensions = %v, want 384", bq.Dimensions)
	}
	if len(bq.Data) != 6 {
		t.Errorf("384D should use 6 uint64s, got %v", len(bq.Data))
	}
}

func TestQuantizeBinary_768D(t *testing.T) {
	// 768D - needs 12 uint64s
	vector := make([]float32, 768)
	bq := QuantizeBinary(vector)

	if len(bq.Data) != 12 {
		t.Errorf("768D should use 12 uint64s, got %v", len(bq.Data))
	}
}

func TestQuantizeBinary_1536D(t *testing.T) {
	// 1536D - needs 24 uint64s
	vector := make([]float32, 1536)
	bq := QuantizeBinary(vector)

	if len(bq.Data) != 24 {
		t.Errorf("1536D should use 24 uint64s, got %v", len(bq.Data))
	}
}

// ============================================================================
// Hamming Distance Contract Tests
// ============================================================================

func TestHammingDistance_Identical(t *testing.T) {
	v := []float32{1.0, -1.0, 1.0, -1.0}
	bq1 := QuantizeBinary(v)
	bq2 := QuantizeBinary(v)

	if bq1.HammingDistance(&bq2) != 0 {
		t.Errorf("Identical vectors should have Hamming distance 0")
	}
}

func TestHammingDistance_AllDifferent(t *testing.T) {
	v1 := []float32{1.0, 1.0, 1.0, 1.0}
	v2 := []float32{-1.0, -1.0, -1.0, -1.0}

	bq1 := QuantizeBinary(v1)
	bq2 := QuantizeBinary(v2)

	if bq1.HammingDistance(&bq2) != 4 {
		t.Errorf("All different bits should have distance 4, got %v", bq1.HammingDistance(&bq2))
	}
}

func TestHammingDistance_HalfDifferent(t *testing.T) {
	v1 := []float32{1.0, 1.0, -1.0, -1.0}
	v2 := []float32{1.0, -1.0, -1.0, 1.0}

	bq1 := QuantizeBinary(v1)
	bq2 := QuantizeBinary(v2)

	if bq1.HammingDistance(&bq2) != 2 {
		t.Errorf("Half different bits should have distance 2, got %v", bq1.HammingDistance(&bq2))
	}
}

func TestHammingDistance_DimensionMismatch(t *testing.T) {
	v1 := []float32{1.0, 1.0}
	v2 := []float32{1.0, 1.0, 1.0}

	bq1 := QuantizeBinary(v1)
	bq2 := QuantizeBinary(v2)

	if bq1.HammingDistance(&bq2) != math.MaxUint32 {
		t.Errorf("Dimension mismatch should return MaxUint32, got %v", bq1.HammingDistance(&bq2))
	}
}

func TestHammingDistance_LargeVectors(t *testing.T) {
	// 768D vectors
	v1 := make([]float32, 768)
	v2 := make([]float32, 768)
	for i := range v1 {
		v1[i] = 1.0
		if i < 384 {
			v2[i] = 1.0
		} else {
			v2[i] = -1.0
		}
	}

	bq1 := QuantizeBinary(v1)
	bq2 := QuantizeBinary(v2)

	// Half the bits should differ
	if bq1.HammingDistance(&bq2) != 384 {
		t.Errorf("Half different 768D should have distance 384, got %v", bq1.HammingDistance(&bq2))
	}
}

// ============================================================================
// Similarity Contract Tests
// ============================================================================

func TestSimilarity_Identical(t *testing.T) {
	v := []float32{1.0, -1.0, 1.0, -1.0}
	bq1 := QuantizeBinary(v)
	bq2 := QuantizeBinary(v)

	sim := bq1.Similarity(&bq2)
	if math.Abs(float64(sim)-1.0) > 1e-6 {
		t.Errorf("Identical vectors similarity = %v, want 1.0", sim)
	}
}

func TestSimilarity_Opposite(t *testing.T) {
	v1 := []float32{1.0, 1.0, 1.0, 1.0}
	v2 := []float32{-1.0, -1.0, -1.0, -1.0}

	bq1 := QuantizeBinary(v1)
	bq2 := QuantizeBinary(v2)

	sim := bq1.Similarity(&bq2)
	if math.Abs(float64(sim)) > 1e-6 {
		t.Errorf("Opposite vectors similarity = %v, want 0.0", sim)
	}
}

func TestSimilarity_Half(t *testing.T) {
	v1 := []float32{1.0, 1.0, -1.0, -1.0}
	v2 := []float32{1.0, -1.0, -1.0, 1.0}

	bq1 := QuantizeBinary(v1)
	bq2 := QuantizeBinary(v2)

	sim := bq1.Similarity(&bq2)
	if math.Abs(float64(sim)-0.5) > 1e-6 {
		t.Errorf("Half similar vectors similarity = %v, want 0.5", sim)
	}
}

// ============================================================================
// Compression Ratio Contract Tests
// ============================================================================

func TestCompressionRatio_384D(t *testing.T) {
	v := make([]float32, 384)
	for i := range v {
		v[i] = float32(i)
	}
	bq := QuantizeBinary(v)

	ratio := bq.CompressionRatio()
	// 384 * 4 = 1536 bytes / (6 * 8 + 8) = 56 bytes ≈ 27x
	if ratio < 20.0 || ratio > 35.0 {
		t.Errorf("384D compression ratio = %v, expected 20-35x", ratio)
	}
}

func TestCompressionRatio_768D(t *testing.T) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
	}
	bq := QuantizeBinary(v)

	ratio := bq.CompressionRatio()
	// 768 * 4 = 3072 bytes / (12 * 8 + 8) = 104 bytes ≈ 29.5x
	if ratio < 25.0 || ratio > 35.0 {
		t.Errorf("768D compression ratio = %v, expected 25-35x", ratio)
	}
}

func TestCompressionRatio_1536D(t *testing.T) {
	v := make([]float32, 1536)
	bq := QuantizeBinary(v)

	ratio := bq.CompressionRatio()
	// 1536 * 4 = 6144 bytes / (24 * 8 + 8) = 200 bytes ≈ 30x
	if ratio < 25.0 || ratio > 35.0 {
		t.Errorf("1536D compression ratio = %v, expected 25-35x", ratio)
	}
}

// ============================================================================
// SizeBytes Contract Tests
// ============================================================================

func TestSizeBytes_384D(t *testing.T) {
	v := make([]float32, 384)
	bq := QuantizeBinary(v)

	size := bq.SizeBytes()
	// 6 words * 8 bytes + 8 bytes overhead = 56
	if size != 56 {
		t.Errorf("384D size = %v bytes, want 56", size)
	}
}

func TestSizeBytes_768D(t *testing.T) {
	v := make([]float32, 768)
	bq := QuantizeBinary(v)

	size := bq.SizeBytes()
	// 12 words * 8 bytes + 8 bytes overhead = 104
	if size != 104 {
		t.Errorf("768D size = %v bytes, want 104", size)
	}
}

// ============================================================================
// Two-Stage Search Contract Tests
// ============================================================================

func TestTwoStageSearch_EmptyIndex(t *testing.T) {
	query := []float32{1.0, 0.0, 0.0}
	index := make(map[uint32]BinaryQuantized)

	results := TwoStageSearch(query, index, 5, 2.0,
		func(id uint32) []float32 { return nil },
		func(a, b []float32) float32 { return 0.0 },
	)

	if len(results) != 0 {
		t.Errorf("Empty index should return empty results, got %v", len(results))
	}
}

func TestTwoStageSearch_ReturnsK(t *testing.T) {
	vectors := map[uint32][]float32{
		1: {1.0, 0.0, 0.0},
		2: {0.9, 0.1, 0.0},
		3: {0.0, 1.0, 0.0},
		4: {0.0, 0.0, 1.0},
	}

	binaryIndex := make(map[uint32]BinaryQuantized)
	for id, v := range vectors {
		binaryIndex[id] = QuantizeBinary(v)
	}

	query := []float32{1.0, 0.0, 0.0}

	results := TwoStageSearch(query, binaryIndex, 3, 2.0,
		func(id uint32) []float32 { return vectors[id] },
		func(a, b []float32) float32 {
			// Simple dot product as similarity
			var sum float32
			for i := range a {
				sum += a[i] * b[i]
			}
			return sum
		},
	)

	if len(results) != 3 {
		t.Errorf("Should return k=3 results, got %v", len(results))
	}
}

func TestTwoStageSearch_Ordering(t *testing.T) {
	vectors := map[uint32][]float32{
		1: {1.0, 0.0, 0.0},     // Exact match
		2: {0.707, 0.707, 0.0}, // 45 degrees
		3: {0.0, 1.0, 0.0},     // 90 degrees
	}

	binaryIndex := make(map[uint32]BinaryQuantized)
	for id, v := range vectors {
		binaryIndex[id] = QuantizeBinary(v)
	}

	query := []float32{1.0, 0.0, 0.0}

	results := TwoStageSearch(query, binaryIndex, 3, 2.0,
		func(id uint32) []float32 { return vectors[id] },
		func(a, b []float32) float32 {
			var sum float32
			for i := range a {
				sum += a[i] * b[i]
			}
			return sum
		},
	)

	// Should be ordered by exact similarity after reranking
	if results[0].ID != 1 {
		t.Errorf("First result should be ID 1 (exact match), got %v", results[0].ID)
	}
	if results[0].Score <= results[1].Score {
		t.Errorf("Scores should be descending: %v, %v", results[0].Score, results[1].Score)
	}
}

// ============================================================================
// Popcount Tests
// ============================================================================

func TestPopcount_Zero(t *testing.T) {
	if popcount(0) != 0 {
		t.Errorf("popcount(0) = %v, want 0", popcount(0))
	}
}

func TestPopcount_AllOnes(t *testing.T) {
	if popcount(math.MaxUint64) != 64 {
		t.Errorf("popcount(MaxUint64) = %v, want 64", popcount(math.MaxUint64))
	}
}

func TestPopcount_Patterns(t *testing.T) {
	tests := []struct {
		x      uint64
		expect int
	}{
		{1, 1},
		{2, 1},
		{3, 2},
		{0xFF, 8},
		{0xFFFF, 16},
		{0xAAAAAAAAAAAAAAAA, 32}, // Alternating bits
	}

	for _, tt := range tests {
		if got := popcount(tt.x); got != tt.expect {
			t.Errorf("popcount(%x) = %v, want %v", tt.x, got, tt.expect)
		}
	}
}

// ============================================================================
// Benchmark Tests
// ============================================================================

func BenchmarkQuantizeBinary_768D(b *testing.B) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		QuantizeBinary(v)
	}
}

func BenchmarkQuantizeBinary_1536D(b *testing.B) {
	v := make([]float32, 1536)
	for i := range v {
		v[i] = float32(i)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		QuantizeBinary(v)
	}
}

func BenchmarkHammingDistance_768D(b *testing.B) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
	}
	bq1 := QuantizeBinary(v)
	bq2 := QuantizeBinary(v)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		bq1.HammingDistance(&bq2)
	}
}

func BenchmarkTwoStageSearch_1000Vectors(b *testing.B) {
	// Create 1000 vectors
	vectors := make(map[uint32][]float32)
	binaryIndex := make(map[uint32]BinaryQuantized)

	for i := 0; i < 1000; i++ {
		v := make([]float32, 384)
		for j := range v {
			v[j] = float32(i*j%100) / 100.0
		}
		vectors[uint32(i)] = v
		binaryIndex[uint32(i)] = QuantizeBinary(v)
	}

	query := make([]float32, 384)
	for i := range query {
		query[i] = 0.5
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		TwoStageSearch(query, binaryIndex, 10, 10.0,
			func(id uint32) []float32 { return vectors[id] },
			func(a, b []float32) float32 {
				var sum float32
				for i := range a {
					sum += a[i] * b[i]
				}
				return sum
			},
		)
	}
}
