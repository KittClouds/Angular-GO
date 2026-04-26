# Phoenix Desktop Thread Journal - 2026-04-23

This journal captures the work completed across this thread while rebuilding Phoenix Desktop's hub, graph renderer, native runtime boundary, highlighting behavior, and performance posture.

## Context

The thread began after the previous conversation became too full to work reliably. The app had just gained gradient text support for entity theming, and the first concern was whether animated gradient text could work without breaking rendering. That quickly expanded into a deeper push: make the hub production-grade, remove stale WASM paths from the native desktop lane, replace legacy graph rendering with Phoenix's own engine, and restore memory discipline.

## Entity Highlighting And Theme Work

- Fixed the animated gradient text behavior so entity highlights no longer fade to black or disappear after a color cycle.
- Preserved the ability to use static gradient text when motion is undesirable.
- Identified a separate highlight-position bug where partial word fragments were being highlighted, caused by stale span/position handling.
- Repaired the highlight state enough that a refresh restored expected inline entity highlights.
- Found a remaining state problem: route changes or reloads could temporarily drop highlights until the note changed again.
- Identified another state issue where highlight style selection reset to `vivid` after refresh/restart instead of preserving `clean`, `gradient`, `subtle`, etc.
- Planned the highlighter state cleanup around persistent style state and deterministic rehydration instead of relying on incidental editor refreshes.

## Autobacklinks And Entity Dictionary Direction

- Audited the autobacklinks concept and found the old design was still thinking in parsing/title-link terms.
- Reframed autobacklinks around Phoenix's actual entity registry:
  - entity identity should be stable IDs, not note titles.
  - notes should track which entity IDs they contain.
  - mentions should come from manual tags, registry entries, NER, and the entity occurrence index.
  - plain text entity names and aliases should be matched by the system, not user-written regex.
- Confirmed the better direction is to use dictionary/gazetteer style matching and indexed entity-note membership rather than asking users to write link syntax or regex.
- Established that note/entity relationships should be note-id based because titles change and title-based linking is brittle.

## Human-In-The-Loop Learning Audit

- Audited the NER/entity learning flow from the user perspective:
  - manually highlighted entity spans.
  - manually created registry entities.
  - NER-discovered entities.
  - dictionary rebuilds after entity edits.
- Identified the next superpower lane: Phoenix should learn from tagging habits, not just rebuild a static dictionary.
- Closed the audit loop by aligning the system around entity occurrence records and registry updates as the substrate for future self-learning.

## Worldbuilding Tab Redesign

- Rebuilt the Worldbuilding tab from a dense card dashboard into a cleaner "World Codex" experience.
- Kept the existing component contracts, facade, and TypeScript behavior intact while changing template and CSS.
- Moved toward:
  - a narrative-first hero.
  - collapsible panels.
  - cleaner command surfaces.
  - compact character rows.
  - more polished empty states.
  - less repetitive section chrome.
- Preserved the working feature set while improving visual hierarchy and reducing dashboard clutter.
- Noted follow-up design refinements for scroll behavior and excessive card-like density.

## Theme Tab Removal And Style Controls

- Removed the standalone Theme tab as a wasteful screen for a simple style function.
- Moved entity style controls into the Graph tab context, where they belong.
- Added style lab access inside the graph workflow.
- Cleaned up repeated actions after the first pass created too many duplicate entry points:
  - multiple Style Lab buttons.
  - multiple Add Entity buttons.
  - repeated "New Narrative" labels.
  - redundant entity counts.
- Kept the stronger visual language but reduced overfilled UI.

## Graph Tab Redesign

- Rebuilt the hub Graph tab into a more polished "Narrative Atlas" workspace.
- Replaced the basic graph page experience with a richer graph-centric layout:
  - left registry rail.
  - compact narrative scope panel.
  - cleaner graph workspace.
  - style lab integration.
  - selected entity details.
  - co-occurrence relationship display.
- Removed legacy visual clutter and consolidated redundant stats/actions.
- Added the foundation for an atlas-style graph preview in the hub.
- Improved layout so the graph canvas became the main visual object rather than a small accessory.

## Phoenix Galaxy Renderer

- Designed and implemented Phoenix's own graph rendering engine as a replacement direction for legacy force graph packages.
- Used the Music Galaxy reference as inspiration while keeping the implementation Phoenix-native.
- Moved away from `force-graph-3d` as the future path.
- Built a custom canvas-based 3D-ish renderer with:
  - node glow.
  - thin edges.
  - curved edges.
  - particle flow.
  - hover labels.
  - node dragging/stretch behavior.
  - fit/reset controls.
  - settings controls.
- Fixed an early color parsing crash where CSS variables such as `hsl(var(--entity-character))` could not be used directly in canvas gradient stops.
- Added real interactivity:
  - drag rotate.
  - wheel zoom.
  - shift-drag pan.
  - node click/focus.
  - node stretch and snap-back.
- Added v0.3 controls:
  - flow particle size.
  - flow speed.
  - flow opacity.
  - edge color control.
  - stronger distance/edge-length controls.
  - stronger curve control.
  - hideable settings panel.
- Added v0.5 traversal/search concept:
  - animated search/traversal.
  - special treatment for multi-hop paths.
- Added an embeddings atlas direction for v0.4/v0.5:
  - visualize generated embeddings in 3D.
  - support leaf/document/prototype graph embeddings.
  - eventually show the shape of the HNSW/vector world through the same renderer.

## Native Graph Scene Compile Lane

- Added a Rust-backed/native graph scene compilation path for the galaxy renderer.
- Added frontend integration that attempts to compile graph scene data through the native bridge.
- Fixed the TauRPC command naming regression after `TauRPC__phoenix.compile_galaxy_scene` was missing.
- Preserved fallback behavior so the graph does not vanish when the native scene compiler is unavailable.
- Kept the renderer visually the same while shifting the heavy scene-prep boundary toward Rust.
- Noted that the visual canvas must remain JS/TS, but graph preparation/layout/packing can move native for speed and memory control.

## Graph Runtime And Memory Optimization

- Investigated high WebView2 memory after the graph renderer landed.
- Confirmed the user's suspicion that hidden/closed hub rendering could cause unnecessary cost.
- Added/validated renderer sleep behavior so the graph canvas stops RAF work when hidden or inactive.
- Simplified the canvas background by removing unnecessary star/nebula decoration.
- Kept the dark canvas color and subtle gradient, but dropped extra visual noise.
- Added a compact footer graph runtime meter:
  - compiler source.
  - RAF activity.
  - node count.
  - canvas count.
  - scene size.
  - approximate canvas backing memory.
- Verified memory returned to target range:
  - WebView2 group around `155 MB`.
  - AngularNotes around `57 MB`.
  - GPU process around `53 MB`.
- Kept the path open for another `20-50 MB` shave later.

## Native/WASM Divorce

- Found that the desktop app was still trying to load old WASM-era runtime paths.
- Reworked boot messaging from `wasm` naming toward native runtime naming.
- Guarded the app so the native desktop lane cannot silently boot the WASM path.
- Fixed a boot failure caused by a missing native TauRPC command:
  - `TauRPC__phoenix.boot_snapshot`
- Restored app readiness so note creation, folder creation, and note switching worked again.
- Confirmed the desktop runtime should report native boot instead of WASM boot.
- Preserved the browser/dev-server path as a separate web mode, where WASM may still be expected by design.

## Tauri And Build Work

- Rebuilt production Angular assets with `npm run build`.
- Fixed production Angular build warnings:
  - removed the unused ngx-spinner stylesheet entry.
  - replaced broad PrimeIcons vendor stylesheet with a local subset.
  - allowed the known `extend` CommonJS dependency.
  - raised the component style budget to match the current production UI.
  - fixed a malformed generated CSS selector caused by a regex-like string in `tts.service.ts`.
- Verified:
  - `node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit`
  - `npm run build`
- Built the real desktop shell with:
  - `cargo build --release --features tauri/custom-protocol`
  - `CARGO_TARGET_DIR=G:\phoenix-target-overgraph`
  - temp paths on `G:\phoenix-temp`
- Confirmed plain `cargo build --release` still loads `localhost:4200`, so the custom protocol feature is required for the production desktop shell.
- Launched the working desktop binary from:
  - `G:\phoenix-target-overgraph\release\phoenix-tauri.exe`

## TTS / Qwen TTS Investigation

- Investigated `qwen_tts` as a possible stronger voice-cloning path after prior TTS model attempts sounded poor.
- Added/started a Qwen 0.6B voice clone lane instead of building a custom runner from scratch.
- Added UI selection for Qwen in TTS settings.
- Hit a missing TauRPC command error:
  - `TauRPC__phoenix.tts_qwen_speak`
- Identified that the UI existed but voice cloning controls were not yet complete enough for the desired workflow.
- Left this as a follow-up lane after the native command/UI contract is finished.

## Graph Page Replacement Direction

- Began replacing the separate full graph page's old force-graph experience with the Phoenix galaxy renderer.
- Goal: make the full graph page match the hub renderer but in a deluxe/full-screen mode.
- Identified that the old page still had legacy force graph UI:
  - build lens.
  - visual toggles.
  - DAG controls.
  - old side inspector.
- Planned to remove legacy crust and make Phoenix Galaxy the canonical graph engine across hub and full graph page.

## Current Graph Lens Plan

- Planned the next feature batch:
  - graph scope can be global, narrative, single note, or multi-note.
  - note scoping must use note IDs, not titles.
  - selecting one note shows only entities present in that note.
  - selecting multiple notes creates multiple note galaxies in the same canvas.
  - primary selected note is foreground and centered.
  - secondary selected notes appear as dimmer background galaxies.
  - duplicate visual nodes may be created per note while preserving the original entity ID for editing/selection.
- Planned rotation controls:
  - explicit no-rotation option.
  - auto-rotate toggle.
  - pause auto-rotation while hovering/highlighting a node.
- Planned to keep this graph-local rather than mutating global app scope semantics.

## Important Design Decisions

- Entity identity should be stable ID based everywhere possible.
- Note titles are labels only.
- The graph renderer should be one canvas, one scene, even for multi-note "galaxies."
- The renderer should sleep when hidden, closed, or idle.
- Browser/dev-server mode can still use web runtime behavior, but native desktop must not silently boot WASM.
- Phoenix Galaxy is now the forward path; legacy force graph packages are inspiration only, not the runtime.
- UI polish matters, but duplicated controls and decorative bulk are now considered regressions.

## Verification State

Verified during the thread:

- Angular type check passed.
- Angular production build passed.
- Production Tauri binary built with `tauri/custom-protocol`.
- Desktop app launched from the warmed `G:` target.
- Memory returned to acceptable range after graph optimizations.
- Highlight rendering recovered after refresh.
- Graph renderer became interactive and visually stable.
- Graph runtime meter works in the footer.

Still needing follow-up verification:

- Persistent highlighter style across refresh/route changes.
- Full no-WASM native boot check in every launch path.
- Full graph page replacement with Phoenix Galaxy.
- Qwen TTS command/UI contract.
- Note and multi-note graph lens behavior.
- Larger graph stress tests using `mother.md`, `mother2.md`, and `mother3.md`.

## Next Practical Actions

1. Implement graph note and multi-note lens scoping.
2. Add explicit auto-rotate and pause-on-hover behavior.
3. Finish highlighter state persistence and deterministic rehydration.
4. Replace the full graph page with Phoenix Galaxy deluxe mode.
5. Run the large-document graph stress pass and record memory/RAF/scene-size numbers.

