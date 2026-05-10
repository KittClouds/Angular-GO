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
import type { OpenRouterPlugin, OpenRouterStructuredOutputConfig } from './phoenix-chat.service';
import { getSetting, setSetting } from '../dexie/settings.service';

export type LlmProvider = 'google' | 'openrouter';

const STORAGE_KEY = 'kittclouds:llm-batch-settings';

interface LlmBatchConfig {
    provider: LlmProvider;
    googleApiKey: string;
    googleModel: string;
    openRouterApiKey: string;
    openRouterModel: string;
    temperature?: number;
    maxTokens?: number;
    structuredOutput?: OpenRouterStructuredOutputConfig;
    plugins?: OpenRouterPlugin[];
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
        const saved = getSetting<LlmBatchConfig | null>(STORAGE_KEY, null);
        if (saved) return saved;
        return {
            provider: 'openrouter',
            googleApiKey: '',
            googleModel: 'gemini-2.0-flash',
            openRouterApiKey: '',
            openRouterModel: 'z-ai/glm-4.5-air:free',
            temperature: 0.7,
            maxTokens: 2048
        };
    }

    private saveConfig() {
        setSetting(STORAGE_KEY, this._config());
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

}

