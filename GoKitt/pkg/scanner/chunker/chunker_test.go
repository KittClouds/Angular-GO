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
	result := c.Chunk("wizard", nil)

	nps := filterByKind(result.Chunks, NounPhrase)
	if len(nps) != 1 {
		t.Errorf("Expected 1 NP, got %d", len(nps))
	}
}

func TestNounPhraseDetNoun(t *testing.T) {
	c := New()
	text := "the wizard"
	result := c.Chunk(text, nil)

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
	result := c.Chunk(text, nil)

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
	result := c.Chunk(text, nil)

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
	result := c.Chunk(text, nil)

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
	result := c.Chunk(text, nil)

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
	result := c.Chunk(text, nil)

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
	result := c.Chunk(text, nil)

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

// ============================================================================
// Mask-Aware Chunking Tests
// ============================================================================

func TestChunker_WithMask_EntityPreserved(t *testing.T) {
	c := New()
	text := "The Nuclear Bomb exploded"

	// "Nuclear Bomb" is a detected entity (positions 4-16)
	mask := NewIntervalMask()
	mask.Add(4, 16, "WEAPON", "nuclear-bomb")

	result := c.Chunk(text, mask)

	// Verify "Nuclear Bomb" is ONE token, not two
	foundEntityToken := false
	for _, tok := range result.Tokens {
		if tok.Text == "Nuclear Bomb" {
			foundEntityToken = true
			if tok.POS != ProperNoun {
				t.Errorf("Expected ProperNoun for entity token, got %v", tok.POS)
			}
		}
	}

	if !foundEntityToken {
		t.Error("Expected to find 'Nuclear Bomb' as single token")
	}

	// Verify "The" and "exploded" are still separate tokens
	foundThe := false
	foundExploded := false
	for _, tok := range result.Tokens {
		if tok.Text == "The" {
			foundThe = true
		}
		if tok.Text == "exploded" {
			foundExploded = true
		}
	}

	if !foundThe {
		t.Error("Expected to find 'The' as separate token")
	}
	if !foundExploded {
		t.Error("Expected to find 'exploded' as separate token")
	}
}

func TestChunker_WithMask_StopwordsNotEntities(t *testing.T) {
	c := New()
	text := "But the Raven flies."

	// "Raven" is a detected entity (positions 8-13)
	mask := NewIntervalMask()
	mask.Add(8, 13, "CHARACTER", "raven")

	result := c.Chunk(text, mask)

	// Verify ONLY "Raven" has ProperNoun POS
	entityCount := 0
	for _, tok := range result.Tokens {
		if tok.POS == ProperNoun {
			entityCount++
			if tok.Text != "Raven" {
				t.Errorf("Unexpected ProperNoun token: %s", tok.Text)
			}
		}
	}

	if entityCount != 1 {
		t.Errorf("Expected exactly 1 ProperNoun token (Raven), got %d", entityCount)
	}

	// Verify "But" and "the" are NOT ProperNoun
	for _, tok := range result.Tokens {
		if tok.Text == "But" && tok.POS == ProperNoun {
			t.Error("'But' should NOT be ProperNoun")
		}
		if tok.Text == "the" && tok.POS == ProperNoun {
			t.Error("'the' should NOT be ProperNoun")
		}
	}
}

func TestChunker_WithMask_MultipleEntities(t *testing.T) {
	c := New()
	text := "Raven flew to Erebus"

	// "Raven" (0-5) and "Erebus" (13-19) are entities
	mask := NewIntervalMask()
	mask.Add(0, 5, "CHARACTER", "raven")
	mask.Add(13, 19, "LOCATION", "erebus")

	result := c.Chunk(text, mask)

	// Count ProperNoun tokens
	properNouns := 0
	for _, tok := range result.Tokens {
		if tok.POS == ProperNoun {
			properNouns++
		}
	}

	if properNouns != 2 {
		t.Errorf("Expected 2 ProperNoun tokens, got %d", properNouns)
	}

	// Verify the mask is included in result
	if result.Mask == nil {
		t.Error("Mask should be included in ChunkResult")
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
