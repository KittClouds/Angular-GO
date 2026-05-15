import type {
    AtlasCapabilityId,
    AtlasCapabilityMutationPolicy,
    AtlasModelLaneId,
    AtlasRecipeId,
} from '../components/search-panel/atlas-capability.model';
import type { PhoenixMachineModelId } from './phoenix-machine-control.service';
import type { AtlasManifoldMode } from './manifold-atlas.types';

export type AtlasCapabilityOperationKind =
    | 'modelWarm'
    | 'dynamicNerScan'
    | 'richTextGraphScan'
    | 'semanticAtlasScan'
    | 'nativeStoreProbe'
    | 'nliAdjudication'
    | 'manifoldSnapshot'
    | 'graphVisualization'
    | 'retrievalWalk'
    | 'nativeReasoningPass'
    | 'notWired';

export type AtlasRuntimeOperationKind = AtlasCapabilityOperationKind | 'warmModel';

export type AtlasCapabilityRunPolicy =
    | 'dirty-only'
    | 'force'
    | 'read-only'
    | 'warm-only'
    | 'native-only';

export type AtlasBuildScope =
    | { mode: 'global' }
    | { mode: 'folder'; folderId: string }
    | { mode: 'note'; noteId: string }
    | { mode: 'multiNote'; noteIds: string[] };

export interface AtlasBuildAddOns {
    dynamicNer?: boolean;
    manifold?: boolean;
    visualization?: boolean;
}

export type AtlasCapabilityRuntimeStatus =
    | 'idle'
    | 'warming'
    | 'running'
    | 'ready'
    | 'blocked'
    | 'error';

export type AtlasRuntimeModelRequirementId = 'dynamicNer' | 'semanticEmbedding' | 'nli';

export interface AtlasModelRequirement {
    id: AtlasRuntimeModelRequirementId;
    laneId: AtlasModelLaneId;
    label: string;
    provider?: string;
    selectedModelId?: PhoenixMachineModelId | string;
    selectedModelLabel?: string;
    dims?: string;
    service: string;
    required: boolean;
    readiness: AtlasCapabilityRuntimeStatus;
    statusLabel: string;
}

export interface AtlasServiceRequirement {
    id: string;
    label: string;
    service: string;
    backendRoute: string;
    ready: boolean;
    detail?: string;
}

export interface AtlasReadinessProbe {
    label: string;
    status: AtlasCapabilityRuntimeStatus;
    source: string;
    detail: string;
}

export interface AtlasOutputProbe {
    label: string;
    source: string;
    detail: string;
    lastValue?: number | string | null;
}

export interface AtlasExpectedOutput {
    key: string;
    label: string;
    source: string;
}

export interface AtlasRuntimeOperation {
    kind: AtlasRuntimeOperationKind;
    service: string;
    args?: Record<string, unknown>;
    model?: AtlasRuntimeModelRequirementId;
    ifCold?: boolean;
    policy?: AtlasCapabilityRunPolicy;
    manifold?: AtlasManifoldMode;
}

export interface AtlasCapabilityRuntimeBinding {
    capabilityId: AtlasCapabilityId;
    runnable: boolean;
    operationKind: AtlasCapabilityOperationKind;
    requiredModels: AtlasModelRequirement[];
    requiredServices: AtlasServiceRequirement[];
    mutationPolicy: AtlasCapabilityMutationPolicy;
    runPolicy: AtlasCapabilityRunPolicy;
    readinessProbe: AtlasReadinessProbe;
    outputProbe: AtlasOutputProbe;
    blockedReason?: string;
}

export interface AtlasCapabilityRuntimeState extends AtlasCapabilityRuntimeBinding {
    status: AtlasCapabilityRuntimeStatus;
    statusLabel: string;
}

export interface AtlasRecipeExecutionPlan {
    id: AtlasRecipeId;
    label: string;
    description: string;
    actionLabel: string;
    requiredCapabilities: AtlasCapabilityId[];
    optionalCapabilities: AtlasCapabilityId[];
    skippedCapabilities: AtlasCapabilityId[];
    dependencyChain: AtlasCapabilityId[];
    requiredModels: AtlasModelRequirement[];
    optionalModels: AtlasModelRequirement[];
    requiredServices: AtlasServiceRequirement[];
    operations: AtlasRuntimeOperation[];
    skips: AtlasCapabilityId[];
    expectedOutputs: AtlasExpectedOutput[];
    outputLabel: string;
    mutationPolicy: AtlasCapabilityMutationPolicy;
    runPolicy: AtlasCapabilityRunPolicy;
    cost: string;
    backendRoute: string;
    runnable: boolean;
    blockedReason?: string;

    /** Compatibility view for the existing Search Panel lane widgets. */
    requiredLanes: AtlasModelLaneId[];
    optionalLanes: AtlasModelLaneId[];
    skippedLanes: AtlasModelLaneId[];
}

export interface AtlasRecipeRuntimeState extends AtlasRecipeExecutionPlan {
    status: AtlasCapabilityRuntimeStatus;
    statusLabel: string;
}

export interface AtlasRunOptions {
    selectedModel?: PhoenixMachineModelId;
    selectedModelLabel?: string;
    dimensionLabel?: string;
    scope?: 'global' | string;
    buildScope?: AtlasBuildScope;
    buildPolicy?: 'dirty-only' | 'force';
    addOns?: AtlasBuildAddOns;
    query?: string;
    noteIds?: string[];
    skipModelWarm?: boolean;
}

export interface AtlasCapabilityRunResult {
    capabilityId: AtlasCapabilityId;
    operationKind: AtlasCapabilityOperationKind;
    mutationPolicy: AtlasCapabilityMutationPolicy;
    runPolicy: AtlasCapabilityRunPolicy;
    outputProof: AtlasOutputProbe[];
    rawResult?: unknown;
}

export interface AtlasRecipeRunResult {
    recipeId: AtlasRecipeId;
    label: string;
    mutationPolicy: AtlasCapabilityMutationPolicy;
    runPolicy: AtlasCapabilityRunPolicy;
    outputProof: AtlasOutputProbe[];
    operationResults: AtlasCapabilityRunResult[];
}
