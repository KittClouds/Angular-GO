package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Test Helpers
// =============================================================================

// newTestStore creates a new SQLiteStore for testing.
func newTestStore(t *testing.T) *SQLiteStore {
	store, err := NewSQLiteStore()
	require.NoError(t, err, "Failed to create SQLiteStore")
	t.Cleanup(func() { store.Close() })
	return store
}

// =============================================================================
// Store Initialization Tests
// =============================================================================

func TestStoreCreation(t *testing.T) {
	store := newTestStore(t)
	require.NotNil(t, store, "Store should not be nil")
}

// =============================================================================
// Note CRUD Tests
// =============================================================================

func TestNoteUpsertAndGet(t *testing.T) {
	store := newTestStore(t)
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

	// Verify update
	retrieved, err = store.GetNote("note-1")
	require.NoError(t, err)
	assert.Equal(t, "Updated Title", retrieved.Title)
}

func TestNoteGetNotFound(t *testing.T) {
	store := newTestStore(t)
	note, err := store.GetNote("nonexistent")
	require.NoError(t, err)
	assert.Nil(t, note, "GetNote should return nil for nonexistent note")
}

func TestNoteDelete(t *testing.T) {
	store := newTestStore(t)
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

	// Delete
	err = store.DeleteNote("note-to-delete")
	require.NoError(t, err)

	// Verify deleted
	retrieved, err := store.GetNote("note-to-delete")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestNoteList(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create notes in different folders
	for i := 1; i <= 3; i++ {
		note := &Note{
			ID:        "note-" + string(rune('0'+i)),
			WorldID:   "world-1",
			Title:     "Note " + string(rune('0'+i)),
			Content:   "{}",
			FolderID:  "folder-1",
			Order:     float64(i * 1000),
			CreatedAt: now,
			UpdatedAt: now,
		}
		require.NoError(t, store.UpsertNote(note))
	}

	// Create note in different folder
	note := &Note{
		ID:        "note-other",
		WorldID:   "world-1",
		Title:     "Other Note",
		Content:   "{}",
		FolderID:  "folder-2",
		Order:     5000,
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, store.UpsertNote(note))

	// List all
	all, err := store.ListNotes("")
	require.NoError(t, err)
	assert.Len(t, all, 4)

	// List by folder
	folder1, err := store.ListNotes("folder-1")
	require.NoError(t, err)
	assert.Len(t, folder1, 3)

	folder2, err := store.ListNotes("folder-2")
	require.NoError(t, err)
	assert.Len(t, folder2, 1)
	assert.Equal(t, "Other Note", folder2[0].Title)
}

func TestNoteCount(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	count, err := store.CountNotes()
	require.NoError(t, err)
	assert.Equal(t, 0, count)

	// Add notes
	for i := 1; i <= 5; i++ {
		note := &Note{
			ID:        "note-" + string(rune('0'+i)),
			WorldID:   "world-1",
			Title:     "Note " + string(rune('0'+i)),
			Content:   "{}",
			CreatedAt: now,
			UpdatedAt: now,
		}
		require.NoError(t, store.UpsertNote(note))
	}

	count, err = store.CountNotes()
	require.NoError(t, err)
	assert.Equal(t, 5, count)
}

// =============================================================================
// Entity CRUD Tests
// =============================================================================

func TestEntityUpsertAndGet(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()
	entity := &Entity{
		ID:            "entity-1",
		Label:         "John Doe",
		Kind:          "CHARACTER",
		Subtype:       "PROTAGONIST",
		Aliases:       []string{"Johnny", "JD"},
		FirstNote:     "note-1",
		TotalMentions: 5,
		NarrativeID:   "narrative-1",
		CreatedBy:     "user",
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	err := store.UpsertEntity(entity)
	require.NoError(t, err, "UpsertEntity should not error")

	retrieved, err := store.GetEntity("entity-1")
	require.NoError(t, err)
	require.NotNil(t, retrieved)

	assert.Equal(t, entity.ID, retrieved.ID)
	assert.Equal(t, entity.Label, retrieved.Label)
	assert.Equal(t, entity.Kind, retrieved.Kind)
	assert.Equal(t, entity.Aliases, retrieved.Aliases)
}

func TestEntityGetByLabel(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()
	entity := &Entity{
		ID:        "entity-label",
		Label:     "Unique Label",
		Kind:      "LOCATION",
		CreatedBy: "user",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, store.UpsertEntity(entity))

	// Find by label (case-insensitive)
	retrieved, err := store.GetEntityByLabel("unique label")
	require.NoError(t, err)
	require.NotNil(t, retrieved)
	assert.Equal(t, "entity-label", retrieved.ID)

	// Not found
	notFound, err := store.GetEntityByLabel("nonexistent")
	require.NoError(t, err)
	assert.Nil(t, notFound)
}

func TestEntityDelete(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()
	entity := &Entity{
		ID:        "entity-delete",
		Label:     "To Delete",
		Kind:      "ITEM",
		CreatedBy: "user",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, store.UpsertEntity(entity))

	err := store.DeleteEntity("entity-delete")
	require.NoError(t, err)

	retrieved, err := store.GetEntity("entity-delete")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestEntityList(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create entities of different kinds
	kinds := []string{"CHARACTER", "LOCATION", "CHARACTER", "ITEM"}
	for i, kind := range kinds {
		entity := &Entity{
			ID:        "entity-" + string(rune('0'+i)),
			Label:     "Entity " + string(rune('0'+i)),
			Kind:      kind,
			CreatedBy: "user",
			CreatedAt: now,
			UpdatedAt: now,
		}
		require.NoError(t, store.UpsertEntity(entity))
	}

	// List all
	all, err := store.ListEntities("")
	require.NoError(t, err)
	assert.Len(t, all, 4)

	// List by kind
	characters, err := store.ListEntities("CHARACTER")
	require.NoError(t, err)
	assert.Len(t, characters, 2)
}

func TestEntityCount(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	count, err := store.CountEntities()
	require.NoError(t, err)
	assert.Equal(t, 0, count)

	// Add entities
	for i := 1; i <= 3; i++ {
		entity := &Entity{
			ID:        "entity-" + string(rune('0'+i)),
			Label:     "Entity " + string(rune('0'+i)),
			Kind:      "CHARACTER",
			CreatedBy: "user",
			CreatedAt: now,
			UpdatedAt: now,
		}
		require.NoError(t, store.UpsertEntity(entity))
	}

	count, err = store.CountEntities()
	require.NoError(t, err)
	assert.Equal(t, 3, count)
}

// =============================================================================
// Edge CRUD Tests
// =============================================================================

func TestEdgeUpsertAndGet(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()
	edge := &Edge{
		ID:            "edge-1",
		SourceID:      "entity-1",
		TargetID:      "entity-2",
		RelType:       "KNOWS",
		Confidence:    0.95,
		Bidirectional: true,
		SourceNote:    "note-1",
		CreatedAt:     now,
	}

	err := store.UpsertEdge(edge)
	require.NoError(t, err, "UpsertEdge should not error")

	retrieved, err := store.GetEdge("edge-1")
	require.NoError(t, err)
	require.NotNil(t, retrieved)

	assert.Equal(t, edge.ID, retrieved.ID)
	assert.Equal(t, edge.SourceID, retrieved.SourceID)
	assert.Equal(t, edge.TargetID, retrieved.TargetID)
	assert.Equal(t, edge.RelType, retrieved.RelType)
	assert.Equal(t, edge.Confidence, retrieved.Confidence)
}

func TestEdgeDelete(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()
	edge := &Edge{
		ID:        "edge-delete",
		SourceID:  "entity-1",
		TargetID:  "entity-2",
		RelType:   "RELATED_TO",
		CreatedAt: now,
	}
	require.NoError(t, store.UpsertEdge(edge))

	err := store.DeleteEdge("edge-delete")
	require.NoError(t, err)

	retrieved, err := store.GetEdge("edge-delete")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestEdgeListForEntity(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create edges involving entity-1
	for i := 1; i <= 3; i++ {
		edge := &Edge{
			ID:        "edge-" + string(rune('0'+i)),
			SourceID:  "entity-1",
			TargetID:  "entity-" + string(rune('0'+i)),
			RelType:   "KNOWS",
			CreatedAt: now,
		}
		require.NoError(t, store.UpsertEdge(edge))
	}

	// Create edge not involving entity-1
	edge := &Edge{
		ID:        "edge-other",
		SourceID:  "entity-2",
		TargetID:  "entity-3",
		RelType:   "KNOWS",
		CreatedAt: now,
	}
	require.NoError(t, store.UpsertEdge(edge))

	edges, err := store.ListEdgesForEntity("entity-1")
	require.NoError(t, err)
	assert.Len(t, edges, 3)
}

func TestEdgeCount(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	count, err := store.CountEdges()
	require.NoError(t, err)
	assert.Equal(t, 0, count)

	// Add edges
	for i := 1; i <= 4; i++ {
		edge := &Edge{
			ID:        "edge-" + string(rune('0'+i)),
			SourceID:  "entity-1",
			TargetID:  "entity-" + string(rune('0'+i)),
			RelType:   "KNOWS",
			CreatedAt: now,
		}
		require.NoError(t, store.UpsertEdge(edge))
	}

	count, err = store.CountEdges()
	require.NoError(t, err)
	assert.Equal(t, 4, count)
}

// =============================================================================
// Interface Compliance Test
// =============================================================================

func TestStorerInterface(t *testing.T) {
	// Verify SQLiteStore satisfies Storer interface
	var _ Storer = (*SQLiteStore)(nil)
}

// =============================================================================
// Note Versioning Tests
// =============================================================================

func TestNoteVersioning(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create note
	note := &Note{
		ID:        "versioned-note",
		WorldID:   "world-1",
		Title:     "Version 1",
		Content:   `{"type":"doc","content":[{"type":"text","text":"Initial content"}]}`,
		CreatedAt: now,
		UpdatedAt: now,
	}

	err := store.CreateNote(note)
	require.NoError(t, err, "CreateNote should not error")

	// Get current version
	current, err := store.GetNote("versioned-note")
	require.NoError(t, err)
	require.NotNil(t, current)
	assert.Equal(t, 1, current.Version)
	assert.Equal(t, "Version 1", current.Title)
	assert.True(t, current.IsCurrent)
	assert.Nil(t, current.ValidTo)

	// Update note (creates version 2)
	time.Sleep(10 * time.Millisecond) // Ensure different timestamp
	now2 := time.Now().UnixMilli()
	note.Title = "Version 2"
	note.Content = `{"type":"doc","content":[{"type":"text","text":"Updated content"}]}`
	note.UpdatedAt = now2

	err = store.UpdateNote(note, "user_edit")
	require.NoError(t, err, "UpdateNote should not error")

	// Get current version (should be v2)
	current, err = store.GetNote("versioned-note")
	require.NoError(t, err)
	assert.Equal(t, 2, current.Version)
	assert.Equal(t, "Version 2", current.Title)
	assert.True(t, current.IsCurrent)

	// Get old version (v1)
	v1, err := store.GetNoteVersion("versioned-note", 1)
	require.NoError(t, err)
	require.NotNil(t, v1)
	assert.Equal(t, 1, v1.Version)
	assert.Equal(t, "Version 1", v1.Title)
	assert.False(t, v1.IsCurrent)
	assert.NotNil(t, v1.ValidTo)

	// List all versions
	versions, err := store.ListNoteVersions("versioned-note")
	require.NoError(t, err)
	assert.Len(t, versions, 2)
	assert.Equal(t, 2, versions[0].Version) // Newest first
	assert.Equal(t, 1, versions[1].Version)

	// Update again (creates version 3)
	time.Sleep(10 * time.Millisecond)
	now3 := time.Now().UnixMilli()
	note.Title = "Version 3"
	note.UpdatedAt = now3

	err = store.UpdateNote(note, "auto_save")
	require.NoError(t, err)

	versions, err = store.ListNoteVersions("versioned-note")
	require.NoError(t, err)
	assert.Len(t, versions, 3)
}

func TestNoteVersioning_GetAtTime(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create note
	note := &Note{
		ID:        "time-note",
		WorldID:   "world-1",
		Title:     "Original",
		Content:   "Original content",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, store.CreateNote(note))

	// Get v1 timestamp
	v1, _ := store.GetNoteVersion("time-note", 1)
	v1Time := v1.ValidFrom

	// Update note
	time.Sleep(20 * time.Millisecond)
	now2 := time.Now().UnixMilli()
	note.Title = "Updated"
	note.Content = "Updated content"
	note.UpdatedAt = now2
	require.NoError(t, store.UpdateNote(note, "edit"))

	// Get v2 timestamp
	v2, _ := store.GetNote("time-note")
	v2Time := v2.ValidFrom

	// Query at v1 time - should get v1
	atV1, err := store.GetNoteAtTime("time-note", v1Time+1)
	require.NoError(t, err)
	require.NotNil(t, atV1)
	assert.Equal(t, "Original", atV1.Title)

	// Query at v2 time - should get v2
	atV2, err := store.GetNoteAtTime("time-note", v2Time+1)
	require.NoError(t, err)
	require.NotNil(t, atV2)
	assert.Equal(t, "Updated", atV2.Title)
}

func TestNoteVersioning_Restore(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create and update note multiple times
	note := &Note{
		ID:        "restore-note",
		WorldID:   "world-1",
		Title:     "Original Title",
		Content:   "Original content",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, store.CreateNote(note))

	time.Sleep(10 * time.Millisecond)
	note.Title = "Second Title"
	note.UpdatedAt = time.Now().UnixMilli()
	require.NoError(t, store.UpdateNote(note, "edit"))

	time.Sleep(10 * time.Millisecond)
	note.Title = "Third Title"
	note.UpdatedAt = time.Now().UnixMilli()
	require.NoError(t, store.UpdateNote(note, "edit"))

	// Verify we have 3 versions
	versions, err := store.ListNoteVersions("restore-note")
	require.NoError(t, err)
	assert.Len(t, versions, 3)

	// Current should be v3
	current, _ := store.GetNote("restore-note")
	assert.Equal(t, "Third Title", current.Title)

	// Restore v1
	err = store.RestoreNoteVersion("restore-note", 1)
	require.NoError(t, err)

	// Should now have 4 versions
	versions, err = store.ListNoteVersions("restore-note")
	require.NoError(t, err)
	assert.Len(t, versions, 4)

	// Current should have v1 content but v4 version number
	current, _ = store.GetNote("restore-note")
	assert.Equal(t, 4, current.Version)
	assert.Equal(t, "Original Title", current.Title)
	assert.Equal(t, "restore", current.ChangeReason)
}

func TestNoteVersioning_UpsertBehavior(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Upsert on new note should create
	note := &Note{
		ID:        "upsert-note",
		WorldID:   "world-1",
		Title:     "First",
		Content:   "First content",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, store.UpsertNote(note))

	v1, _ := store.GetNote("upsert-note")
	assert.Equal(t, 1, v1.Version)
	assert.Equal(t, "First", v1.Title)

	// Upsert on existing note should update
	time.Sleep(10 * time.Millisecond)
	note.Title = "Second"
	note.UpdatedAt = time.Now().UnixMilli()
	require.NoError(t, store.UpsertNote(note))

	v2, _ := store.GetNote("upsert-note")
	assert.Equal(t, 2, v2.Version)
	assert.Equal(t, "Second", v2.Title)
}

func TestNoteVersioning_DeleteRemovesAllVersions(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create and update note
	note := &Note{
		ID:        "delete-note",
		WorldID:   "world-1",
		Title:     "To Delete",
		Content:   "Content",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, store.CreateNote(note))

	note.Title = "Updated"
	note.UpdatedAt = time.Now().UnixMilli()
	require.NoError(t, store.UpdateNote(note, "edit"))

	// Verify 2 versions exist
	versions, _ := store.ListNoteVersions("delete-note")
	assert.Len(t, versions, 2)

	// Delete
	require.NoError(t, store.DeleteNote("delete-note"))

	// Verify all versions gone
	versions, _ = store.ListNoteVersions("delete-note")
	assert.Len(t, versions, 0)

	current, _ := store.GetNote("delete-note")
	assert.Nil(t, current)
}

func TestNoteVersioning_CountsCurrentOnly(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create note with 3 versions
	note := &Note{
		ID:        "count-note",
		WorldID:   "world-1",
		Title:     "V1",
		Content:   "Content",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, store.CreateNote(note))

	note.Title = "V2"
	note.UpdatedAt = time.Now().UnixMilli()
	require.NoError(t, store.UpdateNote(note, "edit"))

	note.Title = "V3"
	note.UpdatedAt = time.Now().UnixMilli()
	require.NoError(t, store.UpdateNote(note, "edit"))

	// Count should be 1 (current versions only)
	count, err := store.CountNotes()
	require.NoError(t, err)
	assert.Equal(t, 1, count)
}
