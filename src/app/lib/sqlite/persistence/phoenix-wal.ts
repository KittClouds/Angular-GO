const WAL_MAGIC = 0x50485731; // PHW1
const WAL_VERSION = 1;
const WAL_HEADER_BYTES = 32;

export const PHOENIX_WAL_SCHEMA = 'phoenix-wal-v1';
export const PHOENIX_WAL_ACTIVE_SEGMENT_FILE = 'wal/content-active.log';
export const PHOENIX_WAL_MAX_SEGMENT_BYTES = 1024 * 1024;
export const PHOENIX_WAL_MAX_SEGMENT_RECORDS = 500;
export const PHOENIX_WAL_MAX_UNRECLAIMED_BYTES = 4 * 1024 * 1024;
export const PHOENIX_WAL_MAX_UNRECLAIMED_RECORDS = 1000;
export const PHOENIX_WAL_IDLE_CHECKPOINT_MS = 30_000;
export const PHOENIX_DERIVED_CHECKPOINT_MS = 45_000;

export type PhoenixWalPartition = 'content';
export type PhoenixCheckpointPartition = 'content' | 'derived';

export interface PhoenixWalRecord {
    seq: number;
    command: string;
    payload: Record<string, unknown>;
    partition: PhoenixWalPartition;
    writtenAt: number;
}

export interface PhoenixWalBatch {
    records: PhoenixWalRecord[];
}

export interface ClosedWalSegmentMeta {
    file: string;
    startSeq: number;
    endSeq: number;
    recordCount: number;
    bytes: number;
}

export interface ContentCheckpointMeta {
    checkpointFile: string | null;
    lastCheckpointSeq: number;
    nextSeq: number;
    activeSegmentFile: string;
    activeSegmentBytes: number;
    activeSegmentRecordCount: number;
    closedSegments: ClosedWalSegmentMeta[];
}

export interface DerivedCheckpointMeta {
    checkpointFile: string | null;
    checkpointCreatedAt: number | null;
}

export interface PersistenceManifest {
    schema: typeof PHOENIX_WAL_SCHEMA;
    generation: number;
    createdAt: number;
    updatedAt: number;
    content: ContentCheckpointMeta;
    derived: DerivedCheckpointMeta;
    compaction: {
        contentInProgress: boolean;
        lastContentCompactAt: number | null;
    };
}

export interface RecoveryState {
    contentRecovered: boolean;
    derivedRecovered: boolean;
    replayedRecords: number;
    lastRecoveredSeq: number;
    manifestGeneration: number;
}

export interface PhoenixWalDecodeResult {
    records: PhoenixWalRecord[];
    bytesConsumed: number;
    tailCorrupted: boolean;
}

export interface PhoenixPersistedFileMeta {
    file: string;
    bytes: number;
}

export interface PhoenixPersistenceSizeSummary {
    manifestBytes: number;
    backupManifestBytes: number;
    contentCheckpointBytes: number;
    derivedCheckpointBytes: number;
    closedWalBytes: number;
    activeWalBytes: number;
    totalWalBytes: number;
}

export interface PhoenixPersistenceDebugState {
    rootDirName: string;
    phoenixDirName: string;
    rootExists: boolean;
    phoenixDirExists: boolean;
    manifestPresent: boolean;
    backupManifestPresent: boolean;
    manifestBytes: number;
    backupManifestBytes: number;
    contentCheckpoint: PhoenixPersistedFileMeta | null;
    derivedCheckpoint: PhoenixPersistedFileMeta | null;
    closedSegments: PhoenixPersistedFileMeta[];
    activeSegment: PhoenixPersistedFileMeta | null;
    staleLegacyFiles: string[];
    recoveredFromBackup: boolean;
    hasActivePhoenixState: boolean;
    hasLegacyArtifactsOnly: boolean;
}

export interface PhoenixPersistenceClearResult {
    before: PhoenixPersistenceDebugState;
    after: PhoenixPersistenceDebugState;
    cleared: boolean;
}

export interface LoadedPhoenixManifestState {
    manifest: PersistenceManifest | null;
    manifestBytes: number;
    backupManifestBytes: number;
    contentCheckpoint: PhoenixPersistedFileMeta | null;
    derivedCheckpoint: PhoenixPersistedFileMeta | null;
    closedSegments: PhoenixPersistedFileMeta[];
    activeSegment: PhoenixPersistedFileMeta | null;
    staleLegacyFiles: string[];
    recoveredFromBackup: boolean;
}

export interface PhoenixWalAppendResult {
    activeSegmentBytes: number;
    activeSegmentRecordCount: number;
    bytesWritten: number;
}

export interface PhoenixCheckpointWriteResult {
    file: string;
    bytes: number;
    writtenAt: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
    if (crc32Table) {
        return crc32Table;
    }
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value >>> 0;
    }
    crc32Table = table;
    return table;
}

export function crc32(bytes: Uint8Array): number {
    const table = getCrc32Table();
    let value = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
        value = table[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
}

export function createEmptyPhoenixManifest(now = Date.now()): PersistenceManifest {
    return {
        schema: PHOENIX_WAL_SCHEMA,
        generation: 0,
        createdAt: now,
        updatedAt: now,
        content: {
            checkpointFile: null,
            lastCheckpointSeq: 0,
            nextSeq: 1,
            activeSegmentFile: PHOENIX_WAL_ACTIVE_SEGMENT_FILE,
            activeSegmentBytes: 0,
            activeSegmentRecordCount: 0,
            closedSegments: [],
        },
        derived: {
            checkpointFile: null,
            checkpointCreatedAt: null,
        },
        compaction: {
            contentInProgress: false,
            lastContentCompactAt: null,
        },
    };
}

export function cloneManifest(manifest: PersistenceManifest): PersistenceManifest {
    return JSON.parse(JSON.stringify(manifest)) as PersistenceManifest;
}

export function normalizeManifest(input: unknown): PersistenceManifest {
    const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const now = Date.now();
    const manifest = createEmptyPhoenixManifest(
        typeof record['createdAt'] === 'number' ? Number(record['createdAt']) : now,
    );
    if (record['schema'] !== PHOENIX_WAL_SCHEMA) {
        throw new Error(`Unsupported Phoenix WAL schema: ${String(record['schema'] || '')}`);
    }

    manifest.generation = asNumber(record['generation'], 0);
    manifest.updatedAt = asNumber(record['updatedAt'], manifest.createdAt);

    const content = asRecord(record['content']);
    manifest.content.checkpointFile = asOptionalString(content['checkpointFile']);
    manifest.content.lastCheckpointSeq = asNumber(content['lastCheckpointSeq'], 0);
    manifest.content.nextSeq = Math.max(1, asNumber(content['nextSeq'], 1));
    manifest.content.activeSegmentFile =
        asOptionalString(content['activeSegmentFile']) || PHOENIX_WAL_ACTIVE_SEGMENT_FILE;
    manifest.content.activeSegmentBytes = asNumber(content['activeSegmentBytes'], 0);
    manifest.content.activeSegmentRecordCount = asNumber(content['activeSegmentRecordCount'], 0);
    manifest.content.closedSegments = Array.isArray(content['closedSegments'])
        ? content['closedSegments']
              .map((entry) => normalizeClosedSegment(entry))
              .filter((entry): entry is ClosedWalSegmentMeta => !!entry)
              .sort((left, right) => left.startSeq - right.startSeq)
        : [];

    const derived = asRecord(record['derived']);
    manifest.derived.checkpointFile = asOptionalString(derived['checkpointFile']);
    manifest.derived.checkpointCreatedAt =
        derived['checkpointCreatedAt'] === null || derived['checkpointCreatedAt'] === undefined
            ? null
            : asNumber(derived['checkpointCreatedAt'], null);

    const compaction = asRecord(record['compaction']);
    manifest.compaction.contentInProgress = Boolean(compaction['contentInProgress']);
    manifest.compaction.lastContentCompactAt =
        compaction['lastContentCompactAt'] === null || compaction['lastContentCompactAt'] === undefined
            ? null
            : asNumber(compaction['lastContentCompactAt'], null);

    return manifest;
}

export function manifestToJsonBytes(manifest: PersistenceManifest): Uint8Array {
    return textEncoder.encode(JSON.stringify(manifest, null, 2));
}

export function parseManifestBytes(bytes: Uint8Array): PersistenceManifest {
    return normalizeManifest(JSON.parse(textDecoder.decode(bytes)));
}

export function encodeWalRecord(record: PhoenixWalRecord): Uint8Array {
    const payloadBytes = textEncoder.encode(JSON.stringify(record));
    const bytes = new Uint8Array(WAL_HEADER_BYTES + payloadBytes.byteLength);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(0, WAL_MAGIC, true);
    view.setUint32(4, WAL_VERSION, true);
    view.setFloat64(8, record.seq, true);
    view.setFloat64(16, record.writtenAt, true);
    view.setUint32(24, payloadBytes.byteLength, true);
    view.setUint32(28, crc32(payloadBytes), true);
    bytes.set(payloadBytes, WAL_HEADER_BYTES);
    return bytes;
}

export function encodeWalBatch(batch: PhoenixWalBatch): Uint8Array {
    if (!batch.records.length) {
        return new Uint8Array(0);
    }
    const encoded = batch.records.map(encodeWalRecord);
    const totalBytes = encoded.reduce((sum, record) => sum + record.byteLength, 0);
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const record of encoded) {
        bytes.set(record, offset);
        offset += record.byteLength;
    }
    return bytes;
}

export function decodeWalBytes(
    bytes: Uint8Array,
    options: {
        maxSeqExclusive?: number;
    } = {},
): PhoenixWalDecodeResult {
    const records: PhoenixWalRecord[] = [];
    let offset = 0;
    let tailCorrupted = false;

    while (offset + WAL_HEADER_BYTES <= bytes.byteLength) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, WAL_HEADER_BYTES);
        const magic = view.getUint32(0, true);
        const version = view.getUint32(4, true);
        if (magic !== WAL_MAGIC || version !== WAL_VERSION) {
            tailCorrupted = true;
            break;
        }

        const seq = view.getFloat64(8, true);
        const writtenAt = view.getFloat64(16, true);
        const payloadLen = view.getUint32(24, true);
        const payloadCrc = view.getUint32(28, true);
        const recordEnd = offset + WAL_HEADER_BYTES + payloadLen;
        if (recordEnd > bytes.byteLength) {
            tailCorrupted = true;
            break;
        }

        const payloadBytes = bytes.slice(offset + WAL_HEADER_BYTES, recordEnd);
        if (crc32(payloadBytes) !== payloadCrc) {
            tailCorrupted = true;
            break;
        }

        let record: PhoenixWalRecord;
        try {
            record = JSON.parse(textDecoder.decode(payloadBytes)) as PhoenixWalRecord;
        } catch {
            tailCorrupted = true;
            break;
        }

        if (
            typeof record?.command !== 'string' ||
            !record?.payload ||
            record?.partition !== 'content' ||
            typeof record?.seq !== 'number'
        ) {
            tailCorrupted = true;
            break;
        }

        if (record.seq !== seq) {
            tailCorrupted = true;
            break;
        }

        record.writtenAt = typeof record.writtenAt === 'number' ? record.writtenAt : writtenAt;
        if (record.seq < 1 || !Number.isFinite(record.seq) || !Number.isFinite(record.writtenAt)) {
            tailCorrupted = true;
            break;
        }

        if (options.maxSeqExclusive !== undefined && record.seq >= options.maxSeqExclusive) {
            offset = recordEnd;
            continue;
        }

        records.push(record);
        offset = recordEnd;
    }

    return {
        records,
        bytesConsumed: offset,
        tailCorrupted,
    };
}

export function segmentFileName(startSeq: number, endSeq: number): string {
    return `wal/content-${startSeq}-${endSeq}.log`;
}

export function contentCheckpointFileName(generation: number): string {
    return `checkpoints/content-${generation}.bin`;
}

export function derivedCheckpointFileName(generation: number): string {
    return `checkpoints/derived-${generation}.bin`;
}

export function nextManifestWithWalAppend(
    manifest: PersistenceManifest,
    batch: PhoenixWalBatch,
    append: PhoenixWalAppendResult,
): PersistenceManifest {
    const next = cloneManifest(manifest);
    next.updatedAt = Date.now();
    next.content.nextSeq = manifest.content.nextSeq + batch.records.length;
    next.content.activeSegmentBytes = append.activeSegmentBytes;
    next.content.activeSegmentRecordCount = append.activeSegmentRecordCount;

    if (shouldRollActiveSegment(next)) {
        const startSeq = next.content.nextSeq - next.content.activeSegmentRecordCount;
        const endSeq = next.content.nextSeq - 1;
        if (startSeq > 0 && endSeq >= startSeq) {
            next.content.closedSegments = [
                ...next.content.closedSegments,
                {
                    file: segmentFileName(startSeq, endSeq),
                    startSeq,
                    endSeq,
                    recordCount: next.content.activeSegmentRecordCount,
                    bytes: next.content.activeSegmentBytes,
                },
            ];
            next.content.activeSegmentBytes = 0;
            next.content.activeSegmentRecordCount = 0;
        }
    }

    return next;
}

export function finalizeContentCheckpointManifest(
    manifest: PersistenceManifest,
    checkpointFile: string,
    lastCheckpointSeq: number,
): {
    manifest: PersistenceManifest;
    pruneFiles: string[];
} {
    const next = cloneManifest(manifest);
    const staleFiles: string[] = [];
    if (next.content.checkpointFile && next.content.checkpointFile !== checkpointFile) {
        staleFiles.push(next.content.checkpointFile);
    }
    next.generation += 1;
    next.updatedAt = Date.now();
    next.content.checkpointFile = checkpointFile;
    next.content.lastCheckpointSeq = lastCheckpointSeq;
    next.content.activeSegmentBytes = 0;
    next.content.activeSegmentRecordCount = 0;
    next.compaction.contentInProgress = false;
    next.compaction.lastContentCompactAt = next.updatedAt;

    const retainedSegments = next.content.closedSegments.filter((segment) => segment.endSeq > lastCheckpointSeq);
    for (const segment of next.content.closedSegments) {
        if (segment.endSeq <= lastCheckpointSeq) {
            staleFiles.push(segment.file);
        }
    }
    next.content.closedSegments = retainedSegments;

    return {
        manifest: next,
        pruneFiles: Array.from(new Set(staleFiles)),
    };
}

export function finalizeDerivedCheckpointManifest(
    manifest: PersistenceManifest,
    checkpointFile: string,
    writtenAt = Date.now(),
): {
    manifest: PersistenceManifest;
    pruneFiles: string[];
} {
    const next = cloneManifest(manifest);
    const staleFiles: string[] = [];
    if (next.derived.checkpointFile && next.derived.checkpointFile !== checkpointFile) {
        staleFiles.push(next.derived.checkpointFile);
    }
    next.generation += 1;
    next.updatedAt = writtenAt;
    next.derived.checkpointFile = checkpointFile;
    next.derived.checkpointCreatedAt = writtenAt;
    return {
        manifest: next,
        pruneFiles: staleFiles,
    };
}

export function contentWalStats(manifest: PersistenceManifest): { bytes: number; records: number } {
    const closed = manifest.content.closedSegments.reduce(
        (accumulator, segment) => ({
            bytes: accumulator.bytes + segment.bytes,
            records: accumulator.records + segment.recordCount,
        }),
        { bytes: 0, records: 0 },
    );
    return {
        bytes: closed.bytes + manifest.content.activeSegmentBytes,
        records: closed.records + manifest.content.activeSegmentRecordCount,
    };
}

export function shouldRollActiveSegment(manifest: PersistenceManifest): boolean {
    return (
        manifest.content.activeSegmentBytes >= PHOENIX_WAL_MAX_SEGMENT_BYTES ||
        manifest.content.activeSegmentRecordCount >= PHOENIX_WAL_MAX_SEGMENT_RECORDS
    );
}

export function shouldCheckpointContent(manifest: PersistenceManifest): boolean {
    const stats = contentWalStats(manifest);
    return (
        stats.bytes >= PHOENIX_WAL_MAX_UNRECLAIMED_BYTES ||
        stats.records >= PHOENIX_WAL_MAX_UNRECLAIMED_RECORDS
    );
}

export function collectManifestFiles(manifest: PersistenceManifest): string[] {
    const files = new Set<string>(['manifest.json', 'manifest.bak', manifest.content.activeSegmentFile]);
    if (manifest.content.checkpointFile) {
        files.add(manifest.content.checkpointFile);
    }
    if (manifest.derived.checkpointFile) {
        files.add(manifest.derived.checkpointFile);
    }
    for (const segment of manifest.content.closedSegments) {
        files.add(segment.file);
    }
    return Array.from(files);
}

function normalizeClosedSegment(entry: unknown): ClosedWalSegmentMeta | null {
    const record = asRecord(entry);
    const file = asOptionalString(record['file']);
    if (!file) {
        return null;
    }
    const startSeq = asNumber(record['startSeq'], 0);
    const endSeq = asNumber(record['endSeq'], 0);
    const recordCount = asNumber(record['recordCount'], 0);
    const bytes = asNumber(record['bytes'], 0);
    if (startSeq < 1 || endSeq < startSeq || recordCount < 0 || bytes < 0) {
        return null;
    }
    return { file, startSeq, endSeq, recordCount, bytes };
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback: any): any {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
