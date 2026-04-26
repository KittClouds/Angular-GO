import type { ForceGraphData, GraphLink, GraphNode, GraphStats } from '../../services/graph-viz.service';

export type GraphWorkbenchScope = 'active-note' | 'current-folder' | 'narrative-folder' | 'whole-vault';
export type GraphWorkbenchLens = 'entities' | 'context' | 'timeline' | 'evidence' | 'structure' | 'full-index';
export type GraphWarmStrategy = 'raw' | 'warm-first';
export type GraphWarmStatus = 'cold' | 'warming' | 'warm' | 'failed';
export type GraphBuildStatus = 'idle' | 'building' | 'ready' | 'failed';

export interface GraphWorkbenchOption<T extends string> {
    id: T;
    label: string;
    description: string;
}

export const GRAPH_SCOPE_OPTIONS: GraphWorkbenchOption<GraphWorkbenchScope>[] = [
    { id: 'active-note', label: 'Active Note', description: 'Only the note currently open in the editor.' },
    { id: 'current-folder', label: 'Current Folder', description: 'All notes beside the active note.' },
    { id: 'narrative-folder', label: 'Narrative Folder', description: 'The isolated story vault for this note.' },
    { id: 'whole-vault', label: 'Whole Vault', description: 'Every indexed note in the file tree.' },
];

export const GRAPH_LENS_OPTIONS: GraphWorkbenchOption<GraphWorkbenchLens>[] = [
    { id: 'entities', label: 'Entities', description: 'Characters, places, factions, items, and concepts.' },
    { id: 'context', label: 'Context', description: 'Context islands, bridges, and semantic neighborhoods.' },
    { id: 'timeline', label: 'Timeline', description: 'Events, states, temporal edges, and causal flow.' },
    { id: 'evidence', label: 'Evidence', description: 'Claims, support, contradiction, and provenance-bearing links.' },
    { id: 'structure', label: 'Structure', description: 'Notes, folders, blocks, lines, and document hierarchy.' },
    { id: 'full-index', label: 'Full Index', description: 'The whole projected graph for the chosen scope.' },
];

export const EMPTY_GRAPH_STATS: GraphStats = {
    totalNodes: 0,
    totalLinks: 0,
    kindCounts: {},
    typeCounts: {},
};

const ENTITY_KINDS = new Set([
    'CHARACTER', 'NPC', 'CREATURE', 'LOCATION', 'FACTION', 'ORGANIZATION',
    'NETWORK', 'ITEM', 'CONCEPT', 'CUSTOM', 'UNKNOWN',
]);

const CONTEXT_KINDS = new Set(['CONTEXT', 'CONTEXT_ISLAND', 'ISLAND', 'BRIDGE', 'SEMANTIC', 'CLUSTER']);
const TIMELINE_KINDS = new Set(['EVENT', 'STATE', 'SCENE', 'BEAT', 'TIMELINE', 'TEMPORAL', 'CAUSE']);
const EVIDENCE_KINDS = new Set(['CLAIM', 'EVIDENCE', 'FACT', 'STATE', 'EVENT', 'SOURCE', 'PROVENANCE']);
const STRUCTURE_KINDS = new Set(['NOTE', 'DOCUMENT', 'FOLDER', 'NARRATIVE', 'CHAPTER', 'ACT', 'BLOCK', 'LINE']);

const CONTEXT_EDGE = /(CONTEXT|ISLAND|BRIDGE|SEMANTIC|NEIGHBOR|SIMILAR)/i;
const TIMELINE_EDGE = /(TEMPORAL|BEFORE|AFTER|CAUSE|CAUSAL|EVENT|STATE|PRECEDES|FOLLOWS)/i;
const EVIDENCE_EDGE = /(SUPPORT|CONTRADICT|EVIDENCE|CLAIM|ASSERT|PROVENANCE|SOURCE)/i;
const STRUCTURE_EDGE = /(CONTAINS|PART|PARENT|CHILD|FOLDER|NOTE|DOCUMENT|BLOCK|LINE|MENTION)/i;

export function cloneGraphData(data: ForceGraphData): ForceGraphData {
    return {
        nodes: data.nodes.map((node) => ({ ...node })),
        links: data.links.map((link) => ({
            ...link,
            source: endpointId(link.source),
            target: endpointId(link.target),
        })),
        stats: data.stats ? cloneStats(data.stats) : computeGraphStats(data.nodes, data.links),
    };
}

export function applyGraphLens(data: ForceGraphData, lens: GraphWorkbenchLens): ForceGraphData {
    const cloned = cloneGraphData(data);
    if (lens === 'full-index') {
        return { ...cloned, stats: computeGraphStats(cloned.nodes, cloned.links) };
    }

    const kindMatches = kindMatcher(lens);
    const edgeMatches = edgeMatcher(lens);
    const selectedIds = new Set<string>();
    const links: GraphLink[] = [];

    for (const node of cloned.nodes) {
        if (kindMatches(normalizedKind(node))) {
            selectedIds.add(node.id);
        }
    }

    for (const link of cloned.links) {
        const source = endpointId(link.source);
        const target = endpointId(link.target);
        if (edgeMatches(String(link.type || ''))) {
            selectedIds.add(source);
            selectedIds.add(target);
            links.push(link);
        }
    }

    const nodes = cloned.nodes.filter((node) => selectedIds.has(node.id));
    const nodeSet = new Set(nodes.map((node) => node.id));
    const keptLinks = links.length
        ? links.filter((link) => nodeSet.has(endpointId(link.source)) && nodeSet.has(endpointId(link.target)))
        : cloned.links.filter((link) => nodeSet.has(endpointId(link.source)) && nodeSet.has(endpointId(link.target)));

    return { nodes, links: keptLinks, stats: computeGraphStats(nodes, keptLinks) };
}

export function filterGraphData(data: ForceGraphData, query: string): ForceGraphData {
    const term = query.trim().toLowerCase();
    if (!term) {
        return cloneGraphData(data);
    }

    const nodeIds = new Set<string>();
    const links: GraphLink[] = [];

    for (const node of data.nodes) {
        if (nodeSearchText(node).includes(term)) {
            nodeIds.add(node.id);
        }
    }

    for (const link of data.links) {
        const source = endpointId(link.source);
        const target = endpointId(link.target);
        if (String(link.type || '').toLowerCase().includes(term) || nodeIds.has(source) || nodeIds.has(target)) {
            nodeIds.add(source);
            nodeIds.add(target);
            links.push({ ...link, source, target });
        }
    }

    const nodes = data.nodes.filter((node) => nodeIds.has(node.id)).map((node) => ({ ...node }));
    return { nodes, links, stats: computeGraphStats(nodes, links) };
}

export function computeGraphStats(nodes: GraphNode[], links: GraphLink[]): GraphStats {
    const kindCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};

    for (const node of nodes) {
        const kind = normalizedKind(node);
        kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    }
    for (const link of links) {
        const type = String(link.type || 'RELATED_TO').toUpperCase();
        typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    return { totalNodes: nodes.length, totalLinks: links.length, kindCounts, typeCounts };
}

export function endpointId(endpoint: unknown): string {
    if (typeof endpoint === 'string') {
        return endpoint;
    }
    if (endpoint && typeof endpoint === 'object' && 'id' in endpoint) {
        return String((endpoint as { id: unknown }).id);
    }
    return String(endpoint || '');
}

export function graphRecordRows(record: Record<string, unknown>, limit = 16): Array<{ key: string; value: string }> {
    return Object.entries(record)
        .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'function')
        .slice(0, limit)
        .map(([key, value]) => ({ key, value: formatGraphValue(value) }));
}

function kindMatcher(lens: GraphWorkbenchLens): (kind: string) => boolean {
    if (lens === 'entities') return (kind) => ENTITY_KINDS.has(kind);
    if (lens === 'context') return (kind) => CONTEXT_KINDS.has(kind);
    if (lens === 'timeline') return (kind) => TIMELINE_KINDS.has(kind);
    if (lens === 'evidence') return (kind) => EVIDENCE_KINDS.has(kind);
    if (lens === 'structure') return (kind) => STRUCTURE_KINDS.has(kind);
    return () => true;
}

function edgeMatcher(lens: GraphWorkbenchLens): (type: string) => boolean {
    if (lens === 'context') return (type) => CONTEXT_EDGE.test(type);
    if (lens === 'timeline') return (type) => TIMELINE_EDGE.test(type);
    if (lens === 'evidence') return (type) => EVIDENCE_EDGE.test(type);
    if (lens === 'structure') return (type) => STRUCTURE_EDGE.test(type);
    return () => false;
}

function normalizedKind(node: GraphNode): string {
    return String(node.kind || 'UNKNOWN').toUpperCase();
}

function nodeSearchText(node: GraphNode): string {
    return `${node.id} ${node.name || ''} ${node.kind || ''} ${node.narrativeId || ''}`.toLowerCase();
}

function cloneStats(stats: GraphStats): GraphStats {
    return {
        totalNodes: stats.totalNodes,
        totalLinks: stats.totalLinks,
        kindCounts: { ...stats.kindCounts },
        typeCounts: { ...stats.typeCounts },
    };
}

function formatGraphValue(value: unknown): string {
    if (typeof value === 'string') {
        return value.length > 120 ? `${value.slice(0, 117)}...` : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => formatGraphValue(item)).join(', ');
    }
    try {
        const encoded = JSON.stringify(value);
        return encoded.length > 120 ? `${encoded.slice(0, 117)}...` : encoded;
    } catch {
        return String(value);
    }
}
