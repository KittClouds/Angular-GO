import { Injectable, computed, inject, signal } from '@angular/core';

import { db, type Note } from '../lib/dexie/db';
import { smartGraphRegistry } from '../lib/registry';
import type { AtlasCapabilityId } from '../components/search-panel/atlas-capability.model';
import type { AtlasBuildScope, AtlasRunOptions } from '../services/atlas-capability-runtime.model';
import { AtlasCapabilityRuntimeService } from '../services/atlas-capability-runtime.service';
import { NerService } from '../services/ner.service';
import { embeddingProfileFromModelSelection } from './graph-rebuild-embedding-signatures';
import { GraphRebuildService } from './graph-rebuild.service';
import type {
    GraphIndexModelReadiness,
    GraphIndexPostProcessMode,
    GraphIndexProjectionMode,
    GraphIndexProjectionReceipt,
    GraphIndexRunReceipt,
    GraphIndexRunRequest,
    GraphIndexRunStatus,
    GraphIndexRunScope,
    GraphIndexStageReceipt,
    GraphRebuildCounters,
    GraphRebuildDropReasons,
    GraphRebuildRelationshipHint,
    GraphRebuildSnapshot,
} from './graph-rebuild-snapshot';

const FULL_INDEX_CAPABILITIES: AtlasCapabilityId[] = [
    'semanticAtlas',
    'nliAdjudication',
    'relationGraph',
    'temporalGraph',
    'eventIdentity',
    'memoryState',
    'causalGraph',
];

const POSTPROCESS_FACT_CAPABILITIES: AtlasCapabilityId[] = [
    'nliAdjudication',
    'relationGraph',
    'temporalGraph',
    'eventIdentity',
    'memoryState',
    'causalGraph',
];

const POSTPROCESS_DISCOVERY_CAPABILITY: AtlasCapabilityId = 'assertedKernel';

const PROJECTION_CAPABILITIES: Array<{ capability: AtlasCapabilityId; mode: GraphIndexProjectionMode }> = [
    { capability: 'hybridManifold', mode: 'hybrid' },
    { capability: 'hopfProjection', mode: 'hopf' },
    { capability: 'lorentzForest', mode: 'lorentz' },
    { capability: 'productManifold', mode: 'product' },
];

type PipelineResult = {
    receipt: GraphIndexRunReceipt;
    snapshot: GraphRebuildSnapshot;
};

type ScopedDocument = {
    id: string;
    title: string;
    plainText: string;
    folderId?: string;
    version?: number;
    updatedAt?: number;
};

@Injectable({ providedIn: 'root' })
export class GraphRebuildPipelineService {
    private readonly graphRebuild = inject(GraphRebuildService);
    private readonly atlasRuntime = inject(AtlasCapabilityRuntimeService);
    private readonly ner = inject(NerService);
    private readonly runningState = signal(false);
    private readonly lastReceiptState = signal<GraphIndexRunReceipt | null>(null);
    private readonly lastSnapshotState = signal<GraphRebuildSnapshot | null>(null);

    readonly running = computed(() => this.runningState());
    readonly lastReceipt = computed(() => this.lastReceiptState());
    readonly lastSnapshot = computed(() => this.lastSnapshotState());

    modelReadiness(request: GraphIndexRunRequest): GraphIndexModelReadiness[] {
        const options = this.atlasOptions(request);
        const dynamicNer = this.requiredModelState('dynamicNer', 'Dynamic NER', 'dynamicNer', options);
        const semanticEmbedding = this.requiredModelState('semanticEmbedding', 'Semantic Embedding', 'semanticAtlas', options);
        const nli = this.requiredModelState('nli', 'NLI', 'nliAdjudication', options);
        return [dynamicNer, semanticEmbedding, nli];
    }

    modelsReady(request: GraphIndexRunRequest): boolean {
        return this.modelReadiness(request).every((model) => model.status === 'ready');
    }

    coreModelsReady(request: GraphIndexRunRequest): boolean {
        return this.modelReadiness(request).find((model) => model.id === 'dynamicNer')?.status === 'ready';
    }

    async loadModels(request: GraphIndexRunRequest): Promise<void> {
        if (this.runningState()) return;
        this.runningState.set(true);
        try {
            const options = this.atlasOptions(request);
            await this.atlasRuntime.warmModelLane('dynamicNer', options);
            await this.atlasRuntime.warmModelLane('semanticEmbedding', options);
            await this.atlasRuntime.warmModelLane('nli', options);
        } finally {
            this.runningState.set(false);
        }
    }

    async buildCoreGraph(request: GraphIndexRunRequest): Promise<PipelineResult> {
        if (this.runningState()) {
            throw new Error('Full Atlas Index is already running.');
        }
        if (!this.coreModelsReady(request)) {
            throw new Error('Load Dynamic NER first.');
        }

        this.runningState.set(true);
        const runStarted = Date.now();
        const stageReceipts: GraphIndexStageReceipt[] = [];
        const snapshotRef: { value?: GraphRebuildSnapshot } = {};
        try {
            const docs = await this.loadScopedDocuments(request.scope.noteIds);
            const scope = expandScopeNoteIds(request.scope, docs);
            const nerStage = await this.runStage('dynamicNer', 'Dynamic NER + Alex Deltas', async () => {
                const counts = await this.runNerDeltas(docs);
                return {
                    outputCount: counts['acceptedAnchors'] || 0,
                    counters: counts,
                    message: `${counts['acceptedAnchors'] || 0} accepted anchors from ${counts['candidates'] || 0} candidates`,
                };
            });
            stageReceipts.push(nerStage);
            assertStageCompleted(nerStage);

            const entities = smartGraphRegistry.getAllEntities().length
                ? smartGraphRegistry.getAllEntities()
                : request.entities;
            const graphStage = await this.runStage('coreGraphSnapshot', 'Clean Graph Snapshot', async () => {
                const snapshot = await this.graphRebuild.buildAndPersistSnapshot({
                    scopeKind: scope.kind,
                    scopeId: scope.scopeId,
                    noteIds: scope.noteIds,
                    entities,
                    embeddingProfile: embeddingProfileFromModelSelection(request.modelSelection),
                    postProcessMode: 'core',
                    candidateCount: nerStage.counters['candidates'] || 0,
                });
                snapshotRef.value = snapshot;
                return {
                    outputCount: snapshot.counters.nodes + snapshot.counters.edges,
                    counters: {
                        chunks: snapshot.counters.chunks,
                        anchors: snapshot.counters.acceptedAnchors,
                        nodes: snapshot.counters.nodes,
                        edges: snapshot.counters.edges,
                    },
                    message: `${snapshot.counters.nodes} clean nodes / ${snapshot.counters.edges} clean edges`,
                };
            });
            stageReceipts.push(graphStage);
            assertStageCompleted(graphStage);
            const completedSnapshot = snapshotRef.value;
            if (!completedSnapshot) {
                throw new Error('Clean graph stage completed without a snapshot.');
            }
            appendSnapshotTimingStages(stageReceipts, completedSnapshot);

            const completedAt = Date.now();
            const receipt = this.buildRunReceipt({
                idPrefix: 'core-atlas',
                scope,
                policy: request.policy,
                postProcessMode: 'core',
                modelSelection: request.modelSelection,
                modelReadiness: this.modelReadiness({ ...request, scope }),
                startedAt: runStarted,
                completedAt,
                stageReceipts,
                projectionReceipts: [],
                snapshot: completedSnapshot,
                message: `Clean graph built ${completedSnapshot.counters.nodes} nodes and ${completedSnapshot.counters.edges} edges.`,
            });
            await this.publishRunReceipt(receipt, completedSnapshot);
            await this.graphRebuild.persistRunReceipt(receipt);
            return { receipt, snapshot: completedSnapshot };
        } catch (error) {
            const completedAt = Date.now();
            const snapshot = snapshotRef.value || null;
            const failedReceipt = this.buildRunReceipt({
                idPrefix: 'core-atlas:failed',
                scope: request.scope,
                policy: request.policy,
                postProcessMode: 'core',
                modelSelection: request.modelSelection,
                modelReadiness: this.modelReadiness(request),
                startedAt: runStarted,
                completedAt,
                stageReceipts,
                projectionReceipts: [],
                snapshot,
                status: 'failed',
                message: error instanceof Error ? error.message : String(error),
            });
            if (snapshot) this.lastSnapshotState.set(snapshot);
            this.lastReceiptState.set(failedReceipt);
            throw error;
        } finally {
            this.runningState.set(false);
        }
    }

    async buildFullAtlas(request: GraphIndexRunRequest): Promise<PipelineResult> {
        if (this.runningState()) {
            throw new Error('Full Atlas Index is already running.');
        }
        const modelReadiness = this.modelReadiness(request);
        const cold = modelReadiness.filter((model) => model.status !== 'ready');
        if (cold.length) {
            throw new Error(`Load models first: ${cold.map((model) => model.label).join(', ')}.`);
        }

        this.runningState.set(true);
        const runStarted = Date.now();
        const stageReceipts: GraphIndexStageReceipt[] = [];
        const projectionReceipts: GraphIndexProjectionReceipt[] = [];
        let snapshot: GraphRebuildSnapshot | null = null;
        let relationshipHints: GraphRebuildRelationshipHint[] = [];

        try {
            const docs = await this.loadScopedDocuments(request.scope.noteIds);
            const scope = expandScopeNoteIds(request.scope, docs);
            const options = this.atlasOptions({ ...request, scope });
            const entities = smartGraphRegistry.getAllEntities().length
                ? smartGraphRegistry.getAllEntities()
                : request.entities;
            const fingerprint = postProcessFingerprint(scope, docs, entities, request.modelSelection);
            const nerStage = await this.runStage('dynamicNer', 'Dynamic NER + Alex Deltas', async () => {
                const counts = await this.runNerDeltas(docs);
                return {
                    outputCount: counts['acceptedAnchors'] || 0,
                    counters: counts,
                    message: `${counts['acceptedAnchors'] || 0} accepted anchors from ${counts['candidates'] || 0} candidates`,
                };
            });
            stageReceipts.push(nerStage);
            assertStageCompleted(nerStage);

            for (const capability of FULL_INDEX_CAPABILITIES) {
                const receipt = await this.runCapabilityStage(capability, options, capability === 'nliAdjudication'
                    ? (rawResult) => {
                        relationshipHints = relationshipHintsFromNliResult(rawResult);
                    }
                    : undefined);
                stageReceipts.push(receipt);
                assertStageCompleted(receipt);
            }

            const graphStage = await this.runStage('graphSnapshot', 'Graph Rebuild Snapshot', async () => {
                snapshot = await this.graphRebuild.buildAndPersistSnapshot({
                    scopeKind: scope.kind,
                    scopeId: scope.scopeId,
                    noteIds: scope.noteIds,
                    entities,
                    relationshipHints,
                    embeddingProfile: embeddingProfileFromModelSelection(request.modelSelection),
                    postProcessMode: 'full',
                    candidateCount: nerStage.counters['candidates'] || 0,
                });
                return {
                    outputCount: snapshot.counters.nodes + snapshot.counters.edges,
                    counters: {
                        chunks: snapshot.counters.chunks,
                        anchors: snapshot.counters.acceptedAnchors,
                        nodes: snapshot.counters.nodes,
                        edges: snapshot.counters.edges,
                        acceptedRelationships: snapshot.counters.acceptedRelationships,
                        reviewRelationships: snapshot.counters.reviewRelationships,
                        rejectedRelationships: snapshot.counters.rejectedRelationships,
                        embeddingClusters: snapshot.counters.embeddingClusters || 0,
                        embeddingBackboneEdges: snapshot.counters.embeddingBackboneEdges || 0,
                        embeddingOutliers: snapshot.counters.embeddingOutliers || 0,
                        linkSuggestions: snapshot.counters.graphAwareLinkSuggestions || 0,
                        entityLinks: snapshot.counters.entityLinkSuggestions || 0,
                        nliHints: relationshipHints.length,
                    },
                    message: `${snapshot.counters.nodes} nodes / ${snapshot.counters.edges} edges / ${snapshot.counters.graphAwareLinkSuggestions || 0} graph links / ${snapshot.counters.entityLinkSuggestions || 0} entity links`,
                };
            });
            stageReceipts.push(graphStage);
            assertStageCompleted(graphStage);
            if (snapshot) {
                appendSnapshotTimingStages(stageReceipts, snapshot);
            }

            for (const projection of PROJECTION_CAPABILITIES) {
                projectionReceipts.push(await this.runProjectionStage(projection.capability, projection.mode, options, snapshot));
            }

            const completedAt = Date.now();
            const completedSnapshot = snapshot as GraphRebuildSnapshot | null;
            const receipt: GraphIndexRunReceipt = {
                schemaVersion: 'phoenix-graph-index-run/v1',
                id: `full-atlas:${scope.scopeId}:${completedAt}`,
                scope,
                policy: request.policy,
                delta: request.policy !== 'force',
                status: 'completed',
                modelSelection: request.modelSelection,
                postProcessMode: 'full',
                postProcessFingerprint: fingerprint,
                postProcessCacheHit: false,
                modelReadiness: this.modelReadiness({ ...request, scope }),
                startedAt: runStarted,
                completedAt,
                durationMs: completedAt - runStarted,
                stageReceipts,
                projectionReceipts,
                snapshotId: completedSnapshot?.id,
                counters: completedSnapshot?.counters || emptyCounters(),
                dropReasons: completedSnapshot?.counters.dropReasons || emptyDropReasons(),
                message: completedSnapshot
                    ? `Full Atlas Index built ${completedSnapshot.counters.nodes} nodes, ${completedSnapshot.counters.edges} edges, and ${completedSnapshot.counters.entityLinkSuggestions || 0} entity links.`
                    : 'Full Atlas Index completed without a graph snapshot.',
            };
            await this.publishRunReceipt(receipt, completedSnapshot);
            await this.graphRebuild.persistRunReceipt(receipt);
            return { receipt, snapshot: completedSnapshot! };
        } catch (error) {
            const completedAt = Date.now();
            const failedSnapshot = snapshot as GraphRebuildSnapshot | null;
            const failedReceipt: GraphIndexRunReceipt = {
                schemaVersion: 'phoenix-graph-index-run/v1',
                id: `full-atlas:failed:${completedAt}`,
                scope: request.scope,
                policy: request.policy,
                delta: request.policy !== 'force',
                status: 'failed',
                modelSelection: request.modelSelection,
                postProcessMode: 'full',
                modelReadiness,
                startedAt: runStarted,
                completedAt,
                durationMs: completedAt - runStarted,
                stageReceipts,
                projectionReceipts,
                snapshotId: failedSnapshot?.id,
                counters: failedSnapshot?.counters || emptyCounters(),
                dropReasons: failedSnapshot?.counters.dropReasons || emptyDropReasons(),
                message: error instanceof Error ? error.message : String(error),
            };
            if (failedSnapshot) this.lastSnapshotState.set(failedSnapshot);
            this.lastReceiptState.set(failedReceipt);
            throw error;
        } finally {
            this.runningState.set(false);
        }
    }

    async postProcessAtlas(request: GraphIndexRunRequest): Promise<PipelineResult> {
        if (this.runningState()) {
            throw new Error('Full Atlas Index is already running.');
        }
        const modelReadiness = this.modelReadiness(request);
        const cold = modelReadiness.filter((model) => model.status !== 'ready');
        if (cold.length) {
            throw new Error(`Load models first: ${cold.map((model) => model.label).join(', ')}.`);
        }

        this.runningState.set(true);
        const runStarted = Date.now();
        const stageReceipts: GraphIndexStageReceipt[] = [];
        const projectionReceipts: GraphIndexProjectionReceipt[] = [];
        const snapshotRef: { value?: GraphRebuildSnapshot } = {};
        try {
            const docs = await this.loadScopedDocuments(request.scope.noteIds);
            const scope = expandScopeNoteIds(request.scope, docs);
            const options = this.atlasOptions({ ...request, scope, postProcessMode: 'full' });
            const postProcessStageOptions = { ...options, buildPolicy: 'dirty-only' as const };
            const entities = smartGraphRegistry.getAllEntities().length
                ? smartGraphRegistry.getAllEntities()
                : request.entities;
            const fingerprint = postProcessFingerprint(scope, docs, entities, request.modelSelection);
            const postProcessCache = await this.safeLoadPostProcessCache(scope.scopeId, fingerprint);
            const cachedReceipt = await this.safeLoadReceipt(scope.scopeId);
            const cachedSnapshot = postProcessCache?.snapshot || await this.safeLoadSnapshot(scope.scopeId);
            const cacheReceipt = postProcessCache?.receipt || cachedReceipt;
            if (
                request.policy !== 'force'
                && cachedSnapshot?.embeddingGraphPostProcess
                && (
                    Boolean(postProcessCache)
                    || (
                        cacheReceipt?.postProcessMode === 'full'
                        && cacheReceipt.postProcessFingerprint === fingerprint
                    )
                )
            ) {
                const completedAt = Date.now();
                const cacheStage = skippedStage(
                    'postProcessCache',
                    'Postprocess Cache',
                    runStarted,
                    completedAt,
                    'Embedding topology and graph-aware links reused from fingerprint cache',
                );
                const receipt = this.buildRunReceipt({
                    idPrefix: 'postprocess-atlas',
                    scope,
                    policy: request.policy,
                    postProcessMode: 'full',
                    postProcessFingerprint: fingerprint,
                    postProcessCacheHit: true,
                    modelSelection: request.modelSelection,
                    modelReadiness: this.modelReadiness({ ...request, scope }),
                    startedAt: runStarted,
                    completedAt,
                    stageReceipts: [cacheStage],
                    projectionReceipts: cacheReceipt?.projectionReceipts || [],
                    snapshot: cachedSnapshot,
                    message: 'Postprocess cache reused for this scope.',
                });
                await this.publishRunReceipt(receipt, cachedSnapshot);
                await this.graphRebuild.restorePersistedSnapshot(cachedSnapshot);
                await this.graphRebuild.persistRunReceipt(receipt);
                return { receipt, snapshot: cachedSnapshot };
            }

            let relationshipHints: GraphRebuildRelationshipHint[] = [];
            const discoveryStage = await this.runPostProcessDiscoveryStage(postProcessStageOptions);
            stageReceipts.push(discoveryStage);
            assertStageCompleted(discoveryStage);

            for (const capability of POSTPROCESS_FACT_CAPABILITIES) {
                const captureRelationshipHints = capability === 'nliAdjudication'
                    ? (rawResult: unknown) => {
                        relationshipHints = relationshipHintsFromNliResult(rawResult);
                    }
                    : undefined;
                const receipt = await this.runCapabilityStage(capability, postProcessStageOptions, captureRelationshipHints);
                stageReceipts.push(receipt);
                assertStageCompleted(receipt);
            }

            const graphStage = await this.runStage('postProcessSnapshot', 'Postprocess Snapshot', async () => {
                const snapshot = await this.graphRebuild.buildAndPersistSnapshot({
                    scopeKind: scope.kind,
                    scopeId: scope.scopeId,
                    noteIds: scope.noteIds,
                    entities,
                    relationshipHints,
                    embeddingProfile: embeddingProfileFromModelSelection(request.modelSelection),
                    postProcessMode: 'full',
                    candidateCount: cachedSnapshot?.counters.candidates || 0,
                });
                snapshotRef.value = snapshot;
                return {
                    outputCount: (snapshot.counters.embeddingTargets || 0)
                        + (snapshot.counters.graphAwareLinkSuggestions || 0)
                        + (snapshot.counters.entityLinkSuggestions || 0),
                    counters: {
                        embeddingTargets: snapshot.counters.embeddingTargets,
                        embeddingClusters: snapshot.counters.embeddingClusters || 0,
                        embeddingBackboneEdges: snapshot.counters.embeddingBackboneEdges || 0,
                        embeddingOutliers: snapshot.counters.embeddingOutliers || 0,
                        linkSuggestions: snapshot.counters.graphAwareLinkSuggestions || 0,
                        entityLinks: snapshot.counters.entityLinkSuggestions || 0,
                        nliHints: relationshipHints.length,
                    },
                    message: `${snapshot.counters.embeddingTargets} targets / ${snapshot.counters.graphAwareLinkSuggestions || 0} graph links / ${snapshot.counters.entityLinkSuggestions || 0} entity links`,
                };
            });
            stageReceipts.push(graphStage);
            assertStageCompleted(graphStage);
            const completedSnapshot = snapshotRef.value;
            if (!completedSnapshot) {
                throw new Error('Postprocess stage completed without a snapshot.');
            }
            appendSnapshotTimingStages(stageReceipts, completedSnapshot);

            for (const projection of PROJECTION_CAPABILITIES) {
                projectionReceipts.push(skippedProjectionReceipt(projection.mode, completedSnapshot));
            }

            const completedAt = Date.now();
            const receipt = this.buildRunReceipt({
                idPrefix: 'postprocess-atlas',
                scope,
                policy: request.policy,
                postProcessMode: 'full',
                postProcessFingerprint: fingerprint,
                postProcessCacheHit: false,
                modelSelection: request.modelSelection,
                modelReadiness: this.modelReadiness({ ...request, scope }),
                startedAt: runStarted,
                completedAt,
                stageReceipts,
                projectionReceipts,
                snapshot: completedSnapshot,
                message: `Postprocess built ${completedSnapshot.counters.embeddingTargets} embedding targets, ${completedSnapshot.counters.graphAwareLinkSuggestions || 0} graph links, and ${completedSnapshot.counters.entityLinkSuggestions || 0} entity links.`,
            });
            await this.publishRunReceipt(receipt, completedSnapshot);
            await this.persistRunReceiptWithTiming(receipt);
            return { receipt, snapshot: completedSnapshot };
        } catch (error) {
            const completedAt = Date.now();
            const snapshot = snapshotRef.value || null;
            const failedReceipt = this.buildRunReceipt({
                idPrefix: 'postprocess-atlas:failed',
                scope: request.scope,
                policy: request.policy,
                postProcessMode: 'full',
                modelSelection: request.modelSelection,
                modelReadiness,
                startedAt: runStarted,
                completedAt,
                stageReceipts,
                projectionReceipts,
                snapshot,
                status: 'failed',
                message: error instanceof Error ? error.message : String(error),
            });
            if (snapshot) this.lastSnapshotState.set(snapshot);
            this.lastReceiptState.set(failedReceipt);
            throw error;
        } finally {
            this.runningState.set(false);
        }
    }

    private buildRunReceipt(input: {
        idPrefix: string;
        scope: GraphIndexRunScope;
        policy: GraphIndexRunRequest['policy'];
        postProcessMode?: GraphIndexPostProcessMode;
        postProcessFingerprint?: string;
        postProcessCacheHit?: boolean;
        modelSelection: GraphIndexRunRequest['modelSelection'];
        modelReadiness: GraphIndexModelReadiness[];
        startedAt: number;
        completedAt: number;
        stageReceipts: GraphIndexStageReceipt[];
        projectionReceipts: GraphIndexProjectionReceipt[];
        snapshot: GraphRebuildSnapshot | null;
        status?: GraphIndexRunStatus;
        message: string;
    }): GraphIndexRunReceipt {
        return {
            schemaVersion: 'phoenix-graph-index-run/v1',
            id: `${input.idPrefix}:${input.scope.scopeId}:${input.completedAt}`,
            scope: input.scope,
            policy: input.policy,
            delta: input.policy !== 'force',
            status: input.status || 'completed',
            modelSelection: input.modelSelection,
            postProcessMode: input.postProcessMode,
            postProcessFingerprint: input.postProcessFingerprint,
            postProcessCacheHit: input.postProcessCacheHit,
            modelReadiness: input.modelReadiness,
            startedAt: input.startedAt,
            completedAt: input.completedAt,
            durationMs: input.completedAt - input.startedAt,
            stageReceipts: input.stageReceipts,
            projectionReceipts: input.projectionReceipts,
            snapshotId: input.snapshot?.id,
            counters: input.snapshot?.counters || emptyCounters(),
            dropReasons: input.snapshot?.counters.dropReasons || emptyDropReasons(),
            message: input.message,
        };
    }

    private async publishRunReceipt(
        receipt: GraphIndexRunReceipt,
        snapshot: GraphRebuildSnapshot | null,
    ): Promise<void> {
        const startedAt = Date.now();
        const uiStage: GraphIndexStageReceipt = {
            id: 'uiCommit',
            label: 'UI Commit',
            status: 'completed',
            startedAt,
            completedAt: startedAt,
            durationMs: 0,
            outputCount: 0,
            counters: {},
            message: 'Receipt and snapshot published to UI signals',
        };
        receipt.stageReceipts.push(uiStage);
        const signalStarted = performance.now();
        if (snapshot) this.lastSnapshotState.set(snapshot);
        this.lastReceiptState.set({ ...receipt, stageReceipts: [...receipt.stageReceipts] });
        const signalCommitMs = elapsedTimingMs(signalStarted);
        const frameStarted = performance.now();
        await waitForUiFrame();
        const uiFrameMs = elapsedTimingMs(frameStarted);
        const completedAt = Date.now();
        uiStage.completedAt = completedAt;
        uiStage.durationMs = completedAt - startedAt;
        uiStage.counters = {
            signalCommitMs,
            uiFrameMs,
        };
        receipt.completedAt = Math.max(receipt.completedAt, completedAt);
        receipt.durationMs = receipt.completedAt - receipt.startedAt;
        this.lastReceiptState.set({ ...receipt, stageReceipts: [...receipt.stageReceipts] });
    }

    private async persistRunReceiptWithTiming(receipt: GraphIndexRunReceipt): Promise<void> {
        const startedAt = Date.now();
        const started = performance.now();
        await this.graphRebuild.persistRunReceipt(receipt);
        const durationMs = elapsedTimingMs(started);
        const completedAt = Date.now();
        receipt.stageReceipts.push({
            id: 'receiptDbOps',
            label: 'Receipt DB Ops',
            status: 'completed',
            startedAt,
            completedAt,
            durationMs,
            outputCount: 0,
            counters: {
                receiptPersistMs: durationMs,
            },
            message: 'Run receipt persisted to scoped documents',
        });
        receipt.completedAt = Math.max(receipt.completedAt, completedAt);
        receipt.durationMs = receipt.completedAt - receipt.startedAt;
        this.lastReceiptState.set({ ...receipt, stageReceipts: [...receipt.stageReceipts] });
    }

    private async safeLoadSnapshot(scopeId: string): Promise<GraphRebuildSnapshot | null> {
        try {
            return await this.graphRebuild.loadPersistedSnapshot(scopeId);
        } catch {
            return null;
        }
    }

    private async safeLoadReceipt(scopeId: string): Promise<GraphIndexRunReceipt | null> {
        try {
            return await this.graphRebuild.loadPersistedRunReceipt(scopeId);
        } catch {
            return null;
        }
    }

    private async safeLoadPostProcessCache(scopeId: string, fingerprint: string) {
        try {
            return await this.graphRebuild.loadPostProcessCache(scopeId, fingerprint);
        } catch {
            return null;
        }
    }

    private async runPostProcessDiscoveryStage(options: AtlasRunOptions): Promise<GraphIndexStageReceipt> {
        return this.runStage('postProcessDiscovery', 'Entity Discovery', async () => {
            const result = await this.atlasRuntime.runCapability(POSTPROCESS_DISCOVERY_CAPABILITY, {
                ...options,
                skipModelWarm: true,
            });
            const counters = numberCounts(result.rawResult);
            const suggestions = counters['candidateSuggestions'] || counters['suggestions'] || 0;
            const documents = counters['indexedDocuments'] || counters['processedDocuments'] || counters['documents'] || 0;
            return {
                outputCount: suggestions || sumOutputCounts(counters),
                counters,
                message: suggestions
                    ? `${suggestions} review candidates from ${documents || 0} documents`
                    : 'Entity discovery refreshed without new review candidates',
            };
        });
    }

    private async runNerDeltas(docs: ScopedDocument[]): Promise<Record<string, number>> {
        let candidates = 0;
        let acceptedAnchors = 0;
        let dropped = 0;
        for (const doc of docs) {
            if (!doc.plainText.trim()) continue;
            await this.ner.runDynamicScan({
                noteId: doc.id,
                noteTitle: doc.title || 'Untitled Note',
                plainText: doc.plainText,
            });
            const suggestions = [...this.ner.suggestions()];
            candidates += suggestions.length;
            for (const suggestion of suggestions) {
                const accepted = await this.ner.acceptSuggestionForContext(suggestion.id, {
                    noteId: doc.id,
                    noteTitle: doc.title,
                    plainText: doc.plainText,
                    generation: doc.version || doc.updatedAt || Date.now(),
                    registrationSource: 'extraction',
                });
                acceptedAnchors += accepted ? 1 : 0;
                dropped += accepted ? 0 : 1;
            }
        }
        return { documents: docs.length, candidates, acceptedAnchors, dropped };
    }

    private async runCapabilityStage(
        capability: AtlasCapabilityId,
        options: AtlasRunOptions,
        onRawResult?: (result: unknown) => void,
    ): Promise<GraphIndexStageReceipt> {
        return this.runStage(capability, capabilityLabel(capability), async () => {
            const result = await this.atlasRuntime.runCapability(capability, { ...options, skipModelWarm: true });
            onRawResult?.(result.rawResult);
            const counters = numberCounts(result.rawResult);
            return {
                outputCount: sumOutputCounts(counters),
                counters,
                message: `${capabilityLabel(capability)} completed`,
            };
        });
    }

    private async runProjectionStage(
        capability: AtlasCapabilityId,
        mode: GraphIndexProjectionMode,
        options: AtlasRunOptions,
        snapshot: GraphRebuildSnapshot | null,
    ): Promise<GraphIndexProjectionReceipt> {
        const startedAt = Date.now();
        try {
            const result = await this.atlasRuntime.runCapability(capability, { ...options, skipModelWarm: true });
            const counters = numberCounts(result.rawResult);
            const completedAt = Date.now();
            const durationMs = completedAt - startedAt;
            const projectionCounters = projectionTimingCounters(counters, durationMs);
            return {
                mode,
                status: 'synced',
                startedAt,
                completedAt,
                durationMs,
                targetCount: snapshot?.counters.embeddingTargets || counters['manifold.nodes'] || 0,
                vectorCount: snapshot?.counters.embeddingVectors || counters['manifold.nodes'] || 0,
                counters: projectionCounters,
                message: `${capabilityLabel(capability)} synced`,
            };
        } catch (error) {
            const completedAt = Date.now();
            return {
                mode,
                status: 'error',
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                targetCount: snapshot?.counters.embeddingTargets || 0,
                vectorCount: snapshot?.counters.embeddingVectors || 0,
                counters: {},
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async runStage(
        id: string,
        label: string,
        action: () => Promise<{ outputCount: number; counters: Record<string, number>; message: string }>,
    ): Promise<GraphIndexStageReceipt> {
        const startedAt = Date.now();
        try {
            const result = await action();
            const completedAt = Date.now();
            return {
                id,
                label,
                status: 'completed',
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                outputCount: result.outputCount,
                counters: result.counters,
                message: result.message,
            };
        } catch (error) {
            const completedAt = Date.now();
            return {
                id,
                label,
                status: 'failed',
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                outputCount: 0,
                counters: {},
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async loadScopedDocuments(noteIds: string[]): Promise<ScopedDocument[]> {
        const rows = noteIds.length
            ? (await db.notes.bulkGet(noteIds)).filter((note): note is Note => !!note)
            : await db.notes.toArray();
        return rows.map((note) => ({
            id: note.id,
            title: note.title || 'Untitled Note',
            plainText: String(note.markdownContent || note.content || ''),
            folderId: note.folderId,
            version: note.version,
            updatedAt: note.updatedAt,
        }));
    }

    private atlasOptions(request: GraphIndexRunRequest): AtlasRunOptions {
        return {
            selectedModel: request.modelSelection.embeddingModelId as any,
            selectedModelLabel: request.modelSelection.embeddingModelLabel,
            dimensionLabel: request.modelSelection.embeddingDimensionLabel,
            scope: request.scope.kind === 'global' ? 'global' : request.scope.scopeId,
            buildScope: atlasScopeFromGraphScope(request.scope),
            buildPolicy: request.policy === 'force' ? 'force' : 'dirty-only',
            noteIds: request.scope.noteIds,
        };
    }

    private requiredModelState(
        modelId: GraphIndexModelReadiness['id'],
        label: string,
        capability: AtlasCapabilityId,
        options: AtlasRunOptions,
    ): GraphIndexModelReadiness {
        const requirement = this.atlasRuntime
            .capabilityState(capability, options)
            .requiredModels.find((model) => model.id === modelId);
        return {
            id: modelId,
            label,
            status: (requirement?.readiness || 'idle') as GraphIndexModelReadiness['status'],
            detail: requirement?.statusLabel || 'idle',
        };
    }
}

function expandScopeNoteIds(scope: GraphIndexRunScope, docs: ScopedDocument[]): GraphIndexRunScope {
    const loadedNoteIds = docs.map((doc) => doc.id);
    if (scope.kind === 'global') return { ...scope, noteIds: loadedNoteIds };
    if (!scope.noteIds.length) return { ...scope, noteIds: loadedNoteIds };
    if (scope.kind === 'multiNote' || scope.kind === 'folder') return { ...scope, noteIds: loadedNoteIds };
    return scope;
}

function appendSnapshotTimingStages(
    stageReceipts: GraphIndexStageReceipt[],
    snapshot: GraphRebuildSnapshot,
): void {
    const timings = snapshot.buildTimings;
    if (!timings) return;
    stageReceipts.push(instrumentationStage(
        'snapshotDbOps',
        'DB Ops',
        Math.round(timings.dbOpsMs),
        {
            dbLoadMs: timings.dbLoadMs,
            snapshotPersistMs: timings.snapshotPersistMs,
            snapshotStoreMs: timings.snapshotStoreMs || 0,
            snapshotSerializeMs: timings.snapshotSerializeMs || 0,
            snapshotPayloadChars: timings.snapshotPayloadChars || 0,
            occurrenceLoadMs: timings.occurrenceLoadMs,
            chunkLoadMs: timings.chunkLoadMs,
            noteTextLoadMs: timings.noteTextLoadMs,
        },
        'Snapshot DB reads and persist timing',
    ));
    stageReceipts.push(instrumentationStage(
        'snapshotCpu',
        'Snapshot CPU',
        Math.round(timings.occurrenceRecoverMs + timings.snapshotBuildMs),
        {
            occurrenceRecoverMs: timings.occurrenceRecoverMs,
            snapshotBuildMs: timings.snapshotBuildMs,
            serviceStateCommitMs: timings.stateCommitMs,
            totalBuildMs: timings.totalMs,
        },
        'Graph rebuild CPU and service state timing',
    ));
}

function instrumentationStage(
    id: string,
    label: string,
    durationMs: number,
    counters: Record<string, number>,
    message: string,
): GraphIndexStageReceipt {
    const completedAt = Date.now();
    const safeDuration = Math.max(0, Math.round(durationMs || 0));
    return {
        id,
        label,
        status: 'completed',
        startedAt: completedAt - safeDuration,
        completedAt,
        durationMs: safeDuration,
        outputCount: 0,
        counters,
        message,
    };
}

function skippedProjectionReceipt(
    mode: GraphIndexProjectionMode,
    snapshot: GraphRebuildSnapshot | null,
): GraphIndexProjectionReceipt {
    const now = Date.now();
    return {
        mode,
        status: 'skipped',
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        targetCount: snapshot?.counters.embeddingTargets || 0,
        vectorCount: snapshot?.counters.embeddingVectors || 0,
        counters: {
            graphRebuildTargets: snapshot?.counters.embeddingTargets || 0,
            nativeSemanticSidecarSkipped: 1,
        },
        message: 'Native Semantic Atlas sidecar projection skipped; graph-rebuild snapshot owns postprocess topology',
    };
}

function atlasScopeFromGraphScope(scope: GraphIndexRunScope): AtlasBuildScope {
    if (scope.kind === 'note') return { mode: 'note', noteId: scope.noteIds[0] || scope.scopeId.replace(/^note:/, '') };
    if (scope.kind === 'multiNote') return { mode: 'multiNote', noteIds: scope.noteIds };
    if (scope.kind === 'folder') return { mode: 'folder', folderId: scope.scopeId.replace(/^folder:/, '') };
    if (scope.kind === 'narrative') return { mode: 'folder', folderId: scope.scopeId };
    return { mode: 'global' };
}

function capabilityLabel(id: AtlasCapabilityId): string {
    switch (id) {
        case 'semanticAtlas': return 'Semantic Atlas';
        case 'nliAdjudication': return 'NLI Adjudication';
        case 'relationGraph': return 'Relationship Rows';
        case 'temporalGraph': return 'Temporal Rows';
        case 'eventIdentity': return 'Event Identity Rows';
        case 'memoryState': return 'Memory/State Rows';
        case 'causalGraph': return 'Causal Rows';
        case 'hybridManifold': return 'Hybrid Projection';
        case 'hopfProjection': return 'Hopf Projection';
        case 'lorentzForest': return 'Lorentz Forest';
        case 'productManifold': return 'Product Manifold';
        default: return id;
    }
}

function numberCounts(value: unknown, prefix = ''): Record<string, number> {
    if (!value || typeof value !== 'object') return {};
    const counts: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const name = prefix ? `${prefix}.${key}` : key;
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            counts[name] = raw;
        } else if (Array.isArray(raw)) {
            counts[name] = raw.length;
        } else if (raw && typeof raw === 'object') {
            Object.assign(counts, numberCounts(raw, name));
        }
    }
    return counts;
}

function projectionTimingCounters(counters: Record<string, number>, durationMs: number): Record<string, number> {
    const totalLoadMs = counters['timings.totalMs'] || 0;
    return {
        wrapperMs: durationMs,
        nativeLoadMs: counters['timings.nativeSnapshotMs'] || 0,
        fallbackLoadMs: counters['timings.fallbackLoadMs'] || 0,
        runtimeLoadMs: counters['timings.runtimeLoadMs'] || 0,
        uiWrapperMs: totalLoadMs > 0 ? Math.max(0, durationMs - totalLoadMs) : 0,
        payloadNodes: counters['payload.nodes'] || counters['nodes'] || 0,
        payloadEdges: counters['payload.edges'] || counters['edges'] || 0,
        payloadCells: counters['payload.cells'] || counters['cells'] || 0,
        payloadAnchors: counters['payload.anchorProjections'] || counters['anchorProjections'] || 0,
        lorentzTrees: counters['payload.lorentzTrees'] || counters['lorentzTrees'] || 0,
        totalLoadMs,
    };
}

function elapsedTimingMs(started: number): number {
    return Math.max(0, Math.round(performance.now() - started));
}

function waitForUiFrame(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function sumOutputCounts(counts: Record<string, number>): number {
    return Object.entries(counts)
        .filter(([key, value]) => isOutputCountKey(key) && Number.isFinite(value) && value > 0)
        .reduce((sum, [, value]) => sum + value, 0);
}

function isOutputCountKey(key: string): boolean {
    return !/(started|completed|duration|elapsed|wall|timestamp|time)/i.test(key);
}

function relationshipHintsFromNliResult(rawResult: unknown): GraphRebuildRelationshipHint[] {
    const judgments = arrayField(rawResult, 'judgments');
    return judgments
        .map((row): GraphRebuildRelationshipHint | null => {
            if (!row || typeof row !== 'object') return null;
            const record = row as Record<string, unknown>;
            const sourceId = stringField(record, 'sourceId', 'source_id');
            const targetId = stringField(record, 'targetId', 'target_id');
            const predictedLabel = stringField(record, 'predictedLabel', 'predicted_label');
            if (!sourceId || !targetId || !predictedLabel) return null;
            const hint: GraphRebuildRelationshipHint = {
                sourceId,
                targetId,
                relationType: stringField(record, 'edgeType', 'edge_type') || undefined,
                status: nliStatus(predictedLabel),
                confidence: numberField(record, 'confidence'),
                source: 'nli:modernbert',
                evidence: [
                    `judgment:${stringField(record, 'judgmentId', 'judgment_id') || 'unknown'}`,
                    `label:${predictedLabel}`,
                ],
            };
            return hint;
        })
        .filter((row): row is GraphRebuildRelationshipHint => !!row);
}

function nliStatus(label: string): GraphRebuildRelationshipHint['status'] {
    const normalized = label.trim().toLowerCase();
    if (normalized === 'entailment' || normalized === 'entails' || normalized === 'support') return 'accepted';
    if (normalized === 'contradiction' || normalized === 'contradicts') return 'rejected';
    return 'review';
}

function arrayField(value: unknown, key: string): unknown[] {
    return value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>)[key])
        ? ((value as Record<string, unknown>)[key] as unknown[])
        : [];
}

function stringField(record: Record<string, unknown>, primary: string, fallback?: string): string {
    const value = record[primary] ?? (fallback ? record[fallback] : undefined);
    return typeof value === 'string' ? value : '';
}

function numberField(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function assertStageCompleted(receipt: GraphIndexStageReceipt): void {
    if (receipt.status !== 'completed') {
        throw new Error(receipt.message || `${receipt.label} failed.`);
    }
}

function skippedStage(
    id: string,
    label: string,
    startedAt: number,
    completedAt: number,
    message: string,
): GraphIndexStageReceipt {
    return {
        id,
        label,
        status: 'skipped',
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        outputCount: 0,
        counters: { cacheHit: 1 },
        message,
    };
}

function postProcessFingerprint(
    scope: GraphIndexRunScope,
    docs: ScopedDocument[],
    entities: Array<{ id: string; label: string; kind: string; aliases?: string[] }>,
    modelSelection: GraphIndexRunRequest['modelSelection'],
): string {
    const payload = JSON.stringify({
        scope: {
            kind: scope.kind,
            scopeId: scope.scopeId,
            noteIds: [...scope.noteIds].sort(),
        },
        docs: docs
            .map((doc) => ({
                id: doc.id,
                version: doc.version || 0,
                updatedAt: doc.updatedAt || 0,
                textHash: simpleHash(doc.plainText),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        entities: entities
            .map((entity) => ({
                id: entity.id,
                label: entity.label,
                kind: entity.kind,
                aliases: [...(entity.aliases || [])].sort(),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        modelSelection,
    });
    return simpleHash(payload);
}

function simpleHash(value: string): string {
    let out = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        out ^= value.charCodeAt(index);
        out = Math.imul(out, 16777619);
    }
    return (out >>> 0).toString(16).padStart(8, '0');
}

function emptyCounters(): GraphRebuildCounters {
    return {
        entities: 0,
        aliases: 0,
        candidates: 0,
        mentions: 0,
        acceptedAnchors: 0,
        chunks: 0,
        relationshipCandidates: 0,
        relationships: 0,
        acceptedRelationships: 0,
        reviewRelationships: 0,
        rejectedRelationships: 0,
        events: 0,
        episodes: 0,
        temporalEdges: 0,
        causalEdges: 0,
        memoryState: 0,
        embeddingTargets: 0,
        embeddingVectors: 0,
        projectionRefs: 0,
        nodes: 0,
        edges: 0,
        dropReasons: emptyDropReasons(),
    };
}

function emptyDropReasons(): GraphRebuildDropReasons {
    return {
        missingEntity: 0,
        invalidSpan: 0,
        duplicateAnchor: 0,
        singletonBucket: 0,
        missingChunk: 0,
    };
}
