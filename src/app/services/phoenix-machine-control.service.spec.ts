import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphAuditSnapshot } from './graph-audit.model';
import { GraphAuditService } from './graph-audit.service';
import { PhoenixGraphOrchestratorService } from './phoenix-graph-orchestrator.service';
import { PhoenixMachineControllerService } from './phoenix-machine-controller.service';
import { PhoenixMachineControlService } from './phoenix-machine-control.service';
import { PhoenixUiApiService } from './phoenix-ui-api.service';
import { RetrievalWorkbenchStateService } from './retrieval-workbench-state.service';

const snapshot: GraphAuditSnapshot = {
    notes: 2,
    registryEntities: 9,
    registryEdges: 0,
    graphNodes: 40,
    graphEdges: 39,
    liveDocuments: 2,
    indexedDocuments: 2,
    staleDocuments: 0,
    staleDocumentIds: [],
    staleDocumentSamples: [],
    orphanEdges: 0,
    duplicateEdges: 0,
    nodeKinds: [],
    edgeTypes: [],
    sampleNodes: [],
    sampleEdges: [],
    orphanEdgeSamples: [],
    duplicateEdgeSamples: [],
    updatedAt: 1,
};

describe('PhoenixMachineControlService', () => {
    let injector: EnvironmentInjector;
    let service: PhoenixMachineControlService;
    let graphAudit: { snapshot: ReturnType<typeof vi.fn> };
    let graphOrchestrator: {
        indexGlobal: ReturnType<typeof vi.fn>;
        indexFolder: ReturnType<typeof vi.fn>;
    };
    let uiApi: {
        searchScoped: ReturnType<typeof vi.fn>;
        invalidateKnowledgeGraphCache: ReturnType<typeof vi.fn>;
    };
    let machineController: {
        beginStage: ReturnType<typeof vi.fn>;
        finishStage: ReturnType<typeof vi.fn>;
        failStage: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        graphAudit = { snapshot: vi.fn(async () => snapshot) };
        graphOrchestrator = {
            indexGlobal: vi.fn(async () => ({ processedNotes: 2, skippedNotes: 0 })),
            indexFolder: vi.fn(async () => ({ processedNotes: 1, skippedNotes: 0 })),
        };
        uiApi = {
            searchScoped: vi.fn(async () => [{ DocID: 'note-1', Score: 0.9 }]),
            invalidateKnowledgeGraphCache: vi.fn(),
        };
        machineController = {
            beginStage: vi.fn(),
            finishStage: vi.fn(),
            failStage: vi.fn(),
        };

        injector = createEnvironmentInjector([
            RetrievalWorkbenchStateService,
            PhoenixMachineControlService,
            { provide: GraphAuditService, useValue: graphAudit },
            { provide: PhoenixGraphOrchestratorService, useValue: graphOrchestrator },
            { provide: PhoenixUiApiService, useValue: uiApi },
            { provide: PhoenixMachineControllerService, useValue: machineController },
        ], Injector.create({ providers: [] }));
        service = runInInjectionContext(injector, () => injector.get(PhoenixMachineControlService));
    });

    afterEach(() => injector.destroy());

    it('refreshes audit counts into shared machine state', async () => {
        await service.refreshAuditSafe();

        expect(service.registryEntities()).toBe(9);
        expect(service.graphNodes()).toBe(40);
        expect(service.graphStatus()).toBe('ready');
    });

    it('indexes the selected scope through the graph orchestrator', async () => {
        service.setScope('folder-1');

        await service.runGraphIndex('force', 'spec');

        expect(graphOrchestrator.indexFolder).toHaveBeenCalledWith('folder-1', {
            policy: 'force',
            syncGraph: true,
            reason: 'spec',
        });
        expect(uiApi.invalidateKnowledgeGraphCache).toHaveBeenCalled();
        expect(service.lastSummary()?.kind).toBe('graph-rebuild');
    });

    it('shares lens and focus intent for graph surfaces', () => {
        service.setGraphLensMode('note');
        service.requestGraphFocus({ query: 'Aella', scope: 'global', title: 'Aella' });

        expect(service.graphLensMode()).toBe('note');
        expect(service.graphFocus()).toMatchObject({ query: 'Aella', scope: 'global' });
    });
});
