// src/app/lib/embeddings/EmbeddingEngine.ts
// Unified Embedding Engine - orchestrates providers

import type { IEmbeddingProvider } from './providers/types';
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';
import { EmbeddingModelRegistry } from './models/ModelRegistry';

/**
 * Unified Embedding Engine
 * 
 * Provides embeddings from local models (Transformers.js) or Rust/WASM models.
 */
export class EmbeddingEngine {
    private static providers: Map<string, IEmbeddingProvider> = new Map();
    private static currentProvider: IEmbeddingProvider | null = null;

    /**
     * Initialize embedding engine with configured model
     */
    static async initialize(modelId?: string): Promise<void> {
        const targetModelId = modelId || 'mongodb-leaf';

        // Check if already initialized with this model
        if (this.currentProvider?.getModelInfo().id === targetModelId) {
            return;
        }

        // Get or create provider
        let provider = this.providers.get(targetModelId);

        if (!provider) {
            const model = EmbeddingModelRegistry.getModel(targetModelId);
            if (!model) {
                throw new Error(`Unknown embedding model: ${targetModelId}`);
            }

            // Create appropriate provider
            switch (model.provider) {
                case 'local':
                    provider = new LocalEmbeddingProvider(targetModelId);
                    break;
                case 'rust': {
                    // Lazy import to avoid loading WASM unless needed
                    const { RustEmbeddingProvider } = await import('./providers/RustEmbeddingProvider');
                    provider = new RustEmbeddingProvider(targetModelId);
                    break;
                }
                default:
                    throw new Error(`Unsupported provider: ${model.provider}`);
            }

            this.providers.set(targetModelId, provider);
        }

        // Initialize provider
        await provider.initialize();
        this.currentProvider = provider;
    }

    /**
     * Generate embeddings for text(s)
     */
    static async embed(texts: string | string[]): Promise<number[][]> {
        if (!this.currentProvider) {
            await this.initialize();
        }

        return this.currentProvider!.embed(texts);
    }

    /**
     * Get current model info
     */
    static getCurrentModel(): string {
        return this.currentProvider?.getModelInfo().id || 'none';
    }

    /**
     * Get current model dimensions
     */
    static getDimensions(): number {
        if (!this.currentProvider) {
            throw new Error('Embedding engine not initialized');
        }
        return this.currentProvider.getModelInfo().dimensions;
    }

    /**
     * Get dimensions (safe version)
     */
    static getDimensionsSafe(): number {
        return this.currentProvider?.getModelInfo().dimensions ?? 0;
    }

    /**
     * Check if engine is ready
     */
    static isReady(): boolean {
        return this.currentProvider?.isReady() ?? false;
    }

    /**
     * Switch to different model
     */
    static async switchModel(modelId: string): Promise<void> {
        await this.initialize(modelId);
    }

    /**
     * Get the active provider type for routing
     */
    static getActiveProviderType(): 'rust' | 'local' | 'cloud' | 'none' {
        if (!this.currentProvider) {
            return 'none';
        }

        const modelInfo = this.currentProvider.getModelInfo();
        if (modelInfo.provider === 'rust') {
            return 'rust';
        } else if (modelInfo.provider === 'local') {
            return 'local';
        } else if (modelInfo.provider === 'gemini') {
            return 'cloud';
        }

        return 'local';
    }

    /**
     * Cleanup
     */
    static async dispose(): Promise<void> {
        for (const provider of this.providers.values()) {
            await provider.dispose();
        }
        this.providers.clear();
        this.currentProvider = null;
    }
}
