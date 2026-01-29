/**
 * SyncQueue Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncQueue, SyncOp } from './SyncQueue';

describe('SyncQueue', () => {
    let queue: SyncQueue;
    let flushHandler: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        queue = new SyncQueue({ batchSize: 3, flushIntervalMs: 500, debug: false });
        flushHandler = vi.fn().mockResolvedValue(undefined);
        queue.setFlushHandler(flushHandler);
    });

    afterEach(() => {
        queue.destroy();
        vi.useRealTimers();
    });

    it('should enqueue operations', () => {
        queue.enqueueUpsert('notes', 'note-1', { id: 'note-1', title: 'Test' });
        expect(queue.length).toBe(1);
    });

    it('should deduplicate operations for same id/table', () => {
        queue.enqueueUpsert('notes', 'note-1', { id: 'note-1', title: 'V1' });
        queue.enqueueUpsert('notes', 'note-1', { id: 'note-1', title: 'V2' });
        expect(queue.length).toBe(1);

        // The latest should win
        const stats = queue.getStats();
        expect(stats.pending).toBe(1);
    });

    it('should auto-flush when batch size reached', async () => {
        queue.enqueueUpsert('notes', 'note-1', {});
        queue.enqueueUpsert('notes', 'note-2', {});
        queue.enqueueUpsert('notes', 'note-3', {}); // Triggers flush at 3

        // Flush is async, advance microtasks
        await vi.runAllTimersAsync();

        expect(flushHandler).toHaveBeenCalledTimes(1);
        expect(flushHandler).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ id: 'note-1' }),
            expect.objectContaining({ id: 'note-2' }),
            expect.objectContaining({ id: 'note-3' }),
        ]));
    });

    it('should auto-flush after idle interval', async () => {
        queue.enqueueUpsert('notes', 'note-1', {});

        // Advance time past flush interval
        await vi.advanceTimersByTimeAsync(600);

        expect(flushHandler).toHaveBeenCalledTimes(1);
    });

    it('should report stats correctly', async () => {
        queue.enqueueUpsert('notes', 'note-1', {});
        queue.enqueueDelete('notes', 'note-2');

        let stats = queue.getStats();
        expect(stats.pending).toBe(2);
        expect(stats.flushed).toBe(0);

        await queue.flush();

        stats = queue.getStats();
        expect(stats.pending).toBe(0);
        expect(stats.flushed).toBe(2);
        expect(stats.lastFlush).not.toBeNull();
    });

    it('should clear queue without flushing', () => {
        queue.enqueueUpsert('notes', 'note-1', {});
        queue.clear();

        expect(queue.length).toBe(0);
        expect(flushHandler).not.toHaveBeenCalled();
    });

    it('should re-queue ops on flush failure', async () => {
        flushHandler.mockRejectedValueOnce(new Error('Network error'));

        queue.enqueueUpsert('notes', 'note-1', {});
        await queue.flush();

        // Ops should be back in queue
        expect(queue.length).toBe(1);
        expect(queue.getStats().errors).toBe(1);
    });

    it('should skip flush when no handler set', async () => {
        const noHandlerQueue = new SyncQueue();
        noHandlerQueue.enqueueUpsert('notes', 'note-1', {});

        // Should not throw
        await noHandlerQueue.flush();

        // Queue should still have the item
        expect(noHandlerQueue.length).toBe(1);
        noHandlerQueue.destroy();
    });
});
