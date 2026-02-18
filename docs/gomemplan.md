# Pure Go Observational Memory Implementation Plan

## 1. Overview (Implemented)
The Observational Memory (OM) system is implemented entirely within the **GoKitt Wasm module** (`pkg/memory`).
- **Zero Boundary Crossing**: Data stays in Go/SQLite/opfs. LLM calls are made directly from Go.
- **Concurrency**: Runs in the `gokitt.worker.ts` Web Worker.
- **Storage**: Uses existing tables in `sqlite_store.go`.

## 2. Infrastructure (Existing & Updated)

### A. Database Tables
Located in `internal/store/sqlite_store.go`:
- `om_records`: Tracks state. 
- `om_generations`: Logs reflections.
- `thread_messages`: Accessed via `GetUnobservedMessages`.

### B. LLM Client
Located in `pkg/agent/service.go`:
- `Service.ChatWithTools`: Used by `Observer` for structured output.

## 3. Component Architecture (`pkg/memory`)

### A. `Observer` Struct
Implemented in `pkg/memory/memory.go`. It holds:
- `store *store.SQLiteStore`
- `agent *agent.Service`
- `cfg Config`

### B. The Process Loop
The `ProcessLoop` logic is fully implemented:
1.  **Load Context**: Fetches/Creates `OMRecord`.
2.  **Check Threshold**: Uses token counts.
3.  **Observe**: Calls LLM with `observations` + `new_messages`. Updates `om_records`.
4.  **Reflect**: Compresses observations if too large. Logs to `om_generations`.

### C. Prompts
Implemented inline as methods:
- `buildObserverPrompt`
- `buildReflectorPrompt`

## 4. Integration Points

### A. `ChatService` (Entry Point)
The `ProcessLoop` is triggered asynchronously in `pkg/chat/service.go`:
```go
// In AddMessage:
go func() {
    if err := s.observer.ProcessLoop(ctx, threadID); err != nil {
        fmt.Printf("[OM] Error: %v", err)
    }
}()
```

### B. WASM API
Exposed via `jsChatGetContext` in `cmd/wasm/main.go`. This returns:
```json
{
  "memories": [...],
  "om": { "observations": "...", "current_task": "..." }
}
```

## 5. Implementation Status
- [x] **Create `pkg/memory`**: Done.
- [x] **Implement `ProcessLoop`**: Done.
- [x] **Port Prompts**: Done (inline).
- [x] **Wire up LLM**: Done (`pkg/agent`).
- [x] **Hook into Service**: Done (`pkg/chat` & `main.go`).
- [x] **Compile**: Verified (`go build` success).
