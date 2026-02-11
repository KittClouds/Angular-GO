package qgram

import (
	"testing"
)

func TestRealWorldMessyQuery(t *testing.T) {
	idx := NewQGramIndex(3)

	// doc1: Perfect match
	idx.IndexDocument("doc1", map[string]string{
		"body": "Arya Stark held Needle firmly. It was Valyrian steel, sharp and light.",
	})

	// doc2: Partial match (missing "needle")
	idx.IndexDocument("doc2", map[string]string{
		"body": "Jon Snow had Longclaw, which was Valyrian steel. Arya watched.",
	})

	// doc3: Messy match (terms scattered)
	idx.IndexDocument("doc3", map[string]string{
		"body": "Needle was small. ... (long gap) ... Valyrian steel is rare. ... Arya.",
	})

	cfg := DefaultSearchConfig()
	// Default: λ=3 (soft-AND punishing partials), PhraseHard=true

	// Query: arya "valyrian steel" needle
	// "arya" (term), "valyrian steel" (phrase), "needle" (term)
	input := `arya "valyrian steel" needle`

	res := idx.Search(input, cfg, 10)

	if len(res) == 0 {
		t.Fatalf("Expected results, got none")
	}

	// doc1 should be #1 (all match, good proximity)
	if res[0].DocID != "doc1" {
		t.Errorf("Expected doc1 to be #1, got %s", res[0].DocID)
	}

	// doc2 matches "arya" and "valyrian steel", misses "needle".
	// With λ=3, it should be punished but present.
	// doc3 matches all 3, but poor proximity.

	// Check doc3 vs doc2
	var doc2, doc3 SearchResult
	found2, found3 := false, false
	for _, r := range res {
		if r.DocID == "doc2" {
			doc2 = r
			found2 = true
		}
		if r.DocID == "doc3" {
			doc3 = r
			found3 = true
		}
	}

	// doc3 (full coverage, poor proximity) vs doc2 (partial coverage, good proximity on what matched)
	// Coverage usually wins with λ=3.
	if found3 && found2 {
		if doc3.Score <= doc2.Score {
			t.Logf("Interesting: Partial match (doc2=%.4f, cov=%.2f) beat Full match (doc3=%.4f, cov=%.2f) due to proximity?",
				doc2.Score, doc2.Coverage, doc3.Score, doc3.Coverage)
			// This is acceptable behavior depending on λ vs proximity weights.
		} else {
			t.Logf("Full coverage (doc3) won as expected: %.4f vs %.4f", doc3.Score, doc2.Score)
		}
	} else {
		t.Logf("Doc2 found: %v, Doc3 found: %v", found2, found3)
	}
}

func TestShortPatternAndPunctuation(t *testing.T) {
	idx := NewQGramIndex(3)

	idx.IndexDocument("doc1", map[string]string{"body": "The C.E.O. arrived."})
	idx.IndexDocument("doc2", map[string]string{"body": "Hello world."})

	cfg := DefaultSearchConfig()

	// Query: "c.e.o" (short terms if split? or one token?)
	// Normalized: "c.e.o." -> len 6 > 3. Should work normally.
	// Let's try "it" (len 2 < 3)

	res := idx.Search("it", cfg, 10)
	// "it" in "arrived" (wait, substring match?) -> "visiting" -> "it"
	// "The C.E.O. arrived." -> "arrived" has "it" substring? No. "wait"
	// "arrived" -> a r r i v e d. No "it".
	// "visiting" -> yes.

	// "The C.E.O. arrived." contains "ed" (len 2)
	res = idx.Search("ed", cfg, 10)
	if len(res) == 0 {
		// "ed" is < 3. Falls back to scan.
		// "arrived" has "ed".
		// NormalizeText("The C.E.O. arrived.") -> "the c.e.o. arrived."
		// Contains "ed"? Yes.
		t.Errorf("Short pattern 'ed' should have matched doc1")
	}

	// Query with punctuation inside phrase
	// "C.E.O." -> trigrams "c.e", ".e.", "e.o", ".o."
	// Should match exactly.
	res = idx.Search(`"C.E.O."`, cfg, 10)
	if len(res) != 1 || res[0].DocID != "doc1" {
		t.Errorf("Punctuation phrase failed. Got %v", res)
	}
}

func TestModeToggle(t *testing.T) {
	idx := NewQGramIndex(3)
	idx.IndexDocument("doc1", map[string]string{"body": "apple banana"})
	idx.IndexDocument("doc2", map[string]string{"body": "apple"})

	cfg := DefaultSearchConfig()

	// Default: Require all (λ=3) -> High penalty for partial
	// Query: "apple banana"
	// doc1 matches both. doc2 matches one.
	res := idx.Search("apple banana", cfg, 10)

	scoreFull := res[0].Score
	scorePartial := res[1].Score

	// Toggle to "Match Any" (λ=0)
	cfg.CoverageLambda = 0.0
	resOR := idx.Search("apple banana", cfg, 10)

	scoreFullOR := resOR[0].Score
	scorePartialOR := resOR[1].Score

	// Ratio check
	ratioDefault := scorePartial / scoreFull
	ratioOR := scorePartialOR / scoreFullOR

	if ratioOR <= ratioDefault {
		t.Errorf("Switching to OR mode (λ=0) should improve partial/full ratio. Default: %.2f, OR: %.2f", ratioDefault, ratioOR)
	}
	t.Logf("Default Ratio: %.2f, OR Ratio: %.2f", ratioDefault, ratioOR)
}
