// Package mmr provides Maximal Marginal Relevance for diverse search
package mmr

import (
	"github.com/kittclouds/gokitt/pkg/hnsw/distance"
)

// Config configures diversity vs relevance balance
type Config struct {
	// Lambda: 0.0 = pure diversity, 1.0 = pure relevance
	Lambda float32
	// How many extra candidates to fetch (multiplier on k)
	FetchMultiplier float32
}

// DefaultConfig returns the default MMR configuration
func DefaultConfig() Config {
	return Config{
		Lambda:          0.5,
		FetchMultiplier: 2.0,
	}
}

// BalancedConfig returns balanced config (0.5 lambda)
func BalancedConfig() Config {
	return DefaultConfig()
}

// RelevanceFocusedConfig returns relevance-focused config (0.7 lambda)
func RelevanceFocusedConfig() Config {
	return Config{
		Lambda:          0.7,
		FetchMultiplier: 1.5,
	}
}

// DiversityFocusedConfig returns diversity-focused config (0.3 lambda)
func DiversityFocusedConfig() Config {
	return Config{
		Lambda:          0.3,
		FetchMultiplier: 3.0,
	}
}

// WithLambda creates a config with custom lambda (clamped to 0.0-1.0)
func WithLambda(lambda float32) Config {
	if lambda < 0.0 {
		lambda = 0.0
	}
	if lambda > 1.0 {
		lambda = 1.0
	}
	return Config{
		Lambda:          lambda,
		FetchMultiplier: 2.0,
	}
}

// Candidate is a search result with vector for MMR computation
type Candidate struct {
	ID     uint32
	Score  float32
	Vector []float32
}

// Result is an MMR reranked result
type Result struct {
	ID    uint32
	Score float32
}

// Rerank applies MMR to balance relevance and diversity
// MMR = λ × similarity(query, doc) - (1-λ) × max(similarity(doc, selected_docs))
func Rerank(query []float32, candidates []Candidate, k int, lambda float32) []Result {
	if len(candidates) == 0 || k == 0 {
		return []Result{}
	}

	// Clamp k to available candidates
	if k > len(candidates) {
		k = len(candidates)
	}

	// Selected candidates
	selected := make([]Candidate, 0, k)
	// Remaining candidates (will be modified)
	remaining := make([]Candidate, len(candidates))
	copy(remaining, candidates)

	// Results
	results := make([]Result, 0, k)

	for i := 0; i < k; i++ {
		if len(remaining) == 0 {
			break
		}

		bestIdx := 0
		bestMmr := float32(-1e38) // Negative infinity equivalent

		// Find candidate with best MMR score
		for idx, candidate := range remaining {
			mmrScore := computeMmrScore(query, candidate, selected, lambda)
			if mmrScore > bestMmr {
				bestMmr = mmrScore
				bestIdx = idx
			}
		}

		// Move best candidate to selected
		best := remaining[bestIdx]
		selected = append(selected, best)
		results = append(results, Result{ID: best.ID, Score: best.Score})

		// Remove from remaining
		remaining = append(remaining[:bestIdx], remaining[bestIdx+1:]...)
	}

	return results
}

// computeMmrScore computes MMR score for a candidate
// MMR = λ × relevance - (1-λ) × max_similarity_to_selected
func computeMmrScore(query []float32, candidate Candidate, selected []Candidate, lambda float32) float32 {
	// Relevance: cosine similarity to query
	candidateMag := distance.Magnitude(candidate.Vector)
	relevance := distance.CosineSimilarity(query, candidate.Vector, 0, 0)

	// Diversity: max similarity to already selected documents
	maxSimilarity := float32(0.0)
	if len(selected) > 0 {
		for _, s := range selected {
			sMag := distance.Magnitude(s.Vector)
			sim := distance.CosineSimilarity(candidate.Vector, s.Vector, candidateMag, sMag)
			if sim > maxSimilarity {
				maxSimilarity = sim
			}
		}
	}

	// MMR = λ × relevance - (1-λ) × max_similarity
	return lambda*relevance - (1.0-lambda)*maxSimilarity
}
