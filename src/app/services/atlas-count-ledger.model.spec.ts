import { describe, expect, it } from 'vitest';

import {
    buildAtlasCountReconciliation,
    buildAtlasLedgerGroups,
    flattenAtlasLedgerGroups,
    summarizeRenderedKinds,
} from './atlas-count-ledger.model';

describe('atlas count ledger model', () => {
    it('groups counts by source so graph is not one fuzzy number', () => {
        const groups = buildAtlasLedgerGroups({
            notes: 3,
            registryEntities: 9,
            committedVertices: 88,
            graphLeaves: 77,
            evidenceEdges: 96,
            embeddingVectors: null,
            issues: 4,
        }, 'Global');
        const metrics = flattenAtlasLedgerGroups(groups);

        expect(groups.map((group) => group.title)).toEqual([
            'Scope',
            'Registry',
            'Committed Graph',
            'Semantic Atlas',
            'Graph Audit',
        ]);
        expect(metrics.map((metric) => metric.label)).not.toContain('Graph');
        expect(metrics.find((metric) => metric.label === 'Embedding vectors')?.availability).toBe('unavailable');
        expect(metrics.find((metric) => metric.label === 'Issues')?.availability).toBe('warning');
    });

    it('keeps committed graph counts separate from rendered view counts', () => {
        const reconciliation = buildAtlasCountReconciliation({
            committedVertices: 88,
            committedEvidenceEdges: 96,
            committedLeaves: 77,
            renderedVertices: 209,
            renderedLinks: 227,
            renderedKinds: [
                { kind: 'leaf', count: 190 },
                { kind: 'document', count: 11 },
                { kind: 'entity', count: 8 },
            ],
            sourceLabel: 'Committed Graph Delta',
        });

        expect(reconciliation.committed.vertices).toBe(88);
        expect(reconciliation.rendered.vertices).toBe(209);
        expect(reconciliation.rendered.kindSummary).toBe('190 leaf / 11 document / 8 entity');
    });

    it('summarizes rendered kind buckets deterministically', () => {
        expect(summarizeRenderedKinds([
            { kind: 'leaf', count: 190 },
            { kind: 'document', count: 11 },
            { kind: 'entity', count: 8 },
            { kind: 'state', count: 2 },
            { kind: 'event', count: 1 },
        ])).toBe('190 leaf / 11 document / 8 entity / 2 state');
    });
});
