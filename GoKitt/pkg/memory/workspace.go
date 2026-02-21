// Package memory provides the Observer/Reflector OM pipeline and the
// Workspace — a programmatic tool sandbox for the Reflector to use when
// observation misses are detected.
package memory

import (
	"fmt"
	"strings"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/gdr"
)

// =============================================================================
// Workspace — programmatic tool sandbox for the Reflector
// =============================================================================

// ToolName identifies a registered workspace tool.
type ToolName string

const (
	ToolSearchNotes     ToolName = "search_notes"
	ToolSearchBlocksGDR ToolName = "search_blocks_gdr"
	ToolFetchEpisodes   ToolName = "fetch_episodes"
	ToolGetArtifact     ToolName = "get_artifact"
	ToolPutArtifact     ToolName = "put_artifact"
)

// ToolArgs is the input map for a tool call.
type ToolArgs map[string]interface{}

// ToolResult is the output of a tool call.
type ToolResult struct {
	Tool  ToolName    `json:"tool"`
	Ok    bool        `json:"ok"`
	Data  interface{} `json:"data,omitempty"`
	Error string      `json:"error,omitempty"`
	LatMs int64       `json:"lat_ms"`
}

// ActivationResult is the full result of one workspace activation cycle.
type ActivationResult struct {
	Triggered      bool         `json:"triggered"`   // Whether the workspace activated
	MissReason     string       `json:"miss_reason"` // Why it fired
	ToolCalls      []ToolResult `json:"tool_calls"`
	Summary        string       `json:"summary"`         // Compact resurfaced context
	NewObservation string       `json:"new_observation"` // Ready to inject into OMRecord
}

// WorkspaceConfig holds workspace sandbox limits.
type WorkspaceConfig struct {
	MaxToolCalls       int     // Safety cap (default: 5)
	SearchLimit        int     // Max results per search tool (default: 8)
	MissScoreThreshold float64 // Keyword overlap below this triggers workspace (default: 0.2)
}

// DefaultWorkspaceConfig returns sane defaults.
func DefaultWorkspaceConfig() WorkspaceConfig {
	return WorkspaceConfig{
		MaxToolCalls:       5,
		SearchLimit:        8,
		MissScoreThreshold: 0.2,
	}
}

// Workspace is the programmatic tool sandbox.
// It holds references to the store and GDR for tool execution.
type Workspace struct {
	store  *store.SQLiteStore
	gdrIdx *gdr.GateDrivenRetriever // may be nil if not yet hydrated
	cfg    WorkspaceConfig
}

// NewWorkspace creates a Workspace bound to the given store and GDR index.
// gdrIdx may be nil — search_blocks_gdr tool will return empty results gracefully.
func NewWorkspace(s *store.SQLiteStore, g *gdr.GateDrivenRetriever, cfg WorkspaceConfig) *Workspace {
	return &Workspace{
		store:  s,
		gdrIdx: g,
		cfg:    cfg,
	}
}

// =============================================================================
// Miss Signal Detection
// =============================================================================

// MissScore computes a simple keyword overlap score between the incoming prompt
// and the current observations string. Returns a value [0, 1].
// Score < cfg.MissScoreThreshold → workspace should activate.
func (w *Workspace) MissScore(prompt, observations string) float64 {
	if observations == "" || prompt == "" {
		return 0.0
	}

	promptTokens := tokenize(prompt)
	obsLower := strings.ToLower(observations)

	if len(promptTokens) == 0 {
		return 0.0
	}

	hits := 0
	for _, tok := range promptTokens {
		if strings.Contains(obsLower, tok) {
			hits++
		}
	}
	return float64(hits) / float64(len(promptTokens))
}

// ShouldActivate returns true when the miss score is below threshold.
func (w *Workspace) ShouldActivate(prompt, observations string) (bool, string) {
	score := w.MissScore(prompt, observations)
	if score < w.cfg.MissScoreThreshold {
		return true, fmt.Sprintf("keyword overlap %.2f < threshold %.2f", score, w.cfg.MissScoreThreshold)
	}
	return false, ""
}

// =============================================================================
// Tool Execution
// =============================================================================

// RunTool executes a single named tool with the provided args.
func (w *Workspace) RunTool(name ToolName, args ToolArgs) ToolResult {
	start := time.Now()
	result := ToolResult{Tool: name}

	defer func() {
		result.LatMs = time.Since(start).Milliseconds()
	}()

	switch name {
	case ToolSearchNotes:
		result = w.runSearchNotes(args)
	case ToolSearchBlocksGDR:
		result = w.runSearchBlocksGDR(args)
	case ToolFetchEpisodes:
		result = w.runFetchEpisodes(args)
	case ToolGetArtifact:
		result = w.runGetArtifact(args)
	case ToolPutArtifact:
		result = w.runPutArtifact(args)
	default:
		result.Error = fmt.Sprintf("unknown tool: %s", name)
	}

	result.Tool = name
	return result
}

// Activate runs the workspace when a miss signal fires.
// It executes a fixed sequence of retrieval tools against the prompt,
// summarizes the results, and returns a new observation ready for injection.
func (w *Workspace) Activate(threadID, scopeID, prompt string, scope *store.ScopeKey) ActivationResult {
	result := ActivationResult{Triggered: true}
	calls := 0

	// Tool 1: Search notes
	if calls < w.cfg.MaxToolCalls {
		r := w.RunTool(ToolSearchNotes, ToolArgs{
			"scope": scope,
			"query": prompt,
			"limit": w.cfg.SearchLimit,
		})
		result.ToolCalls = append(result.ToolCalls, r)
		calls++
	}

	// Tool 2: Search blocks via GDR (lexical only — no embedding at search time)
	if calls < w.cfg.MaxToolCalls && w.gdrIdx != nil {
		r := w.RunTool(ToolSearchBlocksGDR, ToolArgs{
			"query": prompt,
			"limit": w.cfg.SearchLimit,
		})
		result.ToolCalls = append(result.ToolCalls, r)
		calls++
	}

	// Tool 3: Fetch recent episodes
	if calls < w.cfg.MaxToolCalls {
		r := w.RunTool(ToolFetchEpisodes, ToolArgs{
			"scope_id": scopeID,
			"query":    prompt,
			"limit":    w.cfg.SearchLimit,
		})
		result.ToolCalls = append(result.ToolCalls, r)
		calls++
	}

	// Summarize all retrieved context into a compact observation
	result.Summary = w.summarizeResults(prompt, result.ToolCalls)
	result.NewObservation = w.buildObservation(threadID, prompt, result.Summary)

	return result
}

// =============================================================================
// Individual Tool Implementations
// =============================================================================

func (w *Workspace) runSearchNotes(args ToolArgs) ToolResult {
	r := ToolResult{Ok: false}

	scopeVal, _ := args["scope"]
	scope, ok := scopeVal.(*store.ScopeKey)
	if !ok {
		scope = &store.ScopeKey{}
	}

	query, _ := args["query"].(string)
	limit := intArg(args, "limit", w.cfg.SearchLimit)

	notes, err := w.store.SearchNotes(scope, query, limit)
	if err != nil {
		r.Error = err.Error()
		return r
	}

	type noteHit struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Snippet  string `json:"snippet"`
		FolderID string `json:"folder_id"`
	}

	hits := make([]noteHit, 0, len(notes))
	for _, n := range notes {
		snippet := n.MarkdownContent
		if len(snippet) > 200 {
			snippet = snippet[:200] + "…"
		}
		hits = append(hits, noteHit{
			ID:       n.ID,
			Title:    n.Title,
			Snippet:  snippet,
			FolderID: n.FolderID,
		})
	}

	r.Ok = true
	r.Data = hits
	return r
}

func (w *Workspace) runSearchBlocksGDR(args ToolArgs) ToolResult {
	r := ToolResult{Ok: false}

	if w.gdrIdx == nil {
		r.Ok = true // not an error — GDR not yet hydrated
		r.Data = []interface{}{}
		return r
	}

	query, _ := args["query"].(string)
	if query == "" {
		r.Ok = true
		r.Data = []interface{}{}
		return r
	}

	limit := intArg(args, "limit", w.cfg.SearchLimit)
	cfg := gdr.DefaultGDRConfig()
	cfg.K = limit

	results := w.gdrIdx.SearchLexical(query, cfg)

	type blockHit struct {
		DocID    string  `json:"doc_id"`
		Score    float64 `json:"score"`
		Coverage float64 `json:"coverage"`
	}
	hits := make([]blockHit, 0, len(results))
	for _, res := range results {
		hits = append(hits, blockHit{
			DocID:    res.DocID,
			Score:    res.Score,
			Coverage: res.Coverage,
		})
	}

	r.Ok = true
	r.Data = hits
	return r
}

func (w *Workspace) runFetchEpisodes(args ToolArgs) ToolResult {
	r := ToolResult{Ok: false}

	scopeID, _ := args["scope_id"].(string)
	query, _ := args["query"].(string)
	limit := intArg(args, "limit", w.cfg.SearchLimit)

	var (
		episodes []*store.Episode
		err      error
	)

	if query != "" {
		episodes, err = w.store.SearchEpisodes(scopeID, query, limit)
	} else {
		episodes, err = w.store.GetEpisodes(scopeID, limit)
	}

	if err != nil {
		r.Error = err.Error()
		return r
	}

	r.Ok = true
	r.Data = episodes
	return r
}

func (w *Workspace) runGetArtifact(args ToolArgs) ToolResult {
	r := ToolResult{Ok: false}

	scopeVal, _ := args["scope"]
	scope, ok := scopeVal.(*store.ScopeKey)
	if !ok {
		scope = &store.ScopeKey{}
	}
	key, _ := args["key"].(string)

	art, err := w.store.GetArtifact(scope, key)
	if err != nil {
		r.Error = err.Error()
		return r
	}

	r.Ok = true
	r.Data = art
	return r
}

func (w *Workspace) runPutArtifact(args ToolArgs) ToolResult {
	r := ToolResult{Ok: false}

	artVal, _ := args["artifact"]
	art, ok := artVal.(*store.WorkspaceArtifact)
	if !ok {
		r.Error = "artifact arg must be *store.WorkspaceArtifact"
		return r
	}

	if err := w.store.PutArtifact(art); err != nil {
		r.Error = err.Error()
		return r
	}

	r.Ok = true
	return r
}

// =============================================================================
// Summarization
// =============================================================================

// summarizeResults builds a compact human-readable summary from all tool results.
func (w *Workspace) summarizeResults(prompt string, calls []ToolResult) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Context retrieved for: %q\n\n", prompt))

	for _, call := range calls {
		if !call.Ok {
			continue
		}

		switch call.Tool {
		case ToolSearchNotes:
			if hits, ok := call.Data.([]struct {
				ID      string
				Title   string
				Snippet string
			}); ok && len(hits) > 0 {
				sb.WriteString("📄 Notes:\n")
				for _, h := range hits {
					sb.WriteString(fmt.Sprintf("  - %s: %s\n", h.Title, h.Snippet))
				}
			}
		case ToolSearchBlocksGDR:
			sb.WriteString(fmt.Sprintf("🔍 Block search returned results\n"))
		case ToolFetchEpisodes:
			if eps, ok := call.Data.([]*store.Episode); ok && len(eps) > 0 {
				sb.WriteString(fmt.Sprintf("📝 %d matching episodes found\n", len(eps)))
				for _, ep := range eps {
					sb.WriteString(fmt.Sprintf("  - [%s] %s → %s\n",
						ep.ActionType, ep.TargetKind, ep.TargetID))
				}
			}
		}
	}

	return sb.String()
}

// buildObservation formats the summary as a structured observation ready to
// append to the OMRecord.Observations string.
func (w *Workspace) buildObservation(threadID, prompt, summary string) string {
	now := time.Now().Format("Jan 02 15:04")
	return fmt.Sprintf(
		"🟡 (%s) [Workspace resurfaced] Query=%q\n%s",
		now, prompt, summary,
	)
}

// =============================================================================
// Helpers
// =============================================================================

// tokenize splits text into lowercase tokens for keyword matching.
func tokenize(text string) []string {
	words := strings.Fields(strings.ToLower(text))
	tokens := make([]string, 0, len(words))
	for _, w := range words {
		// Strip punctuation
		w = strings.Trim(w, ".,!?;:\"'()")
		if len(w) >= 3 { // Skip very short tokens
			tokens = append(tokens, w)
		}
	}
	return tokens
}

// intArg extracts an int from ToolArgs with a default.
func intArg(args ToolArgs, key string, def int) int {
	val, ok := args[key]
	if !ok {
		return def
	}
	switch v := val.(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return def
}
