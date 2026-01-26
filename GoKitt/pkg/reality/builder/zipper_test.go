package builder

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/reality/syntax"
	"github.com/kittclouds/gokitt/pkg/scanner/chunker"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
)

func TestZipperHierarchical(t *testing.T) {
	text := "The wizard arrived. He cast a spell."
	//       012345678901234567890123456789012345
	//       "The wizard" (0-10) NP
	//                   "arrived" (11-18) VP
	//                           "He" (20-22) NP
	//                              "cast" (23-27) VP
	//                                   "a spell" (28-35) NP

	// Sentence 1: 0..19 ("The wizard arrived.")
	// Sentence 2: 20..36 ("He cast a spell.")

	scan := conductor.ScanResult{
		Text: text,
		Chunks: []chunker.Chunk{
			{Kind: chunker.NounPhrase, Range: chunker.NewRange(0, 10)},
			{Kind: chunker.VerbPhrase, Range: chunker.NewRange(11, 18)},
			{Kind: chunker.NounPhrase, Range: chunker.NewRange(20, 22)},
			{Kind: chunker.VerbPhrase, Range: chunker.NewRange(23, 27)},
			{Kind: chunker.NounPhrase, Range: chunker.NewRange(28, 35)},
		},
		// No explicit entities for this test
	}

	root := Zip(text, scan)

	if root.Kind != syntax.KindDocument {
		t.Errorf("Expected Root Document, got %s", root.Kind)
	}

	// Should have 1 Paragraph (default split by \n\n, here just text)
	// Actually logic says splitRanges(text, "\n\n"). If no \n\n, returns whole text as 1 range?
	// splitRanges implementation: strings.Split -> 1 part.
	// So 1 Paragraph.
	if len(root.Children) != 1 {
		t.Fatalf("Expected 1 Paragraph, got %d", len(root.Children))
	}
	para := root.Children[0]
	if para.Kind != syntax.KindParagraph {
		t.Errorf("Expected Paragraph, got %s", para.Kind)
	}

	// Should have 2 Sentences
	// "The wizard arrived." and "He cast a spell."
	// Count children of Paragraph that are Sentences
	sentCount := 0
	for _, c := range para.Children {
		if c.Kind == syntax.KindSentence {
			sentCount++
		}
	}
	if sentCount != 2 {
		t.Errorf("Expected 2 Sentences, got %d", sentCount)
	}

	// Check Sentence 1 Children (NPs, VPs, Words)
	s1 := para.Children[0] // Assuming first child is Sentence 1 (might have whitespace before/after?)
	// Sentences function splits by punctuation.
	// Ranges: 0..19, 20..36.
	// The space at 19 might be a gap (Whitespace token) attached to Paragraph?
	// Zipper fills gaps. If gaps are *inside* Paragraph range but *outside* Sentence ranges, they are children of Paragraph.

	// Let's print tree for debugging if it fails
	t.Logf("Tree:\n%s", root.String(text))

	// Verify "The wizard" is an NP inside Sentence 1
	foundNP := false
	for _, c := range s1.Children {
		if c.Kind == syntax.KindNounPhrase {
			if c.Text(text) == "The wizard" {
				foundNP = true
			}
		}
	}
	if !foundNP {
		t.Error("Did not find NP 'The wizard' in first sentence")
	}
}
