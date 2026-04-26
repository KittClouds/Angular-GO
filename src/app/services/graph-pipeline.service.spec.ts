import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ForceGraphData, GraphVizService } from './graph-viz.service';
import { GraphPipelineService } from './graph-pipeline.service';
import { KnowledgeService } from './knowledge.service';
import { PhoenixGraphOrchestratorService } from './phoenix-graph-orchestrator.service';
import { PhoenixUiApiService } from './phoenix-ui-api.service';

describe('GraphPipelineService', () => {
    let injector: EnvironmentInjector;
    let service: GraphPipelineService;
    let orchestratorMock: {
        indexNote: ReturnType<typeof vi.fn>;
        loadGraphView: ReturnType<typeof vi.fn>;
    };

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
        orchestratorMock = {
            indexNote: vi.fn().mockResolvedValue({
                runResult: {
                    ingest: { chunkStats: { strategy: 'chunker_x2' } },
                    commit: { entities: 1, edges: 0 },
                },
                graph: { rawGraph, graphData },
            }),
            loadGraphView: vi.fn().mockResolvedValue({ rawGraph, graphData }),
        };

        injector = createEnvironmentInjector([
            { provide: PhoenixGraphOrchestratorService, useValue: orchestratorMock },
            { provide: PhoenixUiApiService, useValue: {} },
            { provide: KnowledgeService, useValue: {} },
            { provide: GraphVizService, useValue: {} },
        ], Injector.create({ providers: [] }));

        service = runInInjectionContext(injector, () => new GraphPipelineService());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('delegates active-note indexing to the graph orchestrator and returns transformed graph data', async () => {
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

        expect(orchestratorMock.indexNote).toHaveBeenCalledTimes(1);
        expect(orchestratorMock.indexNote).toHaveBeenCalledWith(note, {
            policy: 'force',
            syncGraph: true,
            reason: 'active-note-index',
        });
        expect(result.graphData).toEqual(graphData);
        expect(result.rawGraph).toEqual(rawGraph);
    });

    it('can load the persisted graph without rerunning the pipeline', async () => {
        const result = await service.loadPersistedGraph({ sync: true });

        expect(orchestratorMock.indexNote).not.toHaveBeenCalled();
        expect(orchestratorMock.loadGraphView).toHaveBeenCalledWith({ sync: true });
        expect(result.graphData).toEqual(graphData);
    });
});
