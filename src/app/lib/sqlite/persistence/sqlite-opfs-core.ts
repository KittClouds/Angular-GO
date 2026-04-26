import {
    type PhoenixPersistenceClearResult,
    type PhoenixPersistenceDebugState,
    type LoadedPhoenixManifestState,
    type PersistenceManifest,
    type PhoenixPersistenceSizeSummary,
    type PhoenixCheckpointPartition,
    type PhoenixCheckpointWriteResult,
    type PhoenixWalAppendResult,
    type PhoenixWalBatch,
    PHOENIX_WAL_ACTIVE_SEGMENT_FILE,
    createEmptyPhoenixManifest,
    encodeWalBatch,
    manifestToJsonBytes,
    normalizeManifest,
    parseManifestBytes,
} from './phoenix-wal';

const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const ROOT_DIR_NAME = 'gokitt';
const PHOENIX_DIR_NAME = 'phoenix-wal-v1';
const LEGACY_FILE = 'sqlite.db';
const LEGACY_BAK = 'sqlite.db.bak';
const MANIFEST_FILE = 'manifest.json';
const MANIFEST_BAK = 'manifest.bak';
const PHOENIX_CONTENT_FILE = 'phoenix-content.bin';
const PHOENIX_CONTENT_BAK = 'phoenix-content.bin.bak';
const PHOENIX_DERIVED_FILE = 'phoenix-derived.bin';
const PHOENIX_DERIVED_BAK = 'phoenix-derived.bin.bak';

async function writeBinary(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
    if (data.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error(`[OPFS] Snapshot too large: ${data.byteLength} bytes (limit ${MAX_SNAPSHOT_BYTES})`);
    }
    const writable = await handle.createWritable();
    try {
        await writable.write(data as any);
        await writable.close();
    } catch (error) {
        try {
            await writable.abort();
        } catch {
            // Ignore abort failures.
        }
        throw error;
    }
}

async function appendBinary(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
        const file = await handle.getFile();
        await writable.seek(file.size);
        await writable.write(data as any);
        await writable.close();
    } catch (error) {
        try {
            await writable.abort();
        } catch {
            // Ignore abort failures.
        }
        throw error;
    }
}

async function truncateFile(handle: FileSystemFileHandle): Promise<void> {
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
        await writable.truncate(0);
        await writable.close();
    } catch (error) {
        try {
            await writable.abort();
        } catch {
            // Ignore abort failures.
        }
        throw error;
    }
}

async function readBinary(handle: FileSystemFileHandle): Promise<Uint8Array | null> {
    try {
        const file = await handle.getFile();
        if (file.size === 0) {
            return null;
        }
        return new Uint8Array(await file.arrayBuffer());
    } catch {
        return null;
    }
}

async function fileSize(handle: FileSystemFileHandle): Promise<number> {
    try {
        const file = await handle.getFile();
        return file.size;
    } catch {
        return 0;
    }
}

export class SqliteOpfsAdapter {
    private async rootDir(create = true): Promise<FileSystemDirectoryHandle> {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle(ROOT_DIR_NAME, { create });
    }

    private async tryRootDir(): Promise<FileSystemDirectoryHandle | null> {
        try {
            return await this.rootDir(false);
        } catch {
            return null;
        }
    }

    private async phoenixDir(create = true): Promise<FileSystemDirectoryHandle> {
        const root = await this.rootDir(create);
        return root.getDirectoryHandle(PHOENIX_DIR_NAME, { create });
    }

    private async tryPhoenixDir(): Promise<FileSystemDirectoryHandle | null> {
        try {
            return await this.phoenixDir(false);
        } catch {
            return null;
        }
    }

    private async relativeFileHandle(
        dir: FileSystemDirectoryHandle,
        relativePath: string,
        create: boolean,
    ): Promise<FileSystemFileHandle> {
        const segments = normalizeRelativePath(relativePath);
        if (!segments.length) {
            throw new Error(`[OPFS] Invalid file path: ${relativePath}`);
        }

        let current = dir;
        for (const segment of segments.slice(0, -1)) {
            current = await current.getDirectoryHandle(segment, { create });
        }
        return current.getFileHandle(segments[segments.length - 1], { create });
    }

    private async removeRelativePath(dir: FileSystemDirectoryHandle, relativePath: string): Promise<void> {
        const segments = normalizeRelativePath(relativePath);
        if (!segments.length) {
            return;
        }

        let current = dir;
        for (const segment of segments.slice(0, -1)) {
            current = await current.getDirectoryHandle(segment, { create: false });
        }
        await current.removeEntry(segments[segments.length - 1], { recursive: true });
    }

    private async readWithBackup(
        dir: FileSystemDirectoryHandle,
        primary: string,
        backup: string,
    ): Promise<Uint8Array | null> {
        try {
            const handle = await dir.getFileHandle(primary, { create: false });
            const data = await readBinary(handle);
            if (data) {
                return data;
            }
        } catch {
            // Missing primary.
        }

        try {
            const handle = await dir.getFileHandle(backup, { create: false });
            const data = await readBinary(handle);
            if (data) {
                console.warn(`[OPFS] Primary missing for ${primary}; recovered from backup`);
                return data;
            }
        } catch {
            // Missing backup.
        }

        return null;
    }

    private async removeIfExists(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
        try {
            await dir.removeEntry(name);
        } catch {
            // Ignore missing files.
        }
    }

    private async writeWithBackup(
        dir: FileSystemDirectoryHandle,
        primary: string,
        backup: string,
        data: Uint8Array | null | undefined,
    ): Promise<void> {
        if (!data || data.byteLength === 0) {
            await this.removeIfExists(dir, primary);
            await this.removeIfExists(dir, backup);
            return;
        }

        try {
            const current = await dir.getFileHandle(primary, { create: false });
            const currentData = await readBinary(current);
            if (currentData && currentData.byteLength > 0) {
                const backupHandle = await dir.getFileHandle(backup, { create: true });
                await writeBinary(backupHandle, currentData);
            }
        } catch {
            // No rotation target.
        }

        const handle = await dir.getFileHandle(primary, { create: true });
        await writeBinary(handle, data);
    }

    private async readPhoenixManifestCandidate(
        dir: FileSystemDirectoryHandle,
        file: string,
    ): Promise<PersistenceManifest | null> {
        try {
            const handle = await dir.getFileHandle(file, { create: false });
            const bytes = await readBinary(handle);
            if (!bytes?.byteLength) {
                return null;
            }
            return parseManifestBytes(bytes);
        } catch {
            return null;
        }
    }

    private async writePhoenixManifest(manifest: PersistenceManifest): Promise<void> {
        const dir = await this.phoenixDir();
        const bytes = manifestToJsonBytes(manifest);
        const bakHandle = await dir.getFileHandle(MANIFEST_BAK, { create: true });
        await writeBinary(bakHandle, bytes);
        const manifestHandle = await dir.getFileHandle(MANIFEST_FILE, { create: true });
        await writeBinary(manifestHandle, bytes);
    }

    private async fileBytes(dir: FileSystemDirectoryHandle, relativePath: string): Promise<Uint8Array | null> {
        try {
            const handle = await this.relativeFileHandle(dir, relativePath, false);
            return await readBinary(handle);
        } catch {
            return null;
        }
    }

    private async fileSize(dir: FileSystemDirectoryHandle, relativePath: string): Promise<number> {
        try {
            const handle = await this.relativeFileHandle(dir, relativePath, false);
            return await fileSize(handle);
        } catch {
            return 0;
        }
    }

    private async listLegacyArtifacts(dir: FileSystemDirectoryHandle): Promise<string[]> {
        const staleFiles: string[] = [];
        for (const name of [
            LEGACY_FILE,
            LEGACY_BAK,
            PHOENIX_CONTENT_FILE,
            PHOENIX_CONTENT_BAK,
            PHOENIX_DERIVED_FILE,
            PHOENIX_DERIVED_BAK,
        ]) {
            try {
                await dir.getFileHandle(name, { create: false });
                staleFiles.push(name);
            } catch {
                // Missing stale file.
            }
        }
        return staleFiles;
    }

    async load(): Promise<Uint8Array | null> {
        try {
            const dir = await this.tryRootDir();
            if (!dir) {
                return null;
            }
            const snapshot = await this.readWithBackup(dir, LEGACY_FILE, LEGACY_BAK);
            if (snapshot) {
                console.log(`[OPFS] Loaded legacy snapshot: ${snapshot.byteLength} bytes`);
                return snapshot;
            }
            return null;
        } catch (error) {
            console.error('[OPFS] Load failed:', error);
            return null;
        }
    }

    async saveSnapshot(data: Uint8Array): Promise<void> {
        const dir = await this.rootDir();
        await this.writeWithBackup(dir, LEGACY_FILE, LEGACY_BAK, data);
    }

    async loadPhoenixManifest(): Promise<LoadedPhoenixManifestState> {
        const root = await this.tryRootDir();
        const dir = await this.tryPhoenixDir();
        const staleLegacyFiles = root ? await this.listLegacyArtifacts(root) : [];
        const manifestBytes = dir ? await this.fileSize(dir, MANIFEST_FILE) : 0;
        const backupManifestBytes = dir ? await this.fileSize(dir, MANIFEST_BAK) : 0;

        if (!dir) {
            return {
                manifest: null,
                manifestBytes,
                backupManifestBytes,
                contentCheckpoint: null,
                derivedCheckpoint: null,
                closedSegments: [],
                activeSegment: null,
                staleLegacyFiles,
                recoveredFromBackup: false,
            };
        }

        let manifest = await this.readPhoenixManifestCandidate(dir, MANIFEST_FILE);
        let recoveredFromBackup = false;
        if (!manifest) {
            manifest = await this.readPhoenixManifestCandidate(dir, MANIFEST_BAK);
            recoveredFromBackup = !!manifest;
        }

        if (!manifest) {
            return {
                manifest: null,
                manifestBytes,
                backupManifestBytes,
                contentCheckpoint: null,
                derivedCheckpoint: null,
                closedSegments: [],
                activeSegment: null,
                staleLegacyFiles,
                recoveredFromBackup: false,
            };
        }

        const normalized = normalizeManifest(manifest);
        const contentCheckpoint = normalized.content.checkpointFile
            ? {
                file: normalized.content.checkpointFile,
                bytes: await this.fileSize(dir, normalized.content.checkpointFile),
            }
            : null;
        const derivedCheckpoint = normalized.derived.checkpointFile
            ? {
                file: normalized.derived.checkpointFile,
                bytes: await this.fileSize(dir, normalized.derived.checkpointFile),
            }
            : null;
        const closedSegments = await Promise.all(
            normalized.content.closedSegments.map(async (segment) => ({
                file: segment.file,
                bytes: await this.fileSize(dir, segment.file),
            })),
        );
        const activeSegmentFile = normalized.content.activeSegmentFile || PHOENIX_WAL_ACTIVE_SEGMENT_FILE;
        const activeSegmentBytes = await this.fileSize(dir, activeSegmentFile);
        const activeSegment = activeSegmentBytes > 0
            ? {
                file: activeSegmentFile,
                bytes: activeSegmentBytes,
            }
            : null;

        return {
            manifest: normalized,
            manifestBytes,
            backupManifestBytes,
            contentCheckpoint,
            derivedCheckpoint,
            closedSegments,
            activeSegment,
            staleLegacyFiles,
            recoveredFromBackup,
        };
    }

    async readPhoenixFile(relativePath: string): Promise<Uint8Array | null> {
        const dir = await this.phoenixDir();
        return this.fileBytes(dir, relativePath);
    }

    async inspectPhoenixPersistence(): Promise<PhoenixPersistenceSizeSummary> {
        const state = await this.loadPhoenixManifest();
        const closedWalBytes = state.closedSegments.reduce((sum, segment) => sum + segment.bytes, 0);
        const activeWalBytes = state.activeSegment?.bytes || 0;
        return {
            manifestBytes: state.manifestBytes,
            backupManifestBytes: state.backupManifestBytes,
            contentCheckpointBytes: state.contentCheckpoint?.bytes || 0,
            derivedCheckpointBytes: state.derivedCheckpoint?.bytes || 0,
            closedWalBytes,
            activeWalBytes,
            totalWalBytes: closedWalBytes + activeWalBytes,
        };
    }

    async inspectPhoenixPersistenceDebug(): Promise<PhoenixPersistenceDebugState> {
        const root = await this.tryRootDir();
        const dir = await this.tryPhoenixDir();
        const state = await this.loadPhoenixManifest();
        const manifestPresent = state.manifestBytes > 0 || !!state.manifest;
        const backupManifestPresent = state.backupManifestBytes > 0 || state.recoveredFromBackup;
        const hasActivePhoenixState =
            manifestPresent ||
            backupManifestPresent ||
            !!state.contentCheckpoint?.bytes ||
            !!state.derivedCheckpoint?.bytes ||
            state.closedSegments.some((segment) => segment.bytes > 0) ||
            !!state.activeSegment?.bytes;

        return {
            rootDirName: ROOT_DIR_NAME,
            phoenixDirName: PHOENIX_DIR_NAME,
            rootExists: !!root,
            phoenixDirExists: !!dir,
            manifestPresent,
            backupManifestPresent,
            manifestBytes: state.manifestBytes,
            backupManifestBytes: state.backupManifestBytes,
            contentCheckpoint: state.contentCheckpoint,
            derivedCheckpoint: state.derivedCheckpoint,
            closedSegments: state.closedSegments,
            activeSegment: state.activeSegment,
            staleLegacyFiles: state.staleLegacyFiles,
            recoveredFromBackup: state.recoveredFromBackup,
            hasActivePhoenixState,
            hasLegacyArtifactsOnly: !hasActivePhoenixState && state.staleLegacyFiles.length > 0,
        };
    }

    async appendPhoenixWalBatch(batch: PhoenixWalBatch): Promise<PhoenixWalAppendResult> {
        const dir = await this.phoenixDir();
        const encoded = encodeWalBatch(batch);
        const manifest =
            (await this.readPhoenixManifestCandidate(dir, MANIFEST_FILE)) ||
            (await this.readPhoenixManifestCandidate(dir, MANIFEST_BAK)) ||
            createEmptyPhoenixManifest();
        const handle = await this.relativeFileHandle(
            dir,
            manifest.content.activeSegmentFile || PHOENIX_WAL_ACTIVE_SEGMENT_FILE,
            true,
        );

        if (encoded.byteLength > 0) {
            await appendBinary(handle, encoded);
        }
        const file = await handle.getFile();
        return {
            activeSegmentBytes: file.size,
            activeSegmentRecordCount: manifest.content.activeSegmentRecordCount + batch.records.length,
            bytesWritten: encoded.byteLength,
        };
    }

    async commitPhoenixManifest(nextManifest: PersistenceManifest): Promise<void> {
        const dir = await this.phoenixDir();
        const current =
            (await this.readPhoenixManifestCandidate(dir, MANIFEST_FILE)) ||
            (await this.readPhoenixManifestCandidate(dir, MANIFEST_BAK));
        const normalized = normalizeManifest(nextManifest);
        const currentClosed = new Set(current?.content.closedSegments.map((segment) => segment.file) || []);
        const appendedClosed = normalized.content.closedSegments.filter((segment) => !currentClosed.has(segment.file));

        if (appendedClosed.length > 0) {
            const activeBytes = await this.fileBytes(dir, normalized.content.activeSegmentFile);
            if (activeBytes?.byteLength) {
                for (const segment of appendedClosed) {
                    const handle = await this.relativeFileHandle(dir, segment.file, true);
                    await writeBinary(handle, activeBytes);
                }
            }
        }

        await this.writePhoenixManifest(normalized);

        const shouldTruncateActive =
            appendedClosed.length > 0 ||
            (!!current?.content.activeSegmentRecordCount &&
                normalized.content.activeSegmentRecordCount === 0 &&
                normalized.content.activeSegmentBytes === 0);
        if (shouldTruncateActive) {
            try {
                const activeHandle = await this.relativeFileHandle(dir, normalized.content.activeSegmentFile, true);
                await truncateFile(activeHandle);
            } catch (error) {
                console.warn('[OPFS] Active WAL truncate failed after manifest commit; recovery will dedupe.', error);
            }
        }
    }

    async writePhoenixCheckpoint(
        partition: PhoenixCheckpointPartition,
        generation: number,
        bytes: Uint8Array,
    ): Promise<PhoenixCheckpointWriteResult> {
        const dir = await this.phoenixDir();
        const file =
            partition === 'content'
                ? `checkpoints/content-${generation}.bin`
                : `checkpoints/derived-${generation}.bin`;
        const handle = await this.relativeFileHandle(dir, file, true);
        await writeBinary(handle, bytes);
        return {
            file,
            bytes: bytes.byteLength,
            writtenAt: Date.now(),
        };
    }

    async prunePhoenixFiles(files: string[]): Promise<void> {
        const dir = await this.phoenixDir();
        for (const file of files) {
            try {
                await this.removeRelativePath(dir, file);
            } catch {
                // Ignore missing or already-pruned files.
            }
        }
    }

    async clearAll(): Promise<PhoenixPersistenceClearResult> {
        const before = await this.inspectPhoenixPersistenceDebug();
        try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(ROOT_DIR_NAME, { recursive: true });
        } catch (error) {
            console.warn('[OPFS] clearAll - directory may not exist:', error);
        }
        const after = await this.inspectPhoenixPersistenceDebug();
        return {
            before,
            after,
            cleared: !after.rootExists,
        };
    }
}

function normalizeRelativePath(relativePath: string): string[] {
    return relativePath
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => !!segment && segment !== '.' && segment !== '..');
}
