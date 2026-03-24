/**
 * SQLite Persistence Service — From Scratch
 *
 * Angular service that orchestrates the OPFS snapshot worker.
 * Three public methods: load(), saveSnapshot(), clear().
 *
 * NO Dexie imports. NO WAL. NO sync logic.
 * This service talks exclusively to the OPFS worker.
 */

import { Injectable } from '@angular/core';

interface PendingRequest {
    resolve: (val?: any) => void;
    reject: (err: any) => void;
}

@Injectable({ providedIn: 'root' })
export class SqlitePersistenceService {
    private worker: Worker | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();

    constructor() {
        // Expose dev-mode reset commands on window
        if (typeof window !== 'undefined') {
            (window as any).kittClearOPFS = async () => {
                await this.clear();
                console.log(
                    '%c[DEV] OPFS cleared. Hard refresh now.',
                    'color: red; font-size: 16px; font-weight: bold;'
                );
            };

            (window as any).kittFactoryReset = async () => {
                console.warn(
                    '%c[DEV] Factory Reset...',
                    'color: red; font-size: 18px; font-weight: bold;'
                );
                try {
                    await this.clear();
                    console.log(
                        '%c[DEV] Factory Reset complete. Reloading...',
                        'color: lime; font-size: 16px; font-weight: bold;'
                    );
                    setTimeout(() => window.location.reload(), 500);
                } catch (e) {
                    console.error('[DEV] Factory Reset failed:', e);
                }
            };
        }
    }

    // -----------------------------------------------------------------------
    // Worker lifecycle
    // -----------------------------------------------------------------------

    async init(): Promise<void> {
        if (this.worker) return;

        console.log('[SqlitePersistence] Initializing worker...');
        this.worker = new Worker(
            new URL('./sqlite-opfs.worker.ts', import.meta.url),
            { type: 'module' }
        );

        this.worker.onmessage = (e) => this.handleMessage(e.data);
        this.worker.onerror = (e) => console.error('[SqlitePersistence] Worker error:', e);
    }

    private handleMessage(data: any): void {
        const { id, success, error, data: resultData } = data;
        const p = this.pending.get(id);
        if (!p) return;

        this.pending.delete(id);
        if (success) {
            p.resolve(resultData);
        } else {
            p.reject(new Error(error || 'Unknown worker error'));
        }
    }

    private send<T>(type: string, payload?: any, transfer?: Transferable[]): Promise<T> {
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

    // -----------------------------------------------------------------------
    // Public API — the only three methods anything should ever call
    // -----------------------------------------------------------------------

    /** Load the snapshot from OPFS. Returns { snapshot: Uint8Array | null }. */
    async load(): Promise<{ snapshot: Uint8Array | null }> {
        await this.init();
        console.log('[SqlitePersistence] Loading snapshot...');
        const result = await this.send<any>('LOAD');
        console.log(`[SqlitePersistence] Load complete. Snapshot bytes=${result?.snapshot?.byteLength || 0}`);
        return { snapshot: result.snapshot };
    }

    /** Save a full binary snapshot to OPFS. */
    async saveSnapshot(data: Uint8Array): Promise<void> {
        console.log(`[SqlitePersistence] Saving snapshot (${data.byteLength} bytes)...`);
        await this.send('SAVE_SNAPSHOT', data);
        console.log('[SqlitePersistence] Snapshot saved.');
    }

    /** Factory reset — delete all OPFS data. */
    async clear(): Promise<void> {
        await this.init();
        await this.send('CLEAR_ALL');
    }
}
