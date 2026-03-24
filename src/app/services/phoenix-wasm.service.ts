import { Injectable } from '@angular/core';
import {
    decodePacketHeader,
    DEFAULT_PACKET_REGION_SIZE,
    isRetriablePacketMessage,
    PACKET_HEADER_SIZE,
    PACKET_KIND,
    PhoenixChatStreamEvent,
    PhoenixChatStreamRequest,
    PROTOCOL_VERSION,
    tryDecodeJson,
    writePacketHeader,
} from '../lib/phoenix/wasm-protocol';

export interface PhoenixScope {
    worldId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
}

export interface PhoenixChunkHit {
    chunkId: string;
    score: number;
}

export interface PhoenixNodeHit {
    entityId: string;
    score: number;
}

export interface PhoenixDiagnostic {
    code: string;
    message: string;
}

export interface PhoenixQueryBinaryResult {
    sessionId: string;
    chunkHits: PhoenixChunkHit[];
    nodeHits: PhoenixNodeHit[];
    diagnostics: PhoenixDiagnostic[];
}

export interface PhoenixGraphDeltaBinaryResult {
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
    diagnostics: PhoenixDiagnostic[];
}

export interface PhoenixSessionStateBinaryResult {
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
}

export interface PhoenixSessionStatsBinaryResult {
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
}

type PacketResponse = {
    kind: number;
    requestId: number;
    bytes: Uint8Array;
    json: any;
};

type PhoenixWorkerMessage =
    | { type: 'INIT'; id: number }
    | { type: 'PROCESS_PACKET'; id: number; capacity: number; buffer: SharedArrayBuffer | ArrayBuffer }
    | { type: 'CHAT_STREAM_START'; id: number; request: PhoenixChatStreamRequest }
    | { type: 'CHAT_STREAM_CANCEL'; id: number };

type PhoenixWorkerMessageInput =
    | { type: 'INIT' }
    | { type: 'PROCESS_PACKET'; capacity: number; buffer: SharedArrayBuffer | ArrayBuffer };

type PhoenixWorkerResponse =
    | { type: 'INIT_RESULT'; id: number; protocolVersion: number }
    | { type: 'PROCESS_PACKET_RESULT'; id: number; status: number; buffer?: ArrayBuffer }
    | { type: 'CHAT_STREAM_EVENT'; id: number; event: PhoenixChatStreamEvent }
    | { type: 'ERROR'; id: number; error: string };

type PhoenixChatStreamCallbacks = {
    onChunk: (chunk: string) => void;
    onComplete: (response: string) => void;
    onError: (error: Error) => void;
    onReasoningChunk?: (chunk: string) => void;
    onEvent?: (event: { stage: 'reasoning' | 'stream'; status: 'running' | 'done' | 'error'; detail?: string }) => void;
};

@Injectable({ providedIn: 'root' })
export class PhoenixWasmService {
    private worker: Worker | null = null;
    private workerReady = false;
    private loadPromise: Promise<void> | null = null;
    private readyCallbacks: Array<() => void> = [];
    private nextPacketRequestId = 1;
    private nextWorkerMessageId = 1;
    private readonly pendingWorkerMessages = new Map<
        number,
        {
            resolve: (message: PhoenixWorkerResponse) => void;
            reject: (error: Error) => void;
        }
    >();
    private readonly activeChatStreams = new Map<
        number,
        {
            callbacks: PhoenixChatStreamCallbacks;
            resolve: () => void;
        }
    >();
    private loggedTransferFallback = false;

    get isReady(): boolean {
        return this.workerReady;
    }

    onReady(callback: () => void): void {
        if (this.isReady) {
            callback();
            return;
        }
        this.readyCallbacks.push(callback);
    }

    async loadWasm(): Promise<void> {
        if (this.loadPromise) {
            return this.loadPromise;
        }
        this.loadPromise = this.loadWasmInternal().catch((error) => {
            this.loadPromise = null;
            throw error;
        });
        return this.loadPromise;
    }

    async initRuntime(forceReset = false): Promise<any> {
        await this.loadWasm();
        return (await this.sendJson(PACKET_KIND.initRuntimeRequest, {
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
            forceReset,
        })).json;
    }

    async createSession(label: string, scope: PhoenixScope = {}): Promise<any> {
        await this.loadWasm();
        return (await this.sendJson(PACKET_KIND.createSessionRequest, {
            sessionId: null,
            label,
            scope,
        })).json;
    }

    async ingest(request: Record<string, unknown>): Promise<any> {
        await this.loadWasm();
        return (await this.sendJson(PACKET_KIND.ingestRequest, request, 512 * 1024)).json;
    }

    async query(request: Record<string, unknown>): Promise<PhoenixQueryBinaryResult> {
        await this.loadWasm();
        const payload = (await this.sendJson(PACKET_KIND.queryRequest, request, 512 * 1024)).bytes;
        return decodeQueryResult(payload);
    }

    async commit(sessionId: string, request: Record<string, unknown> = {}): Promise<any> {
        await this.loadWasm();
        return (await this.sendJson(PACKET_KIND.commitRequest, {
            sessionId,
            reason: request['reason'] ?? null,
        })).json;
    }

    async rebuild(request: Record<string, unknown> = {}): Promise<any> {
        await this.loadWasm();
        return (await this.sendJson(PACKET_KIND.rebuildRequest, request)).json;
    }

    async scan(request: Record<string, unknown>): Promise<any> {
        await this.loadWasm();
        return (await this.sendJson(PACKET_KIND.scanRequest, request, 512 * 1024)).json;
    }

    async buildStructure(request: Record<string, unknown>): Promise<any> {
        await this.loadWasm();
        return (await this.sendJson(PACKET_KIND.structureRequest, request, 512 * 1024)).json;
    }

    async analyzeText(text: string): Promise<any> {
        await this.loadWasm();
        return (await this.sendJson(PACKET_KIND.analyzeTextRequest, { text }, 512 * 1024)).json;
    }

    async graphDelta(request: Record<string, unknown>): Promise<PhoenixGraphDeltaBinaryResult> {
        await this.loadWasm();
        const payload = (await this.sendJson(PACKET_KIND.graphDeltaRequest, request, 512 * 1024)).bytes;
        return decodeGraphDeltaResult(payload);
    }

    async sessionState(sessionId: string): Promise<PhoenixSessionStateBinaryResult> {
        await this.loadWasm();
        const payload = (await this.sendJson(
            PACKET_KIND.sessionStateRequest,
            { sessionId },
            512 * 1024,
        )).bytes;
        return decodeSessionStateResult(payload);
    }

    async sessionStats(sessionId: string): Promise<PhoenixSessionStatsBinaryResult> {
        await this.loadWasm();
        const payload = (await this.sendJson(
            PACKET_KIND.sessionStatsRequest,
            { sessionId },
            128 * 1024,
        )).bytes;
        return decodeSessionStatsResult(payload);
    }

    async exportSnapshot(capacityHint = 8 * 1024 * 1024): Promise<Uint8Array> {
        await this.loadWasm();
        return (await this.sendBytes(PACKET_KIND.snapshotExportRequest, new Uint8Array(0), capacityHint)).bytes;
    }

    async importSnapshot(bytes: Uint8Array): Promise<any> {
        await this.loadWasm();
        return (await this.sendBytes(
            PACKET_KIND.snapshotImportRequest,
            bytes,
            Math.max(bytes.byteLength + 4096, 256 * 1024),
        )).json;
    }

    async storeCommand(command: string, payload: Record<string, unknown> = {}): Promise<any> {
        await this.loadWasm();
        const result = (await this.sendJson(
            PACKET_KIND.storeCommandRequest,
            { command, payload },
            512 * 1024,
        )).json;
        if (!result?.success) {
            throw new Error(result?.error || `Phoenix store command failed: ${command}`);
        }
        return result.payload ?? null;
    }

    async chatInit(config: Record<string, unknown>): Promise<any> {
        return this.storeCommand('chat:init', { config });
    }

    async chatCreateThread(worldId: string, narrativeId: string, title?: string): Promise<any> {
        return this.storeCommand('chat:createThread', { worldId, narrativeId, ...(title ? { title } : {}) });
    }

    async chatGetThread(id: string): Promise<any> {
        return this.storeCommand('chat:getThread', { id });
    }

    async chatListThreads(worldId?: string): Promise<any> {
        return this.storeCommand('chat:listThreads', worldId ? { worldId } : {});
    }

    async chatDeleteThread(id: string): Promise<void> {
        await this.storeCommand('chat:deleteThread', { id });
    }

    async chatAddMessage(threadId: string, role: string, content: string, narrativeId?: string): Promise<any> {
        return this.storeCommand('chat:addMessage', {
            threadId,
            role,
            content,
            ...(narrativeId ? { narrativeId } : {}),
        });
    }

    async chatListMessages(threadId: string): Promise<any> {
        return this.storeCommand('chat:listMessages', { threadId });
    }

    async chatUpdateMessage(messageId: string, content: string): Promise<any> {
        return this.storeCommand('chat:updateMessage', { messageId, content });
    }

    async chatAppendMessage(messageId: string, chunk: string): Promise<any> {
        return this.storeCommand('chat:appendMessage', { messageId, chunk });
    }

    async chatStartStreamingMessage(threadId: string, narrativeId?: string): Promise<any> {
        return this.storeCommand('chat:startStreamingMessage', {
            threadId,
            ...(narrativeId ? { narrativeId } : {}),
        });
    }

    async chatClearThread(threadId: string): Promise<void> {
        await this.storeCommand('chat:clearThread', { threadId });
    }

    async chatExportThread(threadId: string): Promise<string> {
        return (await this.storeCommand('chat:exportThread', { threadId })) || '{}';
    }

    async chatStartRun(threadId: string, prompt: string, options: Record<string, unknown>): Promise<any> {
        return this.storeCommand('chat:startRun', { threadId, prompt, options });
    }

    async chatPollRun(runId: string): Promise<any> {
        return this.storeCommand('chat:pollRun', { runId });
    }

    async chatResumeRun(runId: string): Promise<any> {
        return this.storeCommand('chat:resumeRun', { runId });
    }

    async chatCancelRun(runId: string): Promise<any> {
        return this.storeCommand('chat:cancelRun', { runId });
    }

    async chatListRunEvents(threadId: string, limit = 100): Promise<any> {
        return this.storeCommand('chat:listRunEvents', { threadId, limit });
    }

    async chatMarkRunStreaming(runId: string, assistantMessageId: string): Promise<any> {
        return this.storeCommand('chat:markRunStreaming', { runId, assistantMessageId });
    }

    async chatCompleteRun(
        runId: string,
        assistantMessageId: string,
        finalResponse: string,
        finalError?: string,
    ): Promise<any> {
        return this.storeCommand('chat:completeRun', {
            runId,
            assistantMessageId,
            finalResponse,
            ...(finalError ? { finalError } : {}),
        });
    }

    async chatSubmitToolResults(runId: string, results: unknown[]): Promise<any> {
        return this.storeCommand('chat:submitToolResults', { runId, results });
    }

    async chatSubmitApproval(
        runId: string,
        approvalId: string,
        approved: boolean,
        decisionJson?: string,
    ): Promise<any> {
        return this.storeCommand('chat:submitApproval', {
            runId,
            approvalId,
            approved,
            ...(decisionJson ? { decisionJson } : {}),
        });
    }

    async streamChat(request: PhoenixChatStreamRequest, callbacks: PhoenixChatStreamCallbacks): Promise<void> {
        await this.loadWasm();
        if (!this.worker) {
            callbacks.onError(new Error('[PhoenixWasmService] Worker not initialized'));
            return;
        }

        const id = this.nextWorkerMessageId++;
        return new Promise((resolve) => {
            this.activeChatStreams.set(id, { callbacks, resolve });
            this.worker!.postMessage({
                type: 'CHAT_STREAM_START',
                id,
                request,
            } as PhoenixWorkerMessage);
        });
    }

    cancelStreamChat(streamId: number): void {
        if (!this.worker || !this.activeChatStreams.has(streamId)) {
            return;
        }
        this.worker.postMessage({ type: 'CHAT_STREAM_CANCEL', id: streamId } as PhoenixWorkerMessage);
    }

    private async loadWasmInternal(): Promise<void> {
        this.worker?.terminate();
        this.worker = new Worker(new URL('../workers/phoenix.worker', import.meta.url), {
            type: 'module',
        });
        this.workerReady = false;

        this.worker.onmessage = (event: MessageEvent<PhoenixWorkerResponse>) => {
            this.handleWorkerMessage(event.data);
        };

        this.worker.onerror = (event) => {
            const error = new Error(
                `[PhoenixWasmService] Worker error: ${event.message || 'Unknown worker error'}`,
            );
            console.error('[PhoenixWasmService] Worker error:', event);
            this.worker?.terminate();
            this.worker = null;
            this.workerReady = false;
            this.loadPromise = null;
            this.rejectPendingWorkerMessages(error);
            this.rejectActiveChatStreams(error);
        };

        const response = await this.sendWorkerMessage({ type: 'INIT' });
        if (response.type !== 'INIT_RESULT') {
            throw new Error('[PhoenixWasmService] Worker failed to initialize');
        }
        if (response.protocolVersion !== PROTOCOL_VERSION) {
            throw new Error(
                `[PhoenixWasmService] Protocol mismatch: expected ${PROTOCOL_VERSION}, got ${response.protocolVersion}`,
            );
        }
        this.workerReady = true;
        this.notifyReady();
    }

    private notifyReady(): void {
        for (const callback of this.readyCallbacks) {
            try {
                callback();
            } catch (error) {
                console.error('[PhoenixWasmService] Ready callback failed:', error);
            }
        }
        this.readyCallbacks = [];
    }

    private async sendJson(kind: number, payload: unknown, capacityHint?: number): Promise<PacketResponse> {
        const encoder = new TextEncoder();
        return this.sendPayload(kind, encoder.encode(JSON.stringify(payload)), capacityHint);
    }

    private async sendBytes(kind: number, payload: Uint8Array, capacityHint?: number): Promise<PacketResponse> {
        return this.sendPayload(kind, payload, capacityHint);
    }

    private async sendPayload(kind: number, payload: Uint8Array, capacityHint?: number): Promise<PacketResponse> {
        let capacity = Math.max(
            capacityHint ?? 0,
            DEFAULT_PACKET_REGION_SIZE,
            payload.byteLength * 4 + 4096,
        );

        for (let attempt = 0; attempt < 6; attempt++) {
            const buffer = this.createPacketBuffer(capacity);
            const bytes = new Uint8Array(buffer, 0, capacity);
            const requestId = this.nextPacketRequestId++;
            writePacketHeader(bytes, kind, requestId, payload.byteLength);
            bytes.set(payload, PACKET_HEADER_SIZE);

            const response = await this.sendWorkerMessage({
                type: 'PROCESS_PACKET',
                capacity,
                buffer,
            });
            if (response.type !== 'PROCESS_PACKET_RESULT') {
                throw new Error('[PhoenixWasmService] Unexpected worker response');
            }

            const responseBuffer = response.buffer ?? buffer;
            const responseRegion = new Uint8Array(responseBuffer, 0, capacity);
            const header = decodePacketHeader(responseRegion);
            const responseBytes = responseRegion.slice(
                PACKET_HEADER_SIZE,
                PACKET_HEADER_SIZE + header.payloadLen,
            );
            const json = tryDecodeJson(responseBytes);

            if (response.status === 0) {
                return {
                    kind: header.kind,
                    requestId: header.requestId,
                    bytes: responseBytes,
                    json,
                };
            }

            const message = json?.message || json?.error || 'Phoenix packet failed';
            if (attempt < 5 && typeof message === 'string' && isRetriablePacketMessage(message)) {
                capacity *= 2;
                continue;
            }
            throw new Error(message);
        }

        throw new Error('[PhoenixWasmService] Packet retry budget exhausted');
    }

    private createPacketBuffer(capacity: number): SharedArrayBuffer | ArrayBuffer {
        if (
            typeof SharedArrayBuffer !== 'undefined' &&
            (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated)
        ) {
            return new SharedArrayBuffer(capacity);
        }
        if (!this.loggedTransferFallback) {
            this.loggedTransferFallback = true;
            console.warn('[PhoenixWasmService] SharedArrayBuffer unavailable, falling back to transferable buffers.');
        }
        return new ArrayBuffer(capacity);
    }

    private async sendWorkerMessage(message: PhoenixWorkerMessageInput): Promise<PhoenixWorkerResponse> {
        if (!this.worker) {
            throw new Error('[PhoenixWasmService] Worker not initialized');
        }

        const id = this.nextWorkerMessageId++;
        return new Promise((resolve, reject) => {
            this.pendingWorkerMessages.set(id, { resolve, reject });
            const fullMessage = { ...message, id } as PhoenixWorkerMessage;
            if (message.type === 'PROCESS_PACKET' && !this.isSharedBuffer(message.buffer)) {
                this.worker!.postMessage(fullMessage, [message.buffer]);
                return;
            }
            this.worker!.postMessage(fullMessage);
        });
    }

    private handleWorkerMessage(message: PhoenixWorkerResponse): void {
        if (message.type === 'CHAT_STREAM_EVENT') {
            this.handleChatStreamEvent(message.id, message.event);
            return;
        }

        const pending = this.pendingWorkerMessages.get(message.id);
        if (!pending) {
            if (message.type === 'ERROR') {
                this.failChatStream(message.id, new Error(message.error));
            }
            return;
        }
        this.pendingWorkerMessages.delete(message.id);
        if (message.type === 'ERROR') {
            pending.reject(new Error(message.error));
            return;
        }
        pending.resolve(message);
    }

    private rejectPendingWorkerMessages(error: Error): void {
        for (const pending of this.pendingWorkerMessages.values()) {
            pending.reject(error);
        }
        this.pendingWorkerMessages.clear();
    }

    private handleChatStreamEvent(streamId: number, event: PhoenixChatStreamEvent): void {
        const active = this.activeChatStreams.get(streamId);
        if (!active) {
            return;
        }

        switch (event.type) {
            case 'delta':
                active.callbacks.onEvent?.({ stage: 'stream', status: 'running' });
                active.callbacks.onChunk(event.chunk);
                return;
            case 'reasoning':
                active.callbacks.onEvent?.({ stage: 'reasoning', status: 'running' });
                active.callbacks.onReasoningChunk?.(event.chunk);
                return;
            case 'done':
                active.callbacks.onEvent?.({ stage: 'stream', status: 'done' });
                this.activeChatStreams.delete(streamId);
                active.callbacks.onComplete(event.response);
                active.resolve();
                return;
            case 'cancelled':
                active.callbacks.onEvent?.({ stage: 'stream', status: 'error', detail: 'Cancelled' });
                this.activeChatStreams.delete(streamId);
                active.callbacks.onError(new Error('Chat stream cancelled'));
                active.resolve();
                return;
            case 'error':
                active.callbacks.onEvent?.({ stage: 'stream', status: 'error', detail: event.error });
                this.activeChatStreams.delete(streamId);
                active.callbacks.onError(new Error(event.error));
                active.resolve();
                return;
        }
    }

    private failChatStream(streamId: number, error: Error): void {
        const active = this.activeChatStreams.get(streamId);
        if (!active) {
            return;
        }
        this.activeChatStreams.delete(streamId);
        active.callbacks.onEvent?.({ stage: 'stream', status: 'error', detail: error.message });
        active.callbacks.onError(error);
        active.resolve();
    }

    private rejectActiveChatStreams(error: Error): void {
        for (const [streamId] of this.activeChatStreams) {
            this.failChatStream(streamId, error);
        }
    }

    private isSharedBuffer(buffer: SharedArrayBuffer | ArrayBuffer): buffer is SharedArrayBuffer {
        return typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer;
    }
}

type BinaryHeader = {
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
};

function decodeBinaryHeader(view: DataView): BinaryHeader {
    return {
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
    };
}

function readArenaString(bytes: Uint8Array, arenaOffset: number, stringOffset: number, stringLen: number): string {
    return new TextDecoder().decode(
        bytes.slice(arenaOffset + stringOffset, arenaOffset + stringOffset + stringLen),
    );
}

function decodeDiagnostics(
    bytes: Uint8Array,
    view: DataView,
    tableOffset: number,
    tableCount: number,
    arenaOffset: number,
): PhoenixDiagnostic[] {
    return Array.from({ length: tableCount }, (_, index) => {
        const base = tableOffset + index * 16;
        return {
            code: readArenaString(bytes, arenaOffset, view.getUint32(base, true), view.getUint32(base + 4, true)),
            message: readArenaString(bytes, arenaOffset, view.getUint32(base + 8, true), view.getUint32(base + 12, true)),
        };
    });
}

function decodeQueryResult(bytes: Uint8Array): PhoenixQueryBinaryResult {
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

function decodeGraphDeltaResult(bytes: Uint8Array): PhoenixGraphDeltaBinaryResult {
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

function decodeSessionStateResult(bytes: Uint8Array): PhoenixSessionStateBinaryResult {
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

function decodeSessionStatsResult(bytes: Uint8Array): PhoenixSessionStatsBinaryResult {
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
