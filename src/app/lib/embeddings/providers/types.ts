// src/app/lib/embeddings/providers/types.ts

import type { EmbeddingModelDefinition, EmbeddingProvider } from '../models/ModelRegistry';

export interface IEmbeddingProvider {
    readonly name: string;
    readonly provider: EmbeddingProvider;

    /**
     * Initialize the provider (load models, connect to API, etc.)
     */
    initialize(): Promise<void>;

    /**
     * Check if provider is ready
     */
    isReady(): boolean;

    /**
     * Generate embeddings for text(s)
     */
    embed(texts: string | string[]): Promise<number[][]>;

    /**
     * Get model info
     */
    getModelInfo(): EmbeddingModelDefinition;

    /**
     * Cleanup/dispose resources
     */
    dispose(): Promise<void>;
}
