package graptor

import (
	"testing"
)

func TestAliasDetector_DetectAliases(t *testing.T) {
	ad := NewAliasDetector()

	tests := []struct {
		text     string
		expected int // minimum number of aliases expected
	}{
		{"Ryan Romano, also known as Quicksave, walked into the room.", 1},
		{"The character Quicksave, aka Ryan Romano, appeared.", 1},
		{"Ryan Romano (Quicksave) was there.", 1},
		{"Ryan Romano or Quicksave - both names work.", 1},
		{"Quicksave, real name Ryan Romano, smiled.", 1},
		{"Ryan Romano, otherwise known as Quicksave, left.", 1},
		{"Quicksave - Ryan Romano entered.", 1},
		{"No aliases here, just a normal sentence.", 0},
	}

	for _, tt := range tests {
		aliases := ad.DetectAliases(tt.text)
		if len(aliases) < tt.expected {
			t.Errorf("DetectAliases(%q) returned %d aliases, expected at least %d", tt.text, len(aliases), tt.expected)
		}
	}
}

func TestAliasDetector_Patterns(t *testing.T) {
	ad := NewAliasDetector()

	// Test "also known as"
	aliases := ad.DetectAliases("Ryan Romano, also known as Quicksave")
	if len(aliases) == 0 {
		t.Error("Expected to detect 'also known as' pattern")
	} else {
		if aliases[0].Entity1 != "Ryan Romano" && aliases[0].Entity1 != "Quicksave" {
			t.Errorf("Unexpected entity1: %s", aliases[0].Entity1)
		}
	}

	// Test "aka"
	aliases = ad.DetectAliases("Quicksave, aka Ryan Romano")
	if len(aliases) == 0 {
		t.Error("Expected to detect 'aka' pattern")
	}

	// Test parenthetical
	aliases = ad.DetectAliases("Ryan Romano (Quicksave)")
	if len(aliases) == 0 {
		t.Error("Expected to detect parenthetical alias pattern")
	}
}

func TestAliasDetector_DetectAliasesInContext(t *testing.T) {
	ad := NewAliasDetector()
	registry := NewGlobalEntityRegistry(DefaultRegistryConfig())

	// Register a known entity
	registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 1)

	// Test detection with context
	aliases := ad.DetectAliasesInContext("Ryan Romano, also known as Quicksave", registry)
	if len(aliases) == 0 {
		t.Error("Expected to detect alias with context")
	} else {
		if !aliases[0].IsNewAlias {
			t.Error("Expected IsNewAlias to be true for unknown entity")
		}
		if aliases[0].KnownEntity == "" {
			t.Error("Expected KnownEntity to be set")
		}
	}
}

func TestAliasDetector_CleanEntityName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"  Ryan Romano  ", "Ryan Romano"},
		{"the Quicksave", "Quicksave"},
		{"The Meta-Gang", "Meta-Gang"},
		{"  spaced  ", "spaced"},
	}

	for _, tt := range tests {
		result := cleanEntityName(tt.input)
		if result != tt.expected {
			t.Errorf("cleanEntityName(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestAliasDetector_AddPattern(t *testing.T) {
	ad := NewAliasDetector()

	// Add custom pattern
	err := ad.AddPattern(
		`(?i)(\w+)\s+is\s+called\s+(\w+)`,
		"$1 is called $2",
		[]string{"entity1", "entity2"},
		"X is called Y",
	)
	if err != nil {
		t.Errorf("AddPattern failed: %v", err)
	}

	// Test the new pattern
	aliases := ad.DetectAliases("Ryan is called Quicksave")
	if len(aliases) == 0 {
		t.Error("Expected to detect custom pattern")
	}
}

func TestAliasDetector_MultipleAliases(t *testing.T) {
	ad := NewAliasDetector()

	text := "Ryan Romano, also known as Quicksave, met with Len (Underdiver) and Meta-Gang, aka Meta."
	aliases := ad.DetectAliases(text)

	if len(aliases) < 2 {
		t.Errorf("Expected at least 2 aliases, got %d", len(aliases))
	}
}

func TestAliasDetector_NoFalsePositives(t *testing.T) {
	ad := NewAliasDetector()

	// These should NOT match
	tests := []string{
		"Ryan walked to the store",
		"Also known as a great place",
		"The aka is a title",
		"Real name is important",
	}

	for _, text := range tests {
		aliases := ad.DetectAliases(text)
		if len(aliases) > 0 {
			t.Errorf("False positive: %q matched as alias", text)
		}
	}
}
