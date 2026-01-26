package conductor

import (
	"strings"
	"testing"
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
}
