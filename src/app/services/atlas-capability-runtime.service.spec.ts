import '@angular/compiler';
import {
    Injector,
    computed,
    createEnvironmentInjector,
    inject,
    runInInjectionContext,
    signal,
    type EnvironmentInjector,
} from '@angular/core';
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

vi.mock('../lib/dexie/db', () => ({
    db: {
        notes: {
            bulkGet: dbNotesMock.bulkGet,
            toArray: dbNotesMock.toArray,
            where: dbNotesMock.where,
        },
    },
}));

import { AtlasCapabilityRuntimeService } from './atlas-capability-runtime.service';
import { PhoenixMachineControlService } from './phoenix-machine-control.service';
import { NerService } from './ner.service';
import { AtlasScanCoordinatorService } from './atlas-scan-coordinator.service';
import { NliWorkerService } from '../lib/services/nli-worker.service';
import { BlueprintHubService } from '../components/blueprint-hub/blueprint-hub.service';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { PhoenixUiApiService } from './phoenix-ui-api.service';
import { PhoenixBackendService } from './phoenix-backend.service';
import type { AtlasCapabilityId } from '../components/search-panel/atlas-capability.model';

describe('AtlasCapabilityRuntimeService', () => {
    let injector: EnvironmentInjector;
    let service: AtlasCapabilityRuntimeService;
    let machine: ReturnType<typeof createMachineMock>;
    let ner: ReturnType<typeof createNerMock>;
    let atlasScan: ReturnType<typeof createAtlasScanMock>;
    let nli: ReturnType<typeof createNliMock>;
    let noteStore: ReturnType<typeof createNoteStoreMock>;
    let phoenixUiApi: ReturnType<typeof createPhoenixUiApiMock>;
    let phoenix: ReturnType<typeof createPhoenixBackendMock>;

    beforeEach(() => {
        dbNotesMock.rows.clear();
        dbNotesMock.rows.set('note-2', {
            id: 'note-2',
            title: 'Second Runtime Note',
            content: 'Branna crossed the bridge with Lucien.',
            markdownContent: '',
            folderId: 'folder-1',
        });
        dbNotesMock.rows.set('note-3', {
            id: 'note-3',
            title: 'Third Runtime Note',
            content: 'Calder watched Merrow near the terrace.',
            markdownContent: '',
            folderId: 'folder-1',
        });
        dbNotesMock.bulkGet.mockClear();
        dbNotesMock.toArray.mockClear();
        dbNotesMock.where.mockClear();

        machine = createMachineMock();
        ner = createNerMock();
        atlasScan = createAtlasScanMock();
        nli = createNliMock();
        noteStore = createNoteStoreMock();
        phoenixUiApi = createPhoenixUiApiMock();
        phoenix = createPhoenixBackendMock();

        const parentInjector = Injector.create({ providers: [] }) as unknown as EnvironmentInjector;
        injector = createEnvironmentInjector([
            AtlasCapabilityRuntimeService,
            { provide: PhoenixMachineControlService, useValue: machine },
            { provide: NerService, useValue: ner },
            { provide: AtlasScanCoordinatorService, useValue: atlasScan },
            { provide: NliWorkerService, useValue: nli },
            { provide: BlueprintHubService, useValue: { openPage: vi.fn() } },
            { provide: NoteEditorStore, useValue: noteStore },
            { provide: PhoenixUiApiService, useValue: phoenixUiApi },
            { provide: PhoenixBackendService, useValue: phoenix },
        ], parentInjector);

        service = runInInjectionContext(injector, () => inject(AtlasCapabilityRuntimeService));
    });

    afterEach(() => {
        injector.destroy();
        vi.clearAllMocks();
    });

    it('plans Text Graph as the model-free build preset', async () => {
        const plan = service.recipePlan('textGraph', {
            buildScope: { mode: 'multiNote', noteIds: ['note-a', 'note-b'] },
            buildPolicy: 'dirty-only',
        });

        expect(plan.requiredModels).toEqual([]);
        expect(plan.operations.map((operation) => operation.kind)).toEqual(['richTextGraphScan']);
        expect(plan.backendRoute).toContain('includeSemanticAtlas=false');

        await service.runRecipe('textGraph', {
            buildScope: { mode: 'multiNote', noteIds: ['note-a', 'note-b'] },
            buildPolicy: 'dirty-only',
        });

        expect(atlasScan.runRichEmbeddingScan).toHaveBeenCalledWith(expect.objectContaining({
            includeSemanticAtlas: false,
            policy: 'dirty-only',
            noteIds: ['note-a', 'note-b'],
            buildScope: { mode: 'multiNote', noteIds: ['note-a', 'note-b'] },
        }));
        expect(machine.loadSemanticModel).not.toHaveBeenCalled();
        expect(nli.initialize).not.toHaveBeenCalled();
    });

    it('plans Semantic Graph with embedding warm and explicit folder scope', async () => {
        const options = {
            selectedModel: 'mongodb-leaf' as const,
            selectedModelLabel: 'MDBR Leaf',
            dimensionLabel: '384d',
            buildScope: { mode: 'folder' as const, folderId: 'folder-1' },
            buildPolicy: 'force' as const,
        };

        const plan = service.recipePlan('semanticGraph', options);
        expect(plan.requiredModels.map((model) => model.id)).toEqual(['semanticEmbedding']);

        await service.runRecipe('semanticGraph', options);

        expect(machine.loadSemanticModel).toHaveBeenCalledWith('mongodb-leaf', 'MDBR Leaf', '384d');
        expect(atlasScan.runRichEmbeddingScan).toHaveBeenCalledWith(expect.objectContaining({
            includeSemanticAtlas: true,
            policy: 'force',
            buildScope: { mode: 'folder', folderId: 'folder-1' },
        }));
    });

    it('plans Adjudicated Semantic Graph as semantic build followed by native NLI apply', async () => {
        await service.runRecipe('adjudicatedSemanticGraph', {
            selectedModel: 'mongodb-leaf',
            selectedModelLabel: 'MDBR Leaf',
            dimensionLabel: '384d',
            buildScope: { mode: 'note', noteId: 'note-1' },
        });

        expect(machine.loadSemanticModel).toHaveBeenCalled();
        expect(atlasScan.runRichEmbeddingScan).toHaveBeenCalledWith(expect.objectContaining({
            includeSemanticAtlas: true,
            noteIds: ['note-1'],
        }));
        expect(nli.initialize).toHaveBeenCalledWith('onnx-community/ModernBERT-base-nli-ONNX');
        expect(phoenix.storeCommand).toHaveBeenNthCalledWith(1, 'semantic:listNliJudgmentInputs', {
            documentIds: ['note-1'],
        });
        expect(phoenix.storeCommand).toHaveBeenNthCalledWith(2, 'semantic:applyNliJudgments', expect.any(Object));
    });

    it('runs Fast and Full Text Graph as no-model rich text graph scans', async () => {
        const fastPlan = service.recipePlan('fastTextGraph');
        const fullPlan = service.recipePlan('fullTextGraph');

        expect(fastPlan.requiredModels).toEqual([]);
        expect(fullPlan.requiredModels).toEqual([]);
        expect(service.modelRequirementLabel(fastPlan.requiredModels)).toBe('none');
        expect(fastPlan.backendRoute).toContain('includeSemanticAtlas=false');
        expect(fullPlan.backendRoute).toContain('policy=force');

        await service.runRecipe('fastTextGraph');
        await service.runRecipe('fullTextGraph');

        expect(atlasScan.runRichEmbeddingScan).toHaveBeenNthCalledWith(1, expect.objectContaining({
            includeSemanticAtlas: false,
            policy: 'dirty-only',
        }));
        expect(atlasScan.runRichEmbeddingScan).toHaveBeenNthCalledWith(2, expect.objectContaining({
            includeSemanticAtlas: false,
            policy: 'force',
        }));
        expect(ner.warmProvider).not.toHaveBeenCalled();
        expect(machine.loadSemanticModel).not.toHaveBeenCalled();
        expect(nli.initialize).not.toHaveBeenCalled();
    });

    it('loads the selected embedding model before running Semantic Atlas', async () => {
        const options = {
            selectedModel: 'mongodb-leaf' as const,
            selectedModelLabel: 'MDBR Leaf',
            dimensionLabel: '384d',
        };

        const plan = service.recipePlan('semanticAtlas', options);
        expect(plan.requiredModels.map((model) => model.id)).toEqual(['semanticEmbedding']);
        expect(plan.requiredServices.map((route) => route.service)).toContain('PhoenixMachineControlService.loadSemanticModel');

        await service.runRecipe('semanticAtlas', options);

        expect(machine.loadSemanticModel).toHaveBeenCalledWith('mongodb-leaf', 'MDBR Leaf', '384d');
        expect(atlasScan.runRichEmbeddingScan).toHaveBeenCalledWith(expect.objectContaining({
            includeSemanticAtlas: true,
            modelId: 'mongodb-leaf',
            modelLabel: 'MDBR Leaf',
            dimensionLabel: '384d',
            policy: 'dirty-only',
        }));
        expect(machine.loadSemanticModel.mock.invocationCallOrder[0])
            .toBeLessThan(atlasScan.runRichEmbeddingScan.mock.invocationCallOrder[0]);
        expect(ner.warmProvider).not.toHaveBeenCalled();
        expect(nli.initialize).not.toHaveBeenCalled();
    });

    it('warms the full index stack without mutating graph state', async () => {
        await service.runRecipe('warmFullIndexStack', {
            selectedModel: 'mongodb-leaf',
            selectedModelLabel: 'MDBR Leaf',
            dimensionLabel: '384d',
        });

        expect(ner.warmProvider).toHaveBeenCalledWith('dynamic_ner');
        expect(machine.loadSemanticModel).toHaveBeenCalledWith('mongodb-leaf', 'MDBR Leaf', '384d');
        expect(nli.initialize).toHaveBeenCalledWith('onnx-community/ModernBERT-base-nli-ONNX');
        expect(atlasScan.runRichEmbeddingScan).not.toHaveBeenCalled();
        expect(machine.setNotice).toHaveBeenCalledWith(expect.stringContaining('No graph data was mutated'));
    });

    it('runs Dynamic NER through NerService using the open note when no scope is provided', async () => {
        await service.runRecipe('runNer');

        expect(ner.warmProvider).toHaveBeenCalledWith('dynamic_ner');
        expect(ner.runDynamicScan).toHaveBeenCalledWith(expect.objectContaining({
            noteId: 'note-1',
            noteTitle: 'Runtime Note',
            plainText: expect.stringContaining('Aella'),
        }));
        expect(atlasScan.runRichEmbeddingScan).not.toHaveBeenCalled();
    });

    it('runs Dynamic NER over the selected multi-note scope', async () => {
        await service.runRecipe('runNer', {
            buildScope: { mode: 'multiNote', noteIds: ['note-2', 'note-3'] },
            noteIds: ['note-2', 'note-3'],
        });

        expect(ner.runDynamicScan).toHaveBeenCalledWith(expect.objectContaining({
            noteId: 'scope:multiNote',
            noteTitle: '2 selected notes',
            plainText: expect.stringContaining('Branna crossed the bridge'),
        }));
        expect(ner.runDynamicScan).toHaveBeenCalledWith(expect.objectContaining({
            plainText: expect.stringContaining('Calder watched Merrow'),
        }));
        expect(ner.runDynamicScan).toHaveBeenCalledWith(expect.objectContaining({
            plainText: expect.not.stringContaining('Aella met Kai'),
        }));
        expect(machine.setNotice).toHaveBeenCalledWith(expect.stringContaining('2 documents'));
    });

    it('keeps Dynamic NER add-ons available for folder graph builds', () => {
        const plan = service.recipePlan('textGraph', {
            buildScope: { mode: 'folder', folderId: 'folder-1' },
            addOns: { dynamicNer: true },
        });

        expect(plan.dependencyChain).toContain('dynamicNer');
        expect(plan.operations.map((operation) => operation.kind)).toEqual([
            'richTextGraphScan',
            'warmModel',
            'dynamicNerScan',
        ]);
    });

    it('reports text graph capabilities as runnable with no required models', () => {
        const textGraphCapabilities: AtlasCapabilityId[] = [
            'dynamicSurface',
            'dynamicChunking',
            'mentionGraph',
            'evidenceGraph',
            'surfaceGraph',
            'assertedKernel',
        ];

        for (const capabilityId of textGraphCapabilities) {
            const state = service.capabilityState(capabilityId);

            expect(state.runnable).toBe(true);
            expect(state.operationKind).toBe('richTextGraphScan');
            expect(state.requiredModels).toEqual([]);
            expect(service.modelRequirementLabel(state.requiredModels)).toBe('none');
        }
    });

    it('exposes native reasoning store probes as read-only runnable commands', async () => {
        const probeCapabilities: AtlasCapabilityId[] = [
            'relationGraph',
            'temporalGraph',
            'eventIdentity',
            'memoryState',
        ];

        for (const capabilityId of probeCapabilities) {
            const state = service.capabilityState(capabilityId);

            expect(state.runnable).toBe(true);
            expect(state.operationKind).toBe('nativeStoreProbe');
            expect(state.status).toBe('ready');
            expect(state.runPolicy).toBe('read-only');
            expect(state.mutationPolicy).toBe('read-only');
            expect(state.requiredServices[0].ready).toBe(true);

            const result = await service.runCapability(capabilityId);

            expect(result.operationKind).toBe('nativeStoreProbe');
            expect(result.rawResult).toEqual(expect.objectContaining({
                capabilityId,
                command: 'relation:list',
                count: 1,
            }));
        }

        expect(phoenix.storeCommand).toHaveBeenCalledWith('relation:list', expect.objectContaining({
            relation: 'graph_candidate_edges',
        }));
        expect(machine.setNotice).toHaveBeenCalledWith(expect.stringContaining('No graph data was mutated'));
    });

    it('keeps causal graph blocked until a native pass or safe probe exists', () => {
        const state = service.capabilityState('causalGraph');

        expect(state.runnable).toBe(false);
        expect(state.operationKind).toBe('notWired');
        expect(state.status).toBe('blocked');
        expect(state.blockedReason).toContain('no Search Panel runtime operation binding or read-only probe');
        expect(state.requiredServices[0].ready).toBe(false);
    });

    it('runs NLI adjudication through the native queue and apply commands', async () => {
        const state = service.capabilityState('nliAdjudication');

        expect(state.runnable).toBe(true);
        expect(state.operationKind).toBe('nliAdjudication');
        expect(state.runPolicy).toBe('native-only');
        expect(state.requiredModels.map((model) => model.id)).toEqual(['nli']);

        await service.runCapability('nliAdjudication', { noteIds: ['note-1'] });

        expect(phoenix.storeCommand).toHaveBeenNthCalledWith(1, 'semantic:listNliJudgmentInputs', {
            documentIds: ['note-1'],
        });
        expect(nli.initialize).toHaveBeenCalledWith('onnx-community/ModernBERT-base-nli-ONNX');
        expect(nli.classifyStream).toHaveBeenCalled();
        expect(phoenix.storeCommand).toHaveBeenNthCalledWith(2, 'semantic:applyNliJudgments', expect.objectContaining({
            modelId: 'onnx-community/ModernBERT-base-nli-ONNX',
            results: expect.arrayContaining([expect.objectContaining({ predictedLabel: 'entailment' })]),
        }));
    });
});

function createMachineMock() {
    const notice = signal<string | null>(null);
    const graphFocus = signal<unknown>(null);
    return {
        query: signal(''),
        scope: signal('global'),
        vectorStatus: signal<any>('idle'),
        graphStatus: signal<any>('idle'),
        graphAudit: signal(null),
        manifoldStatus: signal<any>('idle'),
        manifoldStatuses: signal<any>({ hybrid: 'idle', hopf: 'idle', lorentz: 'idle' }),
        notice,
        graphFocus,
        activeLanes: computed(() => ['lexical']),
        graphNodes: computed(() => 0),
        graphEdges: computed(() => 0),
        hasCommittedGraph: computed(() => false),
        setNotice: vi.fn((message: string) => notice.set(message)),
        loadSemanticModel: vi.fn(async () => undefined),
        search: vi.fn(async () => []),
        requestGraphFocus: vi.fn((focus: unknown) => graphFocus.set(focus)),
    };
}

function createNerMock() {
    const cold = { ready: false, loading: false, error: undefined, device: null };
    return {
        providerStatuses: computed(() => ({
            atlas_surface: cold,
            dynamic_ner: cold,
            fst: cold,
            lfm_local_experiment: cold,
            gliner_local: cold,
        })),
        isAnalyzing: signal(false),
        warmProvider: vi.fn(async () => undefined),
        runDynamicScan: vi.fn(async () => undefined),
        suggestions: signal([{ id: 'suggestion-1' }]),
    };
}

function createAtlasScanMock() {
    return {
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
        classifyStream: vi.fn(async (
            _inputs: unknown,
            onBatch: (batch: { results: unknown[] }) => void,
        ) => {
            onBatch({
                results: [{
                    judgmentId: 'judgment-1',
                    groupId: 'group-1',
                    sourceId: 'source-1',
                    targetId: 'target-1',
                    edgeType: 'supports',
                    direction: 'forward',
                    premise: 'Aella met Kai near the harbor.',
                    hypothesis: 'Aella encountered Kai.',
                    entailment: 0.91,
                    neutral: 0.06,
                    contradiction: 0.03,
                    predictedLabel: 'entailment',
                    confidence: 0.91,
                }],
            });
        }),
    };
}

function createNoteStoreMock() {
    return {
        currentNote: signal({
            id: 'note-1',
            title: 'Runtime Note',
            content: 'Aella met Kai near the harbor.',
            markdownContent: '',
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
        storeCommand: vi.fn(async (command: string) => {
            if (command === 'semantic:listNliJudgmentInputs') {
                return [{
                    judgmentId: 'judgment-1',
                    groupId: 'group-1',
                    sourceId: 'source-1',
                    targetId: 'target-1',
                    edgeType: 'supports',
                    direction: 'forward',
                    premise: 'Aella met Kai near the harbor.',
                    hypothesis: 'Aella encountered Kai.',
                }];
            }
            if (command === 'semantic:applyNliJudgments') {
                return { applied: 1 };
            }
            return [{ id: 'row-1' }];
        }),
    };
}
