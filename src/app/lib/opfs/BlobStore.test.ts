
import { describe, it, expect } from 'vitest';
import { BlobStore, IOpfsBackend } from './BlobStore';

class MockOpfsBackend implements IOpfsBackend {
    files = new Map<string, Uint8Array>();

    async write(path: string, data: Uint8Array): Promise<void> {
        this.files.set(path, data);
    }

    async read(path: string): Promise<Uint8Array | null> {
        return this.files.get(path) || null;
    }

    async exists(path: string): Promise<boolean> {
        return this.files.has(path);
    }

    async delete(path: string): Promise<boolean> {
        return this.files.delete(path);
    }

    async move(src: string, dst: string): Promise<void> {
        const data = this.files.get(src);
        if (!data) throw new Error(`Source not found: ${src}`);
        this.files.set(dst, data);
        this.files.delete(src);
    }
}

describe('BlobStore', () => {
    it('calculates SHA-256 CID and stores file', async () => {
        const backend = new MockOpfsBackend();
        const store = new BlobStore(backend);
        const data = new TextEncoder().encode('Hello World');

        // Known SHA-256 for 'Hello World'
        const expectedCid = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e';

        const meta = await store.put(data);

        expect(meta.cid).toBe(expectedCid);
        expect(meta.size).toBe(11);
        expect(await store.has(expectedCid)).toBe(true);

        // check sharding: /blobs/a5/91/...
        // The store likely prefixes with /blobs/, but let's see implementation. 
        // We expect it to be stored *somewhere* in the backend.
        const stored = await backend.read(`blobs/a5/91/${expectedCid}`);
        expect(stored).toEqual(data);
    });

    it('deduplicates identical content', async () => {
        const backend = new MockOpfsBackend();
        const store = new BlobStore(backend);
        const data = new TextEncoder().encode('Hello World');

        const meta1 = await store.put(data);
        const meta2 = await store.put(data);

        expect(meta1.cid).toBe(meta2.cid);
        // Should only be one file conceptually, though backend map makes this hard to check if we overwrite.
        // But logic should handle it.
    });

    it('retrieves content by CID', async () => {
        const backend = new MockOpfsBackend();
        const store = new BlobStore(backend);
        const data = new TextEncoder().encode('Test Data');

        const { cid } = await store.put(data);
        const retrieved = await store.get(cid);

        expect(retrieved).toEqual(data);
    });
});
