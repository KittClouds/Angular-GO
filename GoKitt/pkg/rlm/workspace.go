package rlm

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
)

// Workspace wraps the store layer to provide the RLM workspace operations.
// Each method corresponds to an allowed operation from the agent prompt.
type Workspace struct {
	store store.Storer
}

// NewWorkspace creates a new RLM workspace backed by the given store.
func NewWorkspace(s store.Storer) *Workspace {
	return &Workspace{store: s}
}

// ---------------------------------------------------------------------------
// workspace.get_index
// ---------------------------------------------------------------------------

// GetIndex returns lightweight metadata for all artifacts in a scope.
func (w *Workspace) GetIndex(scope *ScopeKey) ([]ArtifactMeta, error) {
	storeScope := toStoreScope(scope)
	arts, err := w.store.ListArtifacts(storeScope)
	if err != nil {
		return nil, fmt.Errorf("workspace.get_index: %w", err)
	}

	metas := make([]ArtifactMeta, len(arts))
	for i, a := range arts {
		metas[i] = ArtifactMeta{
			Key:        a.Key,
			Kind:       string(a.Kind),
			Pinned:     a.Pinned,
			ProducedBy: a.ProducedBy,
			UpdatedAt:  a.UpdatedAt,
		}
	}
	return metas, nil
}

// ---------------------------------------------------------------------------
// workspace.put
// ---------------------------------------------------------------------------

// Put stores an artifact in the scoped workspace.
func (w *Workspace) Put(scope *ScopeKey, key, kind, payload, producedBy string) error {
	now := time.Now().UnixMilli()
	art := &store.WorkspaceArtifact{
		Key:         key,
		ThreadID:    scope.ThreadID,
		NarrativeID: scope.NarrativeID,
		FolderID:    scope.FolderID,
		Kind:        store.ArtifactKind(kind),
		Payload:     payload,
		Pinned:      false,
		ProducedBy:  producedBy,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	return w.store.PutArtifact(art)
}

// ---------------------------------------------------------------------------
// workspace.delete
// ---------------------------------------------------------------------------

// Delete removes an artifact from the scoped workspace.
func (w *Workspace) Delete(scope *ScopeKey, key string) error {
	return w.store.DeleteArtifact(toStoreScope(scope), key)
}

// ---------------------------------------------------------------------------
// workspace.pin
// ---------------------------------------------------------------------------

// Pin marks an artifact as important (pinned).
func (w *Workspace) Pin(scope *ScopeKey, key string) error {
	storeScope := toStoreScope(scope)
	art, err := w.store.GetArtifact(storeScope, key)
	if err != nil {
		return fmt.Errorf("workspace.pin: %w", err)
	}
	if art == nil {
		return fmt.Errorf("workspace.pin: artifact %q not found", key)
	}

	art.Pinned = true
	art.UpdatedAt = time.Now().UnixMilli()
	return w.store.PutArtifact(art)
}

// ---------------------------------------------------------------------------
// needle.search
// ---------------------------------------------------------------------------

// NeedleSearch performs a LIKE search over note markdown content,
// scoped to the folder subtree + narrative.
func (w *Workspace) NeedleSearch(scope *ScopeKey, query string, limit int) ([]NoteHit, error) {
	if limit <= 0 {
		limit = 10
	}

	storeScope := toStoreScope(scope)
	notes, err := w.store.SearchNotes(storeScope, query, limit)
	if err != nil {
		return nil, fmt.Errorf("needle.search: %w", err)
	}

	hits := make([]NoteHit, len(notes))
	for i, n := range notes {
		snippet := n.MarkdownContent
		if len(snippet) > 200 {
			snippet = snippet[:200] + "…"
		}
		hits[i] = NoteHit{
			DocID:   n.ID,
			Title:   n.Title,
			Snippet: snippet,
		}
	}
	return hits, nil
}

// ---------------------------------------------------------------------------
// notes.get
// ---------------------------------------------------------------------------

// NotesGet retrieves a single note by ID.
func (w *Workspace) NotesGet(docID string) (*store.Note, error) {
	note, err := w.store.GetNote(docID)
	if err != nil {
		return nil, fmt.Errorf("notes.get: %w", err)
	}
	return note, nil
}

// ---------------------------------------------------------------------------
// notes.list
// ---------------------------------------------------------------------------

// NotesList lists notes scoped to the folder + narrative.
func (w *Workspace) NotesList(scope *ScopeKey) ([]ArtifactMeta, error) {
	notes, err := w.store.ListNotes(scope.FolderID)
	if err != nil {
		return nil, fmt.Errorf("notes.list: %w", err)
	}

	// Filter by narrative if specified
	var filtered []*store.Note
	if scope.NarrativeID != "" {
		for _, n := range notes {
			if n.NarrativeID == scope.NarrativeID {
				filtered = append(filtered, n)
			}
		}
	} else {
		filtered = notes
	}

	metas := make([]ArtifactMeta, len(filtered))
	for i, n := range filtered {
		metas[i] = ArtifactMeta{
			Key:       n.ID,
			Kind:      "note",
			UpdatedAt: n.UpdatedAt,
		}
	}
	return metas, nil
}

// ---------------------------------------------------------------------------
// spans.read
// ---------------------------------------------------------------------------

// SpansRead reads a bounded substring from a note's markdown content.
func (w *Workspace) SpansRead(docID string, start, end, maxChars int) (*SpanRef, error) {
	note, err := w.store.GetNote(docID)
	if err != nil {
		return nil, fmt.Errorf("spans.read: %w", err)
	}
	if note == nil {
		return nil, fmt.Errorf("spans.read: note %q not found", docID)
	}

	content := note.MarkdownContent
	contentLen := len(content)

	// Clamp bounds
	if start < 0 {
		start = 0
	}
	if end > contentLen {
		end = contentLen
	}
	if end <= start {
		return &SpanRef{DocID: docID, Start: start, End: start, Text: ""}, nil
	}

	// Apply maxChars limit
	if maxChars > 0 && (end-start) > maxChars {
		end = start + maxChars
	}

	return &SpanRef{
		DocID: docID,
		Start: start,
		End:   end,
		Text:  content[start:end],
	}, nil
}

// ---------------------------------------------------------------------------
// GetPinnedArtifacts — used by OMOrchestrator.GetContext
// ---------------------------------------------------------------------------

// GetPinnedArtifacts returns all pinned artifacts for the given scope.
func (w *Workspace) GetPinnedArtifacts(scope *ScopeKey) ([]*store.WorkspaceArtifact, error) {
	storeScope := toStoreScope(scope)
	all, err := w.store.ListArtifacts(storeScope)
	if err != nil {
		return nil, err
	}

	var pinned []*store.WorkspaceArtifact
	for _, a := range all {
		if a.Pinned {
			pinned = append(pinned, a)
		}
	}
	return pinned, nil
}

// GetPinnedPayloads satisfies the memory.WorkspaceProvider interface.
// Returns lightweight key+payload pairs for pinned artifacts.
func (w *Workspace) GetPinnedPayloads(scope *store.ScopeKey) ([]store.PinnedPayload, error) {
	rlmScope := &ScopeKey{
		ThreadID:    scope.ThreadID,
		NarrativeID: scope.NarrativeID,
		FolderID:    scope.FolderID,
	}
	arts, err := w.GetPinnedArtifacts(rlmScope)
	if err != nil {
		return nil, err
	}

	payloads := make([]store.PinnedPayload, len(arts))
	for i, a := range arts {
		payloads[i] = store.PinnedPayload{Key: a.Key, Payload: a.Payload}
	}
	return payloads, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func toStoreScope(scope *ScopeKey) *store.ScopeKey {
	return &store.ScopeKey{
		ThreadID:    scope.ThreadID,
		NarrativeID: scope.NarrativeID,
		FolderID:    scope.FolderID,
	}
}

// toJSON marshals v to a JSON string. Returns "{}" on error.
func toJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}
