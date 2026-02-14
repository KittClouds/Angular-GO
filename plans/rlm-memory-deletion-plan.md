# RLM & Memory Systems Deletion Plan

**Date:** 2026-02-13  
**Status:** AUDIT COMPLETE - Ready for Deletion

---

## Executive Summary

The RLM (Reinforcement Learning Memory) and Memory systems are **fully wired** across both Go WASM and TypeScript layers. This plan details the complete removal of these systems while preserving the ERE (Entity Relation Extraction) service.

---

## Current State Analysis

### Directories to DELETE

| Directory | Status | Files |
|-----------|--------|-------|
| `GoKitt/pkg/rlm/` | **EMPTY** | No files found |
| `GoKitt/pkg/memory/` | **EMPTY** | No files found |
| `GoKitt/internal/memory/` | **POPULATED** | 6 files (see below) |

**Note:** `pkg/rlm` and `pkg/memory` directories exist but contain no files. They may have been partially cleaned or are placeholder directories.

### Files in `GoKitt/internal/memory/` (TO DELETE)

| File | Lines | Purpose |
|------|-------|---------|
| `om.go` | ~300 | OMOrchestrator - Observer/Reflector/Actor pipeline |
| `observer.go` | ~90 | Observer - LLM-based observation extraction |
| `reflector.go` | ~110 | Reflector - LLM-based observation compression |
| `llm_client.go` | ~20 | LLM client interface for OM |
| `token_counter.go` | ~30 | Token counting utilities |
| `token_counter_test.go` | ~90 | Tests for token counter |

---

## Wiring Analysis - Go Layer

### 1. [`GoKitt/cmd/wasm/main.go`](GoKitt/cmd/wasm/main.go)

**Imports to Remove:**
```go
// Line 15
omm "github.com/kittclouds/gokitt/internal/memory"

// Line 25
"github.com/kittclouds/gokitt/pkg/memory"

// Line 32
"github.com/kittclouds/gokitt/pkg/rlm"
```

**Global Variables to Remove:**
```go
// Line 51
var memorySvc *memory.Extractor       // Phase 7: Memory extraction

// Line 52
var omSvc *omm.OMOrchestrator         // Phase 8: Observational Memory pipeline

// Line 53
var rlmEngine *rlm.Engine             // Phase 9: RLM Engine
```

**JS Exports to Remove:**
```go
// Lines ~152-153 - Remove from GoKitt export map
"rlmExecute": js.FuncOf(jsRLMExecute),

// OM exports (if removing OM entirely)
"omProcess":    js.FuncOf(jsOMProcess),
"omGetRecord":  js.FuncOf(jsOMGetRecord),
"omObserve":    js.FuncOf(jsOMObserve),
"omReflect":    js.FuncOf(jsOMReflect),
"omClear":      js.FuncOf(jsOMClear),
"omSetConfig":  js.FuncOf(jsOMSetConfig),
```

**Functions to Remove:**
- `jsRLMExecute()` - Lines ~2198-2215
- `jsOMProcess()` - Lines ~2064-2080
- `jsOMGetRecord()` - Lines ~2084-2102
- `jsOMObserve()` - Lines ~2106-2119
- `jsOMReflect()` - Lines ~2123-2136
- `jsOMClear()` - Lines ~2140-2153
- `jsOMSetConfig()` - Lines ~2157-2188

**Initialization Code to Remove (in `jsChatInit`):**
```go
// Lines ~1755-1763 - Memory Extractor initialization
memorySvc = memory.NewExtractor(memory.ExtractorConfig{...})
chatSvc = chat.NewChatService(sqlStore, memorySvc)

// Lines ~1779-1789 - OM and RLM initialization
llmClient := memory.NewOpenRouterClient(...)
omSvc = omm.NewOMOrchestrator(sqlStore, llmClient, omConfig)
rlmWorkspace := rlm.NewWorkspace(sqlStore)
rlmEngine = rlm.NewEngine(rlmWorkspace)
omSvc.SetWorkspace(rlmWorkspace)
```

**Chat Context Retrieval to Remove:**
```go
// Lines ~2007-2010 in chatSendMessage
var obsCtx string
if omSvc != nil {
    obsCtx, _ = omSvc.GetContext(threadID)
}
```

---

### 2. [`GoKitt/pkg/chat/service.go`](GoKitt/pkg/chat/service.go)

**Import to Remove:**
```go
// Line 12
"github.com/kittclouds/gokitt/pkg/memory"
```

**Struct Field to Remove:**
```go
// Line 18
extractor *memory.Extractor
```

**Constructor Update:**
```go
// Line 22 - Change from:
func NewChatService(s store.Storer, e *memory.Extractor) *ChatService

// To:
func NewChatService(s store.Storer) *ChatService
```

**Memory Extraction Logic to Remove (in `AddMessage`):**
```go
// Lines 87-95
if s.extractor != nil && s.extractor.IsEnabled() && role == "user" {
    go func() {
        if _, err := s.extractor.ProcessMessage(threadID, msg); err != nil {
            fmt.Printf("[ChatService] Memory extraction failed: %v\n", err)
        }
    }()
}
```

**Memory Context Function to Remove:**
```go
// Lines 177-185
func (s *ChatService) GetContextWithMemories(threadID string) (string, error) {
    memories, err := s.store.GetMemoriesForThread(threadID)
    if err != nil {
        return "", err
    }
    return memory.FormatContextForLLM(memories), nil
}
```

---

### 3. [`GoKitt/internal/store/models.go`](GoKitt/internal/store/models.go)

**Types to Remove (Lines 226-269):**
```go
// RLM Workspace Types section
type ScopeKey struct { ... }
type ArtifactKind string
const ( ArtifactHits, ArtifactSpanSet, ... )
type WorkspaceArtifact struct { ... }
type PinnedPayload struct { ... }
```

**Storer Interface Methods to Remove:**
```go
// Lines ~351-356
PutArtifact(art *WorkspaceArtifact) error
GetArtifact(key, threadID, narrativeID, folderID string) (*WorkspaceArtifact, error)
ListArtifacts(threadID, narrativeID, folderID string) ([]*WorkspaceArtifact, error)
DeleteArtifact(key, threadID, narrativeID, folderID string) error
ListPinnedArtifacts(threadID, narrativeID, folderID string) ([]*PinnedPayload, error)
```

---

### 4. [`GoKitt/internal/store/sqlite_store.go`](GoKitt/internal/store/sqlite_store.go)

**Schema to Remove (Lines ~200-213):**
```sql
-- RLM Workspace Artifacts
CREATE TABLE IF NOT EXISTS rlm_artifacts (
    key TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    narrative_id TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT,
    pinned INTEGER DEFAULT 0,
    produced_by TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    PRIMARY KEY (key, thread_id, narrative_id, folder_id)
);
```

**CRUD Methods to Remove (Lines ~2091-2200):**
- `PutArtifact()`
- `GetArtifact()`
- `ListArtifacts()`
- `DeleteArtifact()`
- `ListPinnedArtifacts()`

---

### 5. [`GoKitt/internal/store/workspace_test.go`](GoKitt/internal/store/workspace_test.go)

**Entire file** - Contains RLM Workspace Artifact tests

---

## Wiring Analysis - TypeScript Layer

### 1. [`src/app/services/gokitt.service.ts`](src/app/services/gokitt.service.ts)

**Message Types to Remove:**
```typescript
// Line 79
| { type: 'RLM_EXECUTE'; payload: { requestJSON: string }; id: number }

// Line 155
| { type: 'RLM_EXECUTE_RESULT'; id: number; payload: string }
```

**Method to Remove:**
```typescript
// Lines 1384-1390
async rlmExecute(requestJSON: string): Promise<string> {
    if (!this.wasmLoaded) {
        throw new Error('WASM not loaded');
    }
    return this.sendRequest('RLM_EXECUTE', { requestJSON });
}
```

---

### 2. [`src/app/workers/gokitt.worker.ts`](src/app/workers/gokitt.worker.ts)

**Message Types to Remove:**
```typescript
// Line 110
| { type: 'RLM_EXECUTE'; payload: { requestJSON: string }; id: number }

// Line 194
| { type: 'RLM_EXECUTE_RESULT'; id: number; payload: string }
```

**WASM Interface to Remove:**
```typescript
// Line 341
rlmExecute: (requestJSON: string) => string;
```

**Handler to Remove:**
```typescript
// Lines 397-414
case 'RLM_EXECUTE': {
    if (!wasmLoaded) {
        self.postMessage({
            type: 'RLM_EXECUTE_RESULT',
            id: msg.id,
            payload: ''
        });
        return;
    }
    const res = GoKitt.rlmExecute(msg.payload.requestJSON);
    self.postMessage({
        type: 'RLM_EXECUTE_RESULT',
        id: msg.id,
        payload: res
    });
    break;
}
```

---

### 3. [`src/app/services/orchestrator.service.ts`](src/app/services/orchestrator.service.ts)

**RLM Planning Logic to Remove:**
```typescript
// Lines 118-155 - RLM action mapping and execution
const rlmActions = actions.map(a => ({...}))
const request = {
    scope: { thread_id: threadId, ... },
    workspace_plan: 'Gather context for user query',
    actions: rlmActions
};
const responseJson = await this.goKitt.rlmExecute(JSON.stringify(request));
```

---

### 4. [`src/app/lib/services/go-chat.service.ts`](src/app/lib/services/go-chat.service.ts)

**Memory Extraction Scheduling to Remove:**
```typescript
// Lines 91-94
private memoryExtractionTimer: ReturnType<typeof setTimeout> | null = null;
private readonly MEMORY_EXTRACTION_DELAY_MS = 5000;

// Lines 364-367
if (role === 'user') {
    this.scheduleMemoryExtraction(thread.id);
}

// Lines 547-563
private scheduleMemoryExtraction(threadId: string): void {
    if (this.memoryExtractionTimer) {
        clearTimeout(this.memoryExtractionTimer);
    }
    this.memoryExtractionTimer = setTimeout(() => {
        console.log('[GoChatService] Triggering memory extraction for thread:', threadId);
        this.memoryExtractionTimer = null;
    }, this.MEMORY_EXTRACTION_DELAY_MS);
}
```

---

## Components to PRESERVE

### 1. `GoKitt/pkg/extraction/` - ERE Service

**Status:** Directory exists but appears empty. Verify if ERE logic has been moved elsewhere.

### 2. Memory-related types in `models.go`

The following should be **PRESERVED** (used by chat threads):
- `Thread` struct
- `ThreadMessage` struct
- `Memory` struct (if used independently of extraction)

---

## Execution Order

### Phase 1: TypeScript Layer Cleanup
1. Remove `RLM_EXECUTE` from `gokitt.service.ts`
2. Remove `RLM_EXECUTE` handler from `gokitt.worker.ts`
3. Remove RLM logic from `orchestrator.service.ts`
4. Remove memory extraction scheduling from `go-chat.service.ts`

### Phase 2: Go Layer Cleanup
1. Update `GoKitt/pkg/chat/service.go` - Remove memory dependency
2. Update `GoKitt/cmd/wasm/main.go` - Remove imports, globals, exports, initialization
3. Remove RLM types from `GoKitt/internal/store/models.go`
4. Remove RLM CRUD from `GoKitt/internal/store/sqlite_store.go`
5. Delete `GoKitt/internal/store/workspace_test.go`

### Phase 3: Directory Deletion
1. Delete `GoKitt/internal/memory/` (entire directory)
2. Delete empty `GoKitt/pkg/rlm/` directory
3. Delete empty `GoKitt/pkg/memory/` directory

### Phase 4: Verification
1. Run `go build ./...` in GoKitt
2. Run `ng build` in Angular
3. Verify chat functionality works without memory extraction

---

## Impact Assessment

| Component | Impact | Mitigation |
|-----------|--------|------------|
| Chat Service | Loses automatic memory extraction | Feature removal, not a bug |
| Orchestrator | Loses RLM planning capabilities | Feature removal, not a bug |
| SQLite Store | Orphaned `rlm_artifacts` table | Safe to ignore; table will be unused |
| TypeScript Worker | Cleaner message handling | No user-facing impact |

---

## Risk Level: LOW

- No shared dependencies with ERE service
- Clean separation between memory/RLM and core chat
- SQLite schema changes are additive only (no breaking changes to existing tables)

---

## Questions for User

1. **OM Functions:** Should we also remove the OM (Observational Memory) functions (`omProcess`, `omGetRecord`, etc.)? They depend on `internal/memory`.

2. **Memory Table:** Should we remove the `memories` table from SQLite, or keep it for potential future use?

3. **Chat Context:** The `GetContextWithMemories` function will be removed. Is this acceptable?
