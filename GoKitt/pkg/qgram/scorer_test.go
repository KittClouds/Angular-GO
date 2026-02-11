package qgram

import (
	"testing"
)

func TestFullPipeline(t *testing.T) {
	idx := NewQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "the quick brown fox"})
	idx.IndexDocument("doc2", map[string]string{"body": "the quick red fox"})
	idx.IndexDocument("doc3", map[string]string{"body": "brown fox jumps"})

	cfg := DefaultSearchConfig()

	// Query: "quick fox" (2 term clauses, AND-ish via λ=3)
	// doc1 & doc2 match both. doc3 has fox but not quick.
	// With λ=3, partial match (doc3) is heavily tanked.
	res := idx.Search("quick fox", cfg, 10)

	// doc3 should appear but with much lower score due to coverage penalty
	if len(res) < 2 {
		t.Errorf("Expected at least 2 results for 'quick fox', got %d", len(res))
	}

	// Top 2 should be doc1 & doc2 (both match both clauses)
	if len(res) >= 2 {
		t.Logf("Results: %+v", res)
		top2 := map[string]bool{res[0].DocID: true, res[1].DocID: true}
		if !top2["doc1"] || !top2["doc2"] {
			t.Errorf("Expected doc1 and doc2 in top 2, got %s and %s", res[0].DocID, res[1].DocID)
		}
		// Full coverage docs should score WAY higher than partial
		if len(res) >= 3 {
			t.Logf("Full match score: %.4f, Partial match score: %.4f", res[0].Score, res[2].Score)
			if res[2].Score >= res[0].Score*0.5 {
				t.Errorf("Expected partial match to be heavily penalized by coverage")
			}
		}
	}

	// Phrase query: "quick brown"
	// Hard phrase constraint: only doc1 has the exact substring
	res = idx.Search(`"quick brown"`, cfg, 10)
	if len(res) != 1 {
		t.Errorf("Expected 1 result for phrase 'quick brown', got %d", len(res))
	}
	if len(res) > 0 && res[0].DocID != "doc1" {
		t.Errorf("Expected doc1, got %s", res[0].DocID)
	}
}

func TestCoverageSoftAND(t *testing.T) {
	idx := NewQGramIndex(3)

	// doc1: has both "alpha" and "bravo"
	idx.IndexDocument("doc1", map[string]string{"body": "alpha bravo charlie"})
	// doc2: has only "alpha"
	idx.IndexDocument("doc2", map[string]string{"body": "alpha delta echo"})

	cfg := DefaultSearchConfig()
	cfg.CoverageLambda = 3.0

	res := idx.Search("alpha bravo", cfg, 10)

	if len(res) < 2 {
		t.Fatalf("Expected 2 results, got %d", len(res))
	}

	// doc1 (full match) should crush doc2 (partial)
	if res[0].DocID != "doc1" {
		t.Errorf("Expected doc1 (full match) first, got %s", res[0].DocID)
	}

	t.Logf("Full: %.4f (coverage=%.2f), Partial: %.4f (coverage=%.2f)",
		res[0].Score, res[0].Coverage, res[1].Score, res[1].Coverage)

	if res[1].Score >= res[0].Score*0.3 {
		t.Errorf("λ=3 should heavily penalize partial match. Full=%.4f, Partial=%.4f",
			res[0].Score, res[1].Score)
	}
}

func TestCoverageLambdaZero(t *testing.T) {
	idx := NewQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "alpha bravo charlie"})
	idx.IndexDocument("doc2", map[string]string{"body": "alpha delta echo"})

	cfg := DefaultSearchConfig()
	cfg.CoverageLambda = 0.0 // OR mode: coverage doesn't matter

	res := idx.Search("alpha bravo", cfg, 10)

	if len(res) < 2 {
		t.Fatalf("Expected 2 results, got %d", len(res))
	}

	// With λ=0, coverage multiplier is (ε+C)^0 = 1.0 for everyone
	// So doc1 still wins (it has more matched patterns → higher base sum)
	// but doc2 isn't crushed
	t.Logf("λ=0: doc1=%.4f, doc2=%.4f", res[0].Score, res[1].Score)

	// Partial match should be > 20% of full match (unlike λ=3 test)
	if res[1].Score < res[0].Score*0.2 {
		t.Errorf("λ=0 should NOT heavily penalize partial. Full=%.4f, Partial=%.4f",
			res[0].Score, res[1].Score)
	}
}

func TestPhraseHardConstraint(t *testing.T) {
	idx := NewQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "the quick brown fox"})
	idx.IndexDocument("doc2", map[string]string{"body": "the quick red fox"})

	cfg := DefaultSearchConfig()
	cfg.PhraseHard = true

	// "quick brown" only exists as substring in doc1
	res := idx.Search(`"quick brown"`, cfg, 10)
	if len(res) != 1 || res[0].DocID != "doc1" {
		t.Errorf("PhraseHard: expected only doc1, got %v", res)
	}

	// Disable hard constraint
	cfg.PhraseHard = false
	res = idx.Search(`"quick brown"`, cfg, 10)
	// doc2 still won't match the phrase substring, so still 1 result
	// (VerifyCandidate returns nil for "quick brown" in doc2)
	if len(res) != 1 {
		t.Errorf("PhraseHard=false: expected 1 result (verify rejects), got %d", len(res))
	}
}

func TestScorerFieldWeights(t *testing.T) {
	idx := NewQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{
		"title": "hello",
		"body":  "world",
	})
	idx.IndexDocument("doc2", map[string]string{
		"title": "world",
		"body":  "hello",
	})

	cfg := DefaultSearchConfig()
	cfg.FieldWeights["title"] = 10.0
	cfg.FieldWeights["body"] = 1.0

	res := idx.Search("hello", cfg, 10)
	if len(res) != 2 {
		t.Fatalf("Expected 2 results, got %d", len(res))
	}

	if res[0].DocID != "doc1" {
		t.Errorf("Expected doc1 (title match w=10) to win, got %s (%.2f vs %.2f)",
			res[0].DocID, res[0].Score, res[1].Score)
	}
}

func TestProximityBoostPatterns(t *testing.T) {
	idx := NewQGramIndex(3)

	// doc1: patterns close together (same region)
	idx.IndexDocument("doc1", map[string]string{
		"body": "alpha bravo alpha bravo",
	})
	// doc2: patterns far apart (padded)
	idx.IndexDocument("doc2", map[string]string{
		"body": "alpha xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx bravo",
	})

	cfg := DefaultSearchConfig()
	cfg.ProximityAlpha = 1.0 // high alpha to see effect

	res := idx.Search("alpha bravo", cfg, 10)
	if len(res) < 2 {
		t.Fatalf("Expected 2 results, got %d", len(res))
	}

	t.Logf("Close: %s=%.4f, Far: %s=%.4f", res[0].DocID, res[0].Score, res[1].DocID, res[1].Score)

	// doc1 (close patterns) should score higher due to proximity boost
	if res[0].DocID != "doc1" {
		t.Errorf("Expected doc1 (close patterns) to win, got %s", res[0].DocID)
	}
}
