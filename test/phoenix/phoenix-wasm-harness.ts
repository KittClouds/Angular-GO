import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PACKET_KIND = {
    initRuntimeRequest: 2,
    createSessionRequest: 4,
    ingestRequest: 10,
    queryRequest: 12,
    snapshotExportRequest: 14,
    snapshotImportRequest: 16,
    scanRequest: 17,
    graphDeltaRequest: 21,
    sessionStateRequest: 23,
    sessionStatsRequest: 25,
} as const;

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

    static async create(): Promise<PhoenixWasmHarness> {
        ensurePhoenixWasmBuilt();
        const wasmPath = path.join(
            workspaceRoot(),
            'rust',
            'phoenix',
            'target',
            'wasm32-unknown-unknown',
            'debug',
            'phoenix_wasm.wasm',
        );
        const moduleBytes = readFileSync(wasmPath);
        const { instance } = await WebAssembly.instantiate(moduleBytes, createImportObject());
        return new PhoenixWasmHarness(instance.exports as unknown as WasmExports);
    }

    protocolVersion(): number {
        return this.exports.phoenix_wasm_protocol_version();
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

    scan(text: string): any {
        return this.sendJson(PACKET_KIND.scanRequest, {
            text,
            scope: {},
            sessionId: 'scan-worker',
            resolverSeed: [],
        }).json;
    }

    ingest(sessionId: string, documentId: string, title: string, text: string): any {
        return this.sendJson(PACKET_KIND.ingestRequest, {
            sessionId,
            documents: [{ documentId, noteId: null, title, text, scope: {} }],
            commit: false,
        }).json;
    }

    queryBinary(sessionId: string, query: string): QueryBinaryResult {
        const payload = this.sendJson(PACKET_KIND.queryRequest, {
            sessionId,
            query,
            scope: {},
            targets: ['chunks'],
            limit: 5,
            temporal: null,
        }).bytes;
        return decodeQueryResult(payload);
    }

    graphDeltaBinary(sessionId: string, documentId: string): GraphDeltaBinaryResult {
        const payload = this.sendJson(PACKET_KIND.graphDeltaRequest, {
            sessionId,
            scope: {},
            changedDocuments: [documentId],
            limit: 16,
            sinceCommit: null,
        }).bytes;
        return decodeGraphDeltaResult(payload);
    }

    sessionStateBinary(sessionId: string): SessionStateBinaryResult {
        const payload = this.sendJson(PACKET_KIND.sessionStateRequest, { sessionId }).bytes;
        return decodeSessionStateResult(payload);
    }

    sessionStatsBinary(sessionId: string): SessionStatsBinaryResult {
        const payload = this.sendJson(PACKET_KIND.sessionStatsRequest, { sessionId }).bytes;
        return decodeSessionStatsResult(payload);
    }

    exportSnapshot(): Uint8Array {
        return this.sendJson(PACKET_KIND.snapshotExportRequest, undefined).bytes;
    }

    importSnapshot(snapshot: Uint8Array): any {
        return this.sendBytes(16, snapshot).json;
    }

    private sendJson(kind: number, payload: unknown): { kind: number; bytes: Uint8Array; json?: any } {
        const payloadBytes = payload === undefined ? new Uint8Array() : this.encoder.encode(JSON.stringify(payload));
        return this.sendBytes(kind, payloadBytes);
    }

    private sendBytes(kind: number, payload: Uint8Array): { kind: number; bytes: Uint8Array; json?: any } {
        const packetHeaderSize = this.exports.phoenix_packet_header_size();
        const capacity = Math.max(128 * 1024, packetHeaderSize + payload.byteLength + 1024);
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

function ensurePhoenixWasmBuilt(): void {
    const wasmPath = path.join(
        workspaceRoot(),
        'rust',
        'phoenix',
        'target',
        'wasm32-unknown-unknown',
        'debug',
        'phoenix_wasm.wasm',
    );
    if (existsSync(wasmPath)) {
        return;
    }

    execFileSync('cargo', ['build', '--target', 'wasm32-unknown-unknown', '-p', 'phoenix-wasm', '-j', '1'], {
        cwd: path.join(workspaceRoot(), 'rust', 'phoenix'),
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
