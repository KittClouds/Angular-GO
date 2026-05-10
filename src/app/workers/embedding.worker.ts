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

interface FlatEmbeddingBatch {
    values: Float32Array;
    rows: number;
    dims: number;
    batchIndex: number;
    totalBatches: number;
}

type WorkerMessage =
    | { type: 'INIT'; payload: InitPayload; _id: number }
    | { type: 'EMBED'; payload: EmbedPayload; _id: number }
    | { type: 'EMBED_FLAT'; payload: EmbedPayload; _id: number }
    | { type: 'STREAM_EMBED'; payload: StreamEmbedPayload; _id: number }
    | { type: 'STREAM_EMBED_FLAT'; payload: StreamEmbedPayload; _id: number }
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
    type: 'INIT_COMPLETE' | 'EMBEDDINGS' | 'EMBEDDINGS_FLAT' | 'STREAM_BATCH' | 'STREAM_FLAT_BATCH' | 'STREAM_COMPLETE' | 'DISPOSED' | 'STATUS' | 'ERROR';
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
            this.sendResponse({ type: 'INIT_COMPLETE', payload: this.getStatus(), _id });
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
            this.sendResponse({ type: 'INIT_COMPLETE', payload: this.getStatus(), _id });
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
                this.sendResponse({ type: 'INIT_COMPLETE', payload: this.getStatus(), _id });
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

    async embedFlat(payload: EmbedPayload, _id: number): Promise<FlatEmbeddingBatch> {
        if (!this.initialized || !this.pipeline) {
            throw new Error('Worker not initialized');
        }

        const { texts, batchSize = 8 } = payload;
        const batches: FlatEmbeddingBatch[] = [];
        let dims = 0;
        let rows = 0;
        const totalBatches = Math.ceil(texts.length / batchSize);

        for await (const batch of this.streamEmbedFlat({ texts, batchSize }, _id)) {
            batches.push(batch);
            dims = batch.dims;
            rows += batch.rows;
        }

        const values = new Float32Array(rows * dims);
        let offset = 0;
        for (const batch of batches) {
            values.set(batch.values, offset);
            offset += batch.values.length;
        }
        return { values, rows, dims, batchIndex: 1, totalBatches };
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

    async *streamEmbedFlat(payload: StreamEmbedPayload, _id: number): AsyncGenerator<FlatEmbeddingBatch> {
        if (!this.initialized || !this.pipeline) {
            throw new Error('Worker not initialized');
        }

        const { texts, batchSize = 8 } = payload;
        const totalBatches = Math.ceil(texts.length / batchSize);

        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            const output = await this.pipeline(batch, {
                pooling: 'mean',
                normalize: true,
            });

            const flat = tensorToFlatBatch(output, batch.length, batchNum, totalBatches);
            const tensor = output as any;
            if (typeof tensor.destroy === 'function') {
                tensor.destroy();
            }

            yield flat;
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

            case 'EMBED_FLAT': {
                const batch = await worker.embedFlat(payload, _id);
                self.postMessage({ type: 'EMBEDDINGS_FLAT', payload: batch, _id }, [batch.values.buffer]);
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

            case 'STREAM_EMBED_FLAT': {
                const generator = worker.streamEmbedFlat(payload, _id);
                for await (const batch of generator) {
                    self.postMessage({
                        type: 'STREAM_FLAT_BATCH',
                        payload: batch,
                        _id
                    }, [batch.values.buffer]);
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

function tensorToFlatBatch(output: any, expectedRows: number, batchIndex: number, totalBatches: number): FlatEmbeddingBatch {
    const dims = Array.isArray(output?.dims) ? output.dims : [];
    const rows = dims.length >= 2 ? Number(dims[0]) : expectedRows;
    const width = dims.length >= 2 ? Number(dims[dims.length - 1]) : 0;
    const raw = output?.data;
    if (raw && typeof raw.length === 'number') {
        const values = raw instanceof Float32Array ? new Float32Array(raw) : Float32Array.from(raw as ArrayLike<number>);
        return {
            values,
            rows: rows || expectedRows,
            dims: width || Math.floor(values.length / Math.max(1, rows || expectedRows)),
            batchIndex,
            totalBatches,
        };
    }

    const nested = output.tolist() as number[][];
    const fallbackRows = nested.length;
    const fallbackDims = nested[0]?.length || 0;
    const values = new Float32Array(fallbackRows * fallbackDims);
    for (let row = 0; row < fallbackRows; row++) {
        values.set(nested[row], row * fallbackDims);
    }
    return { values, rows: fallbackRows, dims: fallbackDims, batchIndex, totalBatches };
}

console.log('[EmbeddingWorker] Worker script loaded');
