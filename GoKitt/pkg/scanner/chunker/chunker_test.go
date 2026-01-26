package chunker

import "testing"

func TestTokenize(t *testing.T) {
	c := New()
	ranges := c.tokenize("The ancient wizard walked.")

	// "The", "ancient", "wizard", "walked", "."
	if len(ranges) != 5 {
		t.Errorf("Expected 5 tokens, got %d", len(ranges))
	}

	text := "The ancient wizard walked."
	if ranges[0].Slice(text) != "The" {
		t.Errorf("First token should be 'The', got '%s'", ranges[0].Slice(text))
	}
}

func TestNounPhraseSimple(t *testing.T) {
	c := New()
	result := c.Chunk("wizard")

	nps := filterByKind(result.Chunks, NounPhrase)
	if len(nps) != 1 {
		t.Errorf("Expected 1 NP, got %d", len(nps))
	}
}

func TestNounPhraseDetNoun(t *testing.T) {
	c := New()
	text := "the wizard"
	result := c.Chunk(text)

	nps := filterByKind(result.Chunks, NounPhrase)
	if len(nps) != 1 {
		t.Errorf("Expected 1 NP, got %d", len(nps))
		return
	}

	np := nps[0]
	if np.HeadText(text) != "wizard" {
		t.Errorf("Head should be 'wizard', got '%s'", np.HeadText(text))
	}
	if np.Text(text) != "the wizard" {
		t.Errorf("Full NP should be 'the wizard', got '%s'", np.Text(text))
	}
}

func TestNounPhraseDetAdjNoun(t *testing.T) {
	c := New()
	text := "the ancient wizard"
	result := c.Chunk(text)

	nps := filterByKind(result.Chunks, NounPhrase)
	if len(nps) != 1 {
		t.Errorf("Expected 1 NP, got %d", len(nps))
		return
	}

	np := nps[0]
	if np.HeadText(text) != "wizard" {
		t.Errorf("Head should be 'wizard', got '%s'", np.HeadText(text))
	}
	if len(np.Modifiers) != 2 {
		t.Errorf("Expected 2 modifiers (det+adj), got %d", len(np.Modifiers))
	}
}

func TestVerbPhrase(t *testing.T) {
	c := New()
	text := "walked quickly"
	result := c.Chunk(text)

	vps := filterByKind(result.Chunks, VerbPhrase)
	if len(vps) != 1 {
		t.Errorf("Expected 1 VP, got %d", len(vps))
		return
	}

	vp := vps[0]
	if vp.HeadText(text) != "walked" {
		t.Errorf("Head should be 'walked', got '%s'", vp.HeadText(text))
	}
}

func TestVerbPhraseWithAuxiliary(t *testing.T) {
	c := New()
	text := "was walking slowly"
	result := c.Chunk(text)

	vps := filterByKind(result.Chunks, VerbPhrase)
	if len(vps) != 1 {
		t.Errorf("Expected 1 VP, got %d", len(vps))
		return
	}

	vp := vps[0]
	if vp.Text(text) != "was walking slowly" {
		t.Errorf("VP should be 'was walking slowly', got '%s'", vp.Text(text))
	}
}

func TestPrepPhrase(t *testing.T) {
	c := New()
	text := "in the forest"
	result := c.Chunk(text)

	pps := filterByKind(result.Chunks, PrepPhrase)
	if len(pps) != 1 {
		t.Errorf("Expected 1 PP, got %d", len(pps))
		return
	}

	pp := pps[0]
	if pp.HeadText(text) != "in" {
		t.Errorf("PP head should be 'in', got '%s'", pp.HeadText(text))
	}
	if pp.Text(text) != "in the forest" {
		t.Errorf("PP should be 'in the forest', got '%s'", pp.Text(text))
	}
}

func TestMixedChunks(t *testing.T) {
	c := New()
	text := "The wizard walked through the forest."
	result := c.Chunk(text)

	nps := filterByKind(result.Chunks, NounPhrase)
	vps := filterByKind(result.Chunks, VerbPhrase)
	pps := filterByKind(result.Chunks, PrepPhrase)

	// "The wizard" is NP, but "walked" is also VP, and "through the forest" is PP
	// PP consumes its NP internally
	if len(nps) < 1 {
		t.Error("Should find at least 1 NP")
	}
	if len(vps) < 1 {
		t.Error("Should find at least 1 VP")
	}
	if len(pps) < 1 {
		t.Error("Should find at least 1 PP")
	}
}

func TestProperNounDetection(t *testing.T) {
	c := New()
	text := "Gandalf walked"
	result := c.Chunk(text)

	// Gandalf should be detected as ProperNoun -> becomes NP
	nps := filterByKind(result.Chunks, NounPhrase)
	if len(nps) < 1 {
		t.Error("Should detect 'Gandalf' as NP")
	}
}

func TestTextRange(t *testing.T) {
	r := NewRange(0, 5)
	if r.Len() != 5 {
		t.Errorf("Len should be 5, got %d", r.Len())
	}

	text := "hello world"
	if r.Slice(text) != "hello" {
		t.Errorf("Slice should be 'hello', got '%s'", r.Slice(text))
	}

	r2 := NewRange(6, 11)
	if r2.Slice(text) != "world" {
		t.Errorf("Slice should be 'world', got '%s'", r2.Slice(text))
	}
}

// Helper
func filterByKind(chunks []Chunk, kind ChunkKind) []Chunk {
	var out []Chunk
	for _, c := range chunks {
		if c.Kind == kind {
			out = append(out, c)
		}
	}
	return out
}
