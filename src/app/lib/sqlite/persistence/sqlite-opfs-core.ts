/**
 * Sqlite OPFS Core Adapter (Binary + JSONL)
 * 
 * Provides atomic binary snapshot + append-only JSONL WAL persistence for SQLite.
 * File Layout (under OPFS root):
 *   /gokitt/sqlite.db       - Full binary SQLite export
 *   /gokitt/sqlite.db.bak   - Backup
 *   /gokitt/sqlite_wal.jsonl - Append-only log
 */

// ==========================================
// Types
// ==========================================

export const MAX_SNAPSHOT_SIZE_BYTES = 100 * 1024 * 1024; // 100MB limit

export type WalEntry = {
    ts: number;           // Timestamp
    op: string;           // Operation: 'upsertNote', 'deleteNote', etc.
    data: any;            // The payload (Note, Entity, Edge, etc.)
};

export type LoadResult = {
    snapshot: Uint8Array | null;
    wal: WalEntry[];
    recoveryMode: boolean;
};

// ==========================================
// IO Utilities (Short-Lived Handles)
// ==========================================

/**
 * Write binary blob to file (exclusive lock implicit via createWritable)
 */
async function writeBinaryFile(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
    let writable: FileSystemWritableFileStream | null = null;
    try {
        writable = await (handle as any).createWritable({ mode: "exclusive" });
        if (!writable) throw new Error("Failed to create writable stream");

        // Convert to ArrayBuffer for compatibility
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        await writable.write(buffer);
    } catch (e: any) {
        if (e?.name === "NoModificationAllowedError") {
            throw new Error("File locked by another writer");
        }
        throw e;
    } finally {
        if (writable) await writable.close();
    }
}


/**
 * Append text line to file
 */
async function appendTextFile(handle: FileSystemFileHandle, text: string): Promise<void> {
    let writable: FileSystemWritableFileStream | null = null;
    try {
        writable = await (handle as any).createWritable({ keepExistingData: true });
        if (!writable) throw new Error("Failed to create writable stream");

        const file = await handle.getFile();
        await writable.seek(file.size);
        await writable.write(text);

    } catch (e: any) {
        throw new Error("Failed to append WAL: " + e.message);
    } finally {
        if (writable) await writable.close();
    }
}

/**
 * Read full binary file
 */
async function readBinaryFile(handle: FileSystemFileHandle): Promise<Uint8Array | null> {
    try {
        const file = await handle.getFile();
        if (file.size === 0) return null;
        const arrayBuffer = await file.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    } catch (e: any) {
        if (e.name === 'NotFoundError') return null;
        throw e;
    }
}

/**
 * Read text file (WAL)
 */
async function readTextFile(handle: FileSystemFileHandle): Promise<string | null> {
    try {
        const file = await handle.getFile();
        if (file.size === 0) return null;
        return await file.text();
    } catch (e: any) {
        if (e.name === 'NotFoundError') return null;
        throw e;
    }
}

// ==========================================
// Core Adapter Logic
// ==========================================

export class SqliteOpfsAdapter {
    private readonly snapshotName = "sqlite.db";
    private readonly walName = "sqlite_wal.jsonl";

    private async getDirectory(): Promise<FileSystemDirectoryHandle> {
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle('gokitt', { create: true });
    }

    private bakName() {
        return `${this.snapshotName}.bak`;
    }

    /**
     * Load Snapshot (Binary) + WAL (JSONL)
     */
    async load(): Promise<LoadResult> {
        const dir = await this.getDirectory();
        let recoveryMode = false;
        let snapshot: Uint8Array | null = null;

        // Try primary snapshot
        try {
            const handle = await dir.getFileHandle(this.snapshotName, { create: true });
            snapshot = await readBinaryFile(handle);
        } catch (e) {
            console.warn("[SqliteOpfs] Primary load failed, trying backup", e);
            recoveryMode = true;
        }

        // Try backup if needed
        if (!snapshot && recoveryMode) {
            try {
                const handle = await dir.getFileHandle(this.bakName(), { create: true });
                snapshot = await readBinaryFile(handle);
                if (snapshot) console.warn("[SqliteOpfs] Recovered from backup");
            } catch (e) {
                // No backup available
            }
        }

        // Load WAL
        const wal: WalEntry[] = [];
        try {
            const handle = await dir.getFileHandle(this.walName, { create: true });
            const text = await readTextFile(handle);
            if (text) {
                const lines = text.trim().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        wal.push(JSON.parse(line));
                    } catch (e) {
                        console.warn("[SqliteOpfs] Corrupt WAL line skipped");
                    }
                }
            }
        } catch (e) {
            console.warn("[SqliteOpfs] WAL read failed", e);
        }

        return { snapshot, wal, recoveryMode };
    }

    /**
     * Save Snapshot (Binary) with Backup Rotation
     */
    async saveSnapshot(data: Uint8Array): Promise<void> {
        const dir = await this.getDirectory();

        if (data.byteLength > MAX_SNAPSHOT_SIZE_BYTES) {
            throw new Error(`Snapshot too large: ${data.byteLength}`);
        }

        // temp file
        const tmpName = `${this.snapshotName}.tmp-${Date.now()}`;
        const tmp = await dir.getFileHandle(tmpName, { create: true });
        await writeBinaryFile(tmp, data);

        // Rotate current -> .bak
        try {
            try {
                const cur = await dir.getFileHandle(this.snapshotName);
                await (cur as any).move(dir, this.bakName());
            } catch (e: any) {
                if (e.name !== 'NotFoundError') throw e;
            }
        } catch (e) {
            console.warn("[SqliteOpfs] Rotation failed", e);
        }

        // Commit tmp -> current
        try {
            await (tmp as any).move(dir, this.snapshotName);
        } catch (e: any) {
            try { await dir.removeEntry(tmpName); } catch { }
            throw new Error("Failed to commit snapshot: " + (e.message || String(e)));
        }

    }

    /**
     * Append Batch to WAL
     */
    async appendWalBatch(entries: WalEntry[]): Promise<void> {
        const dir = await this.getDirectory();

        // Convert to newlines
        const chunk = entries.map(e => JSON.stringify(e)).join('\n') + '\n';

        const handle = await dir.getFileHandle(this.walName, { create: true });
        await appendTextFile(handle, chunk);
    }

    /**
     * Truncate WAL
     */
    async truncateWal(): Promise<void> {
        const dir = await this.getDirectory();
        let writable: FileSystemWritableFileStream | null = null;
        try {
            const handle = await dir.getFileHandle(this.walName, { create: true });
            writable = await (handle as any).createWritable();
            if (writable) await writable.truncate(0);

        } catch (e) {
            console.warn("[SqliteOpfs] WAL truncate failed", e);
        } finally {
            if (writable) await writable.close();
        }
    }

    /**
     * Factory Reset
     */
    async clearAll(): Promise<void> {
        const dir = await this.getDirectory();
        // Best effort removal
        try { await dir.removeEntry(this.snapshotName); } catch { }
        try { await dir.removeEntry(this.bakName()); } catch { }
        try { await dir.removeEntry(this.walName); } catch { }
    }
}
