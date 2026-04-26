// src/app/lib/embeddings/models/ModelRegistry.ts
// Model registry for embedding models - cleaned from legacy_v1

export type EmbeddingProvider = 'local' | 'gemini' | 'rust' | 'openrouter';

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
    costPer1kTokens: number; // 0 for local models

    // Local model info (if provider === 'local')
    localModel?: {
        modelId: string; // HuggingFace model ID
        quantization?: 'q8' | 'q4' | 'fp16';
        memoryMB: number; // Estimated memory usage
    };

    // OpenRouter model info (if provider === 'openrouter')
    openRouterModel?: {
        modelId: string; // OpenRouter model ID
        nativeDimensions: number; // Original model dimensions before reduction
    };

    description: string;
}

export class EmbeddingModelRegistry {
    private static models: Map<string, EmbeddingModelDefinition> = new Map([
        // ===== LOCAL MODELS (In-Browser via Transformers.js) =====
        [
            'mongodb-leaf',
            {
                id: 'mongodb-leaf',
                name: 'MDBR Leaf (384d)',
                provider: 'local',
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
                description: 'MDBR Leaf - Fastest local path at 384d. Recommended for Phoenix semantic retrieval.',
            },
        ],
        [
            'minilm-l6',
            {
                id: 'minilm-l6',
                name: 'MiniLM-L6-v2 (384d)',
                provider: 'local',
                dimensions: 384,
                maxTokens: 512,
                speed: 'fast',
                quality: 'high',
                costPer1kTokens: 0,
                localModel: {
                    modelId: 'Xenova/all-MiniLM-L6-v2',
                    quantization: 'q8',
                    memoryMB: 90,
                },
                description: 'all-MiniLM-L6-v2 via Transformers.js.',
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
                provider: 'local',
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
                description: 'BGE Small EN v1.5 - Fast 384d embeddings. Great balance of speed and quality.',
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
                description: 'BGE Small via Rust/WASM ONNX (A/B test alternative)',
            },
        ],

        // ===== CLOUD MODELS =====
        [
            'gemini-embedding-004',
            {
                id: 'gemini-embedding-004',
                name: 'Gemini Text Embedding 004',
                provider: 'gemini',
                dimensions: 768,
                maxTokens: 2048,
                speed: 'fast',
                quality: 'high',
                costPer1kTokens: 0.00001,
                description: 'Google Gemini embeddings. High quality, cloud-based.',
            },
        ],

        // ===== OPENROUTER MODELS =====
        [
            'gemini-embedding-or',
            {
                id: 'gemini-embedding-or',
                name: 'Gemini Embedding (OpenRouter)',
                provider: 'openrouter',
                dimensions: 256, // Reduced from 3072 for efficiency
                maxTokens: 8192,
                speed: 'fast',
                quality: 'high',
                costPer1kTokens: 0.00001,
                openRouterModel: {
                    modelId: 'google/gemini-embedding-001',
                    nativeDimensions: 3072,
                },
                description: 'Gemini Embedding via OpenRouter. 3072d reduced to 256d. Best for large documents.',
            },
        ],
    ]);

    static getModel(id: string): EmbeddingModelDefinition | undefined {
        return this.models.get(id);
    }

    static getLocalModels(): EmbeddingModelDefinition[] {
        return Array.from(this.models.values()).filter(m => m.provider === 'local');
    }

    static getRustModels(): EmbeddingModelDefinition[] {
        return Array.from(this.models.values()).filter(m => m.provider === 'rust');
    }

    static getCloudModels(): EmbeddingModelDefinition[] {
        return Array.from(this.models.values()).filter(
            m => m.provider !== 'local' && m.provider !== 'rust'
        );
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
