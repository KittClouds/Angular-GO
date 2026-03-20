import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphPageComponent } from './graph-page.component';
import { GraphPipelineService } from '../../services/graph-pipeline.service';
import { Router } from '@angular/router';

describe('GraphPageComponent graphstore loading', () => {
    let injector: EnvironmentInjector;
    let component: GraphPageComponent;
    let graphPipelineMock: { loadPersistedGraph: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        graphPipelineMock = {
            loadPersistedGraph: vi.fn().mockResolvedValue({
                rawGraph: {
                    nodes: { 'char-ryan': { id: 'char-ryan', kind: 'CHARACTER', label: 'Ryan' } },
                    edges: [],
                },
                graphData: {
                    nodes: [{ id: 'char-ryan', name: 'Ryan', kind: 'CHARACTER' }],
                    links: [],
                    stats: { totalNodes: 1, totalLinks: 0, kindCounts: { CHARACTER: 1 }, typeCounts: {} },
                },
            }),
        };

        injector = createEnvironmentInjector([
            { provide: Router, useValue: { navigate: vi.fn() } },
            { provide: GraphPipelineService, useValue: graphPipelineMock },
        ], Injector.create({ providers: [] }));

        component = runInInjectionContext(injector, () => new GraphPageComponent());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('loads graphstore-backed data for the initial graph load path', async () => {
        await (component as any).loadGraphData(true);

        expect(graphPipelineMock.loadPersistedGraph).toHaveBeenCalledWith({ sync: true });
        expect(component.stats()).toEqual({
            totalNodes: 1,
            totalLinks: 0,
            kindCounts: { CHARACTER: 1 },
            typeCounts: {},
        });
    });

    it('refreshes from the graphstore-backed loader instead of a legacy fallback', async () => {
        const graphMock = { graphData: vi.fn() };
        (component as any).graph = graphMock;

        await component.refreshGraph();

        expect(graphPipelineMock.loadPersistedGraph).toHaveBeenCalledWith({ sync: true });
        expect(graphMock.graphData).toHaveBeenCalledTimes(1);
    });
});
