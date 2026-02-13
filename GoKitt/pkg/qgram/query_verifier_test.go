package qgram

import (
	"reflect"
	"testing"
)

func TestNewQueryVerifier(t *testing.T) {
	clauses := []Clause{
		{Pattern: "ana", Type: TermClause},
		{Pattern: "band", Type: TermClause},
		{Pattern: "cat", Type: PhraseClause},
	}

	qv := NewQueryVerifier(clauses)

	if len(qv.Clauses) != 3 {
		t.Errorf("Expected 3 clauses, got %d", len(qv.Clauses))
	}

	if qv.AC.PatternCount() != 3 {
		t.Errorf("Expected AC pattern count 3, got %d", qv.AC.PatternCount())
	}
}

func TestNewQueryVerifierEmpty(t *testing.T) {
	qv := NewQueryVerifier(nil)
	if len(qv.Clauses) != 0 {
		t.Errorf("Expected 0 clauses for nil input, got %d", len(qv.Clauses))
	}

	qv2 := NewQueryVerifier([]Clause{})
	if len(qv2.Clauses) != 0 {
		t.Errorf("Expected 0 clauses for empty slice, got %d", len(qv2.Clauses))
	}
}

func TestVerifyCandidateAll(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{
		"title": "banana band",
		"body":  "the banana band plays music",
	})

	clauses := []Clause{
		{Pattern: "ana", Type: TermClause},   // matches in both fields
		{Pattern: "band", Type: TermClause},  // matches in both fields
		{Pattern: "cat", Type: PhraseClause}, // no match
		{Pattern: "music", Type: TermClause}, // matches in body only
	}

	qv := NewQueryVerifier(clauses)
	matches, matchedCount := idx.VerifyCandidateAll("doc1", &qv)

	if matchedCount != 3 {
		t.Errorf("Expected matchedCount 3, got %d", matchedCount)
	}

	// Check "ana" match (pattern index 0)
	if matches[0] == nil {
		t.Fatal("Expected match for 'ana', got nil")
	}
	if matches[0].TotalOcc != 4 { // 2 in title + 2 in body
		t.Errorf("Expected 4 total occurrences for 'ana', got %d", matches[0].TotalOcc)
	}
	if matches[0].FieldMatches["title"].Count != 2 {
		t.Errorf("Expected title count 2 for 'ana', got %d", matches[0].FieldMatches["title"].Count)
	}
	if matches[0].FieldMatches["body"].Count != 2 {
		t.Errorf("Expected body count 2 for 'ana', got %d", matches[0].FieldMatches["body"].Count)
	}

	// Check "band" match (pattern index 1)
	if matches[1] == nil {
		t.Fatal("Expected match for 'band', got nil")
	}
	if matches[1].TotalOcc != 2 { // 1 in title + 1 in body
		t.Errorf("Expected 2 total occurrences for 'band', got %d", matches[1].TotalOcc)
	}

	// Check "cat" no match (pattern index 2)
	if matches[2] != nil {
		t.Errorf("Expected nil for 'cat', got match")
	}

	// Check "music" match (pattern index 3)
	if matches[3] == nil {
		t.Fatal("Expected match for 'music', got nil")
	}
	if matches[3].TotalOcc != 1 {
		t.Errorf("Expected 1 occurrence for 'music', got %d", matches[3].TotalOcc)
	}
	if _, ok := matches[3].FieldMatches["body"]; !ok {
		t.Error("Expected 'music' to match in body field")
	}
	if _, ok := matches[3].FieldMatches["title"]; ok {
		t.Error("Expected 'music' NOT to match in title field")
	}
}

func TestVerifyCandidateAllOverlapping(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{
		"body": "banana", // "ana" appears at positions 1 and 3 (overlapping)
	})

	clauses := []Clause{
		{Pattern: "ana", Type: TermClause},
	}

	qv := NewQueryVerifier(clauses)
	matches, matchedCount := idx.VerifyCandidateAll("doc1", &qv)

	if matchedCount != 1 {
		t.Errorf("Expected matchedCount 1, got %d", matchedCount)
	}

	if matches[0] == nil {
		t.Fatal("Expected match for 'ana', got nil")
	}

	// Check overlapping positions: b a n a n a
	//                              0 1 2 3 4 5
	// "ana" at 1: b [ana] na
	// "ana" at 3: ban [ana]
	expectedPositions := []int{1, 3}
	actualPositions := matches[0].FieldMatches["body"].Positions
	if !reflect.DeepEqual(actualPositions, expectedPositions) {
		t.Errorf("Expected positions %v, got %v", expectedPositions, actualPositions)
	}
}

func TestVerifyCandidateAllSegmentMask(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{
		"body": "xxx cat xxx cat xxx", // "cat" appears twice
	})

	clauses := []Clause{
		{Pattern: "cat", Type: TermClause},
	}

	qv := NewQueryVerifier(clauses)
	matches, matchedCount := idx.VerifyCandidateAll("doc1", &qv)

	if matchedCount != 1 {
		t.Errorf("Expected matchedCount 1, got %d", matchedCount)
	}

	if matches[0] == nil {
		t.Fatal("Expected match for 'cat', got nil")
	}

	// Segment mask should have bits set for positions where "cat" appears
	if matches[0].SegmentMask == 0 {
		t.Error("Expected non-zero segment mask")
	}
}

func TestVerifyCandidateAllNoMatch(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{
		"body": "hello world",
	})

	clauses := []Clause{
		{Pattern: "cat", Type: TermClause},
		{Pattern: "dog", Type: TermClause},
	}

	qv := NewQueryVerifier(clauses)
	matches, matchedCount := idx.VerifyCandidateAll("doc1", &qv)

	if matchedCount != 0 {
		t.Errorf("Expected matchedCount 0, got %d", matchedCount)
	}

	if matches != nil {
		t.Errorf("Expected nil matches, got %v", matches)
	}
}

func TestVerifyCandidateAllDocNotFound(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{"body": "hello"})

	clauses := []Clause{
		{Pattern: "hello", Type: TermClause},
	}

	qv := NewQueryVerifier(clauses)
	matches, matchedCount := idx.VerifyCandidateAll("nonexistent", &qv)

	if matchedCount != 0 {
		t.Errorf("Expected matchedCount 0 for nonexistent doc, got %d", matchedCount)
	}

	if matches != nil {
		t.Errorf("Expected nil matches for nonexistent doc, got %v", matches)
	}
}

func TestVerifyCandidateAllEmptyFields(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{
		"title": "",
		"body":  "",
	})

	clauses := []Clause{
		{Pattern: "cat", Type: TermClause},
	}

	qv := NewQueryVerifier(clauses)
	_, matchedCount := idx.VerifyCandidateAll("doc1", &qv)

	if matchedCount != 0 {
		t.Errorf("Expected matchedCount 0 for empty fields, got %d", matchedCount)
	}
}

func TestVerifyCandidateAllMultipleFields(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{
		"title":   "cat story",
		"body":    "the cat sat on the mat",
		"summary": "a cat tale",
	})

	clauses := []Clause{
		{Pattern: "cat", Type: TermClause},
	}

	qv := NewQueryVerifier(clauses)
	matches, matchedCount := idx.VerifyCandidateAll("doc1", &qv)

	if matchedCount != 1 {
		t.Errorf("Expected matchedCount 1, got %d", matchedCount)
	}

	if matches[0] == nil {
		t.Fatal("Expected match for 'cat', got nil")
	}

	// Should match in all 3 fields
	if len(matches[0].FieldMatches) != 3 {
		t.Errorf("Expected 3 field matches, got %d", len(matches[0].FieldMatches))
	}

	// Total occurrences: 1 in title + 1 in body + 1 in summary = 3
	if matches[0].TotalOcc != 3 {
		t.Errorf("Expected 3 total occurrences, got %d", matches[0].TotalOcc)
	}
}

func TestVerifyCandidateAllEquivalence(t *testing.T) {
	// Test that VerifyCandidateAll produces same results as individual VerifyCandidate calls
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{
		"title": "banana band cat",
		"body":  "the banana band plays cat music",
	})

	clauses := []Clause{
		{Pattern: "ana", Type: TermClause},
		{Pattern: "band", Type: TermClause},
		{Pattern: "cat", Type: PhraseClause},
		{Pattern: "music", Type: TermClause},
		{Pattern: "nonexistent", Type: TermClause},
	}

	// Get results from VerifyCandidateAll
	qv := NewQueryVerifier(clauses)
	allMatches, allCount := idx.VerifyCandidateAll("doc1", &qv)
	_ = allMatches // used for comparison below

	// Get results from individual VerifyCandidate calls
	var individualMatches []*PatternMatch
	individualCount := 0
	for _, clause := range clauses {
		m := idx.VerifyCandidate("doc1", clause)
		individualMatches = append(individualMatches, m)
		if m != nil {
			individualCount++
		}
	}

	// Compare counts
	if allCount != individualCount {
		t.Errorf("Count mismatch: VerifyCandidateAll=%d, individual=%d", allCount, individualCount)
	}

	// Compare each match
	for i := range clauses {
		all := allMatches[i]
		ind := individualMatches[i]

		if all == nil && ind == nil {
			continue
		}
		if all == nil || ind == nil {
			t.Errorf("Match %d mismatch: all=%v, individual=%v", i, all, ind)
			continue
		}

		if all.TotalOcc != ind.TotalOcc {
			t.Errorf("Match %d TotalOcc mismatch: all=%d, individual=%d", i, all.TotalOcc, ind.TotalOcc)
		}

		if all.SegmentMask != ind.SegmentMask {
			t.Errorf("Match %d SegmentMask mismatch: all=%d, individual=%d", i, all.SegmentMask, ind.SegmentMask)
		}

		// Compare field matches
		for field, allDetail := range all.FieldMatches {
			indDetail, ok := ind.FieldMatches[field]
			if !ok {
				t.Errorf("Match %d field %s missing in individual", i, field)
				continue
			}
			if allDetail.Count != indDetail.Count {
				t.Errorf("Match %d field %s count mismatch: all=%d, individual=%d", i, field, allDetail.Count, indDetail.Count)
			}
			if !reflect.DeepEqual(allDetail.Positions, indDetail.Positions) {
				t.Errorf("Match %d field %s positions mismatch: all=%v, individual=%v", i, field, allDetail.Positions, indDetail.Positions)
			}
		}
	}
}
