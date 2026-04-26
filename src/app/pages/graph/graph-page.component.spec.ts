import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    \u0275ChangeDetectionScheduler as ChangeDetectionScheduler,
    \u0275EffectScheduler as EffectScheduler,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphPageComponent } from './graph-page.component';
import { GraphPipelineService } from '../../services/graph-pipeline.service';
import { Router } from '@angular/router';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { PhoenixGraphOrchestratorService } from '../../services/phoenix-graph-orchestrator.service';
import { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';
import { RetrievalWorkbenchStateService } from '../../services/retrieval-workbench-state.service';

describe('GraphPageComponent graphstore loading', () => {
    let injector: EnvironmentInjector;
    let component: GraphPageComponent;
    let graphPipelineMock: { loadPersistedGraph: ReturnType<typeof vi.fn> };
    let graphOrchestratorMock: {
        indexNote: ReturnType<typeof vi.fn>;
        indexFolder: ReturnType<typeof vi.fn>;
        indexNarrative: ReturnType<typeof vi.fn>;
        indexGlobal: ReturnType<typeof vi.fn>;
    };
    let phoenixApiMock: {
        loadRuntime: ReturnType<typeof vi.fn>;
        hydrateWithEntities: ReturnType<typeof vi.fn>;
        scanDiscovery: ReturnType<typeof vi.fn>;
    };
    let workbenchMock: { graphFocus: ReturnType<typeof vi.fn> };
    let changeDetectionSchedulerMock: { notify: ReturnType<typeof vi.fn>; runningTick: boolean };
    let effectSchedulerMock: {
        add: ReturnType<typeof vi.fn>;
        schedule: ReturnType<typeof vi.fn>;
        flush: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
    };

    const graphResult = {
        rawGraph: {
            nodes: {
                'char-ryan': { id: 'char-ryan', kind: 'CHARACTER', label: 'Ryan' },
                'loc-room': { id: 'loc-room', kind: 'LOCATION', label: 'Room' },
            },
            edges: [{ source: 'char-ryan', target: 'loc-room', type: 'MENTIONED_WITH' }],
        },
        graphData: {
            nodes: [
                { id: 'char-ryan', name: 'Ryan', kind: 'CHARACTER' },
                { id: 'loc-room', name: 'Room', kind: 'LOCATION' },
            ],
            links: [{ source: 'char-ryan', target: 'loc-room', type: 'MENTIONED_WITH', value: 1 }],
            stats: {
                totalNodes: 2,
                totalLinks: 1,
                kindCounts: { CHARACTER: 1, LOCATION: 1 },
                typeCounts: { MENTIONED_WITH: 1 },
            },
        },
    };

    beforeEach(() => {
        graphPipelineMock = {
            loadPersistedGraph: vi.fn().mockResolvedValue(graphResult),
        };
        graphOrchestratorMock = {
            indexNote: vi.fn().mockResolvedValue({
                mode: 'note',
                scope: { worldId: 'global', folderId: 'folder-1', folderPath: 'folder-1' },
                processedNotes: 1,
                skippedNotes: 0,
                runResult: null,
                graph: graphResult,
            }),
            indexFolder: vi.fn().mockResolvedValue({
                mode: 'folder',
                scope: { worldId: 'global', folderId: 'folder-1', folderPath: 'folder-1' },
                processedNotes: 1,
                skippedNotes: 0,
                runResult: null,
                graph: graphResult,
            }),
            indexNarrative: vi.fn().mockResolvedValue({
                mode: 'narrative',
                scope: { worldId: 'global', folderId: 'narrative-1', folderPath: 'narrative-1' },
                processedNotes: 1,
                skippedNotes: 0,
                runResult: null,
                graph: graphResult,
            }),
            indexGlobal: vi.fn().mockResolvedValue({
                mode: 'global',
                scope: { worldId: 'global', folderId: 'global', folderPath: 'global' },
                processedNotes: 1,
                skippedNotes: 0,
                runResult: null,
                graph: graphResult,
            }),
        };
        phoenixApiMock = {
            loadRuntime: vi.fn().mockResolvedValue(undefined),
            hydrateWithEntities: vi.fn().mockResolvedValue(undefined),
            scanDiscovery: vi.fn().mockResolvedValue([]),
        };
        workbenchMock = {
            graphFocus: vi.fn(() => null),
        };
        changeDetectionSchedulerMock = { notify: vi.fn(), runningTick: false };
        effectSchedulerMock = {
            add: vi.fn((handle) => handle.run()),
            schedule: vi.fn((handle) => handle.run()),
            flush: vi.fn(),
            remove: vi.fn(),
        };

        injector = createEnvironmentInjector([
            { provide: Router, useValue: { navigate: vi.fn() } },
            { provide: GraphPipelineService, useValue: graphPipelineMock },
            { provide: PhoenixGraphOrchestratorService, useValue: graphOrchestratorMock },
            { provide: PhoenixUiApiService, useValue: phoenixApiMock },
            { provide: RetrievalWorkbenchStateService, useValue: workbenchMock },
            { provide: ChangeDetectionScheduler, useValue: changeDetectionSchedulerMock },
            { provide: EffectScheduler, useValue: effectSchedulerMock },
            {
                provide: NoteEditorStore,
                useValue: {
                    currentNote: vi.fn(() => ({
                        id: 'note-1',
                        title: 'Note One',
                        content: '',
                        markdownContent: 'Ryan entered the room.',
                        folderId: 'folder-1',
                        narrativeId: 'narrative-1',
                        worldId: 'global',
                    })),
                },
            },
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
            totalNodes: 2,
            totalLinks: 1,
            kindCounts: { CHARACTER: 1, LOCATION: 1 },
            typeCounts: { MENTIONED_WITH: 1 },
        });
        expect(component.galaxyNodes()).toHaveLength(2);
        expect(component.galaxyEdges()).toHaveLength(1);
    });

    it('refreshes from the graphstore-backed loader into the native galaxy scene', async () => {
        await component.refreshGraph();

        expect(graphPipelineMock.loadPersistedGraph).toHaveBeenCalledWith({ sync: true });
        expect(component.galaxyNodes().map((node) => node.label)).toEqual(['Ryan', 'Room']);
        expect(component.galaxyEdges()[0]).toMatchObject({
            sourceId: 'char-ryan',
            targetId: 'loc-room',
            type: 'MENTIONED_WITH',
        });
    });

    it('warms runtime and scan path without retaining warm graph data', async () => {
        await component.warmGraphModels();

        expect(phoenixApiMock.loadRuntime).toHaveBeenCalledTimes(1);
        expect(phoenixApiMock.hydrateWithEntities).toHaveBeenCalledTimes(1);
        expect(phoenixApiMock.scanDiscovery).toHaveBeenCalledTimes(1);
        expect(component.warmStatus()).toBe('warm');
    });

    it('builds the selected active-note lens through the retained scheduler path', async () => {
        await component.buildGraph();

        expect(graphOrchestratorMock.indexNote).toHaveBeenCalledTimes(1);
        expect(component.buildStatus()).toBe('ready');
        expect(component.stats().kindCounts).toEqual({ CHARACTER: 1, LOCATION: 1 });
    });
});
