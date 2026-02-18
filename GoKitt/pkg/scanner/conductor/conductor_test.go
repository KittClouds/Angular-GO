package conductor

import (
	"strings"
	"testing"

	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/scanner/discovery"
	"github.com/kittclouds/gokitt/pkg/scanner/syntax"
)

func TestConductorFullPipeline(t *testing.T) {
	c, err := New()
	if err != nil {
		t.Fatalf("Failed to create conductor: %v", err)
	}
	defer c.Close()

	// Text: "Gandalf traveled to the mountain. He defeated the balrog."
	text := "[CHARACTER:Gandalf] traveled to [LOCATION:Mountain]. He defeated the [MONSTER:Balrog]."

	result := c.Scan(text)

	// 1. Verify Syntax (Explicit Tags)
	// We expect [CHARACTER:Gandalf], [LOCATION:Mountain], [MONSTER:Balrog]
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
		if ref.Text == "He" && ref.EntityID == "Gandalf" {
			foundRef = true
			break
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
