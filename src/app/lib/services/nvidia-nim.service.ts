import { Injectable, signal } from '@angular/core';
import { getSetting, removeSetting, setSetting } from '../dexie/settings.service';

export interface NvidiaNimMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | null;
}

export interface NvidiaNimConfig {
    apiKey: string;
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
}

export interface NvidiaNimStreamCallbacks {
    onChunk: (chunk: string) => void;
    onComplete: (fullResponse: string) => void;
    onError: (error: Error) => void;
    onReasoningChunk?: (chunk: string) => void;
    onEvent?: (event: { stage: 'reasoning' | 'stream'; status: 'running' | 'done' | 'error'; detail?: string }) => void;
}

const STORAGE_KEY = 'nvidia-nim:config';
const DEFAULT_MODEL = 'moonshotai/kimi-k2-thinking';
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_TOP_P = 0.9;
const DEFAULT_MAX_TOKENS = 16384;
const CHAT_COMPLETIONS_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

@Injectable({ providedIn: 'root' })
export class NvidiaNimService {
    private readonly _config = signal<NvidiaNimConfig | null>(this.loadConfig());
    private readonly _isConfigured = signal(Boolean(this._config()?.apiKey?.trim()));

    readonly config = this._config.asReadonly();
    readonly isConfigured = this._isConfigured.asReadonly();

    readonly availableModels = [
        { id: DEFAULT_MODEL, name: 'Kimi K2 Thinking', description: 'Moonshot thinking model via NVIDIA NIM' },
    ];

    saveConfig(config: NvidiaNimConfig): void {
        const normalized = normalizeConfig(config);
        this._config.set(normalized);
        this._isConfigured.set(Boolean(normalized.apiKey));
        setSetting(STORAGE_KEY, normalized);
    }

    clearConfig(): void {
        this._config.set(null);
        this._isConfigured.set(false);
        removeSetting(STORAGE_KEY);
    }

    getModel(): string {
        return this._config()?.model || DEFAULT_MODEL;
    }

    async streamChat(
        messages: NvidiaNimMessage[],
        callbacks: NvidiaNimStreamCallbacks,
        systemPrompt?: string,
    ): Promise<void> {
        const config = this._config();
        const apiKey = config?.apiKey?.trim();
        if (!apiKey) {
            callbacks.onError(new Error('NVIDIA NIM API key is not configured.'));
            return;
        }

        const requestConfig = config ?? normalizeConfig({ apiKey, model: DEFAULT_MODEL });
        const requestMessages = buildMessages(messages, systemPrompt);
        if (requestMessages.length === 0) {
            callbacks.onError(new Error('No chat messages were provided.'));
            return;
        }

        try {
            callbacks.onEvent?.({ stage: 'stream', status: 'running' });
            const response = await fetch(CHAT_COMPLETIONS_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                body: JSON.stringify({
                    model: requestConfig.model || DEFAULT_MODEL,
                    messages: requestMessages,
                    temperature: numberOr(requestConfig.temperature, DEFAULT_TEMPERATURE),
                    top_p: numberOr(requestConfig.topP, DEFAULT_TOP_P),
                    max_tokens: numberOr(requestConfig.maxTokens, DEFAULT_MAX_TOKENS),
                    stream: true,
                }),
            });

            if (!response.ok) {
                const detail = await response.text();
                throw new Error(detail || `NVIDIA NIM request failed with status ${response.status}`);
            }

            const full = response.body
                ? await readNimSse(response.body.getReader(), callbacks)
                : extractText((await response.json())?.choices?.[0]?.message?.content);

            callbacks.onEvent?.({ stage: 'stream', status: 'done', detail: 'Completed successfully.' });
            callbacks.onComplete(full);
        } catch (error) {
            const message = error instanceof Error ? error : new Error(String(error));
            callbacks.onEvent?.({ stage: 'stream', status: 'error', detail: message.message });
            callbacks.onError(message);
        }
    }

    private loadConfig(): NvidiaNimConfig | null {
        const config = getSetting<NvidiaNimConfig | null>(STORAGE_KEY, null);
        return config ? normalizeConfig(config) : null;
    }
}

async function readNimSse(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    callbacks: NvidiaNimStreamCallbacks,
): Promise<string> {
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            return full;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) {
                continue;
            }

            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') {
                continue;
            }

            const payload = JSON.parse(data);
            const delta = payload?.choices?.[0]?.delta ?? {};
            const reasoning = extractText(delta.reasoning_content) || extractText(delta.reasoning);
            const chunk = extractText(delta.content);

            if (reasoning) {
                callbacks.onReasoningChunk?.(reasoning);
            }
            if (chunk) {
                full += chunk;
                callbacks.onChunk(chunk);
            }
        }
    }
}

function buildMessages(messages: NvidiaNimMessage[], systemPrompt?: string): NvidiaNimMessage[] {
    const result: NvidiaNimMessage[] = [];
    if (systemPrompt?.trim()) {
        result.push({ role: 'system', content: systemPrompt.trim() });
    }
    for (const message of messages) {
        const content = message.content?.trim();
        if (!content) {
            continue;
        }
        result.push({ role: message.role, content });
    }
    return result;
}

function normalizeConfig(config: NvidiaNimConfig): NvidiaNimConfig {
    return {
        apiKey: config.apiKey?.trim() || '',
        model: config.model?.trim() || DEFAULT_MODEL,
        temperature: numberOr(config.temperature, DEFAULT_TEMPERATURE),
        topP: numberOr(config.topP, DEFAULT_TOP_P),
        maxTokens: numberOr(config.maxTokens, DEFAULT_MAX_TOKENS),
    };
}

function extractText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(extractText).join('');
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return typeof record['text'] === 'string' ? record['text'] : '';
    }
    return '';
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
