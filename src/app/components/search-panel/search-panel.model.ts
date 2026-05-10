import type { GraphAuditSnapshot } from '../../services/graph-audit.model';
import type { RetrievalLane } from '../../services/retrieval-workbench-state.service';

export type SearchMode = 'notes' | 'vector' | 'graph';
export type VectorStatus = 'idle' | 'loading' | 'ready' | 'indexing' | 'error';
export type GraphIndexStatus = 'idle' | 'building' | 'ready' | 'searching' | 'error';
export type ModelId = 'mongodb-leaf' | 'bge-small-en' | 'jina-v5-nano-retrieval';
export type TruncateDim = 'full' | '256' | '128' | '64';
export type AtlasGraphTargetId =
    | 'mention'
    | 'evidence'
    | 'surface'
    | 'kernel'
    | 'relation'
    | 'temporal'
    | 'eventIdentity'
    | 'memoryState'
    | 'causal'
    | 'semanticAtlas'
    | 'semanticCandidate'
    | 'galaxy';
export type AtlasPresetId = 'fastScan' | 'fullAtlas' | 'semanticAtlas' | 'deepReasoning' | 'visualizationOnly';

export interface AtlasGraphTarget {
    id: AtlasGraphTargetId;
    label: string;
    cost: 'Very low' | 'Low' | 'Low-Med' | 'Medium' | 'Med-High' | 'High' | 'Very high' | 'Render';
    subsystems: number;
    desc: string;
}

export interface AtlasPreset {
    id: AtlasPresetId;
    label: string;
    desc: string;
    target: AtlasGraphTargetId;
    policy: 'dirty-only' | 'force' | 'read-only';
    stages: string[];
}

export interface SearchPanelNote {
    id: string;
    title: string;
    content: string;
    narrativeId: string;
    folderId: string;
    hasBody?: boolean;
}

export interface SearchResultView {
    noteId: string;
    title: string;
    excerpt: string;
    score: number;
    source: SearchMode;
    sourceLabel: string;
    meta?: string;
    lexScore?: number;
    graphScore?: number;
    matchedEntities?: string[];
    lanes?: RetrievalLane[];
}

export interface RetrievalPreviewNode {
    id: string;
    label: string;
    x: number;
    y: number;
    color: string;
}

export interface RetrievalPreviewEdge {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface RetrievalGraphPreview {
    nodes: RetrievalPreviewNode[];
    edges: RetrievalPreviewEdge[];
}

export const RETRIEVAL_LANE_OPTIONS: Array<{ id: RetrievalLane; label: string; icon: string; desc: string }> = [
    { id: 'lexical', label: 'Lexical', icon: 'lucideSparkles', desc: 'Line and note matches' },
    { id: 'semantic', label: 'Semantic', icon: 'lucideZap', desc: 'Local embedding sidecar' },
    { id: 'graph', label: 'Graph', icon: 'lucideLayers', desc: 'Committed evidence graph' },
    { id: 'entities', label: 'Entities', icon: 'lucideCpu', desc: 'Registry and mentions' },
    { id: 'evidence', label: 'Evidence', icon: 'lucideFileText', desc: 'Claims and support paths' },
];

export const EMBEDDING_MODELS: Array<{ id: ModelId; label: string; dims: number; desc: string }> = [
    { id: 'mongodb-leaf', label: 'MDBR Leaf', dims: 384, desc: 'Fastest local TypeScript path.' },
    { id: 'bge-small-en', label: 'BGE-small', dims: 384, desc: 'Balanced local embedding path.' },
    { id: 'jina-v5-nano-retrieval', label: 'Jina v5 Nano', dims: 768, desc: 'Retrieval-tuned Rust runner target.' },
];

export const TRUNCATE_DIMS: TruncateDim[] = ['full', '256', '128', '64'];

export const ATLAS_GRAPH_TARGETS: AtlasGraphTarget[] = [
    { id: 'mention', label: 'Mention Graph', cost: 'Very low', subsystems: 2, desc: 'Atlas surface packets and local mention edges.' },
    { id: 'evidence', label: 'Evidence Graph', cost: 'Low', subsystems: 3, desc: 'Mention candidates, fusion decisions, and graph patch ops.' },
    { id: 'surface', label: 'Surface Graph', cost: 'Low-Med', subsystems: 4, desc: 'Document, chunk, entity, and mention topology.' },
    { id: 'kernel', label: 'Asserted Kernel', cost: 'Medium', subsystems: 6, desc: 'Committed graph layer for entities, claims, states, and events.' },
    { id: 'relation', label: 'Relation Graph', cost: 'Medium', subsystems: 6, desc: 'Entity-to-entity relation extraction and review lanes.' },
    { id: 'temporal', label: 'Temporal Graph', cost: 'Med-High', subsystems: 7, desc: 'Anchors, intervals, timeline edges, gaps, and conflicts.' },
    { id: 'eventIdentity', label: 'Event Identity', cost: 'Med-High', subsystems: 7, desc: 'Event mentions resolved into canonical event memberships.' },
    { id: 'memoryState', label: 'Memory / State', cost: 'High', subsystems: 8, desc: 'Durable states, deltas, conflicts, continuity, and ledgers.' },
    { id: 'causal', label: 'Causal Graph', cost: 'High', subsystems: 9, desc: 'Cause/effect chains, invalidations, and causal memory cards.' },
    { id: 'semanticAtlas', label: 'Embedding Atlas', cost: 'High', subsystems: 8, desc: 'Hierarchy, surface scan, leaf/entity-context embeddings, and candidate relations under a 25s budget.' },
    { id: 'semanticCandidate', label: 'Semantic Candidate', cost: 'Very high', subsystems: 10, desc: 'Embeddings, ANN/hybrid space, candidate semantic edges, and NLI.' },
    { id: 'galaxy', label: 'Galaxy View', cost: 'Render', subsystems: 4, desc: 'Projection/render graph from the current kernel snapshot.' },
];

export const ATLAS_PRESETS: AtlasPreset[] = [
    {
        id: 'fastScan',
        label: 'Fast Scan',
        desc: 'Run the native Atlas surface and evidence graph pipeline on dirty scope data.',
        target: 'evidence',
        policy: 'dirty-only',
        stages: ['Surface scan', 'Mention graph', 'Evidence graph'],
    },
    {
        id: 'fullAtlas',
        label: 'Full Atlas',
        desc: 'Update dirty notes through the committed graph lane.',
        target: 'kernel',
        policy: 'dirty-only',
        stages: ['Surface scan', 'Evidence graph', 'Asserted kernel', 'OverGraph commit'],
    },
    {
        id: 'semanticAtlas',
        label: 'Embedding Atlas Scan',
        desc: 'Build the rich graph: hierarchy, surface candidates, backend embeddings, and candidate relations.',
        target: 'semanticAtlas',
        policy: 'dirty-only',
        stages: ['Surface scan', 'Leaf embeddings', 'Entity context vectors', 'Candidate relations'],
    },
    {
        id: 'deepReasoning',
        label: 'Deep Reasoning',
        desc: 'Force rebuild for richer temporal, memory, and causal passes.',
        target: 'causal',
        policy: 'force',
        stages: ['Full rebuild', 'Temporal', 'Event identity', 'Memory/state', 'Causal review'],
    },
    {
        id: 'visualizationOnly',
        label: 'Visualization Only',
        desc: 'Open the graph view without mutating backend state.',
        target: 'galaxy',
        policy: 'read-only',
        stages: ['Load snapshot', 'Compile galaxy scene'],
    },
];

export function buildGraphPreview(snapshot: GraphAuditSnapshot | null): RetrievalGraphPreview {
    if (!snapshot?.sampleNodes.length) {
        return { nodes: [], edges: [] };
    }

    const palette = ['#2dd4bf', '#38bdf8', '#a78bfa', '#fbbf24', '#fb7185', '#34d399'];
    const nodeCount = Math.min(8, snapshot.sampleNodes.length);
    const nodes: RetrievalPreviewNode[] = [];
    const indexById = new Map<string, number>();

    for (let i = 0; i < nodeCount; i++) {
        const sample = snapshot.sampleNodes[i];
        const angle = (Math.PI * 2 * i) / nodeCount - Math.PI / 2;
        const radius = i === 0 ? 0 : 34;
        const x = 50 + Math.cos(angle) * radius;
        const y = 50 + Math.sin(angle) * radius;
        indexById.set(sample.id, i);
        nodes.push({
            id: sample.id,
            label: sample.label || sample.id,
            x,
            y,
            color: palette[i % palette.length],
        });
    }

    const edges: RetrievalPreviewEdge[] = [];
    for (const edge of snapshot.sampleEdges) {
        const source = indexById.get(edge.sourceId);
        const target = indexById.get(edge.targetId);
        if (source === undefined || target === undefined) continue;
        edges.push({
            id: `${edge.sourceId}:${edge.targetId}:${edge.edgeType}:${edges.length}`,
            x1: nodes[source].x,
            y1: nodes[source].y,
            x2: nodes[target].x,
            y2: nodes[target].y,
        });
        if (edges.length >= 10) break;
    }

    return { nodes, edges };
}

export function buildSearchSnippet(content: string, query: string): string {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    if (!trimmed) return 'No note preview available.';

    const normalizedQuery = query.trim().toLowerCase();
    const matchIndex = normalizedQuery ? trimmed.toLowerCase().indexOf(normalizedQuery) : -1;
    if (matchIndex === -1) {
        return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
    }

    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(trimmed.length, matchIndex + normalizedQuery.length + 120);
    const snippet = trimmed.slice(start, end);
    return `${start > 0 ? '... ' : ''}${snippet}${end < trimmed.length ? ' ...' : ''}`;
}
