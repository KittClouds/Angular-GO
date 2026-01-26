package dafsa

import "testing"

func TestCompileAndLookup(t *testing.T) {
	entities := []RegisteredEntity{
		{
			ID:      "char1",
			Label:   "Monkey D. Luffy",
			Kind:    KindCharacter,
			Aliases: []string{"Straw Hat"},
		},
		{
			ID:    "char2",
			Label: "Roronoa Zoro",
			Kind:  KindCharacter,
		},
		{
			ID:    "faction1",
			Label: "Straw Hat Pirates",
			Kind:  KindFaction,
		},
	}

	dict, err := Compile(entities)
	if err != nil {
		t.Fatalf("Compile failed: %v", err)
	}

	// Test exact lookup
	results := dict.Lookup("Monkey D. Luffy")
	if len(results) != 1 {
		t.Errorf("Lookup 'Monkey D. Luffy' got %d results, want 1", len(results))
	} else if results[0].ID != "char1" {
		t.Errorf("Lookup got ID %s, want char1", results[0].ID)
	}

	// Test auto-alias (last name)
	results = dict.Lookup("Luffy")
	if len(results) != 1 {
		t.Errorf("Lookup 'Luffy' (auto-alias) got %d results, want 1", len(results))
	}

	// Test manual alias
	results = dict.Lookup("Straw Hat")
	if len(results) < 1 {
		t.Errorf("Lookup 'Straw Hat' (manual alias) got %d results, want >= 1", len(results))
	}
}

func TestScan(t *testing.T) {
	entities := []RegisteredEntity{
		{ID: "char1", Label: "Gandalf", Kind: KindCharacter},
		{ID: "char2", Label: "Frodo", Kind: KindCharacter},
		{ID: "place1", Label: "The Shire", Kind: KindPlace},
	}

	dict, err := Compile(entities)
	if err != nil {
		t.Fatalf("Compile failed: %v", err)
	}

	text := "Gandalf met Frodo in the Shire."
	matches := dict.Scan(text)

	if len(matches) < 3 {
		t.Errorf("Scan got %d matches, want at least 3", len(matches))
	}

	// Check we found Gandalf
	foundGandalf := false
	for _, m := range matches {
		if m.MatchedText == "Gandalf" || m.MatchedText == "gandalf" {
			foundGandalf = true
			break
		}
	}
	if !foundGandalf {
		t.Error("Scan should find 'Gandalf'")
	}
}

func TestScanWithInfo(t *testing.T) {
	entities := []RegisteredEntity{
		{ID: "char1", Label: "Gandalf", Kind: KindCharacter},
	}

	dict, err := Compile(entities)
	if err != nil {
		t.Fatalf("Compile failed: %v", err)
	}

	text := "Gandalf the Grey arrived."
	matches := dict.ScanWithInfo(text)

	if len(matches) < 1 {
		t.Fatal("Should find at least 1 match")
	}

	if len(matches[0].Entities) != 1 {
		t.Errorf("Match should have 1 entity, got %d", len(matches[0].Entities))
	}

	if matches[0].Entities[0].ID != "char1" {
		t.Errorf("Entity ID should be char1, got %s", matches[0].Entities[0].ID)
	}
}

func TestAutoAliases(t *testing.T) {
	// Test character auto-aliases
	aliases := generateAutoAliases("Monkey D. Luffy", KindCharacter)

	foundLuffy := false
	for _, a := range aliases {
		if a == "luffy" {
			foundLuffy = true
			break
		}
	}
	if !foundLuffy {
		t.Errorf("Should generate 'luffy' alias, got %v", aliases)
	}

	// Test faction auto-aliases
	aliases = generateAutoAliases("Straw Hat Pirates", KindFaction)

	foundAcronym := false
	for _, a := range aliases {
		if a == "shp" {
			foundAcronym = true
			break
		}
	}
	if !foundAcronym {
		t.Errorf("Should generate 'shp' acronym, got %v", aliases)
	}
}

func TestNormalizeRaw(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Hello World", "hello world"},
		{"Monkey D. Luffy", "monkey d luffy"},
		{"don't stop", "don't stop"},
		{"The  Shire's   beauty", "the shire's beauty"},
	}

	for _, tc := range tests {
		result := NormalizeRaw(tc.input)
		if result != tc.expected {
			t.Errorf("NormalizeRaw(%q) = %q, want %q", tc.input, result, tc.expected)
		}
	}
}

func TestIsKnownEntity(t *testing.T) {
	entities := []RegisteredEntity{
		{ID: "char1", Label: "Gandalf", Kind: KindCharacter},
	}

	dict, _ := Compile(entities)

	if !dict.IsKnownEntity("Gandalf") {
		t.Error("IsKnownEntity('Gandalf') should be true")
	}

	if dict.IsKnownEntity("Saruman") {
		t.Error("IsKnownEntity('Saruman') should be false")
	}
}
