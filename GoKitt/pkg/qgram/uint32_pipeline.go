package qgram

// Candidate32 represents a candidate document with uint32 docID for zero-alloc pipeline.
type Candidate32 struct {
	DocID      uint32
	UpperBound float64
}

// ScoredResult32 represents a scored result with uint32 docID for internal pipeline.
type ScoredResult32 struct {
	DocID    uint32
	Score    float64
	Coverage float64
}

// PatternIterator32 tracks iteration over a sorted list of uint32 docIDs for WAND.
// This is the zero-alloc version of PatternIterator.
type PatternIterator32 struct {
	DocIDs   []uint32
	Index    int
	MaxScore float64 // Upper bound contribution of this pattern
	Current  uint32  // Current DocID, 0 if exhausted
}

// NewPatternIterator32 creates a new uint32-based pattern iterator.
func NewPatternIterator32(docs []uint32, maxScore float64) *PatternIterator32 {
	it := &PatternIterator32{
		DocIDs:   docs,
		MaxScore: maxScore,
	}
	if len(docs) > 0 {
		it.Current = docs[0]
	}
	return it
}

// Next advances the iterator to the next docID.
func (it *PatternIterator32) Next() {
	it.Index++
	if it.Index < len(it.DocIDs) {
		it.Current = it.DocIDs[it.Index]
	} else {
		it.Current = 0
	}
}

// Seek advances to the first docID >= target.
// Uses binary search for efficient seeking in sorted arrays.
func (it *PatternIterator32) Seek(target uint32) {
	if it.Current == 0 || it.Current >= target {
		return
	}

	// Binary search for target in the remaining portion
	// Search in [it.Index, len(it.DocIDs))
	lo, hi := it.Index, len(it.DocIDs)-1
	result := -1

	for lo <= hi {
		mid := lo + (hi-lo)/2
		if it.DocIDs[mid] >= target {
			result = mid
			hi = mid - 1 // keep searching left for first >= target
		} else {
			lo = mid + 1
		}
	}

	if result != -1 {
		it.Index = result
		it.Current = it.DocIDs[result]
	} else {
		it.Current = 0
	}
}

// Exhausted returns true if the iterator has no more documents.
func (it *PatternIterator32) Exhausted() bool {
	return it.Current == 0
}
