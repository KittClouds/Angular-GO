import { describe, expect, it } from 'vitest';

import {
    buildGalaxyScene,
    mergeGalaxySettings,
    resolveGalaxyNodeColorHsl,
    type GalaxyInputEdge,
    type GalaxyRenderableNode,
} from './graph-galaxy-engine';
import { entityColorStore } from '../../../../../lib/store/entityColorStore';

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

describe('Graph galaxy canonical colors', () => {
    it('resolves entity node colors from Style Lab even when nodes carry stale HSL snapshots', () => {
        entityColorStore.setColor('LOCATION', '0 100% 50%');
        try {
            const scene = buildGalaxyScene([
                {
                    id: 'embed:anchor:baton-rouge',
                    label: 'Baton Rouge',
                    kind: 'anchor',
                    colorHsl: '200 75% 55%',
                    metadata: { entityKind: 'location' },
                },
            ], [], mergeGalaxySettings({ layoutMode: 'single' }));

            expect(scene.nodes[0].r).toBe(255);
            expect(scene.nodes[0].g).toBe(0);
            expect(scene.nodes[0].b).toBe(0);
        } finally {
            entityColorStore.reset();
        }
    });

    it('resolves provenance node colors from Style Lab source colors', () => {
        entityColorStore.setSourceColor('dynamic_ner', '120 100% 50%');
        try {
            const node: GalaxyRenderableNode = {
                id: 'source:ner',
                label: 'NER Source',
                kind: 'source',
                colorHsl: '0 0% 80%',
                metadata: { sourceSystem: 'dynamic-ner' },
            };

            expect(resolveGalaxyNodeColorHsl(node)).toBe('120 100% 50%');
        } finally {
            entityColorStore.reset();
        }
    });
});

function stable(index: number, salt: number): number {
    return (((index * 37 + salt * 17) % 101) / 50) - 1;
}
