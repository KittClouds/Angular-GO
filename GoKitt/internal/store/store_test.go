package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Store Factory for Testing Both Implementations
// =============================================================================

// storeFactory creates a store for testing.
// We test both MemStore and SQLiteStore with the same test suite.
type storeFactory func() (Storer, error)

func memStoreFactory() (Storer, error) {
	return NewMemStore(), nil
}

func sqliteStoreFactory() (Storer, error) {
	return NewSQLiteStore()
}

// runTestsForAllStores runs a test function against both store implementations.
func runTestsForAllStores(t *testing.T, testName string, testFn func(t *testing.T, store Storer)) {
	factories := map[string]storeFactory{
		"MemStore":    memStoreFactory,
		"SQLiteStore": sqliteStoreFactory,
	}

	for name, factory := range factories {
		t.Run(name+"/"+testName, func(t *testing.T) {
			store, err := factory()
			require.NoError(t, err, "Failed to create store")
			defer store.Close()
			testFn(t, store)
		})
	}
}

// =============================================================================
// Store Initialization Tests
// =============================================================================

func TestStoreCreation(t *testing.T) {
	runTestsForAllStores(t, "Creation", func(t *testing.T, store Storer) {
		require.NotNil(t, store, "Store should not be nil")
	})
}

// =============================================================================
// Note CRUD Tests
// =============================================================================

func TestNoteUpsertAndGet(t *testing.T) {
	runTestsForAllStores(t, "UpsertAndGet", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()
		note := &Note{
			ID:              "note-1",
			WorldID:         "world-1",
			Title:           "Test Note",
			Content:         `{"type":"doc","content":[]}`,
			MarkdownContent: "# Test Note\nHello world",
			FolderID:        "folder-1",
			EntityKind:      "CHAPTER",
			EntitySubtype:   "",
			IsEntity:        false,
			IsPinned:        true,
			Favorite:        false,
			OwnerID:         "user-1",
			NarrativeID:     "narrative-1",
			Order:           1000.0,
			CreatedAt:       now,
			UpdatedAt:       now,
		}

		// Insert
		err := store.UpsertNote(note)
		require.NoError(t, err, "UpsertNote should not error")

		// Get
		retrieved, err := store.GetNote("note-1")
		require.NoError(t, err, "GetNote should not error")
		require.NotNil(t, retrieved, "Retrieved note should not be nil")

		assert.Equal(t, note.ID, retrieved.ID)
		assert.Equal(t, note.Title, retrieved.Title)
		assert.Equal(t, note.Content, retrieved.Content)
		assert.Equal(t, note.IsPinned, retrieved.IsPinned)
		assert.Equal(t, note.Order, retrieved.Order)

		// Update
		note.Title = "Updated Title"
		note.UpdatedAt = time.Now().UnixMilli()
		err = store.UpsertNote(note)
		require.NoError(t, err, "UpsertNote (update) should not error")

		retrieved, err = store.GetNote("note-1")
		require.NoError(t, err)
		assert.Equal(t, "Updated Title", retrieved.Title)
	})
}

func TestNoteGetNotFound(t *testing.T) {
	runTestsForAllStores(t, "GetNotFound", func(t *testing.T, store Storer) {
		note, err := store.GetNote("nonexistent")
		require.NoError(t, err, "GetNote for nonexistent should not error")
		assert.Nil(t, note, "Should return nil for nonexistent note")
	})
}

func TestNoteDelete(t *testing.T) {
	runTestsForAllStores(t, "Delete", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()
		note := &Note{
			ID:        "note-to-delete",
			WorldID:   "world-1",
			Title:     "Delete Me",
			Content:   "{}",
			CreatedAt: now,
			UpdatedAt: now,
		}

		err := store.UpsertNote(note)
		require.NoError(t, err)

		// Verify exists
		retrieved, err := store.GetNote("note-to-delete")
		require.NoError(t, err)
		require.NotNil(t, retrieved)

		// Delete
		err = store.DeleteNote("note-to-delete")
		require.NoError(t, err)

		// Verify gone
		retrieved, err = store.GetNote("note-to-delete")
		require.NoError(t, err)
		assert.Nil(t, retrieved)
	})
}

func TestNoteList(t *testing.T) {
	runTestsForAllStores(t, "List", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()

		// Insert multiple notes
		for i, title := range []string{"Alpha", "Beta", "Gamma"} {
			note := &Note{
				ID:        "note-" + title,
				WorldID:   "world-1",
				Title:     title,
				Content:   "{}",
				FolderID:  "folder-1",
				Order:     float64((i + 1) * 1000),
				CreatedAt: now,
				UpdatedAt: now,
			}
			require.NoError(t, store.UpsertNote(note))
		}

		// List all
		notes, err := store.ListNotes("")
		require.NoError(t, err)
		assert.Len(t, notes, 3)

		// List by folder
		notes, err = store.ListNotes("folder-1")
		require.NoError(t, err)
		assert.Len(t, notes, 3)

		// List empty folder
		notes, err = store.ListNotes("nonexistent-folder")
		require.NoError(t, err)
		assert.Len(t, notes, 0)
	})
}

func TestNoteCount(t *testing.T) {
	runTestsForAllStores(t, "Count", func(t *testing.T, store Storer) {
		count, err := store.CountNotes()
		require.NoError(t, err)
		assert.Equal(t, 0, count)

		now := time.Now().UnixMilli()
		for i := 0; i < 5; i++ {
			note := &Note{
				ID:        "note-" + string(rune('a'+i)),
				WorldID:   "world-1",
				Title:     "Note",
				Content:   "{}",
				CreatedAt: now,
				UpdatedAt: now,
			}
			require.NoError(t, store.UpsertNote(note))
		}

		count, err = store.CountNotes()
		require.NoError(t, err)
		assert.Equal(t, 5, count)
	})
}

// =============================================================================
// Entity CRUD Tests
// =============================================================================

func TestEntityUpsertAndGet(t *testing.T) {
	runTestsForAllStores(t, "EntityUpsertAndGet", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()
		entity := &Entity{
			ID:            "entity-frodo",
			Label:         "Frodo Baggins",
			Kind:          "CHARACTER",
			Subtype:       "PROTAGONIST",
			Aliases:       []string{"Mr. Underhill", "Ring-bearer"},
			FirstNote:     "note-1",
			TotalMentions: 42,
			NarrativeID:   "narrative-1",
			CreatedBy:     "user",
			CreatedAt:     now,
			UpdatedAt:     now,
		}

		// Insert
		err := store.UpsertEntity(entity)
		require.NoError(t, err, "UpsertEntity should not error")

		// Get
		retrieved, err := store.GetEntity("entity-frodo")
		require.NoError(t, err, "GetEntity should not error")
		require.NotNil(t, retrieved, "Retrieved entity should not be nil")

		assert.Equal(t, entity.ID, retrieved.ID)
		assert.Equal(t, entity.Label, retrieved.Label)
		assert.Equal(t, entity.Kind, retrieved.Kind)
		assert.Equal(t, entity.Subtype, retrieved.Subtype)
		assert.Equal(t, entity.Aliases, retrieved.Aliases)
		assert.Equal(t, entity.TotalMentions, retrieved.TotalMentions)

		// Update
		entity.TotalMentions = 100
		entity.UpdatedAt = time.Now().UnixMilli()
		err = store.UpsertEntity(entity)
		require.NoError(t, err)

		retrieved, err = store.GetEntity("entity-frodo")
		require.NoError(t, err)
		assert.Equal(t, 100, retrieved.TotalMentions)
	})
}

func TestEntityGetByLabel(t *testing.T) {
	runTestsForAllStores(t, "EntityGetByLabel", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()
		entity := &Entity{
			ID:        "entity-gandalf",
			Label:     "Gandalf the Grey",
			Kind:      "CHARACTER",
			Aliases:   []string{},
			CreatedBy: "user",
			CreatedAt: now,
			UpdatedAt: now,
		}

		err := store.UpsertEntity(entity)
		require.NoError(t, err)

		// Case-insensitive lookup
		retrieved, err := store.GetEntityByLabel("gandalf the grey")
		require.NoError(t, err)
		require.NotNil(t, retrieved)
		assert.Equal(t, "Gandalf the Grey", retrieved.Label)

		// Not found
		notFound, err := store.GetEntityByLabel("Saruman")
		require.NoError(t, err)
		assert.Nil(t, notFound)
	})
}

func TestEntityDelete(t *testing.T) {
	runTestsForAllStores(t, "EntityDelete", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()
		entity := &Entity{
			ID:        "entity-to-delete",
			Label:     "Delete Me",
			Kind:      "CHARACTER",
			Aliases:   []string{},
			CreatedBy: "user",
			CreatedAt: now,
			UpdatedAt: now,
		}

		err := store.UpsertEntity(entity)
		require.NoError(t, err)

		err = store.DeleteEntity("entity-to-delete")
		require.NoError(t, err)

		retrieved, err := store.GetEntity("entity-to-delete")
		require.NoError(t, err)
		assert.Nil(t, retrieved)
	})
}

func TestEntityList(t *testing.T) {
	runTestsForAllStores(t, "EntityList", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()

		entities := []struct {
			id    string
			label string
			kind  string
		}{
			{"e1", "Frodo", "CHARACTER"},
			{"e2", "Mordor", "LOCATION"},
			{"e3", "Gandalf", "CHARACTER"},
		}

		for _, e := range entities {
			err := store.UpsertEntity(&Entity{
				ID:        e.id,
				Label:     e.label,
				Kind:      e.kind,
				Aliases:   []string{},
				CreatedBy: "user",
				CreatedAt: now,
				UpdatedAt: now,
			})
			require.NoError(t, err)
		}

		// List all
		all, err := store.ListEntities("")
		require.NoError(t, err)
		assert.Len(t, all, 3)

		// List by kind
		chars, err := store.ListEntities("CHARACTER")
		require.NoError(t, err)
		assert.Len(t, chars, 2)

		locations, err := store.ListEntities("LOCATION")
		require.NoError(t, err)
		assert.Len(t, locations, 1)
	})
}

func TestEntityCount(t *testing.T) {
	runTestsForAllStores(t, "EntityCount", func(t *testing.T, store Storer) {
		count, err := store.CountEntities()
		require.NoError(t, err)
		assert.Equal(t, 0, count)

		now := time.Now().UnixMilli()
		for i := 0; i < 3; i++ {
			err := store.UpsertEntity(&Entity{
				ID:        "entity-" + string(rune('a'+i)),
				Label:     "Entity",
				Kind:      "CHARACTER",
				Aliases:   []string{},
				CreatedBy: "user",
				CreatedAt: now,
				UpdatedAt: now,
			})
			require.NoError(t, err)
		}

		count, err = store.CountEntities()
		require.NoError(t, err)
		assert.Equal(t, 3, count)
	})
}

// =============================================================================
// Edge CRUD Tests
// =============================================================================

func TestEdgeUpsertAndGet(t *testing.T) {
	runTestsForAllStores(t, "EdgeUpsertAndGet", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()

		// Create entities first
		store.UpsertEntity(&Entity{ID: "e-frodo", Label: "Frodo", Kind: "CHARACTER", Aliases: []string{}, CreatedBy: "user", CreatedAt: now, UpdatedAt: now})
		store.UpsertEntity(&Entity{ID: "e-sam", Label: "Sam", Kind: "CHARACTER", Aliases: []string{}, CreatedBy: "user", CreatedAt: now, UpdatedAt: now})

		edge := &Edge{
			ID:            "e-frodo-FRIEND_OF-e-sam",
			SourceID:      "e-frodo",
			TargetID:      "e-sam",
			RelType:       "FRIEND_OF",
			Confidence:    0.95,
			Bidirectional: true,
			SourceNote:    "note-1",
			CreatedAt:     now,
		}

		// Insert
		err := store.UpsertEdge(edge)
		require.NoError(t, err, "UpsertEdge should not error")

		// Get
		retrieved, err := store.GetEdge("e-frodo-FRIEND_OF-e-sam")
		require.NoError(t, err, "GetEdge should not error")
		require.NotNil(t, retrieved, "Retrieved edge should not be nil")

		assert.Equal(t, edge.ID, retrieved.ID)
		assert.Equal(t, edge.SourceID, retrieved.SourceID)
		assert.Equal(t, edge.TargetID, retrieved.TargetID)
		assert.Equal(t, edge.RelType, retrieved.RelType)
		assert.Equal(t, edge.Confidence, retrieved.Confidence)
		assert.Equal(t, edge.Bidirectional, retrieved.Bidirectional)
	})
}

func TestEdgeDelete(t *testing.T) {
	runTestsForAllStores(t, "EdgeDelete", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()
		edge := &Edge{
			ID:        "edge-to-delete",
			SourceID:  "e1",
			TargetID:  "e2",
			RelType:   "KNOWS",
			CreatedAt: now,
		}

		err := store.UpsertEdge(edge)
		require.NoError(t, err)

		err = store.DeleteEdge("edge-to-delete")
		require.NoError(t, err)

		retrieved, err := store.GetEdge("edge-to-delete")
		require.NoError(t, err)
		assert.Nil(t, retrieved)
	})
}

func TestEdgeListForEntity(t *testing.T) {
	runTestsForAllStores(t, "EdgeListForEntity", func(t *testing.T, store Storer) {
		now := time.Now().UnixMilli()

		// Create edges: Frodo <-> Sam, Frodo -> Ring, Gandalf -> Frodo
		edges := []*Edge{
			{ID: "e1", SourceID: "frodo", TargetID: "sam", RelType: "FRIEND_OF", CreatedAt: now},
			{ID: "e2", SourceID: "frodo", TargetID: "ring", RelType: "CARRIES", CreatedAt: now},
			{ID: "e3", SourceID: "gandalf", TargetID: "frodo", RelType: "MENTORS", CreatedAt: now},
			{ID: "e4", SourceID: "aragorn", TargetID: "arwen", RelType: "LOVES", CreatedAt: now}, // Unrelated
		}

		for _, e := range edges {
			require.NoError(t, store.UpsertEdge(e))
		}

		// List edges for Frodo (should get e1, e2, e3)
		frodoEdges, err := store.ListEdgesForEntity("frodo")
		require.NoError(t, err)
		assert.Len(t, frodoEdges, 3)

		// List edges for Ring (should get e2 only)
		ringEdges, err := store.ListEdgesForEntity("ring")
		require.NoError(t, err)
		assert.Len(t, ringEdges, 1)
	})
}

func TestEdgeCount(t *testing.T) {
	runTestsForAllStores(t, "EdgeCount", func(t *testing.T, store Storer) {
		count, err := store.CountEdges()
		require.NoError(t, err)
		assert.Equal(t, 0, count)

		now := time.Now().UnixMilli()
		for i := 0; i < 4; i++ {
			edge := &Edge{
				ID:        "edge-" + string(rune('a'+i)),
				SourceID:  "src",
				TargetID:  "tgt",
				RelType:   "REL",
				CreatedAt: now,
			}
			require.NoError(t, store.UpsertEdge(edge))
		}

		count, err = store.CountEdges()
		require.NoError(t, err)
		assert.Equal(t, 4, count)
	})
}

// =============================================================================
// Interface Compliance Test
// =============================================================================

func TestStorerInterface(t *testing.T) {
	// Verify both implementations satisfy Storer interface
	var _ Storer = (*MemStore)(nil)
	var _ Storer = (*SQLiteStore)(nil)
}
