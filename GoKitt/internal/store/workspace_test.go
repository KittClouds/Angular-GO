package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// RLM Workspace Artifact Tests
// =============================================================================

func TestWorkspaceArtifact_PutAndGet(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UnixMilli()

	art := &WorkspaceArtifact{
		Key:         "search-results-1",
		ThreadID:    "thread-1",
		NarrativeID: "narr-1",
		FolderID:    "folder-1",
		Kind:        ArtifactHits,
		Payload:     `{"hits":[{"doc_id":"note-1"}]}`,
		Pinned:      false,
		ProducedBy:  "needle.search",
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	// Put
	err := s.PutArtifact(art)
	require.NoError(t, err, "PutArtifact should not error")

	// Get
	scope := &ScopeKey{ThreadID: "thread-1", NarrativeID: "narr-1", FolderID: "folder-1"}
	retrieved, err := s.GetArtifact(scope, "search-results-1")
	require.NoError(t, err)
	require.NotNil(t, retrieved)

	assert.Equal(t, art.Key, retrieved.Key)
	assert.Equal(t, art.ThreadID, retrieved.ThreadID)
	assert.Equal(t, art.NarrativeID, retrieved.NarrativeID)
	assert.Equal(t, art.FolderID, retrieved.FolderID)
	assert.Equal(t, art.Kind, retrieved.Kind)
	assert.Equal(t, art.Payload, retrieved.Payload)
	assert.False(t, retrieved.Pinned)
	assert.Equal(t, art.ProducedBy, retrieved.ProducedBy)
}

func TestWorkspaceArtifact_Upsert(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UnixMilli()

	art := &WorkspaceArtifact{
		Key:         "my-artifact",
		ThreadID:    "thread-1",
		NarrativeID: "",
		FolderID:    "",
		Kind:        ArtifactSnippet,
		Payload:     `"original payload"`,
		ProducedBy:  "spans.read",
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	require.NoError(t, s.PutArtifact(art))

	// Upsert with updated payload
	art.Payload = `"updated payload"`
	art.UpdatedAt = time.Now().UnixMilli()
	require.NoError(t, s.PutArtifact(art))

	scope := &ScopeKey{ThreadID: "thread-1"}
	retrieved, err := s.GetArtifact(scope, "my-artifact")
	require.NoError(t, err)
	require.NotNil(t, retrieved)
	assert.Equal(t, `"updated payload"`, retrieved.Payload)
}

func TestWorkspaceArtifact_GetNotFound(t *testing.T) {
	s := newTestStore(t)
	scope := &ScopeKey{ThreadID: "thread-1"}
	retrieved, err := s.GetArtifact(scope, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestWorkspaceArtifact_Delete(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UnixMilli()

	art := &WorkspaceArtifact{
		Key:        "to-delete",
		ThreadID:   "thread-1",
		Kind:       ArtifactSnippet,
		Payload:    `"test"`,
		ProducedBy: "test",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	require.NoError(t, s.PutArtifact(art))

	scope := &ScopeKey{ThreadID: "thread-1"}
	err := s.DeleteArtifact(scope, "to-delete")
	require.NoError(t, err)

	retrieved, err := s.GetArtifact(scope, "to-delete")
	require.NoError(t, err)
	assert.Nil(t, retrieved)
}

func TestWorkspaceArtifact_ListScoped(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create artifacts in different scopes
	scope1 := &ScopeKey{ThreadID: "thread-1", NarrativeID: "narr-1", FolderID: ""}
	scope2 := &ScopeKey{ThreadID: "thread-2", NarrativeID: "narr-1", FolderID: ""}

	for i, key := range []string{"a1", "a2", "a3"} {
		art := &WorkspaceArtifact{
			Key:         key,
			ThreadID:    "thread-1",
			NarrativeID: "narr-1",
			Kind:        ArtifactSnippet,
			Payload:     `"test"`,
			ProducedBy:  "test",
			CreatedAt:   now + int64(i),
			UpdatedAt:   now + int64(i),
		}
		require.NoError(t, s.PutArtifact(art))
	}

	// Artifact in a different scope
	art := &WorkspaceArtifact{
		Key:         "other",
		ThreadID:    "thread-2",
		NarrativeID: "narr-1",
		Kind:        ArtifactSnippet,
		Payload:     `"other"`,
		ProducedBy:  "test",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	require.NoError(t, s.PutArtifact(art))

	// List scope1 — should get 3
	arts1, err := s.ListArtifacts(scope1)
	require.NoError(t, err)
	assert.Len(t, arts1, 3)

	// List scope2 — should get 1
	arts2, err := s.ListArtifacts(scope2)
	require.NoError(t, err)
	assert.Len(t, arts2, 1)
	assert.Equal(t, "other", arts2[0].Key)
}

func TestWorkspaceArtifact_Pin(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UnixMilli()

	art := &WorkspaceArtifact{
		Key:        "pinnable",
		ThreadID:   "thread-1",
		Kind:       ArtifactSummary,
		Payload:    `"important"`,
		Pinned:     false,
		ProducedBy: "test",
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	require.NoError(t, s.PutArtifact(art))

	// Pin it
	art.Pinned = true
	art.UpdatedAt = time.Now().UnixMilli()
	require.NoError(t, s.PutArtifact(art))

	scope := &ScopeKey{ThreadID: "thread-1"}
	retrieved, err := s.GetArtifact(scope, "pinnable")
	require.NoError(t, err)
	require.NotNil(t, retrieved)
	assert.True(t, retrieved.Pinned)
}

func TestSearchNotes_Basic(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create notes with markdown content
	notes := []struct {
		id       string
		title    string
		markdown string
		folder   string
	}{
		{"note-1", "Dragon Lore", "The ancient dragon breathes fire", "folder-1"},
		{"note-2", "Sword Manual", "The legendary sword is forged in dragon fire", "folder-1"},
		{"note-3", "Cooking", "How to cook pasta", "folder-2"},
	}

	for _, n := range notes {
		note := &Note{
			ID:              n.id,
			WorldID:         "world-1",
			Title:           n.title,
			Content:         "{}",
			MarkdownContent: n.markdown,
			FolderID:        n.folder,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		require.NoError(t, s.UpsertNote(note))
	}

	// Search for "dragon" — should find 2 notes
	scope := &ScopeKey{ThreadID: "thread-1"}
	results, err := s.SearchNotes(scope, "dragon", 10)
	require.NoError(t, err)
	assert.Len(t, results, 2)

	// Search for "pasta" — should find 1 note
	results, err = s.SearchNotes(scope, "pasta", 10)
	require.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "note-3", results[0].ID)
}

func TestSearchNotes_ScopedToFolder(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UnixMilli()

	// Create folder hierarchy: root -> child
	root := &Folder{
		ID:        "root-folder",
		Name:      "Root",
		WorldID:   "world-1",
		CreatedAt: now,
		UpdatedAt: now,
	}
	child := &Folder{
		ID:        "child-folder",
		Name:      "Child",
		ParentID:  "root-folder",
		WorldID:   "world-1",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, s.UpsertFolder(root))
	require.NoError(t, s.UpsertFolder(child))

	// Notes in root folder
	note1 := &Note{
		ID: "note-root", WorldID: "world-1", Title: "Root Note",
		Content: "{}", MarkdownContent: "Something about dragons",
		FolderID: "root-folder", CreatedAt: now, UpdatedAt: now,
	}
	// Notes in child folder
	note2 := &Note{
		ID: "note-child", WorldID: "world-1", Title: "Child Note",
		Content: "{}", MarkdownContent: "More about dragons and lore",
		FolderID: "child-folder", CreatedAt: now, UpdatedAt: now,
	}
	// Notes in unrelated folder
	note3 := &Note{
		ID: "note-other", WorldID: "world-1", Title: "Other Note",
		Content: "{}", MarkdownContent: "Unrelated dragons",
		FolderID: "other-folder", CreatedAt: now, UpdatedAt: now,
	}

	require.NoError(t, s.UpsertNote(note1))
	require.NoError(t, s.UpsertNote(note2))
	require.NoError(t, s.UpsertNote(note3))

	// Search scoped to root-folder subtree — should find root + child, not other
	scope := &ScopeKey{ThreadID: "t1", FolderID: "root-folder"}
	results, err := s.SearchNotes(scope, "dragons", 10)
	require.NoError(t, err)
	assert.Len(t, results, 2)

	ids := map[string]bool{}
	for _, r := range results {
		ids[r.ID] = true
	}
	assert.True(t, ids["note-root"])
	assert.True(t, ids["note-child"])
	assert.False(t, ids["note-other"])
}

func TestSearchNotes_TitleMatch(t *testing.T) {
	s := newTestStore(t)
	now := time.Now().UnixMilli()

	note := &Note{
		ID: "title-match", WorldID: "world-1", Title: "The Midnight Dragon",
		Content: "{}", MarkdownContent: "Nothing to see here",
		CreatedAt: now, UpdatedAt: now,
	}
	require.NoError(t, s.UpsertNote(note))

	scope := &ScopeKey{ThreadID: "t1"}
	results, err := s.SearchNotes(scope, "Midnight", 10)
	require.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "title-match", results[0].ID)
}
