export type AtlasLedgerGroupId =
    | 'scope'
    | 'registry'
    | 'committedGraph'
    | 'semanticAtlas'
    | 'graphAudit';

export type AtlasLedgerAvailability = 'available' | 'unavailable' | 'warning';

export interface AtlasLedgerCounts {
    notes: number;
    registryEntities: number | null;
    committedVertices: number | null;
    graphLeaves: number | null;
    evidenceEdges: number | null;
    embeddingVectors: number | null;
    issues: number | null;
}

export interface AtlasLedgerMetric {
    id: string;
    groupId: AtlasLedgerGroupId;
    label: string;
    value: number | null;
    source: string;
    scope: string;
    explanation: string;
    availability: AtlasLedgerAvailability;
}

export interface AtlasLedgerGroup {
    id: AtlasLedgerGroupId;
    title: string;
    subtitle: string;
    metrics: AtlasLedgerMetric[];
}

export interface AtlasRenderedKindCount {
    kind: string;
    count: number;
}

export interface AtlasCountReconciliationInput {
    committedVertices: number | null;
    committedEvidenceEdges: number | null;
    committedLeaves: number | null;
    renderedVertices: number;
    renderedLinks: number;
    renderedKinds: AtlasRenderedKindCount[];
    sourceLabel: string;
}

export interface AtlasCountReconciliation {
    sourceLabel: string;
    committed: {
        vertices: number | null;
        evidenceEdges: number | null;
        leaves: number | null;
    };
    rendered: {
        vertices: number;
        links: number;
        kindSummary: string;
    };
}

export function buildAtlasLedgerGroups(counts: AtlasLedgerCounts, scopeLabel: string): AtlasLedgerGroup[] {
    return [
        {
            id: 'scope',
            title: 'Scope',
            subtitle: 'Command input',
            metrics: [
                metric('scopeNotes', 'scope', 'Scope notes', counts.notes, 'Dexie notes', scopeLabel, 'notes selected for recipes and search'),
            ],
        },
        {
            id: 'registry',
            title: 'Registry',
            subtitle: 'Entity source',
            metrics: [
                metric('registryEntities', 'registry', 'Registry entities', counts.registryEntities, 'Registry', 'workspace entity registry', 'canonical entities and aliases'),
            ],
        },
        {
            id: 'committedGraph',
            title: 'Committed Graph',
            subtitle: 'Backend rows',
            metrics: [
                metric('committedVertices', 'committedGraph', 'Committed vertices', counts.committedVertices, 'Committed Graph', 'graph audit', 'stored graph vertex rows'),
                metric('evidenceEdges', 'committedGraph', 'Committed evidence edges', counts.evidenceEdges, 'Committed Graph', 'graph audit', 'stored evidence edge rows'),
                metric('graphLeaves', 'committedGraph', 'Graph leaves', counts.graphLeaves, 'Committed Graph', 'graph audit', 'stored leaf/chunk vertices'),
            ],
        },
        {
            id: 'semanticAtlas',
            title: 'Semantic Atlas',
            subtitle: 'Embedding sidecar',
            metrics: [
                metric('embeddingVectors', 'semanticAtlas', 'Embedding vectors', counts.embeddingVectors, 'Semantic Atlas', 'last semantic atlas run', 'leaf, entity, and lens vectors'),
            ],
        },
        {
            id: 'graphAudit',
            title: 'Graph Audit',
            subtitle: 'Health',
            metrics: [
                metric('issues', 'graphAudit', 'Issues', counts.issues, 'Graph Audit', 'orphan + duplicate checks', 'records requiring review', (counts.issues || 0) > 0 ? 'warning' : undefined),
            ],
        },
    ];
}

export function flattenAtlasLedgerGroups(groups: AtlasLedgerGroup[]): AtlasLedgerMetric[] {
    return groups.flatMap((group) => group.metrics);
}

export function buildAtlasCountReconciliation(input: AtlasCountReconciliationInput): AtlasCountReconciliation {
    return {
        sourceLabel: input.sourceLabel,
        committed: {
            vertices: input.committedVertices,
            evidenceEdges: input.committedEvidenceEdges,
            leaves: input.committedLeaves,
        },
        rendered: {
            vertices: input.renderedVertices,
            links: input.renderedLinks,
            kindSummary: summarizeRenderedKinds(input.renderedKinds),
        },
    };
}

export function summarizeRenderedKinds(kinds: AtlasRenderedKindCount[], limit = 4): string {
    const summary = kinds
        .filter((kind) => Number.isFinite(kind.count) && kind.count > 0)
        .slice(0, limit)
        .map((kind) => `${kind.count.toLocaleString()} ${kind.kind}`);
    return summary.length ? summary.join(' / ') : 'no rendered kind buckets';
}

function metric(
    id: string,
    groupId: AtlasLedgerGroupId,
    label: string,
    value: number | null,
    source: string,
    scope: string,
    explanation: string,
    availability?: AtlasLedgerAvailability,
): AtlasLedgerMetric {
    return {
        id,
        groupId,
        label,
        value,
        source,
        scope,
        explanation,
        availability: availability || (value === null ? 'unavailable' : 'available'),
    };
}
