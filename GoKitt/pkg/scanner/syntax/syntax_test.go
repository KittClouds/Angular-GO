package syntax

import (
	"testing"
)

func TestWikilinks(t *testing.T) {
	s := New()
	text := "Check [[Target]] and [[Target|Label]] links."
	matches := s.scanWikilinks(text)

	if len(matches) != 2 {
		t.Errorf("Expected 2 wikilinks, got %d", len(matches))
	}

	if matches[0].Target != "Target" || matches[0].Label != "Target" {
		t.Error("Simple wikilink failed")
	}

	if matches[1].Target != "Target" || matches[1].Label != "Label" {
		t.Error("Labeled wikilink failed")
	}
}

func TestBacklinks(t *testing.T) {
	s := New()
	text := "Refs <<Source>> and <<Source|Label>> back."
	matches := s.scanBacklinks(text)

	if len(matches) != 2 {
		t.Errorf("Expected 2 backlinks, got %d", len(matches))
	}

	if matches[0].Target != "Source" {
		t.Error("Simple backlink failed")
	}
}

func TestEntities(t *testing.T) {
	s := New()
	text := "Meet [CHARACTER:Luffy] and [!ITEM|Gum-Gum Fruit|DevilFruit]."
	matches := s.scanEntities(text)

	if len(matches) != 2 {
		t.Errorf("Expected 2 entities, got %d", len(matches))
	}

	// [CHARACTER:Luffy]
	if matches[0].EntityKind != "CHARACTER" || matches[0].Label != "Luffy" {
		t.Errorf("Standard entity failed: %+v", matches[0])
	}

	// [!ITEM|Gum-Gum Fruit|DevilFruit]
	if matches[1].EntityKind != "!ITEM" || matches[1].Label != "Gum-Gum Fruit" {
		t.Errorf("Complex entity failed: %+v", matches[1])
	}
	if matches[1].Subtype != "DevilFruit" {
		t.Errorf("Subtype failed: got %s, want DevilFruit", matches[1].Subtype)
	}
}

func TestTriples(t *testing.T) {
	s := New()
	// [Subject] -[Predicate]-> [Object]
	text := "[CHARACTER:Luffy] -[DEFEATED]-> [CHARACTER:Kaido]"
	matches := s.scanTriples(text)

	if len(matches) != 1 {
		t.Errorf("Expected 1 triple, got %d", len(matches))
	}

	m := matches[0]
	if m.Subject != "Luffy" || m.Predicate != "DEFEATED" || m.Object != "Kaido" {
		t.Errorf("Triple failed check: %+v", m)
	}
}

func TestInlineRelations(t *testing.T) {
	s := New()
	text := "Saw [CHARACTER:Luffy@CAPTAIN] there."
	matches := s.scanInlineRelations(text)

	if len(matches) != 1 {
		t.Errorf("Expected 1 inline relation, got %d", len(matches))
	}

	m := matches[0]
	if m.EntityKind != "CHARACTER" || m.Label != "Luffy" || m.Predicate != "CAPTAIN" {
		t.Errorf("Inline relation failed check: %+v", m)
	}
}

func TestTags(t *testing.T) {
	s := New()
	text := "Valid #tag and #valid-tag. Invalid # empty tag."
	matches := s.scanTags(text)

	if len(matches) != 2 {
		t.Errorf("Expected 2 tags, got %d", len(matches))
	}

	if matches[0].Label != "tag" {
		t.Errorf("First tag failed: %s", matches[0].Label)
	}
	if matches[1].Label != "valid-tag" {
		t.Errorf("Second tag failed: %s", matches[1].Label)
	}
}

func TestMentions(t *testing.T) {
	s := New()
	text := "Hello @user-name!"
	matches := s.scanMentions(text)

	if len(matches) != 1 {
		t.Errorf("Expected 1 mention, got %d", len(matches))
	}

	if matches[0].Label != "user-name" {
		t.Errorf("Mention failed: %s", matches[0].Label)
	}
}

func TestFullScan(t *testing.T) {
	s := New()
	text := "[[Wiki]] [CHARACTER:Hero] #tag"
	matches := s.Scan(text)

	if len(matches) != 3 {
		t.Errorf("Expected 3 matches, got %d", len(matches))
	}
}
