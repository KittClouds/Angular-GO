package qgram

import (
	"math"
	"math/bits"
	"sort"
	"strings"

	"github.com/RoaringBitmap/roaring/v2"
)

// DocIDMapper maintains bidirectional mapping between string docIDs and uint32 indices.
// Required for RoaringBitmaps which operate on uint32 values.
type DocIDMapper struct {
	// string -> uint32
	toUint32 map[string]uint32
	// uint32 -> string
	toString map[uint32]string
	// Next available ID
	nextID uint32
}

// NewDocIDMapper creates a new mapper
func NewDocIDMapper() *DocIDMapper {
	return &DocIDMapper{
		toUint32: make(map[string]uint32),
		toString: make(map[uint32]string),
		nextID:   1, // 0 reserved for invalid/not-found
	}
}

// GetOrAssign returns the uint32 ID for a string docID, assigning a new one if needed.
func (m *DocIDMapper) GetOrAssign(docID string) uint32 {
	if id, ok := m.toUint32[docID]; ok {
		return id
	}
	id := m.nextID
	m.nextID++
	m.toUint32[docID] = id
	m.toString[id] = docID
	return id
}

// Get returns the uint32 ID for a string docID, or 0 if not found.
func (m *DocIDMapper) Get(docID string) uint32 {
	return m.toUint32[docID]
}

// GetString returns the string docID for a uint32 ID, or "" if not found.
func (m *DocIDMapper) GetString(id uint32) string {
	return m.toString[id]
}

// Remove removes a docID from the mapping.
// Note: IDs are not reused to maintain consistency with bitmaps.
func (m *DocIDMapper) Remove(docID string) {
	if id, ok := m.toUint32[docID]; ok {
		delete(m.toUint32, docID)
		delete(m.toString, id)
	}
}

// Count returns the number of mapped docIDs.
func (m *DocIDMapper) Count() int {
	return len(m.toUint32)
}

// CompressedGramPostings stores posting list data with RoaringBitmap for docID sets.
// This provides O(1) intersection via bitmap AND operations with SIMD optimization.
// Payload data (TF, segment masks) is NOT stored here - scoring uses PatternMatch
// from verification. This keeps posting lists minimal for fast candidate generation.
type CompressedGramPostings struct {
	// DocID bitmap (uint32 indices) - the only field needed for candidate gen
	DocIDs *roaring.Bitmap
}

// NewCompressedGramPostings creates a new compressed posting list.
func NewCompressedGramPostings() *CompressedGramPostings {
	return &CompressedGramPostings{
		DocIDs: roaring.New(),
	}
}

// AddDocument adds a document to the posting list.
func (p *CompressedGramPostings) AddDocument(docID uint32) {
	p.DocIDs.Add(docID)
}

// RemoveDocument removes a document from the posting list.
func (p *CompressedGramPostings) RemoveDocument(docID uint32) {
	p.DocIDs.Remove(docID)
}

// HasDocument checks if a document is in the posting list.
func (p *CompressedGramPostings) HasDocument(docID uint32) bool {
	return p.DocIDs.Contains(docID)
}

// GetDocCount returns the number of documents in the posting list.
func (p *CompressedGramPostings) GetDocCount() int {
	return int(p.DocIDs.GetCardinality())
}

// Iterator returns an iterator for streaming over docIDs (no allocation).
func (p *CompressedGramPostings) Iterator() roaring.IntPeekable {
	return p.DocIDs.Iterator()
}

// IntersectWith returns a new bitmap that is the intersection of this and other.
// This is the key operation for candidate generation - O(n/64) with SIMD.
func (p *CompressedGramPostings) IntersectWith(other *CompressedGramPostings) *roaring.Bitmap {
	return roaring.And(p.DocIDs, other.DocIDs)
}

// IntersectMultiple returns the intersection of multiple posting lists.
// More efficient than sequential pairwise intersections.
func IntersectMultiple(postings []*CompressedGramPostings) *roaring.Bitmap {
	if len(postings) == 0 {
		return roaring.New()
	}
	if len(postings) == 1 {
		return postings[0].DocIDs.Clone()
	}

	// Sort by cardinality (smallest first for early termination)
	sorted := make([]*CompressedGramPostings, len(postings))
	copy(sorted, postings)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].DocIDs.GetCardinality() < sorted[j].DocIDs.GetCardinality()
	})

	// Start with smallest
	result := sorted[0].DocIDs.Clone()

	// Intersect with rest
	for i := 1; i < len(sorted) && !result.IsEmpty(); i++ {
		result.And(sorted[i].DocIDs)
	}

	return result
}

// CompressedQGramIndex is an alternative index implementation using compressed postings.
// Uses RoaringBitmaps for O(1) intersection with SIMD optimization on amd64.
type CompressedQGramIndex struct {
	Q int

	// Gram -> compressed postings
	GramPostings map[string]*CompressedGramPostings

	// Gram statistics for WAND
	GramStats map[string]*GramStat

	// Document storage (unchanged)
	Documents map[string]DocumentInfo

	// DocID mapping
	Mapper *DocIDMapper

	// Lazy delete bitmap - documents marked deleted but not yet purged
	// Applied via AndNot() during candidate generation (zero-allocation)
	Deleted *roaring.Bitmap

	// Internal sums for stats
	totalDocLen    float64
	totalFieldLens map[string]float64
	totalDocs      int
}

// NewCompressedQGramIndex creates a new compressed index.
func NewCompressedQGramIndex(q int) *CompressedQGramIndex {
	return &CompressedQGramIndex{
		Q:              q,
		GramPostings:   make(map[string]*CompressedGramPostings),
		GramStats:      make(map[string]*GramStat),
		Documents:      make(map[string]DocumentInfo),
		Mapper:         NewDocIDMapper(),
		Deleted:        roaring.New(),
		totalFieldLens: make(map[string]float64),
	}
}

// IndexDocument adds a document to the compressed index.
func (idx *CompressedQGramIndex) IndexDocument(docID string, fields map[string]string) {
	idx.IndexDocumentScoped(docID, fields, "", "")
}

// IndexDocumentScoped adds a document with scope metadata.
func (idx *CompressedQGramIndex) IndexDocumentScoped(docID string, fields map[string]string, narrativeID, folderPath string) {
	idx.totalDocs++

	// Assign uint32 ID
	uid := idx.Mapper.GetOrAssign(docID)

	idx.Documents[docID] = DocumentInfo{
		Fields:      fields,
		DocID:       docID,
		NarrativeID: narrativeID,
		FolderPath:  folderPath,
	}

	docLen := 0

	for field, content := range fields {
		normalized := NormalizeText(content)
		fieldLen := len(normalized)

		idx.totalFieldLens[field] += float64(fieldLen)
		docLen += fieldLen

		if fieldLen < idx.Q {
			continue
		}

		// Track per-field TF for this document
		fieldTF := make(map[string]int)
		gramPositions := make(map[string][]int)

		for i := 0; i <= fieldLen-idx.Q; i++ {
			gram := normalized[i : i+idx.Q]
			fieldTF[gram]++
			gramPositions[gram] = append(gramPositions[gram], i)
		}

		// Add to posting lists
		for gram, tf := range fieldTF {
			postings, ok := idx.GramPostings[gram]
			if !ok {
				postings = NewCompressedGramPostings()
				idx.GramPostings[gram] = postings
			}

			// Compute segment mask for this gram in this field
			var segMask uint32
			for _, pos := range gramPositions[gram] {
				segIdx := (pos * 32) / fieldLen
				if segIdx >= 32 {
					segIdx = 31
				}
				segMask |= (1 << segIdx)
			}

			// Add document to posting list (bitmap only, no payload)
			postings.AddDocument(uid)

			// Update stats
			stat, ok := idx.GramStats[gram]
			if !ok {
				stat = &GramStat{MinFieldLen: fieldLen}
				idx.GramStats[gram] = stat
			}
			if tf > stat.MaxTF {
				stat.MaxTF = tf
			}
			if fieldLen < stat.MinFieldLen {
				stat.MinFieldLen = fieldLen
			}
		}
	}

	idx.totalDocLen += float64(docLen)
}

// RemoveDocument removes a document from the compressed index.
// This is now a lazy delete - marks the docID in the Deleted bitmap.
// Use Compact() to actually purge deleted documents from postings.
func (idx *CompressedQGramIndex) RemoveDocument(docID string) {
	uid := idx.Mapper.Get(docID)
	if uid == 0 {
		return // Not found
	}

	// Lazy delete: just mark in Deleted bitmap
	idx.Deleted.Add(uid)

	// Remove from documents map immediately (no impact on postings)
	delete(idx.Documents, docID)

	// Adjust corpus stats
	idx.totalDocs--
}

// LazyDelete marks a document as deleted without removing from postings.
// The document will be excluded from candidate generation via AndNot().
// This is O(1) and safe for high-frequency updates.
func (idx *CompressedQGramIndex) LazyDelete(docID string) {
	uid := idx.Mapper.Get(docID)
	if uid == 0 {
		return
	}
	idx.Deleted.Add(uid)
	delete(idx.Documents, docID)
	idx.totalDocs--
}

// Compact purges all lazy-deleted documents from posting lists.
// Call this periodically to reclaim memory from deleted docs.
func (idx *CompressedQGramIndex) Compact() {
	if idx.Deleted.IsEmpty() {
		return
	}

	// Remove deleted docIDs from all posting lists
	for gram, postings := range idx.GramPostings {
		postings.DocIDs.AndNot(idx.Deleted)
		if postings.DocIDs.IsEmpty() {
			delete(idx.GramPostings, gram)
		}
	}

	// Clear the deleted bitmap
	idx.Deleted = roaring.New()
}

// RemoveDocumentHard performs immediate (non-lazy) removal from all postings.
// Use RemoveDocument() for the fast lazy-delete path.
func (idx *CompressedQGramIndex) RemoveDocumentHard(docID string) {
	doc, exists := idx.Documents[docID]
	if !exists {
		return
	}

	uid := idx.Mapper.Get(docID)

	// Calculate document length for stats adjustment
	docLen := 0
	for _, content := range doc.Fields {
		docLen += len(NormalizeText(content))
	}

	// Remove from gram postings
	for gram, postings := range idx.GramPostings {
		if postings.HasDocument(uid) {
			postings.RemoveDocument(uid)
		}
		// Clean up empty posting lists
		if postings.GetDocCount() == 0 {
			delete(idx.GramPostings, gram)
		}
	}

	// Remove from documents map
	delete(idx.Documents, docID)

	// Remove from mapper
	idx.Mapper.Remove(docID)

	// Remove from deleted bitmap if present
	idx.Deleted.Remove(uid)

	// Adjust corpus stats
	idx.totalDocs--
	idx.totalDocLen -= float64(docLen)

	// Adjust field lengths
	for field, content := range doc.Fields {
		fieldLen := len(NormalizeText(content))
		idx.totalFieldLens[field] -= float64(fieldLen)
		if idx.totalFieldLens[field] <= 0 {
			delete(idx.totalFieldLens, field)
		}
	}
}

// GetCorpusStats returns corpus statistics.
func (idx *CompressedQGramIndex) GetCorpusStats() CorpusStats {
	stats := CorpusStats{
		TotalDocuments:      idx.totalDocs,
		AverageFieldLengths: make(map[string]float64),
	}

	if idx.totalDocs > 0 {
		stats.AverageDocLength = idx.totalDocLen / float64(idx.totalDocs)
		for f, sum := range idx.totalFieldLens {
			stats.AverageFieldLengths[f] = sum / float64(idx.totalDocs)
		}
	}

	return stats
}

// GetCandidatesForPattern returns candidate docIDs for a pattern using bitmap intersection.
// This is significantly faster than map-based intersection for large posting lists.
// Applies lazy delete filter via AndNot().
func (idx *CompressedQGramIndex) GetCandidatesForPattern(pattern string) []string {
	if len(pattern) < idx.Q {
		// Short pattern: return all docs (excluding deleted)
		all := make([]string, 0, len(idx.Documents))
		for docID := range idx.Documents {
			all = append(all, docID)
		}
		return all
	}

	grams := ExtractGrams(pattern, idx.Q)
	if len(grams) == 0 {
		return nil
	}

	// Sort grams by cardinality (smallest first)
	type gramCard struct {
		gram string
		card uint64
	}
	cards := make([]gramCard, len(grams))
	for i, g := range grams {
		if p, ok := idx.GramPostings[g]; ok {
			cards[i] = gramCard{gram: g, card: p.DocIDs.GetCardinality()}
		} else {
			cards[i] = gramCard{gram: g, card: 0}
		}
	}

	sort.Slice(cards, func(i, j int) bool {
		return cards[i].card < cards[j].card
	})

	// Check if any gram has no matches
	if cards[0].card == 0 {
		return nil
	}

	// Start with smallest bitmap
	result := idx.GramPostings[cards[0].gram].DocIDs.Clone()

	// Intersect with rest
	for i := 1; i < len(cards) && !result.IsEmpty(); i++ {
		if p, ok := idx.GramPostings[cards[i].gram]; ok {
			result.And(p.DocIDs)
		} else {
			return nil // Gram not found, no matches
		}
	}

	// Apply lazy delete filter (AndNot is SIMD-optimized)
	if !idx.Deleted.IsEmpty() {
		result.AndNot(idx.Deleted)
	}

	if result.IsEmpty() {
		return nil
	}

	// Convert uint32 IDs back to strings using streaming iteration
	docs := make([]string, 0, result.GetCardinality())
	it := result.Iterator()
	for it.HasNext() {
		uid := it.Next()
		if s := idx.Mapper.GetString(uid); s != "" {
			docs = append(docs, s)
		}
	}

	return docs
}

// GramIDF computes IDF for a specific gram using BM25 formula.
// IDF = log(1 + (N - df + 0.5) / (df + 0.5))
func (idx *CompressedQGramIndex) GramIDF(gram string) float64 {
	var df int
	if p, ok := idx.GramPostings[gram]; ok {
		df = p.GetDocCount()
	}
	return math.Log(1.0 + (float64(idx.totalDocs)-float64(df)+0.5)/(float64(df)+0.5))
}

// AdaptiveGramSelection selects the most selective grams for intersection.
// Returns grams sorted by selectivity, with early termination if cardinality
// drops below the threshold.
func (idx *CompressedQGramIndex) AdaptiveGramSelection(pattern string, maxCandidates int) []string {
	if len(pattern) < idx.Q {
		return nil
	}

	grams := ExtractGrams(pattern, idx.Q)
	if len(grams) == 0 {
		return nil
	}

	// Sort grams by cardinality (smallest first for early termination)
	type gramCard struct {
		gram string
		card uint64
	}
	cards := make([]gramCard, 0, len(grams))
	for _, g := range grams {
		if p, ok := idx.GramPostings[g]; ok {
			cards = append(cards, gramCard{gram: g, card: p.DocIDs.GetCardinality()})
		} else {
			// Gram not found - pattern cannot match
			return nil
		}
	}

	sort.Slice(cards, func(i, j int) bool {
		return cards[i].card < cards[j].card
	})

	// Early termination: if smallest cardinality > maxCandidates, skip
	if maxCandidates > 0 && cards[0].card > uint64(maxCandidates) {
		// Return just the most selective gram for verification
		return []string{cards[0].gram}
	}

	// Return all grams sorted by selectivity
	result := make([]string, len(cards))
	for i, c := range cards {
		result[i] = c.gram
	}
	return result
}

// GetCandidatesAdaptive returns candidates using adaptive gram selection.
// This is optimized for patterns with many grams where full intersection
// may be more expensive than verification.
// Applies lazy delete filter via AndNot().
func (idx *CompressedQGramIndex) GetCandidatesAdaptive(pattern string, maxCandidates int) []string {
	selectedGrams := idx.AdaptiveGramSelection(pattern, maxCandidates)
	if len(selectedGrams) == 0 {
		// Pattern too short or no grams found
		if len(pattern) < idx.Q {
			all := make([]string, 0, len(idx.Documents))
			for docID := range idx.Documents {
				all = append(all, docID)
			}
			return all
		}
		return nil
	}

	// Intersect selected grams
	result := idx.GramPostings[selectedGrams[0]].DocIDs.Clone()
	for i := 1; i < len(selectedGrams) && !result.IsEmpty(); i++ {
		result.And(idx.GramPostings[selectedGrams[i]].DocIDs)
	}

	// Apply lazy delete filter
	if !idx.Deleted.IsEmpty() {
		result.AndNot(idx.Deleted)
	}

	if result.IsEmpty() {
		return nil
	}

	// Convert uint32 IDs back to strings using streaming iteration
	docs := make([]string, 0, result.GetCardinality())
	it := result.Iterator()
	for it.HasNext() {
		uid := it.Next()
		if s := idx.Mapper.GetString(uid); s != "" {
			docs = append(docs, s)
		}
	}

	return docs
}

// IntersectGramsFast performs fast intersection of multiple gram posting lists.
// Uses RoaringBitmap's SIMD-optimized AND operation.
// Returns the resulting bitmap (caller must convert to docIDs if needed).
func (idx *CompressedQGramIndex) IntersectGramsFast(grams []string) *roaring.Bitmap {
	if len(grams) == 0 {
		return roaring.New()
	}

	// Sort by cardinality for optimal intersection order
	type gramCard struct {
		gram string
		card uint64
	}
	cards := make([]gramCard, 0, len(grams))
	for _, g := range grams {
		if p, ok := idx.GramPostings[g]; ok {
			cards = append(cards, gramCard{gram: g, card: p.DocIDs.GetCardinality()})
		} else {
			return roaring.New() // Gram not found, empty result
		}
	}

	sort.Slice(cards, func(i, j int) bool {
		return cards[i].card < cards[j].card
	})

	// Start with smallest and intersect
	result := idx.GramPostings[cards[0].gram].DocIDs.Clone()
	for i := 1; i < len(cards) && !result.IsEmpty(); i++ {
		result.And(idx.GramPostings[cards[i].gram].DocIDs)
	}

	return result
}

// GetPostingStats returns statistics about the index for tuning.
func (idx *CompressedQGramIndex) GetPostingStats() (numGrams int, avgCardinality float64, maxCardinality uint64) {
	numGrams = len(idx.GramPostings)
	if numGrams == 0 {
		return
	}

	var totalCard uint64
	for _, p := range idx.GramPostings {
		card := p.DocIDs.GetCardinality()
		totalCard += card
		if card > maxCardinality {
			maxCardinality = card
		}
	}
	avgCardinality = float64(totalCard) / float64(numGrams)
	return
}

// ============================================================================
// UINT32 PIPELINE METHODS (Zero-alloc internal operations)
// ============================================================================

// GetCandidates32 returns candidate docIDs as uint32 slice (no string conversion).
// This is the zero-alloc version of GetCandidatesForPattern.
// Applies lazy delete filter via AndNot().
func (idx *CompressedQGramIndex) GetCandidates32(pattern string) []Candidate32 {
	if len(pattern) < idx.Q {
		// Short pattern: return all docs (excluding deleted)
		all := make([]Candidate32, 0, len(idx.Documents))
		for docID := range idx.Documents {
			uid := idx.Mapper.Get(docID)
			if uid != 0 && !idx.Deleted.Contains(uid) {
				all = append(all, Candidate32{DocID: uid})
			}
		}
		return all
	}

	grams := ExtractGrams(pattern, idx.Q)
	if len(grams) == 0 {
		return nil
	}

	// Sort grams by cardinality (smallest first)
	type gramCard struct {
		gram string
		card uint64
	}
	cards := make([]gramCard, 0, len(grams))
	for _, g := range grams {
		if p, ok := idx.GramPostings[g]; ok {
			cards = append(cards, gramCard{gram: g, card: p.DocIDs.GetCardinality()})
		} else {
			return nil // Gram not found, no matches
		}
	}

	sort.Slice(cards, func(i, j int) bool {
		return cards[i].card < cards[j].card
	})

	// Start with smallest bitmap
	result := idx.GramPostings[cards[0].gram].DocIDs.Clone()

	// Intersect with rest
	for i := 1; i < len(cards) && !result.IsEmpty(); i++ {
		result.And(idx.GramPostings[cards[i].gram].DocIDs)
	}

	// Apply lazy delete filter
	if !idx.Deleted.IsEmpty() {
		result.AndNot(idx.Deleted)
	}

	if result.IsEmpty() {
		return nil
	}

	// Return as uint32 slice using streaming iteration
	candidates := make([]Candidate32, 0, result.GetCardinality())
	it := result.Iterator()
	for it.HasNext() {
		candidates = append(candidates, Candidate32{DocID: it.Next()})
	}

	return candidates
}

// IntersectGrams32 performs fast intersection and returns a DocIter32 for iteration.
func (idx *CompressedQGramIndex) IntersectGrams32(grams []string) *DocIter32 {
	bm := idx.IntersectGramsFast(grams)
	if bm == nil || bm.IsEmpty() {
		return nil
	}
	return NewDocIter32(bm)
}

// DocIter32 provides iteration over a roaring bitmap.
type DocIter32 struct {
	bm      *roaring.Bitmap
	iter    roaring.IntIterable
	current uint32
	hasNext bool
}

// NewDocIter32 creates a new iterator from a bitmap.
func NewDocIter32(bm *roaring.Bitmap) *DocIter32 {
	if bm == nil || bm.IsEmpty() {
		return nil
	}
	iter := bm.Iterator()
	return &DocIter32{
		bm:      bm,
		iter:    iter,
		hasNext: iter.HasNext(),
	}
}

// HasNext returns true if there are more documents.
func (it *DocIter32) HasNext() bool {
	return it.hasNext
}

// Next advances to the next document.
func (it *DocIter32) Next() {
	if it.hasNext {
		it.current = it.iter.Next()
		it.hasNext = it.iter.HasNext()
	}
}

// DocID returns the current document ID.
func (it *DocIter32) DocID() uint32 {
	return it.current
}

// GeneratePrunedCandidates32 implements WAND with uint32 docIDs (zero-alloc).
func (idx *CompressedQGramIndex) GeneratePrunedCandidates32(clauses []Clause, config SearchConfig, limit int) []Candidate32 {
	if len(clauses) == 0 {
		return nil
	}

	var iterators []*PatternIterator32
	for _, clause := range clauses {
		docs := idx.getCandidatesForPattern32(clause.Pattern)
		if len(docs) == 0 {
			continue
		}

		maxScore := idx.estimateMaxScore32(clause.Pattern, config)
		iterators = append(iterators, NewPatternIterator32(docs, maxScore))
	}

	if len(iterators) == 0 {
		return nil
	}

	var results []Candidate32

	// Efficient UNION with UpperBound aggregation
	for {
		// Sort iterators by Current docID
		sort.Slice(iterators, func(i, j int) bool {
			if iterators[i].Exhausted() {
				return false
			}
			if iterators[j].Exhausted() {
				return true
			}
			return iterators[i].Current < iterators[j].Current
		})

		// Check if all exhausted
		if iterators[0].Exhausted() {
			break
		}

		pivotDoc := iterators[0].Current
		upperBound := 0.0

		// Sum MaxScores for all matching iterators
		for _, it := range iterators {
			if !it.Exhausted() && it.Current == pivotDoc {
				upperBound += it.MaxScore
				it.Next()
			} else {
				break
			}
		}

		results = append(results, Candidate32{
			DocID:      pivotDoc,
			UpperBound: upperBound,
		})
	}

	return results
}

// getCandidatesForPattern32 returns uint32 docIDs for a pattern (internal).
// Applies lazy delete filter via AndNot().
func (idx *CompressedQGramIndex) getCandidatesForPattern32(pattern string) []uint32 {
	if len(pattern) < idx.Q {
		// Short pattern: return all docs (excluding deleted)
		all := make([]uint32, 0, len(idx.Documents))
		for docID := range idx.Documents {
			uid := idx.Mapper.Get(docID)
			if uid != 0 && !idx.Deleted.Contains(uid) {
				all = append(all, uid)
			}
		}
		return all
	}

	grams := ExtractGrams(pattern, idx.Q)
	if len(grams) == 0 {
		return nil
	}

	// Sort grams by cardinality
	type gramCard struct {
		gram string
		card uint64
	}
	cards := make([]gramCard, len(grams))
	for i, g := range grams {
		if p, ok := idx.GramPostings[g]; ok {
			cards[i] = gramCard{gram: g, card: p.DocIDs.GetCardinality()}
		} else {
			cards[i] = gramCard{gram: g, card: 0}
		}
	}

	sort.Slice(cards, func(i, j int) bool {
		return cards[i].card < cards[j].card
	})

	// Check if any gram has no matches
	if cards[0].card == 0 {
		return nil
	}

	// Start with smallest bitmap
	result := idx.GramPostings[cards[0].gram].DocIDs.Clone()

	// Intersect with rest
	for i := 1; i < len(cards) && !result.IsEmpty(); i++ {
		if p, ok := idx.GramPostings[cards[i].gram]; ok {
			result.And(p.DocIDs)
		} else {
			return nil
		}
	}

	// Apply lazy delete filter
	if !idx.Deleted.IsEmpty() {
		result.AndNot(idx.Deleted)
	}

	if result.IsEmpty() {
		return nil
	}

	// Use streaming iteration instead of ToArray()
	docs := make([]uint32, 0, result.GetCardinality())
	it := result.Iterator()
	for it.HasNext() {
		docs = append(docs, it.Next())
	}

	return docs
}

// estimateMaxScore32 computes max score upper bound for WAND pruning.
func (idx *CompressedQGramIndex) estimateMaxScore32(pattern string, config SearchConfig) float64 {
	corpusStats := idx.GetCorpusStats()
	N := float64(corpusStats.TotalDocuments)
	if N == 0 {
		N = 1
	}
	idf := math.Log(1.0 + N)

	grams := ExtractGrams(pattern, idx.Q)
	maxGramImpact := 0.0

	for _, g := range grams {
		stat, ok := idx.GramStats[g]
		if !ok {
			continue
		}

		avgLen := corpusStats.AverageDocLength
		if avgLen == 0 {
			avgLen = 100
		}

		k1 := config.K1
		b := config.B

		lenNorm := 1.0 - b + b*float64(stat.MinFieldLen)/avgLen
		denom := k1*lenNorm + float64(stat.MaxTF)
		if denom > 0 {
			impact := (k1 + 1) * float64(stat.MaxTF) / denom
			if impact > maxGramImpact {
				maxGramImpact = impact
			}
		}
	}

	if maxGramImpact == 0 {
		maxGramImpact = config.K1 + 1
	}

	return idf * maxGramImpact
}

// Search executes the full search pipeline with uint32 internal representation.
// String conversion happens ONLY at final result emission.
func (idx *CompressedQGramIndex) Search(input string, config SearchConfig, limit int) []SearchResult {
	// 1. Parse
	clauses := ParseQuery(input)
	if len(clauses) == 0 {
		return nil
	}

	// 2. Generate candidates with uint32 docIDs (zero-alloc)
	candidates := idx.GeneratePrunedCandidates32(clauses, config, limit)
	if len(candidates) == 0 {
		return nil
	}

	// 3. Verify and score with uint32 pipeline
	scored := idx.verifyAndScore32(candidates, clauses, config, limit)

	// 4. Convert to SearchResult with string docIDs (ONLY at the end)
	results := make([]SearchResult, len(scored))
	for i, s := range scored {
		results[i] = SearchResult{
			DocID:    idx.Mapper.GetString(s.DocID),
			Score:    s.Score,
			Coverage: s.Coverage,
		}
	}

	return results
}

// verifyAndScore32 performs verification and scoring with uint32 docIDs.
func (idx *CompressedQGramIndex) verifyAndScore32(candidates []Candidate32, clauses []Clause, config SearchConfig, limit int) []ScoredResult32 {
	type docVerification struct {
		matches      []*PatternMatch
		matchedCount int
		score        float64
	}

	verified := make(map[uint32]*docVerification)

	corpusStats := idx.GetCorpusStats()
	N := float64(corpusStats.TotalDocuments)
	if N == 0 {
		N = 1
	}

	// Pre-calculate IDFs
	idfs := make([]float64, len(clauses))
	for i, clause := range clauses {
		grams := ExtractGrams(clause.Pattern, idx.Q)
		maxIDF := 0.0
		for _, g := range grams {
			idf := idx.GramIDF(g)
			if idf > maxIDF {
				maxIDF = idf
			}
		}
		if maxIDF == 0 {
			maxIDF = 1.0
		}
		idfs[i] = maxIDF
	}

	// Build QueryVerifier once
	qv := NewQueryVerifier(clauses)

	var topScores []float64
	threshold := 0.0
	var results []ScoredResult32

	for _, cand := range candidates {
		if limit > 0 && len(topScores) >= limit {
			if cand.UpperBound <= threshold {
				break
			}
		}

		docID32 := cand.DocID
		docIDStr := idx.Mapper.GetString(docID32)
		if docIDStr == "" {
			continue
		}

		doc, ok := idx.Documents[docIDStr]
		if !ok {
			continue
		}

		// Scope Check
		if config.Scope != nil {
			if config.Scope.NarrativeID != "" && doc.NarrativeID != config.Scope.NarrativeID {
				continue
			}
			if config.Scope.FolderPath != "" && !strings.HasPrefix(doc.FolderPath, config.Scope.FolderPath) {
				continue
			}
		}

		// Verify all clauses
		matches, matchedCount := idx.VerifyCandidateAll(docIDStr, &qv)
		if matchedCount == 0 {
			continue
		}

		// PhraseHard check
		reject := false
		if config.PhraseHard {
			for i, clause := range clauses {
				if clause.Type == PhraseClause && matches[i] == nil {
					reject = true
					break
				}
			}
		}
		if reject {
			continue
		}

		// Score
		score := idx.computeDocScore32(docID32, docIDStr, matches, matchedCount, idfs, config, corpusStats)
		dv := &docVerification{
			matches:      matches,
			matchedCount: matchedCount,
			score:        score,
		}
		verified[docID32] = dv

		// Update threshold
		if limit > 0 {
			topScores = insertSorted(topScores, score, limit)
			if len(topScores) == limit {
				threshold = topScores[0]
			}
		}

		results = append(results, ScoredResult32{
			DocID:    docID32,
			Score:    score,
			Coverage: float64(matchedCount) / float64(len(clauses)),
		})
	}

	// Final Sort
	sort.Slice(results, func(i, j int) bool {
		if math.Abs(results[i].Score-results[j].Score) < 1e-9 {
			return results[i].DocID < results[j].DocID
		}
		return results[i].Score > results[j].Score
	})

	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}

	return results
}

// computeDocScore32 computes BM25 score with uint32 docID.
func (idx *CompressedQGramIndex) computeDocScore32(
	_ uint32, // docID32 - reserved for future use (payload store lookup)
	_ string, // docIDStr - reserved for future use
	matches []*PatternMatch,
	matchedCount int,
	idfs []float64,
	config SearchConfig,
	stats CorpusStats,
) float64 {
	baseSum := 0.0
	var patternMasks []uint32

	for i, m := range matches {
		if m == nil {
			continue
		}

		tfStar := 0.0
		for field, detail := range m.FieldMatches {
			wf := 1.0
			if w, ok := config.FieldWeights[field]; ok {
				wf = w
			}

			avgLen := stats.AverageFieldLengths[field]
			if avgLen == 0 {
				avgLen = 100.0
			}

			ntf := normalizedTermFrequency(
				detail.Count, detail.FieldLength, avgLen, config.B,
			)
			tfStar += wf * ntf
		}

		sat := saturate(tfStar, config.K1)
		baseSum += idfs[i] * sat

		patternMasks = append(patternMasks, m.SegmentMask)
	}

	coverage := float64(matchedCount) / float64(len(matches))
	coverageMult := math.Pow(config.CoverageEpsilon+coverage, config.CoverageLambda)

	score := baseSum * coverageMult

	if len(patternMasks) > 1 {
		score *= patternProximity32(
			patternMasks, config.ProximityAlpha, config.MaxSegments,
			stats.AverageDocLength, config.ProximityDecay,
		)
	}

	return score
}

// normalizedTermFrequency computes normalized TF for BM25.
func normalizedTermFrequency(tf, fieldLen int, avgLen float64, b float64) float64 {
	return float64(tf) / (1.0 - b + b*float64(fieldLen)/avgLen)
}

// saturate applies BM25 saturation function.
func saturate(tfStar float64, k1 float64) float64 {
	return (k1 + 1) * tfStar / (k1 + tfStar)
}

// patternProximity32 computes proximity boost without index lookup.
func patternProximity32(masks []uint32, alpha float64, maxSegs uint32, _ float64, decayLambda float64) float64 {
	if len(masks) < 2 || maxSegs == 0 {
		return 1.0
	}

	// AND all masks
	common := masks[0]
	for i := 1; i < len(masks); i++ {
		common &= masks[i]
	}

	overlapCount := bits.OnesCount32(common)
	denom := uint32(len(masks))
	if denom > maxSegs {
		denom = maxSegs
	}

	baseMult := float64(overlapCount) / float64(denom)

	// Simplified decay (no doc length lookup needed)
	decay := math.Exp(-decayLambda)

	return 1.0 + alpha*baseMult*decay
}

// VerifyCandidateAll verifies all clauses against a document in one pass.
// This is the CompressedQGramIndex version that uses the shared Documents map.
func (idx *CompressedQGramIndex) VerifyCandidateAll(
	docID string,
	qv *QueryVerifier,
) (matches []*PatternMatch, matchedCount int) {
	doc, ok := idx.Documents[docID]
	if !ok {
		return nil, 0
	}

	if len(qv.Clauses) == 0 {
		return nil, 0
	}

	matches = make([]*PatternMatch, len(qv.Clauses))

	for field, content := range doc.Fields {
		normalized := NormalizeText(content)
		fieldLen := len(normalized)
		if fieldLen == 0 {
			continue
		}

		// Overlapping to match current findPositions() behavior (advance by 1).
		iter := qv.AC.IterOverlapping(normalized)
		for {
			m := iter.Next()
			if m == nil {
				break
			}

			patIdx := m.Pattern()
			start := m.Start()

			// Bounds check for safety
			if patIdx >= len(matches) {
				continue
			}

			pm := matches[patIdx]
			if pm == nil {
				pm = &PatternMatch{
					FieldMatches: make(map[string]MatchDetail),
				}
				matches[patIdx] = pm
				matchedCount++
			}

			md := pm.FieldMatches[field]
			if md.FieldLength == 0 {
				md.FieldLength = fieldLen
			} else if md.FieldLength != fieldLen {
				md.FieldLength = fieldLen
			}
			md.Count++
			md.Positions = append(md.Positions, start)
			pm.FieldMatches[field] = md

			pm.TotalOcc++

			// Segment mask exactly like existing verifier.
			segIdx := (start * 32) / fieldLen
			if segIdx >= 32 {
				segIdx = 31
			}
			pm.SegmentMask |= (1 << segIdx)
		}
	}

	if matchedCount == 0 {
		return nil, 0
	}
	return matches, matchedCount
}
