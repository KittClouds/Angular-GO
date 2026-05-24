/// <reference lib="webworker" />

import { env, pipeline } from '@huggingface/transformers';
import type {
    EntitySuggestionProviderStatus,
    LocalEntitySuggestion,
} from '../lib/entity-suggestions/entity-suggestion.types';

type Device = 'webgpu' | 'wasm';
type WorkerRequest =
    | { type: 'INIT'; _id: number }
    | { type: 'SCAN'; payload: { noteTitle: string; plainText: string }; _id: number }
    | { type: 'GET_STATUS'; _id: number }
    | { type: 'DISPOSE'; _id: number };

const MODEL_ID = 'onnx-community/gliner_base';
const LABELS = ['person', 'location', 'organization', 'event', 'object', 'concept'];
const KIND_BY_LABEL: Record<string, string> = {
    person: 'CHARACTER',
    location: 'LOCATION',
    organization: 'NETWORK',
    event: 'EVENT',
    object: 'ITEM',
    concept: 'CONCEPT',
};
const MAX_CHUNK_CHARS = 3600;

let extractor: any = null;
let currentDevice: Device | null = null;
let loading = false;
let lastError: string | undefined;

env.allowRemoteModels = true;
env.allowLocalModels = false;
((env.backends.onnx as any).wasm ??= {}).wasmPaths = '/assets/onnx/';

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const message = event.data;
    try {
        if (message.type === 'INIT') {
            await initialize();
            reply(message._id, 'INIT_COMPLETE', { device: currentDevice });
            return;
        }

        if (message.type === 'SCAN') {
            await initialize();
            const suggestions = await scan(message.payload.plainText);
            reply(message._id, 'SCAN_COMPLETE', { suggestions, device: currentDevice });
            return;
        }

        if (message.type === 'GET_STATUS') {
            reply(message._id, 'STATUS', getStatus());
            return;
        }

        extractor = null;
        currentDevice = null;
        reply(message._id, 'DISPOSED', undefined);
    } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        loading = false;
        reply(message._id, 'ERROR', { message: lastError });
    }
};

async function initialize(): Promise<void> {
    if (extractor) return;
    loading = true;
    lastError = undefined;

    for (const device of ['webgpu', 'wasm'] as const) {
        try {
            extractor = await pipeline('token-classification' as any, MODEL_ID, {
                device,
                dtype: 'q8',
            } as any);
            currentDevice = device;
            loading = false;
            return;
        } catch (error) {
            extractor = null;
            currentDevice = null;
            lastError = error instanceof Error ? error.message : String(error);
        }
    }

    loading = false;
    throw new Error(lastError || 'Unable to initialize GLiNER model');
}

async function scan(text: string): Promise<LocalEntitySuggestion[]> {
    const chunks = chunkText(text);
    const best = new Map<string, LocalEntitySuggestion>();

    for (const chunk of chunks) {
        const output = await extractor(chunk, {
            labels: LABELS,
            threshold: 0.35,
            aggregation_strategy: 'simple',
        } as any);
        for (const entry of normalizeOutput(output)) {
            const key = normalizeKey(entry.label);
            if (!key) continue;
            const current = best.get(key);
            if (!current || scoreOf(entry) > scoreOf(current)) {
                best.set(key, entry);
            }
        }
    }

    return [...best.values()].sort((left, right) => scoreOf(right) - scoreOf(left)).slice(0, 40);
}

function normalizeOutput(output: unknown): LocalEntitySuggestion[] {
    const items = Array.isArray(output) ? output : [];
    return items
        .map((item) => item as Record<string, unknown>)
        .map((item) => {
            const label = cleanLabel(String(item['word'] || item['text'] || item['span'] || ''));
            const entity = normalizeEntityLabel(String(item['entity_group'] || item['entity'] || item['label'] || ''));
            const score = Number(item['score'] || item['probability'] || 0.7);
            return {
                label,
                kind: KIND_BY_LABEL[entity] || 'CONCEPT',
                confidence: score >= 0.8 ? 'high' : score >= 0.55 ? 'medium' : 'low',
                rawScore: Number.isFinite(score) ? score : 0.7,
                reasoning: 'GLiNER zero-shot entity span',
                evidence: label,
                aliases: [],
            } satisfies LocalEntitySuggestion;
        })
        .filter((suggestion) => suggestion.label.length > 1 && /[\p{L}\p{N}]/u.test(suggestion.label));
}

function chunkText(text: string): string[] {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const chunks: string[] = [];
    for (let start = 0; start < cleaned.length; start += MAX_CHUNK_CHARS) {
        chunks.push(cleaned.slice(start, start + MAX_CHUNK_CHARS));
    }
    return chunks;
}

function cleanLabel(value: string): string {
    return value.replace(/^#+/, '').replace(/\s+/g, ' ').trim();
}

function normalizeEntityLabel(value: string): string {
    return value.replace(/^B-|^I-/i, '').trim().toLowerCase();
}

function normalizeKey(value: string): string {
    return cleanLabel(value).toLowerCase();
}

function scoreOf(suggestion: LocalEntitySuggestion): number {
    return typeof suggestion.rawScore === 'number' ? suggestion.rawScore : 0;
}

function getStatus(): EntitySuggestionProviderStatus {
    return {
        ready: Boolean(extractor),
        loading,
        device: currentDevice,
        error: lastError,
    };
}

function reply(_id: number, type: string, payload: unknown): void {
    self.postMessage({ type, payload, _id });
}
