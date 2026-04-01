# Phoenix Runtime Note-Storage Decision Memo

## Summary

This app currently boots and runs on the Phoenix path, not the old GoKitt path.

- Phoenix is the active runtime/backend path during startup.
- OPFS is used as snapshot persistence for the Phoenix-side SQLite store.
- Dexie is rebuilt from Phoenix after boot and serves as a UI mirror/cache, not the primary database.
- GoKitt still exists in the repo, but it is compatibility residue for this question and should not drive note-storage decisions.

The main architectural question is not "should the editor stop using JSON?" in the abstract. The real question is:

> Should Phoenix continue storing note `content` as stringified ProseMirror JSON rows, or is there enough proven runtime-memory benefit to justify a separate compact Phoenix-side representation?

Current recommendation: keep ProseMirror JSON as the canonical persisted note shape, and do not introduce binary/blob note persistence right now. If future profiling shows Phoenix runtime memory is materially contributing to note bloat, investigate Phoenix-side runtime compaction or decoded-cache policy before changing store row format.

## What Is Active Today

### 1. Boot path

The live boot path is wired through Phoenix:

- [`src/app/app.component.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\app.component.ts)
  - calls `phoenixUiApi.loadWasm()`
  - calls `phoenixStore.initialize()`
  - hydrates Dexie from Phoenix
  - then calls `setPhoenixStoreBridge(this.phoenixStore)`

That means Phoenix is the source of truth at runtime, and operations are routed to `PhoenixStoreService`.

### 2. OPFS role

OPFS is not the editor document format and not a separate note database abstraction. It is snapshot persistence for Phoenix's SQLite state:

- [`src/app/lib/sqlite/persistence/SqlitePersistenceService.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\lib\sqlite\persistence\SqlitePersistenceService.ts)
- [`src/app/lib/sqlite/persistence/sqlite-opfs-core.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\lib\sqlite\persistence\sqlite-opfs-core.ts)

The flow is:

1. Phoenix runtime exports a full snapshot as bytes.
2. OPFS stores that binary snapshot.
3. On next boot, Phoenix imports that snapshot back into its SQLite runtime.

So OPFS already handles binary data, but at the whole-database snapshot level, not as a per-note content encoding decision.

### 3. Store bridge

The active CRUD bridge is Phoenix:

- [`src/app/lib/operations.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\lib\operations.ts)

Important note: the header comments in that file still mention "GoKittStoreService" and "Pure OPFS + Go Memory", but the actual implementation uses `PhoenixStoreService`. Those comments are stale.

## The Four Layers That Must Stay Separate

These layers are related but not interchangeable:

### 1. JS editor live object graph

Inside the editor, Milkdown/ProseMirror works with structured document objects. Marks, nodes, attributes, and selections depend on that structure.

Relevant path:

- [`src/app/components/editor/editor.component.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\components\editor\editor.component.ts)

The editor loads by parsing saved JSON and inflating it back with `schema.nodeFromJSON(...)`.

### 2. Persisted/store row representation

Phoenix store rows currently keep note content as strings:

- [`src/app/services/phoenix-store.service.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\services\phoenix-store.service.ts)

`StoreNote` is:

- `content: string`
- `markdownContent: string`

And `noteToRow(...)` writes:

- `content`
- `markdown_content`

as string fields in the row payload.

### 3. Phoenix runtime in-memory representation

This is the live representation inside Phoenix after packets are decoded and store commands run.

This memo does not assume Phoenix runtime memory is the same thing as packet buffers or JS object graphs. That distinction matters. Phoenix may eventually benefit from a different runtime-side representation even if persisted rows stay string-based.

### 4. JS↔Phoenix transport representation

Phoenix transport is packetized and already uses binary packet buffers:

- [`src/app/services/phoenix-wasm.service.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\services\phoenix-wasm.service.ts)
- [`src/app/workers/phoenix.worker.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\workers\phoenix.worker.ts)

Important distinction:

- Packet transport can use `SharedArrayBuffer` or transferable `ArrayBuffer`.
- That does not mean note content itself is stored in a compact runtime form after decode.
- Today, `storeCommand(...)` still goes through `sendJson(...)`, which encodes payloads with `JSON.stringify(...)`.

So transport optimization and note representation optimization are separate levers.

## Current Note Path End To End

### Save path

1. The editor produces a ProseMirror snapshot when an explicit save path runs.
2. `NoteEditorStore` persists:
   - `content: JSON.stringify(json)`
   - `markdownContent: markdown`
3. `ops.updateNote(...)` forwards the updated row to `PhoenixStoreService`.
4. `PhoenixStoreService.upsertNote(...)` writes the row through `relation:upsert`.

Relevant files:

- [`src/app/lib/store/note-editor.store.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\lib\store\note-editor.store.ts)
- [`src/app/lib/operations.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\lib\operations.ts)
- [`src/app/services/phoenix-store.service.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\services\phoenix-store.service.ts)

### Load path

1. Boot initializes Phoenix.
2. Phoenix imports the OPFS snapshot, if any.
3. App boot hydrates Dexie from Phoenix.
4. Editor loads a note from Dexie/current note.
5. The editor parses `note.content` and inflates it back into a ProseMirror document.

Relevant files:

- [`src/app/app.component.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\app.component.ts)
- [`src/app/components/editor/editor.component.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\components\editor\editor.component.ts)

### Search/index path

Phoenix doc hydration for search/indexing is not using raw ProseMirror structure directly. The app extracts text from stored note content for Phoenix ingestion:

- [`src/app/app.component.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\app.component.ts)
- [`src/app/services/phoenix-ui-api.service.ts`](C:\Users\shuga\1kittroot\1code\Angular-build\src\app\services\phoenix-ui-api.service.ts)

This means any note-format change would affect:

- editor save/load
- store row shape
- background search/doc hydration
- downstream ingestion assumptions

## What Uses Binary Today

### Binary is already used for snapshots

Phoenix exports/imports whole-store snapshots as `Uint8Array`:

- `exportSnapshot()`
- `importSnapshot(...)`

This is the right use of binary today: compact persistence of the full database state.

### Binary is already used for packet transport

Phoenix creates packet buffers with:

- `SharedArrayBuffer` when available
- `ArrayBuffer` fallback when not

That is a transport optimization between JS and the worker/WASM boundary. It reduces packet-copy overhead but does not change the semantic shape of note rows.

### Note store commands are still JSON payloads

`storeCommand(...)` uses `sendJson(...)` with:

- `{ command, payload }`

This means note upserts, relation writes, and note row payloads are still JSON-encoded commands, even though they travel inside packet buffers.

## Options

### Option A. Keep current stringified JSON row format and optimize around duplication

Description:

- Keep `content` as stringified ProseMirror JSON in Phoenix store rows.
- Keep `markdownContent` as secondary text.
- Focus performance work on avoiding duplicate copies, duplicate derivations, and unnecessary conversions.

This means:

- no row schema change
- no editor compatibility risk
- no migration of stored note content
- no special binary codec for notes

### Option B. Keep persisted row format, but add Phoenix-side runtime compaction or decoded caching policy

Description:

- Keep `content: string` in rows and snapshots.
- Allow Phoenix runtime to decode/cache/compact internally if profiling proves it matters.
- Possible examples later:
  - lazy decode only on demand
  - short-lived decoded caches
  - bounded cache eviction
  - arena/interning strategies inside Phoenix

This targets the Rust-side runtime representation without forcing a storage/schema migration.

### Option C. Introduce compact binary/blob note representation for note documents

Description:

- Replace or supplement stringified ProseMirror JSON with binary/blob note payloads inside Phoenix rows or a parallel store structure.
- Decode back into structured JSON/objects before editor hydration.

This is the heaviest option and affects the most boundaries.

## Recommendation Matrix

| Option | Memory impact in Rust runtime | Memory impact in JS tab | Serialization cost | ProseMirror fidelity | OPFS/SQLite snapshot complexity | Debuggability | Migration risk |
|---|---|---:|---|---|---|---|---|
| A. Keep stringified JSON rows | Low to moderate improvement only if churn is reduced elsewhere | Moderate improvement possible by reducing duplicate live copies | Lowest | Safest | No change | Best | Lowest |
| B. Keep rows, optimize Phoenix runtime | Best targeted option if Rust runtime proves heavy | Little direct JS benefit unless packet/duplication also change | Moderate | Safe if canonical row stays JSON | Minimal snapshot impact | Good | Medium |
| C. Binary/blob note representation | Potentially good in Rust, but unproven end-to-end | Often weak after decode because editor still inflates structure | Highest | Highest risk | Highest complexity | Worst | Highest |

## Recommendation

### Recommended decision: do not change note persistence format now

Keep ProseMirror JSON as the canonical persisted note format.

Why:

1. The editor fundamentally needs structured data for correct rehydration.
2. A binary/blob note format would still have to inflate back into structured data before editing.
3. That means smaller stored bytes do not automatically become smaller live memory.
4. In this app, the active Phoenix store contract, background hydration path, and Dexie mirror all already assume string content fields.
5. OPFS already provides a binary persistence layer where binary actually helps: whole-database snapshots.

### Recommended next investigation if runtime memory still matters

If profiling later shows Phoenix itself is meaningfully retaining too much note memory, investigate Option B before Option C:

- keep rows/snapshots as JSON strings
- profile Phoenix runtime decode/cache behavior
- test bounded decoded caches or runtime compaction inside Phoenix
- only consider binary/blob note storage if that materially lowers real end-to-end memory after decode

### Explicit guidance

- Change now: no
- Do not change now: yes, for persisted note format
- Spike first later if needed: yes, but only on Phoenix runtime internals, not on note row schema

## Internal Contracts That Must Be Preserved

Any future experiment must preserve these unless it explicitly proposes a migration:

- editor load path must still be able to reconstruct a ProseMirror document faithfully
- `StoreNote` currently exposes:
  - `content: string`
  - `markdownContent: string`
- OPFS persists whole Phoenix snapshots as binary SQLite snapshots, not per-note blobs
- background doc hydration expects to derive searchable text from note content

## Concrete Findings From This Repo

### Active and current

- Phoenix startup path is real and active.
- Phoenix store is real and active.
- OPFS snapshot persistence is real and active.
- Phoenix transport already has binary packet support.

### Residual and stale

- GoKitt comments in some files are stale.
- GoKitt-ready hooks remain as compatibility residue.
- Old "cozo" naming still appears in comments/config values, but it does not change the active architecture described above.

## Final Call

If the priority is "tiny, light, and fast," the highest-value move is not to replace the canonical note format first.

The best current design is:

- structured ProseMirror JSON as the authoritative note document
- binary snapshot persistence for the whole Phoenix database
- binary/shared packet transport where it helps
- future Phoenix runtime-memory optimization only if profiling proves Phoenix note retention is a real contributor

That keeps fidelity intact and avoids a high-risk binary-note migration that may only save bytes on disk or on the wire while leaving live editor memory essentially unchanged.
