# Phoenix Graph Engine Handoff

Date: 2026-04-23

This document captures the recent graph-system work so the next session can continue without digging through console logs, screenshots, and thread context.

## Executive Summary

We moved Phoenix away from the old force-graph style surface and toward our own graph rendering engine.

The important design decision:

- TypeScript/canvas still owns pixels, input, and UI.
- Rust now has a native scene-compile lane for graph layout and packet preparation.
- The app keeps a TS fallback so a stale Tauri binary does not blank the graph.

The result is a cleaner graph experience, less UI waste, a custom 3D atlas surface, and the start of a native backend for larger graph workloads.

## Goals We Were Solving

- Remove the oversized Theme tab and fold style controls into graph context.
- Replace the basic graph tab with a polished, useful hub UI.
- Build a custom 3D graph renderer instead of depending on legacy force-graph behavior.
- Make the renderer interactive: rotate, zoom, pan, drag/stretch nodes, focus, fit, reset.
- Add renderer controls for labels, edges, particles, glow, distance, width, opacity, and curve strength.
- Prepare for embedding/HNSW atlas views using the same rendering engine.
- Move graph scene preparation toward native Rust for speed and memory efficiency.
- Keep idle GPU usage low when the hub is closed or static.
- Preserve behavior through fallbacks while native and frontend can be temporarily out of sync.

## UI And Product Changes

### Hub Graph Tab

The hub graph tab was redesigned from a cluttered control dashboard into a compact narrative atlas workspace.

Major cleanup:

- Removed repeated "New Narrative" presentation blocks.
- Reduced duplicate entity counts.
- Removed redundant style and add-entity buttons from the lower summary area.
- Moved style controls into graph context instead of a full Theme tab.
- Added a compact left explorer with scope, totals, actions, search, and entity grouping.
- Added a main atlas preview area that can show either entity graph data or embedding atlas data.

The hub preview is now intentionally quieter:

- Default auto-orbit is off.
- Static scenes draw once and sleep.
- Particle flow remains opt-in.

### Full Graph Page

The standalone graph page was rebuilt around the new engine and deluxe version of the hub visual language.

It now has:

- Left control rail for scope, lens, search, build, warm path, and kind counts.
- Large central atlas stage using the custom graph canvas.
- Right inspector for renderer settings, selected node metadata, links, and relation counts.
- Build/warm controls for Phoenix graph workflows.

This replaces the old force-graph-centered page surface with our own renderer contract.

## Renderer Features

The current custom renderer supports:

- 3D projection into canvas.
- Drag-to-rotate empty space.
- Wheel zoom.
- Shift-drag pan.
- Double-click focus or fit.
- Node drag/stretch with elastic return.
- Hover detection.
- Selected node pulse.
- Label modes: hover, selected, important, always, off.
- Edge modes: curved, straight, hidden.
- Edge color modes: cyan, entity blend, confidence, muted.
- Glow control.
- Node distance control.
- Edge length, width, opacity, and curve controls.
- Particle flow with size, speed, and opacity controls.
- Query/embedding trace support.
- Fit and reset commands.

The backdrop was simplified from a heavy visual field to a calmer cached canvas background. It keeps the canvas color and subtle depth without unnecessary stars/nebula noise.

## Embedding Atlas Prep

The hub preview now has an embedding atlas mode:

- Entity atlas mode uses registry graph nodes and co-occurrence links.
- Embedding mode can load doc/leaf vector projections.
- Query traces can add a temporary query node and related edges.
- Hover/selection can show a source preview panel.

This is the path for visualizing the shape of document embeddings and HNSW-like neighborhoods in the same 3D engine.

## Native Rust Scene Compiler

We added a native graph scene compiler in Rust:

- `src-tauri/src/graph_galaxy.rs`

It receives:

- entities
- edges
- render-relevant layout settings

It returns:

- node positions
- radii
- RGB colors
- deduped edge records
- edge alpha
- curve values
- flow offsets

Design notes:

- Rust does scene preparation.
- TS/canvas still renders and handles interaction.
- Layout uses deterministic seeds so scenes remain stable.
- Edge dedupe avoids redundant undirected links.
- `hashbrown` is used on the native side.
- The implementation stays under the project 500-line file guardrail.

Current Rust verification:

- `cargo check --manifest-path src-tauri/Cargo.toml --target-dir G:\phoenix-target-overgraph`
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir G:\phoenix-target-overgraph graph_galaxy --lib`

Both passed during the implementation pass.

## Native Bridge And Fallbacks

New transport pieces:

- `src/app/services/phoenix-galaxy-scene.model.ts`
- `src/app/services/phoenix-backend.service.ts`
- `src/app/services/phoenix-taurpc-bridge.ts`
- `src/app/generated/phoenix-taurpc.ts`
- `src-tauri/src/phoenix_rpc.rs`

The frontend calls `compileGalaxyScene` through `PhoenixBackendService`.

Fallback behavior:

- If the app is running web mode, it uses the TS scene builder.
- If the app is native but the Tauri binary is stale or the command is missing, it logs one warning and uses the TS scene builder.
- This prevents the graph from disappearing when frontend code has hot-reloaded but the native binary has not been rebuilt.

We hit this exact stale-binary issue:

```text
message `TauRPC__phoenix.compile_galaxy_scene` not found
```

The graph now survives that state.

## Boot Snapshot Cleanup

The native boot snapshot bridge was adjusted to use a JSON-returning procedure:

- `boot_snapshot_json`

Reason:

- The typed Specta/TauRPC export could not represent `serde_json::Value` cleanly in that snapshot shape.
- JSON transport is boring but stable for that seam.
- It keeps boot hydration from breaking while preserving the native path.

## GPU And Idle Work

We saw WebView GPU activity remain higher than expected after closing the hub.

Changes made:

- The graph canvas now sets a destroyed flag on teardown.
- Resize and intersection observers disconnect on destroy.
- Visibility listeners are removed on destroy.
- Pending scene-build callbacks are ignored after destroy.
- The canvas backing store is set to `0 x 0` on destroy.
- Cached backdrop canvas is invalidated on destroy.
- Static scenes no longer keep a requestAnimationFrame loop alive.
- The hub preview no longer auto-rotates by default.

Expected behavior:

- Closing the hub should stop the hub graph renderer.
- Static graph previews should draw once and sleep.
- Full graph page can still opt into motion with orbit or particle flow.
- Chromium/WebView may keep GPU memory warm, but GPU activity should drop closer to idle.

## Main Files Changed Or Added

Graph preview and engine:

- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-atlas-preview.component.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-canvas.component.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-engine.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-draw.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-scene-compiler.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-backdrop-cache.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-embedding-atlas.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-embedding-atlas-loader.ts`

Graph page:

- `src/app/pages/graph/graph-page.component.ts`
- `src/app/pages/graph/graph-page.component.html`
- `src/app/pages/graph/graph-page.component.css`
- `src/app/pages/graph/graph-workbench.model.ts`

Native and bridge:

- `src-tauri/src/graph_galaxy.rs`
- `src-tauri/src/phoenix_rpc.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src/app/services/phoenix-galaxy-scene.model.ts`
- `src/app/services/phoenix-backend.service.ts`
- `src/app/services/phoenix-taurpc-bridge.ts`
- `src/app/generated/phoenix-taurpc.ts`

## Verification Run

Frontend typecheck:

```powershell
node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
```

Passed after the latest fallback and GPU-idle fixes.

Native check:

```powershell
$env:TEMP='G:\phoenix-temp'
$env:TMP='G:\phoenix-temp'
cargo check --manifest-path 'C:\Users\shuga\1kittroot\1code\Angular-build\src-tauri\Cargo.toml' --target-dir 'G:\phoenix-target-overgraph'
```

Passed during the native compiler implementation pass.

Native graph unit test:

```powershell
$env:TEMP='G:\phoenix-temp'
$env:TMP='G:\phoenix-temp'
cargo test --manifest-path 'C:\Users\shuga\1kittroot\1code\Angular-build\src-tauri\Cargo.toml' --target-dir 'G:\phoenix-target-overgraph' graph_galaxy --lib
```

Passed during the native compiler implementation pass.

## Current Known State

- The graph works with the TS fallback even if Tauri has not been rebuilt.
- To activate the native Rust scene compiler, rebuild/restart the Tauri side so the new TauRPC command exists in the running binary.
- The hub preview is intentionally static by default to protect idle GPU.
- The full graph page keeps richer motion defaults because it is the dedicated graph workspace.
- The working tree contains broader unrelated changes from prior work; do not treat the graph diff as the whole repo state.

## Recommended Next Steps

1. Rebuild and restart Tauri so `compile_galaxy_scene` is live in the native binary.
2. Add a tiny dev-only renderer status readout:
   - active canvas count
   - RAF active or sleeping
   - native scene vs TS fallback
   - node/link counts
3. Move large-graph rendering toward levels of detail:
   - top-N labels
   - edge thinning by confidence and viewport
   - node clustering
   - worker/native scene paging
4. Add compact binary scene transport for larger graphs instead of JSON-heavy packets.
5. Connect Rust embedding/HNSW projection output directly into the atlas scene compiler.
6. Promote the renderer into a reusable engine package once the graph page and hub are stable.

## Guiding Design Rule

The engine should stay split:

- Rust prepares graph structure, layout, clustering, embeddings, and compact packets.
- TypeScript renders, handles input, and owns UI state.

That gives Phoenix the native speed path without trapping the visual experience inside a brittle native UI layer.
