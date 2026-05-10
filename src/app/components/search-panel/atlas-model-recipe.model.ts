import type { AtlasRecipeId } from './atlas-command-status.model';
import type { PhoenixMachineVectorStatus, PhoenixMachineManifoldStatusMap } from '../../services/phoenix-machine-control.service';

export type AtlasModelLaneId =
    | 'dynamicNer'
    | 'coOccurrence'
    | 'semanticEmbedding'
    | 'nli'
    | 'manifoldProjection';

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
    requiredLanes: AtlasModelLaneId[];
    optionalLanes: AtlasModelLaneId[];
    skippedLanes: AtlasModelLaneId[];
    outputLabel: string;
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

export const ATLAS_MODEL_RECIPE_PLANS: AtlasModelRecipePlan[] = [
    {
        id: 'runNer',
        label: 'Run NER',
        description: 'Scan the active note for dynamic entity candidates.',
        actionLabel: 'Run NER',
        requiredLanes: ['dynamicNer'],
        optionalLanes: ['coOccurrence'],
        skippedLanes: ['semanticEmbedding', 'nli', 'manifoldProjection'],
        outputLabel: 'candidate entities',
    },
    {
        id: 'fastTextGraph',
        label: 'Fast Text Graph',
        description: 'Dirty-only surface, chunking, evidence graph, and graph commit.',
        actionLabel: 'Run Fast Text Graph',
        requiredLanes: ['dynamicNer', 'coOccurrence'],
        optionalLanes: [],
        skippedLanes: ['semanticEmbedding', 'nli', 'manifoldProjection'],
        outputLabel: 'vertices + evidence edges',
    },
    {
        id: 'fullTextGraph',
        label: 'Full Text Graph',
        description: 'Force rebuild the deterministic text graph path without embeddings.',
        actionLabel: 'Run Full Text Graph',
        requiredLanes: ['dynamicNer', 'coOccurrence'],
        optionalLanes: [],
        skippedLanes: ['semanticEmbedding', 'nli', 'manifoldProjection'],
        outputLabel: 'fresh committed graph',
    },
    {
        id: 'semanticAtlas',
        label: 'Semantic Atlas',
        description: 'Run the rich scan with selected embeddings and candidate links.',
        actionLabel: 'Index Semantic Atlas',
        requiredLanes: ['dynamicNer', 'semanticEmbedding'],
        optionalLanes: ['manifoldProjection'],
        skippedLanes: ['nli'],
        outputLabel: 'vectors + candidate links',
    },
    {
        id: 'warmFullIndexStack',
        label: 'Warm Full Index Stack',
        description: 'Load the local embedding, BI small Dynamic NER, and NLI lanes only.',
        actionLabel: 'Warm Full Index Stack',
        requiredLanes: ['dynamicNer', 'semanticEmbedding', 'nli'],
        optionalLanes: ['coOccurrence'],
        skippedLanes: ['manifoldProjection'],
        outputLabel: 'ready model sidecars',
    },
    {
        id: 'visualizeCurrentGraph',
        label: 'Visualize Current Graph',
        description: 'Open the current graph lens without warming models or mutating data.',
        actionLabel: 'Visualize Current Graph',
        requiredLanes: [],
        optionalLanes: ['manifoldProjection'],
        skippedLanes: ['dynamicNer', 'coOccurrence', 'semanticEmbedding', 'nli'],
        outputLabel: 'current snapshot view',
    },
];

const LANE_LABELS: Record<AtlasModelLaneId, string> = {
    dynamicNer: 'Dynamic NER',
    coOccurrence: 'Co-occurrence',
    semanticEmbedding: 'Semantic Embedding',
    nli: 'NLI',
    manifoldProjection: 'Manifold Projection',
};

const LIFECYCLE: Array<Omit<AtlasRecipeLifecycleView, 'status'>> = [
    { id: 'scope', label: 'Check scope', detail: 'Use active Atlas scope' },
    { id: 'warm', label: 'Warm lanes', detail: 'Load only required models' },
    { id: 'run', label: 'Run path', detail: 'Execute selected backend recipe' },
    { id: 'refresh', label: 'Refresh outputs', detail: 'Update counts and sidecars' },
];

export function getAtlasModelRecipePlan(id: AtlasRecipeId): AtlasModelRecipePlan {
    return ATLAS_MODEL_RECIPE_PLANS.find((plan) => plan.id === id) || ATLAS_MODEL_RECIPE_PLANS[0];
}

export function laneLabel(id: AtlasModelLaneId): string {
    return LANE_LABELS[id];
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
    return { id, label: LANE_LABELS[id], status, detail, usedBy };
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
