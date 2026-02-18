package discovery

import (
	"testing"

	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
)

func TestDiscoveryEngine_ScanText(t *testing.T) {
	// 1. Setup Matcher
	matcher, err := narrative.New()
	if err != nil {
		t.Fatalf("Failed to create narrative matcher: %v", err)
	}
	defer matcher.Close()

	// 2. Setup Engine (threshold 1 for immediate promotion)
	engine := NewEngine(1, matcher)

	// 3. Pre-seed "Luffy" as a known Promoted Character
	// Using AddToken + direct manipulation to simulate a known entity
	engine.Registry.AddToken("Luffy")
	stats := engine.Registry.GetStats("Luffy")
	stats.Status = StatusPromoted
	kind := implicitmatcher.KindCharacter
	stats.InferredKind = &kind

	// 4. Run Scan: "Luffy fought Kaido"
	// "Luffy" (Known Promoted Source) + "fought" (Verb) -> Infer Target "Kaido"
	text := "Luffy fought Kaido"
	candidates := engine.ScanText(text)
	t.Logf("Candidates: %+v", candidates)

	// 5. Verify "Kaido" is found as a candidate
	if len(candidates) == 0 {
		t.Fatal("Expected candidates, got 0")
	}
	found := false
	for _, c := range candidates {
		if c.Text == "Kaido" {
			found = true
			if c.Kind == nil || *c.Kind != implicitmatcher.KindCharacter {
				t.Errorf("Expected candidate Kaido to be Character, got %v", c.Kind)
			}
		}
	}
	if !found {
		t.Error("Expected 'Kaido' to be in candidates")
	}

	// 6. Verify Registry Side-Effects (still happens for now/legacy?)
	// Actually, in the new design, the Conductor decides whether to promote.
	// But ScanText still calls ObserveRelation which calls ProposeInference.
	// So the registry *should* be updated.
	kaidoStats := engine.Registry.GetStats("Kaido")
	if kaidoStats == nil {
		t.Fatal("Expected 'Kaido' to be in registry")
	}
	// Note: It might not be PROMOTED yet unless we manually promote it or the threshold is hit.
	// In this test, NewEngine(1, ...) means threshold is 1.
	// ProposeInference increments inference count.

	if kaidoStats.InferredKind == nil {
		t.Error("Expected 'Kaido' to have an inferred kind in registry")
	} else if *kaidoStats.InferredKind != implicitmatcher.KindCharacter {
		t.Errorf("Expected 'Kaido' registry kind to be Character, got %v", *kaidoStats.InferredKind)
	}
}

func TestDiscoveryEngine_StopWords(t *testing.T) {
	// 1. Setup Matcher
	matcher, err := narrative.New()
	if err != nil {
		t.Fatalf("Failed to create narrative matcher: %v", err)
	}
	defer matcher.Close()

	engine := NewEngine(1, matcher)

	// 2. Add Stopword
	engine.Registry.AddStopWord("The")

	// 3. Try to add "The"
	if engine.Registry.AddToken("The") {
		t.Error("Should not promote stopword 'The'")
	}

	if engine.Registry.GetStats("The") != nil {
		t.Error("Stopword 'The' should not have stats")
	}
}
