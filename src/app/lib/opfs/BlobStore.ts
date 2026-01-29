
export interface IOpfsBackend {
    /** Write bytes to a path relative to root, ensuring directories exist */
    write(path: string, data: Uint8Array): Promise<void>;

    /** Read bytes from a path */
    read(path: string): Promise<Uint8Array | null>;

    /** Check if file exists */
    exists(path: string): Promise<boolean>;

    /** Delete a file */
    delete(path: string): Promise<boolean>;

    /** Atomic move (for commit) */
    move(srcPath: string, dstPath: string): Promise<void>;
}

export type BlobMeta = {
    cid: string;
    size: number;
    mimeType?: string;
};

export class BlobStore {
    constructor(private backend: IOpfsBackend, private shardDepth = 2) { }

    private async hash(data: Uint8Array): Promise<string> {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    private getPath(cid: string): string {
        const parts = ['blobs'];
        for (let i = 0; i < this.shardDepth; i++) {
            parts.push(cid.slice(i * 2, (i * 2) + 2));
        }
        parts.push(cid);
        return parts.join('/');
    }

    async put(data: Uint8Array | string, mimeType?: string): Promise<BlobMeta> {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const cid = await this.hash(bytes);
        const path = this.getPath(cid);

        if (await this.backend.exists(path)) {
            return { cid, size: bytes.length, mimeType };
        }

        // Atomic write pattern: write to tmp, then move
        const tmpPath = `tmp/${cid}-${Date.now()}`;
        await this.backend.write(tmpPath, bytes);
        await this.backend.move(tmpPath, path);

        return { cid, size: bytes.length, mimeType };
    }

    async get(cid: string): Promise<Uint8Array | null> {
        const path = this.getPath(cid);
        return await this.backend.read(path);
    }

    async has(cid: string): Promise<boolean> {
        const path = this.getPath(cid);
        return await this.backend.exists(path);
    }
}
