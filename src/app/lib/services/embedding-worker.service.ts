// src/app/lib/services/embedding-worker.service.ts
// Service for managing the embedding Web Worker
// Provides non-blocking embedding generation with progress updates

import { Injectable, signal, computed } from '@angular/core';
import { EmbeddingModelRegistry } from '../embeddings/models/ModelRegistry';

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingProgress {
    type: 'init' | 'batch' | 'complete';
    current: number;
    total: number;
    message: string;
}

export interface EmbeddingBatch {
    embeddings: number[][];
    batchIndex: number;
    totalBatches: number;
}

export type EmbeddingProgressCallback = (progress: EmbeddingProgress) => void;
export type EmbeddingBatchCallback = (batch: EmbeddingBatch) => void;

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class EmbeddingWorkerService {
    private worker: Worker | null = null;
    private pendingCallbacks = new Map<number, {
        resolve: Function;
        reject: Function;
        onProgress?: EmbeddingProgressCallback;
        onBatch?: EmbeddingBatchCallback;
    }>();
    private callbackId = 0;

    // State signals
    readonly isInitialized = signal(false);
    readonly modelId = signal<string | null>(null);
    readonly device = signal<string>('wasm');
    readonly isProcessing = signal(false);
    readonly progress = signal<EmbeddingProgress | null>(null);

    // Computed
    readonly isReady = computed(() => this.isInitialized() && !this.isProcessing());

    constructor() {
        console.log('[EmbeddingWorkerService] Initialized');
    }

    /**
     * Initialize the embedding worker with a specific model
     */
    async initialize(modelId: string, onProgress?: EmbeddingProgressCallback): Promise<void> {
        if (this.isInitialized() && this.modelId() === modelId) {
            return; // Already initialized with this model
        }

        // Dispose existing worker if any
        if (this.worker) {
            await this.dispose();
        }

        const model = EmbeddingModelRegistry.getModel(modelId);
        if (!model || !model.localModel) {
            throw new Error(`Model not found or not a local model: ${modelId}`);
        }

        this.progress.set({ type: 'init', current: 0, total: 100, message: 'Starting...' });
        onProgress?.({ type: 'init', current: 0, total: 100, message: 'Starting...' });

        // Create worker
        this.worker = new Worker(new URL('../../workers/embedding.worker', import.meta.url), {
            type: 'module'
        });

        this.worker.onmessage = (e) => this.handleWorkerMessage(e);
        this.worker.onerror = (e) => {
            console.error('[EmbeddingWorkerService] Worker error:', e);
            this.progress.set(null);
        };

        // Initialize with model
        const hfModelId = model.localModel.modelId;
        const id = this.nextId();

        const promise = new Promise<void>((resolve, reject) => {
            this.pendingCallbacks.set(id, {
                resolve: () => {
                    this.isInitialized.set(true);
                    this.modelId.set(modelId);
                    resolve();
                },
                reject,
                onProgress
            });
        });

        this.worker.postMessage({
            type: 'INIT',
            payload: { modelId: hfModelId, dtype: 'fp32' },
            _id: id
        });

        return promise;
    }

    /**
     * Generate embeddings for texts (batch mode)
     */
    async embed(
        texts: string[],
        batchSize = 8,
        onProgress?: EmbeddingProgressCallback
    ): Promise<number[][]> {
        if (!this.isReady()) {
            throw new Error('Worker not ready. Call initialize() first.');
        }

        this.isProcessing.set(true);
        this.progress.set({ type: 'batch', current: 0, total: Math.ceil(texts.length / batchSize), message: 'Starting...' });

        const id = this.nextId();

        const promise = new Promise<number[][]>((resolve, reject) => {
            this.pendingCallbacks.set(id, { resolve, reject, onProgress });
        });

        this.worker!.postMessage({
            type: 'EMBED',
            payload: { texts, batchSize },
            _id: id
        });

        try {
            const result = await promise;
            this.isProcessing.set(false);
            this.progress.set({ type: 'complete', current: 1, total: 1, message: 'Complete' });
            return result;
        } catch (error) {
            this.isProcessing.set(false);
            this.progress.set(null);
            throw error;
        }
    }

    /**
     * Streaming embed: calls onBatch for each batch as it completes
     * Ideal for large documents with streaming ingestion
     */
    async embedStream(
        texts: string[],
        onBatch: EmbeddingBatchCallback,
        batchSize = 8,
        onProgress?: EmbeddingProgressCallback
    ): Promise<void> {
        if (!this.isReady()) {
            throw new Error('Worker not ready. Call initialize() first.');
        }

        this.isProcessing.set(true);
        this.progress.set({ type: 'batch', current: 0, total: Math.ceil(texts.length / batchSize), message: 'Starting...' });

        const id = this.nextId();

        const promise = new Promise<void>((resolve, reject) => {
            this.pendingCallbacks.set(id, { resolve, reject, onProgress, onBatch });
        });

        this.worker!.postMessage({
            type: 'STREAM_EMBED',
            payload: { texts, batchSize },
            _id: id
        });

        try {
            await promise;
            this.isProcessing.set(false);
            this.progress.set({ type: 'complete', current: 1, total: 1, message: 'Complete' });
        } catch (error) {
            this.isProcessing.set(false);
            this.progress.set(null);
            throw error;
        }
    }

    /**
     * Get worker status
     */
    async getStatus(): Promise<{ initialized: boolean; modelId: string | null; device: string }> {
        if (!this.worker) {
            return { initialized: false, modelId: null, device: 'wasm' };
        }

        const id = this.nextId();

        const promise = new Promise<{ initialized: boolean; modelId: string | null; device: string }>((resolve, reject) => {
            this.pendingCallbacks.set(id, { resolve, reject });
        });

        this.worker.postMessage({ type: 'GET_STATUS', _id: id });
        return promise;
    }

    /**
     * Dispose the worker
     */
    async dispose(): Promise<void> {
        if (!this.worker) return;

        const id = this.nextId();

        const promise = new Promise<void>((resolve, reject) => {
            this.pendingCallbacks.set(id, { resolve, reject });
        });

        this.worker.postMessage({ type: 'DISPOSE', _id: id });
        await promise;

        this.worker.terminate();
        this.worker = null;
        this.isInitialized.set(false);
        this.modelId.set(null);
        this.progress.set(null);
    }

    // ============================================================================
    // Private Methods
    // ============================================================================

    private nextId(): number {
        return ++this.callbackId;
    }

    private handleWorkerMessage(e: MessageEvent): void {
        const { type, payload, _id } = e.data;

        // Handle progress updates (no _id for progress messages)
        if (type === 'init_progress' || type === 'embed_progress') {
            const progress: EmbeddingProgress = {
                type: type === 'init_progress' ? 'init' : 'batch',
                current: e.data.current,
                total: e.data.total,
                message: e.data.message
            };
            this.progress.set(progress);

            // Call progress callback if registered
            if (_id !== undefined && this.pendingCallbacks.has(_id)) {
                const { onProgress } = this.pendingCallbacks.get(_id)!;
                onProgress?.(progress);
            }
            return;
        }

        // Handle stream batch updates
        if (type === 'STREAM_BATCH') {
            if (_id !== undefined && this.pendingCallbacks.has(_id)) {
                const { onBatch, onProgress } = this.pendingCallbacks.get(_id)!;
                onBatch?.(payload);
                onProgress?.({
                    type: 'batch',
                    current: payload.batchIndex,
                    total: payload.totalBatches,
                    message: `Batch ${payload.batchIndex}/${payload.totalBatches}`
                });
            }
            return;
        }

        // Handle stream complete
        if (type === 'STREAM_COMPLETE') {
            if (_id !== undefined && this.pendingCallbacks.has(_id)) {
                const { resolve } = this.pendingCallbacks.get(_id)!;
                this.pendingCallbacks.delete(_id);
                resolve();
            }
            return;
        }

        // Handle status response
        if (type === 'STATUS') {
            if (_id !== undefined && this.pendingCallbacks.has(_id)) {
                const { resolve } = this.pendingCallbacks.get(_id)!;
                this.pendingCallbacks.delete(_id);
                resolve(payload);
            }
            return;
        }

        // Handle standard responses
        if (_id !== undefined && this.pendingCallbacks.has(_id)) {
            const { resolve, reject } = this.pendingCallbacks.get(_id)!;
            this.pendingCallbacks.delete(_id);

            if (type === 'ERROR') {
                reject(new Error(payload?.message || 'Worker error'));
            } else if (type === 'INIT_COMPLETE') {
                this.device.set('wasm'); // Could be webgpu, but we don't know
                resolve();
            } else if (type === 'EMBEDDINGS') {
                resolve(payload?.embeddings);
            } else if (type === 'DISPOSED') {
                resolve();
            } else {
                resolve(payload);
            }
        }
    }
}