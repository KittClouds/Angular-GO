import type { GraphAuditSnapshot } from '../../services/graph-audit.model';
import type { AtlasManifoldMode, PhoenixMachineManifoldStatus } from '../../services/manifold-atlas.types';
import type { PhoenixMachineGraphStatus, PhoenixMachineManifoldStatusMap, PhoenixMachineSummary, PhoenixMachineVectorStatus } from '../../services/phoenix-machine-control.service';
import type { PhoenixMachineStageSnapshot } from '../../services/phoenix-machine-controller.service';
import type { AtlasRichScanResult } from '../../services/phoenix-ui-api.service';
import type { RetrievalLane } from '../../services/retrieval-workbench-state.service';
import {
    buildAtlasLedgerGroups,
    flattenAtlasLedgerGroups,
    type AtlasLedgerGroup,
    type AtlasLedgerMetric,
} from '../../services/atlas-count-ledger.model';

export type AtlasPipelineStageId = 'scope' | 'surface' | 'ner' | 'graph' | 'semantic' | 'sidecars' | 'retrieval';
export type AtlasRecipeId =
    | 'runNer'
    | 'fastTextGraph'
    | 'fullTextGraph'
    | 'semanticAtlas'
    | 'warmFullIndexStack'
    | 'visualizeCurrentGraph';
export type AtlasPipelineTone = 'idle' | 'dirty' | 'running' | 'ready' | 'error';

export interface AtlasInventoryCounts {
    notes: number;
    registryEntities: number | null;
    committedVertices: number | null;
    graphLeaves: number | null;
    evidenceEdges: number | null;
    candidateEdges: number | null;
    embeddingVectors: number | null;
    issues: number | null;
}

export interface AtlasInventoryMetric {
    label: string;
    value: number | null;
    detail: string;
    source: string;
}

export interface AtlasPipelineStageStatus {
    id: AtlasPipelineStageId;
    label: string;
    status: AtlasPipelineTone;
    detail: string;
    input: string;
    output: string;
    action: string;
}

export interface AtlasRecipe {
    id: AtlasRecipeId;
    label: string;
    subtitle: string;
    detail: string;
    output: string;
    icon: string;
    primary?: boolean;
}

export interface AtlasRecipeResult {
    recipeId: AtlasRecipeId;
    label: string;
    durationMs: number;
    details?: Record<string, unknown>;
}

export interface AtlasCommandStatus {
    scopeLabel: string;
    state: AtlasPipelineTone;
    inventory: AtlasInventoryCounts;
    ledgerGroups: AtlasLedgerGroup[];
    metrics: AtlasLedgerMetric[];
    stages: AtlasPipelineStageStatus[];
    sidecars: AtlasInventoryMetric[];
    chunking: {
        chunkSize: number;
        overlap: number;
        sentenceBoundaries: boolean;
        estimatedChunks: number;
        source: string;
    };
    lastRun: {
        label: string;
        detail: string;
        durationMs: number | null;
    };
}

export interface AtlasCommandStatusInput {
    scopeLabel: string;
    noteCount: number;
    estimatedChunks: number;
    audit: GraphAuditSnapshot | null;
    stages: Partial<Record<string, PhoenixMachineStageSnapshot>>;
    activeJob: PhoenixMachineSummary['kind'] | null;
    lastSummary: PhoenixMachineSummary | null;
    lastRichScan: AtlasRichScanResult | null;
    vectorStatus: PhoenixMachineVectorStatus;
    graphStatus: PhoenixMachineGraphStatus;
    manifoldMode: AtlasManifoldMode;
    manifoldStatus: PhoenixMachineManifoldStatus;
    manifoldStatuses: PhoenixMachineManifoldStatusMap;
    dynamicNerStatus: 'cold' | 'ready' | 'warming' | 'running' | 'error';
    enabledLanes: RetrievalLane[];
    embeddingModelLabel: string;
    embeddingDimensionLabel: string;
}

export const ATLAS_RECIPES: AtlasRecipe[] = [
    {
        id: 'runNer',
        label: 'Run NER',
        subtitle: 'active note',
        detail: 'Phoenix dynamic NER candidates for review.',
        output: 'candidate entities',
        icon: 'lucideCpu',
    },
    {
        id: 'fastTextGraph',
        label: 'Fast Text Graph',
        subtitle: 'dirty-only, no embeddings',
        detail: 'Surface scan, chunking, evidence graph, and graph commit.',
        output: 'vertices + evidence edges',
        icon: 'lucideZap',
        primary: true,
    },
    {
        id: 'fullTextGraph',
        label: 'Full Text Graph',
        subtitle: 'force, no embeddings',
        detail: 'Rebuild the text graph path from current scope data.',
        output: 'fresh committed graph',
        icon: 'lucideLayers',
    },
    {
        id: 'semanticAtlas',
        label: 'Semantic Atlas',
        subtitle: 'embeddings on',
        detail: 'Run rich scan with semantic sidecar rows and candidates.',
        output: 'vectors + candidate links',
        icon: 'lucideSparkles',
        primary: true,
    },
    {
        id: 'warmFullIndexStack',
        label: 'Warm Full Index Stack',
        subtitle: 'no graph mutation',
        detail: 'Load embedding, GLiNER, and NLI model lanes.',
        output: 'ready model sidecars',
        icon: 'lucideMicrochip',
    },
    {
        id: 'visualizeCurrentGraph',
        label: 'Visualize Current Graph',
        subtitle: 'read-only',
        detail: 'Open the graph lens without changing backend state.',
        output: 'current snapshot view',
        icon: 'lucideSearch',
    },
];

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

export function estimateDynamicChunks(notes: Array<{ content: string }>, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): number {
    const step = Math.max(1, chunkSize - overlap);
    return notes.reduce((total, note) => {
        const estimatedTokens = Math.ceil((note.content || '').trim().length / 4);
        if (estimatedTokens <= 0) return total;
        return total + Math.max(1, Math.ceil(Math.max(1, estimatedTokens - overlap) / step));
    }, 0);
}

export function buildAtlasCommandStatus(input: AtlasCommandStatusInput): AtlasCommandStatus {
    const audit = input.audit;
    const last = input.lastRichScan;
    const embeddingVectors = last
        ? (last.embeddingCounts?.leaf || 0) + (last.embeddingCounts?.entity || 0) + (last.embeddingCounts?.lens || 0)
        : null;
    const candidateEdges = last?.graphDeltaCounts?.['candidateEdges'] ?? null;
    const graphLeaves = audit?.nodeKinds.find((bucket) => ['leaf', 'chunk'].includes(bucket.key))?.count ?? null;
    const inventory: AtlasInventoryCounts = {
        notes: input.noteCount,
        registryEntities: audit ? audit.registryEntities : null,
        committedVertices: audit ? audit.graphNodes : null,
        graphLeaves,
        evidenceEdges: audit ? audit.graphEdges : null,
        candidateEdges,
        embeddingVectors,
        issues: audit ? (audit.orphanEdges || 0) + (audit.duplicateEdges || 0) : null,
    };
    const ledgerGroups = buildAtlasLedgerGroups(inventory, input.scopeLabel);

    return {
        scopeLabel: input.scopeLabel,
        state: overallTone(input),
        inventory,
        ledgerGroups,
        metrics: flattenAtlasLedgerGroups(ledgerGroups),
        stages: buildStages(input, inventory),
        sidecars: buildSidecars(input),
        chunking: {
            chunkSize: CHUNK_SIZE,
            overlap: CHUNK_OVERLAP,
            sentenceBoundaries: true,
            estimatedChunks: input.estimatedChunks,
            source: 'runtime default',
        },
        lastRun: {
            label: input.lastSummary?.label || 'No completed command yet',
            detail: lastRunDetail(last),
            durationMs: input.lastSummary?.durationMs ?? null,
        },
    };
}

function buildStages(input: AtlasCommandStatusInput, counts: AtlasInventoryCounts): AtlasPipelineStageStatus[] {
    return [
        stage('scope', 'Scope', 'ready', input.scopeLabel, 'workspace notes', `${counts.notes} note${plural(counts.notes)}`, 'Choose scope'),
        stage('surface', 'Text Surface + Dynamic Chunking', toneFromMachine(input.stages['surface']?.status), `${input.estimatedChunks} est. chunks`, `${counts.notes} notes`, countNoun(counts.graphLeaves, 'committed leaf', 'committed leaves'), 'Fast Text Graph'),
        stage('ner', 'Dynamic NER / Review Lanes', nerTone(input.dynamicNerStatus), `Phoenix ${input.dynamicNerStatus}`, 'plain text', 'candidate entities', 'Run NER'),
        stage('graph', 'Text Graph Commit', graphTone(input.graphStatus), `${countNoun(counts.committedVertices, 'vertex', 'vertices')}, ${countNoun(counts.evidenceEdges, 'evidence edge', 'evidence edges')}`, 'surface + mentions', 'committed graph', 'Text Graph'),
        stage('semantic', 'Semantic Sidecar', vectorTone(input.vectorStatus, counts.embeddingVectors), `${input.embeddingModelLabel} ${input.embeddingDimensionLabel}`, 'committed graph + text', valueLabel(counts.embeddingVectors, 'vectors'), 'Semantic Atlas'),
        stage('sidecars', 'Manifold Sidecars', manifoldTone(input.manifoldStatus), `${input.manifoldMode} ${input.manifoldStatus}`, 'semantic atlas', 'Hybrid / Hopf / Lorentz', 'Visualize'),
        stage('retrieval', 'Retrieval / Visualization', input.enabledLanes.length ? 'ready' : 'idle', input.enabledLanes.join(' + ') || 'lexical', 'query text', 'ranked results', 'Search'),
    ];
}

function buildSidecars(input: AtlasCommandStatusInput): AtlasInventoryMetric[] {
    return [
        { label: 'Semantic sidecar', value: null, detail: `${input.vectorStatus} ${input.embeddingDimensionLabel}`, source: input.embeddingModelLabel },
        { label: 'Hybrid space', value: null, detail: input.manifoldStatuses.hybrid, source: 'Hybrid' },
        { label: 'Hopf projection', value: null, detail: input.manifoldStatuses.hopf, source: 'Hopf' },
        { label: 'Lorentz forest', value: null, detail: input.manifoldStatuses.lorentz, source: 'Lorentz' },
    ];
}

function stage(
    id: AtlasPipelineStageId,
    label: string,
    status: AtlasPipelineTone,
    detail: string,
    input: string,
    output: string,
    action: string,
): AtlasPipelineStageStatus {
    return { id, label, status, detail, input, output, action };
}

function overallTone(input: AtlasCommandStatusInput): AtlasPipelineTone {
    if (input.activeJob && input.activeJob !== 'manifold-load' && input.activeJob !== 'graph-focus') return 'running';
    if (input.graphStatus === 'error' || input.vectorStatus === 'error') return 'error';
    if (input.graphStatus === 'building' || input.vectorStatus === 'loading' || input.vectorStatus === 'indexing') return 'running';
    if (input.graphStatus === 'ready' || input.vectorStatus === 'ready') return 'ready';
    return 'idle';
}

function toneFromMachine(status: string | undefined): AtlasPipelineTone {
    if (status === 'running' || status === 'queued') return 'running';
    if (status === 'dirty') return 'dirty';
    if (status === 'ready') return 'ready';
    if (status === 'error') return 'error';
    return 'idle';
}

function graphTone(status: PhoenixMachineGraphStatus): AtlasPipelineTone {
    if (status === 'building' || status === 'searching') return 'running';
    if (status === 'ready') return 'ready';
    if (status === 'error') return 'error';
    return 'idle';
}

function vectorTone(status: PhoenixMachineVectorStatus, vectors: number | null): AtlasPipelineTone {
    if (status === 'loading' || status === 'indexing') return 'running';
    if (status === 'error') return 'error';
    if (status === 'ready' || (vectors || 0) > 0) return 'ready';
    return 'idle';
}

function manifoldTone(status: PhoenixMachineManifoldStatus): AtlasPipelineTone {
    if (status === 'loading') return 'running';
    if (status === 'ready') return 'ready';
    if (status === 'error') return 'error';
    if (status === 'stale') return 'dirty';
    return 'idle';
}

function nerTone(status: AtlasCommandStatusInput['dynamicNerStatus']): AtlasPipelineTone {
    if (status === 'running' || status === 'warming') return 'running';
    if (status === 'ready') return 'ready';
    if (status === 'error') return 'error';
    return 'idle';
}

function valueLabel(value: number | null, label: string): string {
    return value === null ? 'not run' : `${value} ${label}`;
}

function countNoun(value: number | null, singular: string, pluralLabel: string): string {
    if (value === null) return 'unavailable';
    return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function lastRunDetail(result: AtlasRichScanResult | null): string {
    if (!result) return 'Run a recipe to populate stage counts.';
    const semantic = result.appliedOptions?.includeSemanticAtlas !== false;
    return semantic ? 'semantic sidecar included' : 'text graph only, embeddings skipped';
}

function plural(value: number): string {
    return value === 1 ? '' : 's';
}
