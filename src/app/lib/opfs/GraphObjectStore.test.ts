
import { describe, it, expect, vi } from 'vitest';
import { GraphObjectStore, ICozoDb } from './GraphObjectStore';
import { BlobStore } from './BlobStore';
import { IOpfsBackend } from './BlobStore';

// Mocks
const mockOpfs: IOpfsBackend = {
    write: vi.fn(),
    read: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    delete: vi.fn(),
    move: vi.fn()
};

const mockDb: ICozoDb = {
    run: vi.fn().mockResolvedValue({ ok: true })
};

describe('GraphObjectStore', () => {
    it('saveObject persists blob and metadata', async () => {
        const store = new GraphObjectStore(
            new BlobStore(mockOpfs),
            mockDb
        );

        const data = new TextEncoder().encode("Hello Graph");
        await store.saveObject('obj-1', 'note', data, 'text/plain');

        // 1. Check Blob Store interaction
        expect(mockOpfs.write).toHaveBeenCalled();
        expect(mockOpfs.move).toHaveBeenCalled(); // Atomic commit

        // 2. Check DB interaction
        expect(mockDb.run).toHaveBeenCalledTimes(1);

        const script = (mockDb.run as any).mock.calls[0][0];
        // Verify script contains intent
        expect(script).toContain('obj-1');
        expect(script).toContain('note');
        expect(script).toContain(':create object');
        expect(script).toContain(':create attachment');
        // Verify CID was passed (implied from blob put)
        // We assume blob store works (tested separately)
    });
});
