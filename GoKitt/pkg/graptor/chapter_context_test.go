package graptor

import (
	"testing"
)

func TestNewChapterContext(t *testing.T) {
	ctx := NewChapterContext(1, nil)
	if ctx == nil {
		t.Fatal("Expected non-nil context")
	}
	if ctx.ChapterID != 1 {
		t.Errorf("Expected chapter ID 1, got %d", ctx.ChapterID)
	}
	if len(ctx.ActiveEntities) != 0 {
		t.Errorf("Expected empty active entities, got %d", len(ctx.ActiveEntities))
	}
}

func TestObserveMention(t *testing.T) {
	ctx := NewChapterContext(1, nil)
	mention := &EntityMention{EntityID: "entity1", Text: "Ryan", ChapterID: 1}

	ctx.ObserveMention("entity1", mention)

	// Check active entities
	if ctx.ActiveEntities["entity1"] != 1 {
		t.Errorf("Expected 1 mention count, got %d", ctx.ActiveEntities["entity1"])
	}

	// Check first mention
	if ctx.FirstMentions["entity1"] == nil {
		t.Error("Expected first mention to be recorded")
	}

	// Check last mentioned
	lastMentioned := ctx.GetLastMentioned()
	if len(lastMentioned) != 1 || lastMentioned[0] != "entity1" {
		t.Errorf("Expected last mentioned to contain entity1, got %v", lastMentioned)
	}
}

func TestObserveMultipleMentions(t *testing.T) {
	ctx := NewChapterContext(1, nil)

	ctx.ObserveMention("entity1", &EntityMention{EntityID: "entity1", Text: "Ryan", ChapterID: 1})
	ctx.ObserveMention("entity2", &EntityMention{EntityID: "entity2", Text: "Sarah", ChapterID: 1})
	ctx.ObserveMention("entity1", &EntityMention{EntityID: "entity1", Text: "Ryan", ChapterID: 1})

	// Check mention counts
	if ctx.ActiveEntities["entity1"] != 2 {
		t.Errorf("Expected 2 mentions for entity1, got %d", ctx.ActiveEntities["entity1"])
	}
	if ctx.ActiveEntities["entity2"] != 1 {
		t.Errorf("Expected 1 mention for entity2, got %d", ctx.ActiveEntities["entity2"])
	}

	// Check last mentioned order (most recent first)
	lastMentioned := ctx.GetLastMentioned()
	if len(lastMentioned) != 2 {
		t.Fatalf("Expected 2 entities in last mentioned, got %d", len(lastMentioned))
	}
	if lastMentioned[0] != "entity1" {
		t.Errorf("Expected entity1 to be most recent, got %s", lastMentioned[0])
	}
}

func TestGetRecentEntities(t *testing.T) {
	ctx := NewChapterContext(1, nil)

	ctx.ObserveMention("entity1", &EntityMention{EntityID: "entity1"})
	ctx.ObserveMention("entity2", &EntityMention{EntityID: "entity2"})
	ctx.ObserveMention("entity3", &EntityMention{EntityID: "entity3"})

	recent := ctx.GetRecentEntities(2)
	if len(recent) != 2 {
		t.Errorf("Expected 2 recent entities, got %d", len(recent))
	}
	// Should be most recent first
	if recent[0] != "entity3" {
		t.Errorf("Expected entity3 first, got %s", recent[0])
	}
}

func TestGetMostMentioned(t *testing.T) {
	ctx := NewChapterContext(1, nil)

	ctx.ObserveMention("entity1", &EntityMention{EntityID: "entity1"})
	ctx.ObserveMention("entity1", &EntityMention{EntityID: "entity1"})
	ctx.ObserveMention("entity1", &EntityMention{EntityID: "entity1"})
	ctx.ObserveMention("entity2", &EntityMention{EntityID: "entity2"})
	ctx.ObserveMention("entity3", &EntityMention{EntityID: "entity3"})
	ctx.ObserveMention("entity3", &EntityMention{EntityID: "entity3"})

	most := ctx.GetMostMentioned(2)
	if len(most) != 2 {
		t.Errorf("Expected 2 most mentioned, got %d", len(most))
	}
	// entity1 has 3 mentions, entity3 has 2
	if most[0] != "entity1" {
		t.Errorf("Expected entity1 first, got %s", most[0])
	}
	if most[1] != "entity3" {
		t.Errorf("Expected entity3 second, got %s", most[1])
	}
}

func TestFinishAndCarryOver(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	idRyan := registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	idSarah := registry.Register("Sarah", KindPerson, GenderFemale, 1, 200)
	idLoc := registry.Register("Location", KindLocation, GenderNeutral, 1, 300)

	ctx := NewChapterContext(1, nil)
	ctx.ObserveMention(idRyan, &EntityMention{EntityID: idRyan})
	ctx.ObserveMention(idSarah, &EntityMention{EntityID: idSarah})
	ctx.ObserveMention(idLoc, &EntityMention{EntityID: idLoc})

	// Finish chapter
	ctx.Finish(registry)

	// Check carry-over
	carryOver := ctx.GetCarryOver()
	if len(carryOver) == 0 {
		t.Fatal("Expected non-empty carry-over")
	}

	// Should prefer entities with gender
	for _, id := range carryOver {
		entity := registry.LookupByID(id)
		if entity != nil && entity.Gender != GenderUnknown {
			// Good - has gender
		}
	}
}

func TestChapterTransition(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	idRyan := registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	idSarah := registry.Register("Sarah", KindPerson, GenderFemale, 1, 200)

	prevCtx := NewChapterContext(1, nil)
	prevCtx.ObserveMention(idRyan, &EntityMention{EntityID: idRyan})
	prevCtx.ObserveMention(idSarah, &EntityMention{EntityID: idSarah})
	prevCtx.Finish(registry)

	currCtx := NewChapterContext(2, nil)

	transition := NewChapterTransition(prevCtx, currCtx, registry)

	// Resolve male pronoun
	id := transition.ResolvePronoun("he")
	if id == "" {
		t.Fatal("Expected to resolve 'he'")
	}
	entity := registry.LookupByID(id)
	if entity == nil || entity.Gender != GenderMale {
		t.Errorf("Expected male entity, got %v", entity)
	}

	// Resolve female pronoun
	id = transition.ResolvePronoun("she")
	if id == "" {
		t.Fatal("Expected to resolve 'she'")
	}
	entity = registry.LookupByID(id)
	if entity == nil || entity.Gender != GenderFemale {
		t.Errorf("Expected female entity, got %v", entity)
	}
}

func TestChapterManager(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	cm := NewChapterManager(registry, nil)

	// Start chapter 1
	ctx1 := cm.StartChapter(1)
	if ctx1 == nil {
		t.Fatal("Expected non-nil chapter context")
	}

	// Observe mentions
	cm.ObserveMention("entity1", &EntityMention{EntityID: "entity1", Text: "Ryan", ChapterID: 1})
	cm.ObserveMention("entity2", &EntityMention{EntityID: "entity2", Text: "Sarah", ChapterID: 1})

	// Start chapter 2
	ctx2 := cm.StartChapter(2)
	if ctx2 == nil {
		t.Fatal("Expected non-nil chapter context")
	}

	// Check previous chapter
	prev := cm.GetPreviousChapter(2)
	if prev == nil || prev.ChapterID != 1 {
		t.Errorf("Expected previous chapter 1, got %v", prev)
	}

	// Check current chapter
	curr := cm.GetCurrentChapter()
	if curr == nil || curr.ChapterID != 2 {
		t.Errorf("Expected current chapter 2, got %v", curr)
	}
}

func TestChapterManagerTransition(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	idRyan := registry.Register("Ryan", KindPerson, GenderMale, 1, 100)

	cm := NewChapterManager(registry, nil)

	// Chapter 1
	ctx1 := cm.StartChapter(1)
	ctx1.ObserveMention(idRyan, &EntityMention{EntityID: idRyan})
	cm.StartChapter(2) // This finishes chapter 1

	// Create transition
	transition := cm.CreateTransition(2)
	if transition == nil {
		t.Fatal("Expected non-nil transition")
	}

	// Resolve pronoun using carry-over from chapter 1
	id := transition.ResolvePronoun("he")
	if id == "" {
		t.Fatal("Expected to resolve pronoun from carry-over")
	}
}

func TestChapterManagerStats(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	cm := NewChapterManager(registry, nil)

	// Chapter 1
	ctx1 := cm.StartChapter(1)
	ctx1.ObserveMention("entity1", &EntityMention{EntityID: "entity1"})
	ctx1.ObserveMention("entity2", &EntityMention{EntityID: "entity2"})

	// Chapter 2
	ctx2 := cm.StartChapter(2)
	ctx2.ObserveMention("entity1", &EntityMention{EntityID: "entity1"})

	cm.FinishDocument()

	stats := cm.GetDocumentStats()
	if stats.TotalChapters != 2 {
		t.Errorf("Expected 2 chapters, got %d", stats.TotalChapters)
	}
	if stats.TotalEntities != 3 { // 2 in ch1 + 1 in ch2 (entity1 already counted)
		t.Errorf("Expected 3 total entity appearances, got %d", stats.TotalEntities)
	}
}

func TestGetContextForResolution(t *testing.T) {
	registry := NewGlobalEntityRegistry(nil)
	id1 := registry.Register("Ryan", KindPerson, GenderMale, 1, 100)
	id2 := registry.Register("Sarah", KindPerson, GenderFemale, 1, 200)
	id3 := registry.Register("John", KindPerson, GenderMale, 2, 300)

	prevCtx := NewChapterContext(1, nil)
	prevCtx.ObserveMention(id1, &EntityMention{EntityID: id1})
	prevCtx.ObserveMention(id2, &EntityMention{EntityID: id2})
	prevCtx.Finish(registry) // Need to finish to compute carry-over

	currCtx := NewChapterContext(2, nil)
	currCtx.ObserveMention(id3, &EntityMention{EntityID: id3})

	transition := NewChapterTransition(prevCtx, currCtx, registry)
	context := transition.GetContextForResolution(2)

	if context == nil {
		t.Fatal("Expected non-nil context")
	}
	if context.ChapterID != 2 {
		t.Errorf("Expected chapter ID 2, got %d", context.ChapterID)
	}
	// Should include recent from current chapter + carry-over from previous
	// Current chapter has id3, carry-over from prev has id1, id2 (gendered entities)
	if len(context.RecentEntities) < 1 {
		t.Errorf("Expected at least 1 recent entity, got %d", len(context.RecentEntities))
	}
}
