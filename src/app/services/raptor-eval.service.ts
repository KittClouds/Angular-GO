// src/app/services/raptor-eval.service.ts
// RAPTOR Evaluation Service - Uses EmbeddingEngine for embeddings

import { Injectable, signal } from '@angular/core';
import { EmbeddingEngine } from '../lib/embeddings/EmbeddingEngine';


export interface RaptorConfig {
    chunkSize?: number;
    overlap?: number;
    maxLevel?: number;
    minRouterK?: number;
    semanticChunking?: boolean;
}

export interface RaptorResult {
    docId: string;
    chunkId: string;
    chunkKey?: string;
    start: number;
    end: number;
    score: number;
    lexScore: number;
    vecScore: number;
    routerScore?: number;
    parentId?: number;
    parentText?: string;
}

export interface RaptorDocResult {
    docId: string;
    maxScore: number;
    chunks: RaptorResult[];
}

export interface RaptorStats {
    docCount: number;
    leafCount: number;
    treeCount: number;
}

export interface IngestionProgress {
    phase: 'chunking' | 'embedding' | 'ingesting' | 'building' | 'complete';
    current: number;
    total: number;
    message: string;
}

// Worker message types (subset for RAPTOR)
type RaptorWorkerMessage =
    | { type: 'INIT'; id: number }
    | { type: 'RAPTOR_INIT'; payload: { configJSON?: string }; id: number }
    | { type: 'RAPTOR_CHUNK'; payload: { docID: string; text: string }; id: number }
    | { type: 'RAPTOR_INGEST_SAB'; payload: { docID: string; count: number; dim: number; embeddings: Float32Array }; id: number }
    | { type: 'RAPTOR_BUILD_TREE'; payload: { embeddingsJSON?: string }; id: number }
    | { type: 'RAPTOR_SEARCH'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_SEARCH_AGGREGATED'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_SEARCH_LEAF_ONLY'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_GET_STATS'; id: number }
    | { type: 'RAPTOR_CLEAR'; id: number };

type RaptorWorkerResponse =
    | { type: 'INIT_COMPLETE' }
    | { type: 'RAPTOR_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'RAPTOR_CHUNK_RESULT'; id: number; payload: { success: boolean; chunks?: Array<{ text: string; start: number; end: number }>; count?: number; error?: string } }
    | { type: 'RAPTOR_INGEST_SAB_RESULT'; id: number; payload: { success: boolean; error?: string; ingestedCount: number; dim?: number } }
    | { type: 'RAPTOR_BUILD_TREE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'RAPTOR_SEARCH_RESULT'; id: number; payload: any[] }
    | { type: 'RAPTOR_SEARCH_AGGREGATED_RESULT'; id: number; payload: any[] }
    | { type: 'RAPTOR_SEARCH_LEAF_ONLY_RESULT'; id: number; payload: any[] }
    | { type: 'RAPTOR_GET_STATS_RESULT'; id: number; payload: RaptorStats }
    | { type: 'RAPTOR_CLEAR_RESULT'; id: number; payload: { success: boolean } }
    | { type: 'ERROR'; id?: number; payload: { message: string } };

export type IngestionProgressCallback = (progress: IngestionProgress) => void;

@Injectable({
    providedIn: 'root',
})
export class RaptorEvalService {
    private initialized = false;
    private worker: Worker | null = null;
    private messageHandlers = new Map<number, { resolve: Function; reject: Function }>();
    private messageCounter = 0;

    // Progress signals for UI binding
    readonly ingestionProgress = signal<IngestionProgress | null>(null);
    readonly isProcessing = signal(false);

    /**
     * Initialize the RAPTOR evaluation service.
     * Uses the existing EmbeddingEngine (mongodb-leaf model).
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        // Initialize embedding engine (uses mongodb-leaf by default)
        console.log('[RaptorEvalService] Initializing EmbeddingEngine...');
        await EmbeddingEngine.initialize();
        console.log('[RaptorEvalService] EmbeddingEngine ready');

        // Create worker
        this.worker = new Worker(new URL('../workers/gokitt.worker', import.meta.url), { type: 'module' });

        // Setup message handler
        this.worker.onmessage = (e: MessageEvent<RaptorWorkerResponse>) => {
            // Handle INIT_COMPLETE separately (no id)
            if (e.data.type === 'INIT_COMPLETE') {
                const handler = this.messageHandlers.get(0); // Use 0 as INIT id
                if (handler) {
                    this.messageHandlers.delete(0);
                    handler.resolve(undefined);
                }
                return;
            }

            const handler = this.messageHandlers.get(e.data.id!);
            if (handler) {
                this.messageHandlers.delete(e.data.id!);
                if (e.data.type === 'ERROR') {
                    handler.reject(new Error(e.data.payload.message));
                } else {
                    handler.resolve((e.data as any).payload);
                }
            }
        };

        this.worker.onerror = (e) => {
            console.error('[RaptorEvalService] Worker error:', e);
        };

        // Step 1: Initialize the worker and load WASM
        console.log('[RaptorEvalService] Sending INIT to load WASM...');
        await new Promise<void>((resolve, reject) => {
            this.messageHandlers.set(0, { resolve: () => resolve(), reject });
            this.worker!.postMessage({ type: 'INIT' });
        });
        console.log('[RaptorEvalService] WASM loaded');

        // Step 2: Initialize RAPTOR-specific logic
        const config: RaptorConfig = {
            chunkSize: 512,
            overlap: 128,
            maxLevel: 3,
            minRouterK: 50,
            semanticChunking: true, // Enable experimental semantic chunking
        } as any;

        await this.sendAndWait({
            type: 'RAPTOR_INIT',
            payload: { configJSON: JSON.stringify(config) },
            id: this.nextId(),
        });

        this.initialized = true;
        console.log('[RaptorEvalService] Initialized');
    }



    /**
     * STREAMING INGESTION: SAB Zero-Copy Ping-Pong Flow
     * 
     * Phase 1: JS sends text to Go → Go chunks it (sentence-aware) → Returns chunk texts
     * Phase 2: JS embeds all chunk texts → Writes flat Float32Array to SAB → Go reads from SAB
     * 
     * This eliminates JSON serialization for embeddings entirely.
     * 
     * @param docID Document identifier
     * @param text Full document text
     * @param onProgress Optional progress callback for UI updates
     */
    async ingestDocumentStreaming(
        docID: string,
        text: string,
        onProgress?: IngestionProgressCallback,
        _batchSize = 64
    ): Promise<void> {
        if (!this.initialized) {
            throw new Error('RaptorEvalService not initialized');
        }

        this.isProcessing.set(true);
        const startTime = Date.now();

        // ── Phase 1: Go Chunking ──────────────────────────────────────────
        this.updateProgress('chunking', 0, 1, 'Chunking document (Go)...', onProgress);

        const chunkResult = await this.sendAndWait<{
            success: boolean;
            chunks?: Array<{ text: string; start: number; end: number }>;
            count?: number;
            error?: string;
        }>({
            type: 'RAPTOR_CHUNK',
            payload: { docID, text },
            id: this.nextId(),
        });

        if (!chunkResult.success || !chunkResult.chunks || chunkResult.chunks.length === 0) {
            console.error('[RaptorEvalService] Chunking failed:', chunkResult.error);
            this.isProcessing.set(false);
            throw new Error('Chunking failed: ' + (chunkResult.error || 'no chunks'));
        }

        const chunks = chunkResult.chunks;
        const totalChunks = chunks.length;
        const chunkMs = Date.now() - startTime;
        console.log(`[RaptorEvalService] Go chunked ${docID}: ${totalChunks} chunks in ${chunkMs}ms`);

        this.updateProgress('chunking', 1, 1, `${totalChunks} chunks ready`, onProgress);

        // ── Phase 2: Embed All Chunks ─────────────────────────────────────
        this.updateProgress('embedding', 0, totalChunks, `Embedding ${totalChunks} chunks...`, onProgress);

        const chunkTexts = chunks.map(c => c.text);
        const embeddings = await EmbeddingEngine.embed(chunkTexts);
        const dim = embeddings[0]?.length || 0;
        const count = embeddings.length;

        const embedMs = Date.now() - startTime - chunkMs;
        console.log(`[RaptorEvalService] Embedded ${count} chunks (${dim}D) in ${embedMs}ms`);

        this.updateProgress('embedding', totalChunks, totalChunks, `${count} embeddings ready`, onProgress);

        // ── Phase 3: SAB Zero-Copy Ingest ──────────────────────────────────
        this.updateProgress('ingesting', 0, 1, 'Writing to SAB...', onProgress);

        // Flatten to Float32Array for zero-copy transfer
        const flat = new Float32Array(count * dim);
        for (let i = 0; i < count; i++) {
            flat.set(embeddings[i], i * dim);
        }

        const ingestResult = await this.sendAndWait<{
            success: boolean;
            error?: string;
            ingestedCount: number;
            dim?: number;
        }>({
            type: 'RAPTOR_INGEST_SAB',
            payload: {
                docID,
                count,
                dim,
                embeddings: flat,
            },
            id: this.nextId(),
        });

        if (!ingestResult.success) {
            console.error('[RaptorEvalService] SAB ingest failed:', ingestResult.error);
            this.isProcessing.set(false);
            throw new Error('SAB ingest failed: ' + ingestResult.error);
        }

        // ── Complete ──────────────────────────────────────────────────────
        const totalMs = Date.now() - startTime;
        this.updateProgress(
            'complete',
            totalChunks,
            totalChunks,
            `Ingested ${ingestResult.ingestedCount} chunks in ${totalMs}ms`,
            onProgress
        );
        this.isProcessing.set(false);

        console.log(`[RaptorEvalService] SAB ingestion complete: ${docID} (${ingestResult.ingestedCount} chunks, ${totalMs}ms, chunk=${chunkMs}ms, embed=${embedMs}ms)`);
    }

    /**
     * Build the RAPTOR tree from ingested documents.
     */
    async buildTree(): Promise<void> {
        if (!this.initialized) {
            throw new Error('RaptorEvalService not initialized');
        }

        await this.sendAndWait({
            type: 'RAPTOR_BUILD_TREE',
            payload: {},
            id: this.nextId(),
        });

        console.log('[RaptorEvalService] Tree built');
    }

    /**
     * Search using collapsed-tree retrieval.
     */
    async search(query: string, k: number = 10): Promise<RaptorResult[]> {
        if (!this.initialized) {
            throw new Error('RaptorEvalService not initialized');
        }

        const startTime = performance.now();

        // Generate query embedding using EmbeddingEngine
        const [queryVec] = await EmbeddingEngine.embed([query]);

        // Search via worker
        const results = await this.sendAndWait({
            type: 'RAPTOR_SEARCH',
            payload: {
                query,
                queryEmbeddingJSON: JSON.stringify(queryVec),
                k,
            },
            id: this.nextId(),
        });

        const latencyMs = performance.now() - startTime;
        console.log(`[RaptorEvalService] Search "${query}" in ${latencyMs.toFixed(1)}ms, ${Array.isArray(results) ? results.length : 0} results`);

        return Array.isArray(results) ? results : [];
    }

    /**
     * Search with document-level aggregation.
     */
    async searchAggregated(query: string, k: number = 10): Promise<RaptorDocResult[]> {
        if (!this.initialized) {
            throw new Error('RaptorEvalService not initialized');
        }

        const startTime = performance.now();

        const [queryVec] = await EmbeddingEngine.embed([query]);

        const results = await this.sendAndWait({
            type: 'RAPTOR_SEARCH_AGGREGATED',
            payload: {
                query,
                queryEmbeddingJSON: JSON.stringify(queryVec),
                k,
            },
            id: this.nextId(),
        });

        const latencyMs = performance.now() - startTime;
        console.log(`[RaptorEvalService] SearchAggregated "${query}" in ${latencyMs.toFixed(1)}ms, ${Array.isArray(results) ? results.length : 0} docs`);

        return Array.isArray(results) ? results : [];
    }

    /**
     * Search using leaf-only mode (no tree routing).
     */
    async searchLeafOnly(query: string, k: number = 10): Promise<RaptorResult[]> {
        if (!this.initialized) {
            throw new Error('RaptorEvalService not initialized');
        }

        const startTime = performance.now();

        const [queryVec] = await EmbeddingEngine.embed([query]);

        const results = await this.sendAndWait({
            type: 'RAPTOR_SEARCH_LEAF_ONLY',
            payload: {
                query,
                queryEmbeddingJSON: JSON.stringify(queryVec),
                k,
            },
            id: this.nextId(),
        });

        const latencyMs = performance.now() - startTime;
        console.log(`[RaptorEvalService] SearchLeafOnly "${query}" in ${latencyMs.toFixed(1)}ms, ${Array.isArray(results) ? results.length : 0} results`);

        return Array.isArray(results) ? results : [];
    }

    /**
     * Get RAPTOR index statistics (async via worker).
     */
    async getStatsAsync(): Promise<RaptorStats> {
        if (!this.initialized) {
            return { docCount: 0, leafCount: 0, treeCount: 0 };
        }

        const stats = await this.sendAndWait({
            type: 'RAPTOR_GET_STATS',
            id: this.nextId(),
        });

        return stats as RaptorStats;
    }

    /**
     * Clear the RAPTOR index.
     */
    clear(): void {
        if (this.worker) {
            this.sendAndWait({
                type: 'RAPTOR_CLEAR',
                id: this.nextId(),
            }).catch(err => console.error('[RaptorEvalService] Clear error:', err));
        }
        console.log('[RaptorEvalService] Index cleared');
    }

    // ============================================================================
    // Private Methods
    // ============================================================================

    private nextId(): number {
        return ++this.messageCounter;
    }

    private sendAndWait<T>(msg: RaptorWorkerMessage): Promise<T> {
        return new Promise((resolve, reject) => {
            this.messageHandlers.set(msg.id, { resolve, reject });
            this.worker!.postMessage(msg);
        });
    }

    private updateProgress(
        phase: IngestionProgress['phase'],
        current: number,
        total: number,
        message: string,
        onProgress?: IngestionProgressCallback
    ): void {
        const progress: IngestionProgress = { phase, current, total, message };
        this.ingestionProgress.set(progress);
        onProgress?.(progress);
    }
}


