package graptor

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestNewStreamProcessor(t *testing.T) {
	sp := NewStreamProcessor(nil)
	if sp == nil {
		t.Fatal("Expected non-nil stream processor")
	}
	if sp.registry == nil {
		t.Error("Expected non-nil registry")
	}
	if sp.cooccurrence == nil {
		t.Error("Expected non-nil cooccurrence")
	}
	if sp.chapterMgr == nil {
		t.Error("Expected non-nil chapter manager")
	}
}

func TestStreamProcessor_ProcessMention(t *testing.T) {
	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)

	// Track mentions via callback
	var mentionCount int
	sp.OnMention(func(m *EntityMention) error {
		mentionCount++
		return nil
	})

	err := sp.ProcessMention(context.Background(), "Ryan", KindPerson, GenderMale, 1, 0, 4)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if mentionCount != 1 {
		t.Errorf("Expected 1 mention callback, got %d", mentionCount)
	}

	// Check registry
	entity := sp.registry.Lookup("Ryan")
	if entity == nil {
		t.Fatal("Expected to find entity 'Ryan'")
	}
	if entity.Gender != GenderMale {
		t.Errorf("Expected male gender, got %v", entity.Gender)
	}
}

func TestStreamProcessor_ProcessEntity(t *testing.T) {
	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)

	// Track entities via callback
	var entityCount int
	sp.OnEntity(func(e *Entity) error {
		entityCount++
		return nil
	})

	id, err := sp.ProcessEntity(context.Background(), "Sarah", KindPerson, GenderFemale, 1)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if id == "" {
		t.Error("Expected non-empty entity ID")
	}

	// Entity callback is called for new entities
	if entityCount != 1 {
		t.Errorf("Expected 1 entity callback, got %d", entityCount)
	}
}

func TestStreamProcessor_MultipleMentions(t *testing.T) {
	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)

	// Process multiple mentions
	mentions := []struct {
		text   string
		kind   EntityKind
		gender Gender
	}{
		{"Ryan", KindPerson, GenderMale},
		{"Sarah", KindPerson, GenderFemale},
		{"New Rome", KindLocation, GenderNeutral},
		{"Ryan", KindPerson, GenderMale}, // Duplicate
	}

	for i, m := range mentions {
		err := sp.ProcessMention(context.Background(), m.text, m.kind, m.gender, uint32(i), 0, len(m.text))
		if err != nil {
			t.Fatalf("Unexpected error at %d: %v", i, err)
		}
	}

	// Should have 3 unique entities
	stats := sp.registry.Stats()
	if stats.TotalEntities != 3 {
		t.Errorf("Expected 3 entities, got %d", stats.TotalEntities)
	}

	// Ryan should have 2 mentions
	ryan := sp.registry.Lookup("Ryan")
	if ryan == nil {
		t.Fatal("Expected to find Ryan")
	}
	if ryan.TotalMentions != 2 {
		t.Errorf("Expected 2 mentions for Ryan, got %d", ryan.TotalMentions)
	}
}

func TestStreamProcessor_ChapterTransition(t *testing.T) {
	sp := NewStreamProcessor(nil)

	// Chapter 1
	sp.StartChapter(1)
	sp.ProcessMention(context.Background(), "Ryan", KindPerson, GenderMale, 1, 0, 4)
	sp.ProcessMention(context.Background(), "Sarah", KindPerson, GenderFemale, 2, 0, 5)
	sp.FinishChapter()

	// Chapter 2
	sp.StartChapter(2)
	sp.ProcessMention(context.Background(), "John", KindPerson, GenderMale, 1, 0, 4)
	sp.FinishChapter()

	// Check chapters
	chapters := sp.chapterMgr.GetAllChapters()
	if len(chapters) != 2 {
		t.Errorf("Expected 2 chapters, got %d", len(chapters))
	}
}

func TestStreamProcessor_Cooccurrence(t *testing.T) {
	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)

	// Process entities
	sp.ProcessMention(context.Background(), "Ryan", KindPerson, GenderMale, 1, 0, 4)
	sp.ProcessMention(context.Background(), "Sarah", KindPerson, GenderFemale, 2, 0, 5)

	// Record co-occurrence
	ryan := sp.registry.Lookup("Ryan")
	sarah := sp.registry.Lookup("Sarah")
	sp.RecordCooccurrence([]string{ryan.ID, sarah.ID})

	// Check co-occurrence
	pairs := sp.cooccurrence.GetTopPairs(10)
	if len(pairs) == 0 {
		t.Error("Expected at least 1 co-occurrence pair")
	}
}

func TestStreamProcessor_Dispose(t *testing.T) {
	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)
	sp.ProcessMention(context.Background(), "Ryan", KindPerson, GenderMale, 1, 0, 4)

	// Dispose
	sp.Dispose()

	// Registry should be cleared
	stats := sp.registry.Stats()
	if stats.TotalEntities != 0 {
		t.Errorf("Expected empty registry after dispose, got %d entities", stats.TotalEntities)
	}
}

func TestStreamProcessor_ContextCancellation(t *testing.T) {
	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)

	// Create cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := sp.ProcessMention(ctx, "Ryan", KindPerson, GenderMale, 1, 0, 4)
	if err == nil {
		t.Error("Expected error from cancelled context")
	}
	if err != context.Canceled {
		t.Errorf("Expected context.Canceled, got %v", err)
	}
}

func TestStreamProcessor_CallbackError(t *testing.T) {
	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)

	// Callback that returns error
	expectedErr := errors.New("callback error")
	sp.OnMention(func(m *EntityMention) error {
		return expectedErr
	})

	err := sp.ProcessMention(context.Background(), "Ryan", KindPerson, GenderMale, 1, 0, 4)
	if err != expectedErr {
		t.Errorf("Expected callback error, got %v", err)
	}
}

func TestBatchToStream(t *testing.T) {
	// Create registry with entities first
	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)

	// Register entities first
	id1, _ := sp.ProcessEntity(context.Background(), "Ryan", KindPerson, GenderMale, 1)
	id2, _ := sp.ProcessEntity(context.Background(), "Sarah", KindPerson, GenderFemale, 2)

	// Create batch of mentions
	mentions := []*EntityMention{
		{EntityID: id1, Text: "Ryan", ChapterID: 1, ChunkID: 1, Start: 0, End: 4},
		{EntityID: id2, Text: "Sarah", ChapterID: 1, ChunkID: 2, Start: 0, End: 5},
		{EntityID: id1, Text: "Ryan", ChapterID: 1, ChunkID: 3, Start: 0, End: 4},
	}

	// Process batch
	err := BatchToStream(context.Background(), mentions, sp)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
}

func TestStreamProcessor_LargeVolume(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping large volume test in short mode")
	}

	sp := NewStreamProcessor(nil)
	sp.StartChapter(1)

	// Process 1000 mentions
	start := time.Now()
	for i := 0; i < 1000; i++ {
		name := "Entity" + string(rune('A'+i%26))
		err := sp.ProcessMention(context.Background(), name, KindPerson, GenderMale, uint32(i), 0, len(name))
		if err != nil {
			t.Fatalf("Unexpected error at %d: %v", i, err)
		}
	}
	elapsed := time.Since(start)

	t.Logf("Processed 1000 mentions in %v", elapsed)

	// Should have 26 unique entities (A-Z)
	stats := sp.registry.Stats()
	if stats.TotalEntities != 26 {
		t.Errorf("Expected 26 entities, got %d", stats.TotalEntities)
	}
}
