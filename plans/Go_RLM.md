# Go RLM (Recursive Language Model) Design Specification

## Executive Summary

This document specifies the architecture for porting the TypeScript RLM (Recursive Language Model) system to Go/WASM. The Go implementation will leverage the existing `SQLiteStore`, `KnowledgeGraph`, and `Observer` infrastructure to provide a unified, high-performance reasoning engine.

## 1. Architecture Overview

### 1.1 Current State (TypeScript)

The existing RLM implementation in `src/app/lib/rlm/` provides:
- **RlmLoopService**: Observe → Plan → Execute → Evaluate cycle
- **QueryRunnerService**: Validated query execution with RO/WS lanes
- **RetrievalService**: FTS, vector search, graph expansion
- **WorkspaceOpsService**: Workspace node/edge operations
- **RlmLlmService**: LLM integration for planning and evaluation

### 1.2 Target State (Go/WASM)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Angular Application                              │
├─────────────────────────────────────────────────────────────────────────┤
│  GoKittService → Web Worker → gokitt.wasm                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Go RLM Engine                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │  RLM Loop    │  │  Retrieval   │  │  Workspace   │                   │
│  │  (observe/   │  │  (FTS/Vec/   │  │  Ops         │                   │
│  │   plan/exec/ │  │   Graph)     │  │  (nodes/     │                   │
│  │   evaluate)  │  │              │  │   edges)     │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
│         │                 │                  │                          │
│         └─────────────────┼──────────────────┘                          │
│                           ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      SQLiteStore                                  │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐     │  │
│  │  │ entities   │ │ edges      │ │ notes      │ │ blocks     │     │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘     │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐     │  │
│  │  │ workspace_ │ │ workspace_ │ │ om_records │ │ threads    │     │  │
│  │  │ artifacts  │ │ nodes      │ │            │ │            │     │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Core Types

### 2.1 RLM Context

```go
// RLMContext tracks state through the reasoning loop.
type RLMContext struct {
    WorkspaceID   string            `json:"workspaceId"`
    ThreadID      string            `json:"threadId,omitempty"`
    NarrativeID   string            `json:"narrativeId,omitempty"`
    MaxDepth      int               `json:"maxDepth"`
    CurrentDepth  int               `json:"currentDepth"`
    ParentTaskID  string            `json:"parentTaskId,omitempty"`
    InitialPrompt string            `json:"initialPrompt,omitempty"`
    AppContext    *AppContext       `json:"appContext,omitempty"`
}

// AppContext provides live application state.
type AppContext struct {
    OpenNoteID    string   `json:"openNoteId,omitempty"`
    OpenFolderID  string   `json:"openFolderId,omitempty"`
    NearbyEntities []string `json:"nearbyEntities,omitempty"`
    RecentNotes   []string `json:"recentNotes,omitempty"`
}
```

### 2.2 Workspace Node Types

```go
// WsNodeKind categorizes workspace nodes.
type WsNodeKind string

const (
    WsNodePrompt  WsNodeKind = "prompt"   // Long context storage
    WsNodeThread  WsNodeKind = "thread"   // Conversation reference
    WsNodeClaim   WsNodeKind = "claim"    // Extracted assertion
    WsNodeSpan    WsNodeKind = "span"     // Temporal segment
    WsNodePlan    WsNodeKind = "plan"     // Reasoning plan
    WsNodeQuery   WsNodeKind = "query"    // Query script
    WsNodeResult  WsNodeKind = "result"   // Query result
    WsNodeDraft   WsNodeKind = "draft"    // Working output
    WsNodeTask    WsNodeKind = "task"     // Recursive task
)

// WsEdgeRel defines workspace edge relationships.
type WsEdgeRel string

const (
    WsEdgeProduced    WsEdgeRel = "produced"     // Query → Result
    WsEdgeRefines     WsEdgeRel = "refines"      // Draft → Draft
    WsEdgeContradicts WsEdgeRel = "contradicts"  // Claim → Claim
    WsEdgeSupports    WsEdgeRel = "supports"     // Result → Claim
    WsEdgeDerives     WsEdgeRel = "derives"      // Claim → Draft
    WsEdgeReferences  WsEdgeRel = "references"   // Node → Entity
)

// WsNode is a workspace node for reasoning state.
type WsNode struct {
    ID          string                 `json:"id"`
    WorkspaceID string                 `json:"workspaceId"`
    Kind        WsNodeKind             `json:"kind"`
    JSON        map[string]interface{} `json:"json"`
    CreatedAt   int64                  `json:"createdAt"`
    UpdatedAt   int64                  `json:"updatedAt"`
}

// WsEdge is a workspace edge for reasoning relationships.
type WsEdge struct {
    WorkspaceID string                 `json:"workspaceId"`
    FromID      string                 `json:"fromId"`
    ToID        string                 `json:"toId"`
    Rel         WsEdgeRel              `json:"rel"`
    Meta        map[string]interface{} `json:"meta,omitempty"`
    CreatedAt   int64                  `json:"createdAt"`
}
```

### 2.3 Reasoning Plan

```go
// ReasoningPlan represents a multi-step reasoning plan.
type ReasoningPlan struct {
    PlanID      string     `json:"planId"`
    Steps       []PlanStep `json:"steps"`
    CurrentStep int        `json:"currentStep"`
    Status      string     `json:"status"` // pending, in_progress, completed, failed
    Reasoning   string     `json:"reasoning"`
}

// PlanStep is a single step in a reasoning plan.
type PlanStep struct {
    Description     string   `json:"description"`
    Query           string   `json:"query,omitempty"`
    ExpectedOutput  string   `json:"expectedOutput"` // entities, notes, blocks, graph, aggregation
    Status          string   `json:"status"`         // pending, running, completed, failed
    ResultNodeID    string   `json:"resultNodeId,omitempty"`
}
```

### 2.4 Observation Result

```go
// ObservationResult contains gathered context.
type ObservationResult struct {
    Entities      []EntityHit    `json:"entities"`
    Notes         []NoteHit      `json:"notes"`
    Blocks        []BlockHit     `json:"blocks"`
    Neighborhood  []NeighborHit  `json:"neighborhood,omitempty"`
    ContextSummary string        `json:"contextSummary"`
}

type EntityHit struct {
    ID    string `json:"id"`
    Label string `json:"label"`
    Kind  string `json:"kind"`
}

type NoteHit struct {
    NoteID  string `json:"noteId"`
    Title   string `json:"title"`
    Snippet string `json:"snippet"`
}

type BlockHit struct {
    BlockID string  `json:"blockId"`
    Text    string  `json:"text"`
    Score   float64 `json:"score"`
}

type NeighborHit struct {
    EntityID string `json:"entityId"`
    Depth    int    `json:"depth"`
}
```

## 3. RLM Loop Implementation

### 3.1 Main Loop

```go
package rlm

import (
    "context"
    "fmt"
    "time"

    "github.com/kittclouds/gokitt/internal/store"
    "github.com/kittclouds/gokitt/pkg/agent"
)

// Config holds RLM configuration.
type Config struct {
    MaxDepth        int   `json:"maxDepth"`
    ObserveTimeout  int   `json:"observeTimeoutMs"`  // default: 5000
    PlanTimeout     int   `json:"planTimeoutMs"`     // default: 10000
    ExecuteTimeout  int   `json:"executeTimeoutMs"`  // default: 30000
    EvaluateTimeout int   `json:"evaluateTimeoutMs"` // default: 10000
}

func DefaultConfig() Config {
    return Config{
        MaxDepth:        5,
        ObserveTimeout:  5000,
        PlanTimeout:     10000,
        ExecuteTimeout:  30000,
        EvaluateTimeout: 10000,
    }
}

// Service provides RLM functionality.
type Service struct {
    store  *store.SQLiteStore
    agent  *agent.Service
    config Config
}

// NewService creates a new RLM service.
func NewService(s *store.SQLiteStore, a *agent.Service, cfg Config) *Service {
    return &Service{
        store:  s,
        agent:  a,
        config: cfg,
    }
}

// Run executes the RLM loop for a given context.
func (s *Service) Run(ctx context.Context, rlmCtx *RLMContext) (*RLMResult, error) {
    // 1. Observe: Gather context
    obsResult, err := s.observe(ctx, rlmCtx)
    if err != nil {
        return nil, fmt.Errorf("observe failed: %w", err)
    }

    // 2. Plan: Create reasoning plan
    plan, err := s.plan(ctx, rlmCtx, obsResult)
    if err != nil {
        return nil, fmt.Errorf("plan failed: %w", err)
    }

    // 3. Execute: Run plan steps
    execResult, err := s.execute(ctx, rlmCtx, plan)
    if err != nil {
        return nil, fmt.Errorf("execute failed: %w", err)
    }

    // 4. Evaluate: Check termination
    evalResult, err := s.evaluate(ctx, rlmCtx, execResult)
    if err != nil {
        return nil, fmt.Errorf("evaluate failed: %w", err)
    }

    // Check for recursion
    if evalResult.ShouldRecurse && rlmCtx.CurrentDepth < rlmCtx.MaxDepth {
        childCtx := &RLMContext{
            WorkspaceID:   rlmCtx.WorkspaceID,
            ThreadID:      rlmCtx.ThreadID,
            NarrativeID:   rlmCtx.NarrativeID,
            MaxDepth:      rlmCtx.MaxDepth,
            CurrentDepth:  rlmCtx.CurrentDepth + 1,
            ParentTaskID:  execResult.TaskID,
            InitialPrompt: rlmCtx.InitialPrompt,
            AppContext:    rlmCtx.AppContext,
        }
        return s.Run(ctx, childCtx)
    }

    return &RLMResult{
        Complete:   evalResult.Complete,
        Output:     evalResult.Output,
        Confidence: evalResult.Confidence,
        Artifacts:  execResult.Artifacts,
    }, nil
}

// RLMResult is the final output of the RLM loop.
type RLMResult struct {
    Complete   bool              `json:"complete"`
    Output     string            `json:"output"`
    Confidence float64           `json:"confidence"`
    Artifacts  []*ArtifactRef    `json:"artifacts"`
}

type ArtifactRef struct {
    Key  string `json:"key"`
    Kind string `json:"kind"`
}
```

### 3.2 Observe Step

```go
// observe gathers context via FTS, vector search, and graph expansion.
func (s *Service) observe(ctx context.Context, rlmCtx *RLMContext) (*ObservationResult, error) {
    start := time.Now()
    result := &ObservationResult{}

    // 1. Get nearby entities from app context
    if rlmCtx.AppContext != nil && len(rlmCtx.AppContext.NearbyEntities) > 0 {
        for _, entityID := range rlmCtx.AppContext.NearbyEntities {
            if entity, err := s.store.GetEntity(entityID); err == nil {
                result.Entities = append(result.Entities, EntityHit{
                    ID:    entity.ID,
                    Label: entity.Label,
                    Kind:  entity.Kind,
                })
            }
        }
    }

    // 2. Get open note context
    if rlmCtx.AppContext != nil && rlmCtx.AppContext.OpenNoteID != "" {
        if note, err := s.store.GetNote(rlmCtx.AppContext.OpenNoteID); err == nil {
            result.Notes = append(result.Notes, NoteHit{
                NoteID:  note.ID,
                Title:   note.Title,
                Snippet: truncate(note.Content, 200),
            })
        }
    }

    // 3. Search blocks if we have a prompt
    if rlmCtx.InitialPrompt != "" {
        // Use vector search on blocks (requires embedding - placeholder for now)
        // blocks, err := s.store.SearchBlocks(embedding, 10, rlmCtx.NarrativeID)
    }

    // 4. Build context summary
    result.ContextSummary = s.buildContextSummary(result)

    // Log observation
    fmt.Printf("[RLM] observe completed in %v: %d entities, %d notes, %d blocks\n",
        time.Since(start), len(result.Entities), len(result.Notes), len(result.Blocks))

    return result, nil
}

func (s *Service) buildContextSummary(result *ObservationResult) string {
    var summary string
    if len(result.Entities) > 0 {
        summary += fmt.Sprintf("Found %d entities: ", len(result.Entities))
        for i, e := range result.Entities {
            if i > 0 {
                summary += ", "
            }
            summary += e.Label
        }
        summary += "\n"
    }
    if len(result.Notes) > 0 {
        summary += fmt.Sprintf("Found %d notes: ", len(result.Notes))
        for _, n := range result.Notes {
            summary += fmt.Sprintf("\"%s\" ", n.Title)
        }
        summary += "\n"
    }
    return summary
}
```

### 3.3 Plan Step

```go
// plan creates a reasoning plan using LLM.
func (s *Service) plan(ctx context.Context, rlmCtx *RLMContext, obs *ObservationResult) (*ReasoningPlan, error) {
    // Build planning prompt
    prompt := s.buildPlanPrompt(rlmCtx, obs)

    // Call LLM
    msgs := []agent.Message{
        {Role: "user", Content: &prompt},
    }

    sysPrompt := `You are a reasoning planner. Given context and a goal, create a step-by-step plan.
Output your plan as JSON with this structure:
{
  "steps": [
    {"description": "step description", "query": "optional query", "expectedOutput": "entities|notes|blocks|graph|aggregation"}
  ],
  "reasoning": "why this plan will work"
}`

    resp, err := s.agent.ChatWithTools(ctx, msgs, nil, sysPrompt)
    if err != nil {
        return nil, err
    }

    // Parse LLM response into plan
    plan := s.parsePlanResponse(*resp.Content)
    plan.PlanID = generateID()
    plan.Status = "pending"

    return plan, nil
}

func (s *Service) buildPlanPrompt(rlmCtx *RLMContext, obs *ObservationResult) string {
    return fmt.Sprintf(`## Context
%s

## Goal
%s

## Task
Create a reasoning plan to achieve the goal using the available context.`, 
        obs.ContextSummary, 
        rlmCtx.InitialPrompt)
}
```

### 3.4 Execute Step

```go
// execute runs the reasoning plan.
func (s *Service) execute(ctx context.Context, rlmCtx *RLMContext, plan *ReasoningPlan) (*ExecutionResult, error) {
    result := &ExecutionResult{
        TaskID:    generateID(),
        Artifacts: []*store.WorkspaceArtifact{},
    }

    plan.Status = "in_progress"

    for i, step := range plan.Steps {
        plan.CurrentStep = i
        step.Status = "running"

        // Execute step based on expected output
        artifact, err := s.executeStep(ctx, rlmCtx, &step)
        if err != nil {
            step.Status = "failed"
            plan.Status = "failed"
            return result, fmt.Errorf("step %d failed: %w", i, err)
        }

        step.Status = "completed"
        step.ResultNodeID = artifact.Key
        result.Artifacts = append(result.Artifacts, artifact)
    }

    plan.Status = "completed"
    return result, nil
}

type ExecutionResult struct {
    TaskID    string                      `json:"taskId"`
    Artifacts []*store.WorkspaceArtifact  `json:"artifacts"`
}

func (s *Service) executeStep(ctx context.Context, rlmCtx *RLMContext, step *PlanStep) (*store.WorkspaceArtifact, error) {
    artifact := &store.WorkspaceArtifact{
        Key:         generateID(),
        ThreadID:    rlmCtx.ThreadID,
        NarrativeID: rlmCtx.NarrativeID,
        FolderID:    rlmCtx.AppContext.OpenFolderID,
        ProducedBy:  "rlm_execute",
        CreatedAt:   time.Now().UnixMilli(),
    }

    switch step.ExpectedOutput {
    case "entities":
        entities, _ := s.store.ListEntities("")
        artifact.Kind = store.ArtifactHits
        artifact.Payload = toJSON(entities)
        
    case "notes":
        scope := &store.ScopeKey{NarrativeID: rlmCtx.NarrativeID}
        notes, _ := s.store.SearchNotes(scope, step.Query, 10)
        artifact.Kind = store.ArtifactHits
        artifact.Payload = toJSON(notes)
        
    case "blocks":
        // Vector search placeholder
        artifact.Kind = store.ArtifactSnippet
        artifact.Payload = "{}"
        
    case "graph":
        // Graph expansion placeholder
        artifact.Kind = store.ArtifactSpanSet
        artifact.Payload = "{}"
        
    default:
        artifact.Kind = store.ArtifactSummary
        artifact.Payload = step.Description
    }

    // Persist artifact
    if err := s.store.PutArtifact(artifact); err != nil {
        return nil, err
    }

    return artifact, nil
}
```

### 3.5 Evaluate Step

```go
// evaluate checks if the reasoning is complete.
func (s *Service) evaluate(ctx context.Context, rlmCtx *RLMContext, execResult *ExecutionResult) (*EvaluationResult, error) {
    // Build evaluation prompt
    prompt := s.buildEvalPrompt(rlmCtx, execResult)

    // Call LLM
    msgs := []agent.Message{
        {Role: "user", Content: &prompt},
    }

    sysPrompt := `You are a reasoning evaluator. Given the original goal and execution results, determine:
1. Is the task complete?
2. Should we recurse for more information?
3. What is the final output?

Output JSON:
{
  "complete": true|false,
  "shouldRecurse": true|false,
  "reason": "explanation",
  "output": "final answer if complete",
  "confidence": 0.0-1.0
}`

    resp, err := s.agent.ChatWithTools(ctx, msgs, nil, sysPrompt)
    if err != nil {
        return nil, err
    }

    return s.parseEvalResponse(*resp.Content), nil
}

type EvaluationResult struct {
    Complete      bool    `json:"complete"`
    ShouldRecurse bool    `json:"shouldRecurse"`
    Reason        string  `json:"reason"`
    Output        string  `json:"output"`
    Confidence    float64 `json:"confidence"`
}

func (s *Service) buildEvalPrompt(rlmCtx *RLMContext, execResult *ExecutionResult) string {
    return fmt.Sprintf(`## Original Goal
%s

## Execution Results
%d artifacts produced

## Task
Evaluate if the goal has been achieved.`, 
        rlmCtx.InitialPrompt, 
        len(execResult.Artifacts))
}
```

## 4. WASM API

### 4.1 Exposed Functions

Add to `GoKitt/cmd/wasm/main.go`:

```go
// rlmRun executes the RLM loop.
func rlmRun(this js.Value, args []js.Value) interface{} {
    if len(args) < 1 {
        return errorResult("rlmRun requires context argument")
    }

    // Parse context
    ctxJSON := args[0].String()
    var rlmCtx rlm.RLMContext
    if err := json.Unmarshal([]byte(ctxJSON), &rlmCtx); err != nil {
        return errorResult("invalid context: " + err.Error())
    }

    // Run RLM loop
    result, err := rlmService.Run(context.Background(), &rlmCtx)
    if err != nil {
        return errorResult("rlm run failed: " + err.Error())
    }

    return successResult(result)
}

// rlmObserve executes only the observe step.
func rlmObserve(this js.Value, args []js.Value) interface{} {
    // ... similar pattern
}

// rlmPlan executes observe + plan steps.
func rlmPlan(this js.Value, args []js.Value) interface{} {
    // ... similar pattern
}

// rlmGetArtifacts retrieves workspace artifacts.
func rlmGetArtifacts(this js.Value, args []js.Value) interface{} {
    if len(args) < 1 {
        return errorResult("rlmGetArtifacts requires scope argument")
    }

    scopeJSON := args[0].String()
    var scope store.ScopeKey
    if err := json.Unmarshal([]byte(scopeJSON), &scope); err != nil {
        return errorResult("invalid scope: " + err.Error())
    }

    artifacts, err := store.ListArtifacts(&scope)
    if err != nil {
        return errorResult("list artifacts failed: " + err.Error())
    }

    return successResult(artifacts)
}

// rlmPinArtifact pins an artifact for OM boundary.
func rlmPinArtifact(this js.Value, args []js.Value) interface{} {
    // ... pin artifact implementation
}
```

### 4.2 Registration

```go
func main() {
    // ... existing setup

    // Register RLM functions
    js.Global().Set("rlmRun", js.FuncOf(rlmRun))
    js.Global().Set("rlmObserve", js.FuncOf(rlmObserve))
    js.Global().Set("rlmPlan", js.FuncOf(rlmPlan))
    js.Global().Set("rlmGetArtifacts", js.FuncOf(rlmGetArtifacts))
    js.Global().Set("rlmPinArtifact", js.FuncOf(rlmPinArtifact))

    // ... existing channel wait
}
```

## 5. TypeScript Integration

### 5.1 GoKittService Updates

Add to `src/app/services/gokitt.service.ts`:

```typescript
/**
 * Execute RLM loop for context gathering and reasoning.
 */
async rlmRun(ctx: RLMContext): Promise<RLMResult> {
    return this.postMessage('rlmRun', [JSON.stringify(ctx)]);
}

/**
 * Execute only the observe step for quick context gathering.
 */
async rlmObserve(ctx: RLMContext): Promise<ObservationResult> {
    return this.postMessage('rlmObserve', [JSON.stringify(ctx)]);
}

/**
 * Execute observe + plan for reasoning plan generation.
 */
async rlmPlan(ctx: RLMContext): Promise<ReasoningPlan> {
    return this.postMessage('rlmPlan', [JSON.stringify(ctx)]);
}

/**
 * Get workspace artifacts for a scope.
 */
async rlmGetArtifacts(scope: ScopeKey): Promise<WorkspaceArtifact[]> {
    return this.postMessage('rlmGetArtifacts', [JSON.stringify(scope)]);
}

/**
 * Pin an artifact for crossing RLM → OM boundary.
 */
async rlmPinArtifact(scope: ScopeKey, key: string): Promise<void> {
    return this.postMessage('rlmPinArtifact', [JSON.stringify(scope), key]);
}
```

### 5.2 Type Definitions

```typescript
// src/app/lib/rlm/types/go-rlm.ts

export interface RLMContext {
    workspaceId: string;
    threadId?: string;
    narrativeId?: string;
    maxDepth: number;
    currentDepth: number;
    parentTaskId?: string;
    initialPrompt?: string;
    appContext?: AppContext;
}

export interface AppContext {
    openNoteId?: string;
    openFolderId?: string;
    nearbyEntities?: string[];
    recentNotes?: string[];
}

export interface RLMResult {
    complete: boolean;
    output: string;
    confidence: number;
    artifacts: ArtifactRef[];
}

export interface ObservationResult {
    entities: EntityHit[];
    notes: NoteHit[];
    blocks: BlockHit[];
    neighborhood?: NeighborHit[];
    contextSummary: string;
}

export interface ReasoningPlan {
    planId: string;
    steps: PlanStep[];
    currentStep: number;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    reasoning: string;
}

export interface PlanStep {
    description: string;
    query?: string;
    expectedOutput: 'entities' | 'notes' | 'blocks' | 'graph' | 'aggregation';
    status: 'pending' | 'running' | 'completed' | 'failed';
    resultNodeId?: string;
}
```

## 6. Database Schema

### 6.1 Workspace Tables

Add to `GoKitt/internal/store/sqlite_store.go`:

```sql
-- Workspace nodes for RLM reasoning state
CREATE TABLE IF NOT EXISTS workspace_nodes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    json TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ws_nodes_workspace ON workspace_nodes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_nodes_kind ON workspace_nodes(kind);

-- Workspace edges for RLM reasoning relationships
CREATE TABLE IF NOT EXISTS workspace_edges (
    workspace_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    rel TEXT NOT NULL,
    meta TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, from_id, to_id, rel)
);

CREATE INDEX IF NOT EXISTS idx_ws_edges_from ON workspace_edges(from_id);
CREATE INDEX IF NOT EXISTS idx_ws_edges_to ON workspace_edges(to_id);
```

## 7. Testing Strategy

### 7.1 Unit Tests

```go
// rlm_test.go

func TestObserve_GathersContext(t *testing.T) {
    // Setup store with test data
    store := setupTestStore(t)
    defer store.Close()

    // Add test entity
    store.UpsertEntity(&store.Entity{ID: "e1", Label: "Test Entity", Kind: "Concept"})

    // Create RLM service
    svc := rlm.NewService(store, mockAgent, rlm.DefaultConfig())

    // Run observe
    ctx := &rlm.RLMContext{
        AppContext: &rlm.AppContext{
            NearbyEntities: []string{"e1"},
        },
    }
    result, err := svc.Observe(context.Background(), ctx)

    assert.NoError(t, err)
    assert.Len(t, result.Entities, 1)
    assert.Equal(t, "Test Entity", result.Entities[0].Label)
}

func TestPlan_CreatesValidPlan(t *testing.T) {
    // Test plan generation
}

func TestExecute_RunsPlanSteps(t *testing.T) {
    // Test plan execution
}

func TestEvaluate_DetectsCompletion(t *testing.T) {
    // Test evaluation logic
}

func TestRun_RespectsMaxDepth(t *testing.T) {
    // Test recursion limit
}
```

### 7.2 Integration Tests

```go
func TestRLMFullLoop(t *testing.T) {
    // Test complete observe → plan → execute → evaluate cycle
}
```

## 8. Migration Path

### 8.1 Phase 1: Go Implementation
1. Create `GoKitt/pkg/rlm/` package
2. Implement core types and interfaces
3. Implement observe/plan/execute/evaluate steps
4. Add WASM bindings
5. Write unit tests

### 8.2 Phase 2: TypeScript Integration
1. Add GoKittService methods
2. Create TypeScript type definitions
3. Update RlmLoopService to use Go backend
4. Add feature flag for Go vs TypeScript RLM

### 8.3 Phase 3: Validation
1. Run parallel implementations
2. Compare outputs
3. Performance benchmarking
4. Switch to Go as default

### 8.4 Phase 4: Cleanup
1. Remove TypeScript RLM implementation
2. Update documentation
3. Remove feature flag

## 9. Performance Considerations

### 9.1 Memory Management
- Use sync.Pool for frequently allocated objects
- Limit workspace node count per session
- Implement artifact garbage collection

### 9.2 Concurrency
- Run independent plan steps in parallel
- Use context for cancellation
- Implement timeout handling

### 9.3 Caching
- Cache observation results for repeated queries
- Memoize LLM responses for identical prompts
- Use workspace artifacts as materialized views

## 10. Security Considerations

### 10.1 Input Validation
- Validate all context inputs
- Sanitize LLM-generated queries
- Enforce scope isolation

### 10.2 Resource Limits
- Max depth: 5 (configurable)
- Max artifacts per session: 100
- Max workspace nodes: 1000
- Query timeout: 30s

### 10.3 Audit Trail
- Log all RLM actions to episode_log
- Track LLM token usage
- Record decision reasoning

---

## Appendix A: File Structure

```
GoKitt/
├── pkg/
│   └── rlm/
│       ├── rlm.go              # Main service and loop
│       ├── rlm_test.go         # Unit tests
│       ├── observe.go          # Observe step implementation
│       ├── plan.go             # Plan step implementation
│       ├── execute.go          # Execute step implementation
│       ├── evaluate.go         # Evaluate step implementation
│       ├── types.go            # Type definitions
│       └── prompts.go          # LLM prompt templates
└── internal/
    └── store/
        ├── models.go           # Add WsNode, WsEdge types
        └── sqlite_store.go     # Add workspace tables
```

## Appendix B: Dependencies

- `github.com/kittclouds/gokitt/internal/store` - SQLite persistence
- `github.com/kittclouds/gokitt/pkg/agent` - LLM integration
- `github.com/kittclouds/gokitt/pkg/knowledge` - Graph operations
- `syscall/js` - WASM bindings
