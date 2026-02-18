# WAL Manual Verification Protocol

This document outlines the steps to verify the Enterprise WAL implementation for GoSQLite.

## 1. Verify Application Boot
1.  Open the application in the browser.
2.  Open DevTools Console.
3.  Refresh the page.
4.  Look for the following logs in order:
    *   `[GoKittStoreService] ✅ SQLite Store initialized`
    *   `[GoKittStoreService] Restoring state from persistence...`
    *   `[SqlitePersistence] Initializing worker...`
    *   `[SqliteOpfsWorker] Worker initialized (with mutex)`
    *   `[SqliteOpfs] Recovered from backup` (only if primary missing)
    *   `[GoKittStoreService] Importing snapshot (...)` (if exists)
    *   `[GoKittStoreService] Replaying X WAL entries...` (if any)
    *   `[GoKittStoreService] Listening for WAL events from worker`

## 2. Verify WAL Append
1.  Create a new Note in the UI.
2.  Check the Console for:
    *   `[GoKittWorker] Received: STORE_UPSERT_NOTE`
    *   `[GoKittWorker] Back channel WAL Event: upsertNote` (if enabled in worker logs)
    *   `[GoKittStoreService] Listening for WAL events from worker` (implicitly via receipt)
3.  Check OPFS (using Chrome DevTools -> Application -> Storage -> OPFS Explorer extension or internal view):
    *   Navigate to `.file_system/gokitt/`
    *   Verify `sqlite_wal.jsonl` exists and has grown in size.
    *   The file should contain a JSON line for the `upsertNote` op.

## 3. Verify Persistence & Recovery
1.  Reload the page.
2.  Verify the Note created in step 2 is present in the UI.
3.  Check Console logs:
    *   Ensure `Replaying X WAL entries...` count matches the operations performed.

## 4. Verify Compaction (Manual for now)
*   Currently, compaction is triggered manually or by size thresholds not yet hit.
*   To test, you can manually trigger `window.goKittStore.persistence.compact(await window.goKittStore.exportDatabase())` if exposed, or implementation of `maybeCompact()` logic would be the next phase.

## 5. Verify Bridge Bypass
1.  Create/Edit a note.
2.  Ensure there are NO logs from `[GoOpfsSyncService]`.
3.  Ensure `sqlite.db` (the old blob sync file) is NOT being updated unless by the new `compact` process (which writes to `gokitt/sqlite.db` via `sqlite-opfs.worker.ts`).
