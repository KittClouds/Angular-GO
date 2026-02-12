package rlm

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestEngine creates an engine backed by an in-memory store.
func newTestEngine(t *testing.T) (*Engine, *store.SQLiteStore) {
	s, err := store.NewSQLiteStore()
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })

	ws := NewWorkspace(s)
	eng := NewEngine(ws)
	return eng, s
}

func TestEngine_Execute_GetIndex(t *testing.T) {
	eng, s := newTestEngine(t)
	now := time.Now().UnixMilli()

	// Seed an artifact directly
	require.NoError(t, s.PutArtifact(&store.WorkspaceArtifact{
		Key: "pre-existing", ThreadID: "t1", NarrativeID: "n1",
		Kind: "hits", Payload: `{"test":true}`, ProducedBy: "seed",
		CreatedAt: now, UpdatedAt: now,
	}))

	req := Request{
		Scope:       ScopeKey{ThreadID: "t1", NarrativeID: "n1"},
		CurrentTask: "check index",
		Actions: []Action{
			{Op: "workspace.get_index", Args: json.RawMessage(`{}`), SaveAs: ""},
		},
	}

	reqJSON, _ := json.Marshal(req)
	respJSON, err := eng.Execute(reqJSON)
	require.NoError(t, err)

	var resp Response
	require.NoError(t, json.Unmarshal(respJSON, &resp))

	assert.Equal(t, "t1", resp.Scope.ThreadID)
	assert.Len(t, resp.Results, 1)
	assert.True(t, resp.Results[0].OK)
	assert.Equal(t, "workspace.get_index", resp.Results[0].Op)
}

func TestEngine_Execute_PutAndSearch(t *testing.T) {
	eng, s := newTestEngine(t)
	now := time.Now().UnixMilli()

	// Seed a note for searching
	require.NoError(t, s.UpsertNote(&store.Note{
		ID: "note-1", WorldID: "w1", Title: "Dragon Lore",
		Content: "{}", MarkdownContent: "The ancient dragon breathes fire and brimstone",
		CreatedAt: now, UpdatedAt: now,
	}))

	req := Request{
		Scope:       ScopeKey{ThreadID: "t1"},
		CurrentTask: "find dragon lore",
		Actions: []Action{
			{
				Op:     "needle.search",
				Args:   json.RawMessage(`{"query":"dragon","limit":5}`),
				SaveAs: "dragon-hits",
			},
		},
	}

	reqJSON, _ := json.Marshal(req)
	respJSON, err := eng.Execute(reqJSON)
	require.NoError(t, err)

	var resp Response
	require.NoError(t, json.Unmarshal(respJSON, &resp))

	assert.Len(t, resp.Results, 1)
	assert.True(t, resp.Results[0].OK)
	assert.Empty(t, resp.Results[0].Error)

	// Verify the save_as artifact was stored
	scope := &store.ScopeKey{ThreadID: "t1"}
	art, err := s.GetArtifact(scope, "dragon-hits")
	require.NoError(t, err)
	require.NotNil(t, art, "save_as artifact should have been stored")
	assert.Equal(t, store.ArtifactHits, art.Kind)
	assert.Contains(t, art.Payload, "note-1")
}

func TestEngine_Execute_UnknownOp(t *testing.T) {
	eng, _ := newTestEngine(t)

	req := Request{
		Scope: ScopeKey{ThreadID: "t1"},
		Actions: []Action{
			{Op: "magic.wand", Args: json.RawMessage(`{}`)},
		},
	}

	reqJSON, _ := json.Marshal(req)
	respJSON, err := eng.Execute(reqJSON)
	require.NoError(t, err)

	var resp Response
	require.NoError(t, json.Unmarshal(respJSON, &resp))

	assert.Len(t, resp.Results, 1)
	assert.False(t, resp.Results[0].OK)
	assert.Contains(t, resp.Results[0].Error, "unknown op")
}

func TestEngine_Execute_MissingScope(t *testing.T) {
	eng, _ := newTestEngine(t)

	req := Request{
		Scope:   ScopeKey{ThreadID: ""}, // Missing required field
		Actions: []Action{},
	}

	reqJSON, _ := json.Marshal(req)
	_, err := eng.Execute(reqJSON)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "thread_id is required")
}

func TestEngine_Execute_MultiAction(t *testing.T) {
	eng, s := newTestEngine(t)
	now := time.Now().UnixMilli()

	// Seed data
	require.NoError(t, s.UpsertNote(&store.Note{
		ID: "note-x", WorldID: "w1", Title: "Adventures",
		Content: "{}", MarkdownContent: "The hero embarks on a quest to find the lost artifact",
		CreatedAt: now, UpdatedAt: now,
	}))

	req := Request{
		Scope:       ScopeKey{ThreadID: "t1"},
		CurrentTask: "research hero quest",
		Actions: []Action{
			{
				Op:     "needle.search",
				Args:   json.RawMessage(`{"query":"hero"}`),
				SaveAs: "hero-hits",
			},
			{
				Op:     "spans.read",
				Args:   json.RawMessage(`{"doc_id":"note-x","start":0,"end":20,"max_chars":20}`),
				SaveAs: "hero-span",
			},
			{
				Op:   "workspace.put",
				Args: json.RawMessage(`{"key":"my-summary","kind":"summary","payload":"Hero quest involves finding lost artifact"}`),
			},
		},
	}

	reqJSON, _ := json.Marshal(req)
	respJSON, err := eng.Execute(reqJSON)
	require.NoError(t, err)

	var resp Response
	require.NoError(t, json.Unmarshal(respJSON, &resp))

	assert.Len(t, resp.Results, 3)
	for i, r := range resp.Results {
		assert.True(t, r.OK, "action %d (%s) should succeed", i, r.Op)
	}
}

func TestEngine_Execute_InvalidJSON(t *testing.T) {
	eng, _ := newTestEngine(t)

	_, err := eng.Execute([]byte(`{not valid json}`))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid request JSON")
}
