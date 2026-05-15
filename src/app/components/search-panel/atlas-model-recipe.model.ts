import type { PhoenixMachineVectorStatus, PhoenixMachineManifoldStatusMap } from '../../services/phoenix-machine-control.service';
import {
    ATLAS_CAPABILITY_RECIPES,
    ATLAS_MODEL_LANE_LABELS,
    atlasRecipeDefinitionById,
    laneLabelFromRegistry,
    type AtlasCapabilityId,
    type AtlasCapabilityMutationPolicy,
    type AtlasModelLaneId,
    type AtlasRecipeId,
} from './atlas-capability.model';

export type { AtlasModelLaneId, AtlasRecipeId } from './atlas-capability.model';

export type AtlasModelLaneStatus =
    | 'idle'
    | 'warming'
    | 'ready'
    | 'running'
    | 'error'
    | 'unavailable';

export type AtlasRecipeLifecycleId = 'scope' | 'warm' | 'run' | 'refresh';
export type AtlasRecipeLifecycleStatus = 'idle' | 'running' | 'ready' | 'error' | 'skipped';

export interface AtlasModelRecipePlan {
    id: AtlasRecipeId;
    label: string;
    description: string;
    actionLabel: string;
    dependencyChain: AtlasCapabilityId[];
    requiredCapabilities: AtlasCapabilityId[];
    optionalCapabilities: AtlasCapabilityId[];
    skippedCapabilities: AtlasCapabilityId[];
    requiredLanes: AtlasModelLaneId[];
    optionalLanes: AtlasModelLaneId[];
    skippedLanes: AtlasModelLaneId[];
    outputLabel: string;
    mutationPolicy: AtlasCapabilityMutationPolicy;
    backendRoute: string;
    cost: string;
}

export interface AtlasModelLaneView {
    id: AtlasModelLaneId;
    label: string;
    status: AtlasModelLaneStatus;
    detail: string;
    usedBy: string;
}

export interface AtlasRecipeLifecycleView {
    id: AtlasRecipeLifecycleId;
    label: string;
    detail: string;
    status: AtlasRecipeLifecycleStatus;
}

export interface AtlasModelLaneViewInput {
    dynamicNerStatus: 'cold' | 'ready' | 'warming' | 'running' | 'error';
    coOccurrenceReady: boolean;
    coOccurrenceLoading: boolean;
    coOccurrenceError?: string;
    vectorStatus: PhoenixMachineVectorStatus;
    semanticReady: boolean;
    semanticDetail: string;
    nliInitialized: boolean;
    nliProcessing: boolean;
    nliModelId: string | null;
    manifoldStatuses: PhoenixMachineManifoldStatusMap;
}

export const ATLAS_MODEL_RECIPE_PLANS: AtlasModelRecipePlan[] = ATLAS_CAPABILITY_RECIPES.map((recipe) => ({
    id: recipe.id,
    label: recipe.label,
    description: recipe.description,
    actionLabel: recipe.actionLabel,
    dependencyChain: recipe.dependencyChain,
    requiredCapabilities: recipe.requiredCapabilities,
    optionalCapabilities: recipe.optionalCapabilities,
    skippedCapabilities: recipe.skippedCapabilities,
    requiredLanes: recipe.requiredLanes,
    optionalLanes: recipe.optionalLanes,
    skippedLanes: recipe.skippedLanes,
    outputLabel: recipe.outputLabel,
    mutationPolicy: recipe.mutationPolicy,
    backendRoute: recipe.backendRoute,
    cost: recipe.cost,
}));

const LIFECYCLE: Array<Omit<AtlasRecipeLifecycleView, 'status'>> = [
    { id: 'scope', label: 'Check scope', detail: 'Use active Atlas scope' },
    { id: 'warm', label: 'Warm lanes', detail: 'Load only required models' },
    { id: 'run', label: 'Run path', detail: 'Execute selected backend recipe' },
    { id: 'refresh', label: 'Refresh outputs', detail: 'Update counts and sidecars' },
];

export function getAtlasModelRecipePlan(id: AtlasRecipeId): AtlasModelRecipePlan {
    const recipe = atlasRecipeDefinitionById(id);
    return ATLAS_MODEL_RECIPE_PLANS.find((plan) => plan.id === recipe.id) || ATLAS_MODEL_RECIPE_PLANS[0];
}

export function laneLabel(id: AtlasModelLaneId): string {
    return laneLabelFromRegistry(id);
}

export function buildAtlasModelLaneViews(input: AtlasModelLaneViewInput): AtlasModelLaneView[] {
    return [
        lane('dynamicNer', mapDynamicNerStatus(input.dynamicNerStatus), `BI small ${input.dynamicNerStatus}`, 'NER, text graph, semantic atlas'),
        lane('coOccurrence', providerStatus(input.coOccurrenceReady, input.coOccurrenceLoading, input.coOccurrenceError), input.coOccurrenceError || 'Phoenix scanner', 'text graph support'),
        lane('semanticEmbedding', semanticStatus(input.vectorStatus, input.semanticReady), input.semanticDetail, 'semantic atlas'),
        lane('nli', input.nliProcessing ? 'running' : input.nliInitialized ? 'ready' : 'idle', input.nliModelId || 'ModernBERT NLI', 'future adjudication'),
        lane('manifoldProjection', manifoldStatus(input.manifoldStatuses), manifoldDetail(input.manifoldStatuses), 'visualization output'),
    ];
}

export function buildAtlasRecipeLifecycle(
    activeStep: AtlasRecipeLifecycleId | null,
    completedSteps: AtlasRecipeLifecycleId[],
    failedStep: AtlasRecipeLifecycleId | null,
): AtlasRecipeLifecycleView[] {
    const completed = new Set(completedSteps);
    return LIFECYCLE.map((step) => ({
        ...step,
        status: failedStep === step.id
            ? 'error'
            : activeStep === step.id
                ? 'running'
                : completed.has(step.id)
                    ? 'ready'
                    : 'idle',
    }));
}

export function laneListLabel(lanes: AtlasModelLaneId[]): string {
    return lanes.length ? lanes.map(laneLabel).join(' / ') : 'none';
}

function lane(id: AtlasModelLaneId, status: AtlasModelLaneStatus, detail: string, usedBy: string): AtlasModelLaneView {
    return { id, label: ATLAS_MODEL_LANE_LABELS[id], status, detail, usedBy };
}

function mapDynamicNerStatus(status: AtlasModelLaneViewInput['dynamicNerStatus']): AtlasModelLaneStatus {
    if (status === 'cold') return 'idle';
    if (status === 'warming') return 'warming';
    return status;
}

function providerStatus(ready: boolean, loading: boolean, error?: string): AtlasModelLaneStatus {
    if (loading) return 'warming';
    if (error) return 'error';
    return ready ? 'ready' : 'idle';
}

function semanticStatus(status: PhoenixMachineVectorStatus, ready: boolean): AtlasModelLaneStatus {
    if (status === 'loading') return 'warming';
    if (status === 'indexing') return 'running';
    if (status === 'error') return 'error';
    return ready || status === 'ready' ? 'ready' : 'idle';
}

function manifoldStatus(statuses: PhoenixMachineManifoldStatusMap): AtlasModelLaneStatus {
    const values = Object.values(statuses);
    if (values.includes('loading')) return 'running';
    if (values.includes('error')) return 'error';
    if (values.every((status) => status === 'ready')) return 'ready';
    return 'idle';
}

function manifoldDetail(statuses: PhoenixMachineManifoldStatusMap): string {
    return `Hybrid ${statuses.hybrid} / Hopf ${statuses.hopf} / Lorentz ${statuses.lorentz}`;
}
