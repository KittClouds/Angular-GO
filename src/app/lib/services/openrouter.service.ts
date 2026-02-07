/**
 * OpenRouter Service
 * 
 * Handles LLM API calls via OpenRouter.
 * Supports streaming responses and multiple models.
 * 
 * @see https://openrouter.ai/docs
 */

import { Injectable, signal } from '@angular/core';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCallResponse[];
    tool_call_id?: string;
}

export interface ToolCallResponse {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface OpenRouterConfig {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
}

export interface StreamCallbacks {
    onChunk: (chunk: string) => void;
    onComplete: (fullResponse: string) => void;
    onError: (error: Error) => void;
}

const DEFAULT_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free';
const STORAGE_KEY = 'openrouter:config';

@Injectable({ providedIn: 'root' })
export class OpenRouterService {
    private _config = signal<OpenRouterConfig | null>(this.loadConfig());
    private _isConfigured = signal(false);

    readonly config = this._config.asReadonly();
    readonly isConfigured = this._isConfigured.asReadonly();

    constructor() {
        this._isConfigured.set(!!this._config()?.apiKey);
    }

    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    private loadConfig(): OpenRouterConfig | null {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[OpenRouter] Failed to load config:', e);
        }
        return null;
    }

    saveConfig(config: OpenRouterConfig): void {
        this._config.set(config);
        this._isConfigured.set(!!config.apiKey);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        console.log('[OpenRouter] Config saved');
    }

    clearConfig(): void {
        this._config.set(null);
        this._isConfigured.set(false);
        localStorage.removeItem(STORAGE_KEY);
    }

    getApiKey(): string | null {
        return this._config()?.apiKey || null;
    }

    getModel(): string {
        return this._config()?.model || DEFAULT_MODEL;
    }

    // -------------------------------------------------------------------------
    // Chat Completion (Streaming)
    // -------------------------------------------------------------------------

    async streamChat(
        messages: OpenRouterMessage[],
        callbacks: StreamCallbacks,
        systemPrompt?: string
    ): Promise<void> {
        const config = this._config();
        if (!config?.apiKey) {
            callbacks.onError(new Error('OpenRouter API key not configured'));
            return;
        }

        // Prepend system prompt if provided
        const fullMessages: OpenRouterMessage[] = [];
        const sysPrompt = systemPrompt || config.systemPrompt;
        if (sysPrompt) {
            fullMessages.push({ role: 'system', content: sysPrompt });
        }
        fullMessages.push(...messages);

        try {
            const response = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'KittClouds',
                },
                body: JSON.stringify({
                    model: config.model || DEFAULT_MODEL,
                    messages: fullMessages,
                    temperature: config.temperature ?? 0.7,
                    max_tokens: config.maxTokens ?? 2048,
                    stream: true,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const decoder = new TextDecoder();
            let fullResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            callbacks.onComplete(fullResponse);
                            return;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                fullResponse += content;
                                callbacks.onChunk(content);
                            }
                        } catch (e) {
                            // Skip malformed JSON chunks
                        }
                    }
                }
            }

            callbacks.onComplete(fullResponse);
        } catch (error) {
            callbacks.onError(error instanceof Error ? error : new Error(String(error)));
        }
    }

    // -------------------------------------------------------------------------
    // Chat Completion (Non-Streaming)
    // -------------------------------------------------------------------------

    async chat(
        messages: OpenRouterMessage[],
        systemPrompt?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            let result = '';
            this.streamChat(messages, {
                onChunk: (chunk) => { result += chunk; },
                onComplete: (full) => resolve(full),
                onError: (err) => reject(err),
            }, systemPrompt);
        });
    }

    // -------------------------------------------------------------------------
    // Chat with Tools (Non-Streaming for tool calls)
    // -------------------------------------------------------------------------

    /**
     * Chat with tool calling support.
     * Non-streaming to properly handle tool_calls in response.
     * 
     * @returns Either content (string) or tool_calls array
     */
    async chatWithTools(
        messages: OpenRouterMessage[],
        tools: any[],
        systemPrompt?: string
    ): Promise<{ content: string | null; tool_calls: ToolCallResponse[] | null }> {
        const config = this._config();
        if (!config?.apiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        // Prepend system prompt if provided
        const fullMessages: OpenRouterMessage[] = [];
        const sysPrompt = systemPrompt || config.systemPrompt;
        if (sysPrompt) {
            fullMessages.push({ role: 'system', content: sysPrompt });
        }
        fullMessages.push(...messages);

        console.log('[OpenRouter] Chat with tools:', {
            messageCount: fullMessages.length,
            toolCount: tools.length,
            model: config.model
        });

        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
                'HTTP-Referer': window.location.origin,
                'X-Title': 'KittClouds',
            },
            body: JSON.stringify({
                model: config.model || DEFAULT_MODEL,
                messages: fullMessages,
                tools: tools.length > 0 ? tools : undefined,
                temperature: config.temperature ?? 0.7,
                max_tokens: config.maxTokens ?? 2048,
                stream: false, // Non-streaming for tool calls
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const choice = data.choices?.[0];

        if (!choice) {
            throw new Error('No response from model');
        }

        const message = choice.message;
        console.log('[OpenRouter] Response:', {
            hasContent: !!message.content,
            hasToolCalls: !!message.tool_calls,
            toolCallCount: message.tool_calls?.length ?? 0
        });

        return {
            content: message.content || null,
            tool_calls: message.tool_calls || null
        };
    }

    // -------------------------------------------------------------------------
    // Available Models (free tier)
    // -------------------------------------------------------------------------

    readonly popularModels = [
        { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'Google' },
        { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron 3 Nano 30B', provider: 'NVIDIA' },
        { id: 'liquid/lfm-2.5-1.2b-thinking:free', name: 'LFM 2.5 Thinking', provider: 'Liquid' },
        { id: 'stepfun/step-3.5-flash:free', name: 'Step 3.5 Flash', provider: 'StepFun' },
        { id: 'tngtech/deepseek-r1t2-chimera:free', name: 'DeepSeek R1T2 Chimera', provider: 'TNG Tech' },
        { id: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air', provider: 'Z-AI' },
    ];
}
