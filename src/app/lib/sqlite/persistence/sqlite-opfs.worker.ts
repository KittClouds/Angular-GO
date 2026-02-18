/// <reference lib="webworker" />
import { SqliteOpfsAdapter } from './sqlite-opfs-core';

// ==========================================
// Async Mutex - Serialize OPFS operations
// ==========================================

class OpMutex {
    private queue: Array<() => void> = [];
    private locked = false;

    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }

        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
        } else {
            this.locked = false;
        }
    }

    /**
     * Execute fn with exclusive lock
     */
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

// ==========================================
// Worker Handler
// ==========================================

const adapter = new SqliteOpfsAdapter();
const mutex = new OpMutex();


self.onmessage = async (e: MessageEvent) => {
    const { id, type, payload } = e.data;

    try {
        switch (type) {
            case 'LOAD': {
                // LOAD needs mutex for consistency
                await mutex.withLock(async () => {
                    try {
                        const result = await adapter.load();
                        self.postMessage({ id, type, success: true, data: result });
                    } catch (err: any) {
                        self.postMessage({ id, type, success: false, error: err.message });
                    }
                });
                break;
            }

            case 'APPEND_WAL_BATCH': {
                await mutex.withLock(async () => {
                    try {
                        const entries = payload;
                        if (entries && entries.length > 0) {
                            await adapter.appendWalBatch(entries);
                        }
                        self.postMessage({ id, type, success: true });
                    } catch (err: any) {
                        console.error("[SqliteOpfsWorker] Append WAL batch failed", err);
                        self.postMessage({ id, type, success: false, error: err.message });
                    }
                });
                break;
            }

            case 'SAVE_SNAPSHOT': {
                await mutex.withLock(async () => {
                    try {
                        const dataUrl = payload; // or Uint8Array
                        await adapter.saveSnapshot(dataUrl);
                        self.postMessage({ id, type, success: true });
                    } catch (err: any) {
                        console.error("[SqliteOpfsWorker] Save snapshot failed", err);
                        self.postMessage({ id, type, success: false, error: err.message });
                    }
                });
                break;
            }

            case 'TRUNCATE_WAL': {
                await mutex.withLock(async () => {
                    try {
                        await adapter.truncateWal();
                        self.postMessage({ id, type, success: true });
                    } catch (err: any) {
                        console.error("[SqliteOpfsWorker] Truncate WAL failed", err);
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
                console.warn("[SqliteOpfsWorker] Unknown message type:", type);
                self.postMessage({ id, type: 'ERROR', success: false, error: `Unknown type: ${type}` });
        }
    } catch (err: any) {
        console.error("[SqliteOpfsWorker] Fatal error", err);
        self.postMessage({ id, type: 'ERROR', success: false, error: err.message });
    }
};

console.log('[SqliteOpfsWorker] Worker initialized (with mutex)');
