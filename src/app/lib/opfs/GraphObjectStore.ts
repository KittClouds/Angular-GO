
import { BlobStore } from './BlobStore';
import { WalManager, WalOp } from './Wal';

// Minimal interface for what we need from Cozo
export interface ICozoDb {
    run(script: string, params?: any): Promise<any>;
}

export class GraphObjectStore {
    constructor(
        private blobStore: BlobStore,
        private db: ICozoDb
    ) { }

    /**
     * High-level: Save a "File" (Blob + Metadata)
     */
    async saveObject(
        id: string,
        kind: string,
        content: Uint8Array | string | null,
        mime?: string,
        props?: Record<string, any>
    ): Promise<void> {
        const ops: WalOp[] = [];
        const now = Date.now();

        // Upsert object
        ops.push({ type: 'PutObject', id, kind, now });

        // Blob logic
        if (content !== null && mime) {
            const meta = await this.blobStore.put(content, mime);
            ops.push({ type: 'AttachBlob', objectId: id, role: 'primary', cid: meta.cid, meta });
        }

        // Props logic
        let title = '';
        if (props) {
            for (const [key, value] of Object.entries(props)) {
                ops.push({ type: 'SetProp', objectId: id, key, value });
                if (key === 'title') title = value;
            }
        }

        // Legacy Sync
        if (kind === 'note' || kind === 'notes') {
            const body = typeof content === 'string' ? content : ''; // Should handle buffer->string if needed
            ops.push({
                type: 'LegacyUpsertNote',
                id,
                title,
                content: body,
                now
            });
        }

        await this.commit(ops);
    }

    async deleteObject(id: string): Promise<void> {
        const ops: WalOp[] = [
            { type: 'DeleteObject', id }
        ];
        await this.commit(ops);
    }

    /**
     * Apply operations to the DB
     * In a real system, this would also append to the WAL file first.
     */
    private async commit(ops: WalOp[]): Promise<void> {
        // Generate script for all ops (Batching)
        const script = ops.map(op => WalManager.opToScript(op)).join('\n');
        await this.db.run(script);
    }

    async getObject(id: string) {
        // Example query
        const script = `
            ?[id, kind, cid] := *object{id, kind}, *attachment{object_id: id, role: 'primary', cid}
            :limit 1
        `;
        // In real impl, we'd run this against DB
        throw new Error("Not implemented query");
    }

    async runQuery(script: string, params?: any): Promise<any> {
        // Cozo returns JSON string usually, or object if we wrap it.
        // ICozoDb.run returns Promise<any> (string usually).
        // Let's assume the ICozoDb wrapper handles parsing or we do it.
        // The mock returned {ok:true}. The real cozoDb returns string.
        // We should standardize ICozoDb to return Parsed JSON.
        return this.db.run(script, params);
    }
}
