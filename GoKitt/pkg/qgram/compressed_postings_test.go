package qgram

import (
	"math"
	"sort"
	"testing"

	"github.com/RoaringBitmap/roaring/v2"
)

func TestDocIDMapper(t *testing.T) {
	m := NewDocIDMapper()

	// Test assignment
	id1 := m.GetOrAssign("doc1")
	if id1 != 1 {
		t.Errorf("Expected first ID to be 1, got %d", id1)
	}

	id2 := m.GetOrAssign("doc2")
	if id2 != 2 {
		t.Errorf("Expected second ID to be 2, got %d", id2)
	}

	// Test retrieval
	id1Again := m.GetOrAssign("doc1")
	if id1Again != id1 {
		t.Errorf("Expected same ID for doc1, got %d vs %d", id1Again, id1)
	}

	// Test Get
	if m.Get("doc1") != id1 {
		t.Errorf("Get failed for doc1")
	}
	if m.Get("nonexistent") != 0 {
		t.Errorf("Get should return 0 for nonexistent")
	}

	// Test GetString
	if m.GetString(id1) != "doc1" {
		t.Errorf("GetString failed for id1")
	}
	if m.GetString(999) != "" {
		t.Errorf("GetString should return empty for nonexistent")
	}

	// Test Count
	if m.Count() != 2 {
		t.Errorf("Expected count 2, got %d", m.Count())
	}

	// Test Remove
	m.Remove("doc1")
	if m.Get("doc1") != 0 {
		t.Errorf("Get should return 0 after remove")
	}
	if m.Count() != 1 {
		t.Errorf("Expected count 1 after remove, got %d", m.Count())
	}
}

func TestCompressedGramPostings(t *testing.T) {
	p := NewCompressedGramPostings()

	// Add documents (bitmap only, no payload)
	p.AddDocument(1)
	p.AddDocument(2)
	p.AddDocument(5)

	// Test HasDocument
	if !p.HasDocument(1) {
		t.Error("Expected HasDocument(1) to be true")
	}
	if !p.HasDocument(5) {
		t.Error("Expected HasDocument(5) to be true")
	}
	if p.HasDocument(3) {
		t.Error("Expected HasDocument(3) to be false")
	}

	// Test GetDocCount
	if p.GetDocCount() != 3 {
		t.Errorf("Expected doc count 3, got %d", p.GetDocCount())
	}

	// Test iteration (no ToArray to avoid allocation)
	iter := p.Iterator()
	var ids []uint32
	for iter.HasNext() {
		ids = append(ids, iter.Next())
	}
	if len(ids) != 3 {
		t.Errorf("Expected 3 IDs, got %d", len(ids))
	}
	// Should be sorted
	expected := []uint32{1, 2, 5}
	for i, id := range ids {
		if id != expected[i] {
			t.Errorf("ID mismatch at %d: expected %d, got %d", i, expected[i], id)
		}
	}

	// Test RemoveDocument
	p.RemoveDocument(2)
	if p.HasDocument(2) {
		t.Error("Expected HasDocument(2) to be false after removal")
	}
	if p.GetDocCount() != 2 {
		t.Errorf("Expected doc count 2 after removal, got %d", p.GetDocCount())
	}
}

func TestCompressedGramPostingsIntersection(t *testing.T) {
	p1 := NewCompressedGramPostings()
	p1.AddDocument(1)
	p1.AddDocument(2)
	p1.AddDocument(3)

	p2 := NewCompressedGramPostings()
	p2.AddDocument(2)
	p2.AddDocument(3)
	p2.AddDocument(4)

	// Test intersection
	result := p1.IntersectWith(p2)
	ids := result.ToArray()

	if len(ids) != 2 {
		t.Errorf("Expected 2 intersecting IDs, got %d", len(ids))
	}
	if ids[0] != 2 || ids[1] != 3 {
		t.Errorf("Expected [2, 3], got %v", ids)
	}
}

func TestIntersectMultiple(t *testing.T) {
	p1 := NewCompressedGramPostings()
	p1.AddDocument(1)
	p1.AddDocument(2)
	p1.AddDocument(3)

	p2 := NewCompressedGramPostings()
	p2.AddDocument(2)
	p2.AddDocument(3)
	p2.AddDocument(4)

	p3 := NewCompressedGramPostings()
	p3.AddDocument(2)
	p3.AddDocument(5)

	// Intersection of all three should be just {2}
	result := IntersectMultiple([]*CompressedGramPostings{p1, p2, p3})
	ids := result.ToArray()

	if len(ids) != 1 {
		t.Errorf("Expected 1 intersecting ID, got %d", len(ids))
	}
	if ids[0] != 2 {
		t.Errorf("Expected [2], got %v", ids)
	}
}

func TestCompressedQGramIndex(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	// Index documents
	idx.IndexDocument("doc1", map[string]string{"body": "banana band"})
	idx.IndexDocument("doc2", map[string]string{"body": "apple application"})
	idx.IndexDocument("doc3", map[string]string{"body": "banana apple"})

	// Check document count
	if idx.totalDocs != 3 {
		t.Errorf("Expected 3 docs, got %d", idx.totalDocs)
	}

	// Check mapper
	if idx.Mapper.Count() != 3 {
		t.Errorf("Expected mapper count 3, got %d", idx.Mapper.Count())
	}

	// Check gram postings exist
	if len(idx.GramPostings) == 0 {
		t.Error("Expected gram postings to be populated")
	}

	// Check specific gram
	if p, ok := idx.GramPostings["ban"]; ok {
		if p.GetDocCount() != 2 {
			t.Errorf("Expected 'ban' in 2 docs, got %d", p.GetDocCount())
		}
	} else {
		t.Error("Expected 'ban' gram to exist")
	}

	// Test GetCandidatesForPattern
	candidates := idx.GetCandidatesForPattern("banana")
	if len(candidates) != 2 {
		t.Errorf("Expected 2 candidates for 'banana', got %d", len(candidates))
	}

	// Sort for consistent comparison
	sort.Strings(candidates)
	expected := []string{"doc1", "doc3"}
	for i, c := range candidates {
		if c != expected[i] {
			t.Errorf("Candidate mismatch at %d: expected %s, got %s", i, expected[i], c)
		}
	}

	// Test pattern with no matches
	noMatch := idx.GetCandidatesForPattern("xyz")
	if noMatch != nil {
		t.Errorf("Expected nil for no-match pattern, got %v", noMatch)
	}
}

func TestCompressedQGramIndexRemove(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "banana"})
	idx.IndexDocument("doc2", map[string]string{"body": "banana apple"})

	// Verify both exist
	if idx.totalDocs != 2 {
		t.Errorf("Expected 2 docs, got %d", idx.totalDocs)
	}

	// Remove doc1 (lazy delete)
	idx.RemoveDocument("doc1")

	// Check document removed
	if idx.totalDocs != 1 {
		t.Errorf("Expected 1 doc after removal, got %d", idx.totalDocs)
	}

	// Check doc1 is in Deleted bitmap
	uid := idx.Mapper.Get("doc1")
	if uid == 0 {
		t.Error("Expected doc1 to still have a mapping (lazy delete keeps ID)")
	}
	if !idx.Deleted.Contains(uid) {
		t.Error("Expected doc1 to be in Deleted bitmap")
	}

	// Check candidates updated (lazy delete filters it out)
	candidates := idx.GetCandidatesForPattern("banana")
	if len(candidates) != 1 || candidates[0] != "doc2" {
		t.Errorf("Expected only doc2 for 'banana', got %v", candidates)
	}
}

func TestCompressedQGramIndexCompact(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "banana"})
	idx.IndexDocument("doc2", map[string]string{"body": "banana apple"})

	// Lazy delete doc1
	idx.RemoveDocument("doc1")

	// Verify doc1 is in Deleted bitmap
	uid := idx.Mapper.Get("doc1")
	if !idx.Deleted.Contains(uid) {
		t.Error("Expected doc1 to be in Deleted bitmap before compact")
	}

	// Compact to purge deleted docs
	idx.Compact()

	// Verify Deleted bitmap is cleared
	if !idx.Deleted.IsEmpty() {
		t.Error("Expected Deleted bitmap to be empty after compact")
	}

	// Verify doc1 is removed from postings
	if p, ok := idx.GramPostings["ban"]; ok {
		if p.HasDocument(uid) {
			t.Error("Expected doc1 to be removed from postings after compact")
		}
	}
}

func TestCompressedQGramIndexGetCorpusStats(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "hello world"})
	idx.IndexDocument("doc2", map[string]string{"body": "test"})

	stats := idx.GetCorpusStats()

	if stats.TotalDocuments != 2 {
		t.Errorf("Expected 2 total docs, got %d", stats.TotalDocuments)
	}

	// Average doc length: (11 + 4) / 2 = 7.5
	if math.Abs(stats.AverageDocLength-7.5) > 0.01 {
		t.Errorf("Expected avg doc length 7.5, got %f", stats.AverageDocLength)
	}
}

func TestCompressedQGramIndexGramIDF(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "unique common"})
	idx.IndexDocument("doc2", map[string]string{"body": "common word"})
	idx.IndexDocument("doc3", map[string]string{"body": "common"})

	// "uni" appears in 1 doc (high IDF)
	// "com" appears in 3 docs (low IDF)
	idfUnique := idx.GramIDF("uni")
	idfCommon := idx.GramIDF("com")

	if idfUnique <= idfCommon {
		t.Errorf("Expected rare gram to have higher IDF: unique=%f, common=%f", idfUnique, idfCommon)
	}
}

func TestCompressedQGramIndexShortPattern(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "hello"})
	idx.IndexDocument("doc2", map[string]string{"body": "world"})

	// Short pattern (len < Q) should return all docs
	candidates := idx.GetCandidatesForPattern("ab")
	if len(candidates) != 2 {
		t.Errorf("Expected all 2 docs for short pattern, got %d", len(candidates))
	}
}

func TestCompressedQGramIndexMultipleFields(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{
		"title": "banana",
		"body":  "apple banana",
	})

	// Check that gram appears in posting list
	if p, ok := idx.GramPostings["ban"]; ok {
		uid := idx.Mapper.Get("doc1")
		if !p.HasDocument(uid) {
			t.Error("Expected doc1 to be in 'ban' posting list")
		}
	} else {
		t.Error("Expected 'ban' gram to exist")
	}
}

// Benchmark comparing original vs compressed index for candidate generation
func BenchmarkOriginalIndexCandidates(b *testing.B) {
	idx := NewQGramIndex(3)

	// Index 1000 documents
	for i := 0; i < 1000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange",
		})
	}

	clauses := []Clause{
		{Pattern: "banana", Type: TermClause},
		{Pattern: "apple", Type: TermClause},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		idx.GenerateCandidates(clauses)
	}
}

func BenchmarkCompressedIndexCandidates(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	// Index 1000 documents
	for i := 0; i < 1000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange",
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		idx.GetCandidatesForPattern("banana")
	}
}

// Benchmark intersection operations
func BenchmarkMapIntersection(b *testing.B) {
	// Simulate the original map-based intersection
	map1 := map[string]bool{
		"doc1": true, "doc2": true, "doc3": true, "doc4": true, "doc5": true,
	}
	map2 := map[string]bool{
		"doc3": true, "doc4": true, "doc5": true, "doc6": true, "doc7": true,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result := make([]string, 0)
		for k := range map1 {
			if map2[k] {
				result = append(result, k)
			}
		}
	}
}

func BenchmarkRoaringIntersection(b *testing.B) {
	bm1 := roaring.New()
	bm1.AddMany([]uint32{1, 2, 3, 4, 5})

	bm2 := roaring.New()
	bm2.AddMany([]uint32{3, 4, 5, 6, 7})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		roaring.And(bm1, bm2)
	}
}

// Benchmark multi-gram intersection (3+ grams)
func BenchmarkMultiGramIntersection3(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	// Index 10000 documents
	for i := 0; i < 10000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26)) + string(rune('a'+(i/676)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange grape",
		})
	}

	grams := []string{"ban", "ana", "nan"} // overlapping grams in "banana"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		idx.IntersectGramsFast(grams)
	}
}

func BenchmarkMultiGramIntersection5(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	// Index 10000 documents
	for i := 0; i < 10000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26)) + string(rune('a'+(i/676)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange grape",
		})
	}

	grams := []string{"ban", "ana", "nan", "app", "ppl"} // grams from "banana" and "apple"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		idx.IntersectGramsFast(grams)
	}
}

func BenchmarkMultiGramIntersection10(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	// Index 10000 documents
	for i := 0; i < 10000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26)) + string(rune('a'+(i/676)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange grape watermelon",
		})
	}

	// 10 grams from various words
	grams := []string{"ban", "ana", "nan", "app", "ppl", "ora", "ran", "gra", "wat", "ate"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		idx.IntersectGramsFast(grams)
	}
}

// Benchmark adaptive gram selection
func BenchmarkAdaptiveGramSelection(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	// Index 10000 documents
	for i := 0; i < 10000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26)) + string(rune('a'+(i/676)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange grape",
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		idx.AdaptiveGramSelection("banana", 100)
	}
}

func BenchmarkGetCandidatesAdaptive(b *testing.B) {
	idx := NewCompressedQGramIndex(3)

	// Index 10000 documents
	for i := 0; i < 10000; i++ {
		docID := string(rune('a'+i%26)) + string(rune('a'+(i/26)%26)) + string(rune('a'+(i/676)%26))
		idx.IndexDocument(docID, map[string]string{
			"body": "the quick brown fox jumps over the lazy dog banana apple orange grape",
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		idx.GetCandidatesAdaptive("banana", 100)
	}
}

// Test adaptive gram selection
func TestAdaptiveGramSelection(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "banana"})
	idx.IndexDocument("doc2", map[string]string{"body": "apple banana"})
	idx.IndexDocument("doc3", map[string]string{"body": "orange"})

	// Test selection for existing pattern
	grams := idx.AdaptiveGramSelection("banana", 1000)
	if len(grams) == 0 {
		t.Error("Expected non-empty gram selection")
	}

	// Test with low maxCandidates (should trigger early termination)
	gramsLimited := idx.AdaptiveGramSelection("banana", 1)
	if len(gramsLimited) > 1 {
		t.Errorf("Expected at most 1 gram with maxCandidates=1, got %d", len(gramsLimited))
	}

	// Test non-existent pattern
	gramsNone := idx.AdaptiveGramSelection("xyz", 1000)
	if gramsNone != nil {
		t.Errorf("Expected nil for non-existent pattern, got %v", gramsNone)
	}
}

func TestGetCandidatesAdaptive(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "banana apple"})
	idx.IndexDocument("doc2", map[string]string{"body": "banana orange"})
	idx.IndexDocument("doc3", map[string]string{"body": "apple grape"})

	// Test adaptive candidates
	candidates := idx.GetCandidatesAdaptive("banana", 1000)
	if len(candidates) != 2 {
		t.Errorf("Expected 2 candidates for 'banana', got %d", len(candidates))
	}

	// Test with very low threshold
	candidatesLimited := idx.GetCandidatesAdaptive("banana", 1)
	// Should still return candidates, just with fewer grams intersected
	if len(candidatesLimited) < 1 {
		t.Errorf("Expected at least 1 candidate, got %d", len(candidatesLimited))
	}
}

func TestIntersectGramsFast(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "banana"})
	idx.IndexDocument("doc2", map[string]string{"body": "banana apple"})
	idx.IndexDocument("doc3", map[string]string{"body": "apple orange"})

	// Intersect grams from "banana"
	result := idx.IntersectGramsFast([]string{"ban", "ana"})
	if result.IsEmpty() {
		t.Error("Expected non-empty result for 'ban' AND 'ana'")
	}

	card := result.GetCardinality()
	if card != 2 { // doc1 and doc2
		t.Errorf("Expected cardinality 2, got %d", card)
	}

	// Intersect with non-existent gram
	resultEmpty := idx.IntersectGramsFast([]string{"ban", "xyz"})
	if !resultEmpty.IsEmpty() {
		t.Error("Expected empty result when intersecting with non-existent gram")
	}
}

func TestGetPostingStats(t *testing.T) {
	idx := NewCompressedQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "banana"})
	idx.IndexDocument("doc2", map[string]string{"body": "apple"})

	numGrams, avgCard, maxCard := idx.GetPostingStats()

	if numGrams == 0 {
		t.Error("Expected non-zero gram count")
	}
	if avgCard == 0 {
		t.Error("Expected non-zero average cardinality")
	}
	if maxCard == 0 {
		t.Error("Expected non-zero max cardinality")
	}
}
