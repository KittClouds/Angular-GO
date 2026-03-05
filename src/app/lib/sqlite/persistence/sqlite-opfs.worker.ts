/// <reference lib="webworker" />
/**
 * OPFS Snapshot Worker — From Scratch
 *
 * Dedicated worker for OPFS file I/O.
 * Only three operations: LOAD, SAVE_SNAPSHOT, CLEAR_ALL.
 * All operations are serialized through a mutex to prevent races.
 * No Dexie. No WAL.
 */

import { SqliteOpfsAdapter } from './sqlite-opfs-core';

// ---------------------------------------------------------------------------
// Mutex — serialize all OPFS operations
// ---------------------------------------------------------------------------

class OpMutex {
    private queue: Array<() => void> = [];
    private locked = false;

    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise<void>(resolve => this.queue.push(resolve));
    }

    release(): void {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.locked = false;
        }
    }

    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

const adapter = new SqliteOpfsAdapter();
const mutex = new OpMutex();

self.onmessage = async (e: MessageEvent) => {
    const { id, type, payload } = e.data;

    try {
        switch (type) {
            case 'LOAD': {
                await mutex.withLock(async () => {
                    try {
                        const snapshot = await adapter.load();
                        self.postMessage({ id, type, success: true, data: { snapshot } });
                    } catch (err: any) {
                        self.postMessage({ id, type, success: false, error: err.message });
                    }
                });
                break;
            }

            case 'SAVE_SNAPSHOT': {
                await mutex.withLock(async () => {
                    try {
                        await adapter.saveSnapshot(payload);
                        self.postMessage({ id, type, success: true });
                    } catch (err: any) {
                        console.error('[SqliteOpfsWorker] Save failed:', err);
                        self.postMessage({ id, type, success: false, error: err.message });
                    }
                });
                break;
            }

            case 'CLEAR_ALL': {
                await mutex.withLock(async () => {
                    try {
                        await adapter.clearAll();
                        self.postMessage({ id, type, success: true });
                    } catch (err: any) {
                        self.postMessage({ id, type, success: false, error: err.message });
                    }
                });
                break;
            }

            default:
                console.warn('[SqliteOpfsWorker] Unknown message:', type);
                self.postMessage({ id, type: 'ERROR', success: false, error: `Unknown: ${type}` });
        }
    } catch (err: any) {
        console.error('[SqliteOpfsWorker] Fatal:', err);
        self.postMessage({ id, type: 'ERROR', success: false, error: err.message });
    }
};

console.log('[SqliteOpfsWorker] Worker initialized (Pure Snapshot)');
