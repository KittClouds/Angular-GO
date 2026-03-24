/// <reference lib="webworker" />

import {
    createImportObject,
    decodePacketHeader,
    PACKET_HEADER_SIZE,
    PhoenixChatStreamEvent,
    PhoenixChatStreamRequest,
    PHOENIX_WASM_CANDIDATE_URLS,
    PROTOCOL_VERSION,
    WasmExports,
} from '../lib/phoenix/wasm-protocol';

type PhoenixWorkerMessage =
    | { type: 'INIT'; id: number }
    | { type: 'PROCESS_PACKET'; id: number; capacity: number; buffer: SharedArrayBuffer | ArrayBuffer }
    | { type: 'CHAT_STREAM_START'; id: number; request: PhoenixChatStreamRequest }
    | { type: 'CHAT_STREAM_CANCEL'; id: number };

type PhoenixWorkerResponse =
    | { type: 'INIT_RESULT'; id: number; protocolVersion: number }
    | { type: 'PROCESS_PACKET_RESULT'; id: number; status: number; buffer?: ArrayBuffer }
    | { type: 'CHAT_STREAM_EVENT'; id: number; event: PhoenixChatStreamEvent }
    | { type: 'ERROR'; id: number; error: string };

let wasmExports: WasmExports | null = null;
let wasmLoadPromise: Promise<void> | null = null;
const activeChatStreams = new Map<number, AbortController>();

async function loadWasmInternal(): Promise<void> {
    let response: Response | null = null;
    const failures: string[] = [];

    for (const url of PHOENIX_WASM_CANDIDATE_URLS) {
        const candidate = await fetch(url);
        if (candidate.ok) {
            response = candidate;
            break;
        }
        failures.push(`${url} -> ${candidate.status}`);
    }

    if (!response) {
        throw new Error(
            `[PhoenixWorker] Failed to fetch phoenix_wasm.wasm. Tried ${failures.join(', ')}. Run "npm run wasm:ensure" to sync the Phoenix WASM asset.`,
        );
    }

    const moduleBytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(moduleBytes, createImportObject());
    wasmExports = instance.exports as unknown as WasmExports;
    const protocolVersion = wasmExports.phoenix_wasm_protocol_version();
    if (protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(`[PhoenixWorker] Protocol mismatch: expected ${PROTOCOL_VERSION}, got ${protocolVersion}`);
    }
}

async function ensureWasmLoaded(): Promise<void> {
    if (wasmExports) {
        return;
    }
    if (!wasmLoadPromise) {
        wasmLoadPromise = loadWasmInternal().catch((error) => {
            wasmLoadPromise = null;
            throw error;
        });
    }
    await wasmLoadPromise;
}

function requireExports(): WasmExports {
    if (!wasmExports) {
        throw new Error('[PhoenixWorker] WASM not loaded');
    }
    return wasmExports;
}

function bufferView(buffer: SharedArrayBuffer | ArrayBuffer, capacity: number): Uint8Array {
    return new Uint8Array(buffer, 0, capacity);
}

function isSharedBuffer(buffer: SharedArrayBuffer | ArrayBuffer): buffer is SharedArrayBuffer {
    return typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer;
}

function processPacket(buffer: SharedArrayBuffer | ArrayBuffer, capacity: number): number {
    const exports = requireExports();
    const ptr = exports.phoenix_alloc(capacity);

    try {
        const requestRegion = bufferView(buffer, capacity);
        const wasmRegion = new Uint8Array(exports.memory.buffer, ptr, capacity);
        wasmRegion.set(requestRegion);

        const status = exports.phoenix_process_packet_at(ptr, capacity);
        const responseRegion = new Uint8Array(exports.memory.buffer, ptr, capacity);
        const header = decodePacketHeader(responseRegion);
        const usedLen = Math.min(capacity, PACKET_HEADER_SIZE + header.payloadLen);
        requestRegion.subarray(0, usedLen).set(responseRegion.subarray(0, usedLen));

        return status;
    } finally {
        exports.phoenix_dealloc(ptr, capacity);
    }
}

function emitChatStreamEvent(id: number, event: PhoenixChatStreamEvent): void {
    self.postMessage({
        type: 'CHAT_STREAM_EVENT',
        id,
        event,
    } as PhoenixWorkerResponse);
}

function appendContentChunks(target: string[], value: unknown): void {
    if (typeof value === 'string') {
        if (value) target.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            appendContentChunks(target, item);
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record['text'] === 'string' && record['text']) {
        target.push(record['text']);
    }
    if (typeof record['content'] === 'string' && record['content']) {
        target.push(record['content']);
    }
}

function extractChunkText(value: unknown): string {
    const chunks: string[] = [];
    appendContentChunks(chunks, value);
    return chunks.join('');
}

function extractContentChunk(payload: any): string {
    const choice = payload?.choices?.[0];
    if (!choice) return '';
    return (
        extractChunkText(choice?.delta?.content) ||
        extractChunkText(choice?.message?.content) ||
        extractChunkText(choice?.content)
    );
}

function extractReasoningChunk(payload: any): string {
    const choice = payload?.choices?.[0];
    if (!choice) return '';
    return (
        extractChunkText(choice?.delta?.reasoning) ||
        extractChunkText(choice?.delta?.reasoning_text) ||
        extractChunkText(choice?.delta?.reasoningText) ||
        extractChunkText(choice?.message?.reasoning) ||
        extractChunkText(choice?.reasoning)
    );
}

function buildOpenRouterMessages(request: PhoenixChatStreamRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt?.trim()) {
        messages.push({ role: 'system', content: request.systemPrompt.trim() });
    }
    for (const message of request.messages) {
        messages.push({
            role: message.role,
            content: message.content ?? '',
        });
    }
    return messages;
}

function buildOpenRouterBody(request: PhoenixChatStreamRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
        model: request.config.model,
        messages: buildOpenRouterMessages(request),
        stream: true,
    };

    if (typeof request.config.temperature === 'number') {
        body['temperature'] = request.config.temperature;
    }
    if (typeof request.config.maxTokens === 'number' && request.config.maxTokens > 0) {
        body['max_tokens'] = request.config.maxTokens;
    }
    if (request.config.reasoningEnabled) {
        body['reasoning'] = {
            effort: request.config.reasoningEffort || 'medium',
            ...(request.config.reasoningMaxTokens
                ? { max_tokens: request.config.reasoningMaxTokens }
                : {}),
        };
    }

    if (request.requestOptions?.plugins?.length) {
        body['plugins'] = request.requestOptions.plugins;
    }

    const structuredOutput = request.requestOptions?.structuredOutput;
    if (structuredOutput?.enabled) {
        if (structuredOutput.type === 'json_schema' && structuredOutput.schema) {
            body['response_format'] = {
                type: 'json_schema',
                json_schema: {
                    name: structuredOutput.name || 'response',
                    strict: structuredOutput.strict ?? false,
                    schema: structuredOutput.schema,
                    ...(structuredOutput.description
                        ? { description: structuredOutput.description }
                        : {}),
                },
            };
        } else if (structuredOutput.type === 'json_object') {
            body['response_format'] = { type: 'json_object' };
        }
    }

    return body;
}

async function streamOpenRouter(id: number, request: PhoenixChatStreamRequest): Promise<void> {
    const controller = new AbortController();
    activeChatStreams.set(id, controller);

    const apiKey = request.config.apiKey?.trim();
    if (!apiKey) {
        emitChatStreamEvent(id, { type: 'error', error: 'OpenRouter API key is not configured.' });
        activeChatStreams.delete(id);
        return;
    }

    let responseText = '';
    let reasoningText = '';
    let sawDone = false;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                'HTTP-Referer': self.location?.origin || 'http://localhost',
                'X-Title': 'KittClouds Phoenix',
            },
            body: JSON.stringify(buildOpenRouterBody(request)),
            signal: controller.signal,
        });

        if (!response.ok) {
            const detail = await response.text();
            emitChatStreamEvent(id, {
                type: 'error',
                error: detail || `OpenRouter request failed with status ${response.status}`,
            });
            return;
        }

        if (!response.body) {
            emitChatStreamEvent(id, { type: 'error', error: 'OpenRouter response body was empty.' });
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';

        const processEventBlock = (block: string): void => {
            const dataLines = block
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart());
            if (!dataLines.length) {
                return;
            }
            const data = dataLines.join('\n').trim();
            if (!data) {
                return;
            }
            if (data === '[DONE]') {
                sawDone = true;
                return;
            }

            let payload: any;
            try {
                payload = JSON.parse(data);
            } catch {
                return;
            }

            const contentChunk = extractContentChunk(payload);
            if (contentChunk) {
                responseText += contentChunk;
                emitChatStreamEvent(id, { type: 'delta', chunk: contentChunk });
            }

            const reasoningChunk = extractReasoningChunk(payload);
            if (reasoningChunk) {
                reasoningText += reasoningChunk;
                emitChatStreamEvent(id, { type: 'reasoning', chunk: reasoningChunk });
            }
        };

        while (true) {
            const { done, value } = await reader.read();
            pending += decoder.decode(value || new Uint8Array(0), { stream: !done });

            let separatorIndex = pending.indexOf('\n\n');
            while (separatorIndex >= 0) {
                const block = pending.slice(0, separatorIndex);
                pending = pending.slice(separatorIndex + 2);
                processEventBlock(block);
                separatorIndex = pending.indexOf('\n\n');
            }

            if (done) {
                break;
            }
        }

        if (pending.trim()) {
            processEventBlock(pending);
        }

        if (!sawDone && !responseText && !reasoningText) {
            emitChatStreamEvent(id, {
                type: 'error',
                error: 'OpenRouter stream ended without response content.',
            });
            return;
        }

        emitChatStreamEvent(id, {
            type: 'done',
            response: responseText,
            ...(reasoningText ? { reasoning: reasoningText } : {}),
        });
    } catch (error) {
        if (controller.signal.aborted) {
            emitChatStreamEvent(id, { type: 'cancelled' });
            return;
        }
        emitChatStreamEvent(id, {
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        activeChatStreams.delete(id);
    }
}

self.onmessage = async (event: MessageEvent<PhoenixWorkerMessage>) => {
    const message = event.data;

    try {
        switch (message.type) {
            case 'INIT':
                await ensureWasmLoaded();
                self.postMessage({
                    type: 'INIT_RESULT',
                    id: message.id,
                    protocolVersion: PROTOCOL_VERSION,
                } as PhoenixWorkerResponse);
                break;

            case 'PROCESS_PACKET': {
                await ensureWasmLoaded();
                const status = processPacket(message.buffer, message.capacity);
                if (isSharedBuffer(message.buffer)) {
                    self.postMessage({
                        type: 'PROCESS_PACKET_RESULT',
                        id: message.id,
                        status,
                    } as PhoenixWorkerResponse);
                } else {
                    self.postMessage(
                        {
                            type: 'PROCESS_PACKET_RESULT',
                            id: message.id,
                            status,
                            buffer: message.buffer,
                        } as PhoenixWorkerResponse,
                        [message.buffer],
                    );
                }
                break;
            }
            case 'CHAT_STREAM_START':
                void streamOpenRouter(message.id, message.request);
                break;
            case 'CHAT_STREAM_CANCEL': {
                const controller = activeChatStreams.get(message.id);
                controller?.abort();
                break;
            }
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
        } as PhoenixWorkerResponse);
    }
};
