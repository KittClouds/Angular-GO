# IMPLEMENATION PLAN: GoKitt Discovery Integration

## Objective
Integrate GoKitt Wasm module's unsupervised Named Entity Recognition (NER) "Discovery" feature into the Angular application.

## Tasks

### 1. Go Wasm Module (Backend) [DONE]
- [x] Export `scanDiscovery` function in `cmd/wasm/main.go`.
- [x] Implement `scanDiscovery` to use `pipeline.ScanDiscovery(text)` and `pipeline.GetCandidates()`.
- [x] Expose `ScanDiscovery` and `GetCandidates` on `Conductor` and `CandidateRegistry`.
- [x] Recompile `gokitt.wasm` and copy to `src/assets`.

### 2. Angular Service (Bridge) [DONE]
- [x] Create `GoKittService` to load WASM and expose functions.
- [x] Implement `scanDiscovery` method in `GoKittService`.
- [x] Polyfill `wasm_exec.js` in `src/assets`.

### 3. State Management (Store) [DONE]
- [x] Create `discoveryStore.ts` to manage discovered candidates.
- [x] Add `addCandidates` action.

### 4. Highlighter Integration (Logic) [DONE]
- [x] Update `HighlighterApi` to inject/use `GoKittService`.
- [x] Implement `triggerDiscoveryScan` in `HighlighterApi`.
- [x] Filter candidates (Watching/Promoted) and update `discoveryStore`.
- [x] Implement `createCandidateSpans` to generate decoration spans for candidates.
- [x] Add imports for `discoveryStore`.

### 5. Editor Visualization (UI) [DONE]
- [x] Update `styles.ts` with `entity_candidate` styles (Yellow dotted underline).
- [x] Ensure `HighlighterApi` produces `entity_candidate` spans.

### 6. Verification & Refinement [COMPLETED]
- [x] Verify `EditorComponent` is using `HighlighterApi` (via `entityHighlighter` plugin).
- [x] Refine thresholds or debounce timings if necessary (set to 100ms in `HighlighterApi`).

## Debugging Phase: Missing Highlights
The user reported "Elbaph" is not being highlighted even though it appears in logs.
### Tasks
- [ ] Add granular logs to `HighlighterApi.scanDocument` to see exact offsets of "Elbaph".
- [ ] Add logs to `HighlighterApi.getDecorations` to see what is passed to the plugin.
- [ ] Add logs to `entityHighlighter.ts` to see if spans are being rendered.

## Next Steps
- Implement logging changes.
- Analyze console output.
