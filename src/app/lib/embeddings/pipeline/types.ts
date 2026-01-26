// src/app/lib/embeddings/pipeline/types.ts

export interface EmbeddingPipelineConfig {
    // Model selection
    defaultModel: 'small' | 'medium';

    // Processing
    batchSize: number;
    maxConcurrent: number;

    // Caching
    cacheEmbeddings: boolean;
    cacheSize: number;

    // Sync behavior
    autoSync: boolean;
    syncDebounceMs: number;
}

export const DEFAULT_PIPELINE_CONFIG: EmbeddingPipelineConfig = {
    defaultModel: 'small',
    batchSize: 16,
    maxConcurrent: 4,
    cacheEmbeddings: true,
    cacheSize: 1000,
    autoSync: true,
    syncDebounceMs: 2000,
};

export interface EmbeddingMetadata {
    nodeId: string;
    text: string;
    contentHash: string;
    model: 'small' | 'medium';
    timestamp: number;
}

export interface EmbeddingJob {
    id: string;
    nodeId: string;
    text: string;
    model: 'small' | 'medium';
    priority: 'high' | 'normal' | 'low';
    retries: number;
}
