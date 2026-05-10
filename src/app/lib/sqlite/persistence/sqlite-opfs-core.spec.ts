import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyPhoenixManifest } from './phoenix-wal';
import { SqliteOpfsAdapter } from './sqlite-opfs-core';

class FakeFileRecord {
    data = new Uint8Array(0);
}

class FakeWritableFileStream {
    private buffer: Uint8Array;
    private position = 0;

    constructor(
        private readonly record: FakeFileRecord,
        keepExistingData: boolean,
    ) {
        this.buffer = keepExistingData ? record.data.slice() : new Uint8Array(0);
    }

    async write(data: Uint8Array | ArrayBuffer): Promise<void> {
        const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
        const nextLength = Math.max(this.buffer.length, this.position + chunk.length);
        if (nextLength !== this.buffer.length) {
            const next = new Uint8Array(nextLength);
            next.set(this.buffer);
            this.buffer = next;
        }
        this.buffer.set(chunk, this.position);
        this.position += chunk.length;
    }

    async seek(position: number): Promise<void> {
        this.position = position;
    }

    async truncate(length: number): Promise<void> {
        if (length < this.buffer.length) {
            this.buffer = this.buffer.slice(0, length);
        } else if (length > this.buffer.length) {
            const next = new Uint8Array(length);
            next.set(this.buffer);
            this.buffer = next;
        }
        this.position = Math.min(this.position, length);
    }

    async close(): Promise<void> {
        this.record.data = this.buffer;
    }

    async abort(): Promise<void> {
        // No-op for tests.
    }
}

class FakeFileHandle {
    constructor(private readonly record: FakeFileRecord) {}

    async createWritable(options?: { keepExistingData?: boolean }): Promise<FakeWritableFileStream> {
        return new FakeWritableFileStream(this.record, !!options?.keepExistingData);
    }

    async getFile(): Promise<{ size: number; arrayBuffer: () => Promise<ArrayBuffer> }> {
        const data = this.record.data.slice();
        return {
            size: data.byteLength,
            arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        };
    }
}

class FakeDirectoryHandle {
    readonly directories = new Map<string, FakeDirectoryHandle>();
    readonly files = new Map<string, FakeFileRecord>();

    constructor(readonly name: string) {}

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
        const existing = this.directories.get(name);
        if (existing) {
            return existing;
        }
        if (options?.create) {
            const created = new FakeDirectoryHandle(name);
            this.directories.set(name, created);
            return created;
        }
        throw new Error(`Directory not found: ${name}`);
    }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
        const existing = this.files.get(name);
        if (existing) {
            return new FakeFileHandle(existing);
        }
        if (options?.create) {
            const created = new FakeFileRecord();
            this.files.set(name, created);
            return new FakeFileHandle(created);
        }
        throw new Error(`File not found: ${name}`);
    }

    async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
        if (this.files.delete(name)) {
            return;
        }

        const directory = this.directories.get(name);
        if (!directory) {
            throw new Error(`Entry not found: ${name}`);
        }
        if (!options?.recursive && (directory.directories.size > 0 || directory.files.size > 0)) {
            throw new Error(`Directory not empty: ${name}`);
        }
        this.directories.delete(name);
    }
}

async function writeBytes(handle: FakeFileHandle, bytes: Uint8Array): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
}

describe('SqliteOpfsAdapter Phoenix persistence debug', () => {
    const originalNavigator = globalThis.navigator;
    let root: FakeDirectoryHandle;
    let adapter: SqliteOpfsAdapter;

    beforeEach(() => {
        root = new FakeDirectoryHandle('opfs-root');
        adapter = new SqliteOpfsAdapter();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                storage: {
                    getDirectory: vi.fn(async () => root),
                },
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: originalNavigator,
        });
    });

    it('reports empty Phoenix persistence when no manifest is present', async () => {
        const debug = await adapter.inspectPhoenixPersistenceDebug();

        expect(debug.rootExists).toBe(false);
        expect(debug.phoenixDirExists).toBe(false);
        expect(debug.manifestPresent).toBe(false);
        expect(debug.hasActivePhoenixState).toBe(false);
        expect(debug.hasLegacyArtifactsOnly).toBe(false);
    });

    it('reports active Phoenix manifest, checkpoints, and WAL bytes', async () => {
        await adapter.writePhoenixCheckpoint('content', 1, new Uint8Array([1, 2, 3]));
        await adapter.writePhoenixCheckpoint('derived', 1, new Uint8Array([4, 5]));
        await adapter.appendPhoenixWalBatch({
            records: [{
                seq: 1,
                command: 'note:upsert',
                payload: { id: 'note-1' },
                partition: 'content',
                writtenAt: 1,
            }],
        });

        const manifest = createEmptyPhoenixManifest(1);
        manifest.generation = 1;
        manifest.content.checkpointFile = 'checkpoints/content-1.bin';
        manifest.derived.checkpointFile = 'checkpoints/derived-1.bin';
        await adapter.commitPhoenixManifest(manifest);

        const debug = await adapter.inspectPhoenixPersistenceDebug();

        expect(debug.rootExists).toBe(true);
        expect(debug.phoenixDirExists).toBe(true);
        expect(debug.manifestPresent).toBe(true);
        expect(debug.contentCheckpoint?.bytes).toBe(3);
        expect(debug.derivedCheckpoint?.bytes).toBe(2);
        expect(debug.activeSegment?.bytes).toBeGreaterThan(0);
        expect(debug.hasActivePhoenixState).toBe(true);
        expect(debug.hasLegacyArtifactsOnly).toBe(false);
    });

    it('reports legacy sqlite.db artifacts separately from active Phoenix state', async () => {
        const phoenix = await root.getDirectoryHandle('phoenix', { create: true });
        await writeBytes(await phoenix.getFileHandle('sqlite.db', { create: true }), new Uint8Array([9]));
        await writeBytes(await phoenix.getFileHandle('sqlite.db.bak', { create: true }), new Uint8Array([8]));

        const debug = await adapter.inspectPhoenixPersistenceDebug();

        expect(debug.rootExists).toBe(true);
        expect(debug.manifestPresent).toBe(false);
        expect(debug.staleLegacyFiles).toEqual(['sqlite.db', 'sqlite.db.bak']);
        expect(debug.hasActivePhoenixState).toBe(false);
        expect(debug.hasLegacyArtifactsOnly).toBe(true);
    });

    it('clearAll removes the phoenix root and verifies the empty post-state', async () => {
        const phoenix = await root.getDirectoryHandle('phoenix', { create: true });
        await writeBytes(await phoenix.getFileHandle('sqlite.db', { create: true }), new Uint8Array([7]));

        const result = await adapter.clearAll();

        expect(result.before.rootExists).toBe(true);
        expect(result.after.rootExists).toBe(false);
        expect(result.after.phoenixDirExists).toBe(false);
        expect(result.cleared).toBe(true);
    });
});
