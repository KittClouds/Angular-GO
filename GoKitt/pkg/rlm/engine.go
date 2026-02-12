package rlm

import (
	"encoding/json"
	"fmt"
)

// Engine dispatches RLM action requests to Workspace methods.
// It accepts raw JSON, validates the structure, dispatches each action,
// and returns a strict JSON response.
type Engine struct {
	ws *Workspace
}

// NewEngine creates a new RLM dispatch engine.
func NewEngine(ws *Workspace) *Engine {
	return &Engine{ws: ws}
}

// Execute processes a raw JSON RLM request and returns a JSON response.
func (e *Engine) Execute(reqJSON []byte) ([]byte, error) {
	var req Request
	if err := json.Unmarshal(reqJSON, &req); err != nil {
		return nil, fmt.Errorf("rlm: invalid request JSON: %w", err)
	}

	// Validate scope — thread_id is always required
	if req.Scope.ThreadID == "" {
		return nil, fmt.Errorf("rlm: scope.thread_id is required")
	}

	resp := Response{
		Scope:         req.Scope,
		CurrentTask:   req.CurrentTask,
		WorkspacePlan: req.WorkspacePlan,
		Results:       make([]ActionResult, len(req.Actions)),
		Final:         Final{Type: "none", Content: ""},
	}

	for i, action := range req.Actions {
		result := e.dispatch(&req.Scope, action)
		resp.Results[i] = result
	}

	return json.Marshal(resp)
}

// dispatch routes a single action to the correct workspace method.
func (e *Engine) dispatch(scope *ScopeKey, action Action) ActionResult {
	result := ActionResult{
		Op:     action.Op,
		SaveAs: action.SaveAs,
	}

	var err error
	var payload interface{}

	switch action.Op {

	case "workspace.get_index":
		payload, err = e.ws.GetIndex(scope)

	case "workspace.put":
		var args ArgsPut
		if err = json.Unmarshal(action.Args, &args); err != nil {
			break
		}
		err = e.ws.Put(scope, args.Key, args.Kind, args.Payload, action.Op)

	case "workspace.delete":
		var args ArgsKey
		if err = json.Unmarshal(action.Args, &args); err != nil {
			break
		}
		err = e.ws.Delete(scope, args.Key)

	case "workspace.pin":
		var args ArgsKey
		if err = json.Unmarshal(action.Args, &args); err != nil {
			break
		}
		err = e.ws.Pin(scope, args.Key)

	case "needle.search":
		var args ArgsSearch
		if err = json.Unmarshal(action.Args, &args); err != nil {
			break
		}
		payload, err = e.ws.NeedleSearch(scope, args.Query, args.Limit)

	case "notes.get":
		var args ArgsDocID
		if err = json.Unmarshal(action.Args, &args); err != nil {
			break
		}
		payload, err = e.ws.NotesGet(args.DocID)

	case "notes.list":
		payload, err = e.ws.NotesList(scope)

	case "spans.read":
		var args ArgsSpansRead
		if err = json.Unmarshal(action.Args, &args); err != nil {
			break
		}
		payload, err = e.ws.SpansRead(args.DocID, args.Start, args.End, args.MaxChars)

	default:
		err = fmt.Errorf("unknown op: %q", action.Op)
	}

	if err != nil {
		result.OK = false
		result.Error = err.Error()
		return result
	}

	result.OK = true

	// If the action produced data and has a save_as key, store it in workspace
	if action.SaveAs != "" && payload != nil {
		kind := inferKind(action.Op)
		payloadJSON := toJSON(payload)
		if storeErr := e.ws.Put(scope, action.SaveAs, kind, payloadJSON, action.Op); storeErr != nil {
			result.Error = fmt.Sprintf("op succeeded but save_as failed: %v", storeErr)
		}
	}

	return result
}

// inferKind maps an op name to an artifact kind for save_as storage.
func inferKind(op string) string {
	switch op {
	case "needle.search":
		return "hits"
	case "spans.read":
		return "span_set"
	case "notes.get":
		return "snippet"
	case "notes.list":
		return "table"
	case "workspace.get_index":
		return "table"
	default:
		return "snippet"
	}
}
