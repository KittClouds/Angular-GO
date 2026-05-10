import { describe, expect, it } from 'vitest';

import {
    buildGalaxyScene,
    mergeGalaxySettings,
    type GalaxyInputEdge,
    type GalaxyRenderableNode,
} from './graph-galaxy-engine';

const hopfNodes: GalaxyRenderableNode[] = [
    {
        id: 'hopf:anchor:kai',
        label: 'Kai',
        kind: 'HOPF_ANCHOR',
        atlasX: 0.7,
        atlasY: 0.2,
        atlasZ: 0.4,
        totalMentions: 8,
        metadata: { sourceType: 'hopf_anchor', hopf: { role: 'anchor', baseId: 'kai', phase: 0 } },
    },
    {
        id: 'hopf:fiber:kai:evidence',
        label: 'Kai evidence',
        kind: 'HOPF_FIBER:evidence',
        atlasX: 0.68,
        atlasY: 0.24,
        atlasZ: 0.38,
        totalMentions: 5,
        metadata: { sourceType: 'hopf_fiber', hopf: { role: 'fiber', baseId: 'kai', fiberKind: 'evidence', phase: 0.75 } },
    },
    {
        id: 'hopf:fiber:kai:causal',
        label: 'Kai causal',
        kind: 'HOPF_FIBER:causal',
        atlasX: 0.66,
        atlasY: 0.2,
        atlasZ: 0.42,
        totalMentions: 3,
        metadata: { sourceType: 'hopf_fiber', hopf: { role: 'fiber', baseId: 'kai', fiberKind: 'causal', phase: 0.64 } },
    },
];

const hopfEdges: GalaxyInputEdge[] = [
    { id: 'anchor-edge', sourceId: 'hopf:anchor:kai', targetId: 'hopf:fiber:kai:evidence', type: 'hopf-anchor-fiber', confidence: 0.9 },
    { id: 'fiber-edge', sourceId: 'hopf:fiber:kai:evidence', targetId: 'hopf:fiber:kai:causal', type: 'hopf-fiber-edge:causal', confidence: 0.8 },
];

describe('Hopf galaxy visualization data', () => {
    it('keeps Hopf projection deterministic while emitting rich guide geometry', () => {
        const settings = mergeGalaxySettings({ layoutMode: 'hopfProjection' });
        const first = buildGalaxyScene(hopfNodes, hopfEdges, settings);
        const second = buildGalaxyScene(hopfNodes, hopfEdges, settings);

        expect(first.layoutMode).toBe('hopfProjection');
        expect(first.nodes.map(positionOf)).toEqual(second.nodes.map(positionOf));
        expect(first.hopfRibbons?.length).toBeGreaterThan(40);
        expect(new Set(first.hopfRibbons?.map((ribbon) => ribbon.guideKind))).toEqual(new Set([
            'dataFiber',
            'spaceFiber',
            'torusBand',
            'axis',
        ]));
    });

    it('does not emit Hopf guide geometry for the hybrid universe', () => {
        const scene = buildGalaxyScene(hopfNodes, hopfEdges, mergeGalaxySettings({ layoutMode: 'hybridSpace' }));

        expect(scene.layoutMode).toBe('hybridSpace');
        expect(scene.hopfRibbons).toBeUndefined();
    });

    it('clamps Hopf visual intensity independently of hybrid shell opacity', () => {
        const high = mergeGalaxySettings({ hopfSpaceIntensity: 99, hybridShellOpacity: 2 });
        const low = mergeGalaxySettings({ hopfSpaceIntensity: -4, hybridShellOpacity: -3 });

        expect(high.hopfSpaceIntensity).toBe(1.4);
        expect(low.hopfSpaceIntensity).toBe(0);
        expect(high.hybridShellOpacity).toBe(1);
        expect(low.hybridShellOpacity).toBe(0);
        expect(mergeGalaxySettings().hopfSpaceVisible).toBe(true);
    });
});

function positionOf(node: { x: number; y: number; z: number }): [number, number, number] {
    return [
        Number(node.x.toFixed(6)),
        Number(node.y.toFixed(6)),
        Number(node.z.toFixed(6)),
    ];
}
