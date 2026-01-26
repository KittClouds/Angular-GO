package narrative

import "testing"

func TestNarrativeMatcherBasic(t *testing.T) {
	matcher, err := New()
	if err != nil {
		t.Fatalf("Failed to create matcher: %v", err)
	}
	defer matcher.Close()

	// Test direct stem lookup
	match := matcher.Lookup("attack")
	if match == nil {
		t.Fatal("Expected match for 'attack'")
	}
	if match.EventClass != EventBattle {
		t.Errorf("Expected EventBattle, got %s", match.EventClass)
	}
	if match.RelationType != RelAttacks {
		t.Errorf("Expected RelAttacks, got %s", match.RelationType)
	}
	if match.Transitivity != Transitive {
		t.Errorf("Expected Transitive, got %d", match.Transitivity)
	}
}

func TestNarrativeMatcherStemming(t *testing.T) {
	matcher, err := New()
	if err != nil {
		t.Fatalf("Failed to create matcher: %v", err)
	}
	defer matcher.Close()

	// Test inflected forms
	tests := []struct {
		verb     string
		expected EventClass
	}{
		{"attacking", EventBattle},
		{"attacked", EventBattle},
		{"attacks", EventBattle},
		{"kills", EventDeath},
		{"killed", EventDeath},
		{"killing", EventDeath},
		{"travels", EventTravel},
		{"traveled", EventTravel},
	}

	for _, tc := range tests {
		match := matcher.Lookup(tc.verb)
		if match == nil {
			t.Errorf("Expected match for '%s'", tc.verb)
			continue
		}
		if match.EventClass != tc.expected {
			t.Errorf("For '%s': expected %s, got %s", tc.verb, tc.expected, match.EventClass)
		}
	}
}

func TestNarrativeMatcherOverlay(t *testing.T) {
	matcher, err := New()
	if err != nil {
		t.Fatalf("Failed to create matcher: %v", err)
	}
	defer matcher.Close()

	// Add a custom verb
	matcher.AddVerb("enchant", EventRitual, RelCreates, Transitive)

	match := matcher.Lookup("enchant")
	if match == nil {
		t.Fatal("Expected match for 'enchant'")
	}
	if match.EventClass != EventRitual {
		t.Errorf("Expected EventRitual, got %s", match.EventClass)
	}
	if match.Transitivity != Transitive {
		t.Errorf("Expected Transitive, got %d", match.Transitivity)
	}

	if matcher.OverlaySize() != 1 {
		t.Errorf("Expected overlay size 1, got %d", matcher.OverlaySize())
	}
}

func TestNarrativeMatcherUnknown(t *testing.T) {
	matcher, err := New()
	if err != nil {
		t.Fatalf("Failed to create matcher: %v", err)
	}
	defer matcher.Close()

	// Unknown verb should return nil
	match := matcher.Lookup("xyzzy")
	if match != nil {
		t.Error("Expected nil for unknown verb")
	}
}

func TestDictionarySize(t *testing.T) {
	matcher, err := New()
	if err != nil {
		t.Fatalf("Failed to create matcher: %v", err)
	}
	defer matcher.Close()

	size := matcher.DictionarySize()
	if size < 30 {
		t.Errorf("Expected at least 30 entries, got %d", size)
	}
}
