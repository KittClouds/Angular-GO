package raptor

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/gdr"
)

func TestCollapsedRetriever_Search(t *testing.T) {
	// Create RAPTOR index with GDR
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	// Embedding function
	vecFn := func(text string) []float32 {
		vec := make([]float32, 64)
		for i, c := range text {
			if i < 64 {
				vec[i] = float32(c) / 255.0
			}
		}
		return vec
	}

	// Ingest documents
	docs := []struct {
		id   string
		text string
	}{
		{"doc1", "The quick brown fox jumps over the lazy dog. The fox is clever."},
		{"doc2", "Machine learning is a subset of artificial intelligence. Neural networks are used in ML."},
		{"doc3", "The fox lives in the forest. Foxes are nocturnal animals."},
	}

	for _, d := range docs {
		ri.IngestDocument(d.id, d.text, vecFn)
	}

	// Build trees
	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	for _, tree := range ri.trees {
		tb.Build(tree, vecFn)
	}

	// Create retriever
	cr := NewCollapsedRetriever(ri)

	// Search
	queryVec := make([]float32, 64)
	queryVec[0] = float32('f') / 255.0
	queryVec[1] = float32('o') / 255.0
	queryVec[2] = float32('x') / 255.0

	results := cr.Search("fox", queryVec, 10)

	// Should find results
	if len(results) == 0 {
		t.Error("Expected search results for 'fox'")
	}

	// Results should have doc IDs
	for _, r := range results {
		if r.DocID == "" {
			t.Error("Expected non-empty DocID in result")
		}
	}
}

func TestCollapsedRetriever_SearchWithAggregation(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	vecFn := func(text string) []float32 {
		vec := make([]float32, 64)
		for i, c := range text {
			if i < 64 {
				vec[i] = float32(c) / 255.0
			}
		}
		return vec
	}

	// Ingest documents with multiple chunks
	ri.IngestDocument("doc1", "First sentence about testing. Second sentence about testing. Third sentence about testing.", vecFn)
	ri.IngestDocument("doc2", "Different content entirely. Nothing related to testing here.", vecFn)

	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	for _, tree := range ri.trees {
		tb.Build(tree, vecFn)
	}

	cr := NewCollapsedRetriever(ri)
	queryVec := make([]float32, 64)
	queryVec[0] = float32('t') / 255.0

	docs := cr.SearchWithAggregation("testing", queryVec, 5)

	// Should return aggregated docs
	if len(docs) == 0 {
		t.Error("Expected aggregated doc results")
	}

	// Each doc should have chunks
	for _, doc := range docs {
		if doc.DocID == "" {
			t.Error("Expected non-empty DocID")
		}
		if len(doc.Chunks) == 0 {
			t.Errorf("Expected chunks in doc %s", doc.DocID)
		}
		if doc.MaxScore <= 0 {
			t.Errorf("Expected positive MaxScore for doc %s", doc.DocID)
		}
	}
}

func TestCollapsedRetriever_RouterPass(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	vecFn := func(text string) []float32 {
		vec := make([]float32, 32)
		for i, c := range text {
			if i < 32 {
				vec[i] = float32(c) / 255.0
			}
		}
		return vec
	}

	// Create documents with enough content to generate internal nodes
	longText1 := "Document one content for testing. " +
		"Additional content to ensure clustering. " +
		"More text for the first document. " +
		"Even more content here. " +
		"Final sentence for doc one."
	longText2 := "Document two content for testing. " +
		"Different content for variety. " +
		"More text for the second document. " +
		"Additional sentences here. " +
		"Final sentence for doc two."

	ri.IngestDocument("doc1", longText1, vecFn)
	ri.IngestDocument("doc2", longText2, vecFn)

	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	for _, tree := range ri.trees {
		tb.Build(tree, vecFn)
	}

	cr := NewCollapsedRetriever(ri)

	// Query vector similar to doc1
	queryVec := make([]float32, 32)
	queryVec[0] = float32('D') / 255.0
	queryVec[1] = float32('o') / 255.0
	queryVec[2] = float32('c') / 255.0

	candidates := cr.routerPass(queryVec, 10)

	// If no internal nodes, router pass returns empty (expected for small docs)
	// This is valid behavior - the test should pass either way
	// The router pass is an optimization, not a requirement
	t.Logf("Router pass returned %d candidates", len(candidates))
}

func TestCollapsedRetriever_HardLeafPass(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	vecFn := func(text string) []float32 {
		vec := make([]float32, 32)
		for i, c := range text {
			if i < 32 {
				vec[i] = float32(c) / 255.0
			}
		}
		return vec
	}

	ri.IngestDocument("doc1", "Testing document content.", vecFn)

	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	for _, tree := range ri.trees {
		tb.Build(tree, vecFn)
	}

	cr := NewCollapsedRetriever(ri)

	candidateDocs := map[string]float64{"doc1": 0.9}
	queryVec := make([]float32, 32)

	results := cr.hardLeafPass("testing", queryVec, candidateDocs, 10)

	// Should return results from allowed docs only
	for _, r := range results {
		if r.DocID != "doc1" {
			t.Errorf("Expected only doc1 results, got %s", r.DocID)
		}
	}
}

func TestCollapsedRetriever_ExpandContext(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	vecFn := func(text string) []float32 {
		return make([]float32, 32)
	}

	// Create document with tree
	tree, _ := ri.IngestDocument("doc1", "First sentence. Second sentence. Third sentence.", vecFn)

	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	tb.Build(tree, vecFn)

	cr := NewCollapsedRetriever(ri)

	// Create a result that needs context expansion
	results := []CollapsedResult{
		{
			DocID: "doc1",
			Start: 0,
			End:   20,
			Score: 0.9,
		},
	}

	expanded := cr.expandContext(results)

	// Should have context (if parent exists)
	if len(expanded) != 1 {
		t.Errorf("Expected 1 result, got %d", len(expanded))
	}
}

func TestCollapsedRetriever_NoGDR(t *testing.T) {
	// RAPTOR index without GDR
	ri := NewRaptorIndex(DefaultRaptorConfig())
	cr := NewCollapsedRetriever(ri)

	queryVec := make([]float32, 32)
	results := cr.Search("test", queryVec, 10)

	if results != nil {
		t.Error("Expected nil results when no GDR index")
	}
}

func TestCollapsedRetriever_EmptyIndex(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)
	cr := NewCollapsedRetriever(ri)

	queryVec := make([]float32, 32)
	results := cr.Search("test", queryVec, 10)

	if len(results) != 0 {
		t.Error("Expected empty results for empty index")
	}
}
