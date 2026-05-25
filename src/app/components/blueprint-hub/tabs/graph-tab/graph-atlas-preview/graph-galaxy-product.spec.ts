import { describe, expect, it } from 'vitest';

import { buildGalaxyScene, mergeGalaxySettings, type GalaxyInputEdge, type GalaxyRenderableNode } from './graph-galaxy-engine';

const productNodes: GalaxyRenderableNode[] = [
    productNode('kai', 'Kai', 0.28, 0, 'identity', null),
    productNode('echo', 'Echo', 0.64, 1, 'causal', 'kai'),
    productNode('ruby', 'Ruby', 0.82, 1, 'evidence', 'kai'),
];

const productEdges: GalaxyInputEdge[] = [
    { id: 'identity:kai:echo', sourceId: 'kai', targetId: 'echo', type: 'lorentz-tree:identity', confidence: 0.9 },
    { id: 'causal:kai:ruby', sourceId: 'kai', targetId: 'ruby', type: 'lorentz-tree:causal', confidence: 0.85 },
];

describe('Product manifold galaxy visualization data', () => {
    it('keeps Lorentz skeleton positions while adding Hopf ribbon guide data', () => {
        const scene = buildGalaxyScene(productNodes, productEdges, mergeGalaxySettings({ layoutMode: 'productManifold' }));

        expect(scene.layoutMode).toBe('productManifold');
        expect(scene.lorentzGuides?.length).toBeGreaterThan(3);
        expect(scene.hopfRibbons?.length).toBeGreaterThan(20);
        expect(scene.nodes.every((node) => Math.hypot(node.x, node.y, node.z) <= 2.4)).toBe(true);
        expect(new Set(scene.lorentzGuides?.map((guide) => guide.guideKind))).toContain('levelShell');
        expect(new Set(scene.hopfRibbons?.map((ribbon) => ribbon.guideKind))).toContain('dataFiber');
    });

    it('derives Product entity fibers from evidence context samples without rendering extra nodes', () => {
        const nodes: GalaxyRenderableNode[] = [
            graphTargetNode('embed:entity:kai', 'Kai', 'entity', 'kai'),
            graphTargetNode('embed:anchor:a1', 'Kai in Baton Rouge', 'anchor', 'a1', 'kai'),
            graphTargetNode('embed:event:e1', 'Kai opens the Red Mesa board', 'event', 'e1', 'kai'),
            graphTargetNode('embed:graph-fact:r1', 'Kai trusts Cael', 'graph-fact', 'r1', 'kai'),
            graphTargetNode('embed:memory:m1', 'Kai remains cautious', 'memory-state', 'm1', 'kai'),
            graphTargetNode('embed:causalFact:c1', 'Red Mesa pulse changes route', 'causal-fact', 'c1', 'kai'),
            graphTargetNode('embed:graph-fact:co1', 'Kai co_occurs_with Cael', 'graph-fact', 'co1', 'kai'),
            graphTargetNode('embed:graph-fact:ob1', 'Kai observes Cael', 'graph-fact', 'ob1', 'kai'),
            graphTargetNode('embed:graph-fact:cm1', 'Kai comments on Cael', 'graph-fact', 'cm1', 'kai'),
        ];
        const edges: GalaxyInputEdge[] = [
            { id: 'anchor-entity:a1', sourceId: 'embed:anchor:a1', targetId: 'embed:entity:kai', type: 'anchor-entity', confidence: 0.92 },
            { id: 'event-entity:e1:kai', sourceId: 'embed:event:e1', targetId: 'embed:entity:kai', type: 'event-entity', confidence: 0.82 },
            { id: 'fact-source:r1', sourceId: 'embed:graph-fact:r1', targetId: 'embed:entity:kai', type: 'trusts', confidence: 0.78 },
            { id: 'memory-entity:m1', sourceId: 'embed:memory:m1', targetId: 'embed:entity:kai', type: 'memory-entity', confidence: 0.72 },
            { id: 'causal-source:c1', sourceId: 'embed:causalFact:c1', targetId: 'embed:event:e1', type: 'causes', confidence: 0.8 },
            { id: 'fact-source:co1', sourceId: 'embed:graph-fact:co1', targetId: 'embed:entity:kai', type: 'co_occurs_with', confidence: 0.62 },
            { id: 'fact-source:ob1', sourceId: 'embed:graph-fact:ob1', targetId: 'embed:entity:kai', type: 'observes', confidence: 0.64 },
            { id: 'fact-source:cm1', sourceId: 'embed:graph-fact:cm1', targetId: 'embed:entity:kai', type: 'comments_on', confidence: 0.66 },
        ];

        const scene = buildGalaxyScene(nodes, edges, mergeGalaxySettings({ layoutMode: 'productManifold' }));
        const entityRibbon = scene.hopfRibbons?.find((ribbon) =>
            ribbon.guideKind === 'dataFiber'
            && ribbon.nodeIds.includes('embed:entity:kai')
            && ribbon.nodeIds.some((id) => id.startsWith('product:context:embed:entity:kai')),
        );
        const relationGuides = scene.lorentzGuides?.filter((guide) => guide.id.startsWith('lorentz:product-guide:')) ?? [];
        const relationKinds = new Set(relationGuides.map((guide) => guide.treeKind));

        expect(entityRibbon).toBeTruthy();
        expect(entityRibbon?.nodeIds.some((id) => id.includes('anchor-entity:a1'))).toBe(true);
        expect(entityRibbon?.nodeIds.some((id) => id.includes('event-entity:e1:kai'))).toBe(true);
        expect(scene.nodes.some((node) => node.entity.id.startsWith('product:context:'))).toBe(false);
        expect(relationGuides.length).toBe(8);
        expect(relationKinds.has('documentStructure')).toBe(true);
        expect(relationKinds.has('event')).toBe(true);
        expect(relationKinds.has('relationship')).toBe(true);
        expect(relationKinds.has('evidence')).toBe(true);
        expect(relationKinds.has('causal')).toBe(true);
        expect(relationKinds.has('cooccurrence')).toBe(true);
        expect(relationKinds.has('observation')).toBe(true);
        expect(relationKinds.has('communication')).toBe(true);
        expect(relationGuides.every((guide) => guide.positions3d.length > 0)).toBe(true);
    });

    it('uses embedding topology as a selectable lens without merging nodes', () => {
        const nodes: GalaxyRenderableNode[] = [
            topologyNode('embed:entity:kai', 'Kai', 'embedding-cluster:0', 'embed:entity:kai', 0.1, 0.9),
            topologyNode('embed:entity:rowan', 'Rowan', 'embedding-cluster:0', 'embed:entity:kai', 0.2, 0.4),
            topologyNode('embed:entity:rook', 'Rook', 'embedding-cluster:1', 'embed:entity:rook', 0.84, 0.2),
        ];
        const edges: GalaxyInputEdge[] = [
            { id: 'embedding-backbone:kai:rowan', sourceId: 'embed:entity:kai', targetId: 'embed:entity:rowan', type: 'embedding-backbone', confidence: 0.84 },
            { id: 'embedding-bridge:rowan:rook', sourceId: 'embed:entity:rowan', targetId: 'embed:entity:rook', type: 'embedding-bridge', confidence: 0.72 },
        ];

        const medoids = buildGalaxyScene(nodes, edges, mergeGalaxySettings({ embeddingTopologyMode: 'medoids' }));
        const outliers = buildGalaxyScene(nodes, edges, mergeGalaxySettings({ embeddingTopologyMode: 'outliers' }));
        const backbone = buildGalaxyScene(nodes, edges, mergeGalaxySettings({ embeddingTopologyMode: 'backbone' }));
        const regions = buildGalaxyScene(nodes, edges, mergeGalaxySettings({ embeddingTopologyMode: 'regions' }));
        const lanes = buildGalaxyScene(nodes, edges, mergeGalaxySettings({ embeddingTopologyMode: 'lanes' }));

        expect(medoids.nodes.find((node) => node.entity.id === 'embed:entity:kai')?.radius)
            .toBeGreaterThan(medoids.nodes.find((node) => node.entity.id === 'embed:entity:rowan')?.radius || 0);
        expect(outliers.nodes.find((node) => node.entity.id === 'embed:entity:rook')?.radius)
            .toBeGreaterThan(outliers.nodes.find((node) => node.entity.id === 'embed:entity:rowan')?.radius || 0);
        expect(backbone.links.find((edge) => edge.type === 'embedding-backbone')?.alpha)
            .toBeGreaterThan(backbone.links.find((edge) => edge.type === 'embedding-bridge')?.alpha || 0);
        expect(regions.nodes.find((node) => node.entity.id === 'embed:entity:rook')?.radius)
            .toBeGreaterThan(regions.nodes.find((node) => node.entity.id === 'embed:entity:rowan')?.radius || 0);
        expect(lanes.nodes.some((node) => node.r !== medoids.nodes.find((other) => other.entity.id === node.entity.id)?.r)).toBe(true);
        expect(new Set(backbone.nodes.map((node) => node.entity.id)).size).toBe(3);
    });

    it('turns Product topology regions into layout pressure', () => {
        const nodes: GalaxyRenderableNode[] = [
            topologyNode('embed:entity:kai', 'Kai', 'embedding-cluster:0', 'embed:entity:kai', 0.1, 0.9),
            topologyNode('embed:entity:rowan', 'Rowan', 'embedding-cluster:0', 'embed:entity:kai', 0.2, 0.4),
            topologyNode('embed:entity:rook', 'Rook', 'embedding-cluster:1', 'embed:entity:rook', 0.84, 0.2),
        ];
        const edges: GalaxyInputEdge[] = [
            { id: 'embedding-backbone:kai:rowan', sourceId: 'embed:entity:kai', targetId: 'embed:entity:rowan', type: 'embedding-backbone', confidence: 0.84 },
            { id: 'embedding-bridge:rowan:rook', sourceId: 'embed:entity:rowan', targetId: 'embed:entity:rook', type: 'embedding-bridge', confidence: 0.72 },
        ];

        const baseline = buildGalaxyScene(nodes.map(stripTopology), edges, mergeGalaxySettings({ layoutMode: 'productManifold' }));
        const scene = buildGalaxyScene(nodes, edges, mergeGalaxySettings({ layoutMode: 'productManifold' }));
        const core = scene.nodes.find((node) => node.entity.id === 'embed:entity:kai')!;
        const outlier = scene.nodes.find((node) => node.entity.id === 'embed:entity:rook')!;
        const baselineOutlier = baseline.nodes.find((node) => node.entity.id === 'embed:entity:rook')!;
        const backboneEdge = scene.links.find((edge) => edge.type === 'embedding-backbone')!;
        const bridgeEdge = scene.links.find((edge) => edge.type === 'embedding-bridge')!;

        expect(Math.hypot(outlier.x, outlier.y, outlier.z)).toBeGreaterThan(Math.hypot(baselineOutlier.x, baselineOutlier.y, baselineOutlier.z));
        expect(outlier.radius).toBeLessThan(core.radius);
        expect(backboneEdge.curve).toBeLessThan(bridgeEdge.curve);
        expect(backboneEdge.alpha).toBeGreaterThan(bridgeEdge.alpha * 0.7);
    });
});

function productNode(
    id: string,
    label: string,
    radius: number,
    level: number,
    fiberKind: string,
    parentNodeId: string | null,
): GalaxyRenderableNode {
    return {
        id,
        label,
        kind: 'PRODUCT:NODE',
        totalMentions: 4,
        atlasX: radius,
        atlasY: radius * 0.2,
        atlasZ: radius * 0.35,
        metadata: {
            sourceType: 'product_node',
            hopf: { role: 'anchor', baseId: id, fiberKind, phase: radius },
            lorentz: {
                klein: [radius, radius * 0.2, radius * 0.35, 0],
                level,
                primaryTreeKind: fiberKind,
                memberships: [{
                    treeId: fiberKind,
                    treeKind: fiberKind,
                    parentNodeId,
                    level,
                    pathKey: parentNodeId ? `${fiberKind}/${parentNodeId}/${id}` : `${fiberKind}/${id}`,
                }],
            },
        },
    };
}

function graphTargetNode(
    id: string,
    label: string,
    sourceType: string,
    sourceId: string,
    sourceEntityId?: string,
): GalaxyRenderableNode {
    return {
        id,
        label,
        kind: sourceType,
        totalMentions: 2,
        atlasX: sourceType === 'entity' ? 0.32 : 0.72,
        atlasY: sourceType === 'event' ? 0.28 : 0.12,
        atlasZ: sourceType === 'anchor' ? 0.44 : 0.18,
        metadata: {
            sourceType,
            sourceId,
            sourceEntityId,
            manifold: 'product',
            graphRebuildEmbeddingTarget: true,
            preview: `${sourceType} context for ${label}`,
            lorentz: {
                level: sourceType === 'entity' ? 0 : 1,
                memberships: [{
                    treeId: 'identity',
                    treeKind: 'identity',
                    parentNodeId: sourceType === 'entity' ? null : 'embed:entity:kai',
                    level: sourceType === 'entity' ? 0 : 1,
                    pathKey: `identity/${id}`,
                }],
            },
        },
    };
}

function topologyNode(
    id: string,
    label: string,
    clusterId: string,
    medoidTargetId: string,
    outlierScore: number,
    hubScore: number,
): GalaxyRenderableNode {
    return {
        id,
        label,
        kind: 'entity',
        totalMentions: 3,
        metadata: {
            embeddingClusterId: clusterId,
            embeddingMedoidTargetId: medoidTargetId,
            embeddingOutlierScore: outlierScore,
            embeddingHubScore: hubScore,
            productRegionRole: outlierScore >= 0.72 ? 'outlier' : id === medoidTargetId ? 'core' : 'boundary',
            productLaneKind: id.includes('rook') ? 'document' : 'entity',
            product: {
                lanes: {
                    laneWeights: {
                        semantic: 0.5,
                        document: id.includes('rook') ? 0.9 : 0.2,
                        relation: 0.2,
                        temporal: 0.1,
                        causal: 0.1,
                        evidence: 0.2,
                        entity: id.includes('rook') ? 0.2 : 0.8,
                    },
                },
            },
        },
    };
}

function stripTopology(node: GalaxyRenderableNode): GalaxyRenderableNode {
    const metadata = { ...(node.metadata || {}) };
    delete metadata['embeddingMedoidTargetId'];
    delete metadata['productRegionRole'];
    delete metadata['productLaneKind'];
    delete metadata['product'];
    return { ...node, metadata };
}
