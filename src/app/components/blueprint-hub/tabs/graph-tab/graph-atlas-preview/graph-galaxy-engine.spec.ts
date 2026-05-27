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

    it('keeps NER provenance from overriding canonical entity-kind colors', () => {
        entityColorStore.setColor('NETWORK', '0 100% 50%');
        try {
            const node: GalaxyRenderableNode = {
                id: 'network:joint-chiefs',
                label: 'Joint Chiefs',
                kind: 'NETWORK',
                colorHsl: '0 0% 80%',
                metadata: { sourceSystem: 'dynamic-ner' },
            };

            expect(resolveGalaxyNodeColorHsl(node)).toBe('0 100% 50%');
        } finally {
            entityColorStore.reset();
        }
    });

    it('resolves embedding target family colors from graph metadata before stale snapshots', () => {
        entityColorStore.setColor('ITEM', '0 100% 50%');
        try {
            const scene = buildGalaxyScene([
                {
                    id: 'embed:entity:phantom-work',
                    label: 'Phantom work',
                    kind: 'entity',
                    colorHsl: '282 70% 62%',
                    metadata: {
                        graphRebuildEmbeddingTarget: true,
                        graphColorKind: 'item',
                        graphKind: 'item',
                    },
                },
            ], [], mergeGalaxySettings({ layoutMode: 'productManifold' }));

            expect(scene.nodes[0].r).toBe(255);
            expect(scene.nodes[0].g).toBe(0);
            expect(scene.nodes[0].b).toBe(0);
        } finally {
            entityColorStore.reset();
        }
    });

    it('keeps graph node colors from being overridden by contextual entity kinds', () => {
        entityColorStore.setColor('CHARACTER', '0 100% 50%');
        entityColorStore.setGraphNodeColor('eventNode', '120 100% 50%');
        entityColorStore.setGraphNodeColor('cooccurrence', '240 100% 50%');
        try {
            const scene = buildGalaxyScene([
                {
                    id: 'embed:event:e1',
                    label: 'Kai enters',
                    kind: 'event',
                    metadata: {
                        entityKind: 'CHARACTER',
                        graphColorKind: 'event',
                        graphKind: 'event',
                        graphRebuildEmbeddingTarget: true,
                    },
                },
                {
                    id: 'embed:graph-fact:co1',
                    label: 'Kai co_occurs_with Hazel',
                    kind: 'graph-fact',
                    metadata: {
                        entityKind: 'CHARACTER',
                        graphColorKind: 'cooccurrence',
                        graphRelationFamily: 'cooccurrence',
                        graphKind: 'graph-fact',
                        graphRebuildEmbeddingTarget: true,
                    },
                },
            ], [], mergeGalaxySettings({ layoutMode: 'productManifold' }));

            expect(scene.nodes.find((node) => node.entity.id === 'embed:event:e1')).toMatchObject({ r: 0, g: 255, b: 0 });
            expect(scene.nodes.find((node) => node.entity.id === 'embed:graph-fact:co1')).toMatchObject({ r: 0, g: 0, b: 255 });
        } finally {
            entityColorStore.reset();
        }
    });
});

describe('Graph galaxy hybrid hierarchy', () => {
    it('keeps Hybrid as the same shell while promoting broad documents inward from concrete evidence', () => {
        const scene = buildGalaxyScene([
            hybridNode('doc-root', 'Red Mesa', 'doc', 'note', 1, 0.1, 0, { lane: 'document', specificity: 0.24, ambiguity: 0.3, level: 0 }),
            hybridNode('chunk-leaf', 'Claimant mark', 'leaf', 'chunk', 1, 0.1, 0, { lane: 'document', specificity: 0.93, ambiguity: 0.02, level: 4 }),
        ], [], mergeGalaxySettings({ layoutMode: 'hybridSpace' }));
        const doc = scene.nodes.find((node) => node.entity.id === 'doc-root')!;
        const chunk = scene.nodes.find((node) => node.entity.id === 'chunk-leaf')!;

        expect(scene.layoutMode).toBe('hybridSpace');
        expect(hybridRadiusOf(doc)).toBeLessThan(hybridRadiusOf(chunk) - 0.08);
        expect(hybridRadiusOf(chunk)).toBeGreaterThan(0.96);
    });

    it('gives temporal and causal facts typed directions without leaving the Hybrid lane', () => {
        const scene = buildGalaxyScene([
            hybridNode('time-1', 'Before the tower pull', 'graph-fact', 'temporal-fact', 1, 0, 0, { lane: 'temporal', specificity: 0.78, ambiguity: 0.04, phase: 0.25, level: 2 }),
            hybridNode('cause-1', 'Signal causes recall', 'graph-fact', 'causal-fact', 0, 0, 1, { lane: 'causal', specificity: 0.74, ambiguity: 0.04, phase: 0.5, level: 3 }),
        ], [{ id: 'causal-link', sourceId: 'time-1', targetId: 'cause-1', type: 'causal', confidence: 0.9 }], mergeGalaxySettings({ layoutMode: 'hybridSpace' }));
        const temporal = scene.nodes.find((node) => node.entity.id === 'time-1')!;
        const causal = scene.nodes.find((node) => node.entity.id === 'cause-1')!;

        expect(scene.layoutMode).toBe('hybridSpace');
        expect(Math.abs(temporal.y / Math.hypot(temporal.x, temporal.y, temporal.z))).toBeLessThan(0.28);
        expect(causal.x).toBeGreaterThan(0.35);
        expect(scene.links[0].alpha).toBeGreaterThan(0.1);
    });
});

function stable(index: number, salt: number): number {
    return (((index * 37 + salt * 17) % 101) / 50) - 1;
}

function hybridRadiusOf(node: { x: number; y: number; z: number }): number {
    return Math.hypot(node.x, node.y, node.z) / 2.32;
}

function hybridNode(
    id: string,
    label: string,
    sourceType: string,
    kind: string,
    atlasX: number,
    atlasY: number,
    atlasZ: number,
    hierarchy: { lane: string; specificity: number; ambiguity: number; phase?: number; level: number },
): GalaxyRenderableNode {
    return {
        id,
        label,
        kind,
        totalMentions: 1,
        atlasX,
        atlasY,
        atlasZ,
        metadata: {
            sourceType,
            productLaneKind: hierarchy.lane,
            graphKind: kind,
            graphRelationFamily: hierarchy.lane === 'temporal' || hierarchy.lane === 'causal' ? hierarchy.lane : undefined,
            lorentz: {
                dominantLane: hierarchy.lane,
                specificity: hierarchy.specificity,
                ambiguity: hierarchy.ambiguity,
                capPhase: hierarchy.phase ?? 0,
                level: hierarchy.level,
            },
        },
    };
}
