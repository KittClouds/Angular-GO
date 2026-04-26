import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphAuditService } from './graph-audit.service';
import { PhoenixStoreService } from './phoenix-store.service';
import { PhoenixUiApiService } from './phoenix-ui-api.service';
import type { PhoenixGraphDeltaBinaryResult } from './phoenix-wasm.service';

describe('GraphAuditService', () => {
    let injector: EnvironmentInjector;
    let service: GraphAuditService;
    let phoenixMock: { knowledgeGraphDelta: ReturnType<typeof vi.fn> };
    let storeMock: {
        countNotes: ReturnType<typeof vi.fn>;
        listEntities: ReturnType<typeof vi.fn>;
        listAllEdges: ReturnType<typeof vi.fn>;
        listNoteHeaders: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        phoenixMock = {
            knowledgeGraphDelta: vi.fn().mockResolvedValue(baseDelta()),
        };
        storeMock = {
            countNotes: vi.fn().mockResolvedValue(2),
            listNoteHeaders: vi.fn().mockResolvedValue([
                { id: 'note-a', folderId: 'folder-a' },
                { id: 'note-b', folderId: 'folder-b' },
            ]),
            listEntities: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
            listAllEdges: vi.fn().mockResolvedValue([{ id: 'e1' }]),
        };

        injector = createEnvironmentInjector([
            { provide: PhoenixUiApiService, useValue: phoenixMock },
            { provide: PhoenixStoreService, useValue: storeMock },
        ], Injector.create({ providers: [] }));

        service = runInInjectionContext(injector, () => new GraphAuditService());
    });

    afterEach(() => injector.destroy());

    it('audits the runtime graph delta instead of legacy relation rows', async () => {
        const snapshot = await service.snapshot();

        expect(phoenixMock.knowledgeGraphDelta).toHaveBeenCalledWith(
            { folderId: undefined, narrativeId: undefined },
            [],
        );
        expect(snapshot.notes).toBe(2);
        expect(snapshot.registryEntities).toBe(2);
        expect(snapshot.registryEdges).toBe(1);
        expect(snapshot.graphNodes).toBe(3);
        expect(snapshot.graphEdges).toBe(4);
        expect(snapshot.liveDocuments).toBe(2);
        expect(snapshot.indexedDocuments).toBe(1);
        expect(snapshot.staleDocuments).toBe(0);
    });

    it('surfaces duplicate and orphan runtime graph edges', async () => {
        const snapshot = await service.snapshot();

        expect(snapshot.duplicateEdges).toBe(1);
        expect(snapshot.orphanEdges).toBe(1);
        expect(snapshot.duplicateEdgeSamples[0]).toMatchObject({
            sourceId: 'entity-a',
            targetId: 'leaf-a',
            edgeType: 'mentions',
            count: 2,
        });
        expect(snapshot.orphanEdgeSamples[0]).toMatchObject({
            sourceId: 'leaf-a',
            targetId: 'missing',
            edgeType: 'contains',
        });
    });

    it('passes scoped live note ids into the delta request', async () => {
        await service.snapshot({ folderId: 'folder-a' });

        expect(phoenixMock.knowledgeGraphDelta).toHaveBeenCalledWith(
            { folderId: 'folder-a', narrativeId: undefined },
            ['note-a'],
        );
    });

    it('filters stale document ids embedded in graph delta identifiers without deleting rows', async () => {
        phoenixMock.knowledgeGraphDelta.mockResolvedValue({
            sessionId: 'phoenix-ui-main',
            chunks: [],
            nodes: [{
                nodeId: 'chapter::1106cb46-5784-420a-8020-45085394f67c::0',
                kind: 'chapter',
                label: 'Old Chapter',
                weight: 1,
            }],
            edges: [{
                sourceId: 'chapter::1106cb46-5784-420a-8020-45085394f67c::0',
                targetId: 'parent::1093190677',
                edgeType: 'contains',
                weight: 1,
            }],
            diagnostics: [],
        } satisfies PhoenixGraphDeltaBinaryResult);
        storeMock.listNoteHeaders.mockResolvedValue([{ id: 'note-a', folderId: 'folder-a' }]);

        const snapshot = await service.snapshot();

        expect(snapshot.graphNodes).toBe(0);
        expect(snapshot.graphEdges).toBe(0);
        expect(snapshot.staleDocumentIds).toEqual(['1106cb46-5784-420a-8020-45085394f67c']);
        expect(snapshot.staleDocumentSamples[0]).toMatchObject({
            relation: 'graph_vertices',
            field: 'id',
            documentId: '1106cb46-5784-420a-8020-45085394f67c',
        });
    });
});

function baseDelta(): PhoenixGraphDeltaBinaryResult {
    return {
        sessionId: 'phoenix-ui-main',
        chunks: [
            {
                vertexId: 'leaf-a',
                chunkId: 'note-a:chunk:0',
                documentId: 'note-a',
                noteId: 'note-a',
                chapterId: 0,
                start: 0,
                end: 24,
            },
        ],
        nodes: [
            {
                nodeId: 'document::note-a',
                kind: 'document',
                label: 'Note A',
                documentId: 'note-a',
                weight: 1,
            },
            {
                nodeId: 'entity-a',
                kind: 'entity',
                label: 'Aella',
                entityId: 'a',
                weight: 1,
            },
        ],
        edges: [
            { sourceId: 'document::note-a', targetId: 'leaf-a', edgeType: 'contains', weight: 1 },
            { sourceId: 'entity-a', targetId: 'leaf-a', edgeType: 'mentions', weight: 1 },
            { sourceId: 'entity-a', targetId: 'leaf-a', edgeType: 'mentions', weight: 1 },
            { sourceId: 'leaf-a', targetId: 'missing', edgeType: 'contains', weight: 1 },
        ],
        diagnostics: [],
    };
}
