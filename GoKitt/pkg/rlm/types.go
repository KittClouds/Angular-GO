// Package rlm implements the RLM (Retrieval-augmented Language Model) workspace
// layer for GoKitt. It provides scoped workspace artifact storage, corpus
// retrieval operations, and a dispatch engine that processes strict JSON
// action requests.
//
// This is an additive layer on top of the existing OM (Observer → Reflector → Actor)
// pipeline. It does not replace OM; it provides external-state + tool-action
// semantics so the model never needs to reason over the full corpus in-context.
package rlm

import (
	"encoding/json"
)

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

// ScopeKey identifies the RLM workspace scope.
// Mirrors store.ScopeKey but is re-declared here for package independence.
type ScopeKey struct {
	ThreadID    string `json:"thread_id"`
	NarrativeID string `json:"narrative_id"`
	FolderID    string `json:"folder_id"`
}

// ---------------------------------------------------------------------------
// Request / Response contracts (strict JSON)
// ---------------------------------------------------------------------------

// Request is the incoming RLM dispatch envelope.
type Request struct {
	Scope         ScopeKey `json:"scope"`
	CurrentTask   string   `json:"current_task"`
	WorkspacePlan string   `json:"workspace_plan"`
	Actions       []Action `json:"actions"`
}

// Action is a single tool-call operation.
type Action struct {
	Op     string          `json:"op"`
	Args   json.RawMessage `json:"args"`    // op-specific arguments
	SaveAs string          `json:"save_as"` // artifact key to store result under
}

// Response is the outgoing RLM dispatch envelope.
type Response struct {
	Scope         ScopeKey       `json:"scope"`
	CurrentTask   string         `json:"current_task"`
	WorkspacePlan string         `json:"workspace_plan"`
	Results       []ActionResult `json:"results"`
	Final         Final          `json:"final"`
}

// ActionResult captures the outcome of a single action.
type ActionResult struct {
	Op     string `json:"op"`
	SaveAs string `json:"save_as"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
}

// Final is the terminal output descriptor.
type Final struct {
	Type    string `json:"type"` // "none" | "answer" | "patch_plan"
	Content string `json:"content"`
}

// ---------------------------------------------------------------------------
// Op-specific argument structs
// ---------------------------------------------------------------------------

// ArgsPut is the argument set for workspace.put.
type ArgsPut struct {
	Key     string `json:"key"`
	Kind    string `json:"kind"`
	Payload string `json:"payload"`
}

// ArgsKey is a simple key-only argument (workspace.delete, workspace.pin).
type ArgsKey struct {
	Key string `json:"key"`
}

// ArgsSearch is the argument set for needle.search.
type ArgsSearch struct {
	Query string `json:"query"`
	Limit int    `json:"limit,omitempty"`
}

// ArgsDocID is a single document id argument (notes.get).
type ArgsDocID struct {
	DocID string `json:"doc_id"`
}

// ArgsSpansRead is the argument set for spans.read.
type ArgsSpansRead struct {
	DocID    string `json:"doc_id"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
	MaxChars int    `json:"max_chars"`
}

// ---------------------------------------------------------------------------
// Hit / Span result types
// ---------------------------------------------------------------------------

// NoteHit is a lightweight search result returned by needle.search.
type NoteHit struct {
	DocID   string `json:"doc_id"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"` // first N chars of match context
}

// SpanRef points to a range within a document.
type SpanRef struct {
	DocID string `json:"doc_id"`
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text"`
}

// ArtifactMeta is the lightweight metadata returned by workspace.get_index.
type ArtifactMeta struct {
	Key        string `json:"key"`
	Kind       string `json:"kind"`
	Pinned     bool   `json:"pinned"`
	ProducedBy string `json:"produced_by"`
	UpdatedAt  int64  `json:"updated_at"`
}
