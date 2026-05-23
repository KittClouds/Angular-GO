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
        expect(graphRebuild.persistRunReceipt).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
            snapshotId: 'snapshot-1',
            counters: expect.objectContaining({ nodes: 2, edges: 1 }),
            projectionReceipts: expect.arrayContaining([
                expect.objectContaining({ mode: 'hybrid', status: 'synced' }),
                expect.objectContaining({ mode: 'hopf', status: 'synced' }),
                expect.objectContaining({ mode: 'lorentz', status: 'synced' }),
            ]),
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
            counters: {
                nodes: 2,
                edges: 1,
                chunks: 1,
                acceptedAnchors: 2,
                embeddingTargets: 3,
                embeddingVectors: 3,
                dropReasons: {
                    missingEntity: 0,
                    invalidSpan: 0,
                    duplicateAnchor: 0,
                    singletonBucket: 0,
                    missingChunk: 0,
                },
            },
        })),
        persistRunReceipt: vi.fn(async () => undefined),
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
            rawResult: capability === 'nliAdjudication'
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
