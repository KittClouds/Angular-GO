// src/app/lib/embeddings/models/ModelRegistry.ts
// Model registry for semantic embedding runner targets.

export type EmbeddingProvider = 'rust';

export interface EmbeddingModelDefinition {
    id: string;
    name: string;
    provider: EmbeddingProvider;
    dimensions: number;
    maxTokens: number;

    // Performance characteristics
    speed: 'fast' | 'medium' | 'slow';
    quality: 'high' | 'medium' | 'low';

    // Cost
    costPer1kTokens: number; // 0 for native runner models

    // Native runner model metadata.
    localModel?: {
        modelId: string;
        quantization?: 'q8' | 'q4' | 'fp16';
        memoryMB: number; // Estimated memory usage
    };

    description: string;
}

export class EmbeddingModelRegistry {
    private static models: Map<string, EmbeddingModelDefinition> = new Map([
        // ===== NATIVE RUST RUNNER MODELS =====
        [
            'mongodb-leaf',
            {
                id: 'mongodb-leaf',
                name: 'MDBR Leaf (384d)',
                provider: 'rust',
                dimensions: 384,
                maxTokens: 512,
                speed: 'fast',
                quality: 'high',
                costPer1kTokens: 0,
                localModel: {
                    modelId: 'MongoDB/mdbr-leaf-ir',
                    quantization: 'q8',
                    memoryMB: 50,
                },
                description: 'MDBR Leaf through the native Phoenix Rust semantic runner.',
            },
        ],
        [
            'jina-v5-nano-retrieval',
            {
                id: 'jina-v5-nano-retrieval',
                name: 'Jina Embeddings v5 Nano Retrieval (768d)',
                provider: 'rust',
                dimensions: 768,
                maxTokens: 1024,
                speed: 'fast',
                quality: 'high',
                costPer1kTokens: 0,
                localModel: {
                    modelId: 'jinaai/jina-embeddings-v5-text-nano-retrieval',
                    quantization: 'fp16',
                    memoryMB: 220,
                },
                description: 'Jina v5 retrieval-tuned embeddings through the native Rust ONNX runner.',
            },
        ],
        [
            'bge-small-en',
            {
                id: 'bge-small-en',
                name: 'BGE Small EN v1.5 (384d)',
                provider: 'rust',
                dimensions: 384,
                maxTokens: 512,
                speed: 'fast',
                quality: 'high',
                costPer1kTokens: 0,
                localModel: {
                    modelId: 'BAAI/bge-small-en-v1.5',
                    quantization: 'fp16',
                    memoryMB: 130,
                },
                description: 'BGE Small EN v1.5 through the native Phoenix Rust semantic runner.',
            },
        ],

        // ===== RUST/WASM MODELS (kittcore EmbedCortex) =====
        [
            'bge-small-rust',
            {
                id: 'bge-small-rust',
                name: 'BGE Small EN v1.5 (Rust)',
                provider: 'rust',
                dimensions: 384,
                maxTokens: 512,
                speed: 'fast',
                quality: 'high',
                costPer1kTokens: 0,
                localModel: {
                    modelId: 'BAAI/bge-small-en-v1.5',
                    memoryMB: 130,
                },
                description: 'BGE Small via Rust/WASM ONNX.',
            },
        ],

    ]);

    static getModel(id: string): EmbeddingModelDefinition | undefined {
        return this.models.get(id);
    }

    static getLocalModels(): EmbeddingModelDefinition[] {
        return [];
    }

    static getRustModels(): EmbeddingModelDefinition[] {
        return Array.from(this.models.values()).filter(m => m.provider === 'rust');
    }

    static getCloudModels(): EmbeddingModelDefinition[] {
        return [];
    }

    static getByDimension(dim: number): EmbeddingModelDefinition[] {
        return Array.from(this.models.values()).filter(m => m.dimensions === dim);
    }

    static getAllModels(): EmbeddingModelDefinition[] {
        return Array.from(this.models.values());
    }

    static getRecommended(preference: 'speed' | 'quality' | 'privacy'): string {
        switch (preference) {
            case 'speed':
                return 'mongodb-leaf';
            case 'quality':
                return 'mongodb-leaf';
            case 'privacy':
                return 'mongodb-leaf';
            default:
                return 'mongodb-leaf';
        }
    }
}
