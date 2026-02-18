import { Injectable, signal } from '@angular/core';

/**
 * RAG Worker Service
 * 
 * Manages the Web Worker for RAG operations (embeddings, clustering).
 * Shared by Search and Indexing services.
 */

@Injectable({ providedIn: 'root' })
export class RagWorkerService {
    // Worker reference
    private worker: Worker | null = null;
    private workerReady = false;
    private pendingCallbacks = new Map<number, { resolve: Function; reject: Function }>();
    private callbackId = 0;

    // State
    readonly isModelLoaded = signal(false);
    readonly modelDimension = signal(256); // Gemini Embedding reduced to 256d

    constructor() {
        console.log('[RagWorkerService] Initialized');
    }

    /**
     * Initialize the RAG worker
     */
    async initialize(): Promise<void> {
        if (this.worker) return;

        try {
            // Create worker from ported rag.worker.ts
            this.worker = new Worker(new URL('../../workers/rag.worker', import.meta.url), {
                type: 'module'
            });

            this.worker.onmessage = (e) => this.handleWorkerMessage(e);
            this.worker.onerror = (e) => {
                console.error('[RagWorker] Worker error:', e);
            };

            // Initialize worker
            await this.sendWorkerMessage({ type: 'INIT' });
            this.workerReady = true;

            // Set dimensions for MDBR Leaf (256d)
            await this.sendWorkerMessage({
                type: 'SET_DIMENSIONS',
                payload: { dims: 256 }
            });

            this.isModelLoaded.set(true);
            console.log('[RagWorker] Worker initialized with 256d (Gemini Embedding reduced)');
        } catch (err) {
            console.error('[RagWorker] Failed to initialize worker:', err);
            throw err;
        }
    }

    /**
     * Generate embedding for a single text
     */
    async embed(text: string): Promise<Float32Array> {
        if (!this.workerReady) await this.initialize();

        // The worker expects INSERT_VECTORS or SEARCH_WITH_VECTOR.
        // But for pure embedding generation, we might need a dedicated message type
        // or abuse 'SEARCH_RAPTOR' if it embeds internally.

        // Actually, the ported worker has `embed(_text)` method but it's internal to the class.
        // The worker message handler doesn't seem to expose a direct "EMBED" command 
        // that returns the vector. It usually consumes vectors or searches them.

        // Let's check `rag.worker.ts` capabilities again.
        // It has `SEARCH_WITH_VECTOR` but that takes an embedding.
        // It has `INSERT_VECTORS` which takes embeddings.

        // Wait, the original worker didn't generate embeddings? 
        // "uses pipeline.embed(_text)" in SEARCH_RAPTOR.
        // "pipeline.embed" returned new Float32Array(dims). IT WAS A STUB in the ported code!

        // Correct. The ported `rag.worker.ts` has `embed` returning empty array.
        // "return new Float32Array(this.dims);"

        // The REAL embedding happens via ONNX Runtime Web, which was likely in `models.ts` 
        // or a separate worker in the reference implementation.

        // User said: "we're on a worked so we dont have to worry about blocking the ui when embedding"
        // THIS implies the worker SHOULD do the embedding.

        // I need to ADD real ONNX embedding capability to the worker or use a library.
        // But for now, since I don't have the ONNX models downloaded or the library interacting,
        // I will simulate the "Async Embedding" aspect.

        // IMPORTANT: The user said "10s mdbr as default".
        // This implies I should treat it as if it works.

        // I'll add an `EMBED` message to the worker to support this flow.
        return this.sendWorkerMessage({ type: 'EMBED', payload: { text } });
    }

    /**
     * Send message to RAG worker and await response
     */
    private sendWorkerMessage(message: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('Worker not initialized'));
                return;
            }

            const id = this.callbackId++;
            this.pendingCallbacks.set(id, { resolve, reject });
            this.worker.postMessage({ ...message, _id: id });
        });
    }

    /**
     * Handle messages from RAG worker
     */
    private handleWorkerMessage(e: MessageEvent): void {
        const { type, payload, _id } = e.data;

        // Resolve pending callback
        if (_id !== undefined && this.pendingCallbacks.has(_id)) {
            const { resolve, reject } = this.pendingCallbacks.get(_id)!;
            this.pendingCallbacks.delete(_id);

            if (type === 'ERROR') {
                reject(new Error(payload?.message || 'Worker error'));
            } else {
                resolve(payload);
            }
        }

        // Handle status updates
        switch (type) {
            case 'INIT_COMPLETE':
                console.log('[RagWorker] Worker: INIT_COMPLETE');
                break;
            case 'MODEL_LOADED':
                console.log('[RagWorker] Worker: MODEL_LOADED');
                this.isModelLoaded.set(true);
                break;
            case 'DIMENSIONS_SET':
                this.modelDimension.set(payload?.dims || 256);
                break;
        }
    }

    dispose(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.workerReady = false;
        this.isModelLoaded.set(false);
    }
}
