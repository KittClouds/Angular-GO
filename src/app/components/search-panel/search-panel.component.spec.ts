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

        expect(machine.loadSemanticModel).toHaveBeenCalledWith('mongodb-leaf', 'MDBR Leaf', '384d');
        expect(atlasScan.runRichEmbeddingScan).toHaveBeenCalledWith(expect.objectContaining({
            includeSemanticAtlas: true,
            modelId: 'mongodb-leaf',
        }));
        expect(machine.loadSemanticModel.mock.invocationCallOrder[0])
            .toBeLessThan(atlasScan.runRichEmbeddingScan.mock.invocationCallOrder[0]);
    });

    it('keeps Text Graph out of embedding and NLI loaders', async () => {
        await component.runAtlasRecipe('textGraph');
        component.setBuildPolicy('force');
        await component.runAtlasRecipe('textGraph');

        expect(ner.warmProvider).not.toHaveBeenCalled();
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
        expect(component.selectedCapabilityState().status).toBe('blocked');
        expect(component.capabilityActionLabel()).toBe('Not Wired');
        expect(component.isSelectedCapabilityDisabled()).toBe(true);
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

        expect(textPlan.requiredModels).toEqual([]);
        expect(component.modelRequirementLabel(textPlan.requiredModels)).toBe('none');
        expect(component.warmButtonLabel()).toBe('No Warm Needed');
        expect(textPlan.backendRoute).toContain('includeSemanticAtlas=false');
        expect(component.expectedOutputLabel(textPlan.expectedOutputs)).toContain('graph delta counts');

        component.selectRecipe('semanticGraph');
        const semanticPlan = component.selectedRecipePlan();

        expect(semanticPlan.requiredModels.map((model) => model.id)).toEqual(['semanticEmbedding']);
        expect(component.warmButtonLabel()).toBe('Warm Embedding');
        expect(component.serviceRequirementLabel(semanticPlan.requiredServices)).toContain('PhoenixMachineControlService.loadSemanticModel');
        expect(component.expectedOutputLabel(semanticPlan.expectedOutputs)).toContain('relation candidates');

        component.selectRecipe('adjudicatedSemanticGraph');
        expect(component.warmButtonLabel()).toBe('Warm Embedding + NLI');
        expect(component.selectedPipelineRail().map((stage) => stage.label)).toContain('NLI Adjudication');
    });

    it('drives the selected rail from the backend capability dependency chain', () => {
        component.selectCapability('assertedKernel');

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
        expect(component.capabilityActionLabel()).toBe('Probe Temporal Graph');
    });

    it('passes selected multi-note source into graph build runtime options', async () => {
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
        currentNote: signal(null),
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
