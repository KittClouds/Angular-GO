package resorank

import (
	"fmt"
	"math/rand"
	"runtime"
	"testing"
)

func TestFSTIndexMemory(t *testing.T) {
	// Setup: Create a large valid token index
	numTerms := 5000
	docsPerTerm := 50

	t.Logf("Generating index with %d terms, %d docs/term...", numTerms, docsPerTerm)

	tokenIndex := make(map[string]map[string]TokenMetadata)

	for i := 0; i < numTerms; i++ {
		term := fmt.Sprintf("term_%d", i)
		docs := make(map[string]TokenMetadata)
		for j := 0; j < docsPerTerm; j++ {
			docID := fmt.Sprintf("doc_%d_%d", i, j)
			docs[docID] = TokenMetadata{
				SegmentMask: 1, // simplified
			}
		}
		tokenIndex[term] = docs
	}

	// Measure Map Memory (Approximate via runtime)
	runtime.GC()
	var m1, m2 runtime.MemStats
	runtime.ReadMemStats(&m1)

	// Keep map alive
	_ = len(tokenIndex)

	// Build FST
	t.Log("Building FST Index...")
	fstIndex, err := BuildFSTIndex(tokenIndex)
	if err != nil {
		t.Fatalf("Failed to build FST: %v", err)
	}
	defer fstIndex.Close()

	// Measure FST Memory
	fstSize := len(fstIndex.Postings)

	t.Logf("FST Keys: %d", fstIndex.Index.Len())
	t.Logf("FST Postings Size: %d bytes (%.2f MB)", fstSize, float64(fstSize)/1024/1024)

	if fstIndex.Index.Len() != numTerms {
		t.Errorf("Expected %d keys, got %d", numTerms, fstIndex.Index.Len())
	}

	// Verification
	t.Log("Verifying Correctness...")
	for i := 0; i < 100; i++ { // Check random subset
		idx := rand.Intn(numTerms)
		term := fmt.Sprintf("term_%d", idx)

		expected := tokenIndex[term]
		got, found := fstIndex.Get(term)

		if !found {
			// Debug why
			_, exists, err := fstIndex.Index.Get([]byte(term))
			t.Errorf("Term %s not found in FST. Raw lookup: exists=%v, err=%v", term, exists, err)
			continue
		}

		if len(got) != len(expected) {
			t.Errorf("Term %s: expected %d docs, got %d", term, len(expected), len(got))
		}
	}

	// Force GC to see impact if we were to release the map
	tokenIndex = nil
	runtime.GC()
	runtime.ReadMemStats(&m2)

	t.Logf("Memory Test Complete")
}

func TestScorerCompact(t *testing.T) {
	// Create scorer and index some documents
	scorer := NewScorer(DefaultConfig())

	// Index 100 documents with various terms
	for i := 0; i < 100; i++ {
		docID := fmt.Sprintf("doc_%d", i)
		docMeta := DocumentMetadata{
			TotalTokenCount: 100,
			FieldLengths:    map[string]int{"body": 100},
		}

		tokens := make(map[string]TokenMetadata)
		for j := 0; j < 10; j++ {
			term := fmt.Sprintf("term_%d", (i+j)%50) // Create overlap
			tokens[term] = TokenMetadata{
				SegmentMask:      1,
				CorpusDocFreq:    1,
				FieldOccurrences: map[string]FieldOccurrence{"body": {TF: 1, FieldLength: 100}},
			}
		}
		scorer.IndexDocument(docID, docMeta, tokens)
	}

	// Verify search works before compact
	results := scorer.Search([]string{"term_0"}, nil, 10)
	if len(results) == 0 {
		t.Fatal("Expected results before compact")
	}
	t.Logf("Before Compact: Found %d results for 'term_0'", len(results))

	// Compact
	if err := scorer.Compact(); err != nil {
		t.Fatalf("Compact failed: %v", err)
	}

	// Verify search works after compact
	resultsAfter := scorer.Search([]string{"term_0"}, nil, 10)
	if len(resultsAfter) == 0 {
		t.Fatal("Expected results after compact")
	}
	t.Logf("After Compact: Found %d results for 'term_0'", len(resultsAfter))

	// Results should match
	if len(results) != len(resultsAfter) {
		t.Errorf("Result count mismatch: before=%d, after=%d", len(results), len(resultsAfter))
	}

	// Verify FrozenIndex is set
	if scorer.FrozenIndex == nil {
		t.Error("FrozenIndex should be set after Compact")
	}

	// Verify TokenIndex is cleared
	if len(scorer.TokenIndex) != 0 {
		t.Error("TokenIndex should be empty after Compact")
	}

	t.Log("Compact integration test passed!")
}
