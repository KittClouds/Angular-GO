/// <reference lib="webworker" />

import { env, pipeline } from '@huggingface/transformers';
import {
    buildEntitySuggestionChunks,
    buildLocalEntityExtractionMessages,
    decodeUtf8ByteRange,
    mapConfidenceLevelToScore,
    mergeLocalEntitySuggestions,
    parseLocalEntitySuggestionsFromModelOutput,
} from '../lib/entity-suggestions/lfm-local-entity-utils';
import type {
    EntitySuggestionDevice,
    EntitySuggestionProviderStatus,
    LocalEntitySuggestion,
} from '../lib/entity-suggestions/entity-suggestion.types';

const MODEL_ID = 'onnx-community/LFM2.5-350M-ONNX';
const MODEL_DTYPE = 'q4';
const MAX_NEW_TOKENS = 384;

// Suppress known harmless warnings from transformers.js and Chromium
const originalWarn = console.warn;
console.warn = (...args) => {
    const msg = typeof args[0] === 'string' ? args[0] : String(args[0] || '');
    if (
        msg.includes('Unknown tokenizer class') ||
        msg.includes('powerPreference option is currently ignored') ||
        (args[0]?.message && args[0].message.includes('powerPreference'))
    ) {
        return;
    }
    originalWarn(...args);
};
const IDLE_STATUS: EntitySuggestionProviderStatus = {
    ready: false,
    loading: false,
    device: null,
};

const CHUNKER_WASM_URL = '/assets/wasm/phoenix_chunker.wasm';
const CHUNKER_JS_URL = '/assets/wasm/phoenix_chunker.js';
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS = 8;

let chunkerReady = false;
let chunkTextFn: ((text: string, chunkSize: number, overlap: number) => string) | null = null;

async function ensureChunker(): Promise<void> {
    if (chunkerReady) {
        return;
    }
    try {
        // Fetch both the JS glue and the WASM binary
        const [jsResponse, wasmResponse] = await Promise.all([
            fetch(CHUNKER_JS_URL),
            fetch(CHUNKER_WASM_URL),
        ]);
        if (!jsResponse.ok || !wasmResponse.ok) {
            throw new Error(`Failed to load chunker assets: JS=${jsResponse.status} WASM=${wasmResponse.status}`);
        }
        // Load the JS glue as a blob URL module to bypass Angular's static import resolution
        const jsSource = await jsResponse.text();
        const blob = new Blob([jsSource], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const glue = await import(/* @vite-ignore */ blobUrl);
        URL.revokeObjectURL(blobUrl);

        // Initialize the WASM module with the fetched binary
        const wasmBytes = await wasmResponse.arrayBuffer();
        await glue.default({ module_or_path: wasmBytes });
        chunkTextFn = glue.chunk_text;
        chunkerReady = true;
        console.log('[LfmEntitySuggestionWorker] Phoenix WASM chunker loaded (18KB)');
    } catch (error) {
        console.warn('[LfmEntitySuggestionWorker] WASM chunker unavailable, will use JS fallback:', error);
        chunkerReady = false;
    }
}

interface WasmChunkRange {
    start: number;
    end: number;
}

function wasmChunkText(plainText: string): { id: string; text: string }[] | null {
    if (!chunkTextFn) {
        return null;
    }
    let ranges: WasmChunkRange[];
    try {
        ranges = JSON.parse(chunkTextFn(plainText, CHUNK_SIZE, CHUNK_OVERLAP));
    } catch (error) {
        console.warn('[LfmEntitySuggestionWorker] WASM chunk ranges were invalid, falling back:', error);
        return null;
    }

    const encoded = new TextEncoder().encode(plainText);
    const decoder = new TextDecoder();
    const capped = ranges.slice(0, MAX_CHUNKS);
    const chunks = capped.map((range, index) => {
        return {
            id: `chunk-${index + 1}`,
            text: decodeUtf8ByteRange(encoded, range.start, range.end, decoder),
        };
    }).filter((chunk) => chunk.text.trim().length > 0);

    return chunks.length ? chunks : null;
}

env.allowLocalModels = false;
env.useBrowserCache = true;

// Let @huggingface/transformers resolve ONNX WASM files from its built-in CDN.
// Do NOT override wasmPaths to a local path that doesn't exist.

type WorkerMessage =
    | { type: 'INIT'; payload?: never; _id: number }
    | { type: 'SCAN'; payload: { noteTitle?: string; plainText: string }; _id: number }
    | { type: 'GET_STATUS'; payload?: never; _id: number }
    | { type: 'DISPOSE'; payload?: never; _id: number };

type WorkerResponse =
    | { type: 'INIT_COMPLETE'; payload: { device: EntitySuggestionDevice }; _id: number }
    | { type: 'SCAN_COMPLETE'; payload: { suggestions: LocalEntitySuggestion[]; device: EntitySuggestionDevice }; _id: number }
    | { type: 'STATUS'; payload: EntitySuggestionProviderStatus; _id: number }
    | { type: 'DISPOSED'; payload?: never; _id: number }
    | { type: 'ERROR'; payload: { message: string }; _id: number };

class LfmEntitySuggestionWorker {
    private generator: any = null;
    private status: EntitySuggestionProviderStatus = { ...IDLE_STATUS };
    private device: EntitySuggestionDevice | null = null;

    async initialize(_id: number): Promise<void> {
        if (this.generator) {
            return;
        }

        this.status = {
            ready: false,
            loading: true,
            device: this.device,
        };

        const prefersWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
        const attemptedDevices: EntitySuggestionDevice[] = prefersWebGpu
            ? ['webgpu', 'wasm']
            : ['wasm'];

        let lastError: unknown = null;

        for (const device of attemptedDevices) {
            try {
                console.log(`[LfmEntitySuggestionWorker] Attempting ${device} with model ${MODEL_ID}...`);
                this.generator = await pipeline('text-generation', MODEL_ID, {
                    dtype: MODEL_DTYPE,
                    device,
                    progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
                        console.log(`[LfmEntitySuggestionWorker] ${progress.status}${progress.file ? ` ${progress.file}` : ''}${progress.progress != null ? ` ${progress.progress.toFixed(1)}%` : ''}`);
                    },
                });
                this.device = device;
                this.status = {
                    ready: true,
                    loading: false,
                    device,
                };
                console.log(`[LfmEntitySuggestionWorker] Successfully initialized on ${device}`);
                return;
            } catch (error) {
                const errorDetail = error instanceof Error
                    ? error.message
                    : (typeof error === 'number' ? `ONNX Runtime error code: ${error}` : String(error));
                console.warn(`[LfmEntitySuggestionWorker] Failed to init device ${device}: ${errorDetail}`, error);
                lastError = error;
                this.generator = null;
            }
        }

        console.error('[LfmEntitySuggestionWorker] Initialization failed:', lastError);
        const message = lastError instanceof Error
            ? lastError.message
            : (lastError && typeof (lastError as any).message === 'string' ? (lastError as any).message : 'Failed to initialize local LFM model');
        
        this.status = {
            ready: false,
            loading: false,
            device: null,
            error: message,
        };
        throw new Error(message);
    }

    async scan(noteTitle: string | undefined, plainText: string): Promise<LocalEntitySuggestion[]> {
        await this.initialize(0);

        if (!this.generator || !this.device) {
            throw new Error('Local LFM model is not ready');
        }

        // Load WASM chunker if not already loaded
        await ensureChunker();

        // Use WASM sentence-aligned chunks, fall back to JS regex chunking
        const chunks = wasmChunkText(plainText) ?? buildEntitySuggestionChunks(plainText);
        if (!chunks.length) {
            return [];
        }

        console.log(`[LfmEntitySuggestionWorker] scanning ${chunks.length} chunks from ${plainText.length} chars`);
        const suggestions: LocalEntitySuggestion[] = [];

        for (const chunk of chunks) {
            const output = await this.generator(
                buildLocalEntityExtractionMessages(noteTitle, chunk.text),
                {
                max_new_tokens: MAX_NEW_TOKENS,
                do_sample: false,
                temperature: 0.1,
                top_k: 50,
                repetition_penalty: 1.05,
            });

            const generatedText = this.extractGeneratedText(output);
            const parsed = parseLocalEntitySuggestionsFromModelOutput(generatedText).map(
                (suggestion) => ({
                    ...suggestion,
                    rawScore: mapConfidenceLevelToScore(suggestion.confidence),
                }),
            );

            if (parsed.length > 0) {
                suggestions.push(...parsed);
                console.log(`[LfmEntitySuggestionWorker] ${chunk.id}: ${parsed.length} suggestions from ${chunk.text.length} chars`);
            } else {
                console.log(`[LfmEntitySuggestionWorker] ${chunk.id}: 0 suggestions from ${chunk.text.length} chars`);
                const preview = generatedText.trim().replace(/\s+/g, ' ').slice(0, 220);
                if (preview) {
                    console.debug(`[LfmEntitySuggestionWorker] ${chunk.id} raw output: ${preview}`);
                }
            }
        }

        const merged = mergeLocalEntitySuggestions(suggestions);
        if (!merged.length) {
            console.log('[LfmEntitySuggestionWorker] No entities found in text');
        }

        return merged;
    }

    async dispose(): Promise<void> {
        if (this.generator && typeof this.generator.dispose === 'function') {
            await this.generator.dispose();
        }
        this.generator = null;
        this.device = null;
        this.status = { ...IDLE_STATUS };
    }

    getStatus(): EntitySuggestionProviderStatus {
        return { ...this.status };
    }

    getDevice(): EntitySuggestionDevice | null {
        return this.device;
    }

    private extractGeneratedText(output: any): string {
        if (!Array.isArray(output) || !output.length) {
            return '';
        }

        const first = output[0];
        const generated = first?.generated_text;

        if (typeof generated === 'string') {
            return generated;
        }

        if (Array.isArray(generated) && generated.length) {
            const lastMessage = generated[generated.length - 1];
            if (typeof lastMessage?.content === 'string') {
                return lastMessage.content;
            }
        }

        return '';
    }
}

const worker = new LfmEntitySuggestionWorker();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;

    try {
        switch (message.type) {
            case 'INIT':
                await worker.initialize(message._id);
                self.postMessage({
                    type: 'INIT_COMPLETE',
                    payload: { device: worker.getDevice() || 'wasm' },
                    _id: message._id,
                } satisfies WorkerResponse);
                return;

            case 'SCAN': {
                const suggestions = await worker.scan(
                    message.payload.noteTitle,
                    message.payload.plainText,
                );
                self.postMessage({
                    type: 'SCAN_COMPLETE',
                    payload: {
                        suggestions,
                        device: worker.getDevice() || 'wasm',
                    },
                    _id: message._id,
                } satisfies WorkerResponse);
                return;
            }

            case 'GET_STATUS':
                self.postMessage({
                    type: 'STATUS',
                    payload: worker.getStatus(),
                    _id: message._id,
                } satisfies WorkerResponse);
                return;

            case 'DISPOSE':
                await worker.dispose();
                self.postMessage({
                    type: 'DISPOSED',
                    _id: message._id,
                } satisfies WorkerResponse);
                return;
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            payload: {
                message: error instanceof Error ? error.message : 'Unknown local entity worker error',
            },
            _id: message._id,
        } satisfies WorkerResponse);
    }
};
