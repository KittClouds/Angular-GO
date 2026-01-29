/// <reference lib="webworker" />
import { CozoOpfsAdapter, type WalEntry } from './cozo-opfs-core';

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

const adapter = new CozoOpfsAdapter();
const mutex = new OpMutex();

self.onmessage = async (e: MessageEvent) => {
    const { id, type, payload } = e.data;

    try {
        switch (type) {
            case 'LOAD': {
                // LOAD doesn't need mutex - it's always first
                try {
                    const snapshot = await adapter.loadSnapshot();
                    const wal = await adapter.loadWal();
                    self.postMessage({ id, type: 'LOAD_RESULT', success: true, data: { snapshot, wal } });
                } catch (err: any) {
                    self.postMessage({ id, type: 'LOAD_RESULT', success: false, error: err.message });
                }
                break;
            }

            case 'APPEND_WAL': {
                await mutex.withLock(async () => {
                    try {
                        const entry: WalEntry = payload;
                        await adapter.appendWal(entry);
                        self.postMessage({ id, type: 'APPEND_WAL_RESULT', success: true });
                    } catch (err: any) {
                        console.error("[CozoOpfsWorker] Append WAL failed", err);
                        self.postMessage({ id, type: 'APPEND_WAL_RESULT', success: false, error: err.message });
                    }
                });
                break;
            }

            case 'SAVE_SNAPSHOT': {
                await mutex.withLock(async () => {
                    try {
                        await adapter.saveSnapshot(payload);
                        self.postMessage({ id, type: 'SAVE_SNAPSHOT_RESULT', success: true });
                    } catch (err: any) {
                        console.error("[CozoOpfsWorker] Save snapshot failed", err);
                        self.postMessage({ id, type: 'SAVE_SNAPSHOT_RESULT', success: false, error: err.message });
                    }
                });
                break;
            }

            case 'TRUNCATE_WAL': {
                await mutex.withLock(async () => {
                    try {
                        await adapter.truncateWal();
                        self.postMessage({ id, type: 'TRUNCATE_WAL_RESULT', success: true });
                    } catch (err: any) {
                        console.error("[CozoOpfsWorker] Truncate WAL failed", err);
                        self.postMessage({ id, type: 'TRUNCATE_WAL_RESULT', success: false, error: err.message });
                    }
                });
                break;
            }

            case 'GET_QUOTA': {
                try {
                    const status = await adapter.getQuotaStatus();
                    self.postMessage({ id, type: 'GET_QUOTA_RESULT', success: true, data: status });
                } catch (err: any) {
                    self.postMessage({ id, type: 'GET_QUOTA_RESULT', success: false, error: err.message });
                }
                break;
            }

            default:
                console.warn("[CozoOpfsWorker] Unknown message type:", type);
                self.postMessage({ id, type: 'ERROR', success: false, error: `Unknown type: ${type}` });
        }
    } catch (err: any) {
        console.error("[CozoOpfsWorker] Fatal error", err);
        self.postMessage({ id, type: 'ERROR', success: false, error: err.message });
    }
};

console.log('[CozoOpfsWorker] Worker initialized (with mutex)');
