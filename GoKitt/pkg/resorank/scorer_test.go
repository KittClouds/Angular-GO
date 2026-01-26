package resorank

import (
	"math"
	"testing"
)

func TestScorerBasic(t *testing.T) {
	cfg := DefaultConfig()
	cfg.FieldWeights["title"] = 10.0
	cfg.FieldWeights["body"] = 1.0

	scorer := NewScorer(cfg)
	scorer.CorpusStats.TotalDocuments = 10
	scorer.CorpusStats.AverageDocLength = 100
	scorer.CorpusStats.AverageFieldLengths["title"] = 5
	scorer.CorpusStats.AverageFieldLengths["body"] = 95

	// Index Doc 1: "hello" in Title
	meta1 := DocumentMetadata{
		TotalTokenCount: 100,
		FieldLengths:    map[string]int{"title": 5, "body": 95},
	}
	tokens1 := make(map[string]TokenMetadata)
	tokens1["hello"] = TokenMetadata{
		CorpusDocFreq: 1,
		FieldOccurrences: map[string]FieldOccurrence{
			"title": {TF: 1, FieldLength: 5},
		},
		SegmentMask: 1,
	}
	scorer.IndexDocument("doc1", meta1, tokens1)

	// Index Doc 2: "hello" in Body
	meta2 := DocumentMetadata{
		TotalTokenCount: 100,
		FieldLengths:    map[string]int{"title": 5, "body": 95},
	}
	tokens2 := make(map[string]TokenMetadata)
	tokens2["hello"] = TokenMetadata{
		CorpusDocFreq: 2, // now 2 docs have it
		FieldOccurrences: map[string]FieldOccurrence{
			"body": {TF: 1, FieldLength: 95},
		},
		SegmentMask: 1,
	}
	scorer.IndexDocument("doc2", meta2, tokens2)

	// Refresh cache logic (manual stats update done above)

	// Score
	results := scorer.Search([]string{"hello"}, 10)

	if len(results) != 2 {
		t.Fatalf("Expected 2 results, got %d", len(results))
	}

	// Doc 1 should score higher due to Title weight (10.0)
	doc1Score := 0.0
	doc2Score := 0.0
	for _, r := range results {
		if r.DocID == "doc1" {
			doc1Score = r.Score
		}
		if r.DocID == "doc2" {
			doc2Score = r.Score
		}
	}

	if doc1Score <= doc2Score {
		t.Errorf("Expected Doc1 (Title match) > Doc2 (Body match). Got %.2f vs %.2f", doc1Score, doc2Score)
	}

	t.Logf("Doc1: %.2f, Doc2: %.2f", doc1Score, doc2Score)
}

func TestProximityBoost(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ProximityAlpha = 1.0 // High alpha to see effect clearly

	scorer := NewScorer(cfg)
	scorer.CorpusStats.TotalDocuments = 100
	scorer.CorpusStats.AverageDocLength = 100
	scorer.CorpusStats.AverageFieldLengths["body"] = 100

	// Doc A: "hello" and "world" in same segment (adjacent)
	// Masks: 0b01, 0b10 -> Adjacent (0b10 << 1 & 0b10?? no)
	// Phase detection logic: (m1 << 1) & m2
	// If "hello" at seg 0 (1), "world" at seg 1 (2).
	// (1 << 1) & 2 = 2 & 2 = 2 != 0. Match.

	metaA := DocumentMetadata{TotalTokenCount: 100}
	tokensA := map[string]TokenMetadata{
		"hello": {CorpusDocFreq: 5, SegmentMask: 1, FieldOccurrences: map[string]FieldOccurrence{"body": {1, 100}}},
		"world": {CorpusDocFreq: 5, SegmentMask: 2, FieldOccurrences: map[string]FieldOccurrence{"body": {1, 100}}},
	}
	scorer.IndexDocument("docA", metaA, tokensA)

	// Doc B: "hello" and "world" far apart
	// "hello" at seg 0 (1), "world" at seg 5 (32).
	metaB := DocumentMetadata{TotalTokenCount: 100}
	tokensB := map[string]TokenMetadata{
		"hello": {CorpusDocFreq: 5, SegmentMask: 1, FieldOccurrences: map[string]FieldOccurrence{"body": {1, 100}}},
		"world": {CorpusDocFreq: 5, SegmentMask: 32, FieldOccurrences: map[string]FieldOccurrence{"body": {1, 100}}},
	}
	scorer.IndexDocument("docB", metaB, tokensB)

	results := scorer.Search([]string{"hello", "world"}, 10)

	scoreA := 0.0
	scoreB := 0.0
	for _, r := range results {
		if r.DocID == "docA" {
			scoreA = r.Score
		}
		if r.DocID == "docB" {
			scoreB = r.Score
		}
	}

	if scoreA <= scoreB {
		t.Errorf("Expected adjacent phrase (DocA) > distant terms (DocB). Got %.2f vs %.2f", scoreA, scoreB)
	}
}

func TestBM25Math(t *testing.T) {
	// TF=1, Len=100, Avg=100, b=0.75 -> Norm = 1 / (1 - 0.75 + 0.75*1) = 1/1 = 1
	ntf := NormalizedTermFrequency(1, 100, 100.0, 0.75)
	if math.Abs(ntf-1.0) > 0.001 {
		t.Errorf("Expected 1.0, got %f", ntf)
	}

	// Saturation k1=1.2. Score=1. (2.2 * 1) / (1.2 + 1) = 2.2 / 2.2 = 1.0
	sat := Saturate(1.0, 1.2)
	if math.Abs(sat-1.0) > 0.001 {
		t.Errorf("Expected 1.0, got %f", sat)
	}
}
