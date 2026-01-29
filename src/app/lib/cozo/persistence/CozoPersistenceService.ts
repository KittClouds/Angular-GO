/**
 * CozoDB Persistence Service
 * 
 * Main thread singleton that owns the OPFS worker and provides:
 * - load(): Returns snapshot + WAL on startup (with recovery mode indicator)
 * - appendWal(script): Debounced append to WAL
 * - compact(exportData): Save snapshot + truncate WAL
 * - getQuotaStatus(): Check storage quota
 */

import type { WalEntry, LoadResult, QuotaStatus } from './cozo-opfs-core';

type PendingRequest = {
    resolve: (val?: any) => void;
    reject: (err: any) => void;
};

class CozoPersistenceServiceImpl {
    private worker: Worker | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private walBuffer: WalEntry[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly FLUSH_DELAY_MS = 500; // Debounce WAL writes
    private lastRecoveryMode = false;

    /**
     * Initialize the worker
     */
    async init(): Promise<void> {
        if (this.worker) return;

        console.log('[CozoPersistence] Initializing worker...');
        this.worker = new Worker(
            new URL('./cozo-opfs.worker.ts', import.meta.url),
            { type: 'module' }
        );

        this.worker.onmessage = (e) => this.handleMessage(e.data);
        this.worker.onerror = (e) => {
            console.error('[CozoPersistence] Worker error:', e);
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

    private sendToWorker<T>(type: string, payload?: any): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('[CozoPersistence] Worker not initialized'));
                return;
            }

            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, payload });
        });
    }

    /**
     * Load snapshot and WAL from OPFS
     */
    async load(): Promise<{ snapshot: any | null; wal: WalEntry[]; recoveryMode: boolean }> {
        await this.init();
        const result = await this.sendToWorker<{ snapshot: LoadResult; wal: WalEntry[] }>('LOAD');

        // Handle new LoadResult format
        const loadResult = result.snapshot as unknown as LoadResult;
        this.lastRecoveryMode = loadResult?.recoveryMode ?? false;

        if (loadResult?.recoveryMode) {
            console.warn(`[CozoPersistence] ⚠️ Recovery mode: loaded from ${loadResult.source}`);
        }

        console.log(`[CozoPersistence] Loaded: snapshot=${!!loadResult?.snapshot}, wal entries=${result.wal?.length || 0}, source=${loadResult?.source || 'unknown'}`);

        return {
            snapshot: loadResult?.snapshot ?? null,
            wal: result.wal ?? [],
            recoveryMode: this.lastRecoveryMode,
        };
    }

    /**
     * Check if last load was in recovery mode
     */
    get wasRecoveryMode(): boolean {
        return this.lastRecoveryMode;
    }

    /**
     * Queue a script to be appended to the WAL (debounced)
     * @param script The CozoScript that was executed
     * @param params JSON-stringified params (needed for replay)
     */
    appendWal(script: string, params?: string): void {
        const entry: WalEntry = {
            ts: Date.now(),
            op: 'script',
            script,
            params,
        };

        this.walBuffer.push(entry);

        // Flush immediately if buffer is large (memory optimization)
        if (this.walBuffer.length >= 20) {
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

        for (const entry of entries) {
            try {
                await this.sendToWorker('APPEND_WAL', entry);
            } catch (e) {
                console.error('[CozoPersistence] Failed to append WAL entry:', e);
                // Re-queue failed entries
                this.walBuffer.unshift(entry);
            }
        }
    }

    /**
     * Save a full snapshot and truncate the WAL
     * Call this periodically or after significant changes
     */
    async compact(exportData: any): Promise<void> {
        // Flush pending WAL first
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        await this.flushWal();

        // Save snapshot
        console.log('[CozoPersistence] Compacting...');
        await this.sendToWorker('SAVE_SNAPSHOT', exportData);

        // Truncate WAL
        await this.sendToWorker('TRUNCATE_WAL');
        console.log('[CozoPersistence] Compaction complete');
    }

    /**
     * Get current quota status
     */
    async getQuotaStatus(): Promise<QuotaStatus> {
        await this.init();
        return await this.sendToWorker<QuotaStatus>('GET_QUOTA');
    }

    /**
     * Get the count of pending WAL entries (for compaction heuristics)
     */
    get pendingWalCount(): number {
        return this.walBuffer.length;
    }
}

// Singleton
export const cozoPersistence = new CozoPersistenceServiceImpl();
