package conductor

import (
	"strings"
	"testing"

	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/scanner/chunker"
	"github.com/kittclouds/gokitt/pkg/scanner/discovery"
	"github.com/kittclouds/gokitt/pkg/scanner/resolver"
	"github.com/kittclouds/gokitt/pkg/scanner/syntax"
)

func TestConductorFullPipeline(t *testing.T) {
	c, err := New()
	if err != nil {
		t.Fatalf("Failed to create conductor: %v", err)
	}
	defer c.Close()

	// Seed entities (NER-Native requires known entities or discovery)
	entities := []implicitmatcher.RegisteredEntity{
		{ID: "char-gandalf", Label: "Gandalf", Kind: implicitmatcher.KindCharacter},
		{ID: "loc-mountain", Label: "Mountain", Kind: implicitmatcher.KindPlace},
		{ID: "monster-balrog", Label: "Balrog", Kind: implicitmatcher.KindCharacter},
	}
	dict, _ := implicitmatcher.Compile(entities)
	c.SetDictionary(dict)
	// Also register them in Resolver so pronouns work
	// Also register them in Resolver so pronouns work
	for _, e := range entities {
		gender := resolver.GenderUnknown
		if e.Kind == implicitmatcher.KindPlace || e.Kind == implicitmatcher.KindItem {
			gender = resolver.GenderNeutral
		} else if e.Kind == implicitmatcher.KindCharacter {
			// In a real app, we'd have explicit logic, but for test, let's assume Gandalf/Balrog are compatible with "He"
			// Leaving as Unknown allows "He" to match.
			// But crucially, Place must be Neutral to BE SKIPPED.
			gender = resolver.GenderUnknown
		}
		c.resolver.RegisterEntity(resolver.EntityMetadata{
			ID:     e.ID,
			Name:   e.Label,
			Gender: gender,
		})
	}

	// Text: Clean text without tags
	text := "Gandalf traveled to the Mountain. He defeated the Balrog."

	result := c.Scan(text)

	// 1. Verify Syntax (NER Matches)
	// We expect Gandalf, Mountain, Balrog
	if len(result.Syntax) != 3 {
		t.Errorf("Expected 3 syntax matches, got %d", len(result.Syntax))
	}

	// 2. Verify Narrative (Events)
	// "traveled" -> EventTravel
	// "defeated" -> EventBattle
	if len(result.Narrative) != 2 {
		t.Errorf("Expected 2 narrative events, got %d", len(result.Narrative))
	}

	foundTravel := false
	foundBattle := false
	for _, ev := range result.Narrative {
		if strings.Contains(ev.Event.String(), "TRAVEL") {
			foundTravel = true
		}
		if strings.Contains(ev.Event.String(), "BATTLE") {
			foundBattle = true
		}
	}
	if !foundTravel {
		t.Error("Did not find Travel event")
	}
	if !foundBattle {
		t.Error("Did not find Battle event")
	}

	// 3. Verify Resolution
	// "He" should resolve to "Gandalf" (because Gandalf was registered finding the tag)
	foundRef := false
	for _, ref := range result.ResolvedRefs {
		if ref.Text == "He" {
			t.Logf("'He' resolved to: %s", ref.EntityID)
			if ref.EntityID == "char-gandalf" {
				foundRef = true
				break
			}
		}
	}
	if !foundRef {
		t.Error("Did not resolve 'He' to 'Gandalf'")
	}
	if !foundRef {
		t.Error("Did not resolve 'He' to 'Gandalf'")
	}
}

func TestConductorDiscovery(t *testing.T) {
	c, err := New()
	if err != nil {
		t.Fatalf("Failed to create conductor: %v", err)
	}
	defer c.Close()

	// 1. Seed Conductor with "Luffy" (Known Character)
	// We need to access the Discovery Engine directly to seed it
	// Or use SeedDiscovery if we had a proper public API for it (we have SetDictionary/SeedDiscovery from main)
	// Let's manually inject into registry for this test
	c.discoveryEngine.Registry.AddToken("Luffy")
	stats := c.discoveryEngine.Registry.GetStats("Luffy")
	stats.Status = discovery.StatusPromoted // Make it a valid source
	kind := implicitmatcher.KindCharacter
	stats.InferredKind = &kind

	// 2. Scan text with a relation: "Luffy fought Kaido."
	// "Kaido" is NOT in the dictionary and NOT explicitly tagged.
	// It should be picked up by Discovery (Capitalized + Relation)
	text := "Luffy fought Kaido."
	result := c.Scan(text)

	// 3. Verify "Kaido" is in result.Syntax
	foundKaido := false
	for _, m := range result.Syntax {
		if m.Label == "Kaido" {
			foundKaido = true
			if m.Kind != syntax.KindEntity {
				t.Errorf("Expected Kaido to be KindEntity, got %v", m.Kind)
			}
			// In the new pipeline, we set EntityKind to InferredKind (Character)
			if m.EntityKind != "CHARACTER" {
				// Note: ScanText returns DiscoveryCandidate with Kind.
				// Conductor uses cand.Kind.String().
				t.Errorf("Expected Kaido EntityKind to be CHARACTER, got %s", m.EntityKind)
			}
		}
	}

	if !foundKaido {
		t.Error("Discovery did not add 'Kaido' to Syntax matches")
	}
}

func TestConductor_Stopwords(t *testing.T) {
	c, _ := New()
	defer c.Close()

	// Seed "Raven" as known entity via Dictionary (Reliable)
	entities := []implicitmatcher.RegisteredEntity{
		{ID: "char-raven", Label: "Raven", Kind: implicitmatcher.KindCharacter},
	}
	dict, _ := implicitmatcher.Compile(entities)
	c.SetDictionary(dict)

	// Also register for resolver (though not critical for this test)
	c.resolver.RegisterEntity(resolver.EntityMetadata{ID: "char-raven", Name: "Raven"})

	text := "But the Raven flies."
	result := c.Scan(text)

	// Verify ONLY "Raven" is an entity
	foundRaven := false
	for _, m := range result.Syntax {
		if m.Kind == syntax.KindEntity {
			if m.Label == "Raven" {
				foundRaven = true
			} else {
				t.Errorf("Unexpected entity: %s (expected only 'Raven')", m.Label)
			}
		}
	}

	if !foundRaven {
		t.Error("Expected to find 'Raven' as entity")
	}

	// Verify "But" and "the" are NOT entities
	// This relies on the discovery engine filtering them out,
	// AND the implicit scanner also checking IsIgnored.
	// We can explicitly check if they appear in Syntax.
	for _, m := range result.Syntax {
		if m.Label == "But" || m.Label == "the" {
			t.Errorf("Found stopword '%s' in Syntax matches!", m.Label)
		}
	}
}

func TestConductor_MaskedEntity(t *testing.T) {
	c, _ := New()
	defer c.Close()

	// Seed "Nuclear Bomb" as a known multi-word entity
	// We need to setup implicit matcher for this test since Discovery heuristic acts on single tokens mostly
	entities := []implicitmatcher.RegisteredEntity{
		{
			ID:    "weapon-nuke",
			Label: "Nuclear Bomb",
			Kind:  implicitmatcher.KindItem,
		},
	}
	dict, _ := implicitmatcher.Compile(entities)
	c.SetDictionary(dict)

	text := "The Nuclear Bomb exploded."
	result := c.Scan(text)

	// Verify "Nuclear Bomb" is in Syntax
	foundEntity := false
	for _, m := range result.Syntax {
		if m.Label == "Nuclear Bomb" {
			foundEntity = true
			break
		}
	}
	if !foundEntity {
		t.Fatal("Did not find 'Nuclear Bomb' entity")
	}

	// Verify it was CHUNKED as a single token/unit
	// We check the Tokens list.
	foundToken := false
	for _, tok := range result.Tokens {
		if tok.Text == "Nuclear Bomb" {
			foundToken = true
			if tok.POS != chunker.ProperNoun {
				t.Errorf("Expected ProperNoun for 'Nuclear Bomb', got %v", tok.POS)
			}
		}
	}

	if !foundToken {
		t.Error("Expected 'Nuclear Bomb' to be preserved as a single token")
	}
}

func TestConductor_LiveDocument(t *testing.T) {
	c, _ := New()
	defer c.Close()

	// Seed Entites from the Document
	entities := []implicitmatcher.RegisteredEntity{
		{ID: "char-belys", Label: "Belys Vorona", Aliases: []string{"Belys"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-isolde", Label: "Isolde Eira", Aliases: []string{"Isolde"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-iriane", Label: "Iriane", Kind: implicitmatcher.KindCharacter},
		{ID: "char-kamaria", Label: "Kamaria Lunflare", Aliases: []string{"Kamaria"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-fiora", Label: "Fiora Lunflare", Aliases: []string{"Fiora"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-kai", Label: "Kai", Kind: implicitmatcher.KindCharacter},
		{ID: "loc-newton", Label: "Newton", Kind: implicitmatcher.KindPlace},
		{ID: "loc-erebus", Label: "Erebus", Kind: implicitmatcher.KindPlace},
	}
	dict, _ := implicitmatcher.Compile(entities)
	c.SetDictionary(dict)

	// Register with Gender info for Resolver
	for _, e := range entities {
		gender := resolver.GenderFemale
		if e.ID == "char-kai" {
			gender = resolver.GenderMale
		}
		if e.Kind == implicitmatcher.KindPlace {
			gender = resolver.GenderNeutral
		}
		c.resolver.RegisterEntity(resolver.EntityMetadata{ID: e.ID, Name: e.Label, Gender: gender, Aliases: e.Aliases, Kind: "CHARACTER"})
	}

	// Text snippet from user request
	text := "The Trauma: Belys (Tribrid) hates Vampires. In Erebus, Vampires/Elves/Infernals are the oppressors of Beast-kin. She sees Iriane as the enemy."

	result := c.Scan(text)

	// 1. Verify Belys and Iriane are found
	foundBelys := false
	foundIriane := false

	for _, m := range result.Syntax {
		if m.ID == "char-belys" {
			foundBelys = true
		}
		if m.ID == "char-iriane" {
			foundIriane = true
		}
	}

	if !foundBelys {
		t.Error("Failed to find Belys")
	}
	if !foundIriane {
		t.Error("Failed to find Iriane")
	}

	// 2. Verify 'She' refers to Belys
	// "Belys ... She ..." -> Recency should favor Belys.
	foundRef := false
	for _, ref := range result.ResolvedRefs {
		if ref.Text == "She" {
			t.Logf("'She' resolved to: %s", ref.EntityID)
			if ref.EntityID == "char-belys" {
				foundRef = true
			}
		}
	}
	if !foundRef {
		t.Error("Did not resolve 'She' to 'char-belys'")
	}
}
