import { Injectable, inject } from '@angular/core';

import { parseContentToPlainText } from '../lib/analytics';
import { db } from '../lib/dexie/db';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import type { EntitySuggestionScanRequest } from '../lib/entity-suggestions/entity-suggestion.types';
import {
    ATLAS_CAPABILITY_RECIPES,
    atlasCapabilityById,
    atlasRecipeDefinitionById,
    type AtlasCapabilityId,
    type AtlasCapabilityMutationPolicy,
    type AtlasModelLaneId,
    type AtlasRecipeId,
} from '../components/search-panel/atlas-capability.model';
import { BlueprintHubService } from '../components/blueprint-hub/blueprint-hub.service';
import {
    NliWorkerService,
    type NliClassificationResult,
    type NliPairClassificationInput,
} from '../lib/services/nli-worker.service';
import { AtlasScanCoordinatorService } from './atlas-scan-coordinator.service';
import { NerService } from './ner.service';
import { PhoenixBackendService } from './phoenix-backend.service';
import {
    PhoenixMachineControlService,
    type PhoenixMachineModelId,
} from './phoenix-machine-control.service';
import { PhoenixUiApiService, type SearchScope } from './phoenix-ui-api.service';
import type {
    AtlasCapabilityOperationKind,
    AtlasCapabilityRunPolicy,
    AtlasCapabilityRunResult,
    AtlasCapabilityRuntimeState,
    AtlasBuildScope,
    AtlasExpectedOutput,
    AtlasModelRequirement,
    AtlasOutputProbe,
    AtlasRecipeExecutionPlan,
    AtlasRecipeRunResult,
    AtlasRecipeRuntimeState,
    AtlasRunOptions,
    AtlasRuntimeModelRequirementId,
    AtlasRuntimeOperation,
    AtlasServiceRequirement,
} from './atlas-capability-runtime.model';
import type { AtlasManifoldMode } from './manifold-atlas.types';

const NLI_MODEL_ID = 'onnx-community/ModernBERT-base-nli-ONNX';

const TEXT_GRAPH_CAPABILITIES: AtlasCapabilityId[] = [
    'dynamicSurface',
    'dynamicChunking',
    'mentionGraph',
    'evidenceGraph',
    'surfaceGraph',
    'assertedKernel',
];

const SEMANTIC_SCAN_CAPABILITIES: AtlasCapabilityId[] = [
    'semanticAtlas',
    'semanticCandidate',
];

const NATIVE_STORE_PROBE_CAPABILITIES: AtlasCapabilityId[] = [
    'relationGraph',
    'temporalGraph',
    'eventIdentity',
    'memoryState',
];

const MANIFOLD_CAPABILITIES: Partial<Record<AtlasCapabilityId, AtlasManifoldMode>> = {
    hybridManifold: 'hybrid',
    hopfProjection: 'hopf',
    lorentzForest: 'lorentz',
};

const NOT_WIRED_REASONING_CAPABILITIES: AtlasCapabilityId[] = [
    'causalGraph',
];

type NativeStoreProbeConfig = {
    relation: string;
    filter?: Record<string, unknown>;
    label: string;
    rowLabel: string;
};

const NATIVE_STORE_PROBES: Partial<Record<AtlasCapabilityId, NativeStoreProbeConfig>> = {
    relationGraph: {
        relation: 'graph_candidate_edges',
        label: 'Relation graph candidate edge probe',
        rowLabel: 'candidate edge row',
    },
    temporalGraph: {
        relation: 'graph_edges',
        filter: { edge_type: 'active_during' },
        label: 'Temporal graph active-during edge probe',
        rowLabel: 'temporal edge row',
    },
    eventIdentity: {
        relation: 'semantic_node_prototypes',
        filter: { node_kind: 'event' },
        label: 'Event identity semantic prototype probe',
        rowLabel: 'event prototype row',
    },
    memoryState: {
        relation: 'memories',
        label: 'Memory/state store probe',
        rowLabel: 'memory row',
    },
};

const NLI_BATCH_SIZE = 4;

type RuntimeTarget = {
    requiredModels: AtlasModelRequirement[];
};

interface NerScopeDocument {
    id: string;
    title: string;
    content: string;
    folderId: string;
}

interface NerScopeScanRequest {
    request: EntitySuggestionScanRequest;
    documentCount: number;
}

interface AtlasRuntimeRecipeDefinition {
    requiredCapabilities: AtlasCapabilityId[];
    optionalCapabilities: AtlasCapabilityId[];
    skippedCapabilities: AtlasCapabilityId[];
    dependencyChain: AtlasCapabilityId[];
    requiredModels: AtlasModelRequirement[];
    optionalModels: AtlasModelRequirement[];
    operations: AtlasRuntimeOperation[];
    expectedOutputs: AtlasExpectedOutput[];
    mutationPolicy: AtlasCapabilityMutationPolicy;
    runPolicy: AtlasCapabilityRunPolicy;
    backendRoute: string;
    runnable: boolean;
    skippedLanes: AtlasModelLaneId[];
    blockedReason?: string;
}

@Injectable({ providedIn: 'root' })
export class AtlasCapabilityRuntimeService {
    private readonly machine = inject(PhoenixMachineControlService);
    private readonly ner = inject(NerService);
    private readonly atlasScan = inject(AtlasScanCoordinatorService);
    private readonly nli = inject(NliWorkerService);
    private readonly hub = inject(BlueprintHubService);
    private readonly noteStore = inject(NoteEditorStore);
    private readonly phoenixUiApi = inject(PhoenixUiApiService);
    private readonly phoenix = inject(PhoenixBackendService);

    capabilityState(id: AtlasCapabilityId, options: AtlasRunOptions = {}): AtlasCapabilityRuntimeState {
        const binding = this.capabilityBinding(id, options);
        const status = binding.blockedReason
            ? 'blocked'
            : binding.readinessProbe.status;
        return {
            ...binding,
            status,
            statusLabel: statusLabel(status),
        };
    }

    capabilityBinding(id: AtlasCapabilityId, options: AtlasRunOptions = {}): AtlasCapabilityRuntimeState {
        const capability = atlasCapabilityById(id);
        const operationKind = this.operationKindForCapability(id);
        const blockedReason = this.blockedReasonForCapability(id);
        const runnable = !blockedReason && operationKind !== 'notWired';
        const requiredModels = this.requiredModelsForCapability(id, options);
        const requiredServices = this.requiredServicesForCapability(id, options);
        const mutationPolicy = this.mutationPolicyForCapability(id, capability.mutationPolicy);
        const runPolicy = this.runPolicyForCapability(id);
        const readinessProbe = this.readinessProbeForCapability(id, operationKind, blockedReason);
        const outputProbe = this.outputProbeForCapability(id, operationKind);
        const status = blockedReason ? 'blocked' : readinessProbe.status;

        return {
            capabilityId: id,
            runnable,
            operationKind,
            requiredModels,
            requiredServices,
            mutationPolicy,
            runPolicy,
            readinessProbe,
            outputProbe,
            blockedReason,
            status,
            statusLabel: statusLabel(status),
        };
    }

    recipeState(id: AtlasRecipeId, options: AtlasRunOptions = {}): AtlasRecipeRuntimeState {
        const plan = this.recipePlan(id, options);
        const hasError = plan.requiredModels.some((model) => model.readiness === 'error');
        const modelsReady = plan.requiredModels.every((model) => model.readiness === 'ready');
        const status = !plan.runnable
            ? 'blocked'
            : hasError
                ? 'error'
                : modelsReady || !plan.requiredModels.length
                    ? 'ready'
                    : 'idle';
        return {
            ...plan,
            status,
            statusLabel: statusLabel(status),
        };
    }

    recipePlan(id: AtlasRecipeId, options: AtlasRunOptions = {}): AtlasRecipeExecutionPlan {
        const recipe = atlasRecipeDefinitionById(id);
        const runtime = this.runtimeRecipeDefinition(id, options);
        const requiredServices = uniqueServices(runtime.requiredCapabilities
            .flatMap((capabilityId) => this.capabilityBinding(capabilityId, options).requiredServices));

        return {
            id,
            label: recipe.label,
            description: recipe.description,
            actionLabel: recipe.actionLabel,
            requiredCapabilities: runtime.requiredCapabilities,
            optionalCapabilities: runtime.optionalCapabilities,
            skippedCapabilities: runtime.skippedCapabilities,
            dependencyChain: runtime.dependencyChain,
            requiredModels: runtime.requiredModels,
            optionalModels: runtime.optionalModels,
            requiredServices,
            operations: runtime.operations,
            skips: runtime.skippedCapabilities,
            expectedOutputs: runtime.expectedOutputs,
            outputLabel: recipe.outputLabel,
            mutationPolicy: runtime.mutationPolicy,
            runPolicy: runtime.runPolicy,
            cost: recipe.cost,
            backendRoute: runtime.backendRoute,
            runnable: runtime.runnable,
            blockedReason: runtime.blockedReason,
            requiredLanes: runtime.requiredModels.map((model) => model.laneId),
            optionalLanes: runtime.optionalModels.map((model) => model.laneId),
            skippedLanes: runtime.skippedLanes,
        };
    }

    async warmRequiredModels(target: RuntimeTarget, options: AtlasRunOptions = {}): Promise<void> {
        for (const model of target.requiredModels) {
            await this.warmModel(model.id, options);
        }
    }

    async warmModelLane(laneId: AtlasModelLaneId, options: AtlasRunOptions = {}): Promise<void> {
        switch (laneId) {
            case 'dynamicNer':
                await this.warmModel('dynamicNer', options);
                return;
            case 'semanticEmbedding':
                await this.warmModel('semanticEmbedding', options);
                return;
            case 'nli':
                await this.warmModel('nli', options);
                return;
            case 'coOccurrence':
                await this.ner.warmProvider('fst');
                return;
            case 'manifoldProjection':
                return;
        }
    }

    async runCapability(id: AtlasCapabilityId, options: AtlasRunOptions = {}): Promise<AtlasCapabilityRunResult> {
        const binding = this.capabilityBinding(id, options);
        if (!binding.runnable) {
            throw new Error(binding.blockedReason || `${atlasCapabilityById(id).label} is not wired.`);
        }
        if (!options.skipModelWarm) {
            await this.warmRequiredModels(binding, options);
        }
        const rawResult = await this.executeCapabilityOperation(id, binding.operationKind, binding.runPolicy, options);
        return {
            capabilityId: id,
            operationKind: binding.operationKind,
            mutationPolicy: binding.mutationPolicy,
            runPolicy: binding.runPolicy,
            outputProof: [this.outputProbeForCapability(id, binding.operationKind)],
            rawResult,
        };
    }

    async runRecipe(id: AtlasRecipeId, options: AtlasRunOptions = {}): Promise<AtlasRecipeRunResult> {
        const plan = this.recipePlan(id, options);
        if (!plan.runnable) {
            throw new Error(plan.blockedReason || `${plan.label} is not wired.`);
        }
        const warmedBeforeRun = !options.skipModelWarm;
        if (!options.skipModelWarm) {
            await this.warmRequiredModels(plan, options);
        }

        const operationResults: AtlasCapabilityRunResult[] = [];
        for (const operation of plan.operations) {
            if (operation.kind === 'warmModel' && (options.skipModelWarm || warmedBeforeRun)) continue;
            const result = await this.executeRecipeOperation(operation, plan, options);
            if (result) operationResults.push(result);
        }

        if (id === 'warmFullIndexStack') {
            this.machine.setNotice(`${this.embeddingModelLabel(options)}, BI small Dynamic NER, and NLI are warm. No graph data was mutated.`);
        }

        return {
            recipeId: id,
            label: plan.label,
            mutationPolicy: plan.mutationPolicy,
            runPolicy: plan.runPolicy,
            outputProof: this.recipeOutputProof(id),
            operationResults,
        };
    }

    modelRequirementLabel(models: AtlasModelRequirement[]): string {
        return models.length
            ? models.map((model) => model.dims ? `${model.label} ${model.dims}` : model.label).join(' / ')
            : 'none';
    }

    serviceRequirementLabel(services: AtlasServiceRequirement[]): string {
        return services.length ? services.map((service) => service.service).join(' / ') : 'none';
    }

    expectedOutputLabel(outputs: AtlasExpectedOutput[]): string {
        return outputs.length ? outputs.map((output) => output.label).join(' / ') : 'none';
    }

    private async executeRecipeOperation(
        operation: AtlasRuntimeOperation,
        plan: AtlasRecipeExecutionPlan,
        options: AtlasRunOptions,
    ): Promise<AtlasCapabilityRunResult | null> {
        switch (operation.kind) {
            case 'warmModel':
            case 'modelWarm':
                if (!operation.model) return null;
                await this.warmModel(operation.model!, options);
                return null;
            case 'dynamicNerScan': {
                const rawResult = await this.runDynamicNerScan(options);
                return this.recipeOperationResult(plan, 'dynamicNer', operation.kind, rawResult);
            }
            case 'richTextGraphScan': {
                const rawResult = await this.runTextGraphScan(operation.policy === 'force' ? 'force' : 'dirty-only', options);
                return this.recipeOperationResult(plan, 'assertedKernel', operation.kind, rawResult);
            }
            case 'semanticAtlasScan': {
                const rawResult = await this.runSemanticAtlasScan(options, operation.policy === 'force' ? 'force' : 'dirty-only');
                return this.recipeOperationResult(plan, 'semanticAtlas', operation.kind, rawResult);
            }
            case 'nativeStoreProbe': {
                const capabilityId = operation.args?.['capabilityId'] as AtlasCapabilityId | undefined;
                if (!capabilityId) return null;
                const rawResult = await this.runNativeStoreProbe(capabilityId);
                return this.recipeOperationResult(plan, capabilityId, operation.kind, rawResult);
            }
            case 'nliAdjudication': {
                const rawResult = await this.runNliAdjudication(options);
                return this.recipeOperationResult(plan, 'nliAdjudication', operation.kind, rawResult);
            }
            case 'graphVisualization': {
                const rawResult = this.openGraphVisualization(options);
                return this.recipeOperationResult(plan, 'galaxyVisualization', operation.kind, rawResult);
            }
            case 'manifoldSnapshot': {
                const rawResult = await this.runManifoldSnapshot(operation.manifold || 'hybrid', options);
                return this.recipeOperationResult(plan, 'hybridManifold', operation.kind, rawResult);
            }
            case 'retrievalWalk': {
                const rawResult = await this.runRetrievalWalk(options);
                return this.recipeOperationResult(plan, 'retrievalWalk', operation.kind, rawResult);
            }
            case 'nativeReasoningPass':
            case 'notWired':
                throw new Error(plan.blockedReason || `${plan.label} has no runtime binding.`);
        }
    }

    private recipeOperationResult(
        plan: AtlasRecipeExecutionPlan,
        capabilityId: AtlasCapabilityId,
        operationKind: AtlasCapabilityOperationKind,
        rawResult: unknown,
    ): AtlasCapabilityRunResult {
        return {
            capabilityId,
            operationKind,
            mutationPolicy: plan.mutationPolicy,
            runPolicy: plan.runPolicy,
            outputProof: this.recipeOutputProof(plan.id),
            rawResult,
        };
    }

    private async executeCapabilityOperation(
        id: AtlasCapabilityId,
        operationKind: AtlasCapabilityOperationKind,
        runPolicy: AtlasCapabilityRunPolicy,
        options: AtlasRunOptions,
    ): Promise<unknown> {
        switch (operationKind) {
            case 'modelWarm':
                if (id === 'semanticEmbedding') return this.warmModel('semanticEmbedding', options);
                return null;
            case 'dynamicNerScan':
                return this.runDynamicNerScan(options);
            case 'richTextGraphScan':
                return this.runTextGraphScan(runPolicy === 'force' ? 'force' : 'dirty-only', options);
            case 'semanticAtlasScan':
                return this.runSemanticAtlasScan(options, runPolicy === 'force' ? 'force' : 'dirty-only');
            case 'nativeStoreProbe':
                return this.runNativeStoreProbe(id);
            case 'nliAdjudication':
                return this.runNliAdjudication(options);
            case 'manifoldSnapshot':
                return this.runManifoldSnapshot(MANIFOLD_CAPABILITIES[id] || 'hybrid', options);
            case 'graphVisualization':
                return this.openGraphVisualization(options);
            case 'retrievalWalk':
                return this.runRetrievalWalk(options);
            case 'nativeReasoningPass':
            case 'notWired':
                throw new Error(this.blockedReasonForCapability(id) || `${atlasCapabilityById(id).label} has no runtime binding.`);
        }
    }

    private async warmModel(modelId: AtlasRuntimeModelRequirementId, options: AtlasRunOptions): Promise<void> {
        switch (modelId) {
            case 'dynamicNer':
                await this.ner.warmProvider('dynamic_ner');
                return;
            case 'semanticEmbedding':
                if (this.machine.vectorStatus() === 'ready') return;
                await this.machine.loadSemanticModel(
                    this.embeddingModelId(options),
                    this.embeddingModelLabel(options),
                    this.embeddingDimensionLabel(options),
                );
                return;
            case 'nli':
                if (this.nli.isInitialized()) return;
                await this.nli.initialize(NLI_MODEL_ID);
                return;
        }
    }

    private async runDynamicNerScan(options: AtlasRunOptions): Promise<{ suggestions: number; documents: number }> {
        const scopeScan = await this.buildScopedNerScanRequest(options);
        if (!scopeScan) {
            throw new Error('Choose an Atlas scope with rendered note text before running Dynamic NER.');
        }
        await this.ner.runDynamicScan(scopeScan.request);
        const suggestions = this.ner.suggestions().length;
        const documentLabel = scopeScan.documentCount === 1 ? '1 document' : `${scopeScan.documentCount} documents`;
        this.machine.setNotice(`Dynamic NER scan complete for ${documentLabel}. ${suggestions} candidate${suggestions === 1 ? '' : 's'} available for review.`);
        return { suggestions, documents: scopeScan.documentCount };
    }

    private runTextGraphScan(policy: 'dirty-only' | 'force', options: AtlasRunOptions): Promise<unknown> {
        return this.atlasScan.runRichEmbeddingScan({
            source: 'search-panel',
            requireActiveNote: false,
            policy,
            includeSemanticAtlas: false,
            ...this.scanScopeOptions(options),
        });
    }

    private runSemanticAtlasScan(options: AtlasRunOptions, policy: 'dirty-only' | 'force' = 'dirty-only'): Promise<unknown> {
        return this.atlasScan.runRichEmbeddingScan({
            source: 'search-panel',
            requireActiveNote: false,
            modelId: this.embeddingModelId(options),
            modelLabel: this.embeddingModelLabel(options),
            dimensionLabel: this.embeddingDimensionLabel(options),
            policy,
            includeSemanticAtlas: true,
            ...this.scanScopeOptions(options),
        });
    }

    private async runManifoldSnapshot(manifold: AtlasManifoldMode, options: AtlasRunOptions): Promise<unknown> {
        return this.phoenixUiApi.loadManifoldAtlasSnapshot(manifold, this.searchScope(options));
    }

    private async runRetrievalWalk(options: AtlasRunOptions): Promise<unknown> {
        const query = (options.query || '').trim();
        if (!query) {
            this.machine.setNotice('Retrieval Walk is read-only and ready. Enter a query to execute ranked retrieval.');
            return [];
        }
        return this.machine.search(query, 60, this.searchScope(options));
    }

    private async runNativeStoreProbe(id: AtlasCapabilityId): Promise<unknown> {
        const config = NATIVE_STORE_PROBES[id];
        if (!config) {
            throw new Error(`${atlasCapabilityById(id).label} does not have a registered read-only store probe.`);
        }
        const payload = config.filter
            ? { relation: config.relation, filter: config.filter }
            : { relation: config.relation };
        const rows = await this.phoenix.storeCommand(config.relation === 'runtime:capabilities' ? 'runtime:capabilities' : 'relation:list', payload);
        const rowList = Array.isArray(rows) ? rows : [];
        this.machine.setNotice(`${atlasCapabilityById(id).label} probe returned ${rowList.length} ${config.rowLabel}${rowList.length === 1 ? '' : 's'}. No graph data was mutated.`);
        return {
            capabilityId: id,
            command: 'relation:list',
            relation: config.relation,
            filter: config.filter || null,
            count: rowList.length,
            sample: rowList.slice(0, 5),
        };
    }

    private async runNliAdjudication(options: AtlasRunOptions): Promise<unknown> {
        const documentIds = Array.from(new Set((options.noteIds || noteIdsFromBuildScope(options.buildScope)).filter(Boolean)));
        const inputsPayload = await this.phoenix.storeCommand('semantic:listNliJudgmentInputs', {
            documentIds,
        });
        const inputs = normalizeNliInputs(inputsPayload);
        if (!inputs.length) {
            this.machine.setNotice('NLI adjudication queue is empty for the current scope. No graph data was mutated.');
            return { inputCount: 0, applied: null };
        }

        await this.warmModel('nli', options);
        const results: NliClassificationResult[] = [];
        await this.nli.classifyStream(
            inputs,
            (batch) => results.push(...batch.results),
            NLI_BATCH_SIZE,
        );
        const applied = await this.phoenix.storeCommand('semantic:applyNliJudgments', {
            modelId: NLI_MODEL_ID,
            device: this.nli.device(),
            results,
        });
        this.machine.setNotice(`NLI adjudication classified ${results.length} pair${results.length === 1 ? '' : 's'} and applied native candidate-edge judgments.`);
        return {
            inputCount: inputs.length,
            resultCount: results.length,
            applied,
        };
    }

    private openGraphVisualization(options: AtlasRunOptions): { opened: true } {
        this.machine.requestGraphFocus({
            query: (options.query || '').trim(),
            scope: options.scope || this.machine.scope(),
        });
        this.hub.openPage('graph');
        this.machine.setNotice('Loaded current graph snapshot for visualization. No backend mutation was run.');
        return { opened: true };
    }

    private async buildScopedNerScanRequest(options: AtlasRunOptions): Promise<NerScopeScanRequest | null> {
        const documents = await this.loadScopedNerDocuments(options);
        const textDocuments = documents
            .map((document) => ({
                ...document,
                plainText: parseContentToPlainText(document.content).trim(),
            }))
            .filter((document) => document.plainText.length > 0);

        if (!textDocuments.length) return null;
        if (textDocuments.length === 1) {
            const document = textDocuments[0];
            return {
                documentCount: 1,
                request: {
                    noteId: document.id,
                    noteTitle: document.title,
                    plainText: document.plainText,
                },
            };
        }

        return {
            documentCount: textDocuments.length,
            request: {
                noteId: this.nerScopeRequestId(options),
                noteTitle: this.nerScopeTitle(options, textDocuments.length),
                plainText: textDocuments.map((document) => document.plainText).join('\n\n'),
            },
        };
    }

    private async loadScopedNerDocuments(options: AtlasRunOptions): Promise<NerScopeDocument[]> {
        const active = this.activeNerDocument();
        const explicitNoteIds = uniqueIds(options.noteIds?.length
            ? options.noteIds
            : noteIdsFromBuildScope(options.buildScope));

        if (explicitNoteIds.length) return this.loadNerDocumentsByIds(explicitNoteIds, active);
        if (options.buildScope?.mode === 'note' || options.buildScope?.mode === 'multiNote') return [];
        if (options.buildScope?.mode === 'folder') return this.loadNerDocumentsByFolder(options.buildScope.folderId, active);
        if (options.buildScope?.mode === 'global') return this.loadAllNerDocuments(active);

        const scope = options.scope || this.machine.scope();
        if (scope && scope !== 'global') return this.loadNerDocumentsByFolder(scope, active);
        return active ? [active] : [];
    }

    private async loadNerDocumentsByIds(ids: string[], active: NerScopeDocument | null): Promise<NerScopeDocument[]> {
        const activeId = active?.id || '';
        const missingIds = ids.filter((id) => id !== activeId);
        const rows = missingIds.length ? await db.notes.bulkGet(missingIds) : [];
        const byId = new Map<string, NerScopeDocument>();

        for (const row of rows) {
            const document = this.toNerDocument(row);
            if (document) byId.set(document.id, document);
        }
        if (active) byId.set(active.id, active);

        return ids.map((id) => byId.get(id)).filter(isNerScopeDocument);
    }

    private async loadNerDocumentsByFolder(folderId: string, active: NerScopeDocument | null): Promise<NerScopeDocument[]> {
        if (!folderId) return [];
        const rows = await db.notes.where('folderId').equals(folderId).toArray();
        return this.overlayActiveNerDocument(rows.map((row) => this.toNerDocument(row)).filter(isNerScopeDocument), active, active?.folderId === folderId);
    }

    private async loadAllNerDocuments(active: NerScopeDocument | null): Promise<NerScopeDocument[]> {
        const rows = await db.notes.toArray();
        return this.overlayActiveNerDocument(rows.map((row) => this.toNerDocument(row)).filter(isNerScopeDocument), active, !!active);
    }

    private overlayActiveNerDocument(
        documents: NerScopeDocument[],
        active: NerScopeDocument | null,
        includeActive: boolean,
    ): NerScopeDocument[] {
        if (!active || !includeActive) return documents;
        const byId = new Map(documents.map((document) => [document.id, document]));
        byId.set(active.id, active);
        return Array.from(byId.values());
    }

    private activeNerDocument(): NerScopeDocument | null {
        return this.toNerDocument(this.noteStore.currentNote());
    }

    private toNerDocument(note: {
        id?: string;
        title?: string;
        content?: string;
        markdownContent?: string;
        folderId?: string;
    } | null | undefined): NerScopeDocument | null {
        const id = String(note?.id || '').trim();
        if (!id) return null;
        return {
            id,
            title: String(note?.title || 'Untitled Note'),
            content: String(note?.content || note?.markdownContent || ''),
            folderId: String(note?.folderId || ''),
        };
    }

    private nerScopeRequestId(options: AtlasRunOptions): string {
        const scope = options.buildScope;
        if (scope?.mode === 'folder') return `scope:folder:${scope.folderId}`;
        if (scope?.mode === 'global') return 'scope:global';
        return 'scope:multiNote';
    }

    private nerScopeTitle(options: AtlasRunOptions, documentCount: number): string {
        const scope = options.buildScope;
        if (scope?.mode === 'folder') return `Folder scope (${documentCount} notes)`;
        if (scope?.mode === 'global') return `Global scope (${documentCount} notes)`;
        return `${documentCount} selected notes`;
    }

    private runtimeRecipeDefinition(id: AtlasRecipeId, options: AtlasRunOptions): AtlasRuntimeRecipeDefinition {
        const dynamicNer = this.dynamicNerRequirement(true);
        const dynamicNerOptional = this.dynamicNerRequirement(false);
        const semantic = this.semanticEmbeddingRequirement(options, true);
        const nli = this.nliRequirement(true);
        const buildPolicy = options.buildPolicy === 'force' ? 'force' : 'dirty-only';
        const buildMutationPolicy = buildPolicy === 'force' ? 'force rebuild' : 'dirty-only';
        const addOnOperations = this.graphBuildAddOnOperations(options);
        const addOnCapabilities = this.graphBuildAddOnCapabilities(options);

        switch (id) {
            case 'textGraph':
                return {
                    requiredCapabilities: TEXT_GRAPH_CAPABILITIES,
                    optionalCapabilities: ['dynamicNer', 'hybridManifold', 'galaxyVisualization'] as AtlasCapabilityId[],
                    skippedCapabilities: ['semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication', ...NOT_WIRED_REASONING_CAPABILITIES] as AtlasCapabilityId[],
                    dependencyChain: [...TEXT_GRAPH_CAPABILITIES, ...addOnCapabilities] as AtlasCapabilityId[],
                    requiredModels: [],
                    optionalModels: [dynamicNerOptional],
                    operations: [
                        { kind: 'richTextGraphScan', service: 'AtlasScanCoordinatorService.runRichEmbeddingScan', policy: buildPolicy },
                        ...addOnOperations,
                    ] as AtlasRuntimeOperation[],
                    expectedOutputs: [
                        expected('graphDeltaCounts', 'graph delta counts', 'AtlasRichScanResult.graphDeltaCounts'),
                        expected('graphAudit.graphNodes', 'graph nodes', 'PhoenixMachineControlService.graphAudit'),
                        expected('graphAudit.graphEdges', 'graph edges', 'PhoenixMachineControlService.graphAudit'),
                    ],
                    mutationPolicy: buildMutationPolicy as AtlasCapabilityMutationPolicy,
                    runPolicy: buildPolicy as AtlasCapabilityRunPolicy,
                    backendRoute: `AtlasScanCoordinatorService.runRichEmbeddingScan(includeSemanticAtlas=false, policy=${buildPolicy})`,
                    runnable: true,
                    skippedLanes: ['semanticEmbedding', 'nli'] as AtlasModelLaneId[],
                };
            case 'semanticGraph':
                return {
                    requiredCapabilities: [...TEXT_GRAPH_CAPABILITIES, 'semanticEmbedding', 'semanticAtlas'] as AtlasCapabilityId[],
                    optionalCapabilities: ['dynamicNer', 'semanticCandidate', 'hybridManifold', 'galaxyVisualization'] as AtlasCapabilityId[],
                    skippedCapabilities: ['nliAdjudication', ...NOT_WIRED_REASONING_CAPABILITIES] as AtlasCapabilityId[],
                    dependencyChain: [...TEXT_GRAPH_CAPABILITIES, 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate', ...addOnCapabilities] as AtlasCapabilityId[],
                    requiredModels: [semantic],
                    optionalModels: [dynamicNerOptional],
                    operations: [
                        warmOperation('semanticEmbedding'),
                        { kind: 'semanticAtlasScan', service: 'AtlasScanCoordinatorService.runRichEmbeddingScan', policy: buildPolicy },
                        ...addOnOperations,
                    ] as AtlasRuntimeOperation[],
                    expectedOutputs: [
                        expected('embeddingCounts', 'leaf/entity/lens vectors', 'AtlasRichScanResult.embeddingCounts'),
                        expected('graphDeltaCounts', 'semantic graph deltas', 'AtlasRichScanResult.graphDeltaCounts'),
                        expected('relationCandidateCount', 'relation candidates', 'AtlasRichScanResult.relationCandidateCount'),
                    ],
                    mutationPolicy: buildMutationPolicy as AtlasCapabilityMutationPolicy,
                    runPolicy: buildPolicy as AtlasCapabilityRunPolicy,
                    backendRoute: `PhoenixMachineControlService.loadSemanticModel -> AtlasScanCoordinatorService.runRichEmbeddingScan(includeSemanticAtlas=true, policy=${buildPolicy})`,
                    runnable: true,
                    skippedLanes: ['nli'] as AtlasModelLaneId[],
                };
            case 'adjudicatedSemanticGraph':
                return {
                    requiredCapabilities: [...TEXT_GRAPH_CAPABILITIES, 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication'] as AtlasCapabilityId[],
                    optionalCapabilities: ['dynamicNer', 'hybridManifold', 'galaxyVisualization'] as AtlasCapabilityId[],
                    skippedCapabilities: NOT_WIRED_REASONING_CAPABILITIES,
                    dependencyChain: [...TEXT_GRAPH_CAPABILITIES, 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication', ...addOnCapabilities] as AtlasCapabilityId[],
                    requiredModels: [semantic, nli],
                    optionalModels: [dynamicNerOptional],
                    operations: [
                        warmOperation('semanticEmbedding'),
                        { kind: 'semanticAtlasScan', service: 'AtlasScanCoordinatorService.runRichEmbeddingScan', policy: buildPolicy },
                        warmOperation('nli'),
                        { kind: 'nliAdjudication', service: 'PhoenixBackendService.storeCommand + NliWorkerService.classifyStream', policy: 'native-only' },
                        ...addOnOperations,
                    ] as AtlasRuntimeOperation[],
                    expectedOutputs: [
                        expected('embeddingCounts', 'leaf/entity/lens vectors', 'AtlasRichScanResult.embeddingCounts'),
                        expected('relationCandidateCount', 'candidate relations', 'AtlasRichScanResult.relationCandidateCount'),
                        expected('nliJudgments', 'NLI candidate-edge judgments', 'semantic:applyNliJudgments'),
                    ],
                    mutationPolicy: buildMutationPolicy as AtlasCapabilityMutationPolicy,
                    runPolicy: buildPolicy as AtlasCapabilityRunPolicy,
                    backendRoute: `Semantic graph -> semantic:listNliJudgmentInputs -> semantic:applyNliJudgments`,
                    runnable: true,
                    skippedLanes: [] as AtlasModelLaneId[],
                };
            case 'runNer':
                return {
                    requiredCapabilities: ['dynamicNer'] as AtlasCapabilityId[],
                    optionalCapabilities: ['mentionGraph'] as AtlasCapabilityId[],
                    skippedCapabilities: this.allExcept(['dynamicNer', 'mentionGraph']),
                    dependencyChain: ['dynamicSurface', 'dynamicNer'] as AtlasCapabilityId[],
                    requiredModels: [dynamicNer],
                    optionalModels: [],
                    operations: [
                        warmOperation('dynamicNer'),
                        { kind: 'dynamicNerScan', service: 'NerService.runDynamicScan', policy: 'read-only' },
                    ] as AtlasRuntimeOperation[],
                    expectedOutputs: [expected('candidateSuggestions', 'candidate suggestions', 'NerService.suggestions()')],
                    mutationPolicy: 'read-only' as AtlasCapabilityMutationPolicy,
                    runPolicy: 'read-only' as AtlasCapabilityRunPolicy,
                    backendRoute: 'NerService.runDynamicScan / PhoenixUiApi.scanDiscovery / scan_json',
                    runnable: true,
                    skippedLanes: ['semanticEmbedding', 'nli', 'manifoldProjection'] as AtlasModelLaneId[],
                };
            case 'fastTextGraph':
                return textGraphRecipe('dirty-only', [dynamicNerOptional]);
            case 'fullTextGraph':
                return textGraphRecipe('force', [dynamicNerOptional]);
            case 'semanticAtlas':
                return {
                    requiredCapabilities: [...TEXT_GRAPH_CAPABILITIES, 'semanticEmbedding', 'semanticAtlas'] as AtlasCapabilityId[],
                    optionalCapabilities: ['dynamicNer', 'semanticCandidate', 'hybridManifold', 'hopfProjection', 'lorentzForest'] as AtlasCapabilityId[],
                    skippedCapabilities: ['nliAdjudication', ...NOT_WIRED_REASONING_CAPABILITIES] as AtlasCapabilityId[],
                    dependencyChain: [...TEXT_GRAPH_CAPABILITIES, 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate'] as AtlasCapabilityId[],
                    requiredModels: [semantic],
                    optionalModels: [dynamicNerOptional],
                    operations: [
                        warmOperation('semanticEmbedding'),
                        { kind: 'semanticAtlasScan', service: 'AtlasScanCoordinatorService.runRichEmbeddingScan', policy: 'dirty-only' },
                    ] as AtlasRuntimeOperation[],
                    expectedOutputs: [
                        expected('embeddingCounts', 'leaf/entity/lens vectors', 'AtlasRichScanResult.embeddingCounts'),
                        expected('graphDeltaCounts', 'semantic graph deltas', 'AtlasRichScanResult.graphDeltaCounts'),
                        expected('relationCandidateCount', 'relation candidates', 'AtlasRichScanResult.relationCandidateCount'),
                    ],
                    mutationPolicy: 'dirty-only' as AtlasCapabilityMutationPolicy,
                    runPolicy: 'dirty-only' as AtlasCapabilityRunPolicy,
                    backendRoute: 'PhoenixMachineControlService.loadSemanticModel -> AtlasScanCoordinatorService.runRichEmbeddingScan(includeSemanticAtlas=true, policy=dirty-only)',
                    runnable: true,
                    skippedLanes: ['nli'] as AtlasModelLaneId[],
                };
            case 'warmFullIndexStack':
                return {
                    requiredCapabilities: ['dynamicNer', 'semanticEmbedding', 'nliAdjudication'] as AtlasCapabilityId[],
                    optionalCapabilities: ['mentionGraph'] as AtlasCapabilityId[],
                    skippedCapabilities: ['evidenceGraph', 'surfaceGraph', 'assertedKernel', ...NOT_WIRED_REASONING_CAPABILITIES, 'semanticAtlas', 'semanticCandidate', 'retrievalWalk', 'galaxyVisualization'] as AtlasCapabilityId[],
                    dependencyChain: ['dynamicNer', 'semanticEmbedding', 'nliAdjudication'] as AtlasCapabilityId[],
                    requiredModels: [dynamicNer, semantic, nli],
                    optionalModels: [],
                    operations: [
                        warmOperation('dynamicNer'),
                        warmOperation('semanticEmbedding'),
                        warmOperation('nli'),
                    ] as AtlasRuntimeOperation[],
                    expectedOutputs: [expected('modelReadiness', 'ready model sidecars', 'NerService + native semantic runner + NliWorkerService')],
                    mutationPolicy: 'model warm' as AtlasCapabilityMutationPolicy,
                    runPolicy: 'warm-only' as AtlasCapabilityRunPolicy,
                    backendRoute: 'NerService.warmProvider + PhoenixMachineControlService.loadSemanticModel + NliWorkerService.initialize',
                    runnable: true,
                    skippedLanes: ['manifoldProjection'] as AtlasModelLaneId[],
                };
            case 'visualizeCurrentGraph':
                return {
                    requiredCapabilities: [] as AtlasCapabilityId[],
                    optionalCapabilities: ['hybridManifold', 'hopfProjection', 'lorentzForest', 'retrievalWalk', 'galaxyVisualization'] as AtlasCapabilityId[],
                    skippedCapabilities: ['dynamicNer', 'mentionGraph', 'evidenceGraph', 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication', ...NOT_WIRED_REASONING_CAPABILITIES] as AtlasCapabilityId[],
                    dependencyChain: ['assertedKernel', 'galaxyVisualization'] as AtlasCapabilityId[],
                    requiredModels: [] as AtlasModelRequirement[],
                    optionalModels: [] as AtlasModelRequirement[],
                    operations: [
                        { kind: 'graphVisualization', service: 'PhoenixMachineControlService.requestGraphFocus + BlueprintHubService.openPage', policy: 'read-only' },
                    ] as AtlasRuntimeOperation[],
                    expectedOutputs: [expected('graphFocus', 'current graph snapshot view', 'Blueprint graph tab')],
                    mutationPolicy: 'read-only' as AtlasCapabilityMutationPolicy,
                    runPolicy: 'read-only' as AtlasCapabilityRunPolicy,
                    backendRoute: 'PhoenixMachineControlService.requestGraphFocus + BlueprintHubService.openPage(graph)',
                    runnable: true,
                    skippedLanes: ['dynamicNer', 'coOccurrence', 'semanticEmbedding', 'nli'] as AtlasModelLaneId[],
                };
        }

        function textGraphRecipe(policy: 'dirty-only' | 'force', optionalModels: AtlasModelRequirement[]) {
            return {
                requiredCapabilities: TEXT_GRAPH_CAPABILITIES,
                optionalCapabilities: ['dynamicNer'] as AtlasCapabilityId[],
                skippedCapabilities: ['semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication', ...NOT_WIRED_REASONING_CAPABILITIES, 'hybridManifold', 'hopfProjection', 'lorentzForest'] as AtlasCapabilityId[],
                dependencyChain: TEXT_GRAPH_CAPABILITIES,
                requiredModels: [] as AtlasModelRequirement[],
                optionalModels,
                operations: [
                    { kind: 'richTextGraphScan', service: 'AtlasScanCoordinatorService.runRichEmbeddingScan', policy },
                ] as AtlasRuntimeOperation[],
                expectedOutputs: [
                    expected('stageSummaries.surface', 'surface stage summary', 'AtlasRichScanResult.stageSummaries'),
                    expected('graphDeltaCounts', 'graph delta counts', 'AtlasRichScanResult.graphDeltaCounts'),
                    expected('graphAudit.graphNodes', 'graph audit nodes', 'PhoenixMachineControlService.graphAudit'),
                    expected('graphAudit.graphEdges', 'graph audit edges', 'PhoenixMachineControlService.graphAudit'),
                ],
                mutationPolicy: (policy === 'force' ? 'force rebuild' : 'dirty-only') as AtlasCapabilityMutationPolicy,
                runPolicy: policy as AtlasCapabilityRunPolicy,
                backendRoute: `AtlasScanCoordinatorService.runRichEmbeddingScan(includeSemanticAtlas=false, policy=${policy}) / atlas_rich_scan_json`,
                runnable: true,
                skippedLanes: ['semanticEmbedding', 'nli', 'manifoldProjection'] as AtlasModelLaneId[],
            };
        }
    }

    private operationKindForCapability(id: AtlasCapabilityId): AtlasCapabilityOperationKind {
        if (id === 'dynamicNer') return 'dynamicNerScan';
        if (TEXT_GRAPH_CAPABILITIES.includes(id)) return 'richTextGraphScan';
        if (id === 'semanticEmbedding') return 'modelWarm';
        if (NATIVE_STORE_PROBE_CAPABILITIES.includes(id)) return 'nativeStoreProbe';
        if (id === 'nliAdjudication') return 'nliAdjudication';
        if (SEMANTIC_SCAN_CAPABILITIES.includes(id)) return 'semanticAtlasScan';
        if (id === 'galaxyVisualization') return 'graphVisualization';
        if (id === 'retrievalWalk') return 'retrievalWalk';
        if (MANIFOLD_CAPABILITIES[id]) return 'manifoldSnapshot';
        return 'notWired';
    }

    private requiredModelsForCapability(id: AtlasCapabilityId, options: AtlasRunOptions): AtlasModelRequirement[] {
        if (id === 'dynamicNer') return [this.dynamicNerRequirement(true)];
        if (id === 'semanticEmbedding' || SEMANTIC_SCAN_CAPABILITIES.includes(id)) {
            return [this.semanticEmbeddingRequirement(options, true)];
        }
        if (id === 'nliAdjudication') return [this.nliRequirement(true)];
        return [];
    }

    private requiredServicesForCapability(id: AtlasCapabilityId, options: AtlasRunOptions): AtlasServiceRequirement[] {
        if (id === 'nliAdjudication') {
            return [
                service('nli-worker', 'NLI worker classify/apply', 'NliWorkerService.classifyStream', NLI_MODEL_ID, true),
                service('nli-store-queue', 'Native NLI queue + apply', 'PhoenixBackendService.storeCommand', 'semantic:listNliJudgmentInputs → semantic:applyNliJudgments', true),
            ];
        }
        const operationKind = this.operationKindForCapability(id);
        switch (operationKind) {
            case 'dynamicNerScan':
                return [service('dynamic-ner', 'Dynamic NER scan', 'NerService.runDynamicScan', 'PhoenixUiApi.scanDiscovery / scan_json', true)];
            case 'richTextGraphScan':
                return [service('rich-text-graph', 'Rich text graph scan', 'AtlasScanCoordinatorService.runRichEmbeddingScan', 'PhoenixUiApi.atlasRichScan / atlas_rich_scan_json', true)];
            case 'semanticAtlasScan':
                return [
                    service('semantic-model', 'Semantic model loader', 'PhoenixMachineControlService.loadSemanticModel', this.embeddingModelLabel(options), true),
                    service('semantic-atlas', 'Semantic Atlas scan', 'AtlasScanCoordinatorService.runRichEmbeddingScan', 'PhoenixUiApi.atlasRichScan / atlas_rich_scan_json', true),
                ];
            case 'nativeStoreProbe': {
                const config = NATIVE_STORE_PROBES[id];
                return [service('native-store-probe', config?.label || 'Native store probe', 'PhoenixBackendService.storeCommand', config ? `relation:list(${config.relation})` : 'relation:list', true)];
            }
            case 'nliAdjudication':
                return [
                    service('nli-worker', 'NLI worker classify/apply', 'NliWorkerService.classifyStream', NLI_MODEL_ID, true),
                    service('nli-store-queue', 'Native NLI queue + apply', 'PhoenixBackendService.storeCommand', 'semantic:listNliJudgmentInputs -> semantic:applyNliJudgments', true),
                ];
            case 'modelWarm':
                return [service('semantic-model', 'Semantic model loader', 'PhoenixMachineControlService.loadSemanticModel', this.embeddingModelLabel(options), true)];
            case 'manifoldSnapshot':
                return [service('manifold-snapshot', 'Manifold snapshot', 'PhoenixUiApiService.loadManifoldAtlasSnapshot', 'manifold_snapshot_json', true)];
            case 'graphVisualization':
                return [service('graph-focus', 'Graph focus', 'PhoenixMachineControlService.requestGraphFocus', 'BlueprintHubService.openPage(graph)', true)];
            case 'retrievalWalk':
                return [service('retrieval-walk', 'Retrieval walk', 'PhoenixMachineControlService.search', 'PhoenixUiApi.searchScoped', true)];
            case 'nativeReasoningPass':
            case 'notWired':
                return [service('missing-runtime-binding', 'Missing runtime binding', 'not registered', 'not wired', false, this.blockedReasonForCapability(id))];
        }
    }

    private runPolicyForCapability(id: AtlasCapabilityId): AtlasCapabilityRunPolicy {
        if (id === 'semanticEmbedding') return 'warm-only';
        if (id === 'nliAdjudication') return 'native-only';
        if (NATIVE_STORE_PROBE_CAPABILITIES.includes(id)) return 'read-only';
        if (id === 'dynamicNer' || id === 'retrievalWalk' || id === 'galaxyVisualization' || MANIFOLD_CAPABILITIES[id]) return 'read-only';
        if (SEMANTIC_SCAN_CAPABILITIES.includes(id) || TEXT_GRAPH_CAPABILITIES.includes(id)) return 'dirty-only';
        return 'native-only';
    }

    private mutationPolicyForCapability(
        id: AtlasCapabilityId,
        fallback: AtlasCapabilityMutationPolicy,
    ): AtlasCapabilityMutationPolicy {
        if (id === 'dynamicNer' || id === 'retrievalWalk' || id === 'galaxyVisualization' || MANIFOLD_CAPABILITIES[id]) {
            return 'read-only';
        }
        if (NATIVE_STORE_PROBE_CAPABILITIES.includes(id)) return 'read-only';
        if (id === 'semanticEmbedding') return 'model warm';
        if (id === 'nliAdjudication') return 'native-only';
        if (SEMANTIC_SCAN_CAPABILITIES.includes(id) || TEXT_GRAPH_CAPABILITIES.includes(id)) return 'dirty-only';
        if (NOT_WIRED_REASONING_CAPABILITIES.includes(id)) return 'native-only';
        return fallback;
    }

    private blockedReasonForCapability(id: AtlasCapabilityId): string | undefined {
        if (NOT_WIRED_REASONING_CAPABILITIES.includes(id)) {
            return 'Phoenix causal types are present, but no Search Panel runtime operation binding or read-only probe is registered for the causal graph pass yet.';
        }
        return undefined;
    }

    private readinessProbeForCapability(
        id: AtlasCapabilityId,
        operationKind: AtlasCapabilityOperationKind,
        blockedReason?: string,
    ) {
        if (blockedReason) {
            return {
                label: 'Not wired',
                status: 'blocked' as const,
                source: 'AtlasCapabilityRuntimeService',
                detail: blockedReason,
            };
        }
        switch (operationKind) {
            case 'dynamicNerScan': {
                const status = this.ner.providerStatuses().dynamic_ner;
                const runtimeStatus = this.ner.isAnalyzing()
                    ? 'running'
                    : status.loading
                        ? 'warming'
                        : status.error
                            ? 'error'
                            : status.ready
                                ? 'ready'
                                : 'idle';
                return probe('Dynamic NER provider', runtimeStatus, 'NerService.providerStatuses.dynamic_ner', status.error || (status.ready ? 'provider ready' : 'provider cold'));
            }
            case 'richTextGraphScan':
                return probe('Text graph runtime', graphStatusToRuntime(this.machine.graphStatus()), 'PhoenixMachineControlService.graphStatus', this.machine.hasCommittedGraph() ? 'committed graph present' : 'ready to run atlas_rich_scan');
            case 'semanticAtlasScan':
            case 'modelWarm':
                return probe('Semantic embedding runner', vectorStatusToRuntime(this.machine.vectorStatus()), 'PhoenixMachineControlService.vectorStatus + native Rust semantic runner', this.machine.vectorStatus());
            case 'nativeStoreProbe': {
                const config = NATIVE_STORE_PROBES[id];
                return probe(config?.label || 'Native store probe', 'ready', 'PhoenixBackendService.storeCommand', config ? `read-only relation:list probe for ${config.relation}` : 'read-only store probe registered');
            }
            case 'nliAdjudication': {
                const runtimeStatus = this.nli.isProcessing()
                    ? 'running'
                    : this.nli.isInitialized()
                        ? 'ready'
                        : 'idle';
                return probe('NLI adjudication queue', runtimeStatus, 'semantic:listNliJudgmentInputs + NliWorkerService.classifyStream', this.nli.isInitialized() ? 'NLI worker ready to classify native queue inputs' : 'NLI worker cold; queue can be listed before model warm');
            }
            case 'manifoldSnapshot': {
                const mode = MANIFOLD_CAPABILITIES[id] || 'hybrid';
                return probe(`${mode} manifold snapshot`, manifoldStatusToRuntime(this.machine.manifoldStatuses()[mode]), `PhoenixMachineControlService.manifoldStatuses.${mode}`, this.machine.manifoldStatuses()[mode]);
            }
            case 'graphVisualization':
                return probe('Graph visualization', this.machine.hasCommittedGraph() ? 'ready' : 'idle', 'PhoenixMachineControlService.graphAudit', this.machine.hasCommittedGraph() ? 'graph snapshot available' : 'no committed graph snapshot yet');
            case 'retrievalWalk':
                return probe('Retrieval lanes', this.machine.activeLanes().length ? 'ready' : 'idle', 'RetrievalWorkbenchStateService.activeLanes', this.machine.activeLanes().join(' + ') || 'lexical fallback');
            case 'nativeReasoningPass':
            case 'notWired':
                return probe('Not wired', 'blocked', 'AtlasCapabilityRuntimeService', 'runtime binding missing');
        }
    }

    private outputProbeForCapability(id: AtlasCapabilityId, operationKind: AtlasCapabilityOperationKind): AtlasOutputProbe {
        const last = this.atlasScan.lastResult()?.nativeResult || null;
        switch (operationKind) {
            case 'dynamicNerScan':
                return output('Candidate suggestions', 'NerService.suggestions()', `${this.ner.suggestions().length} current candidates`, this.ner.suggestions().length);
            case 'richTextGraphScan':
                return output('Graph audit + delta counts', 'AtlasRichScanResult.graphDeltaCounts + GraphAuditService.snapshot', `${this.machine.graphNodes()} nodes / ${this.machine.graphEdges()} edges`, this.machine.graphNodes() + this.machine.graphEdges());
            case 'semanticAtlasScan': {
                const vectors = last ? (last.embeddingCounts?.leaf || 0) + (last.embeddingCounts?.entity || 0) + (last.embeddingCounts?.lens || 0) : 0;
                return output('Semantic sidecar output', 'AtlasRichScanResult.embeddingCounts', `${vectors} vectors; ${last?.relationCandidateCount || 0} relation candidates`, vectors);
            }
            case 'nativeStoreProbe': {
                const config = NATIVE_STORE_PROBES[id];
                return output('Read-only native store rows', config ? `relation:list(${config.relation})` : 'relation:list', config ? `${config.label}; no mutation` : 'read-only probe; no mutation', null);
            }
            case 'nliAdjudication':
                return output('NLI candidate-edge judgments', 'semantic:applyNliJudgments', 'classified entailment/contradiction rows applied to native candidate graph', this.nli.isInitialized() ? 'worker ready' : 'worker cold');
            case 'modelWarm':
                return output('Model readiness', 'PhoenixMachineControlService.vectorStatus', this.machine.vectorStatus(), this.machine.vectorStatus());
            case 'manifoldSnapshot':
                return output('Manifold snapshot', 'PhoenixUiApiService.loadManifoldAtlasSnapshot', 'snapshot payload / topology rows', this.machine.manifoldStatus());
            case 'graphVisualization':
                return output('Graph lens focus', 'PhoenixMachineControlService.graphFocus', this.machine.graphFocus() ? 'focus requested' : 'graph tab opens current snapshot', this.machine.graphFocus() ? 'focused' : 'idle');
            case 'retrievalWalk':
                return output('Ranked results', 'PhoenixMachineControlService.search', 'query-time ranked hits', this.machine.activeLanes().join(' + ') || 'lexical');
            case 'nativeReasoningPass':
            case 'notWired':
                return output('No output', 'not wired', this.blockedReasonForCapability(id) || 'runtime binding missing', null);
        }
    }

    private recipeOutputProof(id: AtlasRecipeId): AtlasOutputProbe[] {
        switch (id) {
            case 'textGraph':
                return [this.outputProbeForCapability('assertedKernel', 'richTextGraphScan')];
            case 'semanticGraph':
                return [this.outputProbeForCapability('semanticAtlas', 'semanticAtlasScan')];
            case 'adjudicatedSemanticGraph':
                return [
                    this.outputProbeForCapability('semanticAtlas', 'semanticAtlasScan'),
                    this.outputProbeForCapability('nliAdjudication', 'nliAdjudication'),
                ];
            case 'runNer':
                return [this.outputProbeForCapability('dynamicNer', 'dynamicNerScan')];
            case 'fastTextGraph':
            case 'fullTextGraph':
                return [this.outputProbeForCapability('assertedKernel', 'richTextGraphScan')];
            case 'semanticAtlas':
                return [this.outputProbeForCapability('semanticAtlas', 'semanticAtlasScan')];
            case 'warmFullIndexStack':
                return [
                    output('Dynamic NER readiness', 'NerService.providerStatuses.dynamic_ner', this.dynamicNerRequirement(true).statusLabel),
                    output('Embedding readiness', 'PhoenixMachineControlService.vectorStatus', this.semanticEmbeddingRequirement({}, true).statusLabel),
                    output('NLI readiness', 'NliWorkerService.isInitialized', this.nliRequirement(true).statusLabel),
                ];
            case 'visualizeCurrentGraph':
                return [this.outputProbeForCapability('galaxyVisualization', 'graphVisualization')];
        }
    }

    private dynamicNerRequirement(required: boolean): AtlasModelRequirement {
        const status = this.ner.providerStatuses().dynamic_ner;
        const readiness = this.ner.isAnalyzing()
            ? 'running'
            : status.loading
                ? 'warming'
                : status.error
                    ? 'error'
                    : status.ready
                        ? 'ready'
                        : 'idle';
        return {
            id: 'dynamicNer',
            laneId: 'dynamicNer',
            label: 'BI-small Dynamic NER',
            provider: 'dynamic_ner',
            service: 'NerService.warmProvider(dynamic_ner)',
            required,
            readiness,
            statusLabel: status.error || statusLabel(readiness),
        };
    }

    private semanticEmbeddingRequirement(options: AtlasRunOptions, required: boolean): AtlasModelRequirement {
        const readiness = vectorStatusToRuntime(this.machine.vectorStatus());
        return {
            id: 'semanticEmbedding',
            laneId: 'semanticEmbedding',
            label: this.embeddingModelLabel(options),
            selectedModelId: this.embeddingModelId(options),
            selectedModelLabel: this.embeddingModelLabel(options),
            dims: this.embeddingDimensionLabel(options),
            service: 'PhoenixMachineControlService.loadSemanticModel',
            required,
            readiness,
            statusLabel: this.machine.vectorStatus() === 'ready'
                ? `${this.embeddingModelLabel(options)} ${this.embeddingDimensionLabel(options)} ready`
                : statusLabel(readiness),
        };
    }

    private nliRequirement(required: boolean): AtlasModelRequirement {
        const readiness = this.nli.isProcessing()
            ? 'running'
            : this.nli.isInitialized()
                ? 'ready'
                : 'idle';
        return {
            id: 'nli',
            laneId: 'nli',
            label: 'ModernBERT NLI',
            selectedModelId: NLI_MODEL_ID,
            selectedModelLabel: 'onnx-community ModernBERT NLI',
            service: 'NliWorkerService.initialize',
            required,
            readiness,
            statusLabel: this.nli.modelId() || statusLabel(readiness),
        };
    }

    private embeddingModelId(options: AtlasRunOptions): PhoenixMachineModelId {
        return options.selectedModel || 'mongodb-leaf';
    }

    private embeddingModelLabel(options: AtlasRunOptions): string {
        return options.selectedModelLabel || this.embeddingModelId(options);
    }

    private embeddingDimensionLabel(options: AtlasRunOptions): string {
        return options.dimensionLabel || '384d';
    }

    private searchScope(options: AtlasRunOptions): SearchScope | undefined {
        const buildScope = options.buildScope;
        if (buildScope?.mode === 'global') return undefined;
        if (buildScope?.mode === 'folder') return { folderId: buildScope.folderId, folderPath: buildScope.folderId };
        if (buildScope?.mode === 'note') return { mode: 'note', noteId: buildScope.noteId };
        if (buildScope?.mode === 'multiNote') return { mode: 'multiNote', noteIds: buildScope.noteIds };
        const scope = options.scope || this.machine.scope();
        return scope === 'global' ? undefined : { folderId: scope, folderPath: scope };
    }

    private scanScopeOptions(options: AtlasRunOptions): { buildScope?: AtlasBuildScope; noteIds?: string[] } {
        const noteIds = options.noteIds?.length
            ? options.noteIds
            : noteIdsFromBuildScope(options.buildScope);
        return {
            ...(options.buildScope ? { buildScope: options.buildScope } : {}),
            ...(noteIds.length ? { noteIds } : {}),
        };
    }

    private graphBuildAddOnOperations(options: AtlasRunOptions): AtlasRuntimeOperation[] {
        const operations: AtlasRuntimeOperation[] = [];
        if (options.addOns?.dynamicNer) {
            operations.push(warmOperation('dynamicNer'));
            operations.push({ kind: 'dynamicNerScan', service: 'NerService.runDynamicScan', policy: 'read-only' });
        }
        if (options.addOns?.manifold) {
            operations.push({ kind: 'manifoldSnapshot', service: 'PhoenixUiApiService.loadManifoldAtlasSnapshot', policy: 'read-only', manifold: 'hybrid' });
        }
        if (options.addOns?.visualization) {
            operations.push({ kind: 'graphVisualization', service: 'PhoenixMachineControlService.requestGraphFocus + BlueprintHubService.openPage', policy: 'read-only' });
        }
        return operations;
    }

    private graphBuildAddOnCapabilities(options: AtlasRunOptions): AtlasCapabilityId[] {
        const capabilities: AtlasCapabilityId[] = [];
        if (options.addOns?.dynamicNer) capabilities.push('dynamicNer');
        if (options.addOns?.manifold) capabilities.push('hybridManifold');
        if (options.addOns?.visualization) capabilities.push('galaxyVisualization');
        return capabilities;
    }

    private allExcept(kept: AtlasCapabilityId[]): AtlasCapabilityId[] {
        const keep = new Set(kept);
        return ATLAS_CAPABILITY_RECIPES
            .flatMap((recipe) => [...recipe.requiredCapabilities, ...recipe.optionalCapabilities, ...recipe.skippedCapabilities])
            .filter((id, index, ids): id is AtlasCapabilityId => !!id && ids.indexOf(id) === index && !keep.has(id));
    }
}

function warmOperation(model: AtlasRuntimeModelRequirementId): AtlasRuntimeOperation {
    return {
        kind: 'warmModel',
        service: model === 'dynamicNer'
            ? 'NerService.warmProvider'
            : model === 'semanticEmbedding'
                ? 'PhoenixMachineControlService.loadSemanticModel'
                : 'NliWorkerService.initialize',
        model,
        ifCold: true,
        policy: 'warm-only',
    };
}

function normalizeNliInputs(payload: unknown): NliPairClassificationInput[] {
    if (!Array.isArray(payload)) return [];
    return payload
        .map((row) => normalizeNliInput(row))
        .filter((row): row is NliPairClassificationInput => !!row);
}

function normalizeNliInput(row: unknown): NliPairClassificationInput | null {
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    const input: NliPairClassificationInput = {
        judgmentId: stringField(record, 'judgmentId', 'judgment_id'),
        groupId: stringField(record, 'groupId', 'group_id'),
        sourceId: stringField(record, 'sourceId', 'source_id'),
        targetId: stringField(record, 'targetId', 'target_id'),
        edgeType: stringField(record, 'edgeType', 'edge_type'),
        direction: stringField(record, 'direction'),
        premise: stringField(record, 'premise'),
        hypothesis: stringField(record, 'hypothesis'),
    };
    return input.judgmentId && input.groupId && input.sourceId && input.targetId && input.edgeType && input.premise && input.hypothesis
        ? input
        : null;
}

function stringField(record: Record<string, unknown>, primary: string, fallback?: string): string {
    const value = record[primary] ?? (fallback ? record[fallback] : undefined);
    return typeof value === 'string' ? value : '';
}

function noteIdsFromBuildScope(scope: AtlasBuildScope | undefined): string[] {
    if (!scope) return [];
    if (scope.mode === 'note') return [scope.noteId];
    if (scope.mode === 'multiNote') return scope.noteIds;
    return [];
}

function uniqueIds(ids: string[]): string[] {
    return Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
}

function isNerScopeDocument(document: NerScopeDocument | undefined | null): document is NerScopeDocument {
    return !!document;
}

function service(
    id: string,
    label: string,
    serviceName: string,
    backendRoute: string,
    ready: boolean,
    detail?: string,
): AtlasServiceRequirement {
    return { id, label, service: serviceName, backendRoute, ready, detail };
}

function probe(
    label: string,
    status: AtlasCapabilityRuntimeState['status'],
    source: string,
    detail: string,
) {
    return { label, status, source, detail };
}

function output(label: string, source: string, detail: string, lastValue?: number | string | null): AtlasOutputProbe {
    return { label, source, detail, lastValue };
}

function expected(key: string, label: string, source: string): AtlasExpectedOutput {
    return { key, label, source };
}

function graphStatusToRuntime(status: ReturnType<PhoenixMachineControlService['graphStatus']>): AtlasCapabilityRuntimeState['status'] {
    if (status === 'building' || status === 'searching') return 'running';
    if (status === 'ready') return 'ready';
    if (status === 'error') return 'error';
    return 'idle';
}

function vectorStatusToRuntime(status: ReturnType<PhoenixMachineControlService['vectorStatus']>): AtlasCapabilityRuntimeState['status'] {
    if (status === 'loading' || status === 'indexing') return status === 'loading' ? 'warming' : 'running';
    if (status === 'ready') return 'ready';
    if (status === 'error') return 'error';
    return 'idle';
}

function manifoldStatusToRuntime(status: string): AtlasCapabilityRuntimeState['status'] {
    if (status === 'loading') return 'running';
    if (status === 'ready') return 'ready';
    if (status === 'error') return 'error';
    return 'idle';
}

function statusLabel(status: AtlasCapabilityRuntimeState['status']): string {
    switch (status) {
        case 'idle':
            return 'idle';
        case 'warming':
            return 'warming';
        case 'running':
            return 'running';
        case 'ready':
            return 'ready';
        case 'blocked':
            return 'not wired';
        case 'error':
            return 'error';
    }
}

function uniqueServices(services: AtlasServiceRequirement[]): AtlasServiceRequirement[] {
    const seen = new Set<string>();
    return services.filter((service) => {
        if (seen.has(service.id)) return false;
        seen.add(service.id);
        return true;
    });
}
