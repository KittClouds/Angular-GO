package gdr

import (
	"sort"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// GateResult represents the result of lexical gate computation.
type GateResult struct {
	Allowed    *roaring.Bitmap // Bitmap of allowed docIDs
	ClauseHits []int           // Number of candidates per clause
	TotalGrams int             // Total grams used for gating
}

// BuildGateBitmap creates a bitmap of candidate document IDs using lexical q-gram intersection.
// This implements the "lexical gate" for hard hybrid search - only documents in this bitmap
// are eligible for vector search.
//
// The algorithm:
// 1. For each clause, extract selective grams using AdaptiveGramSelection
// 2. Intersect grams within each clause (AND)
// 3. OR clause bitmaps together (multi-clause = union for recall)
// 4. Apply lazy delete filter (AndNot Deleted bitmap)
func (gdr *GateDrivenRetriever) BuildGateBitmap(clauses []qgram.Clause, maxCandidates int) *GateResult {
	if len(clauses) == 0 {
		return &GateResult{
			Allowed:    roaring.New(),
			ClauseHits: []int{},
			TotalGrams: 0,
		}
	}

	clauseBitmaps := make([]*roaring.Bitmap, 0, len(clauses))
	clauseHits := make([]int, len(clauses))
	totalGrams := 0

	for i, clause := range clauses {
		// Use AdaptiveGramSelection to get selective grams
		grams := gdr.Lex.AdaptiveGramSelection(clause.Pattern, maxCandidates)
		if len(grams) == 0 {
			// Clause cannot match any documents
			clauseHits[i] = 0
			continue
		}
		totalGrams += len(grams)

		// Intersect grams for this clause
		var clauseBM *roaring.Bitmap
		for _, gram := range grams {
			postings := gdr.Lex.GramPostings[gram]
			if postings == nil {
				// Gram not found - clause cannot match
				clauseBM = nil
				break
			}
			if clauseBM == nil {
				clauseBM = postings.DocIDs.Clone()
			} else {
				clauseBM.And(postings.DocIDs)
			}
			if clauseBM.IsEmpty() {
				break // Early termination
			}
		}

		if clauseBM != nil && !clauseBM.IsEmpty() {
			clauseBitmaps = append(clauseBitmaps, clauseBM)
			clauseHits[i] = int(clauseBM.GetCardinality())
		}
	}

	// OR across clauses (multi-clause = union for recall)
	result := roaring.New()
	for _, bm := range clauseBitmaps {
		result.Or(bm)
	}

	// Apply lazy delete filter (AndNot is SIMD-optimized)
	if !gdr.Lex.Deleted.IsEmpty() {
		result.AndNot(gdr.Lex.Deleted)
	}

	return &GateResult{
		Allowed:    result,
		ClauseHits: clauseHits,
		TotalGrams: totalGrams,
	}
}

// BuildGateBitmapSelective creates a gate bitmap using only the most selective gram per clause.
// This is useful when the full gate would be too large.
func (gdr *GateDrivenRetriever) BuildGateBitmapSelective(clauses []qgram.Clause, maxCandidates int) *GateResult {
	if len(clauses) == 0 {
		return &GateResult{
			Allowed:    roaring.New(),
			ClauseHits: []int{},
			TotalGrams: 0,
		}
	}

	clauseBitmaps := make([]*roaring.Bitmap, 0, len(clauses))
	clauseHits := make([]int, len(clauses))
	totalGrams := 0

	for i, clause := range clauses {
		// Get all grams for this clause
		grams := qgram.ExtractGrams(clause.Pattern, gdr.Lex.Q)
		if len(grams) == 0 {
			clauseHits[i] = 0
			continue
		}

		// Find the most selective gram (smallest posting list)
		type gramCard struct {
			gram string
			card uint64
		}
		cards := make([]gramCard, 0, len(grams))
		for _, g := range grams {
			if p, ok := gdr.Lex.GramPostings[g]; ok {
				cards = append(cards, gramCard{gram: g, card: p.DocIDs.GetCardinality()})
			}
		}

		if len(cards) == 0 {
			// No grams found - clause cannot match
			clauseHits[i] = 0
			continue
		}

		// Sort by cardinality (smallest first)
		sort.Slice(cards, func(i, j int) bool {
			return cards[i].card < cards[j].card
		})

		// Use only the most selective gram
		mostSelective := cards[0]
		totalGrams++

		postings := gdr.Lex.GramPostings[mostSelective.gram]
		if postings != nil {
			clauseBM := postings.DocIDs.Clone()
			clauseBitmaps = append(clauseBitmaps, clauseBM)
			clauseHits[i] = int(mostSelective.card)
		}
	}

	// OR across clauses
	result := roaring.New()
	for _, bm := range clauseBitmaps {
		result.Or(bm)
	}

	// Apply lazy delete filter
	if !gdr.Lex.Deleted.IsEmpty() {
		result.AndNot(gdr.Lex.Deleted)
	}

	return &GateResult{
		Allowed:    result,
		ClauseHits: clauseHits,
		TotalGrams: totalGrams,
	}
}

// GateSize returns the number of candidates in the gate bitmap.
func (gr *GateResult) GateSize() uint64 {
	return gr.Allowed.GetCardinality()
}

// IsEmpty returns true if the gate has no candidates.
func (gr *GateResult) IsEmpty() bool {
	return gr.Allowed.IsEmpty()
}

// Contains checks if a docID is in the gate bitmap.
func (gr *GateResult) Contains(uid uint32) bool {
	return gr.Allowed.Contains(uid)
}

// Iterator returns an iterator over the gate bitmap.
func (gr *GateResult) Iterator() roaring.IntPeekable {
	return gr.Allowed.Iterator()
}

// ToSlice converts the gate bitmap to a slice of uint32 IDs.
// Warning: This allocates a slice proportional to gate size.
func (gr *GateResult) ToSlice() []uint32 {
	return gr.Allowed.ToArray()
}
