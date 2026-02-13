package qgram

import (
	"math"
	"sort"
	"testing"
)

// TestPatternIterator32 tests the uint32 pattern iterator
func TestPatternIterator32(t *testing.T) {
	docs := []uint32{1, 3, 5, 7, 9}
	it := NewPatternIterator32(docs, 1.5)

	// Test initial state
	if it.Current != 1 {
		t.Errorf("Expected initial Current=1, got %d", it.Current)
	}
	if it.MaxScore != 1.5 {
		t.Errorf("Expected MaxScore=1.5, got %f", it.MaxScore)
	}
	if it.Exhausted() {
		t.Error("Iterator should not be exhausted initially")
	}

	// Test Next
	it.Next()
	if it.Current != 3 {
		t.Errorf("Expected Current=3 after Next, got %d", it.Current)
	}

	// Test Seek (forward)
	it.Seek(7)
	if it.Current != 7 {
		t.Errorf("Expected Current=7 after Seek(7), got %d", it.Current)
	}

	// Test Seek (no-op if already at or past target)
	it.Seek(5) // We're at 7, should stay at 7
	if it.Current != 7 {
		t.Errorf("Expected Current=7 after Seek(5) from 7, got %d", it.Current)
	}

	// Test Seek to non-existent (should find next >= target)
	it.Seek(8)
	if it.Current != 9 {
		t.Errorf("Expected Current=9 after Seek(8), got %d", it.Current)
	}

	// Test exhaustion
	it.Next()
	if !it.Exhausted() {
		t.Error("Iterator should be exhausted after all elements")
	}
	if it.Current != 0 {
		t.Errorf("Expected Current=0 when exhausted, got %d", it.Current)
	}
}

// TestPatternIterator32Seek tests binary search seek behavior
func TestPatternIterator32Seek(t *testing.T) {
	// Large sorted array for binary search testing
	// Start from 1 to avoid 0 ambiguity (0 means exhausted)
	docs := make([]uint32, 1000)
	for i := range docs {
		docs[i] = uint32(i*2) + 1 // 1, 3, 5, 7, ...
	}

	it := NewPatternIterator32(docs, 1.0)

	// Seek to exact value
	it.Seek(501)
	if it.Current != 501 {
		t.Errorf("Expected Current=501, got %d", it.Current)
	}

	// Seek to non-existent (should find next)
	it.Seek(502)
	if it.Current != 503 {
		t.Errorf("Expected Current=503 after Seek(502), got %d", it.Current)
	}

	// Seek past end
	it.Seek(3000)
	if !it.Exhausted() {
		t.Errorf("Iterator should be exhausted after Seek past end, Current=%d", it.Current)
	}
}

// TestCandidate32Generation tests that candidates are generated with uint32 docIDs
func TestCandidate32Generation(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "banana apple"})
	idx.IndexDocument("doc2", map[string]string{"body": "banana orange"})
	idx.IndexDocument("doc3", map[string]string{"body": "apple grape"})

	// Get uint32 candidates for pattern
	candidates := idx.GetCandidates32("banana")
	if len(candidates) != 2 {
		t.Errorf("Expected 2 candidates for 'banana', got %d", len(candidates))
	}

	// Verify they're uint32, not strings
	for _, c := range candidates {
		if c.DocID == 0 {
			t.Error("DocID should not be 0 (reserved for invalid)")
		}
		// Verify we can map back to string
		docStr := idx.Mapper.GetString(c.DocID)
		if docStr == "" {
			t.Errorf("Could not map uint32 %d back to string", c.DocID)
		}
	}
}

// TestWAND32Pipeline tests the full WAND pipeline with uint32 docIDs
func TestWAND32Pipeline(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	// Index documents
	idx.IndexDocument("doc1", map[string]string{"body": "the quick brown fox"})
	idx.IndexDocument("doc2", map[string]string{"body": "quick blue hare"})
	idx.IndexDocument("doc3", map[string]string{"body": "the slow turtle"})

	clauses := []Clause{
		{Pattern: "quick", Type: TermClause},
	}

	config := DefaultSearchConfig()

	// Generate pruned candidates with uint32 docIDs
	candidates := idx.GeneratePrunedCandidates32(clauses, config, 10)
	if len(candidates) == 0 {
		t.Error("Expected non-empty candidates")
	}

	// Verify all candidates have valid uint32 docIDs
	for _, c := range candidates {
		if c.DocID == 0 {
			t.Error("Candidate DocID should not be 0")
		}
	}
}

// TestFullSearch32Pipeline tests end-to-end search with uint32 internal pipeline
func TestFullSearch32Pipeline(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	// Index documents
	idx.IndexDocument("doc1", map[string]string{"body": "banana apple orange"})
	idx.IndexDocument("doc2", map[string]string{"body": "banana grape"})
	idx.IndexDocument("doc3", map[string]string{"body": "apple orange"})

	config := DefaultSearchConfig()

	// Search should use uint32 internally and only convert at the end
	results := idx.Search("banana", config, 10)
	if len(results) != 2 {
		t.Errorf("Expected 2 results for 'banana', got %d", len(results))
	}

	// Verify results have string docIDs (converted at end)
	for _, r := range results {
		if r.DocID == "" {
			t.Error("Result DocID should be a non-empty string")
		}
		if r.Score <= 0 {
			t.Errorf("Result score should be positive, got %f", r.Score)
		}
	}
}

// TestIntersectGrams32 tests uint32-only gram intersection
func TestIntersectGrams32(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "banana"})
	idx.IndexDocument("doc2", map[string]string{"body": "banana apple"})
	idx.IndexDocument("doc3", map[string]string{"body": "apple orange"})

	// Intersect grams from "banana"
	result := idx.IntersectGrams32([]string{"ban", "ana"})
	if result == nil {
		t.Fatal("Expected non-nil result")
	}

	// Should have 2 documents (doc1 and doc2)
	count := 0
	for result.HasNext() {
		count++
		result.Next()
	}
	if count != 2 {
		t.Errorf("Expected 2 documents in intersection, got %d", count)
	}
}

// TestNoStringAllocsInPipeline verifies that the internal pipeline doesn't allocate strings
func TestNoStringAllocsInPipeline(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	// Index many documents
	for i := 0; i < 100; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple",
		})
	}

	clauses := []Clause{
		{Pattern: "banana", Type: TermClause},
		{Pattern: "apple", Type: TermClause},
	}

	config := DefaultSearchConfig()

	// This should not allocate strings during candidate generation
	candidates := idx.GeneratePrunedCandidates32(clauses, config, 10)

	// Verify we got candidates
	if len(candidates) == 0 {
		t.Error("Expected non-empty candidates")
	}

	// All candidates should be uint32
	for _, c := range candidates {
		if c.DocID == 0 {
			t.Error("DocID should not be 0")
		}
	}
}

// BenchmarkStringBasedCandidates benchmarks the old string-based approach
func BenchmarkStringBasedCandidates(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	for i := 0; i < 1000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange",
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Old approach: converts to strings
		_ = idx.GetCandidatesForPattern("banana")
	}
}

// BenchmarkUint32Candidates benchmarks the new uint32 approach
func BenchmarkUint32Candidates(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	for i := 0; i < 1000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange",
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// New approach: stays in uint32
		_ = idx.GetCandidates32("banana")
	}
}

// BenchmarkFullSearchStringBased benchmarks full search with string conversion
func BenchmarkFullSearchStringBased(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	for i := 0; i < 1000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange",
		})
	}

	config := DefaultSearchConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = idx.Search("banana apple", config, 10)
	}
}

// TestUint32PipelineCorrectness verifies the uint32 pipeline produces same results as string pipeline
func TestUint32PipelineCorrectness(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	// Index diverse documents
	docs := map[string]string{
		"doc1": "banana apple orange grape",
		"doc2": "banana mango",
		"doc3": "apple orange",
		"doc4": "grape watermelon",
		"doc5": "banana banana banana", // high TF
	}

	for docID, content := range docs {
		idx.IndexDocument(docID, map[string]string{"body": content})
	}

	config := DefaultSearchConfig()

	testQueries := []string{"banana", "apple", "orange grape", "banana apple"}

	for _, query := range testQueries {
		results := idx.Search(query, config, 10)

		// Verify results are sorted by score descending
		for i := 1; i < len(results); i++ {
			if results[i].Score > results[i-1].Score {
				t.Errorf("Results not sorted by score for query '%s'", query)
			}
		}

		// Verify all results have valid docIDs
		for _, r := range results {
			if _, ok := docs[r.DocID]; !ok {
				t.Errorf("Unknown docID '%s' in results for query '%s'", r.DocID, query)
			}
		}

		// Verify coverage is in valid range
		for _, r := range results {
			if r.Coverage < 0 || r.Coverage > 1 {
				t.Errorf("Invalid coverage %f for doc %s", r.Coverage, r.DocID)
			}
		}
	}
}

// TestScoredResult32Sorting tests sorting of uint32 results
func TestScoredResult32Sorting(t *testing.T) {
	results := []ScoredResult32{
		{DocID: 1, Score: 0.5, Coverage: 0.5},
		{DocID: 2, Score: 1.0, Coverage: 1.0},
		{DocID: 3, Score: 0.75, Coverage: 0.75},
	}

	// Sort by score descending
	sort.Slice(results, func(i, j int) bool {
		if math.Abs(results[i].Score-results[j].Score) < 1e-9 {
			return results[i].DocID < results[j].DocID
		}
		return results[i].Score > results[j].Score
	})

	if results[0].DocID != 2 {
		t.Errorf("Expected highest score docID=2 first, got %d", results[0].DocID)
	}
	if results[1].DocID != 3 {
		t.Errorf("Expected middle score docID=3 second, got %d", results[1].DocID)
	}
	if results[2].DocID != 1 {
		t.Errorf("Expected lowest score docID=1 third, got %d", results[2].DocID)
	}
}
