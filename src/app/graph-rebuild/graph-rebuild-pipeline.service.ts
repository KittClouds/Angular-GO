import { Injectable, computed, inject, signal } from '@angular/core';

import { db, type Note } from '../lib/dexie/db';
import { smartGraphRegistry } from '../lib/registry';
import type { AtlasCapabilityId } from '../components/search-panel/atlas-capability.model';
import type { AtlasBuildScope, AtlasRunOptions } from '../services/atlas-capability-runtime.model';
import { AtlasCapabilityRuntimeService } from '../services/atlas-capability-runtime.service';
import { NerService } from '../services/ner.service';
import { GraphRebuildService } from './graph-rebuild.service';
import type {
    GraphIndexModelReadiness,
    GraphIndexProjectionMode,
    GraphIndexProjectionReceipt,
    GraphIndexRunReceipt,
    GraphIndexRunRequest,
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

    readonly running = computed(() => this.runningState());
    readonly lastReceipt = computed(() => this.lastReceiptState());

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
                    entities: smartGraphRegistry.getAllEntities().length
                        ? smartGraphRegistry.getAllEntities()
                        : request.entities,
                    relationshipHints,
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
                        nliHints: relationshipHints.length,
                    },
                    message: `${snapshot.counters.nodes} nodes / ${snapshot.counters.edges} edges`,
                };
            });
            stageReceipts.push(graphStage);
            assertStageCompleted(graphStage);

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
                    ? `Full Atlas Index built ${completedSnapshot.counters.nodes} nodes and ${completedSnapshot.counters.edges} edges.`
                    : 'Full Atlas Index completed without a graph snapshot.',
            };
            this.lastReceiptState.set(receipt);
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
            this.lastReceiptState.set(failedReceipt);
            throw error;
        } finally {
            this.runningState.set(false);
        }
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
                outputCount: sumCounts(counters),
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
            return {
                mode,
                status: 'synced',
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                targetCount: snapshot?.counters.embeddingTargets || counters['manifold.nodes'] || 0,
                vectorCount: snapshot?.counters.embeddingVectors || counters['manifold.nodes'] || 0,
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
    return scope.noteIds.length ? scope : { ...scope, noteIds: docs.map((doc) => doc.id) };
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

function sumCounts(counts: Record<string, number>): number {
    return Object.values(counts).reduce((sum, value) => sum + value, 0);
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
