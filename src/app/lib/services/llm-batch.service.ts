/**
 * LLM Batch Service
 * 
 * Dedicated service for batch/extraction LLM operations.
 * 
 * COMPLETELY SEPARATE from AI Chat:
 * - Own provider selection
 * - Own model selection  
 * - NO streaming - uses direct fetch for complete responses
 * 
 * Used by: Entity Extraction, NER Enhancement
 */

import { Injectable, signal, computed } from '@angular/core';

export type LlmProvider = 'google' | 'openrouter';

const STORAGE_KEY = 'kittclouds:llm-batch-settings';

interface LlmBatchConfig {
    provider: LlmProvider;
    googleApiKey: string;
    googleModel: string;
    openRouterApiKey: string;
    openRouterModel: string;
}

// Popular models for batch operations (good at structured output)
export const BATCH_GOOGLE_MODELS = [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast, good for extraction' },
    { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash Preview', description: 'Latest preview' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable' },
];

// Free tier models - same as AI Chat for consistency
export const BATCH_OPENROUTER_MODELS = [
    { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'Google' },
    { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron 3 Nano 30B', provider: 'NVIDIA' },
    { id: 'liquid/lfm-2.5-1.2b-thinking:free', name: 'LFM 2.5 Thinking', provider: 'Liquid' },
    { id: 'stepfun/step-3.5-flash:free', name: 'Step 3.5 Flash', provider: 'StepFun' },
    { id: 'tngtech/deepseek-r1t2-chimera:free', name: 'DeepSeek R1T2 Chimera', provider: 'TNG Tech' },
    { id: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air (Z-AI)', provider: 'Z-AI' },
];

@Injectable({
    providedIn: 'root'
})
export class LlmBatchService {
    // =========================================================================
    // Settings - COMPLETELY INDEPENDENT from AI Chat
    // =========================================================================

    private _config = signal<LlmBatchConfig>(this.loadConfig());

    // Public readonly signals
    readonly provider = computed(() => this._config().provider);
    readonly googleModel = computed(() => this._config().googleModel);
    readonly openRouterModel = computed(() => this._config().openRouterModel);

    readonly currentModel = computed(() => {
        const cfg = this._config();
        return cfg.provider === 'google' ? cfg.googleModel : cfg.openRouterModel;
    });

    readonly isConfigured = computed(() => {
        const cfg = this._config();
        if (cfg.provider === 'google') {
            return !!cfg.googleApiKey;
        } else {
            return !!cfg.openRouterApiKey;
        }
    });

    // =========================================================================
    // Settings Management
    // =========================================================================

    private loadConfig(): LlmBatchConfig {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[LlmBatch] Failed to load config:', e);
        }
        return {
            provider: 'openrouter',
            googleApiKey: '',
            googleModel: 'gemini-2.0-flash',
            openRouterApiKey: '',
            openRouterModel: 'z-ai/glm-4.5-air:free'
        };
    }

    private saveConfig() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._config()));
    }

    getConfig(): LlmBatchConfig {
        return this._config();
    }

    updateConfig(partial: Partial<LlmBatchConfig>) {
        this._config.update(cfg => ({ ...cfg, ...partial }));
        this.saveConfig();
        console.log('[LlmBatch] Config updated:', {
            provider: this._config().provider,
            model: this.currentModel()
        });
    }

    // =========================================================================
    // Direct API Calls - NO STREAMING
    // =========================================================================

    /**
     * Make a completion request and get the FULL response.
     * NO streaming. Direct fetch. Complete response only.
     */
    async complete(userPrompt: string, systemPrompt?: string): Promise<string> {
        const cfg = this._config();

        if (cfg.provider === 'google') {
            return this.callGoogleDirect(userPrompt, systemPrompt, cfg);
        } else {
            return this.callOpenRouterDirect(userPrompt, systemPrompt, cfg);
        }
    }

    /**
     * Direct Google GenAI call - NO streaming
     */
    private async callGoogleDirect(
        userPrompt: string,
        systemPrompt: string | undefined,
        cfg: LlmBatchConfig
    ): Promise<string> {
        if (!cfg.googleApiKey) {
            throw new Error('[LlmBatch] Google API key not configured');
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.googleModel}:generateContent?key=${cfg.googleApiKey}`;

        const body: any = {
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature: 0.3, // Lower for structured output
                maxOutputTokens: 4096
            }
        };

        if (systemPrompt) {
            body.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        console.log(`[LlmBatch] Calling Google ${cfg.googleModel} (NON-STREAMING)`);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        // Extract text from response
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            console.warn('[LlmBatch] Empty response from Google:', data);
            return '';
        }

        console.log(`[LlmBatch] Google response: ${text.length} chars`);
        return text;
    }

    /**
     * Direct OpenRouter call - NO streaming
     */
    private async callOpenRouterDirect(
        userPrompt: string,
        systemPrompt: string | undefined,
        cfg: LlmBatchConfig
    ): Promise<string> {
        if (!cfg.openRouterApiKey) {
            throw new Error('[LlmBatch] OpenRouter API key not configured');
        }

        const messages: any[] = [];

        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: userPrompt });

        console.log(`[LlmBatch] Calling OpenRouter ${cfg.openRouterModel} (NON-STREAMING)`);

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.openRouterApiKey}`,
                'HTTP-Referer': window.location.origin,
                'X-Title': 'KittClouds'
            },
            body: JSON.stringify({
                model: cfg.openRouterModel,
                messages,
                temperature: 0.3,
                max_tokens: 4096,
                stream: false // EXPLICITLY NO STREAMING
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        const text = data.choices?.[0]?.message?.content;
        if (!text) {
            console.warn('[LlmBatch] Empty response from OpenRouter:', data);
            return '';
        }

        console.log(`[LlmBatch] OpenRouter response: ${text.length} chars`);
        return text;
    }
}
