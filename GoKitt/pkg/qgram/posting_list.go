package qgram

import (
	"sort"

	"github.com/RoaringBitmap/roaring/v2"
)

// DefaultBitmapThreshold is the document frequency threshold for switching from
// slice to bitmap representation. Below this, sorted []uint32 is more cache-friendly.
// Above this, roaring bitmaps with SIMD intersection win.
const DefaultBitmapThreshold = 2000

// DocIter yields docIDs in sorted order.
type DocIter interface {
	Next() bool
	DocID() uint32
	Err() error
}

// PostingList unifies slice and bitmap representations for candidate generation.
// This enables thresholded dual-mode: small posting lists use cache-friendly
// sorted slices, large ones use SIMD-optimized roaring bitmaps.
type PostingList interface {
	// Len returns the number of documents in the posting list.
	Len() int

	// Iter returns an iterator over docIDs in sorted order.
	Iter() DocIter

	// And returns the intersection of this and other posting list.
	And(other PostingList) PostingList

	// Or returns the union of this and other posting list.
	Or(other PostingList) PostingList

	// ToSlice appends all docIDs to dst and returns the extended slice.
	ToSlice(dst []uint32) []uint32

	// Contains checks if a docID is in the posting list.
	Contains(docID uint32) bool
}

// ============================================================================
// SlicePostings - cache-friendly for low/medium df (< threshold)
// ============================================================================

// SlicePostings is a sorted slice of uint32 docIDs.
// Optimal for low document frequencies due to cache-friendly sequential access.
type SlicePostings struct {
	docs []uint32 // sorted, no duplicates
}

// NewSlicePostings creates a new slice-based posting list.
func NewSlicePostings(docs []uint32) *SlicePostings {
	// Ensure sorted and deduplicated
	if !sort.SliceIsSorted(docs, func(i, j int) bool { return docs[i] < docs[j] }) {
		sort.Slice(docs, func(i, j int) bool { return docs[i] < docs[j] })
	}
	// Deduplicate
	docs = deduplicate(docs)
	return &SlicePostings{docs: docs}
}

func deduplicate(sorted []uint32) []uint32 {
	if len(sorted) <= 1 {
		return sorted
	}
	write := 1
	for read := 1; read < len(sorted); read++ {
		if sorted[read] != sorted[read-1] {
			sorted[write] = sorted[read]
			write++
		}
	}
	return sorted[:write]
}

func (s *SlicePostings) Len() int { return len(s.docs) }

func (s *SlicePostings) Iter() DocIter {
	it := &sliceIter{docs: s.docs, idx: 0}
	// Initialize with first element if available
	if len(s.docs) > 0 {
		it.current = s.docs[0]
	}
	return it
}

func (s *SlicePostings) And(other PostingList) PostingList {
	switch o := other.(type) {
	case *SlicePostings:
		return intersectSlices(s.docs, o.docs)
	case *BitmapPostings:
		// Convert slice to bitmap for SIMD intersection
		return s.toBitmap().And(o)
	default:
		return s.toBitmap().And(other)
	}
}

func (s *SlicePostings) Or(other PostingList) PostingList {
	switch o := other.(type) {
	case *SlicePostings:
		return unionSlices(s.docs, o.docs)
	case *BitmapPostings:
		return s.toBitmap().Or(o)
	default:
		return s.toBitmap().Or(other)
	}
}

func (s *SlicePostings) ToSlice(dst []uint32) []uint32 {
	return append(dst, s.docs...)
}

func (s *SlicePostings) Contains(docID uint32) bool {
	// Binary search
	idx := sort.Search(len(s.docs), func(i int) bool { return s.docs[i] >= docID })
	return idx < len(s.docs) && s.docs[idx] == docID
}

func (s *SlicePostings) toBitmap() *BitmapPostings {
	bm := roaring.New()
	bm.AddMany(s.docs)
	return &BitmapPostings{bm: bm}
}

// Add inserts a docID, maintaining sorted order.
func (s *SlicePostings) Add(docID uint32) {
	idx := sort.Search(len(s.docs), func(i int) bool { return s.docs[i] >= docID })
	if idx < len(s.docs) && s.docs[idx] == docID {
		return // already exists
	}
	s.docs = append(s.docs, 0)
	copy(s.docs[idx+1:], s.docs[idx:])
	s.docs[idx] = docID
}

// intersectSlices performs intersection of two sorted slices.
// Uses galloping search for optimal performance when sizes differ significantly.
func intersectSlices(a, b []uint32) *SlicePostings {
	if len(a) == 0 || len(b) == 0 {
		return &SlicePostings{docs: nil}
	}

	// Ensure a is smaller for efficiency
	if len(a) > len(b) {
		a, b = b, a
	}

	result := make([]uint32, 0, len(a))
	bIdx := 0

	for _, doc := range a {
		// Linear search in b (could use galloping for large size differences)
		for bIdx < len(b) && b[bIdx] < doc {
			bIdx++
		}
		if bIdx < len(b) && b[bIdx] == doc {
			result = append(result, doc)
			bIdx++
		}
	}

	return &SlicePostings{docs: result}
}

// unionSlices performs union of two sorted slices.
func unionSlices(a, b []uint32) *SlicePostings {
	if len(a) == 0 {
		return &SlicePostings{docs: b}
	}
	if len(b) == 0 {
		return &SlicePostings{docs: a}
	}

	result := make([]uint32, 0, len(a)+len(b))
	i, j := 0, 0

	for i < len(a) && j < len(b) {
		if a[i] < b[j] {
			result = append(result, a[i])
			i++
		} else if a[i] > b[j] {
			result = append(result, b[j])
			j++
		} else {
			result = append(result, a[i])
			i++
			j++
		}
	}

	result = append(result, a[i:]...)
	result = append(result, b[j:]...)

	return &SlicePostings{docs: result}
}

// sliceIter iterates over a sorted slice.
type sliceIter struct {
	docs    []uint32
	idx     int
	current uint32
}

func (it *sliceIter) Next() bool {
	it.idx++
	if it.idx < len(it.docs) {
		it.current = it.docs[it.idx]
		return true
	}
	it.current = 0
	return false
}

func (it *sliceIter) DocID() uint32 {
	return it.current
}

func (it *sliceIter) Err() error { return nil }

// ============================================================================
// BitmapPostings - SIMD-optimized for high df (>= threshold)
// ============================================================================

// BitmapPostings is a roaring bitmap of docIDs.
// Optimal for high document frequencies due to SIMD-optimized intersection.
type BitmapPostings struct {
	bm *roaring.Bitmap
}

// NewBitmapPostings creates a new bitmap-based posting list.
func NewBitmapPostings() *BitmapPostings {
	return &BitmapPostings{bm: roaring.New()}
}

// NewBitmapPostingsFromSlice creates a bitmap from a slice of docIDs.
func NewBitmapPostingsFromSlice(docs []uint32) *BitmapPostings {
	bm := roaring.New()
	bm.AddMany(docs)
	return &BitmapPostings{bm: bm}
}

func (b *BitmapPostings) Len() int { return int(b.bm.GetCardinality()) }

func (b *BitmapPostings) Iter() DocIter {
	iter := b.bm.Iterator()
	it := &bitmapIter{iter: iter}
	// Initialize by calling Next() once
	if iter.HasNext() {
		it.current = iter.Next()
		it.hasNext = iter.HasNext()
	}
	return it
}

func (b *BitmapPostings) And(other PostingList) PostingList {
	switch o := other.(type) {
	case *BitmapPostings:
		return &BitmapPostings{bm: roaring.And(b.bm, o.bm)}
	case *SlicePostings:
		return &BitmapPostings{bm: roaring.And(b.bm, o.toBitmap().bm)}
	default:
		// Convert other to bitmap
		otherBm := roaring.New()
		iter := other.Iter()
		for iter.Next() {
			otherBm.Add(iter.DocID())
		}
		return &BitmapPostings{bm: roaring.And(b.bm, otherBm)}
	}
}

func (b *BitmapPostings) Or(other PostingList) PostingList {
	switch o := other.(type) {
	case *BitmapPostings:
		return &BitmapPostings{bm: roaring.Or(b.bm, o.bm)}
	case *SlicePostings:
		return &BitmapPostings{bm: roaring.Or(b.bm, o.toBitmap().bm)}
	default:
		otherBm := roaring.New()
		iter := other.Iter()
		for iter.Next() {
			otherBm.Add(iter.DocID())
		}
		return &BitmapPostings{bm: roaring.Or(b.bm, otherBm)}
	}
}

func (b *BitmapPostings) ToSlice(dst []uint32) []uint32 {
	return append(dst, b.bm.ToArray()...)
}

func (b *BitmapPostings) Contains(docID uint32) bool {
	return b.bm.Contains(docID)
}

// Add inserts a docID into the bitmap.
func (b *BitmapPostings) Add(docID uint32) {
	b.bm.Add(docID)
}

// bitmapIter iterates over a roaring bitmap.
type bitmapIter struct {
	iter    roaring.IntIterable
	current uint32
	hasNext bool
}

func (it *bitmapIter) Next() bool {
	if it.hasNext {
		it.current = it.iter.Next()
		it.hasNext = it.iter.HasNext()
		return true
	}
	return false
}

func (it *bitmapIter) DocID() uint32 {
	return it.current
}

func (it *bitmapIter) Err() error { return nil }

// ============================================================================
// GramEntry - Thresholded dual-mode storage
// ============================================================================

// GramEntry stores a posting list with automatic promotion from slice to bitmap.
type GramEntry struct {
	DF        uint32 // Document frequency
	threshold uint32 // Threshold for promotion (copied from index config)

	// Exactly one of these is non-nil:
	Small []uint32        // df < threshold
	Large *roaring.Bitmap // df >= threshold
}

// NewGramEntry creates a new gram entry with the given threshold.
func NewGramEntry(threshold uint32) *GramEntry {
	return &GramEntry{
		threshold: threshold,
	}
}

// Add inserts a docID, promoting to bitmap if threshold is crossed.
func (e *GramEntry) Add(docID uint32) {
	e.DF++

	if e.DF < e.threshold {
		// Use slice representation
		e.addToSlice(docID)
	} else if e.DF == e.threshold {
		// Promote to bitmap
		e.promoteToBitmap(docID)
	} else {
		// Already using bitmap
		e.Large.Add(docID)
	}
}

func (e *GramEntry) addToSlice(docID uint32) {
	idx := sort.Search(len(e.Small), func(i int) bool { return e.Small[i] >= docID })
	if idx < len(e.Small) && e.Small[idx] == docID {
		e.DF-- // Already exists, undo increment
		return
	}
	e.Small = append(e.Small, 0)
	copy(e.Small[idx+1:], e.Small[idx:])
	e.Small[idx] = docID
}

func (e *GramEntry) promoteToBitmap(newDocID uint32) {
	e.Large = roaring.New()
	e.Large.AddMany(e.Small)
	e.Large.Add(newDocID)
	e.Small = nil
}

// Contains checks if a docID is in the posting list.
func (e *GramEntry) Contains(docID uint32) bool {
	if e.DF < e.threshold {
		idx := sort.Search(len(e.Small), func(i int) bool { return e.Small[i] >= docID })
		return idx < len(e.Small) && e.Small[idx] == docID
	}
	return e.Large.Contains(docID)
}

// ToPostingList converts to a PostingList interface.
func (e *GramEntry) ToPostingList() PostingList {
	if e.DF < e.threshold {
		return &SlicePostings{docs: e.Small}
	}
	return &BitmapPostings{bm: e.Large}
}

// IntersectWith intersects this gram entry with another.
func (e *GramEntry) IntersectWith(other *GramEntry) PostingList {
	this := e.ToPostingList()
	that := other.ToPostingList()
	return this.And(that)
}
