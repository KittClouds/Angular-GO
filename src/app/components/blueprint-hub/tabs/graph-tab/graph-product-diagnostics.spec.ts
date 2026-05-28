import { describe, expect, it } from 'vitest';

import type { RegisteredEntity } from '../../../../lib/registry';
import { buildProductDiagnosticsView } from './graph-product-diagnostics';

describe('Product diagnostics view', () => {
    it('surfaces selected target topology and rerank signals', () => {
        const entity = { id: 'kai', label: 'Kai', kind: 'CHARACTER', aliases: [] } as RegisteredEntity;
        const view = buildProductDiagnosticsView(snapshot(), entity)!;

        expect(view.selected).toMatchObject({
            label: 'Kai',
            targetId: 'embed:entity:kai',
            region: 'core',
            lane: 'entity',
            cluster: 'cluster:a',
            medoid: 'embed:entity:kai',
        });
        expect(view.selected?.laneWeights[0]).toEqual({ lane: 'entity', value: 0.9 });
        expect(view.suggestions[0]).toMatchObject({
            label: 'kai -> joint_chiefs',
            region: 'bridge',
            lane: 'mixed',
            signals: ['product_region:bridge', 'intent_lane:relation'],
        });
        expect(view.reviewClusters).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'entity-link',
                label: 'Alias family: Kai',
                count: 2,
                representativeCount: 2,
                action: 'Apply merge',
            }),
            expect.objectContaining({
                kind: 'graph-link',
                label: 'bridge review: serves',
                count: 2,
                conflicts: 1,
                action: 'Review family',
            }),
        ]));
    });
});

function snapshot(): any {
    return {
        id: 'snapshot:test',
        embeddingGraphPostProcess: {
            profile: { modelId: 'test', modelLabel: 'MDBR test', dimensionLabel: '384d' },
            targetCount: 2,
            vectorDimensions: 384,
            productTopologyRegions: [],
            targets: [{
                targetId: 'embed:entity:kai',
                clusterId: 'cluster:a',
                medoidTargetId: 'embed:entity:kai',
                outlierScore: 0.1,
                hubScore: 0.8,
                neighborCount: 4,
                productLaneFeatures: {
                    confidence: 0.7,
                    laneWeights: {
                        semantic: 0.4,
                        document: 0.2,
                        relation: 0.1,
                        temporal: 0.1,
                        causal: 0.1,
                        evidence: 0.2,
                        entity: 0.9,
                    },
                },
                productTopologyRegion: { id: 'region:a', role: 'core', laneKind: 'entity' },
            }],
            metrics: {
                clusterCount: 1,
                backboneEdgeCount: 0,
                bridgeEdgeCount: 1,
                outlierCount: 0,
            },
        },
        graphAwareLinkSuggestions: [{
            id: 's1',
            sourceEntityId: 'kai',
            targetEntityId: 'joint_chiefs',
            suggestedRelationType: 'serves',
            confidence: 0.8,
            rerankScore: 0.9,
            kind: 'bridge_review',
            semanticStatus: 'accepted',
            structuralRole: 'bridge',
            productRegionRole: 'bridge',
            productLane: 'mixed',
            rerankSignals: ['product_region:bridge', 'intent_lane:relation'],
            evidenceIds: [],
            rationale: [],
        }, {
            id: 's2',
            sourceEntityId: 'kai',
            targetEntityId: 'council',
            suggestedRelationType: 'serves',
            confidence: 0.6,
            rerankScore: 0.7,
            kind: 'bridge_review',
            semanticStatus: 'rejected',
            structuralRole: 'bridge',
            productRegionRole: 'cross_region',
            productLane: 'mixed',
            rerankSignals: ['semantic:conflict'],
            evidenceIds: [],
            rationale: [],
        }],
        entityLinkSuggestions: [{
            id: 'e1',
            surface: 'Kai',
            normalizedSurface: 'kai',
            candidateEntityId: 'kai',
            candidateLabel: 'Kai',
            candidateKind: 'CHARACTER',
            decision: 'alias_of',
            status: 'review',
            confidence: 0.8,
            rerankScore: 0.82,
            competingEntityIds: [],
            evidenceIds: [],
            rerankSignals: ['surface:alias'],
            rationale: [],
        }, {
            id: 'e2',
            surface: 'Kai',
            normalizedSurface: 'kai',
            candidateEntityId: 'kai',
            candidateLabel: 'Kai',
            candidateKind: 'CHARACTER',
            decision: 'alias_of',
            status: 'review',
            confidence: 0.76,
            rerankScore: 0.8,
            competingEntityIds: ['kai_rowan'],
            evidenceIds: [],
            rerankSignals: ['surface:alias', 'conflict:competing'],
            rationale: [],
        }],
    };
}
