package qgram

import (
	"reflect"
	"testing"
)

func TestVerifyCandidate(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{"body": "banana band"})

	// True Positive: "ana"
	// "banana" -> "ana" at 1, "ana" at 3?
	// b a n a n a
	// 0 1 2 3 4 5
	// ana at 1: b [ana] na
	// ana at 3: ban [ana]
	// Should find 2 positions.

	clause := Clause{Pattern: "ana", Type: TermClause}
	match := idx.VerifyCandidate("doc1", clause)

	if match == nil {
		t.Fatal("Expected match for 'ana', got nil")
	}
	if match.TotalOcc != 2 {
		t.Errorf("Expected 2 occurrences, got %d", match.TotalOcc)
	}

	if match.FieldMatches["body"].Count != 2 {
		t.Errorf("Expected body count 2, got %d", match.FieldMatches["body"].Count)
	}

	// False Positive (if we had grams but no exact match)
	// Hard to simulate with exact substring index unless collision?
	// Example: "ab" and "bc" vs "abc".
	// Doc: "ab ... bc". Grams "ab", "bc".
	// Query "abc".
	// Short pattern "abc" (len 3) -> requires gram "abc".
	// If Doc has "ab" and "bc", but not "abc".
	// Wait, "abc" trigram only matches "abc".
	// So false positives only happen with *hash* collisions if using hashes, OR if multiple grams match separately but not contiguously.
	// But `GenerateCandidates` intersects postings.
	// If query is "abcde" (grams: abc, bcd, cde).
	// Doc has "abc ... cde". Missing "bcd". Intersection fails.
	// So pure AND logic is strong.
	// Verify is mostly needed for:
	// 1. Short pattern fallback (scan all docs).
	// 2. Ensuring grams are in correct order/adjacency if we only intersect sets.
	// Wait, Aho-Corasick intersection approach:
	// Just intersecting set(grams) doesn't guarantee order.
	// e.g. "dogcat" has "dog", "ogc", "gca", "cat".
	// Doc "catdog" has "cat", "dog". Not "ogc".
	// So intersection is robust IF we have all grams.
	// But if we miss a gram (e.g. Stopwords? No stopwords here).
	// But `Verify` is crucial for scoring (exact counts) and segment masks anyway.

	// Let's test non-match: "bandana"
	// "band" is in doc. "banana" is in doc.
	// "bandana" -> ban, and, nda, dan, ana.
	// Doc has "ban" (banana), "and" (band).
	// Missing "nda", "dan".
	// So Candidate generation would likely filter it out if we check all grams.

	// Let's test short pattern fallback.
	// Query "z" (not in doc)
	clauseZ := Clause{Pattern: "z", Type: TermClause}
	matchZ := idx.VerifyCandidate("doc1", clauseZ)
	if matchZ != nil {
		t.Errorf("Expected nil for 'z', got match")
	}
}

func TestFindPositions(t *testing.T) {
	// Overlapping
	pos := findPositions("banana", "ana")
	expected := []int{1, 3} // b a n a n a -> indices 1, 3
	if !reflect.DeepEqual(pos, expected) {
		t.Errorf("Expected %v, got %v", expected, pos)
	}

	// No match
	pos = findPositions("hello", "z")
	if len(pos) != 0 {
		t.Errorf("Expected empty, got %v", pos)
	}
}
