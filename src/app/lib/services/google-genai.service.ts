/**
 * Google GenAI Service
 * 
 * Handles LLM API calls via Google's Gemini API.
 * Supports streaming responses with generateContentStream.
 * 
 * @see https://github.com/googleapis/js-genai
 */

import { Injectable, signal } from '@angular/core';
import { GoogleGenAI } from '@google/genai';

export interface GoogleGenAIMessage {
    role: 'user' | 'model';
    parts: { text: string }[];
}

export interface GoogleGenAIConfig {
    apiKey: string;
    model: string;
    temperature?: number;
    maxOutputTokens?: number;
    systemPrompt?: string;
}

export interface StreamCallbacks {
    onChunk: (chunk: string) => void;
    onComplete: (fullResponse: string) => void;
    onError: (error: Error) => void;
}

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const STORAGE_KEY = 'google-genai:config';

@Injectable({ providedIn: 'root' })
export class GoogleGenAIService {
    private _config = signal<GoogleGenAIConfig | null>(this.loadConfig());
    private _isConfigured = signal(false);
    private _client: GoogleGenAI | null = null;

    readonly config = this._config.asReadonly();
    readonly isConfigured = this._isConfigured.asReadonly();

    constructor() {
        this._isConfigured.set(!!this._config()?.apiKey);
        this.initClient();
    }

    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    private loadConfig(): GoogleGenAIConfig | null {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[GoogleGenAI] Failed to load config:', e);
        }
        return null;
    }

    private initClient(): void {
        const config = this._config();
        if (config?.apiKey) {
            this._client = new GoogleGenAI({ apiKey: config.apiKey });
            console.log('[GoogleGenAI] Client initialized');
        }
    }

    saveConfig(config: GoogleGenAIConfig): void {
        this._config.set(config);
        this._isConfigured.set(!!config.apiKey);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        this.initClient();
        console.log('[GoogleGenAI] Config saved');
    }

    clearConfig(): void {
        this._config.set(null);
        this._isConfigured.set(false);
        this._client = null;
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
        messages: GoogleGenAIMessage[],
        callbacks: StreamCallbacks,
        systemPrompt?: string
    ): Promise<void> {
        const config = this._config();
        if (!config?.apiKey || !this._client) {
            callbacks.onError(new Error('Google GenAI API key not configured'));
            return;
        }

        try {
            // Build content array for Gemini
            // Convert messages to Gemini format
            const contents = messages.map(msg => ({
                role: msg.role,
                parts: msg.parts
            }));

            // Build generation config
            const generationConfig: {
                temperature?: number;
                maxOutputTokens?: number;
            } = {};

            if (config.temperature !== undefined) {
                generationConfig.temperature = config.temperature;
            }
            if (config.maxOutputTokens !== undefined) {
                generationConfig.maxOutputTokens = config.maxOutputTokens;
            }

            // Use system instruction if provided
            const sysPrompt = systemPrompt || config.systemPrompt;

            console.log('[GoogleGenAI] Streaming chat:', {
                model: config.model || DEFAULT_MODEL,
                messageCount: contents.length,
                hasSystemPrompt: !!sysPrompt
            });

            // Use generateContentStream for streaming
            const response = await this._client.models.generateContentStream({
                model: config.model || DEFAULT_MODEL,
                contents: contents,
                config: {
                    ...generationConfig,
                    systemInstruction: sysPrompt || undefined
                }
            });

            let fullResponse = '';

            // Process stream chunks
            for await (const chunk of response) {
                const text = chunk.text;
                if (text) {
                    fullResponse += text;
                    callbacks.onChunk(text);
                }
            }

            callbacks.onComplete(fullResponse);
        } catch (error) {
            console.error('[GoogleGenAI] Stream error:', error);
            callbacks.onError(error instanceof Error ? error : new Error(String(error)));
        }
    }

    // -------------------------------------------------------------------------
    // Chat Completion (Non-Streaming)
    // -------------------------------------------------------------------------

    async chat(
        messages: GoogleGenAIMessage[],
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
    // Simple Generate (for quick prompts)
    // -------------------------------------------------------------------------

    async generate(prompt: string): Promise<string> {
        const config = this._config();
        if (!config?.apiKey || !this._client) {
            throw new Error('Google GenAI API key not configured');
        }

        const response = await this._client.models.generateContent({
            model: config.model || DEFAULT_MODEL,
            contents: prompt
        });

        return response.text || '';
    }

    // -------------------------------------------------------------------------
    // Available Models
    // -------------------------------------------------------------------------

    readonly availableModels = [
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Newest & fastest' },
        { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', description: 'Most capable' },
        { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', description: 'Adaptive thinking' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast, versatile' },
        { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', description: 'Cost-efficient' },
    ];
}
