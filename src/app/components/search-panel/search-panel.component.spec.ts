import '@angular/compiler';
import {
    Injector,
    computed,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
    type EnvironmentInjector,
} from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbNotesMock = vi.hoisted(() => {
    const rows = new Map<string, any>();
    return {
        rows,
        bulkGet: vi.fn(async (ids: string[]) => ids.map((id) => rows.get(id))),
        toArray: vi.fn(async () => Array.from(rows.values())),
        where: vi.fn((field: string) => ({
            equals: vi.fn((value: string) => ({
                toArray: vi.fn(async () => Array.from(rows.values()).filter((row) => row?.[field] === value)),
            })),
        })),
    };
});

vi.mock('../../lib/dexie/db', () => ({
    db: {
        notes: {
            bulkGet: dbNotesMock.bulkGet,
            toArray: dbNotesMock.toArray,
            where: dbNotesMock.where,
        },
    },
}));

import { SearchPanelComponent } from './search-panel.component';
import { NotesService } from '../../lib/dexie/notes.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { PhoenixMachineControlService } from '../../services/phoenix-machine-control.service';
import { NerService } from '../../services/ner.service';
import { AtlasScanCoordinatorService } from '../../services/atlas-scan-coordinator.service';
import { BlueprintHubService } from '../blueprint-hub/blueprint-hub.service';
import { NliWorkerService } from '../../lib/services/nli-worker.service';
import { AtlasCapabilityRuntimeService } from '../../services/atlas-capability-runtime.service';
import { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';
import { PhoenixBackendService } from '../../services/phoenix-backend.service';

describe('SearchPanelComponent model recipe lifecycle', () => {
    let injector: EnvironmentInjector;
    let component: SearchPanelComponent;
    let machine: ReturnType<typeof createMachineMock>;
    let ner: ReturnType<typeof createNerMock>;
    let atlasScan: ReturnType<typeof createAtlasScanMock>;
    let nli: ReturnType<typeof createNliMock>;

    beforeEach(() => {
        dbNotesMock.rows.clear();
        dbNotesMock.bulkGet.mockClear();
        dbNotesMock.toArray.mockClear();
        dbNotesMock.where.mockClear();
        machine = createMachineMock();
        ner = createNerMock();
        atlasScan = createAtlasScanMock();
        nli = createNliMock();
        const parentInjector = Injector.create({ providers: [] }) as unknown as EnvironmentInjector;
        injector = createEnvironmentInjector([
            { provide: NotesService, useValue: createNotesMock() },
            { provide: NoteEditorStore, useValue: createNoteStoreMock() },
            { provide: PhoenixMachineControlService, useValue: machine },
            { provide: NerService, useValue: ner },
            { provide: AtlasScanCoordinatorService, useValue: atlasScan },
            { provide: BlueprintHubService, useValue: { openPage: vi.fn() } },
            { provide: NliWorkerService, useValue: nli },
            { provide: PhoenixUiApiService, useValue: createPhoenixUiApiMock() },
            { provide: PhoenixBackendService, useValue: createPhoenixBackendMock() },
            AtlasCapabilityRuntimeService,
        ], parentInjector);
        component = runInInjectionContext(injector, () => new SearchPanelComponent());
    });

    afterEach(() => {
        injector.destroy();
        vi.clearAllMocks();
    });

    it('loads the semantic model before Semantic Graph runs', async () => {
        await component.runAtlasRecipe('semanticGraph');

        expect(ner.warmProvider).toHaveBeenCalledWith('dynamic_ner');
        expect(ner.runDynamicScan).toHaveBeenCalledWith(expect.objectContaining({
            plainText: expect.stringContaining('Aella'),
        }));
        expect(machine.loadSemanticModel).toHaveBeenCalledWith('mongodb-leaf', 'MDBR Leaf', '384d');
        expect(atlasScan.runRichEmbeddingScan).toHaveBeenCalledWith(expect.objectContaining({
            includeSemanticAtlas: true,
            modelId: 'mongodb-leaf',
        }));
        expect(machine.loadSemanticModel.mock.invocationCallOrder[0])
            .toBeLessThan(atlasScan.runRichEmbeddingScan.mock.invocationCallOrder[0]);
    });

    it('anchors Text Graph with Dynamic NER while keeping semantic and NLI lanes out', async () => {
        await component.runAtlasRecipe('textGraph');
        component.setBuildPolicy('force');
        await component.runAtlasRecipe('textGraph');

        expect(ner.warmProvider).toHaveBeenCalledWith('dynamic_ner');
        expect(ner.runDynamicScan).toHaveBeenCalledTimes(2);
        expect(machine.loadSemanticModel).not.toHaveBeenCalled();
        expect(nli.initialize).not.toHaveBeenCalled();
        expect(atlasScan.runRichEmbeddingScan).toHaveBeenNthCalledWith(1, expect.objectContaining({
            policy: 'dirty-only',
            includeSemanticAtlas: false,
        }));
        expect(atlasScan.runRichEmbeddingScan).toHaveBeenNthCalledWith(2, expect.objectContaining({
            policy: 'force',
            includeSemanticAtlas: false,
        }));
    });

    it('stops the run when required model warming fails', async () => {
        machine.loadSemanticModel.mockRejectedValueOnce(new Error('semantic load failed'));

        await component.runAtlasRecipe('semanticGraph');

        expect(atlasScan.runRichEmbeddingScan).not.toHaveBeenCalled();
        expect(component.failedRecipeStep()).toBe('warm');
        expect(machine.error()).toBe('semantic load failed');
    });

    it('offers whole-path presets and the full backend graph target map', () => {
        expect(component.graphBuildRecipes.map((recipe) => recipe.id)).toEqual([
            'textGraph',
            'semanticGraph',
            'adjudicatedSemanticGraph',
            'reasoningGraph',
        ]);

        const targetIds = component.backendGraphTargets().map((target) => target.capability.id);
        expect(targetIds).toEqual(expect.arrayContaining([
            'dynamicSurface',
            'dynamicChunking',
            'dynamicNer',
            'assertedKernel',
            'relationGraph',
            'temporalGraph',
            'eventIdentity',
            'memoryState',
            'causalGraph',
            'semanticAtlas',
            'nliAdjudication',
            'hopfProjection',
            'lorentzForest',
        ]));

        component.selectCapability('causalGraph');
        expect(component.selectedCapabilityState().status).toBe('ready');
        expect(component.selectedCapabilityState().operationKind).toBe('nativeStoreProbe');
        expect(component.selectedRecipe()).toBe('reasoningGraph');
        expect(component.isRecipeDisabled(component.selectedRecipe())).toBe(false);
    });

    it('exposes model review lanes from Atlas Command state', () => {
        const lanes = component.modelLaneViews();

        expect(lanes.map((lane) => lane.label)).toEqual([
            'Dynamic NER',
            'Co-occurrence',
            'Semantic Embedding',
            'NLI',
            'Manifold Projection',
        ]);
    });

    it('exposes layered and sleeping capabilities from Atlas Command state', () => {
        expect(component.capabilityLayers().map((layer) => layer.label)).toEqual([
            'Text Surface',
            'Entity + Mention Intelligence',
            'Graph Commit',
            'Reasoning Graphs',
            'Semantic + Adjudication',
            'Manifold / Geometry',
            'Retrieval / Visualization',
        ]);
        expect(component.sleepingCapabilities().map((capability) => capability.id)).toContain('causalGraph');
        expect(component.capabilityListLabel(['dynamicSurface', 'causalGraph'])).toBe('Dynamic Text Surface → Causal Graph');
    });

    it('surfaces runtime graph build plans and contextual warm labels', () => {
        component.selectRecipe('textGraph');
        const textPlan = component.selectedRecipePlan();

        expect(textPlan.requiredModels.map((model) => model.id)).toEqual(['dynamicNer']);
        expect(component.modelRequirementLabel(textPlan.requiredModels)).toContain('Dynamic NER');
        expect(component.warmButtonLabel()).toBe('Warmed');
        expect(textPlan.backendRoute).toContain('includeSemanticAtlas=false');
        expect(component.expectedOutputLabel(textPlan.expectedOutputs)).toContain('graph delta counts');

        component.selectRecipe('semanticGraph');
        const semanticPlan = component.selectedRecipePlan();

        expect(semanticPlan.requiredModels.map((model) => model.id)).toEqual(['dynamicNer', 'semanticEmbedding']);
        expect(component.warmButtonLabel()).toBe('Warm Embedding');
        expect(component.serviceRequirementLabel(semanticPlan.requiredServices)).toContain('PhoenixMachineControlService.loadSemanticModel');
        expect(component.expectedOutputLabel(semanticPlan.expectedOutputs)).toContain('relation candidates');

        component.selectRecipe('adjudicatedSemanticGraph');
        expect(component.warmButtonLabel()).toBe('Warm Embedding + NLI');
        expect(component.selectedPipelineRail().map((stage) => stage.label)).toContain('NLI Adjudication');

        component.selectRecipe('reasoningGraph');
        expect(component.selectedRecipePlan().requiredModels.map((model) => model.id)).toEqual(['dynamicNer', 'semanticEmbedding', 'nli']);
        expect(component.selectedPipelineRail().map((stage) => stage.label)).toEqual(expect.arrayContaining([
            'Relation Graph',
            'Temporal Graph',
            'Memory / State',
            'Causal Graph',
        ]));
    });

    it('syncs graph recipe chips to their involved target toggles', () => {
        component.selectedCapabilityIds.set(['relationGraph', 'hybridManifold', 'galaxyVisualization']);

        component.selectRecipe('textGraph');

        expect(component.selectedCapabilityIds()).toEqual([
            'dynamicSurface',
            'dynamicChunking',
            'dynamicNer',
            'mentionGraph',
            'evidenceGraph',
            'surfaceGraph',
            'assertedKernel',
        ]);
        expect(component.isCapabilitySelected('semanticEmbedding')).toBe(false);
        expect(component.isCapabilitySelected('hybridManifold')).toBe(false);

        component.selectRecipe('semanticGraph');

        expect(component.selectedCapabilityIds()).toEqual([
            'dynamicSurface',
            'dynamicChunking',
            'dynamicNer',
            'mentionGraph',
            'evidenceGraph',
            'surfaceGraph',
            'assertedKernel',
            'semanticEmbedding',
            'semanticAtlas',
            'semanticCandidate',
            'hybridManifold',
            'hopfProjection',
            'lorentzForest',
        ]);
        expect(component.isCapabilitySelected('nliAdjudication')).toBe(false);

        component.selectRecipe('adjudicatedSemanticGraph');

        expect(component.selectedCapabilityIds()).toEqual(expect.arrayContaining([
            'semanticCandidate',
            'nliAdjudication',
        ]));
        expect(component.isCapabilitySelected('relationGraph')).toBe(false);

        component.selectRecipe('reasoningGraph');

        expect(component.selectedCapabilityIds()).toEqual(expect.arrayContaining([
            'dynamicNer',
            'semanticEmbedding',
            'semanticAtlas',
            'semanticCandidate',
            'hybridManifold',
            'hopfProjection',
            'lorentzForest',
            'nliAdjudication',
            'relationGraph',
            'temporalGraph',
            'eventIdentity',
            'memoryState',
            'causalGraph',
        ]));
        expect(component.isCapabilitySelected('causalGraph')).toBe(true);
    });

    it('drives the selected rail from the backend capability dependency chain', () => {
        component.selectedCapabilityIds.set(['semanticEmbedding', 'semanticAtlas']);
        component.selectCapability('assertedKernel');

        expect(component.selectedCapabilityIds()).toEqual([
            'dynamicSurface',
            'dynamicChunking',
            'dynamicNer',
            'mentionGraph',
            'evidenceGraph',
            'surfaceGraph',
            'assertedKernel',
        ]);
        expect(component.isCapabilitySelected('semanticEmbedding')).toBe(false);
        expect(component.selectedPipelineRail().map((stage) => stage.label)).toEqual(expect.arrayContaining([
            'Global',
            'Dynamic Text Surface',
            'Dynamic Chunking',
            'Dynamic NER',
            'Mention / Co-occurrence Graph',
            'Evidence Graph',
            'Surface Graph',
            'Asserted Kernel',
        ]));

        component.selectCapability('temporalGraph');
        expect(component.selectedCapabilityState().operationKind).toBe('nativeStoreProbe');
        expect(component.selectedRecipe()).toBe('reasoningGraph');
        expect(component.selectedCapabilityIds()).toEqual(expect.arrayContaining([
            'dynamicNer',
            'semanticEmbedding',
            'nliAdjudication',
            'temporalGraph',
        ]));
    });

    it('keeps projection selections attached to the semantic embedding contract', () => {
        for (const capabilityId of ['hybridManifold', 'hopfProjection', 'lorentzForest'] as const) {
            component.selectCapability(capabilityId);

            expect(component.selectedRecipe()).toBe('semanticGraph');
            expect(component.selectedCapabilityIds()).toEqual(expect.arrayContaining([
                'dynamicNer',
                'semanticEmbedding',
                'semanticAtlas',
                'semanticCandidate',
                'hybridManifold',
                'hopfProjection',
                'lorentzForest',
                capabilityId,
            ]));
            expect(component.isCapabilitySelected('nliAdjudication')).toBe(false);
            expect(component.isCapabilitySelected('relationGraph')).toBe(false);
            expect(component.isCapabilitySelected('causalGraph')).toBe(false);
        }
    });

    it('preserves graph target scroll position while selecting capabilities', async () => {
        const scrollHost = { scrollTop: 640 };
        (component as any).workbenchScroll = { nativeElement: scrollHost };

        const group = component.backendGraphTargetGroups()[0];
        const target = group.targets[0];

        expect(component.trackCapabilityGroup(0, group)).toBe(group.id);
        expect(component.trackCapabilityTarget(0, target)).toBe(target.capability.id);

        component.selectCapability('temporalGraph');
        scrollHost.scrollTop = 0;
        await Promise.resolve();

        expect(scrollHost.scrollTop).toBe(640);
    });

    it('passes selected multi-note source into graph build runtime options', async () => {
        dbNotesMock.rows.set('note-a', {
            id: 'note-a',
            title: 'A',
            content: 'Aella met Kai.',
            markdownContent: '',
            folderId: '',
        });
        dbNotesMock.rows.set('note-b', {
            id: 'note-b',
            title: 'B',
            content: 'Kai followed Ruby.',
            markdownContent: '',
            folderId: '',
        });
        component.notes.set([
            { id: 'note-a', title: 'A', content: 'Aella met Kai.', narrativeId: '', folderId: '', hasBody: true },
            { id: 'note-b', title: 'B', content: 'Kai followed Ruby.', narrativeId: '', folderId: '', hasBody: true },
        ]);
        component.setBuildScopeMode('multiNote');
        component.selectedBuildNoteIds.set([]);
        component.toggleBuildNote('note-a');
        component.toggleBuildNote('note-b');

        await component.runAtlasRecipe('textGraph');

        expect(atlasScan.runRichEmbeddingScan).toHaveBeenCalledWith(expect.objectContaining({
            noteIds: ['note-a', 'note-b'],
            buildScope: { mode: 'multiNote', noteIds: ['note-a', 'note-b'] },
        }));
    });
});

function createMachineMock() {
    const notice = signal<string | null>(null);
    const error = signal<string | null>(null);
    const activeJob = signal<any>(null);
    return {
        query: signal(''),
        scope: signal('global'),
        lanes: signal({ lexical: true, semantic: false, graph: false, entities: false, evidence: false }),
        activeLanes: computed(() => ['lexical']),
        graphFocus: signal(null),
        graphLensMode: signal('unified'),
        stages: signal({}),
        activeSignals: signal({ count: 0 }),
        vectorStatus: signal<any>('idle'),
        graphStatus: signal<any>('idle'),
        graphAudit: signal(null),
        manifoldMode: signal('hybrid'),
        manifoldStatus: signal<any>('idle'),
        manifoldStatuses: signal<any>({ hybrid: 'idle', hopf: 'idle', lorentz: 'idle' }),
        notice,
        error,
        activeJob,
        lastSummary: signal(null),
        graphNodes: computed(() => 0),
        graphEdges: computed(() => 0),
        registryEntities: computed(() => 0),
        liveDocuments: computed(() => 0),
        indexedDocuments: computed(() => 0),
        staleDocuments: computed(() => 0),
        graphIssueCount: computed(() => 0),
        hasCommittedGraph: computed(() => false),
        setScope: vi.fn(),
        toggleLane: vi.fn(),
        requestGraphFocus: vi.fn(),
        setNotice: vi.fn((message: string) => notice.set(message)),
        loadSemanticModel: vi.fn(async () => undefined),
        refreshAuditSafe: vi.fn(),
        search: vi.fn(async () => []),
    };
}

function createNerMock() {
    const status = { ready: true, loading: false, device: null };
    return {
        providerStatuses: computed(() => ({
            atlas_surface: status,
            dynamic_ner: status,
            fst: status,
            lfm_local_experiment: status,
            gliner_local: status,
        })),
        isAnalyzing: signal(false),
        warmProvider: vi.fn(async () => undefined),
        runDynamicScan: vi.fn(async () => undefined),
        suggestions: signal([]),
    };
}

function createAtlasScanMock() {
    return {
        phase: signal('idle'),
        message: signal(null),
        lastResult: signal(null),
        running: computed(() => false),
        runRichEmbeddingScan: vi.fn(async () => ({ mode: 'rich-embeddings' })),
    };
}

function createNliMock() {
    return {
        isInitialized: signal(false),
        modelId: signal<string | null>(null),
        isProcessing: signal(false),
        device: signal('wasm'),
        initialize: vi.fn(async () => undefined),
        classifyStream: vi.fn(async () => undefined),
    };
}

function createNotesMock() {
    return {
        getAllNotes$: () => new BehaviorSubject([]),
        getAllFolders$: () => new BehaviorSubject([]),
    };
}

function createNoteStoreMock() {
    return {
        currentNote: signal({
            id: 'note-1',
            title: 'Runtime Note',
            content: 'Aella met Kai near the harbor.',
            markdownContent: '',
            folderId: 'folder-1',
        }),
        openNote: vi.fn(),
    };
}

function createPhoenixUiApiMock() {
    return {
        loadManifoldAtlasSnapshot: vi.fn(async () => ({ nodes: [], edges: [] })),
    };
}

function createPhoenixBackendMock() {
    return {
        storeCommand: vi.fn(async () => []),
    };
}
