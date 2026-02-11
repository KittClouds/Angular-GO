package qgram

import (
	"reflect"
	"sort"
	"testing"
)

func TestGenerateCandidates(t *testing.T) {
	idx := NewQGramIndex(3)

	// Doc 1: "hello world"
	idx.IndexDocument("doc1", map[string]string{"body": "hello world"})
	// Doc 2: "hello kitty"
	idx.IndexDocument("doc2", map[string]string{"body": "hello kitty"})
	// Doc 3: "world peace"
	idx.IndexDocument("doc3", map[string]string{"body": "world peace"})

	// Query: "hello"
	// Candidates: doc1, doc2
	clauses := []Clause{{Pattern: "hello", Type: TermClause}}
	cands := idx.GenerateCandidates(clauses)

	if len(cands) != 2 {
		t.Errorf("Expected 2 candidates for 'hello', got %d", len(cands))
	}
	if !cands["doc1"] || !cands["doc2"] {
		t.Errorf("Expected doc1 and doc2, got %v", cands)
	}

	// Query: "world"
	// Candidates: doc1, doc3
	clauses = []Clause{{Pattern: "world", Type: TermClause}}
	cands = idx.GenerateCandidates(clauses)
	if len(cands) != 2 {
		t.Errorf("Expected 2 candidates for 'world', got %d", len(cands))
	}
	if !cands["doc1"] || !cands["doc3"] {
		t.Errorf("Expected doc1 and doc3, got %v", cands)
	}

	// Query: "hello" AND "world"
	// With union: candidates = doc1 (both), doc2 (hello), doc3 (world) = 3
	// Scoring handles soft-AND via Coverage multiplier.
	clauses = []Clause{
		{Pattern: "hello", Type: TermClause},
		{Pattern: "world", Type: TermClause},
	}
	cands = idx.GenerateCandidates(clauses)
	if len(cands) != 3 {
		t.Errorf("Expected 3 candidates (union) for 'hello'+'world', got %d", len(cands))
	}

	// Query: "peace" (unique to doc3)
	clauses = []Clause{{Pattern: "peace", Type: TermClause}}
	cands = idx.GenerateCandidates(clauses)
	if len(cands) != 1 || !cands["doc3"] {
		t.Errorf("Expected doc3 for 'peace', got %v", cands)
	}

	// Query: "z" (short pattern len 1 < Q)
	// Fallback to ALL docs
	clauses = []Clause{{Pattern: "z", Type: TermClause}}
	cands = idx.GenerateCandidates(clauses)
	if len(cands) != 3 {
		t.Errorf("Expected all 3 docs for short pattern 'z', got %d", len(cands))
	}
}

func TestIntersect(t *testing.T) {
	a := []string{"1", "2", "3"}
	b := []string{"2", "3", "4"}

	res := intersect(a, b)
	sort.Strings(res)

	expected := []string{"2", "3"}
	if !reflect.DeepEqual(res, expected) {
		t.Errorf("Expected %v, got %v", expected, res)
	}
}
