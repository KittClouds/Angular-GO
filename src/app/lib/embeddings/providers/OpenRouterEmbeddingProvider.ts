// src/app/lib/embeddings/providers/OpenRouterEmbeddingProvider.ts
// OpenRouter-based embedding provider using Gemini embeddings

import type { IEmbeddingProvider } from './types';
import { EmbeddingModelRegistry } from '../models/ModelRegistry';
import type { EmbeddingModelDefinition } from '../models/ModelRegistry';
import { LlmBatchService } from '../../services/llm-batch.service';

/**
 * OpenRouter Embedding Provider
 * 
 * Uses Gemini embeddings via OpenRouter API.
 * Supports dimension reduction from 3072 to 256 (normalized embeddings).
 */
export class OpenRouterEmbeddingProvider implements IEmbeddingProvider {
    readonly name: string;
    readonly provider = 'openrouter' as const;

    private modelId: string;
    private modelDef: EmbeddingModelDefinition;
    private initialized = false;
    private llmBatch: LlmBatchService;
    private targetDimensions: number;

    constructor(modelId: string, targetDimensions: number = 256) {
        this.modelId = modelId;
        this.targetDimensions = targetDimensions;

        const model = EmbeddingModelRegistry.getModel(modelId);
        if (!model) {
            throw new Error(`Model not found: ${modelId}`);
        }
        if (model.provider !== 'openrouter') {
            throw new Error(`Not an OpenRouter model: ${modelId}`);
        }
        this.modelDef = model;
        this.name = model.name;

        // Get LlmBatchService instance for API key
        this.llmBatch = new LlmBatchService();
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        const config = this.llmBatch.getConfig();
        if (!config.openRouterApiKey) {
            throw new Error('OpenRouter API key not configured. Please set it in Blueprint Hub > Settings.');
        }

        console.log(`[OpenRouterEmbedding] Ready with model: ${this.name}`);
        this.initialized = true;
    }

    isReady(): boolean {
        return this.initialized && !!this.llmBatch.getConfig().openRouterApiKey;
    }

    /**
     * Generate embeddings for text(s) via OpenRouter API
     * 
     * Batches texts to avoid API limits (max 2048 tokens per request roughly).
     */
    async embed(texts: string | string[]): Promise<number[][]> {
        if (!this.isReady()) {
            throw new Error('Provider not initialized');
        }

        const inputTexts = Array.isArray(texts) ? texts : [texts];
        const config = this.llmBatch.getConfig();

        // Process in batches of 10 to avoid rate limits
        const batchSize = 10;
        const allEmbeddings: number[][] = [];

        for (let i = 0; i < inputTexts.length; i += batchSize) {
            const batch = inputTexts.slice(i, i + batchSize);
            console.log(`[OpenRouterEmbedding] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(inputTexts.length / batchSize)}`);

            const embeddings = await this.embedBatch(batch, config.openRouterApiKey);
            allEmbeddings.push(...embeddings);
        }

        return allEmbeddings;
    }

    /**
     * Embed a single batch of texts
     */
    private async embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
        const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'KittClouds RAPTOR Eval'
            },
            body: JSON.stringify({
                model: this.modelDef.openRouterModel!.modelId,
                input: texts,
                encoding_format: 'float'
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenRouter embedding failed: ${response.status} - ${error}`);
        }

        const data = await response.json();

        // Extract embeddings and reduce dimensions if needed
        const embeddings: number[][] = data.data.map((item: any) => {
            const fullEmbedding = item.embedding as number[];

            // Reduce from 3072 to target dimensions (256 by default)
            // Since embeddings are normalized, we can simply truncate
            if (fullEmbedding.length > this.targetDimensions) {
                return this.reduceDimensions(fullEmbedding, this.targetDimensions);
            }
            return fullEmbedding;
        });

        return embeddings;
    }

    /**
     * Reduce embedding dimensions by truncation
     * 
     * For normalized embeddings, simple truncation works well
     * and maintains reasonable quality.
     */
    private reduceDimensions(embedding: number[], targetDims: number): number[] {
        // Simple truncation - works for normalized embeddings
        const truncated = embedding.slice(0, targetDims);

        // Re-normalize after truncation
        const norm = Math.sqrt(truncated.reduce((sum, val) => sum + val * val, 0));
        if (norm > 0) {
            for (let i = 0; i < truncated.length; i++) {
                truncated[i] /= norm;
            }
        }

        return truncated;
    }

    getModelInfo(): EmbeddingModelDefinition {
        return this.modelDef;
    }

    async dispose(): Promise<void> {
        this.initialized = false;
    }
}
