/**
 * Sqlite Persistence Service (Enterprise WAL)
 * 
 * Orchestrator for SQLite persistence using the "Dream FS" architecture:
 * 1. Snapshot (Binary): Full database checkpoints.
 * 2. WAL (JSONL): Ledger of individual mutations for crash recovery.
 * 
 * This service manages the worker thread and ensures data durability.
 */

import { Injectable } from '@angular/core';
import type { WalEntry } from './sqlite-opfs-core';

type PendingRequest = {
    resolve: (val?: any) => void;
    reject: (err: any) => void;
};

export type LoadResult = {
    snapshot: Uint8Array | null;
    wal: WalEntry[];
    recoveryMode: boolean;
};

@Injectable({
    providedIn: 'root'
})
export class SqlitePersistenceService {
    private worker: Worker | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();

    // WAL Buffer for debouncing
    private walBuffer: WalEntry[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly FLUSH_DELAY_MS = 500;

    constructor() { }

    /**
     * Initialize the persistence worker
     */
    async init(): Promise<void> {
        if (this.worker) return;

        console.log('[SqlitePersistence] Initializing worker...');
        this.worker = new Worker(
            new URL('./sqlite-opfs.worker.ts', import.meta.url),
            { type: 'module' }
        );

        this.worker.onmessage = (e) => this.handleMessage(e.data);
        this.worker.onerror = (e) => {
            console.error('[SqlitePersistence] Worker error:', e);
        };
    }

    private handleMessage(data: any) {
        const { id, success, error, data: resultData } = data;
        const pending = this.pending.get(id);
        if (!pending) return;

        this.pending.delete(id);
        if (success) {
            pending.resolve(resultData);
        } else {
            pending.reject(new Error(error || 'Unknown worker error'));
        }
    }

    private sendToWorker<T>(type: string, payload?: any, transfer?: Transferable[]): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('[SqlitePersistence] Worker not initialized'));
                return;
            }

            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, payload }, transfer || []);
        });
    }

    /**
     * Load Snapshot and WAL from OPFS
     */
    async load(): Promise<LoadResult> {
        await this.init();
        return await this.sendToWorker<LoadResult>('LOAD');
    }

    /**
     * Append a mutation to the WAL
     * @param op Operation type (e.g., 'upsertNote')
     * @param data The data object
     */
    appendWal(op: string, data: any): void {
        const entry: WalEntry = {
            ts: Date.now(),
            op,
            data
        };

        this.walBuffer.push(entry);

        // meaningful buffer size check
        if (this.walBuffer.length >= 50) {
            this.flushWal();
            return;
        }
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushWal();
        }, this.FLUSH_DELAY_MS);
    }

    private async flushWal(): Promise<void> {
        this.flushTimer = null;
        if (this.walBuffer.length === 0) return;

        const entries = [...this.walBuffer];
        this.walBuffer = [];

        // Batch append
        try {
            await this.sendToWorker('APPEND_WAL_BATCH', entries);
        } catch (e) {
            console.error('[SqlitePersistence] Failed to append WAL batch:', e);
            // Re-queue creates risk of order issues if we don't pause, 
            // but for simple crash recovery, losing limits is acceptable vs blocking
        }
    }

    /**
     * Save a full binary snapshot and truncate WAL
     * @param data The full SQLite database as Uint8Array
     */
    async compact(data: Uint8Array): Promise<void> {
        // Flush pending WAL first
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        await this.flushWal();

        console.log(`[SqlitePersistence] Compacting (${data.byteLength} bytes)...`);

        // Zero-copy transfer of the buffer to the worker
        // This means main thread loses ownership of 'data' buffer!
        // Copy if you need to keep it, but here we assume Export() created a fresh copy.
        await this.sendToWorker('SAVE_SNAPSHOT', data, [data.buffer]);

        // Truncate WAL
        await this.sendToWorker('TRUNCATE_WAL');
        console.log('[SqlitePersistence] Compaction complete');
    }

    /**
     * Clear all persistence (Factory Reset)
     */
    async clear(): Promise<void> {
        await this.init();
        await this.sendToWorker('CLEAR_ALL');
    }
}
