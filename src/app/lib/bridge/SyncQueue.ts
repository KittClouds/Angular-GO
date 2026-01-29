/**
 * SyncQueue - Batching and throttling for Dexie → CozoDB sync operations
 * 
 * Accumulates mutations and flushes them in batches during idle time
 * to avoid blocking the UI thread.
 */

// =============================================================================
// TYPES
// =============================================================================

export type SyncOpType = 'upsert' | 'delete';
export type SyncTable = 'notes' | 'folders' | 'entities' | 'edges';

export interface SyncOp {
    type: SyncOpType;
    table: SyncTable;
    id: string;
    data?: unknown;
    timestamp: number;
}

export interface SyncQueueConfig {
    /** Max ops before forcing flush (default: 50) */
    batchSize: number;
    /** Idle time before auto-flush in ms (default: 1000) */
    flushIntervalMs: number;
    /** Enable verbose logging (default: false) */
    debug: boolean;
}

export interface SyncStats {
    pending: number;
    flushed: number;
    errors: number;
    lastFlush: number | null;
}

// =============================================================================
// SYNC QUEUE
// =============================================================================

export class SyncQueue {
    private queue: SyncOp[] = [];
    private flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private idleCallbackId: number | null = null;
    private stats: SyncStats = {
        pending: 0,
        flushed: 0,
        errors: 0,
        lastFlush: null,
    };

    private config: SyncQueueConfig = {
        batchSize: 50,
        flushIntervalMs: 1000,
        debug: false,
    };

    private flushHandler: ((ops: SyncOp[]) => Promise<void>) | null = null;

    constructor(config?: Partial<SyncQueueConfig>) {
        if (config) {
            this.config = { ...this.config, ...config };
        }
    }

    /**
     * Set the flush handler that processes batched operations
     */
    setFlushHandler(handler: (ops: SyncOp[]) => Promise<void>): void {
        this.flushHandler = handler;
    }

    /**
     * Enqueue an operation for later sync
     */
    enqueue(op: SyncOp): void {
        // Deduplicate: remove older ops for same id/table
        this.queue = this.queue.filter(
            (existing) => !(existing.table === op.table && existing.id === op.id)
        );

        this.queue.push(op);
        this.stats.pending = this.queue.length;

        if (this.config.debug) {
            console.log(`[SyncQueue] Enqueued ${op.type} ${op.table}/${op.id} (queue: ${this.queue.length})`);
        }

        // Force flush if we hit batch size
        if (this.queue.length >= this.config.batchSize) {
            this.flush();
            return;
        }

        // Schedule idle flush
        this.scheduleFlush();
    }

    /**
     * Enqueue an upsert operation
     */
    enqueueUpsert(table: SyncTable, id: string, data: unknown): void {
        this.enqueue({
            type: 'upsert',
            table,
            id,
            data,
            timestamp: Date.now(),
        });
    }

    /**
     * Enqueue a delete operation
     */
    enqueueDelete(table: SyncTable, id: string): void {
        this.enqueue({
            type: 'delete',
            table,
            id,
            timestamp: Date.now(),
        });
    }

    /**
     * Schedule a flush during browser idle time
     */
    private scheduleFlush(): void {
        // Clear existing timers
        if (this.flushTimeoutId) {
            clearTimeout(this.flushTimeoutId);
        }
        if (this.idleCallbackId && typeof cancelIdleCallback === 'function') {
            cancelIdleCallback(this.idleCallbackId);
        }

        // Try requestIdleCallback for best UX, fallback to setTimeout
        if (typeof requestIdleCallback === 'function') {
            this.idleCallbackId = requestIdleCallback(
                () => this.flush(),
                { timeout: this.config.flushIntervalMs }
            );
        } else {
            this.flushTimeoutId = setTimeout(
                () => this.flush(),
                this.config.flushIntervalMs
            );
        }
    }

    /**
     * Immediately flush all queued operations
     */
    async flush(): Promise<void> {
        if (this.queue.length === 0) return;
        if (!this.flushHandler) {
            console.warn('[SyncQueue] No flush handler set, skipping flush');
            return;
        }

        // Clear timers
        if (this.flushTimeoutId) {
            clearTimeout(this.flushTimeoutId);
            this.flushTimeoutId = null;
        }
        if (this.idleCallbackId && typeof cancelIdleCallback === 'function') {
            cancelIdleCallback(this.idleCallbackId);
            this.idleCallbackId = null;
        }

        // Grab current queue and reset
        const ops = [...this.queue];
        this.queue = [];
        this.stats.pending = 0;

        if (this.config.debug) {
            console.log(`[SyncQueue] Flushing ${ops.length} ops...`);
        }

        try {
            await this.flushHandler(ops);
            this.stats.flushed += ops.length;
            this.stats.lastFlush = Date.now();

            if (this.config.debug) {
                console.log(`[SyncQueue] ✅ Flushed ${ops.length} ops`);
            }
        } catch (err) {
            console.error('[SyncQueue] ❌ Flush failed:', err);
            this.stats.errors += ops.length;

            // Re-queue failed ops for retry
            this.queue.push(...ops);
            this.stats.pending = this.queue.length;
        }
    }

    /**
     * Get queue statistics
     */
    getStats(): SyncStats {
        return { ...this.stats };
    }

    /**
     * Get current queue length
     */
    get length(): number {
        return this.queue.length;
    }

    /**
     * Clear the queue without flushing
     */
    clear(): void {
        this.queue = [];
        this.stats.pending = 0;

        if (this.flushTimeoutId) {
            clearTimeout(this.flushTimeoutId);
            this.flushTimeoutId = null;
        }
        if (this.idleCallbackId && typeof cancelIdleCallback === 'function') {
            cancelIdleCallback(this.idleCallbackId);
            this.idleCallbackId = null;
        }
    }

    /**
     * Destroy the queue (cleanup for service shutdown)
     */
    destroy(): void {
        this.clear();
        this.flushHandler = null;
    }
}
