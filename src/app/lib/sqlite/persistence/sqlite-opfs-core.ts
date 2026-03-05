/**
 * OPFS Core Adapter — Pure Snapshot Persistence
 *
 * Single responsibility: read/write a binary SQLite snapshot to OPFS.
 * No WAL. No incremental writes. No Dexie.
 *
 * File layout (under OPFS root):
 *   /gokitt/sqlite.db     — Current snapshot
 *   /gokitt/sqlite.db.bak — Previous snapshot (crash recovery)
 */

// Hard cap to prevent runaway writes
const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024; // 100 MB

// ---------------------------------------------------------------------------
// IO Helpers (short-lived handles — no long-held locks)
// ---------------------------------------------------------------------------

async function writeBinary(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
    if (data.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error(`[OPFS] Snapshot too large: ${data.byteLength} bytes (limit ${MAX_SNAPSHOT_BYTES})`);
    }
    const w = await handle.createWritable();
    try {
        await w.write(data as any);
        await w.close();
    } catch (err) {
        try { await w.abort(); } catch { /* swallow */ }
        throw err;
    }
}

async function readBinary(handle: FileSystemFileHandle): Promise<Uint8Array | null> {
    try {
        const file = await handle.getFile();
        if (file.size === 0) return null;
        return new Uint8Array(await file.arrayBuffer());
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SqliteOpfsAdapter {
    private readonly FILE = 'sqlite.db';
    private readonly BAK = 'sqlite.db.bak';

    /** Get (or create) the /gokitt/ directory in OPFS */
    private async dir(): Promise<FileSystemDirectoryHandle> {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle('gokitt', { create: true });
    }

    /**
     * Load the latest snapshot from OPFS.
     * Falls back to .bak if the primary file is missing/empty.
     */
    async load(): Promise<Uint8Array | null> {
        try {
            const d = await this.dir();

            // Try primary
            try {
                const h = await d.getFileHandle(this.FILE, { create: false });
                const data = await readBinary(h);
                if (data) {
                    console.log(`[OPFS] Loaded snapshot: ${data.byteLength} bytes`);
                    return data;
                }
            } catch { /* no primary */ }

            // Try backup
            try {
                const bh = await d.getFileHandle(this.BAK, { create: false });
                const bak = await readBinary(bh);
                if (bak) {
                    console.warn('[OPFS] Primary missing — recovered from backup');
                    return bak;
                }
            } catch { /* no backup */ }

            console.log('[OPFS] No snapshot found. Starting fresh.');
            return null;
        } catch (err) {
            console.error('[OPFS] Load failed:', err);
            return null;
        }
    }

    /**
     * Save a snapshot with backup rotation.
     * 1. Copy current .db → .bak
     * 2. Write new data → .db
     */
    async saveSnapshot(data: Uint8Array): Promise<void> {
        const d = await this.dir();

        // Rotate current → backup
        try {
            const cur = await d.getFileHandle(this.FILE, { create: false });
            const curData = await readBinary(cur);
            if (curData && curData.byteLength > 0) {
                const bh = await d.getFileHandle(this.BAK, { create: true });
                await writeBinary(bh, curData);
            }
        } catch { /* nothing to rotate */ }

        // Write new snapshot
        const h = await d.getFileHandle(this.FILE, { create: true });
        await writeBinary(h, data);
        console.log(`[OPFS] Snapshot saved: ${data.byteLength} bytes`);
    }

    /**
     * Factory reset — delete the entire /gokitt/ directory.
     */
    async clearAll(): Promise<void> {
        try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry('gokitt', { recursive: true });
            console.log('[OPFS] Factory reset: all data deleted.');
        } catch (err) {
            console.warn('[OPFS] clearAll — directory may not exist:', err);
        }
    }
}
