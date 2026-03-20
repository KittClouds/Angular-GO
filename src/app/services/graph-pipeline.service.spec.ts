import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ForceGraphData, GraphVizService } from './graph-viz.service';
import { GoKittService } from './gokitt.service';
import { GraphPipelineService } from './graph-pipeline.service';
import { KnowledgeService } from './knowledge.service';

describe('GraphPipelineService', () => {
    let injector: EnvironmentInjector;
    let service: GraphPipelineService;
    let goKittMock: { systemRun: ReturnType<typeof vi.fn> };
    let knowledgeMock: {
        ensureReady: ReturnType<typeof vi.fn>;
        sync: ReturnType<typeof vi.fn>;
        getGraph: ReturnType<typeof vi.fn>;
    };
    let graphVizMock: { fromKnowledgeGraph: ReturnType<typeof vi.fn> };

    const rawGraph = {
        nodes: {
            'char-ryan': { id: 'char-ryan', kind: 'CHARACTER', label: 'Ryan' },
        },
        edges: [],
    };
    const graphData: ForceGraphData = {
        nodes: [{ id: 'char-ryan', name: 'Ryan', kind: 'CHARACTER' }],
        links: [],
        stats: { totalNodes: 1, totalLinks: 0, kindCounts: { CHARACTER: 1 }, typeCounts: {} },
    };

    beforeEach(() => {
        goKittMock = {
            systemRun: vi.fn().mockResolvedValue({
                ingest: { chunkStats: { strategy: 'chunker_x2' } },
                commit: { entities: 1, edges: 0 },
            }),
        };
        knowledgeMock = {
            ensureReady: vi.fn().mockResolvedValue(undefined),
            sync: vi.fn().mockResolvedValue({ success: true }),
            getGraph: vi.fn().mockResolvedValue(rawGraph),
        };
        graphVizMock = {
            fromKnowledgeGraph: vi.fn().mockReturnValue(graphData),
        };

        injector = createEnvironmentInjector([
            { provide: GoKittService, useValue: goKittMock },
            { provide: KnowledgeService, useValue: knowledgeMock },
            { provide: GraphVizService, useValue: graphVizMock },
        ], Injector.create({ providers: [] }));

        service = runInInjectionContext(injector, () => new GraphPipelineService());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('runs the full-system pipeline, syncs the graphstore, and returns transformed graph data', async () => {
        const note = {
            id: 'note-1',
            title: 'Untitled',
            markdownContent: 'Ryan entered New Rome.',
            content: 'Ryan entered New Rome.',
            worldId: 'world-1',
            narrativeId: 'narr-1',
            folderId: '',
        } as any;

        const result = await service.runNoteGraphPipeline(note);

        expect(goKittMock.systemRun).toHaveBeenCalledTimes(1);
        expect(goKittMock.systemRun).toHaveBeenCalledWith({
            ingest: {
                scope: {
                    worldId: 'world-1',
                    narrativeId: 'narr-1',
                    folderId: 'narr-1',
                    folderPath: 'narr-1',
                },
                documents: [{
                    documentId: 'note-1',
                    noteId: 'note-1',
                    title: 'Untitled',
                    text: 'Ryan entered New Rome.',
                    scope: {
                        worldId: 'world-1',
                        narrativeId: 'narr-1',
                        folderId: 'narr-1',
                        folderPath: 'narr-1',
                    },
                }],
            },
            commit: {
                scope: {
                    worldId: 'world-1',
                    narrativeId: 'narr-1',
                    folderId: 'narr-1',
                    folderPath: 'narr-1',
                },
            },
        });
        expect(knowledgeMock.sync).toHaveBeenCalledTimes(1);
        expect(knowledgeMock.getGraph).toHaveBeenCalledTimes(1);
        expect(graphVizMock.fromKnowledgeGraph).toHaveBeenCalledWith(rawGraph);
        expect(result.graphData).toEqual(graphData);
        expect(result.rawGraph).toEqual(rawGraph);
    });

    it('can load the persisted graph without rerunning the pipeline', async () => {
        const result = await service.loadPersistedGraph({ sync: true });

        expect(goKittMock.systemRun).not.toHaveBeenCalled();
        expect(knowledgeMock.sync).toHaveBeenCalledTimes(1);
        expect(knowledgeMock.getGraph).toHaveBeenCalledTimes(1);
        expect(result.graphData).toEqual(graphData);
    });
});
