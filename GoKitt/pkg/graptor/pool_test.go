package graptor

import (
	"strings"
	"testing"
)

func TestEntityMentionPool(t *testing.T) {
	// Acquire mention from pool
	m := AcquireMention()
	if m == nil {
		t.Fatal("AcquireMention returned nil")
	}

	// Set values
	m.EntityID = "test-entity"
	m.Text = "Test Text"
	m.ChapterID = 1
	m.ChunkID = 2
	m.Start = 10
	m.End = 20

	// Release back to pool
	ReleaseMention(m)

	// Acquire again - should get reset values
	m2 := AcquireMention()
	if m2.EntityID != "" {
		t.Errorf("Expected reset EntityID, got %q", m2.EntityID)
	}
	if m2.Text != "" {
		t.Errorf("Expected reset Text, got %q", m2.Text)
	}
	if m2.ChapterID != 0 {
		t.Errorf("Expected reset ChapterID, got %d", m2.ChapterID)
	}

	// Clean up
	ReleaseMention(m2)
}

func TestEntityMatchPool(t *testing.T) {
	// Acquire from pool
	em := AcquireEntityMatch()
	if em == nil {
		t.Fatal("AcquireEntityMatch returned nil")
	}

	// Set values
	em.ID = "test-id"
	em.Text = "Test"
	em.Kind = KindPerson
	em.Start = 5
	em.End = 10
	em.Chapter = 1

	// Release back to pool
	ReleaseEntityMatch(em)

	// Acquire again - should get reset values
	em2 := AcquireEntityMatch()
	if em2.ID != "" {
		t.Errorf("Expected reset ID, got %q", em2.ID)
	}
	if em2.Text != "" {
		t.Errorf("Expected reset Text, got %q", em2.Text)
	}
	if em2.Kind != "" {
		t.Errorf("Expected reset Kind, got %q", em2.Kind)
	}

	// Clean up
	ReleaseEntityMatch(em2)
}

func TestStringBuilderPool(t *testing.T) {
	// Acquire builder
	sb := AcquireStringBuilder()
	if sb == nil {
		t.Fatal("AcquireStringBuilder returned nil")
	}

	// Use builder
	sb.WriteString("Hello")
	sb.WriteString(" ")
	sb.WriteString("World")
	result := sb.String()

	if result != "Hello World" {
		t.Errorf("Expected 'Hello World', got %q", result)
	}

	// Release and re-acquire
	ReleaseStringBuilder(sb)
	sb2 := AcquireStringBuilder()

	// Should be reset
	if sb2.Len() != 0 {
		t.Errorf("Expected reset builder with Len 0, got %d", sb2.Len())
	}

	// Clean up
	ReleaseStringBuilder(sb2)
}

func TestCooccurrenceKeyBuilder(t *testing.T) {
	// Test the cooccurrenceKey function directly (not pooled, as benchmarks showed
	// simple concatenation is faster for small strings)
	tests := []struct {
		e1, e2, expected string
	}{
		{"char-ryan", "char-len", "char-len|char-ryan"},
		{"char-len", "char-ryan", "char-len|char-ryan"},
		{"aaa", "zzz", "aaa|zzz"},
		{"zzz", "aaa", "aaa|zzz"},
	}

	for _, tt := range tests {
		result := cooccurrenceKey(tt.e1, tt.e2)
		if result != tt.expected {
			t.Errorf("cooccurrenceKey(%q, %q) = %q, want %q", tt.e1, tt.e2, result, tt.expected)
		}
	}
}

func TestPreAllocatedMaps(t *testing.T) {
	// Test NewEntityAliasMap
	aliasMap := NewEntityAliasMap(100)
	if aliasMap == nil {
		t.Fatal("NewEntityAliasMap returned nil")
	}
	aliasMap["test"] = "value"
	if aliasMap["test"] != "value" {
		t.Error("AliasMap not working")
	}

	// Test NewChapterEntityMap
	chapterMap := NewChapterEntityMap(20)
	if chapterMap == nil {
		t.Fatal("NewChapterEntityMap returned nil")
	}
	chapterMap[1] = []string{"entity1", "entity2"}
	if len(chapterMap[1]) != 2 {
		t.Error("ChapterMap not working")
	}

	// Test NewCooccurrenceMap
	coocMap := NewCooccurrenceMap(500)
	if coocMap == nil {
		t.Fatal("NewCooccurrenceMap returned nil")
	}
	coocMap["a|b"] = 5
	if coocMap["a|b"] != 5 {
		t.Error("CooccurrenceMap not working")
	}

	// Test with zero/negative hints (should use defaults)
	_ = NewEntityAliasMap(0)
	_ = NewEntityAliasMap(-1)
	_ = NewChapterEntityMap(0)
	_ = NewCooccurrenceMap(0)
}

func TestBatchMentionAccumulator(t *testing.T) {
	// Create accumulator with capacity
	acc := NewBatchMentionAccumulator(10)

	if acc.Len() != 0 {
		t.Errorf("Expected initial Len 0, got %d", acc.Len())
	}

	// Add mentions
	m1 := &EntityMention{EntityID: "e1", Text: "Entity 1"}
	m2 := &EntityMention{EntityID: "e2", Text: "Entity 2"}
	m3 := &EntityMention{EntityID: "e3", Text: "Entity 3"}

	acc.Add(m1)
	acc.Add(m2)
	acc.Add(m3)

	if acc.Len() != 3 {
		t.Errorf("Expected Len 3, got %d", acc.Len())
	}

	// Flush
	mentions := acc.Flush()
	if len(mentions) != 3 {
		t.Errorf("Expected 3 mentions, got %d", len(mentions))
	}

	// Check accumulator is reset
	if acc.Len() != 0 {
		t.Errorf("Expected Len 0 after flush, got %d", acc.Len())
	}

	// Check we got the right mentions
	found := make(map[string]bool)
	for _, m := range mentions {
		found[m.EntityID] = true
	}
	if !found["e1"] || !found["e2"] || !found["e3"] {
		t.Error("Missing expected mentions in flush result")
	}
}

func TestBatchMentionAccumulator_Concurrent(t *testing.T) {
	acc := NewBatchMentionAccumulator(100)

	// Add mentions concurrently
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func(id int) {
			for j := 0; j < 100; j++ {
				m := &EntityMention{
					EntityID: "concurrent-test",
					Text:     "test",
				}
				acc.Add(m)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Should have 1000 mentions
	if acc.Len() != 1000 {
		t.Errorf("Expected 1000 mentions, got %d", acc.Len())
	}

	// Flush should return all
	mentions := acc.Flush()
	if len(mentions) != 1000 {
		t.Errorf("Expected 1000 mentions in flush, got %d", len(mentions))
	}
}

// BenchmarkCooccurrenceKey compares simple concatenation vs pooled builder.
// Results showed simple concatenation is 2.6x faster for small strings.
// This benchmark is kept for documentation purposes.
func BenchmarkCooccurrenceKey(b *testing.B) {
	b.Run("simple-concat", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = cooccurrenceKey("char-ryan", "char-len")
		}
	})
}

func BenchmarkStringBuilderPool(b *testing.B) {
	b.Run("pooled", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			sb := AcquireStringBuilder()
			sb.WriteString("test")
			sb.WriteString(" ")
			sb.WriteString("value")
			_ = sb.String()
			ReleaseStringBuilder(sb)
		}
	})

	b.Run("unpooled", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			var sb strings.Builder
			sb.WriteString("test")
			sb.WriteString(" ")
			sb.WriteString("value")
			_ = sb.String()
		}
	})
}
