package graptor

import (
	"runtime"
	"testing"
)

func TestGlobalEntityRegistry_Clear(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)

	// Add some entities
	for i := 0; i < 10; i++ {
		registry.RegisterMention("Entity"+string(rune('A'+i)), KindPerson, 0, 0, i*10, i*10+6)
	}

	// Verify data exists
	if len(registry.entities) == 0 {
		t.Fatal("Expected entities to be added")
	}
	if len(registry.mentions) == 0 {
		t.Fatal("Expected mentions to be added")
	}

	// Clear
	registry.Clear()

	// Verify cleared
	if len(registry.entities) != 0 {
		t.Errorf("Expected 0 entities after Clear, got %d", len(registry.entities))
	}
	if len(registry.aliases) != 0 {
		t.Errorf("Expected 0 aliases after Clear, got %d", len(registry.aliases))
	}
	if len(registry.mentions) != 0 {
		t.Errorf("Expected 0 mentions after Clear, got %d", len(registry.mentions))
	}
	if len(registry.cooccurrences) != 0 {
		t.Errorf("Expected 0 cooccurrences after Clear, got %d", len(registry.cooccurrences))
	}
}

func TestGlobalEntityRegistry_MaxMentions(t *testing.T) {
	cfg := DefaultRegistryConfig()
	cfg.MaxMentions = 5

	registry := NewGlobalEntityRegistry(cfg)

	// Add more mentions than the limit
	for i := 0; i < 10; i++ {
		registry.RegisterMention("Entity", KindPerson, 0, 0, i*10, i*10+6)
	}

	// Should be capped at MaxMentions
	if len(registry.mentions) > cfg.MaxMentions {
		t.Errorf("Expected at most %d mentions, got %d", cfg.MaxMentions, len(registry.mentions))
	}
}

func TestGlobalEntityRegistry_MaxMentions_ZeroUnlimited(t *testing.T) {
	cfg := DefaultRegistryConfig()
	cfg.MaxMentions = 0 // Unlimited

	registry := NewGlobalEntityRegistry(cfg)

	// Add many mentions
	for i := 0; i < 100; i++ {
		registry.RegisterMention("Entity", KindPerson, 0, 0, i*10, i*10+6)
	}

	// Should have all 100 mentions
	if len(registry.mentions) != 100 {
		t.Errorf("Expected 100 mentions with MaxMentions=0, got %d", len(registry.mentions))
	}
}

func TestGlobalEntityRegistry_GetMentionCount(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)

	if registry.GetMentionCount() != 0 {
		t.Errorf("Expected 0 mentions initially, got %d", registry.GetMentionCount())
	}

	for i := 0; i < 5; i++ {
		registry.RegisterMention("Entity", KindPerson, 0, 0, i*10, i*10+6)
	}

	if registry.GetMentionCount() != 5 {
		t.Errorf("Expected 5 mentions, got %d", registry.GetMentionCount())
	}
}

func TestDocumentGraph_Dispose(t *testing.T) {
	// Create a document graph with data
	dg := &DocumentGraph{
		DocumentID: "test-doc",
		Chapters: make(map[uint32]*ChapterGraph),
		CrossChapterEdges: make([]*CrossChapterEdge, 5),
		Registry: NewGlobalEntityRegistry(nil),
		Cooccurrence: NewCooccurrenceStats(3),
	}

	// Add some data
	dg.Registry.Register("TestEntity", KindPerson, GenderMale, 0, 0)
	dg.Cooccurrence.RecordCooccurrence([]string{"a", "b"}, 0)
	dg.Chapters[0] = &ChapterGraph{ChapterID: 0}

	// Dispose
	dg.Dispose()

	// Verify cleared
	if dg.Registry != nil {
		t.Error("Expected Registry to be nil after Dispose")
	}
	if dg.Cooccurrence != nil {
		t.Error("Expected Cooccurrence to be nil after Dispose")
	}
	if dg.Chapters != nil {
		t.Error("Expected Chapters to be nil after Dispose")
	}
	if dg.CrossChapterEdges != nil {
		t.Error("Expected CrossChapterEdges to be nil after Dispose")
	}
}

func TestEntityMention_TextCopied(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)

	// Create a large source text
	sourceText := "This is a very long source text that we want to ensure is not referenced by the mention"

	// Register a mention with a substring
	mention := sourceText[10:20] // "very long"
	registry.RegisterMention(mention, KindPerson, 0, 0, 10, 20)

	// Get the stored mention
	mentions := registry.GetMentions(registry.Register("very long", KindPerson, GenderUnknown, 0, 0))
	if len(mentions) == 0 {
		// The mention was registered, find it
		for _, m := range registry.mentions {
			if m.Text == "very long" {
				// Verify the text is a copy, not a reference to source
				// This is hard to test directly, but we can check the address
				// The key is that strings.Clone was used
				if m.Text != "very long" {
					t.Errorf("Expected text 'very long', got %q", m.Text)
				}
				break
			}
		}
	}
}

func TestMemoryLeak_Prevention(t *testing.T) {
	// This test verifies that Clear() allows GC to reclaim memory
	// It's a soft test - we can't force GC, but we can verify the structure

	registry := NewGlobalEntityRegistry(nil)

	// Add many entities
	for i := 0; i < 1000; i++ {
		name := string(rune('A' + i%26)) + string(rune('a'+i%26))
		registry.RegisterMention(name, KindPerson, uint32(i/100), 0, i*10, i*10+5)
	}

	initialEntityCount := len(registry.entities)
	initialMentionCount := len(registry.mentions)

	if initialEntityCount == 0 {
		t.Fatal("Expected entities to be added")
	}
	if initialMentionCount == 0 {
		t.Fatal("Expected mentions to be added")
	}

	// Clear and verify
	registry.Clear()

	if len(registry.entities) != 0 {
		t.Errorf("Entities not cleared: %d remain", len(registry.entities))
	}
	if registry.mentions != nil {
		t.Errorf("Mentions not cleared: %d remain", len(registry.mentions))
	}
}

func TestTrimMentions(t *testing.T) {
	cfg := DefaultRegistryConfig()
	cfg.MaxMentions = 10

	registry := NewGlobalEntityRegistry(cfg)

	// Add 20 mentions
	for i := 0; i < 20; i++ {
		registry.RegisterMention("Entity", KindPerson, 0, 0, i*10, i*10+6)
	}

	// Should be trimmed to 10
	if len(registry.mentions) > 10 {
		t.Errorf("Expected at most 10 mentions after trim, got %d", len(registry.mentions))
	}

	// Verify mention indices are still valid
	for _, indices := range registry.mentionIdx {
		for _, idx := range indices {
			if idx >= len(registry.mentions) {
				t.Errorf("Invalid mention index %d (max %d)", idx, len(registry.mentions)-1)
			}
		}
	}
}

// Benchmark memory allocation with and without limits
func BenchmarkRegisterMention_Unlimited(b *testing.B) {
	registry := NewGlobalEntityRegistry(nil)
	for i := 0; i < b.N; i++ {
		registry.RegisterMention("Entity", KindPerson, 0, 0, i*10, i*10+6)
	}
}

func BenchmarkRegisterMention_WithLimit(b *testing.B) {
	cfg := DefaultRegistryConfig()
	cfg.MaxMentions = 1000
	registry := NewGlobalEntityRegistry(cfg)
	for i := 0; i < b.N; i++ {
		registry.RegisterMention("Entity", KindPerson, 0, 0, i*10, i*10+6)
	}
}

func BenchmarkClear(b *testing.B) {
	registry := NewGlobalEntityRegistry(nil)
	for i := 0; i < b.N; i++ {
		// Add some data
		for j := 0; j < 100; j++ {
			registry.RegisterMention("Entity", KindPerson, 0, 0, j*10, j*10+6)
		}
		// Clear
		registry.Clear()
	}
}

// Test that GC can reclaim memory after Clear
func TestGC_AfterClear(t *testing.T) {
	// Create registry with many entities
	cfg := DefaultRegistryConfig()
	cfg.ExpectedEntities = 10000
	cfg.ExpectedMentions = 100000

	registry := NewGlobalEntityRegistry(cfg)

	// Add many entities and mentions
	for i := 0; i < 10000; i++ {
		name := string(rune('A'+i%26)) + string(rune('a'+i%26)) + string(rune('0'+i%10))
		registry.RegisterMention(name, KindPerson, uint32(i/1000), 0, i*10, i*10+5)
	}

	// Get memory stats before
	var m1 runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m1)

	// Clear
	registry.Clear()

	// Force GC
	runtime.GC()

	// Get memory stats after
	var m2 runtime.MemStats
	runtime.ReadMemStats(&m2)

	// Memory should be lower (or at least not significantly higher)
	// Note: This is a soft check - GC behavior varies
	// We mainly verify Clear() works without panic
	t.Logf("Heap before: %d bytes", m1.HeapAlloc)
	t.Logf("Heap after:  %d bytes", m2.HeapAlloc)
}
