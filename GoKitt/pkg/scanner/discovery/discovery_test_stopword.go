package discovery

import (
	"testing"

	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
)

// ... existing tests ...

func TestDiscoveryEngine_StopWords_CandidateSuppression(t *testing.T) {
	// 1. Setup Matcher
	matcher, err := narrative.New()
	if err != nil {
		t.Fatalf("Failed to create narrative matcher: %v", err)
	}
	defer matcher.Close()

	// 2. Setup Engine (threshold 1)
	engine := NewEngine(1, matcher)

	// 3. Pre-seed "Fiora" (Character)
	engine.Registry.AddToken("Fiora")
	stats := engine.Registry.GetStats("Fiora")
	stats.Status = StatusPromoted
	kind := implicitmatcher.KindCharacter
	stats.InferredKind = &kind

	// 4. Run Scan with a Stopword target: "Fiora Is The Best"
	// "Fiora" (Src) + "Is" (Verb) -> "The" (Target)
	// "The" is a known stopword in nerStopwords and standard list.
	// It should be REJECTED.
	text := "Fiora Is The Best"
	candidates := engine.ScanText(text)

	// 5. Verify "The" is NOT in candidates
	for _, c := range candidates {
		if c.Text == "The" {
			t.Error("Stopword 'The' should NOT be returned as a candidate")
		}
	}

	// 6. Verify "The" is NOT in Registry
	if engine.Registry.GetStats("The") != nil {
		t.Error("Stopword 'The' should NOT be added to registry stats")
	}
}
