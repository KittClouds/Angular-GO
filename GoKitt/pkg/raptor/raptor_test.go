package raptor

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/gdr"
)

func TestNewRaptorIndex(t *testing.T) {
	config := DefaultRaptorConfig()
	ri := NewRaptorIndex(config)

	if ri == nil {
		t.Fatal("Expected non-nil RaptorIndex")
	}
	if ri.config.ChunkSize != 512 {
		t.Errorf("Expected ChunkSize=512, got %d", ri.config.ChunkSize)
	}
	if ri.config.Overlap != 128 {
		t.Errorf("Expected Overlap=128, got %d", ri.config.Overlap)
	}
	if ri.trees == nil {
		t.Error("Expected trees map to be initialized")
	}
	if ri.nodes == nil {
		t.Error("Expected nodes map to be initialized")
	}
}

func TestIngestDocument_LeafOnly(t *testing.T) {
	// Create RAPTOR index with GDR
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	// Simple embedding function (identity-like for testing)
	vecFn := func(text string) []float32 {
		vec := make([]float32, 64)
		for i := range text {
			if i < 64 {
				vec[i] = float32(text[i]) / 255.0
			}
		}
		return vec
	}

	// Ingest a document
	doc := "This is a test document. It has multiple sentences. We want to see how chunking works."
	tree, err := ri.IngestDocument("doc1", doc, vecFn)
	if err != nil {
		t.Fatalf("IngestDocument failed: %v", err)
	}

	if tree == nil {
		t.Fatal("Expected non-nil tree")
	}
	if tree.DocID != "doc1" {
		t.Errorf("Expected DocID=doc1, got %s", tree.DocID)
	}
	if len(tree.Leaves) == 0 {
		t.Error("Expected at least one leaf chunk")
	}

	// Verify leaves are indexed in hybrid
	for _, leafID := range tree.Leaves {
		node := tree.Nodes[leafID]
		if node == nil {
			t.Errorf("Leaf %d not found in tree nodes", leafID)
			continue
		}
		if node.Type != NodeTypeLeaf {
			t.Errorf("Expected NodeTypeLeaf, got %d", node.Type)
		}
		if node.Text == "" {
			t.Error("Expected non-empty text for leaf")
		}
	}
}

func TestIngestDocument_MultipleChunks(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	config := DefaultRaptorConfig()
	config.ChunkSize = 100 // Small chunks
	config.Overlap = 20
	ri := NewRaptorIndexWithGDR(config, retriever)

	// Long document that should produce multiple chunks
	doc := ""
	for i := 0; i < 50; i++ {
		doc += "This is sentence number " + intToStr(i) + ". "
	}

	vecFn := func(text string) []float32 {
		return make([]float32, 64)
	}

	tree, err := ri.IngestDocument("longdoc", doc, vecFn)
	if err != nil {
		t.Fatalf("IngestDocument failed: %v", err)
	}

	if len(tree.Leaves) < 2 {
		t.Errorf("Expected multiple leaf chunks, got %d", len(tree.Leaves))
	}

	// Verify all leaves have valid offsets
	for _, leafID := range tree.Leaves {
		node := tree.Nodes[leafID]
		if node.Start < 0 || node.End <= node.Start {
			t.Errorf("Invalid offsets: start=%d, end=%d", node.Start, node.End)
		}
		if node.End > len(doc) {
			t.Errorf("End offset %d exceeds doc length %d", node.End, len(doc))
		}
	}
}

func TestSearch_LeafOnly(t *testing.T) {
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

	// Ingest documents
	docs := []struct {
		id   string
		text string
	}{
		{"doc1", "The quick brown fox jumps over the lazy dog."},
		{"doc2", "Machine learning is a subset of artificial intelligence."},
		{"doc3", "The fox is a clever animal that lives in forests."},
	}

	for _, d := range docs {
		ri.IngestDocument(d.id, d.text, vecFn)
	}

	// Search for "fox"
	queryVec := make([]float32, 64)
	queryVec[0] = float32('f') / 255.0
	queryVec[1] = float32('o') / 255.0
	queryVec[2] = float32('x') / 255.0

	results := ri.Search("fox", queryVec, 10)

	// Should find results from doc1 and doc3
	if len(results) == 0 {
		t.Error("Expected search results for 'fox'")
	}
}

func TestGetTree(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	vecFn := func(text string) []float32 {
		return make([]float32, 64)
	}

	ri.IngestDocument("doc1", "Test document.", vecFn)

	tree := ri.GetTree("doc1")
	if tree == nil {
		t.Fatal("Expected non-nil tree for doc1")
	}
	if tree.DocID != "doc1" {
		t.Errorf("Expected DocID=doc1, got %s", tree.DocID)
	}

	// Non-existent doc
	tree = ri.GetTree("nonexistent")
	if tree != nil {
		t.Error("Expected nil tree for non-existent doc")
	}
}

func TestGetNode(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	vecFn := func(text string) []float32 {
		return make([]float32, 64)
	}

	tree, _ := ri.IngestDocument("doc1", "Test document with some content.", vecFn)

	if len(tree.Leaves) == 0 {
		t.Fatal("Expected at least one leaf")
	}

	leafID := tree.Leaves[0]
	node := ri.GetNode(leafID)
	if node == nil {
		t.Fatalf("Expected non-nil node for ID %d", leafID)
	}
	if node.DocID != "doc1" {
		t.Errorf("Expected DocID=doc1, got %s", node.DocID)
	}
}

func TestLeafCount(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	config := DefaultRaptorConfig()
	config.ChunkSize = 50
	ri := NewRaptorIndexWithGDR(config, retriever)

	vecFn := func(text string) []float32 {
		return make([]float32, 64)
	}

	ri.IngestDocument("doc1", "Short doc.", vecFn)
	ri.IngestDocument("doc2", "Another short document.", vecFn)

	count := ri.LeafCount()
	if count == 0 {
		t.Error("Expected non-zero leaf count")
	}
}

func TestDocCount(t *testing.T) {
	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(DefaultRaptorConfig(), retriever)

	vecFn := func(text string) []float32 {
		return make([]float32, 64)
	}

	if ri.DocCount() != 0 {
		t.Error("Expected 0 docs initially")
	}

	ri.IngestDocument("doc1", "Test.", vecFn)
	if ri.DocCount() != 1 {
		t.Errorf("Expected 1 doc, got %d", ri.DocCount())
	}

	ri.IngestDocument("doc2", "Another test.", vecFn)
	if ri.DocCount() != 2 {
		t.Errorf("Expected 2 docs, got %d", ri.DocCount())
	}
}

func TestParseChunkKey(t *testing.T) {
	tests := []struct {
		key       string
		wantDoc   string
		wantStart int
		wantEnd   int
	}{
		{"chunk:doc1:0:100", "doc1", 0, 100},
		{"chunk:mydoc:50:150", "mydoc", 50, 150},
		{"chunk:test:0:50", "test", 0, 50},
	}

	for _, tt := range tests {
		docID, start, end := parseChunkKey(tt.key)
		if docID != tt.wantDoc {
			t.Errorf("parseChunkKey(%q) docID = %q, want %q", tt.key, docID, tt.wantDoc)
		}
		if start != tt.wantStart {
			t.Errorf("parseChunkKey(%q) start = %d, want %d", tt.key, start, tt.wantStart)
		}
		if end != tt.wantEnd {
			t.Errorf("parseChunkKey(%q) end = %d, want %d", tt.key, end, tt.wantEnd)
		}
	}
}

func TestParseChunkKey_Invalid(t *testing.T) {
	invalidKeys := []string{
		"",
		"notachunk",
		"chunk:onlytwo",
		"prefix:doc:0:100",
	}

	for _, key := range invalidKeys {
		docID, start, end := parseChunkKey(key)
		if docID != "" || start != 0 || end != 0 {
			t.Errorf("parseChunkKey(%q) should return zeros for invalid key", key)
		}
	}
}

func TestIntToStr(t *testing.T) {
	tests := []struct {
		n    int
		want string
	}{
		{0, "0"},
		{1, "1"},
		{123, "123"},
		{9999, "9999"},
	}

	for _, tt := range tests {
		got := intToStr(tt.n)
		if got != tt.want {
			t.Errorf("intToStr(%d) = %q, want %q", tt.n, got, tt.want)
		}
	}
}
