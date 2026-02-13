package qgram

import (
	"testing"
)

// TestSlicePostings tests the slice-based posting list
func TestSlicePostings(t *testing.T) {
	docs := []uint32{5, 2, 8, 1, 9}
	sp := NewSlicePostings(docs)

	// Should be sorted
	if !sortSliceIsSorted(sp.docs) {
		t.Error("SlicePostings should be sorted")
	}

	// Test Len
	if sp.Len() != 5 {
		t.Errorf("Expected Len=5, got %d", sp.Len())
	}

	// Test Contains
	if !sp.Contains(5) {
		t.Error("Should contain 5")
	}
	if sp.Contains(100) {
		t.Error("Should not contain 100")
	}

	// Test ToSlice
	var dst []uint32
	result := sp.ToSlice(dst)
	if len(result) != 5 {
		t.Errorf("Expected 5 elements, got %d", len(result))
	}
}

func sortSliceIsSorted(docs []uint32) bool {
	for i := 1; i < len(docs); i++ {
		if docs[i-1] > docs[i] {
			return false
		}
	}
	return true
}

// TestSlicePostingsAdd tests adding to slice postings
func TestSlicePostingsAdd(t *testing.T) {
	sp := NewSlicePostings([]uint32{1, 3, 5})

	sp.Add(4)
	if !sp.Contains(4) {
		t.Error("Should contain 4 after Add")
	}
	if sp.Len() != 4 {
		t.Errorf("Expected Len=4, got %d", sp.Len())
	}

	// Add duplicate - should not increase size
	sp.Add(4)
	if sp.Len() != 4 {
		t.Errorf("Adding duplicate should not increase size, got %d", sp.Len())
	}

	// Should still be sorted
	if !sortSliceIsSorted(sp.docs) {
		t.Error("Should remain sorted after Add")
	}
}

// TestSlicePostingsIntersection tests slice intersection
func TestSlicePostingsIntersection(t *testing.T) {
	a := NewSlicePostings([]uint32{1, 2, 3, 4, 5})
	b := NewSlicePostings([]uint32{3, 4, 5, 6, 7})

	result := a.And(b)

	if result.Len() != 3 {
		t.Errorf("Expected intersection size 3, got %d", result.Len())
	}

	expected := []uint32{3, 4, 5}
	var dst []uint32
	docs := result.ToSlice(dst)
	for i, doc := range expected {
		if docs[i] != doc {
			t.Errorf("Expected doc %d at position %d, got %d", doc, i, docs[i])
		}
	}
}

// TestSlicePostingsUnion tests slice union
func TestSlicePostingsUnion(t *testing.T) {
	a := NewSlicePostings([]uint32{1, 2, 3})
	b := NewSlicePostings([]uint32{3, 4, 5})

	result := a.Or(b)

	if result.Len() != 5 {
		t.Errorf("Expected union size 5, got %d", result.Len())
	}

	expected := []uint32{1, 2, 3, 4, 5}
	var dst []uint32
	docs := result.ToSlice(dst)
	for i, doc := range expected {
		if docs[i] != doc {
			t.Errorf("Expected doc %d at position %d, got %d", doc, i, docs[i])
		}
	}
}

// TestBitmapPostings tests the bitmap-based posting list
func TestBitmapPostings(t *testing.T) {
	bp := NewBitmapPostings()

	bp.Add(1)
	bp.Add(5)
	bp.Add(10)

	if bp.Len() != 3 {
		t.Errorf("Expected Len=3, got %d", bp.Len())
	}

	if !bp.Contains(5) {
		t.Error("Should contain 5")
	}
	if bp.Contains(100) {
		t.Error("Should not contain 100")
	}
}

// TestBitmapPostingsIntersection tests bitmap intersection
func TestBitmapPostingsIntersection(t *testing.T) {
	a := NewBitmapPostingsFromSlice([]uint32{1, 2, 3, 4, 5})
	b := NewBitmapPostingsFromSlice([]uint32{3, 4, 5, 6, 7})

	result := a.And(b)

	if result.Len() != 3 {
		t.Errorf("Expected intersection size 3, got %d", result.Len())
	}

	if !result.Contains(3) || !result.Contains(4) || !result.Contains(5) {
		t.Error("Intersection should contain 3, 4, 5")
	}
}

// TestHybridIntersection tests intersection between slice and bitmap
func TestHybridIntersection(t *testing.T) {
	sp := NewSlicePostings([]uint32{1, 2, 3, 4, 5})
	bp := NewBitmapPostingsFromSlice([]uint32{3, 4, 5, 6, 7})

	// Slice AND Bitmap
	result1 := sp.And(bp)
	if result1.Len() != 3 {
		t.Errorf("Slice AND Bitmap: expected 3, got %d", result1.Len())
	}

	// Bitmap AND Slice
	result2 := bp.And(sp)
	if result2.Len() != 3 {
		t.Errorf("Bitmap AND Slice: expected 3, got %d", result2.Len())
	}
}

// TestGramEntryPromotion tests automatic promotion from slice to bitmap
func TestGramEntryPromotion(t *testing.T) {
	threshold := uint32(10)
	entry := NewGramEntry(threshold)

	// Add documents below threshold
	for i := uint32(1); i < threshold; i++ {
		entry.Add(i)
	}

	// Should still be using slice
	if entry.Large != nil {
		t.Error("Should still be using slice representation below threshold")
	}
	if entry.Small == nil {
		t.Error("Small slice should not be nil")
	}

	// Add one more to cross threshold
	entry.Add(threshold)

	// Should now be using bitmap
	if entry.Large == nil {
		t.Error("Should have promoted to bitmap at threshold")
	}
	if entry.Small != nil {
		t.Error("Small slice should be nil after promotion")
	}

	// Verify all docs are in bitmap
	if entry.Large.GetCardinality() != uint64(threshold) {
		t.Errorf("Bitmap should have %d elements, got %d", threshold, entry.Large.GetCardinality())
	}
}

// TestGramEntryContains tests Contains method
func TestGramEntryContains(t *testing.T) {
	entry := NewGramEntry(100)

	entry.Add(5)
	entry.Add(10)
	entry.Add(15)

	if !entry.Contains(10) {
		t.Error("Should contain 10")
	}
	if entry.Contains(20) {
		t.Error("Should not contain 20")
	}
}

// TestGramEntryIntersectWith tests intersection between gram entries
func TestGramEntryIntersectWith(t *testing.T) {
	entry1 := NewGramEntry(100)
	entry1.Add(1)
	entry1.Add(2)
	entry1.Add(3)

	entry2 := NewGramEntry(100)
	entry2.Add(2)
	entry2.Add(3)
	entry2.Add(4)

	result := entry1.IntersectWith(entry2)

	if result.Len() != 2 {
		t.Errorf("Expected intersection size 2, got %d", result.Len())
	}

	if !result.Contains(2) || !result.Contains(3) {
		t.Error("Intersection should contain 2 and 3")
	}
}

// TestSlicePostingsIterator tests iteration over slice postings
func TestSlicePostingsIterator(t *testing.T) {
	sp := NewSlicePostings([]uint32{1, 3, 5, 7})

	iter := sp.Iter()
	var docs []uint32

	// First doc is already available
	docs = append(docs, iter.DocID())
	for iter.Next() {
		docs = append(docs, iter.DocID())
	}

	if len(docs) != 4 {
		t.Errorf("Expected 4 docs, got %d", len(docs))
	}

	expected := []uint32{1, 3, 5, 7}
	for i, doc := range expected {
		if docs[i] != doc {
			t.Errorf("Expected doc %d at position %d, got %d", doc, i, docs[i])
		}
	}
}

// TestBitmapPostingsIterator tests iteration over bitmap postings
func TestBitmapPostingsIterator(t *testing.T) {
	bp := NewBitmapPostingsFromSlice([]uint32{1, 3, 5, 7})

	iter := bp.Iter()
	var docs []uint32

	// First doc is already available
	docs = append(docs, iter.DocID())
	for iter.Next() {
		docs = append(docs, iter.DocID())
	}

	if len(docs) != 4 {
		t.Errorf("Expected 4 docs, got %d", len(docs))
	}

	// Should be sorted
	expected := []uint32{1, 3, 5, 7}
	for i, doc := range expected {
		if docs[i] != doc {
			t.Errorf("Expected doc %d at position %d, got %d", doc, i, docs[i])
		}
	}
}

// BenchmarkSliceIntersection benchmarks slice intersection
func BenchmarkSliceIntersection(b *testing.B) {
	a := NewSlicePostings(makeSeq(1, 1000))
	bb := NewSlicePostings(makeSeq(500, 1500))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = a.And(bb)
	}
}

// BenchmarkBitmapIntersection benchmarks bitmap intersection
func BenchmarkBitmapIntersection(b *testing.B) {
	a := NewBitmapPostingsFromSlice(makeSeq(1, 1000))
	bb := NewBitmapPostingsFromSlice(makeSeq(500, 1500))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = a.And(bb)
	}
}

// BenchmarkHybridIntersection benchmarks hybrid intersection
func BenchmarkHybridIntersection(b *testing.B) {
	sp := NewSlicePostings(makeSeq(1, 1000))
	bp := NewBitmapPostingsFromSlice(makeSeq(500, 1500))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = sp.And(bp)
	}
}

// BenchmarkGramEntryPromotion benchmarks the promotion path
func BenchmarkGramEntryPromotion(b *testing.B) {
	for i := 0; i < b.N; i++ {
		entry := NewGramEntry(1000)
		for j := uint32(1); j <= 1001; j++ {
			entry.Add(j)
		}
	}
}

// makeSeq creates a sequence of uint32
func makeSeq(start, end int) []uint32 {
	result := make([]uint32, end-start+1)
	for i := range result {
		result[i] = uint32(start + i)
	}
	return result
}
