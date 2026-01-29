/**
 * CozoDB OPFS Core Adapter
 * 
 * Provides atomic snapshot + append-only WAL persistence for CozoDB.
 * Enterprise-grade: atomic commits, backup rotation, integrity checks, quota guardrails.
 * 
 * File Layout (under OPFS root):
 *   /cozo/snapshot.json      - Full Cozo export
 *   /cozo/snapshot.json.bak  - Backup
 *   /cozo/wal.jsonl          - Append-only log
 */

// ==========================================
// Types
// ==========================================

/** Current schema version - bump when envelope format changes */
export const SCHEMA_VERSION = 1;

/** Maximum snapshot size in bytes (50MB) */
export const MAX_SNAPSHOT_SIZE_BYTES = 50 * 1024 * 1024;

export type CozoSnapshotEnvelope = {
    magic: "cozo-snapshot";
    schema: number;
    createdAtMs: number;
    payloadJson: string;      // Raw JSON string from CozoDB export
    payloadSha256Hex: string; // Integrity check
};

export type WalEntry = {
    ts: number;           // Timestamp
    op: 'script';         // Operation type (just scripts for now)
    script: string;       // CozoScript that was run
    params?: string;      // JSON-stringified params (needed for replay)
};

export type LoadResult = {
    snapshot: any | null;
    recoveryMode: boolean;  // True if fallback was used
    source: 'primary' | 'backup' | 'none';
};

export type QuotaStatus = {
    usageBytes: number;
    quotaBytes: number;
    usagePercent: number;
    available: number;
};

export class CozoOpfsError extends Error {
    constructor(
        message: string,
        public readonly code:
            | "NotSupported"
            | "Corrupt"
            | "SchemaMismatch"
            | "Quota"
            | "Locked"
            | "TooLarge"
            | "Io",
        public override readonly cause?: unknown,
    ) {
        super(message);
        this.name = "CozoOpfsError";
    }
}

// ==========================================
// Crypto & IO Utilities
// ==========================================

const enc = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
    const bytes = enc.encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Write text to file with exclusive lock - short-lived handle pattern
 */
async function writeTextFileExclusive(handle: FileSystemFileHandle, text: string): Promise<void> {
    let writable: FileSystemWritableFileStream | null = null;
    try {
        writable = await (handle as any).createWritable({ mode: "exclusive" });
        if (writable) {
            await writable.write(text);
        }
    } catch (e: any) {
        if (e?.name === "NoModificationAllowedError") {
            throw new CozoOpfsError("File is locked by another writer", "Locked", e);
        }
        throw new CozoOpfsError("Failed writing file", "Io", e);
    } finally {
        // Always close - short-lived handle discipline
        if (writable) {
            try {
                await writable.close();
            } catch { /* ignore close errors */ }
        }
    }
}

/**
 * Read text from file - short-lived handle pattern
 */
async function readTextFileOrNull(handle: FileSystemFileHandle): Promise<string | null> {
    try {
        const file = await handle.getFile();
        if (file.size === 0) return null;
        return await file.text();
    } catch (e: any) {
        if (e?.name === "NotFoundError") return null;
        throw new CozoOpfsError("Failed reading file", "Io", e);
    }
}

/**
 * Append text to file - short-lived handle pattern
 */
async function appendTextFile(handle: FileSystemFileHandle, text: string): Promise<void> {
    let writable: FileSystemWritableFileStream | null = null;
    try {
        writable = await (handle as any).createWritable({ keepExistingData: true });
        if (writable) {
            const file = await handle.getFile();
            await writable.seek(file.size);
            await writable.write(text);
        }
    } catch (e: any) {
        throw new CozoOpfsError("Failed appending to file", "Io", e);
    } finally {
        if (writable) {
            try {
                await writable.close();
            } catch { /* ignore close errors */ }
        }
    }
}

/**
 * Schema migrations - add new migrations here when schema changes
 */
const SCHEMA_MIGRATIONS: Record<number, (env: any) => any> = {
    // Example: 1 -> 2 migration
    // 2: (env) => ({ ...env, schema: 2, newField: defaultValue })
};

async function tryParseEnvelope(text: string): Promise<CozoSnapshotEnvelope> {
    let env: any;
    try {
        env = JSON.parse(text);
    } catch (e) {
        throw new CozoOpfsError("Envelope JSON is invalid", "Corrupt", e);
    }

    if (env?.magic !== "cozo-snapshot") {
        throw new CozoOpfsError("Envelope magic mismatch", "Corrupt");
    }

    // Apply migrations if needed
    let currentSchema = env.schema;
    while (currentSchema < SCHEMA_VERSION) {
        const migrator = SCHEMA_MIGRATIONS[currentSchema + 1];
        if (!migrator) {
            throw new CozoOpfsError(`No migration path from schema ${currentSchema} to ${SCHEMA_VERSION}`, "SchemaMismatch");
        }
        env = migrator(env);
        currentSchema = env.schema;
        console.log(`[CozoOpfs] Migrated envelope from schema ${currentSchema - 1} to ${currentSchema}`);
    }

    if (env.schema !== SCHEMA_VERSION) {
        throw new CozoOpfsError(`Unsupported schema version ${env.schema}`, "SchemaMismatch");
    }
    if (typeof env.payloadJson !== "string" || typeof env.payloadSha256Hex !== "string") {
        throw new CozoOpfsError("Envelope fields missing", "Corrupt");
    }

    const expected = await sha256Hex(env.payloadJson);
    if (expected !== env.payloadSha256Hex) {
        throw new CozoOpfsError("Snapshot hash mismatch", "Corrupt");
    }

    return env as CozoSnapshotEnvelope;
}

// ==========================================
// CozoDB OPFS Adapter
// ==========================================

export class CozoOpfsAdapter {
    private readonly snapshotName = "snapshot.json";
    private readonly walName = "wal.jsonl";

    /**
     * Get or create the /cozo directory under OPFS root
     */
    private async getDirectory(): Promise<FileSystemDirectoryHandle> {
        if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) {
            throw new CozoOpfsError("OPFS not supported in this browser", "NotSupported");
        }
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle('cozo', { create: true });
    }

    private bakName() {
        return `${this.snapshotName}.bak`;
    }

    /**
     * Get current quota status
     */
    async getQuotaStatus(): Promise<QuotaStatus> {
        try {
            const est = await navigator.storage.estimate();
            const usage = est.usage ?? 0;
            const quota = est.quota ?? 0;
            return {
                usageBytes: usage,
                quotaBytes: quota,
                usagePercent: quota > 0 ? (usage / quota) * 100 : 0,
                available: quota - usage,
            };
        } catch (e) {
            return { usageBytes: 0, quotaBytes: 0, usagePercent: 0, available: 0 };
        }
    }

    /**
     * Load the snapshot from OPFS with fallback chain
     * Returns parsed payload or null if no snapshot exists
     */
    async loadSnapshot(): Promise<LoadResult> {
        const dir = await this.getDirectory();
        let recoveryMode = false;

        // Try primary
        try {
            const primary = await dir.getFileHandle(this.snapshotName, { create: true });
            const primaryText = await readTextFileOrNull(primary);

            if (primaryText) {
                const env = await tryParseEnvelope(primaryText);
                return {
                    snapshot: JSON.parse(env.payloadJson),
                    recoveryMode: false,
                    source: 'primary',
                };
            }
        } catch (e) {
            console.warn("[CozoOpfs] Primary load failed, trying backup", e);
            recoveryMode = true;
        }

        // Try backup
        try {
            const bak = await dir.getFileHandle(this.bakName(), { create: true });
            const bakText = await readTextFileOrNull(bak);

            if (bakText) {
                const env = await tryParseEnvelope(bakText);
                console.warn("[CozoOpfs] ⚠️ Recovered from backup");
                return {
                    snapshot: JSON.parse(env.payloadJson),
                    recoveryMode: true,
                    source: 'backup',
                };
            }
        } catch (e) {
            console.warn("[CozoOpfs] Backup load also failed", e);
        }

        // No snapshot available
        console.warn('[CozoOpfs] 🔍 No snapshot found - source: none');
        return {
            snapshot: null,
            recoveryMode,
            source: 'none',
        };
    }

    /**
     * Save a snapshot atomically with backup rotation and size guardrails
     */
    async saveSnapshot(data: any): Promise<void> {
        const dir = await this.getDirectory();

        const payloadJson = JSON.stringify(data);

        // Size guardrail
        if (payloadJson.length > MAX_SNAPSHOT_SIZE_BYTES) {
            throw new CozoOpfsError(
                `Snapshot too large: ${(payloadJson.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_SNAPSHOT_SIZE_BYTES / 1024 / 1024}MB limit`,
                "TooLarge"
            );
        }

        // Quota check
        const quota = await this.getQuotaStatus();
        if (quota.usagePercent > 90) {
            console.warn(`[CozoOpfs] ⚠️ Quota warning: ${quota.usagePercent.toFixed(1)}% used`);
        }
        if (quota.available < payloadJson.length * 2) {
            throw new CozoOpfsError(
                `Insufficient quota: need ${(payloadJson.length * 2 / 1024 / 1024).toFixed(1)}MB, have ${(quota.available / 1024 / 1024).toFixed(1)}MB`,
                "Quota"
            );
        }

        const env: CozoSnapshotEnvelope = {
            magic: "cozo-snapshot",
            schema: SCHEMA_VERSION,
            createdAtMs: Date.now(),
            payloadJson,
            payloadSha256Hex: await sha256Hex(payloadJson),
        };
        const envText = JSON.stringify(env);

        // Write to temp file first
        const tmpName = `${this.snapshotName}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const tmp = await dir.getFileHandle(tmpName, { create: true });
        await writeTextFileExclusive(tmp, envText);

        // Rotate: move current -> .bak
        try {
            try {
                const cur = await dir.getFileHandle(this.snapshotName);
                await (cur as any).move(dir, this.bakName());
            } catch (e: any) {
                if (e.name !== 'NotFoundError') throw e;
            }
        } catch (e) {
            console.warn("[CozoOpfs] Rotation failed (continuing)", e);
        }

        // Commit: move tmp -> current
        try {
            await (tmp as any).move(dir, this.snapshotName);
        } catch (e) {
            // Fallback: try to clean up tmp
            try { await dir.removeEntry(tmpName); } catch { }
            throw new CozoOpfsError("Failed to commit snapshot", "Io", e);
        }

        console.log("[CozoOpfs] Snapshot saved");
    }

    /**
     * Load all WAL entries
     */
    async loadWal(): Promise<WalEntry[]> {
        const dir = await this.getDirectory();

        try {
            const walHandle = await dir.getFileHandle(this.walName, { create: true });
            const text = await readTextFileOrNull(walHandle);
            if (!text) return [];

            const entries: WalEntry[] = [];
            const lines = text.trim().split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    entries.push(JSON.parse(line));
                } catch (e) {
                    console.warn("[CozoOpfs] Skipping corrupt WAL line:", line.slice(0, 100));
                }
            }
            return entries;
        } catch (e) {
            console.warn("[CozoOpfs] WAL load error", e);
            return [];
        }
    }

    /**
     * Append a single entry to the WAL
     */
    async appendWal(entry: WalEntry): Promise<void> {
        const dir = await this.getDirectory();
        const walHandle = await dir.getFileHandle(this.walName, { create: true });
        const line = JSON.stringify(entry) + '\n';
        await appendTextFile(walHandle, line);
    }

    /**
     * Truncate (clear) the WAL after compaction
     */
    async truncateWal(): Promise<void> {
        const dir = await this.getDirectory();
        let writable: FileSystemWritableFileStream | null = null;

        try {
            const walHandle = await dir.getFileHandle(this.walName, { create: true });
            writable = await (walHandle as any).createWritable();
            if (writable) {
                await writable.truncate(0);
            }
        } catch (e) {
            console.warn("[CozoOpfs] WAL truncate failed", e);
        } finally {
            if (writable) {
                try {
                    await writable.close();
                } catch { /* ignore */ }
            }
        }
        console.log("[CozoOpfs] WAL truncated");
    }
}
