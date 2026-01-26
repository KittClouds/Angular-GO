// src/app/lib/embeddings/providers/LocalEmbeddingProvider.ts
// Transformers.js based local embedding provider

import { pipeline } from '@xenova/transformers';
import type { FeatureExtractionPipeline } from '@xenova/transformers';
import type { IEmbeddingProvider } from './types';
import { EmbeddingModelRegistry } from '../models/ModelRegistry';
import type { EmbeddingModelDefinition } from '../models/ModelRegistry';

export class LocalEmbeddingProvider implements IEmbeddingProvider {
    readonly name: string;
    readonly provider = 'local' as const;

    private modelId: string;
    private pipeline: FeatureExtractionPipeline | null = null;
    private modelDef: EmbeddingModelDefinition;
    private initialized = false;

    constructor(modelId: string) {
        this.modelId = modelId;
        const model = EmbeddingModelRegistry.getModel(modelId);
        if (!model) {
            throw new Error(`Model not found: ${modelId}`);
        }
        if (model.provider !== 'local') {
            throw new Error(`Not a local model: ${modelId}`);
        }
        this.modelDef = model;
        this.name = model.name;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log(`[LocalEmbeddingProvider] Loading model: ${this.name}`);

        const hfModelId = this.modelDef.localModel!.modelId;

        // Load model via Transformers.js
        this.pipeline = (await pipeline('feature-extraction', hfModelId, {
            quantized: this.modelDef.localModel!.quantization === 'q8',
        })) as FeatureExtractionPipeline;

        this.initialized = true;
        console.log(`[LocalEmbeddingProvider] ✓ Model loaded: ${this.name}`);
    }

    isReady(): boolean {
        return this.initialized && this.pipeline !== null;
    }

    async embed(texts: string | string[]): Promise<number[][]> {
        if (!this.isReady()) {
            throw new Error('Provider not initialized');
        }

        const inputTexts = Array.isArray(texts) ? texts : [texts];

        // Generate embeddings
        const output = await this.pipeline!(inputTexts, {
            pooling: 'mean',
            normalize: true,
        });

        // Convert to array format
        return output.tolist();
    }

    getModelInfo(): EmbeddingModelDefinition {
        return this.modelDef;
    }

    async dispose(): Promise<void> {
        this.pipeline = null;
        this.initialized = false;
    }
}
