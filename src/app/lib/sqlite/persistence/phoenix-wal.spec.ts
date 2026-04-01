import { describe, expect, it } from 'vitest';

import {
    createEmptyPhoenixManifest,
    decodeWalBytes,
    encodeWalBatch,
    finalizeContentCheckpointManifest,
    nextManifestWithWalAppend,
    type PhoenixWalBatch,
} from './phoenix-wal';

function sampleBatch(startSeq = 1): PhoenixWalBatch {
    return {
        records: [
            {
                seq: startSeq,
                command: 'note:upsert',
                partition: 'content',
                writtenAt: 100,
                payload: {
                    row: {
                        id: 'note-1',
                    },
                },
            },
            {
                seq: startSeq + 1,
                command: 'relation:upsert',
                partition: 'content',
                writtenAt: 101,
                payload: {
                    relation: 'entities',
                    row: {
                        id: 'entity-1',
                    },
                },
            },
        ],
    };
}

describe('phoenix-wal codec', () => {
    it('round-trips framed WAL records', () => {
        const batch = sampleBatch();
        const encoded = encodeWalBatch(batch);
        const decoded = decodeWalBytes(encoded);

        expect(decoded.tailCorrupted).toBe(false);
        expect(decoded.records).toEqual(batch.records);
    });

    it('drops only the corrupt tail record', () => {
        const batch = sampleBatch();
        const encoded = encodeWalBatch(batch);
        encoded[encoded.length - 1] ^= 0xff;

        const decoded = decodeWalBytes(encoded);
        expect(decoded.tailCorrupted).toBe(true);
        expect(decoded.records).toHaveLength(1);
        expect(decoded.records[0].seq).toBe(1);
    });

    it('resets active WAL stats when a content checkpoint lands', () => {
        const manifest = createEmptyPhoenixManifest(1);
        const appended = nextManifestWithWalAppend(manifest, sampleBatch(), {
            activeSegmentBytes: 512,
            activeSegmentRecordCount: 2,
            bytesWritten: 512,
        });
        const finalized = finalizeContentCheckpointManifest(appended, 'checkpoints/content-1.bin', 2);

        expect(finalized.manifest.content.lastCheckpointSeq).toBe(2);
        expect(finalized.manifest.content.activeSegmentBytes).toBe(0);
        expect(finalized.manifest.content.activeSegmentRecordCount).toBe(0);
    });
});
