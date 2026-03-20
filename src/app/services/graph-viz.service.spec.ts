import { describe, expect, it } from 'vitest';

import { GraphVizService } from './graph-viz.service';

describe('GraphVizService fromKnowledgeGraph', () => {
    it('transforms graphstore data and filters orphan edges', () => {
        const service = new GraphVizService();

        const result = service.fromKnowledgeGraph({
            nodes: {
                'char-ryan': { id: 'char-ryan', kind: 'CHARACTER', label: 'Ryan' },
                'char-len': { id: 'char-len', kind: 'CHARACTER', label: 'Len' },
            },
            edges: [
                { source: 'char-ryan', target: 'char-len', relation: 'KNOWS', weight: 0.8 },
                { source: 'char-ryan', target: 'missing-node', relation: 'VISITS', weight: 0.2 },
            ],
        });

        expect(result.nodes).toHaveLength(2);
        expect(result.links).toHaveLength(1);
        expect(result.stats).toEqual({
            totalNodes: 2,
            totalLinks: 1,
            kindCounts: { CHARACTER: 2 },
            typeCounts: { KNOWS: 1, VISITS: 1 },
        });
        expect(result.nodes[0].color).toMatch(/^#/);
        expect(result.links[0]).toMatchObject({
            source: 'char-ryan',
            target: 'char-len',
            type: 'KNOWS',
            value: 0.8,
        });
    });
});
