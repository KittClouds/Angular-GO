/// <reference lib="webworker" />
// src/app/workers/embedding.worker.ts
// Dedicated embedding worker using Transformers.js v4
// Keeps UI thread free during heavy embedding operations

import { pipeline, env } from '@huggingface/transformers';

// ============================================================================
// Configuration
// ============================================================================

// Configure Transformers.js for browser worker environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// WebGPU detection in worker context
const hasWebGPU = typeof self !== 'undefined' && 'gpu' in (self as any).navigator;

// ============================================================================
// Types
// ============================================================================

interface InitPayload {
    modelId: string;
    dtype?: 'fp32' | 'fp16' | 'q8' | 'q4';
    device?: 'webgpu' | 'wasm';
}

interface EmbedPayload {
    texts: string[];
    batchSize?: number;
}

interface StreamEmbedPayload {
    texts: string[];
    batchSize?: number;
}

type WorkerMessage =
    | { type: 'INIT'; payload: InitPayload; _id: number }
    | { type: 'EMBED'; payload: EmbedPayload; _id: number }
    | { type: 'STREAM_EMBED'; payload: StreamEmbedPayload; _id: number }
    | { type: 'DISPOSE'; payload?: never; _id: number }
    | { type: 'GET_STATUS'; payload?: never; _id: number };

interface ProgressUpdate {
    type: 'init_progress' | 'embed_progress' | 'stream_batch';
    current: number;
    total: number;
    message: string;
    _id: number;
}

interface ResponseMessage {
    type: 'INIT_COMPLETE' | 'EMBEDDINGS' | 'STREAM_BATCH' | 'STREAM_COMPLETE' | 'DISPOSED' | 'STATUS' | 'ERROR';
    payload?: any;
    _id: number;
}

// ============================================================================
// Embedding Worker
// ============================================================================

class EmbeddingWorker {
    private pipeline: any = null;
    private modelId: string | null = null;
    private initialized = false;
    private device: 'webgpu' | 'wasm' = 'wasm';

    async initialize(payload: InitPayload, _id: number): Promise<void> {
        if (this.initialized) {
            this.sendResponse({ type: 'INIT_COMPLETE', _id });
            return;
        }

        this.modelId = payload.modelId;
        const dtype = payload.dtype || 'fp32';
        this.device = payload.device || (hasWebGPU ? 'webgpu' : 'wasm');

        console.log(`[EmbeddingWorker] Loading model: ${this.modelId} (${this.device})`);
        this.sendProgress({ type: 'init_progress', current: 0, total: 100, message: 'Loading model...', _id });

        try {
            this.pipeline = await pipeline('feature-extraction', this.modelId, {
                dtype,
                device: this.device,
                progress_callback: (progress: any) => {
                    if (progress.status === 'progress') {
                        this.sendProgress({
                            type: 'init_progress',
                            current: progress.loaded || 0,
                            total: progress.total || 100,
                            message: `Loading: ${Math.round((progress.loaded / progress.total) * 100)}%`,
                            _id
                        });
                    }
                }
            });

            this.initialized = true;
            console.log(`[EmbeddingWorker] Model loaded: ${this.modelId}`);
            this.sendResponse({ type: 'INIT_COMPLETE', _id });
        } catch (error: any) {
            // Fallback to WASM if WebGPU fails
            if (this.device === 'webgpu') {
                console.warn('[EmbeddingWorker] WebGPU failed, falling back to WASM');
                this.device = 'wasm';
                this.pipeline = await pipeline('feature-extraction', this.modelId!, {
                    dtype,
                    device: 'wasm'
                });
                this.initialized = true;
                this.sendResponse({ type: 'INIT_COMPLETE', _id });
            } else {
                throw error;
            }
        }
    }

    async embed(payload: EmbedPayload, _id: number): Promise<number[][]> {
        if (!this.initialized || !this.pipeline) {
            throw new Error('Worker not initialized');
        }

        const { texts, batchSize = 8 } = payload;
        const allEmbeddings: number[][] = [];
        const totalBatches = Math.ceil(texts.length / batchSize);

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;

            // Send progress update
            this.sendProgress({
                type: 'embed_progress',
                current: batchNum,
                total: totalBatches,
                message: `Processing batch ${batchNum}/${totalBatches}`,
                _id
            });

            // Generate embeddings
            const output = await this.pipeline(batch, {
                pooling: 'mean',
                normalize: true,
            });

            // Convert to arrays
            const batchEmbeddings = output.tolist();
            allEmbeddings.push(...batchEmbeddings);

            // Release tensor memory if available
            const tensor = output as any;
            if (typeof tensor.destroy === 'function') {
                tensor.destroy();
            }

            // Yield for GC
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        return allEmbeddings;
    }

    /**
     * Streaming embed: sends batches as they complete
     */
    async *streamEmbed(payload: StreamEmbedPayload, _id: number): AsyncGenerator<{ embeddings: number[][]; batchIndex: number; totalBatches: number }> {
        if (!this.initialized || !this.pipeline) {
            throw new Error('Worker not initialized');
        }

        const { texts, batchSize = 8 } = payload;
        const totalBatches = Math.ceil(texts.length / batchSize);

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;

            // Generate embeddings
            const output = await this.pipeline(batch, {
                pooling: 'mean',
                normalize: true,
            });

            const embeddings = output.tolist();

            // Release tensor memory
            const tensor = output as any;
            if (typeof tensor.destroy === 'function') {
                tensor.destroy();
            }

            yield { embeddings, batchIndex: batchNum, totalBatches };

            // Yield for GC
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }

    async dispose(_id: number): Promise<void> {
        if (this.pipeline && typeof this.pipeline.dispose === 'function') {
            await this.pipeline.dispose();
        }
        this.pipeline = null;
        this.modelId = null;
        this.initialized = false;
        console.log('[EmbeddingWorker] Disposed');
        this.sendResponse({ type: 'DISPOSED', _id });
    }

    getStatus(): { initialized: boolean; modelId: string | null; device: string } {
        return {
            initialized: this.initialized,
            modelId: this.modelId,
            device: this.device
        };
    }

    private sendResponse(message: ResponseMessage): void {
        self.postMessage(message);
    }

    private sendProgress(update: ProgressUpdate): void {
        self.postMessage(update);
    }
}

// ============================================================================
// Message Handler
// ============================================================================

const worker = new EmbeddingWorker();

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { type, payload, _id } = e.data;

    try {
        switch (type) {
            case 'INIT': {
                await worker.initialize(payload, _id);
                break;
            }

            case 'EMBED': {
                const embeddings = await worker.embed(payload, _id);
                self.postMessage({ type: 'EMBEDDINGS', payload: { embeddings }, _id });
                break;
            }

            case 'STREAM_EMBED': {
                const generator = worker.streamEmbed(payload, _id);
                for await (const batch of generator) {
                    self.postMessage({
                        type: 'STREAM_BATCH',
                        payload: batch,
                        _id
                    });
                }
                self.postMessage({ type: 'STREAM_COMPLETE', _id });
                break;
            }

            case 'DISPOSE': {
                await worker.dispose(_id);
                break;
            }

            case 'GET_STATUS': {
                const status = worker.getStatus();
                self.postMessage({ type: 'STATUS', payload: status, _id });
                break;
            }
        }
    } catch (error: any) {
        self.postMessage({
            type: 'ERROR',
            payload: { message: error.message || 'Unknown error' },
            _id
        });
    }
};

console.log('[EmbeddingWorker] Worker script loaded');
