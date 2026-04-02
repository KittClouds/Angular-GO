import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmbeddingWorkerService } from '../lib/services/embedding-worker.service';
import { PhoenixWasmService } from './phoenix-wasm.service';

type MockEmbeddingWorker = Pick<EmbeddingWorkerService, 'initialize' | 'embedStream'>;

function makeEmbedding(first: number, second = 0): number[] {
    const values = new Array<number>(384).fill(0);
    values[0] = first;
    values[1] = second;
    return values;
}

describe('PhoenixWasmService semantic sidecar', () => {
    let injector: EnvironmentInjector;
    let service: PhoenixWasmService;
    let embeddingWorkerMock: {
        initialize: ReturnType<typeof vi.fn>;
        embedStream: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        embeddingWorkerMock = {
            initialize: vi.fn().mockResolvedValue(undefined),
            embedStream: vi.fn().mockImplementation(async (texts, onBatch) => {
                expect(texts).toEqual([
                    'Crimson harbor bells at dawn.',
                    'Fog rolled over the cranes.',
                    'Moonlit observatory above the desert.',
                ]);
                onBatch({
                    embeddings: [
                        makeEmbedding(3, 0),
                        makeEmbedding(0, 4),
                        makeEmbedding(5, 0),
                    ],
                    batchIndex: 0,
                    totalBatches: 1,
                });
            }),
        };

        injector = createEnvironmentInjector([
            { provide: EmbeddingWorkerService, useValue: embeddingWorkerMock satisfies MockEmbeddingWorker },
        ], Injector.create({ providers: [] }));

        service = runInInjectionContext(injector, () => new PhoenixWasmService());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('derives document centroids from the streamed leaf embeddings without a second embedding pass', async () => {
        const storeCommand = vi
            .spyOn(service, 'storeCommand')
            .mockImplementation(async (command: string) => {
                if (command === 'semantic:listLeafChunks') {
                    return [
                        {
                            spanId: 'doc-1:1:0:0-29',
                            documentId: 'doc-1',
                            text: 'Crimson harbor bells at dawn.',
                        },
                        {
                            spanId: 'doc-1:2:0:30-58',
                            documentId: 'doc-1',
                            text: 'Fog rolled over the cranes.',
                        },
                        {
                            spanId: 'doc-2:1:0:0-36',
                            documentId: 'doc-2',
                            text: 'Moonlit observatory above the desert.',
                        },
                    ];
                }
                return { inserted: 2 };
            });
        const sendBytes = vi.spyOn(service as any, 'sendBytes').mockResolvedValue({
            kind: 0,
            requestId: 1,
            bytes: new Uint8Array(),
            json: { inserted: 3 },
        });

        await (service as any).indexCommittedSemanticDocuments(['doc-1', 'doc-2']);

        expect(embeddingWorkerMock.initialize).toHaveBeenCalledTimes(1);
        expect(embeddingWorkerMock.initialize).toHaveBeenCalledWith('mongodb-leaf');
        expect(embeddingWorkerMock.embedStream).toHaveBeenCalledTimes(1);
        expect(sendBytes).toHaveBeenCalledTimes(1);
        expect(storeCommand).toHaveBeenNthCalledWith(1, 'semantic:listLeafChunks', {
            documentIds: ['doc-1', 'doc-2'],
        });
        expect(storeCommand).toHaveBeenNthCalledWith(
            2,
            'semantic:upsertDocumentVectors',
            expect.any(Object),
        );

        const rows = (storeCommand.mock.calls[1]?.[1] as { rows: Array<{ documentId: string; leafCount: number; values: number[] }> }).rows;
        expect(rows).toHaveLength(2);
        expect(rows[0].documentId).toBe('doc-1');
        expect(rows[0].leafCount).toBe(2);
        expect(rows[0].values[0]).toBeCloseTo(Math.SQRT1_2, 5);
        expect(rows[0].values[1]).toBeCloseTo(Math.SQRT1_2, 5);
        expect(rows[1].documentId).toBe('doc-2');
        expect(rows[1].leafCount).toBe(1);
        expect(rows[1].values[0]).toBeCloseTo(1, 5);
        expect(rows[1].values[1]).toBeCloseTo(0, 5);
    });
});
