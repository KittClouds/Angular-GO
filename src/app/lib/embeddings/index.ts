// src/app/lib/embeddings/index.ts
// Main exports for embeddings module

export { embeddingService, type EmbeddingModel, type EmbeddingConfig, DEFAULT_EMBEDDING_CONFIG } from './embeddingService';
export { EmbeddingEngine } from './EmbeddingEngine';
export { EmbeddingModelRegistry, type EmbeddingModelDefinition, type EmbeddingProvider } from './models/ModelRegistry';
export { modelCache, type CachedModel } from './model-cache';
export type { IEmbeddingProvider } from './providers/types';
export { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';
export { RustEmbeddingProvider } from './providers/RustEmbeddingProvider';
export { type EmbeddingPipelineConfig, DEFAULT_PIPELINE_CONFIG, type EmbeddingJob } from './pipeline/types';
export { EmbeddingQueue } from './pipeline/queue';
