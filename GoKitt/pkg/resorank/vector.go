package resorank

import "math"

// CosineSimilarity calculates the cosine similarity between two vectors
// Returns 0.0 if dimensions mismatch or either vector is zero-length
func CosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0.0
	}

	dotProduct := 0.0
	normA := 0.0
	normB := 0.0

	for i := 0; i < len(a); i++ {
		dotProduct += float64(a[i] * b[i])
		normA += float64(a[i] * a[i])
		normB += float64(b[i] * b[i])
	}

	if normA == 0 || normB == 0 {
		return 0.0
	}

	return dotProduct / (math.Sqrt(normA) * math.Sqrt(normB))
}

// Normalize modifies vector in-place to have unit length (L2 norm)
func Normalize(v []float32) {
	sumSq := 0.0
	for _, x := range v {
		sumSq += float64(x * x)
	}

	if sumSq == 0 {
		return
	}

	norm := float32(math.Sqrt(sumSq))
	for i := range v {
		v[i] /= norm
	}
}
