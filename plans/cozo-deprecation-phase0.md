# CozoDB Safe Deprecation Plan - Phase 0

## Objective
Clean up all CozoDB imports and dead code before beginning the phased migration to GoSQLite/GoKitt.

## Principles
1. **No functional changes** - Only remove unused code and comments
2. **Preserve app stability** - If code is actively used, mark for later phase
3. **Document everything** - Track what was removed and why

---

## CozoDB Usage Categories

### Category A: Core Infrastructure (DO NOT TOUCH in Phase 0)
These files implement CozoDB itself. They will be removed in the final phase.

| File | Purpose | Phase |
|------|---------|-------|
| `src/app/lib/cozo/db.ts` | CozoDB WASM initialization | Final |
| `src/app/lib/cozo/persistence/*` | OPFS persistence layer | Final |
| `src/app/lib/cozo/schema/*` | Datalog schemas | Final |
| `src/app/lib/cozo/fts/*` | Full-text search | Final |
| `src/app/lib/cozo/graph/*` | Graph registry and queries | Final |
| `src/app/lib/cozo/content/*` | Content repository | Final |
| `src/app/lib/cozo/api/*` | API layer | Final |
| `src/app/lib/cozo/memory/*` | Episode log, memory recall | Final |
| `src/app/lib/cozo/cozo.service.ts` | Angular service wrapper | Final |

### Category B: Active Usage (Mark for Migration)
These files actively use CozoDB and need migration in later phases.

| File | Usage | Migration Target |
|------|-------|------------------|
| `src/app/app.component.ts` | Background init | Remove CozoDB init |
| `src/app/lib/bridge/GoSqliteCozoBridge.ts` | Dual-write, folder sync | Remove Cozo sync |
| `src/app/lib/bridge/CozoHydrator.ts` | Hydrate Cozo from GoSQLite | Remove entirely |
| `src/app/lib/bridge/CozoFieldMapper.ts` | Field mapping | Remove entirely |
| `src/app/lib/operations.ts` | recordAction, syncNote | Remove Cozo sync |
| `src/app/lib/rlm/services/workspace-ops.service.ts` | cozoDb import | Migrate to GoKitt |
| `src/app/lib/rlm/services/query-runner.service.ts` | cozoDb queries | Migrate to GoKitt |
| `src/app/lib/rlm/services/rlm-loop.service.ts` | recordAction, ftsService | Migrate to GoKitt |
| `src/app/lib/services/semantic-search.service.ts` | HNSW search | Migrate to GoKitt |
| `src/app/lib/services/embedding-queue.service.ts` | RAPTOR persistence | Migrate to GoKitt |
| `src/app/services/graph-viz.service.ts` | fromCozoDB fallback | Remove fallback |
| `src/app/services/gokitt.service.ts` | graphRegistry import | Remove import |
| `src/app/pages/graph/graph-page.component.ts` | Fallback to CozoDB | Remove fallback |
| `src/app/components/sidebar/sidebar.component.ts` | Persist to CozoDB | Remove Cozo persist |
| `src/app/components/fact-sheets/fact-sheet-container/` | graphRegistry import | Remove import |

### Category C: Dead Code / Comments (Safe to Remove in Phase 0)
These are comments, deprecated code, or unused references.

| File | Line(s) | Content | Action |
|------|---------|---------|--------|
| `src/app/workers/gokitt.worker.ts` | 104-124 | Comments "CozoDB Parity" | Remove comments |
| `src/app/workers/gokitt.worker.ts` | 233-244 | Comments "CozoDB Parity Results" | Remove comments |
| `src/app/workers/gokitt.worker.ts` | 385-386 | Comment "CozoDB Parity API" | Remove comment |
| `src/app/workers/gokitt.worker.ts` | 1417-1620 | Section comments | Remove comments |
| `src/app/services/gokitt.service.ts` | 61-79 | Comments "CozoDB Parity" | Remove comments |
| `src/app/services/gokitt.service.ts` | 154-155 | Comment "CozoDB Parity Results" | Remove comment |
| `src/app/services/gokitt.service.ts` | 487-520 | Comment "Persist to CozoDB" | Update comment |
| `src/app/services/gokitt.service.ts` | 1432-1433 | Comment "CozoDB Parity API" | Remove comment |
| `src/app/services/knowledge.service.ts` | 8 | Comment "Replaces CozoDB" | Update comment |
| `src/app/services/graph-viz.service.ts` | 4 | Comment "GoKitt/CozoDB" | Update comment |
| `src/app/services/graph-viz.service.ts` | 329-428 | fromCozoDB method | Mark deprecated |
| `src/app/lib/dexie/db.ts` | 126-179 | Deprecated comments | Already marked |
| `src/app/lib/dexie/db.ts` | 652-654 | Comment about migration | Keep for reference |
| `src/app/lib/dexie/db.ts` | 725-731 | Comment about migration | Keep for reference |
| `src/app/lib/rlm/index.ts` | 4 | Comment "using CozoDB" | Update comment |
| `src/app/lib/rlm/services/retrieval.service.ts` | 56-333 | Comments about CozoDB | Update comments |
| `src/app/lib/services/projection-cache.service.ts` | 5-103 | Comments about CozoDB | Update comments |
| `src/app/lib/model-cache/db.ts` | 9 | Comment "isolated from CozoDB" | Keep - clarifies isolation |
| `src/app/lib/cozo/graph/adapters/*.ts` | 7-9 | Usage comments | Update comments |
| `src/app/lib/core/app-orchestrator.ts` | 17 | Comment "CozoDB finished" | Update comment |

---

## Phase 0 Execution Plan

### Step 1: Remove "CozoDB Parity" Comments
These are purely cosmetic comments in the GoKitt worker and service.

**Files to modify:**
- `src/app/workers/gokitt.worker.ts`
- `src/app/services/gokitt.service.ts`

**Changes:**
- Remove `// CozoDB Parity:` comments
- Keep the actual code unchanged

### Step 2: Update Misleading Comments
Update comments that imply CozoDB is still the primary store.

**Files to modify:**
- `src/app/services/knowledge.service.ts`
- `src/app/services/graph-viz.service.ts`
- `src/app/lib/rlm/index.ts`
- `src/app/lib/rlm/services/retrieval.service.ts`
- `src/app/lib/services/projection-cache.service.ts`
- `src/app/lib/core/app-orchestrator.ts`

### Step 3: Mark Deprecated Methods
Add `@deprecated` JSDoc to methods that will be removed.

**Files to modify:**
- `src/app/services/graph-viz.service.ts` - `fromCozoDB()`, `getFullGraph()`, `getScopedGraph()`

### Step 4: Verify No Broken Imports
After changes, run TypeScript compiler to ensure no broken imports.

---

## Verification Checklist

- [ ] TypeScript compiles without errors
- [ ] No new runtime errors in console
- [ ] App still initializes correctly
- [ ] All existing functionality works

---

## Files NOT to Touch in Phase 0

These are actively used and require careful migration in later phases:

1. **Bridge Layer** - `GoSqliteCozoBridge.ts`, `CozoHydrator.ts`, `CozoFieldMapper.ts`
2. **RLM Services** - `workspace-ops.service.ts`, `query-runner.service.ts`, `rlm-loop.service.ts`
3. **Search Services** - `semantic-search.service.ts`, `embedding-queue.service.ts`
4. **Graph Services** - `graph-viz.service.ts` (active fallback)
5. **Core CozoDB** - All files in `src/app/lib/cozo/`

---

## Next Phases Preview

### Phase 1: Remove CozoDB Fallbacks
- Remove `fromCozoDB()` fallback in graph-viz.service.ts
- Remove CozoDB fallback in graph-page.component.ts
- Remove CozoDB persist in sidebar.component.ts

### Phase 2: Migrate RLM Services
- Migrate workspace-ops.service.ts to GoKitt
- Migrate query-runner.service.ts to GoKitt
- Migrate rlm-loop.service.ts to GoKitt

### Phase 3: Migrate Search Services
- Migrate semantic-search.service.ts to GoKitt HNSW
- Migrate embedding-queue.service.ts to GoKitt RAPTOR

### Phase 4: Remove Bridge Layer
- Remove CozoHydrator.ts
- Remove CozoFieldMapper.ts
- Simplify GoSqliteCozoBridge.ts

### Phase 5: Remove Core CozoDB
- Remove all files in `src/app/lib/cozo/`
- Remove CozoDB WASM from assets
- Remove cozo-lib-wasm dependency

---

## Decision Required

Before proceeding with Phase 0, please confirm:

1. **Are there any active features that depend on CozoDB queries?**
   - Graph traversals?
   - FTS search?
   - HNSW vector search?

2. **Is the GoKitt KnowledgeGraph ready to replace all CozoDB graph queries?**

3. **Should we keep FTS in CozoDB or migrate to a different solution?**
