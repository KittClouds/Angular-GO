import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PACKET_KIND = {
    initRuntimeRequest: 2,
    createSessionRequest: 4,
    ingestRequest: 10,
    queryRequest: 12,
    snapshotExportRequest: 14,
    snapshotImportRequest: 16,
    scanRequest: 17,
    structureRequest: 19,
    graphDeltaRequest: 21,
    sessionStateRequest: 23,
    sessionStatsRequest: 25,
    analyzeTextRequest: 27,
    queryBinaryRequest: 29,
    analyzeTextBinaryRequest: 30,
    ingestBinaryRequest: 31,
    scanBinaryRequest: 32,
    structureBinaryRequest: 33,
} as const;

const REQUEST_FLAG_COMMIT = 1 << 0;
const REQUEST_FLAG_TARGET_CHUNKS = 1 << 8;
const REQUEST_FLAG_TARGET_NODES = 1 << 9;
const REQUEST_FLAG_TARGET_GRAPH = 1 << 10;
const REQUEST_FLAG_TARGET_SEMANTIC = 1 << 11;
const REQUEST_LAYOUT_VERSION = 1;

type WasmExports = {
    memory: WebAssembly.Memory;
    phoenix_alloc: (size: number) => number;
    phoenix_dealloc: (ptr: number, capacity: number) => void;
    phoenix_process_packet_at: (offset: number, capacity: number) => number;
    phoenix_packet_header_size: () => number;
    phoenix_wasm_protocol_version: () => number;
};

type BinaryHeader = {
    version: number;
    flags: number;
    sessionOffset: number;
    sessionLen: number;
    table1Offset: number;
    table1Count: number;
    table2Offset: number;
    table2Count: number;
    table3Offset: number;
    table3Count: number;
    table4Offset: number;
    table4Count: number;
    arenaOffset: number;
    arenaLen: number;
};

export type QueryBinaryResult = {
    sessionId: string;
    chunkHits: Array<{ chunkId: string; score: number }>;
    nodeHits: Array<{ entityId: string; score: number }>;
    diagnostics: Array<{ code: string; message: string }>;
};

export type GraphDeltaBinaryResult = {
    sessionId: string;
    chunks: Array<{
        vertexId: string;
        chunkId: string;
        documentId: string;
        noteId?: string;
        chapterId: number;
        start: number;
        end: number;
    }>;
    nodes: Array<{
        nodeId: string;
        kind: string;
        label: string;
        entityId?: string;
        documentId?: string;
        chapterId?: number;
        weight: number;
    }>;
    edges: Array<{ sourceId: string; targetId: string; edgeType: string; weight: number }>;
    diagnostics: Array<{ code: string; message: string }>;
};

export type SessionStateBinaryResult = {
    sessionId: string;
    documents: Array<{
        documentId: string;
        noteId?: string;
        chapterTitles: string[];
        chapterCount: number;
        parentCount: number;
        leafCount: number;
        entityCount: number;
        discoveryCount: number;
        hasFrontMatterChapter: boolean;
        updatedAt: number;
    }>;
    manifestNamespaces: string[];
};

export type SessionStatsBinaryResult = {
    sessionId: string;
    documentCount: number;
    chapterCount: number;
    parentCount: number;
    leafCount: number;
    entityCount: number;
    discoveryCandidateCount: number;
    graphVertexCount: number;
    graphEdgeCount: number;
    spanCount: number;
    updatedAt: number;
};

export class PhoenixWasmHarness {
    private readonly exports: WasmExports;
    private readonly encoder = new TextEncoder();
    private readonly decoder = new TextDecoder();
    private requestId = 1;

    private constructor(exports: WasmExports) {
        this.exports = exports;
    }

    static async create(options?: { release?: boolean }): Promise<PhoenixWasmHarness> {
        const release = options?.release ?? false;
        ensurePhoenixWasmBuilt(release);
        const wasmPath = path.join(
            workspaceRoot(),
            'rust',
            'phoenix',
            'target',
            'wasm32-unknown-unknown',
            release ? 'release' : 'debug',
            'phoenix_wasm.wasm',
        );
        const moduleBytes = readFileSync(wasmPath);
        const { instance } = await WebAssembly.instantiate(moduleBytes, createImportObject());
        return new PhoenixWasmHarness(instance.exports as unknown as WasmExports);
    }

    protocolVersion(): number {
        return this.exports.phoenix_wasm_protocol_version();
    }

    memoryByteLength(): number {
        return this.exports.memory.buffer.byteLength;
    }

    memoryPageCount(): number {
        return this.memoryByteLength() / 65_536;
    }

    initRuntime(): any {
        return this.sendJson(PACKET_KIND.initRuntimeRequest, {
            config: {
                target: 'wasm',
                storage: 'cozoMem',
                snapshotPolicy: 'manual',
                featureFlags: {
                    scanner: true,
                    structure: true,
                    graptor: true,
                    gldr: true,
                    semantic: false,
                },
            },
            storagePath: null,
            forceReset: false,
        }).json;
    }

    createSession(label: string): any {
        return this.sendJson(PACKET_KIND.createSessionRequest, {
            sessionId: null,
            label,
            scope: {},
        }).json;
    }

    scan(text: string, sessionId = 'scan-worker'): any {
        return this.scanJson(text, sessionId);
    }

    scanJson(text: string, sessionId = 'scan-worker'): any {
        return this.sendJson(PACKET_KIND.scanRequest, {
            text,
            scope: {},
            sessionId,
            resolverSeed: [],
        }).json;
    }

    scanBinary(text: string, sessionId = 'scan-worker'): any {
        return this.sendBytes(
            PACKET_KIND.scanBinaryRequest,
            encodeScanBinaryPayload({
                text,
                scope: {},
                sessionId,
                resolverSeed: [],
            }),
        ).json;
    }

    analyzeText(text: string, capacityHint?: number): any {
        return this.analyzeTextBinary(text, capacityHint);
    }

    analyzeTextJson(text: string, capacityHint?: number): any {
        return this.sendJson(PACKET_KIND.analyzeTextRequest, { text }, capacityHint).json;
    }

    analyzeTextBinary(text: string, capacityHint?: number): any {
        return this.sendBytes(
            PACKET_KIND.analyzeTextBinaryRequest,
            encodeAnalyzeTextBinaryPayload(text),
            capacityHint,
        ).json;
    }

    ingest(sessionId: string, documentId: string, title: string, text: string): any {
        return this.ingestBinary(sessionId, documentId, title, text);
    }

    ingestJson(sessionId: string, documentId: string, title: string, text: string): any {
        return this.sendJson(PACKET_KIND.ingestRequest, {
            sessionId,
            documents: [{ documentId, noteId: null, title, text, scope: {} }],
            commit: false,
        }).json;
    }

    ingestBinary(sessionId: string, documentId: string, title: string, text: string): any {
        return this.sendBytes(
            PACKET_KIND.ingestBinaryRequest,
            encodeIngestBinaryPayload({
                sessionId,
                documents: [{ documentId, noteId: null, title, text, scope: {} }],
                commit: false,
            }),
        ).json;
    }

    queryBinary(
        sessionId: string,
        query: string,
        options?: { targets?: string[]; limit?: number; capacityHint?: number },
    ): QueryBinaryResult {
        return this.queryBinaryRequest(sessionId, query, options);
    }

    queryBinaryJson(
        sessionId: string,
        query: string,
        options?: { targets?: string[]; limit?: number; capacityHint?: number },
    ): QueryBinaryResult {
        const payload = this.sendJson(
            PACKET_KIND.queryRequest,
            {
                sessionId,
                query,
                scope: {},
                targets: options?.targets ?? ['chunks'],
                limit: options?.limit ?? 5,
                temporal: null,
            },
            options?.capacityHint,
        ).bytes;
        return decodeQueryResult(payload);
    }

    queryBinaryRequest(
        sessionId: string,
        query: string,
        options?: { targets?: string[]; limit?: number; capacityHint?: number },
    ): QueryBinaryResult {
        const payload = this.sendBytes(
            PACKET_KIND.queryBinaryRequest,
            encodeQueryBinaryPayload({
                sessionId,
                query,
                scope: {},
                targets: options?.targets ?? ['chunks'],
                limit: options?.limit ?? 5,
                temporal: null,
            }),
            options?.capacityHint,
        ).bytes;
        return decodeQueryResult(payload);
    }

    structure(text: string, scan: any): any {
        return this.structureBinary(text, scan);
    }

    structureJson(text: string, scan: any): any {
        return this.sendJson(PACKET_KIND.structureRequest, { text, scan }).json;
    }

    structureBinary(text: string, scan: any): any {
        return this.sendBytes(
            PACKET_KIND.structureBinaryRequest,
            encodeStructureBinaryPayload(text, scan),
        ).json;
    }

    graphDeltaBinary(
        sessionId: string,
        documentId: string,
        options?: { limit?: number | null; capacityHint?: number },
    ): GraphDeltaBinaryResult {
        const payload = this.sendJson(
            PACKET_KIND.graphDeltaRequest,
            {
                sessionId,
                scope: {},
                changedDocuments: [documentId],
                limit: options?.limit === undefined ? 16 : options.limit,
                sinceCommit: null,
            },
            options?.capacityHint,
        ).bytes;
        return decodeGraphDeltaResult(payload);
    }

    sessionStateBinary(sessionId: string, capacityHint?: number): SessionStateBinaryResult {
        const payload = this.sendJson(PACKET_KIND.sessionStateRequest, { sessionId }, capacityHint).bytes;
        return decodeSessionStateResult(payload);
    }

    sessionStatsBinary(sessionId: string, capacityHint?: number): SessionStatsBinaryResult {
        const payload = this.sendJson(PACKET_KIND.sessionStatsRequest, { sessionId }, capacityHint).bytes;
        return decodeSessionStatsResult(payload);
    }

    exportSnapshot(capacityHint?: number): Uint8Array {
        return this.sendJson(PACKET_KIND.snapshotExportRequest, undefined, capacityHint).bytes;
    }

    importSnapshot(snapshot: Uint8Array, capacityHint?: number): any {
        return this.sendBytes(16, snapshot, capacityHint).json;
    }

    private sendJson(
        kind: number,
        payload: unknown,
        capacityHint?: number,
    ): { kind: number; bytes: Uint8Array; json?: any } {
        const payloadBytes = payload === undefined ? new Uint8Array() : this.encoder.encode(JSON.stringify(payload));
        return this.sendBytes(kind, payloadBytes, capacityHint);
    }

    private sendBytes(
        kind: number,
        payload: Uint8Array,
        capacityHint?: number,
    ): { kind: number; bytes: Uint8Array; json?: any } {
        const packetHeaderSize = this.exports.phoenix_packet_header_size();
        const capacity = Math.max(
            capacityHint ?? 128 * 1024,
            packetHeaderSize + payload.byteLength + 1024,
        );
        const ptr = this.exports.phoenix_alloc(capacity);
        let memory = new Uint8Array(this.exports.memory.buffer);
        let view = new DataView(this.exports.memory.buffer);

        memory.fill(0, ptr, ptr + capacity);
        view.setUint32(ptr + 0, 1, true);
        view.setUint32(ptr + 4, kind, true);
        view.setUint32(ptr + 8, this.requestId++, true);
        view.setUint32(ptr + 12, payload.byteLength, true);
        memory.set(payload, ptr + packetHeaderSize);

        const rc = this.exports.phoenix_process_packet_at(ptr, capacity);
        if (rc !== 0) {
            this.exports.phoenix_dealloc(ptr, capacity);
            throw new Error(`phoenix_process_packet_at failed with rc=${rc}`);
        }

        memory = new Uint8Array(this.exports.memory.buffer);
        view = new DataView(this.exports.memory.buffer);
        const outKind = view.getUint32(ptr + 4, true);
        const outLen = view.getUint32(ptr + 12, true);
        const bytes = memory.slice(ptr + packetHeaderSize, ptr + packetHeaderSize + outLen);
        this.exports.phoenix_dealloc(ptr, capacity);

        let json: any | undefined;
        if (![13, 22, 24, 26].includes(outKind)) {
            const decoded = this.decoder.decode(bytes);
            if (decoded.trimStart().startsWith('{')) {
                json = JSON.parse(decoded);
            }
        }
        return { kind: outKind, bytes, json };
    }
}

function workspaceRoot(): string {
    return process.cwd();
}

function ensurePhoenixWasmBuilt(release = false): void {
    const args = ['build', '--target', 'wasm32-unknown-unknown', '-p', 'phoenix-wasm', '-j', '1'];
    if (release) {
        args.splice(1, 0, '--release');
    }
    const env = { ...process.env };
    if (release) {
        env.RUSTFLAGS = `${env.RUSTFLAGS ?? ''} -C target-feature=+simd128`.trim();
    }
    execFileSync('cargo', args, {
        cwd: path.join(workspaceRoot(), 'rust', 'phoenix'),
        stdio: 'inherit',
        env,
    });
    if (release) {
        const wasmPath = path.join(
            workspaceRoot(),
            'rust',
            'phoenix',
            'target',
            'wasm32-unknown-unknown',
            'release',
            'phoenix_wasm.wasm',
        );
        optimizeWasmBinary(wasmPath);
    }
}

function optimizeWasmBinary(wasmPath: string): void {
    try {
        execFileSync('wasm-opt', ['--version'], { stdio: 'ignore' });
    } catch {
        return;
    }
    execFileSync('wasm-opt', ['-O4', wasmPath, '-o', wasmPath], {
        stdio: 'inherit',
    });
}

function createImportObject(): Record<string, Record<string, (...args: any[]) => any>> {
    return new Proxy(
        {},
        {
            get(_target, moduleName: string) {
                return new Proxy(
                    {},
                    {
                        get(_innerTarget, importName: string) {
                            if (moduleName === '__wbindgen_externref_xform__') {
                                if (importName === '__wbindgen_externref_table_grow') {
                                    return () => 0;
                                }
                                if (importName === '__wbindgen_externref_table_set_null') {
                                    return () => {};
                                }
                            }
                            return (..._args: any[]) => {
                                if (importName.includes('now')) {
                                    return Date.now();
                                }
                                return 0;
                            };
                        },
                    },
                );
            },
        },
    ) as Record<string, Record<string, (...args: any[]) => any>>;
}

type ScopePayload = {
    worldId?: string | null;
    narrativeId?: string | null;
    folderId?: string | null;
    folderPath?: string | null;
};

class StringArenaBuilder {
    private readonly encoder = new TextEncoder();
    private readonly chunks: Uint8Array[] = [];
    private length = 0;

    add(value?: string | null): { offset: number; len: number } {
        if (!value) {
            return { offset: 0, len: 0 };
        }
        const bytes = this.encoder.encode(value);
        const offset = this.length;
        this.length += bytes.length;
        this.chunks.push(bytes);
        return { offset, len: bytes.length };
    }

    finish(): Uint8Array {
        const arena = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
            arena.set(chunk, offset);
            offset += chunk.length;
        }
        return arena;
    }
}

function targetFlags(targets: string[]): number {
    let flags = 0;
    for (const target of targets) {
        switch (target) {
            case 'chunks':
                flags |= REQUEST_FLAG_TARGET_CHUNKS;
                break;
            case 'nodes':
                flags |= REQUEST_FLAG_TARGET_NODES;
                break;
            case 'graph':
                flags |= REQUEST_FLAG_TARGET_GRAPH;
                break;
            case 'semantic':
                flags |= REQUEST_FLAG_TARGET_SEMANTIC;
                break;
        }
    }
    return flags;
}

function encodeQueryBinaryPayload(input: {
    sessionId?: string | null;
    query: string;
    scope: ScopePayload;
    targets: string[];
    limit?: number | null;
    temporal?: unknown;
}): Uint8Array {
    const arena = new StringArenaBuilder();
    const session = arena.add(input.sessionId ?? null);
    const query = arena.add(input.query);
    const world = arena.add(input.scope.worldId ?? null);
    const narrative = arena.add(input.scope.narrativeId ?? null);
    const folderId = arena.add(input.scope.folderId ?? null);
    const folderPath = arena.add(input.scope.folderPath ?? null);
    const temporal = arena.add(input.temporal ? JSON.stringify(input.temporal) : null);
    const arenaBytes = arena.finish();
    const headerSize = 19 * 4;
    const bytes = new Uint8Array(headerSize + arenaBytes.length);
    const view = new DataView(bytes.buffer);
    [
        REQUEST_LAYOUT_VERSION,
        targetFlags(input.targets),
        session.offset,
        session.len,
        query.offset,
        query.len,
        world.offset,
        world.len,
        narrative.offset,
        narrative.len,
        folderId.offset,
        folderId.len,
        folderPath.offset,
        folderPath.len,
        input.limit ?? 0xffffffff,
        temporal.offset,
        temporal.len,
        headerSize,
        arenaBytes.length,
    ].forEach((value, index) => view.setUint32(index * 4, value >>> 0, true));
    bytes.set(arenaBytes, headerSize);
    return bytes;
}

function encodeAnalyzeTextBinaryPayload(text: string): Uint8Array {
    const arena = new StringArenaBuilder();
    const textRef = arena.add(text);
    const arenaBytes = arena.finish();
    const headerSize = 6 * 4;
    const bytes = new Uint8Array(headerSize + arenaBytes.length);
    const view = new DataView(bytes.buffer);
    [
        REQUEST_LAYOUT_VERSION,
        0,
        textRef.offset,
        textRef.len,
        headerSize,
        arenaBytes.length,
    ].forEach((value, index) => view.setUint32(index * 4, value >>> 0, true));
    bytes.set(arenaBytes, headerSize);
    return bytes;
}

function encodeIngestBinaryPayload(input: {
    sessionId?: string | null;
    documents: Array<{
        documentId: string;
        noteId?: string | null;
        title: string;
        text: string;
        scope: ScopePayload;
    }>;
    commit: boolean;
}): Uint8Array {
    const arena = new StringArenaBuilder();
    const session = arena.add(input.sessionId ?? null);
    const records = input.documents.map((document) => ({
        documentId: arena.add(document.documentId),
        noteId: arena.add(document.noteId ?? null),
        title: arena.add(document.title),
        text: arena.add(document.text),
        world: arena.add(document.scope.worldId ?? null),
        narrative: arena.add(document.scope.narrativeId ?? null),
        folderId: arena.add(document.scope.folderId ?? null),
        folderPath: arena.add(document.scope.folderPath ?? null),
    }));
    const arenaBytes = arena.finish();
    const headerSize = 8 * 4;
    const recordSize = 17 * 4;
    const tableOffset = headerSize;
    const arenaOffset = tableOffset + records.length * recordSize;
    const bytes = new Uint8Array(arenaOffset + arenaBytes.length);
    const view = new DataView(bytes.buffer);
    [
        REQUEST_LAYOUT_VERSION,
        input.commit ? REQUEST_FLAG_COMMIT : 0,
        session.offset,
        session.len,
        tableOffset,
        records.length,
        arenaOffset,
        arenaBytes.length,
    ].forEach((value, index) => view.setUint32(index * 4, value >>> 0, true));
    records.forEach((record, index) => {
        const base = tableOffset + index * recordSize;
        [
            record.documentId.offset,
            record.documentId.len,
            record.noteId.offset,
            record.noteId.len,
            record.title.offset,
            record.title.len,
            record.text.offset,
            record.text.len,
            record.world.offset,
            record.world.len,
            record.narrative.offset,
            record.narrative.len,
            record.folderId.offset,
            record.folderId.len,
            record.folderPath.offset,
            record.folderPath.len,
            0,
        ].forEach((value, fieldIndex) => view.setUint32(base + fieldIndex * 4, value >>> 0, true));
    });
    bytes.set(arenaBytes, arenaOffset);
    return bytes;
}

function encodeScanBinaryPayload(input: {
    text: string;
    scope: ScopePayload;
    sessionId?: string | null;
    resolverSeed: unknown[];
}): Uint8Array {
    const arena = new StringArenaBuilder();
    const session = arena.add(input.sessionId ?? null);
    const text = arena.add(input.text);
    const world = arena.add(input.scope.worldId ?? null);
    const narrative = arena.add(input.scope.narrativeId ?? null);
    const folderId = arena.add(input.scope.folderId ?? null);
    const folderPath = arena.add(input.scope.folderPath ?? null);
    const resolverSeed = arena.add(JSON.stringify(input.resolverSeed));
    const arenaBytes = arena.finish();
    const headerSize = 18 * 4;
    const bytes = new Uint8Array(headerSize + arenaBytes.length);
    const view = new DataView(bytes.buffer);
    [
        REQUEST_LAYOUT_VERSION,
        0,
        session.offset,
        session.len,
        text.offset,
        text.len,
        world.offset,
        world.len,
        narrative.offset,
        narrative.len,
        folderId.offset,
        folderId.len,
        folderPath.offset,
        folderPath.len,
        resolverSeed.offset,
        resolverSeed.len,
        headerSize,
        arenaBytes.length,
    ].forEach((value, index) => view.setUint32(index * 4, value >>> 0, true));
    bytes.set(arenaBytes, headerSize);
    return bytes;
}

function encodeStructureBinaryPayload(text: string, scan: unknown): Uint8Array {
    const arena = new StringArenaBuilder();
    const textRef = arena.add(text);
    const scanRef = arena.add(JSON.stringify(scan));
    const arenaBytes = arena.finish();
    const headerSize = 8 * 4;
    const bytes = new Uint8Array(headerSize + arenaBytes.length);
    const view = new DataView(bytes.buffer);
    [
        REQUEST_LAYOUT_VERSION,
        0,
        textRef.offset,
        textRef.len,
        scanRef.offset,
        scanRef.len,
        headerSize,
        arenaBytes.length,
    ].forEach((value, index) => view.setUint32(index * 4, value >>> 0, true));
    bytes.set(arenaBytes, headerSize);
    return bytes;
}

function decodeBinaryHeader(view: DataView): BinaryHeader {
    return {
        version: view.getUint32(0, true),
        flags: view.getUint32(4, true),
        sessionOffset: view.getUint32(8, true),
        sessionLen: view.getUint32(12, true),
        table1Offset: view.getUint32(16, true),
        table1Count: view.getUint32(20, true),
        table2Offset: view.getUint32(24, true),
        table2Count: view.getUint32(28, true),
        table3Offset: view.getUint32(32, true),
        table3Count: view.getUint32(36, true),
        table4Offset: view.getUint32(40, true),
        table4Count: view.getUint32(44, true),
        arenaOffset: view.getUint32(48, true),
        arenaLen: view.getUint32(52, true),
    };
}

function readArenaString(bytes: Uint8Array, arenaOffset: number, stringOffset: number, stringLen: number): string {
    const decoder = new TextDecoder();
    return decoder.decode(bytes.slice(arenaOffset + stringOffset, arenaOffset + stringOffset + stringLen));
}

function decodeQueryResult(bytes: Uint8Array): QueryBinaryResult {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = decodeBinaryHeader(view);
    const sessionId = readArenaString(bytes, header.arenaOffset, header.sessionOffset, header.sessionLen);
    const chunkHits = Array.from({ length: header.table1Count }, (_, index) => {
        const base = header.table1Offset + index * 16;
        return {
            chunkId: readArenaString(bytes, header.arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true)),
            score: view.getFloat64(base + 8, true),
        };
    });
    const nodeHits = Array.from({ length: header.table2Count }, (_, index) => {
        const base = header.table2Offset + index * 16;
        return {
            entityId: readArenaString(bytes, header.arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true)),
            score: view.getFloat64(base + 8, true),
        };
    });
    const diagnostics = decodeDiagnostics(bytes, view, header.table3Offset, header.table3Count, header.arenaOffset);
    return { sessionId, chunkHits, nodeHits, diagnostics };
}

function decodeGraphDeltaResult(bytes: Uint8Array): GraphDeltaBinaryResult {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = decodeBinaryHeader(view);
    const sessionId = readArenaString(bytes, header.arenaOffset, header.sessionOffset, header.sessionLen);
    const chunks = Array.from({ length: header.table1Count }, (_, index) => {
        const base = header.table1Offset + index * 48;
        return {
            vertexId: readArenaString(bytes, header.arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true)),
            chunkId: readArenaString(bytes, header.arenaOffset, view.getUint32(base + 8, true), view.getUint32(base + 12, true)),
            documentId: readArenaString(bytes, header.arenaOffset, view.getUint32(base + 16, true), view.getUint32(base + 20, true)),
            noteId:
                view.getUint32(base + 28, true) > 0
                    ? readArenaString(bytes, header.arenaOffset, view.getUint32(base + 24, true), view.getUint32(base + 28, true))
                    : undefined,
            chapterId: view.getUint32(base + 32, true),
            start: view.getUint32(base + 36, true),
            end: view.getUint32(base + 40, true),
        };
    });
    const nodes = Array.from({ length: header.table2Count }, (_, index) => {
        const base = header.table2Offset + index * 52;
        return {
            nodeId: readArenaString(bytes, header.arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true)),
            kind: readArenaString(bytes, header.arenaOffset, view.getUint32(base + 8, true), view.getUint32(base + 12, true)),
            label: readArenaString(bytes, header.arenaOffset, view.getUint32(base + 16, true), view.getUint32(base + 20, true)),
            entityId:
                view.getUint32(base + 28, true) > 0
                    ? readArenaString(bytes, header.arenaOffset, view.getUint32(base + 24, true), view.getUint32(base + 28, true))
                    : undefined,
            documentId:
                view.getUint32(base + 36, true) > 0
                    ? readArenaString(bytes, header.arenaOffset, view.getUint32(base + 32, true), view.getUint32(base + 36, true))
                    : undefined,
            chapterId: view.getUint32(base + 40, true) || undefined,
            weight: view.getInt32(base + 44, true),
        };
    });
    const edges = Array.from({ length: header.table3Count }, (_, index) => {
        const base = header.table3Offset + index * 32;
        return {
            sourceId: readArenaString(bytes, header.arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true)),
            targetId: readArenaString(bytes, header.arenaOffset, view.getUint32(base + 8, true), view.getUint32(base + 12, true)),
            edgeType: readArenaString(bytes, header.arenaOffset, view.getUint32(base + 16, true), view.getUint32(base + 20, true)),
            weight: view.getInt32(base + 24, true),
        };
    });
    const diagnostics = decodeDiagnostics(bytes, view, header.table4Offset, header.table4Count, header.arenaOffset);
    return { sessionId, chunks, nodes, edges, diagnostics };
}

function decodeSessionStateResult(bytes: Uint8Array): SessionStateBinaryResult {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = decodeBinaryHeader(view);
    const sessionId = readArenaString(bytes, header.arenaOffset, header.sessionOffset, header.sessionLen);
    const titleRefs = Array.from({ length: header.table2Count }, (_, index) => {
        const base = header.table2Offset + index * 8;
        return {
            offset: view.getUint32(base, true),
            len: view.getUint32(base + 4, true),
        };
    });
    const documents = Array.from({ length: header.table1Count }, (_, index) => {
        const base = header.table1Offset + index * 56;
        const titleStart = view.getUint32(base + 16, true);
        const titleCount = view.getUint32(base + 20, true);
        return {
            documentId: readArenaString(bytes, header.arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true)),
            noteId:
                view.getUint32(base + 12, true) > 0
                    ? readArenaString(bytes, header.arenaOffset, view.getUint32(base + 8, true), view.getUint32(base + 12, true))
                    : undefined,
            chapterTitles: titleRefs
                .slice(titleStart, titleStart + titleCount)
                .map((title) => readArenaString(bytes, header.arenaOffset, title.offset, title.len)),
            chapterCount: view.getUint32(base + 24, true),
            parentCount: view.getUint32(base + 28, true),
            leafCount: view.getUint32(base + 32, true),
            entityCount: view.getUint32(base + 36, true),
            discoveryCount: view.getUint32(base + 40, true),
            hasFrontMatterChapter: (view.getUint32(base + 44, true) & (1 << 4)) !== 0,
            updatedAt: Number(view.getBigUint64(base + 48, true)),
        };
    });
    const manifestNamespaces = Array.from({ length: header.table3Count }, (_, index) => {
        const base = header.table3Offset + index * 8;
        return readArenaString(bytes, header.arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true));
    });
    return { sessionId, documents, manifestNamespaces };
}

function decodeSessionStatsResult(bytes: Uint8Array): SessionStatsBinaryResult {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = decodeBinaryHeader(view);
    const sessionId = readArenaString(bytes, header.arenaOffset, header.sessionOffset, header.sessionLen);
    const base = header.table1Offset;
    return {
        sessionId,
        documentCount: view.getUint32(base, true),
        chapterCount: view.getUint32(base + 4, true),
        parentCount: view.getUint32(base + 8, true),
        leafCount: view.getUint32(base + 12, true),
        entityCount: view.getUint32(base + 16, true),
        discoveryCandidateCount: view.getUint32(base + 20, true),
        graphVertexCount: view.getUint32(base + 24, true),
        graphEdgeCount: view.getUint32(base + 28, true),
        spanCount: view.getUint32(base + 32, true),
        updatedAt: Number(view.getBigUint64(base + 36, true)),
    };
}

function decodeDiagnostics(
    bytes: Uint8Array,
    view: DataView,
    tableOffset: number,
    tableCount: number,
    arenaOffset: number,
): Array<{ code: string; message: string }> {
    return Array.from({ length: tableCount }, (_, index) => {
        const base = tableOffset + index * 16;
        return {
            code: readArenaString(bytes, arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true)),
            message: readArenaString(bytes, arenaOffset, view.getUint32(base + 8, true), view.getUint32(base + 12, true)),
        };
    });
}
