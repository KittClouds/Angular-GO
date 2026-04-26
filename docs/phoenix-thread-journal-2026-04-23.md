# Phoenix Desktop Thread Journal - 2026-04-23

This is a handoff journal for the Phoenix Desktop work done in this long thread. It focuses on what changed, what was fixed, what was decided, and what still needs attention.

## Thread Context

The thread started after an overloaded prior conversation. The active project was the Phoenix Desktop Angular/Tauri app in `C:\Users\shuga\1kittroot\1code\Angular-build`.

Main priorities:

- Keep Phoenix native-first on desktop.
- Lock away/freeze WASM for this app.
- Keep rendering fast and memory disciplined.
- Improve UI quality without breaking working systems.
- Remove cruft after new paths are proven.
- Keep files under the local 500-line guardrail.

## Entity Theme And Highlighting

### Gradient Text

The entity theme gradient text option started working, then we explored whether it could animate like tabs/footer.

An early animated attempt caused text to color shift, fade to black, and reappear in a loop. It looked cool but broke readability.

Result:

- Gradient text was stabilized so it no longer disappears during the cycle.
- Static gradient text was considered acceptable if animation is unsafe.
- The fade-to-black accident was noted but not retained.

### Highlight Drift

The highlighter later showed position drift, with entity pills landing on partial words and wrong spans.

Examples included split fragments like:

- `Rowan` becoming partial text
- `Phaeris` split into fragments
- name highlights offset from the actual name

Pretext was discussed as inspiration for stable text highlighting, but no dependency was adopted. The project direction remained: fix Phoenix's range/span handling directly unless a library clearly solves the root problem.

### Highlight State

The highlighter still has a lifecycle/state issue:

- Highlights can disappear after navigating away and returning.
- Switching notes or refreshing can restore them.
- Highlight style resets to `vivid` after refresh/restart/navigation instead of preserving clean/gradient/subtle.

This remains a high-priority follow-up.

## Autobacklinks Audit

The autobacklinks panel showed `0 inbound signals` even though entity mentions were visible in the editor.

Design conclusions:

- The old backlink model was too parser/title driven.
- Obsidian-style title matching is weak for Phoenix.
- Backlinks should use note IDs, not note titles.
- The note body should not need to repeat titles just to create links.
- Entities are plain text plus aliases, not user-authored regex.
- Regex parsing should not be the core path.
- Phoenix should use its dictionary, registry, gazetteer, NER, and entity-note incidence data.

Better design:

- Dictionary knows which entities occur in which note.
- Entity-note incidence becomes the backlink substrate.
- Explicit entity edges and mention evidence become separate signals.
- Manual tagging, registry additions, and NER should all feed the same entity substrate.
- Remove old parsing cruft after the new entity-native path is proven.

## Human-In-The-Loop Learning

The user reframed Phoenix as having two arms:

- Automated arm: already strong, hostile-data tolerant, running in the wild.
- Human-in-the-loop arm: needs deeper thought.

Questions raised:

- What happens after a user manually adds a character, location, item, or event?
- Does Phoenix learn from tagging habits?
- Does span tagging teach future scans?
- Does adding aliases immediately improve suggestions and mentions?
- Is the gazetteer being fully used to bootstrap intelligence?

Audit direction:

- Inspect NER, dictionary rebuilds, registry behavior, suggestions, and sidecars.
- Treat manual actions as durable learning signals where useful.
- Avoid chasing model features if deterministic dictionary/gazetteer loops already solve the need.

## Worldbuilding Tab

The existing Worldbuilding tab was functional but visually too card-heavy and flat.

Design concept: "The World Codex."

Goals:

- More immersive and narrative-first.
- Less dashboard/card-grid repetition.
- Same contracts and facade behavior.
- Mostly template/CSS redesign.
- Start open by default.
- Better colors than amber/rose.

Design direction:

- Cinematic World Home header.
- Slim command bar.
- Collapsible panels instead of stacked cards.
- Compact character rows.
- Stat pills instead of repeated number cards.
- Frosted composer drawers.
- Polished empty states.

Outcome:

- Visual direction improved a lot.
- Function remained the priority.
- Some scroll and spacing issues remained for later tuning.

## Theme Tab Removal

The Theme tab was judged as wasted screen real estate because style controls belong with the graph/entity workflow.

Decision:

- Remove the standalone Theme tab.
- Move entity style controls into the Graph tab.
- Include highlight style switching there.
- Keep the hub focused and production-ready.

Follow-up cleanup:

- Removed repeated style lab buttons.
- Removed repeated add entity buttons.
- Reduced repeated "New Narrative" labels.
- Reduced duplicated entity count displays.
- Removed bottom-left atlas summary that covered the entity list.

## Graph Tab Redesign

The Graph tab was called "beyond basic" and rebuilt into a stronger Narrative Atlas experience.

Work completed:

- New Graph tab layout.
- Left explorer for entities.
- Integrated style lab.
- Add/extract controls.
- Selected entity detail view.
- Co-occurrence/entity graph presentation.
- Cleaner counts and less repeated UI.

The first version looked good but overfilled space. It was then simplified:

- Fewer duplicate controls.
- Less repeated scope text.
- More actual graph/entity surface.
- Cleaner left rail.

## Custom Graph Rendering Engine

The project moved away from `3d-force-graph` as a dependency. The user wanted to study it for ideas, then build a Phoenix-native replacement.

Renderer goals:

- Smooth 3D canvas renderer.
- Beautiful node/edge art.
- Fast and memory efficient.
- Modern replacement for old force graph packages.
- Built for narrative/semantic graph workflows.

Implemented or refined:

- 3D graph option.
- Canvas-based graph renderer.
- Drag rotate.
- Wheel zoom.
- Shift-drag pan.
- Click node.
- Hover node.
- Double-click focus.
- Node drag/stretch with snap-back.
- Straight/curved edge modes.
- Edge width and opacity controls.
- Edge color modes.
- Glow control.
- Particle flow.
- Particle size, speed, and opacity controls.
- Label modes, including hover-only behavior.
- Hidden settings panel in top-right.
- Better slider sensitivity for distance/length/curve.
- Thinner edges and cleaner node art.

User assessment after V0.3:

- Smooth.
- Clean.
- Visually strong.
- Functionally doing what it needs.

## Renderer Roadmap

### V0.4

Freeze the engine behavior and add an embeddings atlas view.

Goal:

- Visualize generated embeddings in 3D.
- Support leaf, document, and prototype graph embeddings.
- Show clusters.
- Eventually visualize the shape of the HNSW/world.

### V0.5

Traversal and query animation.

Goal:

- Animate search.
- Animate graph traversal.
- Give multi-hop traversal a special visual treatment.
- Make query propagation feel alive instead of merely filtered.

## Graph Page Rebuild

The full Graph page had legacy force-graph-style UI and needed to use the new renderer.

Work direction:

- Rebuild Graph page around the custom renderer.
- Remove force-3d legacy crust.
- Match the hub style, but as a deluxe full-page version.

Implemented direction:

- Graph Lens page.
- Left rail for scope, lens, search, and build controls.
- Central atlas stage using `GraphGalaxyCanvasComponent`.
- Right inspector and renderer settings.
- Warm model controls preserved.
- Renderer controls exposed in the full page.

Open:

- Huge graph optimization still needs LOD, culling, compact packets, and better native scene generation.

## Native Rust Graph Scene Compiler

The user asked whether the graph rendering backend could be Rust while visuals stay JS/TS.

Answer implemented:

- Rendering remains TS/canvas.
- Scene/layout compilation can use native Rust on desktop.
- JS scene builder remains as fallback.

Added/wired:

- `src-tauri/src/graph_galaxy.rs`
- `src/app/services/phoenix-galaxy-scene.model.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-scene-compiler.ts`
- `src/app/services/phoenix-backend.service.ts`
- `src/app/services/phoenix-taurpc-bridge.ts`
- `src/app/generated/phoenix-taurpc.ts`
- `src-tauri/src/phoenix_rpc.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`

Rust compiler behavior:

- Dedupes undirected links.
- Uses deterministic seeded positions.
- Ports existing layout behavior.
- Uses hashbrown maps/sets.
- Preserves existing visual contracts.

Verified:

```powershell
node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
```

```powershell
$env:TEMP='G:\phoenix-temp'
$env:TMP='G:\phoenix-temp'
cargo check --manifest-path 'C:\Users\shuga\1kittroot\1code\Angular-build\src-tauri\Cargo.toml' --target-dir 'G:\phoenix-target-overgraph'
```

```powershell
$env:TEMP='G:\phoenix-temp'
$env:TMP='G:\phoenix-temp'
cargo test --manifest-path 'C:\Users\shuga\1kittroot\1code\Angular-build\src-tauri\Cargo.toml' --target-dir 'G:\phoenix-target-overgraph' graph_galaxy --lib
```

### Native Fallback Bug

The graph disappeared with:

```text
TauRPC__phoenix.compile_galaxy_scene not found
```

Cause:

- The frontend expected the new native command.
- The running Tauri binary was stale and did not expose it yet.
- The canvas caught the error but left the scene empty.

Fix:

- Moved fallback into the scene compiler adapter.
- Native compile is a fast path, not a single point of failure.
- Missing/stale native command now falls back to the TS scene builder.

Verified:

- TypeScript compile passed.

## Renderer Performance And GPU Cleanup

Concern:

- GPU usage seemed high when the hub was closed.
- GPU memory also looked higher than expected.

Actions:

- Verified hub content should be destroyed when closed.
- Hardened canvas teardown:
  - Stop RAF loop.
  - Disconnect observers.
  - Remove document visibility listener.
  - Clear scene data.
  - Invalidate backdrop cache.
  - Set canvas width/height to zero.
  - Null canvas context.
  - Guard async scene builds after destroy.
- Turned off default auto-rotate for the hub preview.
- Changed static views to draw once and sleep.
- Wake only on real activity or explicit motion features.

Verified:

- TypeScript compile passed.
- `graph-galaxy-canvas.component.ts` was kept under 500 lines.

Note:

- Chromium/WebView can keep GPU allocations warm, so activity drop matters more than immediate memory drop.

Recommended next diagnostic:

- Add a dev-only renderer status readout:
  - active canvases
  - RAF active
  - native vs TS scene compiler
  - last draw timestamp
  - node/link count

## WASM Lockout And Native Runtime

The user emphasized that WASM should be frozen and not start in the desktop app.

Observed:

- Logs still showed wasm load paths earlier.
- Desktop should use native runtime only.

Related boot failure:

```text
TauRPC__phoenix.boot_snapshot not found
```

Symptoms:

- New notes could not be created.
- Folder creation failed.
- Note switching got stuck.
- `PhoenixStoreService not ready` appeared.

Fix direction:

- Desktop path moved toward native runtime.
- Boot snapshot bridge switched to `boot_snapshot_json`.
- JSON transport avoided Specta typing issues with `serde_json::Value`.
- App boot recovered after compatibility fixes.

Open:

- Finish hard lock so WASM cannot start in desktop.

## Startup, Hydration, And Transport

The user requested a serious pass on:

- App startup.
- Hydration.
- TauRPC communication.
- Transport harshness.
- Phoenix speed and memory guarantees.

Known observations:

- Native runtime load was around hundreds of milliseconds in logs.
- Persistence load was around one second in one run.
- Full interactive boot still depends on Dexie hydration and background tasks.

Status:

- Full benchmark report was not finished in this thread.
- Transport and startup remained a major follow-up.

## TTS/Qwen

The user shared `qwen_tts` and wanted to test it only if it supported the 0.6B model.

Direction:

- Do not build a custom runner if the crate can handle it.
- Prefer Qwen3-TTS 0.6B Base.
- Add UI for voice cloning/reference WAV.

Observed UI:

- TTS popup showed Web, Qwen, and Rust engine options.
- Qwen clone source showed Qwen3-TTS 0.6B Base.

Observed error:

```text
TauRPC__phoenix.tts_qwen_speak not found
```

Status:

- UI shell exists.
- Native command was missing/stale.
- Voice cloning UI/workflow still needs completion.

## Important Files

Key files touched or involved:

- `src/app/components/blueprint-hub/blueprint-hub.component.*`
- `src/app/components/blueprint-hub/blueprint-hub.service.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-tab.component.*`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-atlas-preview.component.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-canvas.component.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-engine.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-draw.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-backdrop-cache.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-scene-compiler.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-embedding-atlas.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-embedding-atlas-loader.ts`
- `src/app/components/blueprint-hub/tabs/graph-tab/graph-style-drawer/*`
- `src/app/pages/graph/graph-page.component.*`
- `src/app/services/phoenix-backend.service.ts`
- `src/app/services/phoenix-taurpc-bridge.ts`
- `src/app/services/phoenix-galaxy-scene.model.ts`
- `src/app/generated/phoenix-taurpc.ts`
- `src-tauri/src/graph_galaxy.rs`
- `src-tauri/src/phoenix_rpc.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`

## Highest-Value Follow-Ups

1. Fix highlighter lifecycle and style persistence.
2. Hard-lock desktop to native runtime and prevent WASM startup.
3. Add renderer instrumentation.
4. Optimize huge graph handling with LOD/culling/binary packets.
5. Build embeddings atlas V0.4.
6. Build traversal/search animation V0.5.
7. Finish Qwen 0.6B voice clone UI and native command path.
8. Redesign autobacklinks around entity-note incidence.
9. Turn manual tagging habits into useful learning signals.
10. Finish startup/hydration/TauRPC benchmark report.

## North Star

Phoenix is not just an automated backend. It is a writing machine with a human-in-the-loop arm.

The UI should feel like a living creative instrument, not a dashboard. The backend should stay native, deterministic where possible, fast, and memory disciplined. The graph engine should become a Phoenix-native successor to old force graph packages: more modern, more beautiful, more controllable, and built for narrative data.
