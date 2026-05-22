import { describe, expect, it } from 'vitest';

import {
    buildGalaxyScene,
    mergeGalaxySettings,
    type GalaxyInputEdge,
    type GalaxyRenderableNode,
} from './graph-galaxy-engine';

describe('Graph galaxy scene prioritization', () => {
    it('keeps entity nodes and their edges when chunk evidence floods a graph snapshot', () => {
        const entities = Array.from({ length: 21 }, (_, index) => ({
            id: `entity-${index}`,
            label: index === 0 ? 'Aris' : `Character ${index}`,
            kind: 'CHARACTER',
            totalMentions: 1,
            atlasX: stable(index, 0),
            atlasY: stable(index, 1),
            atlasZ: stable(index, 2),
            metadata: {
                sourceType: 'graph-rebuild',
                graphKind: 'entity',
                sourceEntityId: `entity-${index}`,
            },
        } satisfies GalaxyRenderableNode));
        const chunks = Array.from({ length: 478 }, (_, index) => ({
            id: `chunk-${index}`,
            label: `Chunk ${index + 1}`,
            kind: 'chunk',
            totalMentions: 1,
            atlasX: stable(index + 1000, 0),
            atlasY: stable(index + 1000, 1),
            atlasZ: stable(index + 1000, 2),
            metadata: {
                sourceType: 'graph-rebuild',
                graphKind: 'chunk',
            },
        } satisfies GalaxyRenderableNode));
        const edges: GalaxyInputEdge[] = [
            { id: 'rel-0-1', sourceId: 'entity-0', targetId: 'entity-1', type: 'anchored-cooccurrence', confidence: 0.9 },
            { id: 'anchor-0', sourceId: 'chunk-0', targetId: 'entity-0', type: 'entity_anchor', confidence: 0.8 },
        ];

        const scene = buildGalaxyScene([...entities, ...chunks], edges, mergeGalaxySettings({ layoutMode: 'single' }));

        expect(scene.nodes.filter((node) => String(node.entity.kind).toLowerCase() === 'character')).toHaveLength(21);
        expect(scene.links.map((link) => link.id)).toContain('rel-0-1');
    });
});

function stable(index: number, salt: number): number {
    return (((index * 37 + salt * 17) % 101) / 50) - 1;
}
