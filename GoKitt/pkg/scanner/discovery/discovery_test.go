package discovery

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/dafsa"
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
	kind := dafsa.KindCharacter
	stats.InferredKind = &kind

	// 4. Run Scan: "Luffy fought Kaido"
	// "Luffy" (Known Promoted Source) + "fought" (Verb) -> Infer Target "Kaido"
	text := "Luffy fought Kaido"
	engine.ScanText(text)

	// 5. Verify "Kaido" is discovered
	kaidoStats := engine.Registry.GetStats("Kaido")
	if kaidoStats == nil {
		t.Fatal("Expected 'Kaido' to be discovered")
	}

	if kaidoStats.Status != StatusPromoted {
		t.Errorf("Expected 'Kaido' to be Promoted (count %d), got status %v", kaidoStats.Count, kaidoStats.Status)
	}

	if kaidoStats.InferredKind == nil {
		t.Error("Expected 'Kaido' to have an inferred kind")
	} else if *kaidoStats.InferredKind != dafsa.KindCharacter {
		t.Errorf("Expected 'Kaido' to be inferred as Character, got %v", *kaidoStats.InferredKind)
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
