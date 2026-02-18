package mmr

import (
	"math"
	"testing"
)

// === MmrConfig Tests ===

func TestMmrConfigDefault(t *testing.T) {
	config := DefaultConfig()
	if config.Lambda != 0.5 {
		t.Errorf("expected default lambda 0.5, got %f", config.Lambda)
	}
	if config.FetchMultiplier != 2.0 {
		t.Errorf("expected default fetch multiplier 2.0, got %f", config.FetchMultiplier)
	}
}

func TestMmrConfigBalanced(t *testing.T) {
	config := BalancedConfig()
	if config.Lambda != 0.5 {
		t.Errorf("expected balanced lambda 0.5, got %f", config.Lambda)
	}
}

func TestMmrConfigRelevanceFocused(t *testing.T) {
	config := RelevanceFocusedConfig()
	if config.Lambda != 0.7 {
		t.Errorf("expected relevance-focused lambda 0.7, got %f", config.Lambda)
	}
	if config.FetchMultiplier != 1.5 {
		t.Errorf("expected fetch multiplier 1.5, got %f", config.FetchMultiplier)
	}
}

func TestMmrConfigDiversityFocused(t *testing.T) {
	config := DiversityFocusedConfig()
	if config.Lambda != 0.3 {
		t.Errorf("expected diversity-focused lambda 0.3, got %f", config.Lambda)
	}
	if config.FetchMultiplier != 3.0 {
		t.Errorf("expected fetch multiplier 3.0, got %f", config.FetchMultiplier)
	}
}

func TestMmrConfigWithLambda(t *testing.T) {
	config := WithLambda(0.8)
	if config.Lambda != 0.8 {
		t.Errorf("expected lambda 0.8, got %f", config.Lambda)
	}
}

func TestMmrConfigWithLambdaClamped(t *testing.T) {
	// Test clamping above 1.0
	config := WithLambda(1.5)
	if config.Lambda != 1.0 {
		t.Errorf("expected lambda clamped to 1.0, got %f", config.Lambda)
	}

	// Test clamping below 0.0
	config = WithLambda(-0.5)
	if config.Lambda != 0.0 {
		t.Errorf("expected lambda clamped to 0.0, got %f", config.Lambda)
	}
}

// === Rerank Basic Tests ===

func TestRerankEmptyCandidates(t *testing.T) {
	query := []float32{1, 0, 0}
	candidates := []Candidate{}

	results := Rerank(query, candidates, 5, 0.5)
	if len(results) != 0 {
		t.Errorf("expected empty results, got %d", len(results))
	}
}

func TestRerankZeroK(t *testing.T) {
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: []float32{0.9, 0.1, 0}},
	}

	results := Rerank(query, candidates, 0, 0.5)
	if len(results) != 0 {
		t.Errorf("expected empty results for k=0, got %d", len(results))
	}
}

func TestRerankReturnsK(t *testing.T) {
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: []float32{0.9, 0.1, 0}},
		{ID: 2, Score: 0.8, Vector: []float32{0.8, 0.2, 0}},
		{ID: 3, Score: 0.7, Vector: []float32{0.7, 0.3, 0}},
	}

	results := Rerank(query, candidates, 2, 0.5)
	if len(results) != 2 {
		t.Errorf("expected 2 results, got %d", len(results))
	}
}

func TestRerankKLargerThanCandidates(t *testing.T) {
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: []float32{0.9, 0.1, 0}},
		{ID: 2, Score: 0.8, Vector: []float32{0.8, 0.2, 0}},
	}

	results := Rerank(query, candidates, 10, 0.5)
	if len(results) != 2 {
		t.Errorf("expected 2 results (all candidates), got %d", len(results))
	}
}

// === MMR Diversity Tests ===

func TestRerankPromotesDiversity(t *testing.T) {
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.95, Vector: []float32{0.99, 0.01, 0}}, // Very similar to query
		{ID: 2, Score: 0.94, Vector: []float32{0.98, 0.02, 0}}, // Almost identical to #1
		{ID: 3, Score: 0.7, Vector: []float32{0, 0, 1}},        // Orthogonal/different
	}

	results := Rerank(query, candidates, 2, 0.5)

	// First should be most relevant (ID 1)
	if results[0].ID != 1 {
		t.Errorf("expected first result ID 1, got %d", results[0].ID)
	}

	// Second should be diverse (#3), not near-duplicate (#2)
	if results[1].ID != 3 {
		t.Errorf("expected second result ID 3 (diverse), got %d", results[1].ID)
	}
}

func TestRerankPureRelevance(t *testing.T) {
	// Lambda = 1.0 should preserve original order (pure relevance)
	query := []float32{1, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: []float32{0.9, 0.1}},
		{ID: 2, Score: 0.85, Vector: []float32{0.88, 0.12}},
		{ID: 3, Score: 0.8, Vector: []float32{0.7, 0.3}},
	}

	results := Rerank(query, candidates, 3, 1.0)

	// With pure relevance, order should be preserved
	if results[0].ID != 1 {
		t.Errorf("expected first ID 1, got %d", results[0].ID)
	}
	if results[1].ID != 2 {
		t.Errorf("expected second ID 2, got %d", results[1].ID)
	}
	if results[2].ID != 3 {
		t.Errorf("expected third ID 3, got %d", results[2].ID)
	}
}

func TestRerankPureDiversity(t *testing.T) {
	// Lambda = 0.0 should maximize diversity
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: []float32{1, 0, 0}}, // Same as query
		{ID: 2, Score: 0.8, Vector: []float32{0, 1, 0}}, // Orthogonal
		{ID: 3, Score: 0.7, Vector: []float32{0, 0, 1}}, // Orthogonal to both
	}

	results := Rerank(query, candidates, 3, 0.0)

	// With pure diversity, should select orthogonal vectors
	// First will be ID 1 (relevance doesn't matter, but it's first in list)
	// Second should be orthogonal to first
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	// Check that we got all three IDs
	ids := make(map[uint32]bool)
	for _, r := range results {
		ids[r.ID] = true
	}
	if !ids[1] || !ids[2] || !ids[3] {
		t.Error("expected all three IDs in results")
	}
}

// === Score Preservation Tests ===

func TestRerankPreservesOriginalScore(t *testing.T) {
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.95, Vector: []float32{0.99, 0.01, 0}},
		{ID: 2, Score: 0.7, Vector: []float32{0, 0, 1}},
	}

	results := Rerank(query, candidates, 2, 0.5)

	// Find result with ID 1
	var score1 float32
	for _, r := range results {
		if r.ID == 1 {
			score1 = r.Score
		}
	}

	if score1 != 0.95 {
		t.Errorf("expected original score 0.95 preserved, got %f", score1)
	}
}

// === Edge Cases ===

func TestRerankSingleCandidate(t *testing.T) {
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 42, Score: 0.9, Vector: []float32{0.9, 0.1, 0}},
	}

	results := Rerank(query, candidates, 5, 0.5)
	if len(results) != 1 {
		t.Errorf("expected 1 result, got %d", len(results))
	}
	if results[0].ID != 42 {
		t.Errorf("expected ID 42, got %d", results[0].ID)
	}
}

func TestRerankAllIdenticalVectors(t *testing.T) {
	// All candidates have identical vectors - should still return k results
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: []float32{0.9, 0.1, 0}},
		{ID: 2, Score: 0.8, Vector: []float32{0.9, 0.1, 0}},
		{ID: 3, Score: 0.7, Vector: []float32{0.9, 0.1, 0}},
	}

	results := Rerank(query, candidates, 3, 0.5)
	if len(results) != 3 {
		t.Errorf("expected 3 results, got %d", len(results))
	}
}

func TestRerankZeroVector(t *testing.T) {
	query := []float32{0, 0, 0}
	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: []float32{0.9, 0.1, 0}},
	}

	// Should not panic with zero query vector
	results := Rerank(query, candidates, 1, 0.5)
	if len(results) != 1 {
		t.Errorf("expected 1 result, got %d", len(results))
	}
}

// === Result Type Tests ===

func TestResultFields(t *testing.T) {
	query := []float32{1, 0, 0}
	candidates := []Candidate{
		{ID: 42, Score: 0.95, Vector: []float32{0.99, 0.01, 0}},
	}

	results := Rerank(query, candidates, 1, 0.5)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	if results[0].ID != 42 {
		t.Errorf("expected ID 42, got %d", results[0].ID)
	}
	if math.Abs(float64(results[0].Score-0.95)) > 1e-6 {
		t.Errorf("expected Score 0.95, got %f", results[0].Score)
	}
}

// === Large Vector Tests ===

func TestRerank768D(t *testing.T) {
	// Test with 768-dimensional vectors (common embedding size)
	query := make([]float32, 768)
	query[0] = 1.0 // Unit vector along first dimension

	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: make([]float32, 768)},
		{ID: 2, Score: 0.8, Vector: make([]float32, 768)},
	}
	candidates[0].Vector[0] = 0.9
	candidates[0].Vector[1] = 0.1
	candidates[1].Vector[1] = 1.0 // Orthogonal

	results := Rerank(query, candidates, 2, 0.5)
	if len(results) != 2 {
		t.Errorf("expected 2 results for 768D, got %d", len(results))
	}
}

func TestRerank1536D(t *testing.T) {
	// Test with 1536-dimensional vectors (OpenAI embedding size)
	query := make([]float32, 1536)
	query[0] = 1.0

	candidates := []Candidate{
		{ID: 1, Score: 0.9, Vector: make([]float32, 1536)},
	}
	candidates[0].Vector[0] = 0.9

	results := Rerank(query, candidates, 1, 0.5)
	if len(results) != 1 {
		t.Errorf("expected 1 result for 1536D, got %d", len(results))
	}
}

// === MMR Score Computation Tests ===

func TestComputeMmrScoreFirstSelection(t *testing.T) {
	// First selection has no selected documents, so diversity penalty is 0
	query := []float32{1, 0, 0}
	candidate := Candidate{ID: 1, Score: 0.9, Vector: []float32{0.9, 0.1, 0}}
	selected := []Candidate{}

	score := computeMmrScore(query, candidate, selected, 0.5)

	// With no selected docs, MMR = lambda * relevance
	// relevance = cosine(query, candidate) ≈ 0.995
	// MMR ≈ 0.5 * 0.995 ≈ 0.497
	if score <= 0 {
		t.Errorf("expected positive MMR score for first selection, got %f", score)
	}
}

func TestComputeMmrScoreWithSelected(t *testing.T) {
	query := []float32{1, 0, 0}
	// Candidate orthogonal to selected but has relevance to query
	candidate := Candidate{ID: 3, Score: 0.7, Vector: []float32{0.7, 0, 0.714}} // 45 degrees from query in XZ plane
	selected := []Candidate{
		{ID: 1, Score: 0.9, Vector: []float32{0, 1, 0}}, // Orthogonal to both query and candidate
	}

	score := computeMmrScore(query, candidate, selected, 0.5)

	// With selected orthogonal to candidate, max_similarity = 0
	// MMR = 0.5 * relevance - 0.5 * 0 = 0.5 * relevance
	// relevance should be ~0.7 (cosine of 45 degrees)
	if score <= 0 {
		t.Errorf("expected positive MMR score when selected is orthogonal, got %f", score)
	}
}

func TestComputeMmrScoreSimilarToSelected(t *testing.T) {
	query := []float32{1, 0, 0}
	candidate := Candidate{ID: 2, Score: 0.94, Vector: []float32{0.98, 0.02, 0}} // Very similar to selected
	selected := []Candidate{
		{ID: 1, Score: 0.95, Vector: []float32{0.99, 0.01, 0}},
	}

	scoreSimilar := computeMmrScore(query, candidate, selected, 0.5)

	// Now test with orthogonal candidate
	candidateOrtho := Candidate{ID: 3, Score: 0.7, Vector: []float32{0, 0, 1}}
	scoreOrtho := computeMmrScore(query, candidateOrtho, selected, 0.5)

	// Orthogonal candidate should have higher MMR (less diversity penalty)
	if scoreOrtho <= scoreSimilar {
		t.Errorf("expected orthogonal candidate to have higher MMR score, got similar=%f, ortho=%f", scoreSimilar, scoreOrtho)
	}
}
