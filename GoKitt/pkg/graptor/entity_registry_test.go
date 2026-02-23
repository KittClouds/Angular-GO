package graptor

import (
	"testing"
)

func TestNewGlobalEntityRegistry(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	if registry == nil {
		t.Fatal("Expected non-nil registry")
	}
	if len(registry.entities) != 0 {
		t.Errorf("Expected empty entities map, got %d", len(registry.entities))
	}
}

func TestRegister(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)

	// Register a new entity
	id := registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)
	if id == "" {
		t.Fatal("Expected non-empty entity ID")
	}

	// Verify entity was created
	entity := registry.LookupByID(id)
	if entity == nil {
		t.Fatal("Expected to find entity by ID")
	}
	if entity.CanonicalName != "Ryan Romano" {
		t.Errorf("Expected name 'Ryan Romano', got '%s'", entity.CanonicalName)
	}
	if entity.Kind != KindPerson {
		t.Errorf("Expected kind 'Person', got '%s'", entity.Kind)
	}
	if entity.Gender != GenderMale {
		t.Errorf("Expected male gender, got %d", entity.Gender)
	}
	if entity.FirstChapter != 1 {
		t.Errorf("Expected first chapter 1, got %d", entity.FirstChapter)
	}
}

func TestRegisterDuplicate(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)

	// Register same entity twice
	id1 := registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)
	id2 := registry.Register("Ryan Romano", KindPerson, GenderMale, 2, 200)

	// Should return same ID
	if id1 != id2 {
		t.Errorf("Expected same ID for duplicate registration, got '%s' and '%s'", id1, id2)
	}

	// Should update chapter list
	entity := registry.LookupByID(id1)
	if len(entity.Chapters) != 2 {
		t.Errorf("Expected 2 chapters, got %d", len(entity.Chapters))
	}
	if entity.TotalMentions != 2 {
		t.Errorf("Expected 2 mentions, got %d", entity.TotalMentions)
	}
}

func TestLookup(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)

	// Exact match
	entity := registry.Lookup("Ryan Romano")
	if entity == nil {
		t.Fatal("Expected to find entity by exact name")
	}

	// Case-insensitive match
	entity = registry.Lookup("ryan romano")
	if entity == nil {
		t.Fatal("Expected to find entity by lowercase name")
	}

	// Non-existent
	entity = registry.Lookup("Nonexistent")
	if entity != nil {
		t.Error("Expected nil for non-existent entity")
	}
}

func TestAddAlias(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	id := registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)

	// Add alias
	success := registry.AddAlias(id, "Quicksave")
	if !success {
		t.Fatal("Expected successful alias addition")
	}

	// Lookup by alias
	entity := registry.Lookup("Quicksave")
	if entity == nil {
		t.Fatal("Expected to find entity by alias")
	}
	if entity.ID != id {
		t.Errorf("Expected same entity ID, got '%s'", entity.ID)
	}

	// Verify alias is stored
	entity = registry.LookupByID(id)
	found := false
	for _, alias := range entity.Aliases {
		if alias == "Quicksave" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected 'Quicksave' in aliases list")
	}
}

func TestAddAliasConflict(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	id1 := registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)
	_ = registry.Register("John Smith", KindPerson, GenderMale, 1, 200) // Different entity

	// Try to add conflicting alias
	success := registry.AddAlias(id1, "John Smith")
	if success {
		t.Error("Expected failure for conflicting alias")
	}

	// Verify no alias was added
	entity := registry.LookupByID(id1)
	for _, alias := range entity.Aliases {
		if alias == "John Smith" {
			t.Error("Did not expect 'John Smith' in aliases")
		}
	}
}

func TestMergeEntities(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	id1 := registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)
	registry.AddAlias(id1, "Quicksave")
	id2 := registry.Register("R. Romano", KindPerson, GenderMale, 2, 200)

	// Merge id2 into id1
	success := registry.MergeEntities(id1, id2)
	if !success {
		t.Fatal("Expected successful merge")
	}

	// Verify id2 is gone
	entity := registry.LookupByID(id2)
	if entity != nil {
		t.Error("Expected id2 to be removed after merge")
	}

	// Verify aliases transferred
	entity = registry.Lookup("R. Romano")
	if entity == nil {
		t.Fatal("Expected to find merged entity by old alias")
	}
	if entity.ID != id1 {
		t.Errorf("Expected merged entity to have id1, got '%s'", entity.ID)
	}

	// Verify all aliases present
	entity = registry.LookupByID(id1)
	if len(entity.Aliases) < 3 {
		t.Errorf("Expected at least 3 aliases after merge, got %d", len(entity.Aliases))
	}
}

func TestResolveExact(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)

	// Exact match
	id, conf := registry.Resolve("Ryan Romano", nil)
	if id == "" {
		t.Fatal("Expected to resolve entity")
	}
	if conf != 1.0 {
		t.Errorf("Expected confidence 1.0, got %f", conf)
	}
}

func TestResolveCaseInsensitive(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)

	// Case-insensitive match - note: CanonicalizeForMatch lowercases, so this is exact match
	id, conf := registry.Resolve("ryan romano", nil)
	if id == "" {
		t.Fatal("Expected to resolve entity")
	}
	// Since CanonicalizeForMatch lowercases both input and stored aliases,
	// "ryan romano" matches exactly after canonicalization
	if conf != 1.0 {
		t.Errorf("Expected confidence 1.0 (canonicalized exact match), got %f", conf)
	}
}

func TestResolvePartial(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	registry.Register("Ryan Romano", KindPerson, GenderMale, 1, 100)

	// Partial match (substring)
	id, conf := registry.Resolve("Ryan", nil)
	if id == "" {
		t.Fatal("Expected to resolve entity by partial match")
	}
	if conf < 0.6 || conf > 0.8 {
		t.Errorf("Expected confidence between 0.6-0.8, got %f", conf)
	}
}

func TestChapterEntities(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	registry.Register("Sarah", KindPerson, GenderFemale, 1, 200)
	registry.Register("John", KindPerson, GenderMale, 2, 300)

	// Get chapter 1 entities
	entities := registry.GetChapterEntities(1)
	if len(entities) != 2 {
		t.Errorf("Expected 2 entities in chapter 1, got %d", len(entities))
	}

	// Get chapter 2 entities
	entities = registry.GetChapterEntities(2)
	if len(entities) != 1 {
		t.Errorf("Expected 1 entity in chapter 2, got %d", len(entities))
	}
}

func TestEntityChapters(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	id := registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	registry.Register("Ryan", KindPerson, GenderMale, 2, 200) // Same entity, different chapter

	// Get chapters for entity
	chapters := registry.GetEntityChapters(id)
	if len(chapters) != 2 {
		t.Errorf("Expected 2 chapters, got %d", len(chapters))
	}
}

func TestCarryOverEntities(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	registry.Register("Sarah", KindPerson, GenderFemale, 1, 200)
	registry.Register("John", KindPerson, GenderMale, 1, 300)

	// Get carry-over entities
	carryOver := registry.GetCarryOverEntities(1)
	if len(carryOver) == 0 {
		t.Fatal("Expected non-empty carry-over")
	}

	// Should prefer entities with known gender
	for _, id := range carryOver {
		entity := registry.LookupByID(id)
		if entity == nil {
			t.Errorf("Carry-over entity '%s' not found", id)
		}
	}
}

func TestResolvePronounAtChapterBoundary(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	registry.Register("Sarah", KindPerson, GenderFemale, 1, 200)

	// Resolve male pronoun at chapter boundary
	id := registry.ResolvePronounAtChapterBoundary("he", 1)
	if id == "" {
		t.Fatal("Expected to resolve pronoun 'he'")
	}
	entity := registry.LookupByID(id)
	if entity.Gender != GenderMale {
		t.Errorf("Expected male entity, got gender %d", entity.Gender)
	}

	// Resolve female pronoun
	id = registry.ResolvePronounAtChapterBoundary("she", 1)
	if id == "" {
		t.Fatal("Expected to resolve pronoun 'she'")
	}
	entity = registry.LookupByID(id)
	if entity.Gender != GenderFemale {
		t.Errorf("Expected female entity, got gender %d", entity.Gender)
	}
}

func TestCooccurrence(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	id1 := registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	id2 := registry.Register("Sarah", KindPerson, GenderFemale, 1, 200)

	// Record co-occurrence
	registry.RecordCooccurrence(id1, id2)

	// Get co-occurrences
	related := registry.GetCooccurrences(id1, 1)
	if len(related) != 1 {
		t.Errorf("Expected 1 related entity, got %d", len(related))
	}
	if related[0] != id2 {
		t.Errorf("Expected related entity '%s', got '%s'", id2, related[0])
	}
}

func TestRegisterMention(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)

	// Register a mention
	id := registry.RegisterMention("Ryan Romano", KindPerson, 1, 100, 0, 12)
	if id == "" {
		t.Fatal("Expected non-empty entity ID")
	}

	// Verify entity created
	entity := registry.LookupByID(id)
	if entity == nil {
		t.Fatal("Expected to find entity")
	}

	// Verify mention recorded
	mentions := registry.GetMentions(id)
	if len(mentions) != 1 {
		t.Errorf("Expected 1 mention, got %d", len(mentions))
	}
	if mentions[0].Text != "Ryan Romano" {
		t.Errorf("Expected mention text 'Ryan Romano', got '%s'", mentions[0].Text)
	}
}

func TestStats(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	registry.Register("Sarah", KindPerson, GenderFemale, 1, 200)
	registry.Register("John", KindPerson, GenderMale, 2, 300)

	stats := registry.Stats()
	if stats.TotalEntities != 3 {
		t.Errorf("Expected 3 entities, got %d", stats.TotalEntities)
	}
	if stats.TotalChapters != 2 {
		t.Errorf("Expected 2 chapters, got %d", stats.TotalChapters)
	}
}

func TestExportImport(t *testing.T) {
	registry1 := NewGlobalEntityRegistry(nil)
	id := registry1.Register("Ryan", KindPerson, GenderMale, 1, 100)
	registry1.AddAlias(id, "Quicksave")
	registry1.Register("Sarah", KindPerson, GenderFemale, 1, 200)

	// Export
	export := registry1.Export()
	if export == nil {
		t.Fatal("Expected non-nil export")
	}

	// Import into new registry
	registry2 := NewGlobalEntityRegistry(nil)
	registry2.Import(export)

	// Verify data
	stats := registry2.Stats()
	if stats.TotalEntities != 2 {
		t.Errorf("Expected 2 entities after import, got %d", stats.TotalEntities)
	}

	// Verify alias
	entity := registry2.Lookup("Quicksave")
	if entity == nil {
		t.Fatal("Expected to find entity by alias after import")
	}
}

func TestGenderParsing(t *testing.T) {
	tests := []struct {
		input    string
		expected Gender
	}{
		{"male", GenderMale},
		{"m", GenderMale},
		{"he", GenderMale},
		{"female", GenderFemale},
		{"f", GenderFemale},
		{"she", GenderFemale},
		{"neutral", GenderNeutral},
		{"it", GenderNeutral},
		{"plural", GenderPlural},
		{"they", GenderPlural},
		{"unknown", GenderUnknown},
		{"", GenderUnknown},
	}

	for _, test := range tests {
		result := ParseGender(test.input)
		if result != test.expected {
			t.Errorf("ParseGender('%s'): expected %d, got %d", test.input, test.expected, result)
		}
	}
}

func TestGenderString(t *testing.T) {
	tests := []struct {
		gender   Gender
		expected string
	}{
		{GenderMale, "male"},
		{GenderFemale, "female"},
		{GenderNeutral, "neutral"},
		{GenderPlural, "plural"},
		{GenderUnknown, "unknown"},
	}

	for _, test := range tests {
		result := test.gender.String()
		if result != test.expected {
			t.Errorf("Gender.String(): expected '%s', got '%s'", test.expected, result)
		}
	}
}

func TestCanonicalizeForMatch(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Ryan Romano", "ryan romano"},
		{"  Ryan  ", "ryan"},
		{"The Dragon", "dragon"},
		{"A Cat", "cat"},
		{"An Apple", "apple"},
	}

	for _, test := range tests {
		result := CanonicalizeForMatch(test.input)
		if result != test.expected {
			t.Errorf("CanonicalizeForMatch('%s'): expected '%s', got '%s'", test.input, test.expected, result)
		}
	}
}

func TestConcurrentAccess(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	done := make(chan bool)

	// Concurrent writes
	for i := 0; i < 10; i++ {
		go func(n int) {
			registry.Register("Entity", KindPerson, GenderMale, uint32(n), 100)
			done <- true
		}(i)
	}

	// Concurrent reads
	for i := 0; i < 10; i++ {
		go func() {
			registry.Lookup("Entity")
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 20; i++ {
		<-done
	}

	// Verify no data corruption
	entity := registry.Lookup("Entity")
	if entity == nil {
		t.Fatal("Expected to find entity after concurrent access")
	}
}
