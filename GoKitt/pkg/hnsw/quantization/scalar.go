// Package quantization provides vector compression for HNSW
package quantization

import (
	"math"

	"github.com/kittclouds/gokitt/pkg/hnsw/distance"
)

// ScalarQuantized represents f32 -> u8 compression
// 4x compression with ~1% recall loss
// Uses min-max normalization: quantized = (value - min) / scale * 255
type ScalarQuantized struct {
	Data  []uint8 // Quantized values (u8 per dimension)
	Min   float32 // Minimum value for dequantization
	Scale float32 // Scale factor: (max - min) / 255.0
}

// QuantizeScalar converts f32 vector to u8 using min-max normalization
// Equivalent to Rust: ScalarQuantized::quantize(vector: &[f32]) -> Self
func QuantizeScalar(vector []float32) ScalarQuantized {
	if len(vector) == 0 {
		return ScalarQuantized{Data: nil, Min: 0.0, Scale: 1.0}
	}

	// Find min/max
	min := float32(math.Inf(1))
	max := float32(math.Inf(-1))
	for _, v := range vector {
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}

	// Handle edge case: all values identical
	scale := float32(1.0)
	if math.Abs(float64(max-min)) > 1e-10 {
		scale = (max - min) / 255.0
	}

	// Quantize
	data := make([]uint8, len(vector))
	for i, v := range vector {
		quantized := int(math.Round(float64((v - min) / scale)))
		if quantized < 0 {
			quantized = 0
		}
		if quantized > 255 {
			quantized = 255
		}
		data[i] = uint8(quantized)
	}

	return ScalarQuantized{Data: data, Min: min, Scale: scale}
}

// Reconstruct approximates original f32 vector
// reconstructed = min + (quantized * scale)
func (sq *ScalarQuantized) Reconstruct() []float32 {
	result := make([]float32, len(sq.Data))
	for i, v := range sq.Data {
		result[i] = sq.Min + float32(v)*sq.Scale
	}
	return result
}

// DistanceL2Squared computes approximate L2^2 distance
// Uses average scale for balanced comparison
func (sq *ScalarQuantized) DistanceL2Squared(other *ScalarQuantized) float32 {
	if len(sq.Data) != len(other.Data) {
		return float32(math.Inf(1))
	}

	// Average scale for balanced comparison
	avgScale := (sq.Scale + other.Scale) / 2.0

	var sum float32
	for i := range sq.Data {
		diff := int32(sq.Data[i]) - int32(other.Data[i])
		sum += float32(diff * diff)
	}

	return sum * avgScale * avgScale
}

// CosineToQuery computes cosine similarity to a full-precision query
// Reconstructs this vector and computes exact cosine to query
func (sq *ScalarQuantized) CosineToQuery(query []float32, queryMagnitude float32) float32 {
	reconstructed := sq.Reconstruct()

	if len(reconstructed) != len(query) {
		return 0.0
	}

	var dot, selfMagSq float32
	for i := range reconstructed {
		dot += reconstructed[i] * query[i]
		selfMagSq += reconstructed[i] * reconstructed[i]
	}

	selfMag := float32(math.Sqrt(float64(selfMagSq)))
	if selfMag == 0 || queryMagnitude == 0 {
		return 0.0
	}

	return dot / (selfMag * queryMagnitude)
}

// SizeBytes returns memory size in bytes
func (sq *ScalarQuantized) SizeBytes() int {
	return len(sq.Data) + 8 // data + min(4) + scale(4)
}

// CompressionRatio returns compression ratio vs f32
func (sq *ScalarQuantized) CompressionRatio() float32 {
	if len(sq.Data) == 0 {
		return 1.0
	}
	originalBytes := len(sq.Data) * 4 // f32 = 4 bytes
	compressedBytes := sq.SizeBytes()
	return float32(originalBytes) / float32(compressedBytes)
}

// Dimensions returns the vector dimension
func (sq *ScalarQuantized) Dimensions() int {
	return len(sq.Data)
}

// CosineSimilarity computes cosine similarity between two scalar-quantized vectors
// Uses full reconstruction for accuracy
func CosineSimilarity(a, b *ScalarQuantized) float32 {
	if len(a.Data) != len(b.Data) {
		return 0.0
	}

	// Reconstruct both vectors
	ar := a.Reconstruct()
	br := b.Reconstruct()

	// Use distance package for cosine
	return distance.CosineSimilarity(ar, br, 0, 0)
}
