package qgram

import (
	"reflect"
	"testing"
)

func TestExtractGrams(t *testing.T) {
	grams := ExtractGrams("hello", 3)
	expected := []string{"hel", "ell", "llo"}
	if !reflect.DeepEqual(grams, expected) {
		t.Errorf("Expected %v, got %v", expected, grams)
	}

	gramsShort := ExtractGrams("hi", 3)
	if len(gramsShort) != 0 {
		t.Errorf("Expected empty grams for short text, got %v", gramsShort)
	}
}

func TestIndexDocument(t *testing.T) {
	idx := NewQGramIndex(3)

	fields := map[string]string{
		"title": "Hello",
		"body":  "World",
	}
	idx.IndexDocument("doc1", fields)

	// Verify Stats
	stats := idx.GetCorpusStats()
	if stats.TotalDocuments != 1 {
		t.Errorf("TotalDocuments: expected 1, got %d", stats.TotalDocuments)
	}
	if stats.AverageDocLength != 10.0 { // 5 + 5
		t.Errorf("AverageDocLength: expected 10.0, got %f", stats.AverageDocLength)
	}

	// Verify Postings
	// "hello" -> "hel", "ell", "llo"
	// "world" -> "wor", "orl", "rld"

	expectedGrams := []string{"hel", "ell", "llo", "wor", "orl", "rld"}
	for _, g := range expectedGrams {
		if _, ok := idx.GramPostings[g]["doc1"]; !ok {
			t.Errorf("Missing gram %s for doc1", g)
		}
	}

	// Verify Segment Mask
	// "hel" is at index 0 of len 5. (0*32)/5 = 0. Mask bit 0.
	meta := idx.GramPostings["hel"]["doc1"]
	if meta.SegmentMask&1 == 0 {
		t.Errorf("Expected bit 0 set for 'hel', got mask %b", meta.SegmentMask)
	}

	// "rld" is at index 2 of len 5. (2*32)/5 = 12.8 -> 12. Mask bit 12.
	// Wait: "wor"(0), "orl"(1), "rld"(2).
	// W o r l d (indices 0 1 2 3 4)
	// Grams start at 0, 1, 2.
	metaRld := idx.GramPostings["rld"]["doc1"]
	// i=2. (2*32)/5 = 12.
	if (metaRld.SegmentMask & (1 << 12)) == 0 {
		t.Errorf("Expected bit 12 set for 'rld', got mask %b", metaRld.SegmentMask)
	}
}
