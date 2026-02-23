package graptor

import (
	"testing"
)

func TestCooccurrenceStats_RecordCooccurrence(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Record some co-occurrences
	cs.RecordCooccurrence([]string{"entity-a", "entity-b", "entity-c"}, 1)
	cs.RecordCooccurrence([]string{"entity-a", "entity-b"}, 1)
	cs.RecordCooccurrence([]string{"entity-a", "entity-c"}, 2)

	// Check pair counts
	tests := []struct {
		e1, e2   string
		expected int
	}{
		{"entity-a", "entity-b", 2},
		{"entity-a", "entity-c", 2},
		{"entity-b", "entity-c", 1},
		{"entity-a", "entity-d", 0},
	}

	for _, tt := range tests {
		count := cs.GetCount(tt.e1, tt.e2)
		if count != tt.expected {
			t.Errorf("GetCount(%s, %s) = %d, want %d", tt.e1, tt.e2, count, tt.expected)
		}
	}
}

func TestCooccurrenceStats_GetRelated(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Record co-occurrences
	cs.RecordCooccurrence([]string{"ryan", "len", "wyvern"}, 1)
	cs.RecordCooccurrence([]string{"ryan", "len"}, 1)
	cs.RecordCooccurrence([]string{"ryan", "ghoul"}, 2)
	cs.RecordCooccurrence([]string{"len", "wyvern"}, 2)

	// Get related entities for ryan
	// ryan-len: 2, ryan-wyvern: 1, ryan-ghoul: 1
	related := cs.GetRelated("ryan", 1)
	if len(related) != 3 {
		t.Errorf("GetRelated(ryan, 1) returned %d entities, want 3", len(related))
	}

	// Check ordering (should be sorted by count descending)
	if len(related) >= 2 {
		if related[0].Count < related[1].Count {
			t.Error("GetRelated should return entities sorted by count descending")
		}
	}

	// Get related with higher threshold
	// Only ryan-len has count >= 2
	relatedHigh := cs.GetRelated("ryan", 2)
	if len(relatedHigh) != 1 {
		t.Errorf("GetRelated(ryan, 2) returned %d entities, want 1", len(relatedHigh))
	}
}

func TestCooccurrenceStats_GetAllPairs(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Record co-occurrences
	cs.RecordCooccurrence([]string{"a", "b", "c"}, 1)
	cs.RecordCooccurrence([]string{"a", "b"}, 2)

	// Get all pairs with min count 1
	pairs := cs.GetAllPairs(1)
	if len(pairs) != 3 {
		t.Errorf("GetAllPairs(1) returned %d pairs, want 3", len(pairs))
	}

	// Get pairs with min count 2
	pairsHigh := cs.GetAllPairs(2)
	if len(pairsHigh) != 1 {
		t.Errorf("GetAllPairs(2) returned %d pairs, want 1", len(pairsHigh))
	}

	// Check that the pair has correct count
	if pairsHigh[0].Count != 2 {
		t.Errorf("Pair count = %d, want 2", pairsHigh[0].Count)
	}
}

func TestCooccurrenceStats_GetTopPairs(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Record many co-occurrences
	cs.RecordCooccurrence([]string{"a", "b"}, 1)
	cs.RecordCooccurrence([]string{"a", "b"}, 1)
	cs.RecordCooccurrence([]string{"a", "b"}, 1)
	cs.RecordCooccurrence([]string{"c", "d"}, 1)
	cs.RecordCooccurrence([]string{"c", "d"}, 1)
	cs.RecordCooccurrence([]string{"e", "f"}, 1)

	// Get top 2 pairs
	top := cs.GetTopPairs(2)
	if len(top) != 2 {
		t.Errorf("GetTopPairs(2) returned %d pairs, want 2", len(top))
	}

	// First pair should be a-b with count 3
	if top[0].Entity1ID != "a" && top[0].Entity2ID != "b" {
		t.Errorf("Top pair should be (a, b), got (%s, %s)", top[0].Entity1ID, top[0].Entity2ID)
	}
	if top[0].Count != 3 {
		t.Errorf("Top pair count = %d, want 3", top[0].Count)
	}
}

func TestCooccurrenceStats_Stats(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Record co-occurrences
	cs.RecordCooccurrence([]string{"a", "b", "c"}, 1)
	cs.RecordCooccurrence([]string{"a", "b"}, 2)

	stats := cs.Stats()

	if stats.TotalPairs != 3 {
		t.Errorf("TotalPairs = %d, want 3", stats.TotalPairs)
	}

	// a-b appears twice, a-c once, b-c once = 4 total occurrences
	if stats.TotalOccurrences != 4 {
		t.Errorf("TotalOccurrences = %d, want 4", stats.TotalOccurrences)
	}

	if stats.MaxCount != 2 {
		t.Errorf("MaxCount = %d, want 2", stats.MaxCount)
	}

	if stats.TotalEntities != 3 {
		t.Errorf("TotalEntities = %d, want 3", stats.TotalEntities)
	}
}

func TestCooccurrenceStats_Clear(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Record co-occurrences
	cs.RecordCooccurrence([]string{"a", "b"}, 1)

	// Clear
	cs.Clear()

	stats := cs.Stats()
	if stats.TotalPairs != 0 {
		t.Errorf("After Clear(), TotalPairs = %d, want 0", stats.TotalPairs)
	}
}

func TestCooccurrenceStats_Merge(t *testing.T) {
	cs1 := NewCooccurrenceStats(3)
	cs2 := NewCooccurrenceStats(3)

	// Record in first
	cs1.RecordCooccurrence([]string{"a", "b"}, 1)
	cs1.RecordCooccurrence([]string{"a", "c"}, 1)

	// Record in second
	cs2.RecordCooccurrence([]string{"a", "b"}, 1)
	cs2.RecordCooccurrence([]string{"b", "c"}, 1)

	// Merge
	cs1.Merge(cs2)

	// Check merged counts
	if cs1.GetCount("a", "b") != 2 {
		t.Errorf("After merge, a-b count = %d, want 2", cs1.GetCount("a", "b"))
	}

	if cs1.GetCount("a", "c") != 1 {
		t.Errorf("After merge, a-c count = %d, want 1", cs1.GetCount("a", "c"))
	}

	if cs1.GetCount("b", "c") != 1 {
		t.Errorf("After merge, b-c count = %d, want 1", cs1.GetCount("b", "c"))
	}
}

func TestCooccurrenceStats_SingleEntity(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Single entity should not create any pairs
	cs.RecordCooccurrence([]string{"a"}, 1)

	stats := cs.Stats()
	if stats.TotalPairs != 0 {
		t.Errorf("Single entity should not create pairs, got %d", stats.TotalPairs)
	}
}

func TestCooccurrenceStats_Empty(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Empty should not create any pairs
	cs.RecordCooccurrence([]string{}, 1)

	stats := cs.Stats()
	if stats.TotalPairs != 0 {
		t.Errorf("Empty should not create pairs, got %d", stats.TotalPairs)
	}
}

func TestCooccurrenceStats_KeyConsistency(t *testing.T) {
	cs := NewCooccurrenceStats(3)

	// Record with different order - should create same key
	cs.RecordCooccurrence([]string{"b", "a"}, 1)
	cs.RecordCooccurrence([]string{"a", "b"}, 1)

	// Should have count of 2
	if cs.GetCount("a", "b") != 2 {
		t.Errorf("Key consistency failed: a-b count = %d, want 2", cs.GetCount("a", "b"))
	}

	if cs.GetCount("b", "a") != 2 {
		t.Errorf("Key consistency failed: b-a count = %d, want 2", cs.GetCount("b", "a"))
	}
}

func TestCooccurrenceStats_DefaultWindowSize(t *testing.T) {
	// Test that windowSize defaults to 3 when given 0 or negative
	cs1 := NewCooccurrenceStats(0)
	if cs1.windowSize != 3 {
		t.Errorf("Default windowSize should be 3, got %d", cs1.windowSize)
	}

	cs2 := NewCooccurrenceStats(-1)
	if cs2.windowSize != 3 {
		t.Errorf("Default windowSize should be 3 for negative input, got %d", cs2.windowSize)
	}
}
