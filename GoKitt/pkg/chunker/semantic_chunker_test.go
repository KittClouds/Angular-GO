package chunker

import (
	"fmt"
	"math"
	"strings"
	"testing"
)

// MockEmbedder determines vector based on "topic" keywords in text.
type MockEmbedder struct{}

func (m *MockEmbedder) EmbedBatch(texts []string) ([][]float32, error) {
	vecs := make([][]float32, len(texts))
	for i, text := range texts {
		vecs[i] = m.embed(text)
	}
	return vecs, nil
}

func (m *MockEmbedder) embed(text string) []float32 {
	// Simple topic detection
	if strings.Contains(text, "apple") || strings.Contains(text, "fruit") {
		return []float32{1.0, 0.0, 0.0} // Topic A
	}
	if strings.Contains(text, "dog") || strings.Contains(text, "animal") {
		return []float32{0.0, 1.0, 0.0} // Topic B
	}
	if strings.Contains(text, "car") || strings.Contains(text, "engine") {
		return []float32{0.0, 0.0, 1.0} // Topic C
	}
	// Noise / Mixed
	return []float32{0.5, 0.5, 0.5}
}

func TestSemanticChunker_ChunkDocument(t *testing.T) {
	// Setup
	embedder := &MockEmbedder{}
	// Small constraints to force splits
	chunker := NewSemanticChunker(embedder, 10, 50, 5)

	doc := `
Apple is a fruit. Apples represent Topic A.
Dog is an animal. Dogs represent Topic B.
Car is a vehicle. Engines make loud noises.
`
	// Expected:
	// 1. "Apple... Topic A." -> Chunk 1
	// 2. "Dog... Topic B." -> Chunk 2 (Topic shift)
	// 3. "Car... noises." -> Chunk 3 (Topic shift)

	tree, err := chunker.ChunkDocument("doc1", doc)
	if err != nil {
		t.Fatalf("ChunkDocument failed: %v", err)
	}

	if len(tree.Leaves) == 0 {
		t.Fatal("Expected leaves, got 0")
	}

	// Dump chunks for debugging
	for i, c := range tree.Leaves {
		fmt.Printf("Chunk %d: %s (ID=%d)\n", i, c.Text, c.ID)
	}

	// Verify topic separation
	// We expect 3 chunks roughly corresponding to the 3 lines/topics
	// because sim(Topic A, Topic B) = 0.0 which triggers split

	// Check if we have at least 3 chunks
	if len(tree.Leaves) < 3 {
		t.Errorf("Expected at least 3 chunks for 3 distinct topics, got %d", len(tree.Leaves))
	}

	// Check content
	if !strings.Contains(tree.Leaves[0].Text, "Apple") {
		t.Error("Chunk 0 should contain Topic A")
	}
	// We might have overlap, so Chunk 1 might contain end of Chunk 0

	// Check IDs are sequential/deterministic
	if tree.Leaves[0].ID != 1 {
		t.Errorf("Expected first ID 1, got %d", tree.Leaves[0].ID)
	}
}

func TestSemanticChunker_StructureSplit(t *testing.T) {
	embedder := &MockEmbedder{}
	chunker := NewSemanticChunker(embedder, 10, 1000, 0)

	doc := "Header 1\n\nBody paragraph.\n\nHeader 2\n\nAnother body."

	// Atomic blocks should be: "Header 1", "Body paragraph.", "Header 2", "Another body."
	// Chunker should respect these if similarity is high/low.
	// Since embedder returns [0.5, 0.5, 0.5] for all (no keywords), similarity is 1.0.
	// So splits will only happen on Structure or MaxSize.
	// Our text is small, so it might merge everything if structure isn't forced.

	// DOES SemanticChunker force structure splits?
	// The implementation sets `IsNew: true` for blocks.
	// In `packChunks`: `structuralSplit := nextUnit.IsNew && currentLen >= c.MinChunkSize`
	// So if "Header 1" > 10 chars, it might split.

	tree, _ := chunker.ChunkDocument("doc2", doc)

	for i, c := range tree.Leaves {
		fmt.Printf("Struct Chunk %d: %q\n", i, c.Text)
	}
}

func TestInternalCosine(t *testing.T) {
	vc := []float32{1, 0}
	v2 := []float32{1, 0}
	if math.Abs(cosineSimilarity(vc, v2)-1.0) > 1e-6 {
		t.Error("Cos(a,a) should be 1")
	}

	v3 := []float32{0, 1}
	if math.Abs(cosineSimilarity(vc, v3)) > 1e-6 {
		t.Error("Cos(a,b) orthogonal should be 0")
	}
}
