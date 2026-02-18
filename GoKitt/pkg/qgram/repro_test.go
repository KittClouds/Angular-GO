package qgram

import (
	"reflect"
	"testing"
)

func TestReproSearchFiora(t *testing.T) {
	// 1. Create Index (Q=3)
	idx := NewQGramIndex(3)

	// 2. Index Document
	docID := "doc1"
	text := "4. Isolde vs. Fiora (The Leash and the Puppy)"
	idx.IndexDocumentScoped(docID, map[string]string{"body": text}, "", "")

	// 3. Search for "fiora"
	query := "fiora"
	config := DefaultSearchConfig()
	config.FieldWeights["body"] = 1.0

	results := idx.Search(query, config, 10)

	if len(results) == 0 {
		t.Fatalf("Search for %q failed (0 results), expected doc1", query)
	}
	if results[0].DocID != docID {
		t.Errorf("Expected docID %q, got %q", docID, results[0].DocID)
	}

	// 4. Search for "Fiora" (capitalized)
	query2 := "Fiora"
	results2 := idx.Search(query2, config, 10)
	if len(results2) == 0 {
		t.Fatalf("Search for %q failed (0 results), expected doc1", query2)
	}

	// 5. Search for "Isolde"
	query3 := "isolde"
	results3 := idx.Search(query3, config, 10)
	if len(results3) == 0 {
		t.Fatalf("Search for %q failed (0 results), expected doc1", query3)
	}
}

func TestReproCaseSensitivity(t *testing.T) {
	if NormalizeText("Fiora") != "fiora" {
		t.Errorf("NormalizeText failed: got %q, expected %q", NormalizeText("Fiora"), "fiora")
	}
}

func TestGramsExtraction(t *testing.T) {
	grams := ExtractGrams("fiora", 3)
	expected := []string{"fio", "ior", "ora"}
	if !reflect.DeepEqual(grams, expected) {
		t.Errorf("ExtractGrams(fiora) failed: got %v, want %v", grams, expected)
	}
}
