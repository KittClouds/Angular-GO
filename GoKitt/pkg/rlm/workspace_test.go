package rlm

import (
	"testing"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestWorkspace creates a workspace backed by an in-memory store.
func newTestWorkspace(t *testing.T) *Workspace {
	s, err := store.NewSQLiteStore()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return NewWorkspace(s)
}

func defaultScope() *ScopeKey {
	return &ScopeKey{ThreadID: "thread-1", NarrativeID: "narr-1", FolderID: ""}
}

func TestWorkspace_PutAndGetIndex(t *testing.T) {
	ws := newTestWorkspace(t)
	scope := defaultScope()

	// Put two artifacts
	require.NoError(t, ws.Put(scope, "hits-1", "hits", `{"count":3}`, "needle.search"))
	require.NoError(t, ws.Put(scope, "span-1", "span_set", `[{"start":0,"end":50}]`, "spans.read"))

	// Get index
	index, err := ws.GetIndex(scope)
	require.NoError(t, err)
	assert.Len(t, index, 2)

	keys := map[string]bool{}
	for _, m := range index {
		keys[m.Key] = true
	}
	assert.True(t, keys["hits-1"])
	assert.True(t, keys["span-1"])
}

func TestWorkspace_Delete(t *testing.T) {
	ws := newTestWorkspace(t)
	scope := defaultScope()

	require.NoError(t, ws.Put(scope, "doomed", "snippet", `"bye"`, "test"))
	require.NoError(t, ws.Delete(scope, "doomed"))

	index, err := ws.GetIndex(scope)
	require.NoError(t, err)
	assert.Len(t, index, 0)
}

func TestWorkspace_Pin(t *testing.T) {
	ws := newTestWorkspace(t)
	scope := defaultScope()

	require.NoError(t, ws.Put(scope, "important", "summary", `"critical info"`, "test"))
	require.NoError(t, ws.Pin(scope, "important"))

	pinned, err := ws.GetPinnedArtifacts(scope)
	require.NoError(t, err)
	assert.Len(t, pinned, 1)
	assert.Equal(t, "important", pinned[0].Key)
	assert.True(t, pinned[0].Pinned)
}

func TestWorkspace_Pin_NotFound(t *testing.T) {
	ws := newTestWorkspace(t)
	scope := defaultScope()

	err := ws.Pin(scope, "nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestWorkspace_NeedleSearch(t *testing.T) {
	// Seed notes directly via store
	s, err := store.NewSQLiteStore()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })

	ws := NewWorkspace(s)

	now := time.Now().UnixMilli()
	require.NoError(t, s.UpsertNote(&store.Note{
		ID: "note-1", WorldID: "w1", Title: "Lore",
		Content: "{}", MarkdownContent: "The wizard casts a spell",
		CreatedAt: now, UpdatedAt: now,
	}))
	require.NoError(t, s.UpsertNote(&store.Note{
		ID: "note-2", WorldID: "w1", Title: "Combat",
		Content: "{}", MarkdownContent: "The warrior swings a sword",
		CreatedAt: now, UpdatedAt: now,
	}))

	scope := &ScopeKey{ThreadID: "t1"}
	hits, err := ws.NeedleSearch(scope, "wizard", 10)
	require.NoError(t, err)
	assert.Len(t, hits, 1)
	assert.Equal(t, "note-1", hits[0].DocID)
}

func TestWorkspace_SpansRead(t *testing.T) {
	s, err := store.NewSQLiteStore()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	ws := NewWorkspace(s)

	now := time.Now().UnixMilli()
	require.NoError(t, s.UpsertNote(&store.Note{
		ID: "note-span", WorldID: "w1", Title: "Test",
		Content: "{}", MarkdownContent: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
		CreatedAt: now, UpdatedAt: now,
	}))

	// Read chars 5..10
	span, err := ws.SpansRead("note-span", 5, 10, 0)
	require.NoError(t, err)
	require.NotNil(t, span)
	assert.Equal(t, "FGHIJ", span.Text)
	assert.Equal(t, 5, span.Start)
	assert.Equal(t, 10, span.End)
}

func TestWorkspace_SpansRead_MaxChars(t *testing.T) {
	s, err := store.NewSQLiteStore()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	ws := NewWorkspace(s)

	now := time.Now().UnixMilli()
	require.NoError(t, s.UpsertNote(&store.Note{
		ID: "note-trunc", WorldID: "w1", Title: "Test",
		Content: "{}", MarkdownContent: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
		CreatedAt: now, UpdatedAt: now,
	}))

	// Read chars 0..26 with maxChars=5
	span, err := ws.SpansRead("note-trunc", 0, 26, 5)
	require.NoError(t, err)
	require.NotNil(t, span)
	assert.Equal(t, "ABCDE", span.Text)
	assert.Equal(t, 5, span.End)
}

func TestWorkspace_SpansRead_NotFound(t *testing.T) {
	s, err := store.NewSQLiteStore()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	ws := NewWorkspace(s)

	_, err = ws.SpansRead("nonexistent", 0, 10, 0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestWorkspace_NotesList(t *testing.T) {
	s, err := store.NewSQLiteStore()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	ws := NewWorkspace(s)

	now := time.Now().UnixMilli()
	require.NoError(t, s.UpsertNote(&store.Note{
		ID: "n1", WorldID: "w1", Title: "A",
		Content: "{}", FolderID: "f1", NarrativeID: "narr-1",
		CreatedAt: now, UpdatedAt: now,
	}))
	require.NoError(t, s.UpsertNote(&store.Note{
		ID: "n2", WorldID: "w1", Title: "B",
		Content: "{}", FolderID: "f1", NarrativeID: "narr-2",
		CreatedAt: now, UpdatedAt: now,
	}))

	// List with narrative filter
	scope := &ScopeKey{ThreadID: "t1", NarrativeID: "narr-1", FolderID: "f1"}
	metas, err := ws.NotesList(scope)
	require.NoError(t, err)
	assert.Len(t, metas, 1)
	assert.Equal(t, "n1", metas[0].Key)
}
