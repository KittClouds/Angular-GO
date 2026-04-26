# Phoenix Desktop OverGraph Cleanup And Start Runbook

Date: 2026-04-25

This note captures the cleanup pass that moved Phoenix Desktop back onto one native source of truth: OverGraph. It also records the correct way to start the app after this pass.

## Correct Start Path

Use this when you want the desktop app to run without a persistent Angular Node dev server.

From `C:\Users\shuga\1kittroot\1code\Angular-build`:

```powershell
$env:CARGO_TARGET_DIR='G:\phoenix-target-overgraph'
$env:TMP='G:\phoenix-temp'
$env:TEMP='G:\phoenix-temp'
npx @tauri-apps/cli build --debug
Start-Process -FilePath 'G:\phoenix-target-overgraph\debug\phoenix-tauri.exe' -WorkingDirectory 'C:\Users\shuga\1kittroot\1code\Angular-build\src-tauri' -WindowStyle Hidden
```

Then verify no persistent Node server is running:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='phoenix-tauri.exe'" |
  Select-Object ProcessId,Name,WorkingSetSize,CommandLine |
  Format-List
```

Expected normal state:

- `phoenix-tauri.exe` is running.
- `node.exe` is not running.
- The app does not show `localhost refused to connect`.

## What Not To Use For Normal Testing

Do not use raw `cargo build` plus direct launch as the normal app start path. A raw Cargo build can still produce a Tauri shell that resolves `devUrl` and tries to load `localhost`.

Do not keep `ng serve` running unless you intentionally want frontend hot reload:

```powershell
node_modules\.bin\ng.cmd serve --host 127.0.0.1 --port 4200
```

That path is useful for active UI work, but it is a Node dev server and can use a large amount of memory. It is not the Phoenix native runtime.

If a Node dev server is accidentally left running:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'ng.js.*serve|4200|Angular-build' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Why This Cleanup Happened

Phoenix had accumulated old graph and storage lanes from earlier architecture phases:

- WASM-era Graptor and graph-kernel paths.
- Cozo-backed graph storage and query surfaces.
- LMDB/native archive checkpoint storage.
- Derived checkpoint recovery that could read stale graph projections on boot.
- Frontend graph paths that could disagree about entity counts, graph counts, and visual graph contents.

The visible symptoms were:

- Graph boot taking roughly 14-17 seconds because the runtime loaded an 18 MB content checkpoint on the hot path.
- Graph audit loading stale derived checkpoints.
- GraphViz receiving orphan edges whose endpoints were no longer in the live node set.
- The workbench, hub, footer, graph page, and registry showing different counts.
- Rebuild appearing to succeed while old graph topology still leaked through.
- Memory behavior that improved after cleanup but made the remaining boot path more obviously wrong.

The target design is now:

- OverGraph is the native source of truth.
- Alex owns dictionary/registry semantics.
- The graph kernel is no longer the hot ingestion database.
- Legacy Cozo/Graptor paths are behind the `legacy-cozo-graph` feature, not default native desktop behavior.
- LMDB is removed from the active workspace.

## Storage And Runtime Changes

The native runtime now opens an OverGraph-backed row store by default:

- `rust\phoenix\crates\phoenix-store-overgraph`
- `rust\phoenix\crates\phoenix-runtime`
- `rust\phoenix\crates\phoenix-store-native-core`

The active native row API reads and writes OverGraph relations such as:

- `notes`
- `entities`
- `graph_vertices`
- `graph_edges`
- `graph_candidate_edges`
- `graph_vertex_labels`
- `semantic_documents`
- `semantic_node_prototypes`
- `phoenix_sessions`
- `phoenix_commits`

Native `session_state`, `session_stats`, `query`, graph delta, semantic candidate refresh, rebuild, and persistence commands were moved away from LMDB archive calls and onto OverGraph row reads.

The old native archive concept was not migrated. The 18 MB checkpoint was treated as obsolete state and removed from the boot-critical path.

## LMDB Removal

LMDB was fully removed from the active Phoenix workspace:

- Removed `phoenix-store-lmdb` from `rust\phoenix\Cargo.toml`.
- Removed `heed3` from workspace dependencies.
- Deleted:
  - `rust\phoenix\crates\phoenix-store-lmdb\Cargo.toml`
  - `rust\phoenix\crates\phoenix-store-lmdb\src\lib.rs`
- Removed LMDB dev-dependencies from:
  - `phoenix-ingest-native`
  - `phoenix-invarant-v2`
  - `phoenix-invarant-v3`
  - `phoenix-triverse-v2`
- Removed stale runtime test calls to `v2_store()`.

Final scan checked for:

```text
phoenix-store-lmdb
phoenix_store_lmdb
PhoenixLmdbStore
heed3
lmdb
LMDB
v2_store()
```

The scan returned no active hits across Rust crate manifests/source, `src-tauri`, and Angular TypeScript.

## Cozo And Graptor Quarantine

The runtime default path no longer builds the legacy Cozo/Graptor graph stack.

The remaining legacy path is gated behind:

```toml
legacy-cozo-graph
```

That feature gates the old dependencies and tests that still describe the old WASM/Cozo/Graptor architecture. The native desktop default no longer relies on those paths.

Native store commands now reject unavailable legacy namespaces instead of silently routing through stale compatibility storage.

## Graph Rebuild And Audit Fixes

The graph health issue came from stale document identity living inside graph IDs such as:

```text
chapter::<uuid>::0
leaf::<uuid>::...
```

The earlier prune only looked at explicit `document_id` fields. That missed stale topology embedded in IDs.

The rebuild path was changed so native rebuild compacts graph topology against live note IDs and removes:

- out-of-tree vertices
- out-of-tree edges
- stale embedded document IDs
- derived graph projections that no longer match the live notes

The Graph State rebuild/update path now calls native rebuild and flushes the corrected derived state instead of rehydrating stale derived checkpoints.

Graph audit also purges or filters stale `graph_edges` rows during audit. That was the step that finally stopped the GraphViz orphan spam after the graph healed.

## Boot Path Fix

The old boot path imported a large content checkpoint:

```text
checkpoints/content-24.bin (~18 MB)
```

That checkpoint was not a useful representation of the two current notes and should not have been loaded on the hot path.

The native path now ignores legacy content checkpoints during startup and relies on OverGraph rows. Derived checkpoint recovery remains deferred until first use.

Observed result after cleanup:

```text
All background tasks done in ~712 ms
```

That replaced the earlier 14-17 second runtime wait.

## Build Warning Cleanup

Two Cargo warnings were cleaned:

- Removed unused `graph_builder` patches from:
  - `src-tauri\Cargo.toml`
  - `rust\phoenix\Cargo.toml`
- Renamed the Tauri lib crate from `phoenix_tauri` to `phoenix_tauri_lib`, then updated `src-tauri\src\main.rs`.

This removed the debug PDB collision between the Tauri bin target and lib target.

## Verification Commands

Rust runtime:

```powershell
$env:CARGO_TARGET_DIR='G:\phoenix-target-overgraph'
$env:TMP='G:\phoenix-temp'
$env:TEMP='G:\phoenix-temp'
cargo test --offline --manifest-path rust\phoenix\Cargo.toml -p phoenix-runtime --lib -- --test-threads=1
```

Result:

```text
20 passed; 0 failed
```

Rust check:

```powershell
cargo check --offline --manifest-path rust\phoenix\Cargo.toml -p phoenix-runtime --lib
```

Angular typecheck:

```powershell
node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
```

Phoenix store tests:

```powershell
node_modules\.bin\vitest.cmd run src\app\services\phoenix-store.service.spec.ts
```

Result:

```text
4 passed
```

Tauri packaged debug build:

```powershell
$env:CARGO_TARGET_DIR='G:\phoenix-target-overgraph'
$env:TMP='G:\phoenix-temp'
$env:TEMP='G:\phoenix-temp'
npx @tauri-apps/cli build --debug
```

Expected output:

```text
Built application at: G:\phoenix-target-overgraph\debug\phoenix-tauri.exe
```

## Current Architectural Rule

For native Phoenix Desktop:

```text
OverGraph is the database.
OverGraph is the graph store.
OverGraph is the persistence source of truth.
Alex is the dictionary/registry layer.
The graph kernel is a sidecar computation layer, not the hot ingestion database.
Cozo/Graptor are legacy feature-gated paths.
LMDB is gone.
```

If future code needs graph data, it should read OverGraph rows or use a native API backed by OverGraph rows. It should not rebuild old archive snapshots, load hidden checkpoints, or materialize legacy graph snapshots on the hot path.

