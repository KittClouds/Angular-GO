# RLM Integration Plan - Safe Approach (Integrate First, Delete Last)

## Goal
Replace the legacy "Agentic/Tools" mode in the AI Chat Panel with the new Recursive Language Model (RLM) system. This plan prioritizes safety: integrate RLM first, clean up imports/exports, then delete legacy files only after verification.

## Current State Analysis

### What's Already Integrated
1. **OrchestratorService** (`src/app/services/orchestrator.service.ts`)
   - Already uses `RlmLoopService` for context gathering
   - Has `gatherAppContext()` method that uses `NoteEditorStore` and `RetrievalService`
   - Calls `rlmService.run()` and formats context via `formatRlmContext()`

2. **RLM Module** (`src/app/lib/rlm/`)
   - Fully implemented with: `RlmLoopService`, `RlmLlmService`, `QueryRunnerService`, `WorkspaceOpsService`, `RetrievalService`, `AppContextProviderService`
   - Exports all necessary types and functions

### What Needs to Change
1. **AI Chat Panel** (`src/app/components/right-sidebar/ai-chat-panel/ai-chat-panel.component.ts`)
   - Currently has TWO paths when index mode is ON:
     - `orchestrator.orchestrate()` - RLM context gathering (GOOD)
     - `handleAgenticChat()` - Legacy tool calling loop (TO REMOVE)
   - Imports legacy AI tools: `ALL_TOOLS`, `ToolExecutionContext`, `executeToolCalls`, `ToolCall`, `EditorAgentBridge`
   - Uses `goKittService.batchInit()` and `goKittService.agentChatWithTools()` for agentic mode

### Legacy Files to Delete (LAST STEP)
- `src/app/lib/ai/tool-schemas.ts` - Tool definitions
- `src/app/lib/ai/tool-executor.ts` - Tool execution logic
- `src/app/lib/ai/editor-agent-bridge.ts` - Editor bridge for tools
- `src/app/lib/ai/index.ts` - Module exports
- `src/app/lib/ai/AGENT_TOOLS_PHASES.md` - Documentation

---

## Phase 1: Verify RLM Integration is Complete

### Current Flow Analysis
```
Index Mode ON:
  onUserMessage()
    -> orchestrator.orchestrate() [RLM context gathering - KEEP]
    -> handleAgenticChat() [Legacy tool calling - REMOVE]
    
Index Mode OFF:
  onUserMessage()
    -> handleStreamingChat() [Standard streaming - KEEP]
```

### Target Flow
```
Index Mode ON:
  onUserMessage()
    -> orchestrator.orchestrate() [RLM context gathering]
    -> handleStreamingChat() [Standard streaming with RLM context]
    
Index Mode OFF:
  onUserMessage()
    -> handleStreamingChat() [Standard streaming - unchanged]
```

### Verification Checklist
- [ ] RLM loop executes when Index Mode is ON
- [ ] RLM context is properly formatted and injected into system prompt
- [ ] `formatRlmContext()` produces usable context string
- [ ] No dependency on legacy tools for RLM operation

---

## Phase 2: Update AI Chat Panel to Use RLM-Only Path

### Changes to `ai-chat-panel.component.ts`

#### 2.1 Remove Legacy Imports
```typescript
// REMOVE THESE:
import { ALL_TOOLS, type ToolExecutionContext, executeToolCalls, type ToolCall } from '../../../lib/ai';
import { EditorAgentBridge } from '../../../lib/ai/editor-agent-bridge';
```

#### 2.2 Remove Legacy Service Injection
```typescript
// REMOVE THIS:
editorBridge = inject(EditorAgentBridge);
private goBatchInitialized = false; // Track Go batch init for agentic chat
```

#### 2.3 Update `onUserMessage()` Method
Current logic (lines 935-991):
```typescript
// If Index mode is enabled, use agentic tool calling (OpenRouter only for now)
if (this.indexEnabled() && openRouterConfigured) {
    await this.handleAgenticChat(instance, botMsgId, history, effectiveSystemPrompt);
} else {
    // Standard streaming - use active provider
    await this.handleStreamingChat(instance, botMsgId, history, effectiveSystemPrompt);
}
```

Target logic:
```typescript
// Always use streaming chat - RLM context already injected into effectiveSystemPrompt
await this.handleStreamingChat(instance, botMsgId, history, effectiveSystemPrompt);
```

#### 2.4 Remove `handleAgenticChat()` Method
Delete the entire method (lines 1048-1165).

---

## Phase 3: Clean Up Imports/Exports/Types in Consuming Code

### Files to Update

#### 3.1 `src/app/services/orchestrator.service.ts`
- Remove `gatherAppContext()` method (redundant with `AppContextProviderService`)
- Remove `NoteEditorStore` dependency (RLM handles this internally)
- Remove `RetrievalService` dependency (RLM handles this internally)

Current dependencies:
```typescript
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { RetrievalService } from '../lib/rlm/services/retrieval.service';
```

These can be removed if `RlmLoopService` uses `AppContextProviderService` internally.

#### 3.2 `src/app/services/editor.service.ts`
- Contains reference to `EditorAgentBridge` in comment (line 24-26)
- Update comment to remove reference

#### 3.3 `src/app/lib/services/llm-entity-extractor.service.ts`
- Uses `goKitt.batchInit()` - KEEP (this is for entity extraction, not chat tools)

#### 3.4 `src/app/lib/services/llm-relation-extractor.service.ts`
- Uses `goKitt.batchInit()` - KEEP (this is for relation extraction, not chat tools)

---

## Phase 4: Remove Unused Dependencies from OrchestratorService

### Current State
```typescript
export class OrchestratorService {
    private noteEditorStore: NoteEditorStore;
    private retrievalService: RetrievalService;
    // ... other services
}
```

### Target State
```typescript
export class OrchestratorService {
    // Remove noteEditorStore and retrievalService
    // RLM loop handles context gathering internally via AppContextProviderService
}
```

### Verification
- Ensure `RlmLoopService` has access to `AppContextProviderService`
- Ensure `AppContextProviderService` is injected in RLM module

---

## Phase 5: Final Verification and Build Check

### Build Verification
```bash
npm run build
```

### Runtime Verification
1. Open AI Chat Panel
2. Enable "Index Mode"
3. Send a message (e.g., "What entities are in this note?")
4. Verify in Console:
   - `[RLM]` logs appear (indicating loop execution)
   - `[Orchestrator]` logs show context gathering
   - NO "Agentic loop iteration" logs
5. Verify response reflects knowledge of current note

### Test Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| Index Mode ON + OpenRouter | RLM context + streaming response |
| Index Mode ON + Google | RLM context + streaming response |
| Index Mode OFF | Standard streaming (no RLM) |
| No API key | Warning message, no crash |

---

## Phase 6: Delete Legacy AI Tool Files (LAST STEP)

### Files to Delete
```
src/app/lib/ai/
  - tool-schemas.ts
  - tool-executor.ts
  - editor-agent-bridge.ts
  - index.ts
  - AGENT_TOOLS_PHASES.md
```

### Post-Deletion Verification
```bash
npm run build
```

---

## Risk Mitigation

### Rollback Plan
If issues arise after Phase 6:
1. Restore files from git: `git checkout -- src/app/lib/ai/`
2. Revert component changes: `git checkout -- src/app/components/right-sidebar/ai-chat-panel/`

### Breaking Changes
- **None expected**: The RLM path already works for context gathering
- The only change is removing the redundant agentic tool-calling loop

---

## Summary

| Phase | Action | Risk Level |
|-------|--------|------------|
| 1 | Verify RLM integration | Low |
| 2 | Update AI Chat Panel | Medium |
| 3 | Clean up imports/exports | Low |
| 4 | Remove unused dependencies | Low |
| 5 | Build & runtime verification | Low |
| 6 | Delete legacy files | Low (after verification) |

**Key Insight**: The RLM integration is already partially complete. The `orchestrator.orchestrate()` call already gathers context via RLM. We simply need to remove the redundant `handleAgenticChat()` path that runs after RLM context gathering.