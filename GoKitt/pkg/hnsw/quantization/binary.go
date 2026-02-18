// Package quantization provides vector compression for HNSW
// Ported from Rust HNSW implementation
package quantization

import (
	"math"
)

// BinaryQuantized represents a vector compressed to binary sign bits
// 32x compression: 768D f32 (3072 bytes) -> 96 bytes
// Each dimension is encoded as 1 bit (positive = 1, negative = 0)
// Stored as packed uint64 words for efficient Hamming distance via popcount
type BinaryQuantized struct {
	Data       []uint64 // Packed binary codes (sign bits). Each uint64 holds 64 dimensions
	Dimensions int      // Original vector dimension
}

// QuantizeBinary converts f32 vector to binary sign bits
// Equivalent to Rust: BinaryQuantized::quantize(vector: &[f32]) -> Self
func QuantizeBinary(vector []float32) BinaryQuantized {
	dimensions := len(vector)
	if dimensions == 0 {
		return BinaryQuantized{Data: nil, Dimensions: 0}
	}

	// Ceiling division: (dimensions + 63) / 64
	numWords := (dimensions + 63) / 64
	data := make([]uint64, numWords)

	for i, v := range vector {
		if v >= 0.0 {
			wordIdx := i / 64
			bitIdx := uint(i % 64)
			data[wordIdx] |= 1 << bitIdx
		}
	}

	return BinaryQuantized{Data: data, Dimensions: dimensions}
}

// HammingDistance computes bit difference count
// Returns math.MaxUint32 for dimension mismatch
func (bq *BinaryQuantized) HammingDistance(other *BinaryQuantized) uint32 {
	if bq.Dimensions != other.Dimensions {
		return math.MaxUint32
	}

	var count uint32
	for i := range bq.Data {
		// XOR gives differing bits, popcount counts them
		count += uint32(popcount(bq.Data[i] ^ other.Data[i]))
	}
	return count
}

// Similarity returns normalized similarity [0,1] where 1.0 = identical
func (bq *BinaryQuantized) Similarity(other *BinaryQuantized) float32 {
	if bq.Dimensions == 0 {
		return 0.0
	}

	distance := bq.HammingDistance(other)
	if distance == math.MaxUint32 {
		return 0.0
	}

	return 1.0 - float32(distance)/float32(bq.Dimensions)
}

// SizeBytes returns memory size in bytes
func (bq *BinaryQuantized) SizeBytes() int {
	return len(bq.Data)*8 + 8 // data + dimensions field
}

// CompressionRatio returns compression ratio vs f32
func (bq *BinaryQuantized) CompressionRatio() float32 {
	if bq.Dimensions == 0 {
		return 1.0
	}
	originalBytes := bq.Dimensions * 4 // f32 = 4 bytes
	compressedBytes := bq.SizeBytes()
	return float32(originalBytes) / float32(compressedBytes)
}

// popcount counts the number of set bits in a uint64
// Uses Brian Kernighan's algorithm for portability
func popcount(x uint64) int {
	count := 0
	for x != 0 {
		count++
		x &= x - 1 // Clear the lowest set bit
	}
	return count
}

// TwoStageSearch performs binary coarse filter → exact rerank
// Stage 1: Fast Hamming distance filtering on binary codes
// Stage 2: Exact similarity scoring on full-precision vectors
func TwoStageSearch(
	query []float32,
	binaryIndex map[uint32]BinaryQuantized,
	k int,
	rerankMultiplier float32,
	getFullVector func(id uint32) []float32,
	similarityFn func(a, b []float32) float32,
) []struct {
	ID    uint32
	Score float32
} {
	if len(binaryIndex) == 0 || k == 0 {
		return nil
	}

	// Stage 1: Binary coarse filter
	queryBinary := QuantizeBinary(query)
	rerankCount := int(math.Ceil(float64(k) * float64(rerankMultiplier)))
	if rerankCount < k {
		rerankCount = k
	}

	// Score all binary vectors by Hamming distance
	type candidate struct {
		id   uint32
		dist uint32
	}
	candidates := make([]candidate, 0, len(binaryIndex))

	for id, bq := range binaryIndex {
		dist := queryBinary.HammingDistance(&bq)
		candidates = append(candidates, candidate{id: id, dist: dist})
	}

	// Sort by Hamming distance (ascending = most similar)
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			if candidates[j].dist < candidates[i].dist {
				candidates[i], candidates[j] = candidates[j], candidates[i]
			}
		}
	}

	// Truncate to rerank count
	if len(candidates) > rerankCount {
		candidates = candidates[:rerankCount]
	}

	// Stage 2: Exact rerank with full precision
	type result struct {
		ID    uint32
		Score float32
	}
	results := make([]result, 0, len(candidates))

	for _, c := range candidates {
		vector := getFullVector(c.id)
		if vector != nil {
			score := similarityFn(query, vector)
			results = append(results, result{ID: c.id, Score: score})
		}
	}

	// Sort by score (descending = highest similarity first)
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].Score > results[i].Score {
				results[i], results[j] = results[j], results[i]
			}
		}
	}

	// Truncate to k
	if len(results) > k {
		results = results[:k]
	}

	// Convert to return type
	ret := make([]struct {
		ID    uint32
		Score float32
	}, len(results))
	for i, r := range results {
		ret[i].ID = r.ID
		ret[i].Score = r.Score
	}

	return ret
}
