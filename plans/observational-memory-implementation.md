# Observational Memory Implementation Plan

**Status:** APPROVED — Ready for implementation  
**Date:** 2026-02-11

## Confirmed Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Core loop only (observe → reflect → inject) | Deferred: part-level markers, multi-thread batching, stream markers |
| ObserveThreshold | 1000 tokens (~4k chars / ~5-6 messages) | Configurable via Angular settings |
| ReflectThreshold | 4000 tokens | Configurable via Angular settings |
| Token estimation | `len(text)/4` heuristic | Accurate enough for thresholds, no tiktoken dependency |
| OM Toggle | Yes — hard on/off in Angular settings | User control over LLM costs |

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Angular   │────▶│  WASM Bridge │────▶│  Go Layer   │
│  GoOMService│     │  jsOM* funcs │     │ OMOrchestrator
└─────────────┘     └──────────────┘     └─────────────┘
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                     ▼                     ▼
                   ┌───────────┐         ┌───────────┐         ┌───────────┐
                   │  Observer │         │ Reflector │         │ SQLiteStore│
                   │   (LLM)   │         │   (LLM)   │         │           │
                   └───────────┘         └───────────┘         └───────────┘
```

## Data Flow

```
User sends message
       │
       ▼
jsChatAddMessage()
       │
       ├──▶ Store message in SQLite
       │
       └──▶ omSvc.Process(threadID) [async]
              │
              ├──▶ Load unobserved messages (createdAt > lastObservedAt)
              │
              ├──▶ countTokens(unobserved) >= ObserveThreshold?
              │         │
              │         ▼ YES
              │    Observer.Observe(messages, existingObs)
              │         │
              │         ▼
              │    Merge new observations, update cursor
              │
              └──▶ obsTokenCount >= ReflectThreshold?
                         │
                         ▼ YES
                    Reflector.Reflect(observations)
                         │
                         ▼
                    Store generation, update condensed observations
```

## Implementation Checklist

### Phase 1: Go Data Layer

- [ ] **models.go** — Add types:
  - `OMRecord` — Per-thread observation state
  - `OMGeneration` — Reflection compression history
  - `OMConfig` — Threshold settings

- [ ] **store.go interface** — Add methods:
  - `UpsertOMRecord(record *OMRecord) error`
  - `GetOMRecord(threadID string) (*OMRecord, error)`
  - `DeleteOMRecord(threadID string) error`
  - `AddOMGeneration(gen *OMGeneration) error`
  - `GetOMGenerations(threadID string) ([]*OMGeneration, error)`

- [ ] **sqlite_store.go** — Add schema:
  ```sql
  CREATE TABLE IF NOT EXISTS om_records (
      thread_id TEXT PRIMARY KEY,
      observations TEXT NOT NULL DEFAULT '',
      current_task TEXT NOT NULL DEFAULT '',
      last_observed_at INTEGER NOT NULL DEFAULT 0,
      obs_token_count INTEGER NOT NULL DEFAULT 0,
      generation_num INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS om_generations (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      input_text TEXT NOT NULL,
      output_text TEXT NOT NULL,
      created_at INTEGER NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_om_gen_thread ON om_generations(thread_id, generation);
  ```

- [ ] **sqlite_store.go** — Implement 5 interface methods

### Phase 2: Go OM Pipeline

- [ ] **token_counter.go** — Simple estimation:
  ```go
  func EstimateTokens(text string) int {
      return (len(text) + 3) / 4
  }
  ```

- [ ] **observer.go** — LLM-based observation extraction:
  - System prompt adapted from Mastra
  - Returns `ObserverResult{Observations, CurrentTask}`
  - Uses existing `OpenRouterClient` pattern

- [ ] **reflector.go** — LLM-based compression:
  - Compresses observations when threshold exceeded
  - Retries if output still too large
  - Returns `ReflectorResult{Condensed, TokenCount}`

- [ ] **om.go** — Orchestrator state machine:
  - `Process(threadID)` — Main entry point
  - `GetContext(threadID)` — Returns formatted observations for system prompt
  - `Observe(threadID)` — Manual trigger
  - `Reflect(threadID)` — Manual trigger
  - `Clear(threadID)` — Reset state

### Phase 3: WASM Bridge

- [ ] **main.go** — Add global `omSvc *memory.OMOrchestrator`
- [ ] **main.go** — Wire into `jsChatInit`
- [ ] **main.go** — Wire `omSvc.Process()` into `jsChatAddMessage`
- [ ] **main.go** — Export functions:
  - `jsOMProcess(threadID)` → `{observed: bool, reflected: bool}`
  - `jsOMGetRecord(threadID)` → OMRecord JSON
  - `jsOMObserve(threadID)` → success/error
  - `jsOMReflect(threadID)` → success/error
  - `jsOMClear(threadID)` → success/error

### Phase 4: Angular Integration

- [ ] **go-om.service.ts** — Minimal WASM wrapper
- [ ] **go-chat.service.ts** — Inject observations into context:
  ```
  <observations>
  [LLM-extracted observations from previous conversations]
  Current task: [what user is working on]
  </observations>
  
  Relevant memories:
  - [existing fact-extracted memories]
  ```
- [ ] **Settings UI** — Add OM controls:
  - Enable/Disable toggle
  - ObserveThreshold input (default: 1000)
  - ReflectThreshold input (default: 4000)

### Phase 5: Testing

- [ ] `TestOMRecordCRUD` — Upsert, get, delete
- [ ] `TestOMGenerationHistory` — Add and query generations
- [ ] `TestTokenCounter` — Verify estimation accuracy
- [ ] `TestOMOrchestrator` — Full pipeline integration

## Deferred Features (v2+)

| Feature | Reason |
|---------|--------|
| Part-level observation markers | Complex message mutation, low ROI |
| Multi-thread batching | Single-thread focus |
| Sealed message ID tracking | Not using messages-as-DB-records |
| Stream markers | Nice-to-have for UI |
| xxhash thread ID obscuring | Security theater |
| Shared budget mode | Fixed thresholds sufficient |
| Future intent detection | Can add to observer prompt later |

## File Changes Summary

| File | Action | Lines Est. |
|------|--------|------------|
| `GoKitt/internal/store/models.go` | MODIFY | +30 |
| `GoKitt/internal/store/store.go` | MODIFY | +10 |
| `GoKitt/internal/store/sqlite_store.go` | MODIFY | +80 |
| `GoKitt/internal/memory/token_counter.go` | NEW | +20 |
| `GoKitt/internal/memory/observer.go` | NEW | +100 |
| `GoKitt/internal/memory/reflector.go` | NEW | +80 |
| `GoKitt/internal/memory/om.go` | NEW | +150 |
| `GoKitt/cmd/wasm/main.go` | MODIFY | +100 |
| `src/app/services/go-om.service.ts` | NEW | +50 |
| `src/app/services/go-chat.service.ts` | MODIFY | +30 |
| `src/app/components/settings/*` | MODIFY | +40 |

**Total estimated:** ~700 lines new/modified
