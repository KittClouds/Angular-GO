/**
 * Sqlite Persistence Service (Snapshot Native)
 * 
 * Orchestrator for SQLite persistence using the "Snapshot Native" architecture:
 * - Snapshot (Binary): Atomic full-database saves to OPFS.
 * - WAL REMOVED: No incremental writes, no replay, no compaction.
 * 
 * This service manages the worker thread and ensures data durability.
 */

import { Injectable } from '@angular/core';


type PendingRequest = {
    resolve: (val?: any) => void;
    reject: (err: any) => void;
};


export type LoadResult = {
    snapshot: Uint8Array | null;
    // WAL removed - Snapshot Native
};

@Injectable({
    providedIn: 'root'
})
export class SqlitePersistenceService {

    private worker: Worker | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();

    // WAL Buffer & Compaction removed - Snapshot Native



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
     * Load Snapshot from OPFS (Legacy support for LoadResult type for now)
     */
    async load(): Promise<{ snapshot: Uint8Array | null }> {
        await this.init();
        // We only care about the snapshot now.
        const result = await this.sendToWorker<any>('LOAD');
        return { snapshot: result.snapshot };
    }

    /**
     * Save a full binary snapshot
     * @param data The full SQLite database as Uint8Array
     */
    async saveSnapshot(data: Uint8Array): Promise<void> {
        console.log(`[SqlitePersistence] Saving snapshot (${data.byteLength} bytes)...`);
        // Zero-copy transfer
        await this.sendToWorker('SAVE_SNAPSHOT', data, [data.buffer]);
        console.log('[SqlitePersistence] Snapshot saved.');
    }

    /**
     * Clear all persistence (Factory Reset)
     */
    async clear(): Promise<void> {
        await this.init();
        await this.sendToWorker('CLEAR_ALL');
    }
}
