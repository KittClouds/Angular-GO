// src/app/lib/embeddings/providers/LocalEmbeddingProvider.ts
// Transformers.js v4 based local embedding provider with WebGPU support

import { pipeline, env } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import type { IEmbeddingProvider } from './types';
import { EmbeddingModelRegistry } from '../models/ModelRegistry';
import type { EmbeddingModelDefinition } from '../models/ModelRegistry';

// Configure Transformers.js v4 for browser environment
env.allowLocalModels = false;
env.useBrowserCache = true;
const onnx = env.backends.onnx;
if (onnx?.wasm) {
    onnx.wasm.wasmPaths = '/assets/onnx/';
    // onnx.wasm.proxy = false; // Let transformers.js decide or default to false
    // onnx.wasm.numThreads = 1; // Try allowing multi-threading now that files exist
}


// WebGPU detection - disable on localhost due to CORS issues with ONNX Runtime workers
const isLocalhost = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const hasWebGPU = !isLocalhost && typeof navigator !== 'undefined' && 'gpu' in navigator;

export interface EmbeddingProgress {
    type: 'init' | 'batch' | 'complete';
    current: number;
    total: number;
    message: string;
}

export type ProgressCallback = (progress: EmbeddingProgress) => void;

export class LocalEmbeddingProvider implements IEmbeddingProvider {
    readonly name: string;
    readonly provider = 'local' as const;

    private modelId: string;
    private pipeline: FeatureExtractionPipeline | null = null;
    private modelDef: EmbeddingModelDefinition;
    private initialized = false;
    private progressCallback: ProgressCallback | null = null;

    constructor(modelId: string, progressCallback?: ProgressCallback) {
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
        this.progressCallback = progressCallback || null;
    }

    /**
     * Set progress callback for streaming updates
     */
    setProgressCallback(callback: ProgressCallback): void {
        this.progressCallback = callback;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log(`[LocalEmbeddingProvider] Loading model: ${this.name}`);
        this.progressCallback?.({
            type: 'init',
            current: 0,
            total: 1,
            message: `Loading ${this.name}...`
        });

        const hfModelId = this.modelDef.localModel!.modelId;

        // Transformers.js v4: Use WebGPU if available, fallback to WASM
        // fp32 dtype for best compatibility (q8 has protobuf issues with some models)
        const device = hasWebGPU ? 'webgpu' : 'wasm';
        console.log(`[LocalEmbeddingProvider] Using device: ${device}`);

        try {
            this.pipeline = await (pipeline as any)('feature-extraction', hfModelId, {
                dtype: 'fp32',
                device: device,
                progress_callback: (progress: any) => {
                    if (this.progressCallback && progress.status === 'progress') {
                        this.progressCallback({
                            type: 'init',
                            current: progress.loaded || 0,
                            total: progress.total || 100,
                            message: `Loading model: ${Math.round((progress.loaded / progress.total) * 100)}%`
                        });
                    }
                }
            });
        } catch (error) {
            // Fallback to WASM if WebGPU fails
            if (device === 'webgpu') {
                console.warn('[LocalEmbeddingProvider] WebGPU failed, falling back to WASM');
                this.pipeline = await (pipeline as any)('feature-extraction', hfModelId, {
                    dtype: 'fp32',
                    device: 'wasm'
                });
            } else {
                throw error;
            }
        }

        this.initialized = true;
        console.log(`[LocalEmbeddingProvider] ✓ Model loaded: ${this.name} (${device})`);
        this.progressCallback?.({
            type: 'init',
            current: 1,
            total: 1,
            message: `Model loaded: ${this.name}`
        });
    }

    isReady(): boolean {
        return this.initialized && this.pipeline !== null;
    }

    /**
     * Generate embeddings for text(s) with streaming batch processing
     * 
     * Processes in small batches to avoid memory issues with large documents.
     * Includes delays between batches for garbage collection.
     * Reports progress via callback for UI updates.
     */
    async embed(texts: string | string[]): Promise<number[][]> {
        if (!this.isReady()) {
            throw new Error('Provider not initialized');
        }

        const inputTexts = Array.isArray(texts) ? texts : [texts];

        // Process in small batches to avoid memory issues
        // Batch size of 8 is a good balance between throughput and memory
        const batchSize = 8;
        const allEmbeddings: number[][] = [];
        const totalBatches = Math.ceil(inputTexts.length / batchSize);

        for (let i = 0; i < inputTexts.length; i += batchSize) {
            const batch = inputTexts.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;

            // Report progress
            this.progressCallback?.({
                type: 'batch',
                current: batchNum,
                total: totalBatches,
                message: `Processing batch ${batchNum}/${totalBatches}`
            });

            if (inputTexts.length > batchSize && batchNum % 10 === 0) {
                console.log(`[LocalEmbedding] Processing batch ${batchNum}/${totalBatches}`);
            }

            // Generate embeddings for this batch
            const output = await this.pipeline!(batch, {
                pooling: 'mean',
                normalize: true,
            });

            // Convert to array format and store
            const batchEmbeddings = output.tolist();
            allEmbeddings.push(...batchEmbeddings);

            // Explicitly release tensor memory (v4 feature - may not exist in all versions)
            const tensor = output as any;
            if (typeof tensor.destroy === 'function') {
                tensor.destroy();
            }

            // Yield to event loop and allow GC between batches
            // This prevents memory buildup for large documents
            if (i + batchSize < inputTexts.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Report completion
        this.progressCallback?.({
            type: 'complete',
            current: totalBatches,
            total: totalBatches,
            message: `Generated ${allEmbeddings.length} embeddings`
        });

        return allEmbeddings;
    }

    /**
     * Streaming embed: yields batches as they complete
     * Ideal for large documents where you want to ingest incrementally
     */
    async *embedStream(
        texts: string[],
        batchSize = 8
    ): AsyncGenerator<{ embeddings: number[][]; batchIndex: number; totalBatches: number }> {
        if (!this.isReady()) {
            throw new Error('Provider not initialized');
        }

        const totalBatches = Math.ceil(texts.length / batchSize);

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;

            // Report progress
            this.progressCallback?.({
                type: 'batch',
                current: batchNum,
                total: totalBatches,
                message: `Processing batch ${batchNum}/${totalBatches}`
            });

            // Generate embeddings for this batch
            const output = await this.pipeline!(batch, {
                pooling: 'mean',
                normalize: true,
            });

            // Convert to array format
            const embeddings = output.tolist();

            // Explicitly release tensor memory (v4 feature - may not exist in all versions)
            const tensor = output as any;
            if (typeof tensor.destroy === 'function') {
                tensor.destroy();
            }

            // Yield this batch
            yield {
                embeddings,
                batchIndex: batchNum,
                totalBatches
            };

            // Yield to event loop for GC
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        // Report completion
        this.progressCallback?.({
            type: 'complete',
            current: totalBatches,
            total: totalBatches,
            message: 'Streaming complete'
        });
    }

    getModelInfo(): EmbeddingModelDefinition {
        return this.modelDef;
    }

    async dispose(): Promise<void> {
        // v4: Properly dispose pipeline to free WebGPU/WASM resources
        if (this.pipeline && typeof (this.pipeline as any).dispose === 'function') {
            await (this.pipeline as any).dispose();
        }
        this.pipeline = null;
        this.initialized = false;
        console.log(`[LocalEmbeddingProvider] Disposed: ${this.name}`);
    }
}
