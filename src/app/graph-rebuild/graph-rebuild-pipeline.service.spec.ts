import '@angular/compiler';
import { Injector, computed, createEnvironmentInjector, runInInjectionContext, signal, type EnvironmentInjector } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notesMock = vi.hoisted(() => ({
    rows: [] as any[],
    bulkGet: vi.fn(async (ids: string[]) => ids.map((id) => notesMock.rows.find((row) => row.id === id))),
    toArray: vi.fn(async () => notesMock.rows),
}));

const registryMock = vi.hoisted(() => ({
    entities: [] as any[],
    getAllEntities: vi.fn(() => registryMock.entities),
    updateEntity: vi.fn((id: string, updates: any) => {
        const entity = registryMock.entities.find((row) => row.id === id);
        if (!entity) return null;
        Object.assign(entity, updates, {
            attributes: { ...(entity.attributes || {}), ...(updates.attributes || {}) },
        });
        return entity;
    }),
}));

vi.mock('../lib/dexie/db', () => ({
    db: {
        notes: {
            bulkGet: notesMock.bulkGet,
            toArray: notesMock.toArray,
        },
    },
}));

vi.mock('../lib/registry', () => ({
    smartGraphRegistry: registryMock,
}));

import { GraphRebuildPipelineService } from './graph-rebuild-pipeline.service';
import { GraphRebuildService } from './graph-rebuild.service';
import { AtlasCapabilityRuntimeService } from '../services/atlas-capability-runtime.service';
import { NerService } from '../services/ner.service';
import type { GraphIndexRunRequest } from './graph-rebuild-snapshot';

describe('GraphRebuildPipelineService', () => {
    let injector: EnvironmentInjector;
    let graphRebuild: ReturnType<typeof createGraphRebuildMock>;
    let atlasRuntime: ReturnType<typeof createAtlasRuntimeMock>;
    let ner: ReturnType<typeof createNerMock>;
    let service: GraphRebuildPipelineService;

    beforeEach(() => {
        notesMock.rows = [{
            id: 'note-1',
            title: 'Short Run',
            markdownContent: 'Kai met Hazel. Hazel answered Kai.',
            content: '',
            folderId: '',
            updatedAt: 10,
            version: 2,
        }];
        notesMock.bulkGet.mockClear();
        notesMock.toArray.mockClear();
        registryMock.entities = [
            { id: 'entity-kai', label: 'Kai', aliases: [], kind: 'CHARACTER' },
            { id: 'entity-hazel', label: 'Hazel', aliases: [], kind: 'CHARACTER' },
        ];
        registryMock.getAllEntities.mockClear();
        registryMock.updateEntity.mockClear();
        graphRebuild = createGraphRebuildMock();
        atlasRuntime = createAtlasRuntimeMock();
        ner = createNerMock();
        injector = createEnvironmentInjector([
            { provide: GraphRebuildService, useValue: graphRebuild },
            { provide: AtlasCapabilityRuntimeService, useValue: atlasRuntime },
            { provide: NerService, useValue: ner },
        ], Injector.create({ providers: [] }) as unknown as EnvironmentInjector);
        service = runInInjectionContext(injector, () => new GraphRebuildPipelineService());
    });

    afterEach(() => {
        injector.destroy();
        vi.clearAllMocks();
    });

    it('blocks a full atlas build while required models are cold', async () => {
        atlasRuntime.capabilityState.mockImplementation((capability: string) => ({
            requiredModels: [{
                id: capability === 'semanticAtlas' ? 'semanticEmbedding' : capability === 'nliAdjudication' ? 'nli' : 'dynamicNer',
                readiness: capability === 'dynamicNer' ? 'ready' : 'idle',
                statusLabel: 'idle',
            }],
        }));

        await expect(service.buildFullAtlas(request())).rejects.toThrow('Load models first');

        expect(ner.runDynamicScan).not.toHaveBeenCalled();
        expect(graphRebuild.buildAndPersistSnapshot).not.toHaveBeenCalled();
    });

    it('builds the clean graph stage with only Dynamic NER warm', async () => {
        atlasRuntime.capabilityState.mockImplementation((capability: string) => ({
            requiredModels: [{
                id: capability === 'semanticAtlas' ? 'semanticEmbedding' : capability === 'nliAdjudication' ? 'nli' : 'dynamicNer',
                readiness: capability === 'dynamicNer' ? 'ready' : 'idle',
                statusLabel: capability === 'dynamicNer' ? 'ready' : 'idle',
            }],
        }));

        await service.buildCoreGraph(request());

        expect(ner.runDynamicScan).toHaveBeenCalledTimes(1);
        expect(atlasRuntime.runCapability).not.toHaveBeenCalled();
        expect(graphRebuild.buildAndPersistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            postProcessMode: 'core',
        }));
        expect(graphRebuild.persistRunReceipt).toHaveBeenCalledWith(expect.objectContaining({
            postProcessMode: 'core',
            projectionReceipts: [],
            message: expect.stringContaining('Clean graph built'),
        }));
    });

    it('expands global graph rebuilds to loaded note ids for deterministic chunking', async () => {
        notesMock.rows = [
            {
                id: 'note-1',
                title: 'First',
                markdownContent: 'Kai mapped Red Mesa.',
                content: '',
                folderId: '',
                updatedAt: 10,
                version: 2,
            },
            {
                id: 'note-2',
                title: 'Second',
                markdownContent: 'Rowan watched Boundary Keep.',
                content: '',
                folderId: '',
                updatedAt: 11,
                version: 3,
            },
        ];

        await service.buildCoreGraph({
            ...request(),
            scope: { kind: 'global', scopeId: 'global', label: 'Global', noteIds: [] },
            policy: 'force',
        });

        expect(notesMock.toArray).toHaveBeenCalled();
        expect(ner.runDynamicScan).toHaveBeenCalledTimes(2);
        expect(graphRebuild.buildAndPersistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            scopeKind: 'global',
            scopeId: 'global',
            noteIds: ['note-1', 'note-2'],
        }));
        expect(graphRebuild.persistRunReceipt).toHaveBeenCalledWith(expect.objectContaining({
            scope: expect.objectContaining({
                kind: 'global',
                scopeId: 'global',
                noteIds: ['note-1', 'note-2'],
            }),
        }));
    });

    it('removes stale selected ids from multi-note graph rebuild scopes', async () => {
        notesMock.rows = [
            {
                id: 'note-1',
                title: 'First',
                markdownContent: 'Kai mapped Red Mesa.',
                content: '',
                folderId: '',
                updatedAt: 10,
                version: 2,
            },
            {
                id: 'note-2',
                title: 'Second',
                markdownContent: 'Rowan watched Boundary Keep.',
                content: '',
                folderId: '',
                updatedAt: 11,
                version: 3,
            },
        ];

        await service.buildCoreGraph({
            ...request(),
            scope: {
                kind: 'multiNote',
                scopeId: 'multi:note-1|deleted-note|note-2',
                label: '3 notes',
                noteIds: ['note-1', 'deleted-note', 'note-2'],
            },
            policy: 'force',
        });

        expect(notesMock.bulkGet).toHaveBeenCalledWith(['note-1', 'deleted-note', 'note-2']);
        expect(ner.runDynamicScan).toHaveBeenCalledTimes(2);
        expect(graphRebuild.buildAndPersistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            scopeKind: 'multiNote',
            noteIds: ['note-1', 'note-2'],
        }));
        expect(graphRebuild.persistRunReceipt).toHaveBeenCalledWith(expect.objectContaining({
            scope: expect.objectContaining({
                kind: 'multiNote',
                noteIds: ['note-1', 'note-2'],
            }),
        }));
    });

    it('runs full atlas stages, then builds the final snapshot from NLI hints', async () => {
        await service.buildFullAtlas(request());

        expect(ner.runDynamicScan).toHaveBeenCalledWith(expect.objectContaining({
            noteId: 'note-1',
            plainText: expect.stringContaining('Kai met Hazel'),
        }));
        expect(ner.acceptSuggestionForContext).toHaveBeenCalledTimes(2);
        expect(graphRebuild.buildAndPersistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            scopeKind: 'note',
            scopeId: 'note:note-1',
            noteIds: ['note-1'],
            candidateCount: 2,
            relationshipHints: [expect.objectContaining({
                sourceId: 'entity-kai',
                targetId: 'entity-hazel',
                status: 'accepted',
            })],
        }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('semanticAtlas', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('nliAdjudication', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('relationGraph', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('temporalGraph', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('eventIdentity', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('memoryState', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('causalGraph', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('hybridManifold', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('hopfProjection', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('lorentzForest', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('productManifold', expect.objectContaining({ skipModelWarm: true }));
        expect(graphRebuild.persistRunReceipt).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
            snapshotId: 'snapshot-1',
            counters: expect.objectContaining({ nodes: 2, edges: 1 }),
            postProcessMode: 'full',
            postProcessFingerprint: expect.any(String),
            projectionReceipts: expect.arrayContaining([
                expect.objectContaining({ mode: 'hybrid', status: 'synced' }),
                expect.objectContaining({ mode: 'hopf', status: 'synced' }),
                expect.objectContaining({ mode: 'lorentz', status: 'synced' }),
                expect.objectContaining({ mode: 'product', status: 'synced' }),
            ]),
        }));
        const receipt = graphRebuild.persistRunReceipt.mock.calls[0][0];
        const semanticStage = receipt.stageReceipts.find((stage: any) => stage.id === 'semanticAtlas');
        expect(semanticStage).toEqual(expect.objectContaining({
            outputCount: 15,
            counters: expect.objectContaining({
                startedAt: 1000,
                completedAt: 2000,
                candidateSuggestions: 2,
                'nativeResult.embeddingCounts.leafVectors': 7,
            }),
        }));
        expect(service.lastSnapshot()?.id).toBe('snapshot-1');
    });

    it('reuses postprocess cache when the scope and adapter fingerprint match', async () => {
        const first = await service.postProcessAtlas(request());
        expect(graphRebuild.persistPostProcessCache).not.toHaveBeenCalled();
        graphRebuild.loadPostProcessCache.mockResolvedValue(null);
        graphRebuild.loadPersistedRunReceipt.mockResolvedValue(first.receipt);
        graphRebuild.loadPersistedSnapshot.mockResolvedValue(first.snapshot);
        atlasRuntime.runCapability.mockClear();

        const second = await service.postProcessAtlas(request());

        expect(atlasRuntime.runCapability).not.toHaveBeenCalled();
        expect(graphRebuild.restorePersistedSnapshot).toHaveBeenCalledWith(first.snapshot);
        expect(second.receipt.postProcessCacheHit).toBe(true);
        expect(second.receipt.stageReceipts).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'postProcessCache', status: 'skipped' }),
            expect.objectContaining({ id: 'uiCommit', status: 'completed' }),
        ]));
    });

    it('force postprocess does not invoke Semantic Atlas', async () => {
        const result = await service.postProcessAtlas({
            ...request(),
            policy: 'force',
        });

        expect(atlasRuntime.runCapability).not.toHaveBeenCalledWith('semanticAtlas', expect.anything());
        expect(atlasRuntime.runCapability).not.toHaveBeenCalledWith('hybridManifold', expect.anything());
        expect(atlasRuntime.runCapability).not.toHaveBeenCalledWith('hopfProjection', expect.anything());
        expect(atlasRuntime.runCapability).not.toHaveBeenCalledWith('lorentzForest', expect.anything());
        expect(atlasRuntime.runCapability).not.toHaveBeenCalledWith('productManifold', expect.anything());
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('assertedKernel', expect.objectContaining({ skipModelWarm: true }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('nliAdjudication', expect.objectContaining({ skipModelWarm: true }));
        expect(graphRebuild.buildAndPersistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            postProcessMode: 'full',
        }));
        expect(result.receipt.stageReceipts.some((stage) => stage.id === 'semanticAtlas')).toBe(false);
        expect(result.receipt.stageReceipts).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'postProcessDiscovery', label: 'Entity Discovery' }),
            expect.objectContaining({ id: 'snapshotDbOps', label: 'DB Ops' }),
            expect.objectContaining({ id: 'snapshotCpu', label: 'Snapshot CPU' }),
            expect.objectContaining({ id: 'uiCommit', label: 'UI Commit' }),
            expect.objectContaining({ id: 'receiptDbOps', label: 'Receipt DB Ops' }),
        ]));
        expect(result.receipt.projectionReceipts).toEqual(expect.arrayContaining([
            expect.objectContaining({
                mode: 'hybrid',
                status: 'skipped',
                counters: expect.objectContaining({ nativeSemanticSidecarSkipped: 1 }),
            }),
            expect.objectContaining({ mode: 'hopf', status: 'skipped' }),
            expect.objectContaining({ mode: 'lorentz', status: 'skipped' }),
            expect.objectContaining({ mode: 'product', status: 'skipped' }),
        ]));
    });

    it('runs postprocess discovery without rescanning Dynamic NER', async () => {
        const result = await service.postProcessAtlas(request());

        expect(ner.runDynamicScan).not.toHaveBeenCalled();
        expect(ner.acceptSuggestionForContext).not.toHaveBeenCalled();
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('assertedKernel', expect.objectContaining({
            buildPolicy: 'dirty-only',
            skipModelWarm: true,
        }));
        expect(result.receipt.stageReceipts).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'postProcessDiscovery',
                label: 'Entity Discovery',
                counters: expect.objectContaining({ candidateSuggestions: 3 }),
            }),
        ]));
        expect(graphRebuild.buildAndPersistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            postProcessMode: 'full',
            relationshipHints: [expect.objectContaining({
                sourceId: 'entity-kai',
                targetId: 'entity-hazel',
                status: 'accepted',
            })],
        }));
    });

    it('postprocesses global scopes against loaded note ids instead of an empty occurrence fallback', async () => {
        notesMock.rows = [
            {
                id: 'note-1',
                title: 'First',
                markdownContent: 'Kai mapped Red Mesa.',
                content: '',
                folderId: '',
                updatedAt: 10,
                version: 2,
            },
            {
                id: 'note-2',
                title: 'Second',
                markdownContent: 'Rowan watched Boundary Keep.',
                content: '',
                folderId: '',
                updatedAt: 11,
                version: 3,
            },
        ];

        await service.postProcessAtlas({
            ...request(),
            scope: { kind: 'global', scopeId: 'global', label: 'Global', noteIds: [] },
            policy: 'force',
        });

        expect(notesMock.toArray).toHaveBeenCalled();
        expect(graphRebuild.buildAndPersistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            scopeKind: 'global',
            scopeId: 'global',
            noteIds: ['note-1', 'note-2'],
            postProcessMode: 'full',
        }));
        expect(atlasRuntime.runCapability).not.toHaveBeenCalledWith('semanticAtlas', expect.anything());
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('assertedKernel', expect.objectContaining({
            buildPolicy: 'dirty-only',
            noteIds: ['note-1', 'note-2'],
            skipModelWarm: true,
        }));
        expect(atlasRuntime.runCapability).toHaveBeenCalledWith('nliAdjudication', expect.objectContaining({
            buildPolicy: 'dirty-only',
            noteIds: ['note-1', 'note-2'],
            skipModelWarm: true,
        }));
    });

    it('does not rewrite entity kinds from Angular location context during rebuild', async () => {
        notesMock.rows = [{
            id: 'note-1',
            title: 'Release Terms',
            markdownContent: "Germany's price is exchange. Kai said yes.",
            content: '',
            folderId: '',
            updatedAt: 10,
            version: 2,
        }];
        registryMock.entities = [
            { id: 'entity-germany', label: 'Germany', aliases: [], kind: 'CHARACTER', attributes: {} },
            { id: 'entity-kai', label: 'Kai', aliases: [], kind: 'CHARACTER', attributes: {} },
        ];

        await service.buildFullAtlas(request());

        expect(registryMock.updateEntity).not.toHaveBeenCalled();
        expect(graphRebuild.buildAndPersistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            entities: expect.arrayContaining([
                expect.objectContaining({ id: 'entity-germany', kind: 'CHARACTER' }),
            ]),
        }));
    });
});

function request(): GraphIndexRunRequest {
    return {
        scope: { kind: 'note', scopeId: 'note:note-1', label: 'Short Run', noteIds: ['note-1'] },
        policy: 'delta',
        modelSelection: {
            dynamicNerId: 'dynamic_ner',
            embeddingModelId: 'mongodb-leaf',
            embeddingModelLabel: 'MDBR Leaf',
            embeddingDimensionLabel: '384d',
            nliModelId: 'modernbert-nli',
        },
        entities: registryMock.entities,
    };
}

function createGraphRebuildMock() {
    return {
        buildAndPersistSnapshot: vi.fn(async () => ({
            id: 'snapshot-1',
            embeddingGraphPostProcess: { schemaVersion: 'phoenix-embedding-graph-postprocess/v1' },
            counters: {
                nodes: 2,
                edges: 1,
                chunks: 1,
                acceptedAnchors: 2,
                embeddingTargets: 3,
                embeddingVectors: 3,
                graphAwareLinkSuggestions: 2,
                dropReasons: {
                    missingEntity: 0,
                    invalidSpan: 0,
                    duplicateAnchor: 0,
                    singletonBucket: 0,
                    missingChunk: 0,
                },
            },
            buildTimings: {
                occurrenceLoadMs: 3,
                chunkLoadMs: 4,
                noteTextLoadMs: 5,
                dbLoadMs: 12,
                occurrenceRecoverMs: 2,
                snapshotBuildMs: 8,
                stateCommitMs: 1,
                snapshotPersistMs: 6,
                snapshotSerializeMs: 2,
                snapshotStoreMs: 4,
                snapshotEventMs: 0,
                snapshotPayloadChars: 1200,
                dbOpsMs: 18,
                totalMs: 27,
            },
        })),
        loadPersistedSnapshot: vi.fn(async () => null),
        loadPersistedRunReceipt: vi.fn(async () => null),
        loadPostProcessCache: vi.fn(async () => null),
        persistRunReceipt: vi.fn(async () => undefined),
        persistPostProcessCache: vi.fn(async () => undefined),
        restorePersistedSnapshot: vi.fn(async () => undefined),
    };
}

function createAtlasRuntimeMock() {
    return {
        capabilityState: vi.fn((capability: string) => ({
            requiredModels: [{
                id: capability === 'semanticAtlas' ? 'semanticEmbedding' : capability === 'nliAdjudication' ? 'nli' : 'dynamicNer',
                readiness: 'ready',
                statusLabel: 'ready',
            }],
        })),
        warmModelLane: vi.fn(async () => undefined),
        runCapability: vi.fn(async (capability: string) => ({
            rawResult: capability === 'semanticAtlas'
                ? {
                    startedAt: 1000,
                    completedAt: 2000,
                    durationMs: 1000,
                    candidateSuggestions: 2,
                    exportableMentions: 2,
                    nativeResult: {
                        processedDocuments: 1,
                        relationCandidateCount: 3,
                        embeddingCounts: { leafVectors: 7 },
                    },
                }
                : capability === 'assertedKernel'
                ? {
                    candidateSuggestions: 3,
                    indexedDocuments: 1,
                    nativeResult: {
                        processedDocuments: 1,
                        graphDeltaCounts: { nodes: 4, edges: 5 },
                    },
                }
                : capability === 'nliAdjudication'
                ? {
                    inputCount: 2,
                    resultCount: 2,
                    judgments: [{
                        judgmentId: 'j-1',
                        sourceId: 'entity-kai',
                        targetId: 'entity-hazel',
                        edgeType: 'supports',
                        predictedLabel: 'entailment',
                        confidence: 0.93,
                    }],
                }
                : { payload: { nodes: [1, 2], edges: [1] } },
        })),
    };
}

function createNerMock() {
    const suggestions = signal([
        { id: 's1', label: 'Kai', kind: 'CHARACTER', confidence: 0.9, source: 'dynamic_ner' },
        { id: 's2', label: 'Hazel', kind: 'CHARACTER', confidence: 0.9, source: 'dynamic_ner' },
    ]);
    return {
        suggestions: computed(() => suggestions()),
        runDynamicScan: vi.fn(async () => undefined),
        acceptSuggestionForContext: vi.fn(async (id: string) => {
            suggestions.set(suggestions().filter((suggestion) => suggestion.id !== id));
            return true;
        }),
    };
}
