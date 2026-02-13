package qgram

import (
	"sort"
	"testing"
)

func TestGeneratePrunedCandidates(t *testing.T) {
	idx := NewQGramIndex(3)

	// Documents with varying lengths and term frequencies
	// doc1: "apple apple apple" (high TF, short len -> High Score)
	idx.IndexDocument("doc1", map[string]string{"body": "apple apple apple"})

	// doc2: "apple banana cherry date elderberry fig grape honeydew" (low TF (1), long len -> Low Score for apple)
	idx.IndexDocument("doc2", map[string]string{"body": "apple banana cherry date elderberry fig grape honeydew"})

	// doc3: "banana banana" (no match for apple)
	idx.IndexDocument("doc3", map[string]string{"body": "banana banana"})

	clauses := []Clause{{Pattern: "apple", Type: TermClause}}
	config := DefaultSearchConfig()

	// Case 1: No limit (should return both matches)
	candidates := idx.GeneratePrunedCandidates(clauses, config, 0)

	if len(candidates) != 2 {
		t.Fatalf("Expected 2 candidates, got %d", len(candidates))
	}

	// Check UpperBound Scores
	// doc1 should have higher upper bound than doc2 because of TF and Len
	// Wait, UpperBound depends on the PATTERN (clause) MaxScore, not the individual candidate's score?
	// Ah, WAND GeneratePrunedCandidates calculates `MaxScore` for the ITERATOR (Clause).
	// So ALL candidates from the "apple" iterator will have the SAME UpperBound?
	// Yes: `iterators = append(iterators, NewPatternIterator(docs, maxScore))`
	// `maxScore` is the Max Possible Score for that pattern across ANY document.
	// So `Candidate{DocID: "doc1", UpperBound: X}` and `Candidate{DocID: "doc2", UpperBound: X}`.
	// Both come from the same term.
	// This is correct for WAND: The iterator provides the upper bound for the term.
	// So `GeneratePrunedCandidates` returns sum of MaxScores of matching terms.
	// Since both match "apple" (and only "apple"), they have the same UpperBound.

	// To test differentiation, we need multiple terms.

	// Query: "apple banana"
	// doc1: apple (no banana)
	// doc2: apple + banana
	// doc3: banana (no apple)

	clauses2 := []Clause{
		{Pattern: "apple", Type: TermClause},
		{Pattern: "banana", Type: TermClause},
	}

	candidates2 := idx.GeneratePrunedCandidates(clauses2, config, 10)

	// Map to check scores
	scores := make(map[string]float64)
	for _, c := range candidates2 {
		scores[c.DocID] = c.UpperBound
	}

	// doc2 has both terms -> Score ~ Max(Apple) + Max(Banana)
	// doc1 has apple -> Score ~ Max(Apple)
	// doc3 has banana -> Score ~ Max(Banana)

	if scores["doc2"] <= scores["doc1"] {
		t.Errorf("Doc2 (both) should have higher bound than Doc1 (apple): %v vs %v", scores["doc2"], scores["doc1"])
	}
	if scores["doc2"] <= scores["doc3"] {
		t.Errorf("Doc2 (both) should have higher bound than Doc3 (banana): %v vs %v", scores["doc2"], scores["doc3"])
	}

	// Check if sorted properly (descending)
	sort.Slice(candidates2, func(i, j int) bool {
		return candidates2[i].UpperBound > candidates2[j].UpperBound
	})

	if candidates2[0].DocID != "doc2" {
		t.Errorf("Expected doc2 to be top candidate, got %s", candidates2[0].DocID)
	}
}
