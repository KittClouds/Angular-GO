
import { describe, it, expect } from 'vitest';
import { WalManager, WalOp } from './Wal';

describe('WalManager', () => {
    it('generates script for PutObject', () => {
        const op: WalOp = {
            type: 'PutObject',
            id: 'uuid-123',
            kind: 'note',
            now: 123456789
        };
        const script = WalManager.opToScript(op);
        // Expect standard Cozo upsert syntax
        expect(script).toContain('?[id, kind, mtime, ctime]');
        expect(script).toContain('uuid-123');
        expect(script).toContain('note');
    });

    it('generates script for AttachBlob', () => {
        const op: WalOp = {
            type: 'AttachBlob',
            objectId: 'obj-1',
            role: 'content',
            cid: 'QmHash',
            meta: { cid: 'QmHash', size: 100, mimeType: 'text/markdown' }
        };
        const script = WalManager.opToScript(op);
        expect(script).toContain(':create attachment {');
        expect(script).toContain('obj-1');
        expect(script).toContain('QmHash');
    });

    it('generates script for SetProp', () => {
        const op: WalOp = {
            type: 'SetProp',
            objectId: 'obj-1',
            key: 'title',
            value: { text: "Hello" } // JSON object
        };
        const script = WalManager.opToScript(op);
        expect(script).toContain(':create prop {');
        expect(script).toContain('"title"');
        // JSON serialization check
        expect(script).toContain('{"text":"Hello"}');
    });
});
