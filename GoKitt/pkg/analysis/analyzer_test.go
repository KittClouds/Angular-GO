package analysis

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/scanner/chunker"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
)

// mockScanResult creates a minimal ScanResult for testing
func mockScanResult(text string, tokens []chunker.Token, refs []conductor.ResolvedReference) conductor.ScanResult {
	return conductor.ScanResult{
		Text:         text,
		Tokens:       tokens,
		ResolvedRefs: refs,
	}
}

func TestFlowScore_High(t *testing.T) {
	g := graph.NewGraph()
	a := NewAnalyzer(g)

	// "Luffy saw Zoro. Zoro ate meat."
	// Sentence 1: Luffy, Zoro
	// Sentence 2: Zoro, Meat
	// Shared entity: Zoro -> Should be high score

	text := "Luffy saw Zoro. Zoro ate meat."
	tokens := []chunker.Token{
		{Text: "Luffy", Range: chunker.TextRange{Start: 0, End: 5}},
		{Text: "saw", Range: chunker.TextRange{Start: 6, End: 9}},
		{Text: "Zoro", Range: chunker.TextRange{Start: 10, End: 14}},
		{Text: ".", Range: chunker.TextRange{Start: 14, End: 15}},
		{Text: "Zoro", Range: chunker.TextRange{Start: 16, End: 20}},
		{Text: "ate", Range: chunker.TextRange{Start: 21, End: 24}},
		{Text: "meat", Range: chunker.TextRange{Start: 25, End: 29}},
		{Text: ".", Range: chunker.TextRange{Start: 29, End: 30}},
	}
	refs := []conductor.ResolvedReference{
		{Text: "Luffy", EntityID: "e1", Range: chunker.TextRange{Start: 0, End: 5}},
		{Text: "Zoro", EntityID: "e2", Range: chunker.TextRange{Start: 10, End: 14}},
		{Text: "Zoro", EntityID: "e2", Range: chunker.TextRange{Start: 16, End: 20}},
		{Text: "meat", EntityID: "e3", Range: chunker.TextRange{Start: 25, End: 29}},
	}

	res := mockScanResult(text, tokens, refs)
	metrics := a.Analyze(res)

	if metrics.FlowScore < 80 {
		t.Errorf("Expected high flow score for direct link, got %f", metrics.FlowScore)
	}
}

func TestFlowScore_Indirect(t *testing.T) {
	g := graph.NewGraph()
	// Luffy -> crew -> Nami
	luffy := g.EnsureNode("e1", "Luffy", "CHAR")
	nami := g.EnsureNode("e4", "Nami", "CHAR")
	g.AddEdge(luffy, nami, &graph.ConceptEdge{Relation: "CREW"})

	a := NewAnalyzer(g)

	// "Luffy slept. Nami woke up."
	// S1: Luffy (e1)
	// S2: Nami (e4)
	// No direct overlap, but e1-e4 connected in graph.

	text := "Luffy slept. Nami woke up."
	tokens := []chunker.Token{
		{Text: "Luffy", Range: chunker.TextRange{Start: 0, End: 5}},
		{Text: ".", Range: chunker.TextRange{Start: 11, End: 12}},
		{Text: "Nami", Range: chunker.TextRange{Start: 13, End: 17}},
		{Text: ".", Range: chunker.TextRange{Start: 25, End: 26}},
	}
	refs := []conductor.ResolvedReference{
		{Text: "Luffy", EntityID: "e1", Range: chunker.TextRange{Start: 0, End: 5}},
		{Text: "Nami", EntityID: "e4", Range: chunker.TextRange{Start: 13, End: 17}},
	}

	res := mockScanResult(text, tokens, refs)
	metrics := a.Analyze(res)

	if metrics.FlowScore < 60 {
		t.Errorf("Expected moderate flow score for indirect link, got %f", metrics.FlowScore)
	}
}

func TestFlowScore_Low(t *testing.T) {
	g := graph.NewGraph()
	a := NewAnalyzer(g)

	// "Luffy slept. The car exploded."
	// S1: Luffy (e1)
	// S2: Car (e5)
	// Disconnected.

	text := "Luffy slept. The car exploded."
	tokens := []chunker.Token{
		{Text: "Luffy", Range: chunker.TextRange{Start: 0, End: 5}},
		{Text: ".", Range: chunker.TextRange{Start: 11, End: 12}},
		{Text: "car", Range: chunker.TextRange{Start: 17, End: 20}},
		{Text: ".", Range: chunker.TextRange{Start: 29, End: 30}},
	}
	refs := []conductor.ResolvedReference{
		{Text: "Luffy", EntityID: "e1", Range: chunker.TextRange{Start: 0, End: 5}},
		{Text: "car", EntityID: "e5", Range: chunker.TextRange{Start: 17, End: 20}},
	}

	res := mockScanResult(text, tokens, refs)
	metrics := a.Analyze(res)

	// Should drop from 100 base.
	// 70 (base) - 20 (new entity disconnected) = 50.
	// Smoothed with 100 -> ~85 first step?
	// Wait, scores list: [100, smoothed_val]. Avg of those.

	if metrics.FlowScore > 90 {
		t.Errorf("Expected lower flow score for disconnect, got %f", metrics.FlowScore)
	}
}
