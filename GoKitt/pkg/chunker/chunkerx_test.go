package chunker

import (
	"os"
	"testing"
)

// ============================================================================
// ChunkerX Tests
// ============================================================================

func TestChunkerX_Basic(t *testing.T) {
	text := "Apple is a fruit. Apples represent Topic A. Dog is an animal. Dogs represent Topic B. Car is a vehicle. Engines make loud noises."
	chunker := NewChunkerX2(50, 10)
	result := chunker.ChunkDocumentExtended("test", text)

	if len(result.Leaves) == 0 {
		t.Error("Expected some leaf chunks")
	}

	// Verify all chunks have valid IDs
	for _, chunk := range result.Leaves {
		if chunk.ID == 0 {
			t.Error("Leaf chunk has invalid ID")
		}
	}
}

func TestChunkerX_HierarchyIntegrity(t *testing.T) {
	text := "Apple is a fruit. Apples represent Topic A. Dog is an animal. Dogs represent Topic B. Car is a vehicle. Engines make loud noises."
	chunker := NewChunkerX2(50, 10)
	result := chunker.ChunkDocumentExtended("test", text)

	// Verify parent-child relationships
	for _, parent := range result.Parents {
		for _, childID := range parent.ChildIDs {
			found := false
			for _, leaf := range result.Leaves {
				if leaf.ID == childID && leaf.ParentID == parent.ID {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("Child %d not found or has wrong parent", childID)
			}
		}
	}
}

func TestChunkerX_Provenance(t *testing.T) {
	text := "Apple is a fruit. Apples represent Topic A. Dog is an animal. Dogs represent Topic B. Car is a vehicle. Engines make loud noises."
	chunker := NewChunkerX2(50, 10)
	result := chunker.ChunkDocumentExtended("test", text)

	// Verify all chunks have correct document ID
	for _, chunk := range result.Leaves {
		if chunk.DocID != "test" {
			t.Errorf("Leaf has wrong DocID: %s", chunk.DocID)
		}
	}
	for _, chunk := range result.Parents {
		if chunk.DocID != "test" {
			t.Errorf("Parent has wrong DocID: %s", chunk.DocID)
		}
	}
}

func TestChunkerX_ShortRun(t *testing.T) {
	data, err := os.ReadFile("../../../docs/shortrun.md")
	if err != nil {
		t.Skip("shortrun.md not found")
	}

	chunker := NewChunkerX2(500, 100)
	result := chunker.ChunkDocumentExtended("shortrun", string(data))

	t.Logf("ShortRun Results:")
	t.Logf("  Chapters: %d", len(result.Chapters))
	t.Logf("  Parents:  %d", len(result.Parents))
	t.Logf("  Leaves:   %d", len(result.Leaves))

	// Verify chapter detection
	if len(result.Chapters) < 5 {
		t.Errorf("Expected at least 5 chapters, got %d", len(result.Chapters))
	}

	// Print first few chapter titles
	for i := 0; i < 5 && i < len(result.Chapters); i++ {
		t.Logf("  Chapter %d: %q", i+1, result.Chapters[i].Text)
	}
}

func TestChunkerX_PerfectRun2(t *testing.T) {
	data, err := os.ReadFile("../../../docs/perfect_run2.md")
	if err != nil {
		t.Skip("perfect_run2.md not found")
	}

	chunker := NewChunkerX2(500, 100)
	result := chunker.ChunkDocumentExtended("perfectrun2", string(data))

	t.Logf("PerfectRun2 Results:")
	t.Logf("  Chapters: %d", len(result.Chapters))
	t.Logf("  Parents:  %d", len(result.Parents))
	t.Logf("  Leaves:   %d", len(result.Leaves))

	// Verify chapter detection
	if len(result.Chapters) < 100 {
		t.Errorf("Expected at least 100 chapters, got %d", len(result.Chapters))
	}

	// Print first 10 chapter titles
	t.Logf("  First 10 Chapter Titles:")
	for i := 0; i < 10 && i < len(result.Chapters); i++ {
		t.Logf("    [%d] %s", i, result.Chapters[i].Text)
	}
}

// ============================================================================
// Benchmarks
// ============================================================================

func BenchmarkChunkerX_PerfectRun2(b *testing.B) {
	data, err := os.ReadFile("../../../docs/perfect_run2.md")
	if err != nil {
		b.Skip("perfect_run2.md not found")
	}

	b.ReportMetric(float64(len(data)), "doc_bytes")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		chunker := NewChunkerX2(500, 100)
		result := chunker.ChunkDocumentExtended("perfectrun2", string(data))
		b.ReportMetric(float64(len(result.Chapters)), "chapters")
		b.ReportMetric(float64(len(result.Parents)), "parents")
		b.ReportMetric(float64(len(result.Leaves)), "leaves")
	}
}

func BenchmarkOriginalChunker_PerfectRun2(b *testing.B) {
	data, err := os.ReadFile("../../../docs/perfect_run2.md")
	if err != nil {
		b.Skip("perfect_run2.md not found")
	}

	b.ReportMetric(float64(len(data)), "doc_bytes")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		chunker := NewChunker(500, 100, nil, false, false)
		result, _ := chunker.ChunkDocument("perfectrun2", string(data))
		b.ReportMetric(float64(len(result.Leaves)), "leaves")
		b.ReportMetric(float64(len(result.Parents)), "parents")
	}
}

// Compare detection speed
func BenchmarkChapterDetection_AhoCorasick(b *testing.B) {
	data, err := os.ReadFile("../../../docs/perfect_run2.md")
	if err != nil {
		b.Skip("perfect_run2.md not found")
	}

	detector := NewAhoCorasickDetector2()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		detector.Detect(data)
	}
}
