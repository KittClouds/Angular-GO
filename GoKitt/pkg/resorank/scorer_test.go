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
	results := scorer.Search([]string{"hello"}, nil, 10)

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

	results := scorer.Search([]string{"hello", "world"}, nil, 10)

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

func TestScopedSearch(t *testing.T) {
	cfg := DefaultConfig()
	cfg.FieldWeights["content"] = 1.0

	scorer := NewScorer(cfg)
	scorer.CorpusStats.TotalDocuments = 10
	scorer.CorpusStats.AverageDocLength = 100
	scorer.CorpusStats.AverageFieldLengths["content"] = 100

	// Index 3 docs with different scopes
	// Doc 1: narrative-A, folder "Timeline/Chapter1"
	meta1 := DocumentMetadata{
		TotalTokenCount: 100,
		FieldLengths:    map[string]int{"content": 100},
		NarrativeID:     "narrative-A",
		FolderPath:      "Timeline/Chapter1",
	}
	tokens1 := map[string]TokenMetadata{
		"dragon": {CorpusDocFreq: 3, FieldOccurrences: map[string]FieldOccurrence{"content": {TF: 2, FieldLength: 100}}},
	}
	scorer.IndexDocument("doc1", meta1, tokens1)

	// Doc 2: narrative-A, folder "Timeline/Chapter2"
	meta2 := DocumentMetadata{
		TotalTokenCount: 100,
		FieldLengths:    map[string]int{"content": 100},
		NarrativeID:     "narrative-A",
		FolderPath:      "Timeline/Chapter2",
	}
	tokens2 := map[string]TokenMetadata{
		"dragon": {CorpusDocFreq: 3, FieldOccurrences: map[string]FieldOccurrence{"content": {TF: 1, FieldLength: 100}}},
	}
	scorer.IndexDocument("doc2", meta2, tokens2)

	// Doc 3: narrative-B, folder "Notes"
	meta3 := DocumentMetadata{
		TotalTokenCount: 100,
		FieldLengths:    map[string]int{"content": 100},
		NarrativeID:     "narrative-B",
		FolderPath:      "Notes",
	}
	tokens3 := map[string]TokenMetadata{
		"dragon": {CorpusDocFreq: 3, FieldOccurrences: map[string]FieldOccurrence{"content": {TF: 5, FieldLength: 100}}},
	}
	scorer.IndexDocument("doc3", meta3, tokens3)

	// Test 1: Search without scope - should return all 3 docs
	results := scorer.SearchScoped([]string{"dragon"}, nil, 10, nil)
	if len(results) != 3 {
		t.Errorf("Unscoped: Expected 3 results, got %d", len(results))
	}

	// Test 2: Search with narrative scope - should return only narrative-A docs
	scopeNarrativeA := &SearchScope{NarrativeID: "narrative-A"}
	results = scorer.SearchScoped([]string{"dragon"}, nil, 10, scopeNarrativeA)
	if len(results) != 2 {
		t.Errorf("Narrative-A scope: Expected 2 results, got %d", len(results))
	}
	for _, r := range results {
		if r.DocID != "doc1" && r.DocID != "doc2" {
			t.Errorf("Unexpected doc in narrative-A scope: %s", r.DocID)
		}
	}

	// Test 3: Search with folder scope - should return only Timeline/* docs
	scopeTimeline := &SearchScope{FolderPath: "Timeline"}
	results = scorer.SearchScoped([]string{"dragon"}, nil, 10, scopeTimeline)
	if len(results) != 2 {
		t.Errorf("Timeline folder scope: Expected 2 results, got %d", len(results))
	}
	for _, r := range results {
		if r.DocID != "doc1" && r.DocID != "doc2" {
			t.Errorf("Unexpected doc in Timeline scope: %s", r.DocID)
		}
	}

	// Test 4: Search with specific subfolder - should return only Chapter1
	scopeChapter1 := &SearchScope{FolderPath: "Timeline/Chapter1"}
	results = scorer.SearchScoped([]string{"dragon"}, nil, 10, scopeChapter1)
	if len(results) != 1 {
		t.Errorf("Chapter1 folder scope: Expected 1 result, got %d", len(results))
	}
	if len(results) > 0 && results[0].DocID != "doc1" {
		t.Errorf("Expected doc1, got %s", results[0].DocID)
	}

	// Test 5: Combined scope - narrative-B should have no Timeline docs
	scopeNarrativeB := &SearchScope{NarrativeID: "narrative-B"}
	results = scorer.SearchScoped([]string{"dragon"}, nil, 10, scopeNarrativeB)
	if len(results) != 1 {
		t.Errorf("Narrative-B scope: Expected 1 result, got %d", len(results))
	}
	if len(results) > 0 && results[0].DocID != "doc3" {
		t.Errorf("Expected doc3, got %s", results[0].DocID)
	}

	t.Log("TestScopedSearch: All scope filters working correctly!")
}
