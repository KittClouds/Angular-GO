package resorank

import (
	"testing"
)

func TestVectorScoring(t *testing.T) {
	a := []float32{1.0, 0.0, 0.0}
	b := []float32{1.0, 0.0, 0.0}
	c := []float32{0.0, 1.0, 0.0}
	d := []float32{0.707, 0.707, 0.0}

	if score := CosineSimilarity(a, b); score < 0.999 {
		t.Errorf("Expected 1.0, got %f", score)
	}

	if score := CosineSimilarity(a, c); score > 0.001 {
		t.Errorf("Expected 0.0, got %f", score)
	}

	// 45 degrees
	if score := CosineSimilarity(a, d); score < 0.706 || score > 0.708 {
		t.Errorf("Expected ~0.707, got %f", score)
	}
}

func TestHybridSearch(t *testing.T) {
	cfg := DefaultConfig()
	cfg.VectorAlpha = 0.5 // 50/50 mix
	cfg.FieldWeights["body"] = 1.0

	scorer := NewScorer(cfg)
	scorer.CorpusStats.TotalDocuments = 10

	// Doc 1: Text match "apple", Vector mismatch
	meta1 := DocumentMetadata{
		TotalTokenCount: 10,
		Embedding:       []float32{1.0, 0.0},
	}
	tokens1 := map[string]TokenMetadata{
		"apple": {CorpusDocFreq: 1, FieldOccurrences: map[string]FieldOccurrence{"body": {1, 10}}},
	}
	scorer.IndexDocument("doc1", meta1, tokens1)

	// Doc 2: No text match, Vector match
	meta2 := DocumentMetadata{
		TotalTokenCount: 10,
		Embedding:       []float32{0.0, 1.0},
	}
	// No "apple"
	scorer.IndexDocument("doc2", meta2, nil)

	// Doc 3: Both match
	meta3 := DocumentMetadata{
		TotalTokenCount: 10,
		Embedding:       []float32{0.0, 1.0},
	}
	tokens3 := map[string]TokenMetadata{
		"apple": {CorpusDocFreq: 1, FieldOccurrences: map[string]FieldOccurrence{"body": {1, 10}}},
	}
	scorer.IndexDocument("doc3", meta3, tokens3)

	// Query: "apple", Vector: {0, 1}
	// Doc 1: BM25 score, Cosine 0
	// Doc 2: BM25 0, Cosine 1
	// Doc 3: BM25 score, Cosine 1 -> Should win

	queryVec := []float32{0.0, 1.0}
	results := scorer.Search([]string{"apple"}, queryVec, 10)

	if len(results) != 3 {
		t.Fatalf("Expected 3 results, got %d. (Did fuzzy fallback work?)", len(results))
	}

	if results[0].DocID != "doc3" {
		t.Errorf("Expected doc3 to win (Hybrid match), got %s", results[0].DocID)
	}

	// Check if Doc2 (Vector only) was found
	foundDoc2 := false
	for _, r := range results {
		if r.DocID == "doc2" {
			foundDoc2 = true
			if r.Score <= 0 {
				t.Errorf("Doc2 should have positive score from vector")
			}
		}
	}
	if !foundDoc2 {
		t.Errorf("Doc2 (Vector only) not found in results")
	}
}
