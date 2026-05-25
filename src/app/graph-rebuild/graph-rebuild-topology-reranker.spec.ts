import { describe, expect, it } from 'vitest';

import type {
    GraphRebuildEmbeddingGraphPostProcess,
    GraphRebuildEmbeddingTargetPostProcess,
    GraphRebuildLinkSuggestion,
    GraphRebuildProductLaneKind,
    GraphRebuildProductTopologyRegionRole,
} from './graph-rebuild-snapshot';
import { rerankGraphRebuildLinkSuggestions } from './graph-rebuild-topology-reranker';

describe('graph rebuild topology reranker', () => {
    it('boosts causal lane candidates for causal intents', () => {
        const reranked = rerankGraphRebuildLinkSuggestions([
            suggestion('kai', 'pulse', 'bridge'),
            suggestion('kai', 'chapter', 'bridge'),
        ], embedding([
            row('kai', 'core', 'entity', { entity: 0.9, semantic: 0.6 }),
            row('pulse', 'bridge', 'causal', { causal: 0.95, temporal: 0.6 }),
            row('chapter', 'boundary', 'document', { document: 0.95, evidence: 0.5 }),
        ]), 'causal_upstream');

        const causal = reranked.find((item) => item.targetEntityId === 'pulse')!;
        const document = reranked.find((item) => item.targetEntityId === 'chapter')!;

        expect(causal.rerankScore).toBeGreaterThan(document.rerankScore || 0);
        expect(causal.rerankSignals).toContain('intent_lane:causal');
        expect(causal.productLane).toBe('mixed');
    });

    it('boosts entity lanes for same-entity context intents', () => {
        const reranked = rerankGraphRebuildLinkSuggestions([
            suggestion('kai', 'rowan', 'shared_component'),
            suggestion('kai', 'chapter', 'shared_component'),
        ], embedding([
            row('kai', 'core', 'entity', { entity: 0.95, semantic: 0.7 }),
            row('rowan', 'boundary', 'entity', { entity: 0.9, semantic: 0.7 }),
            row('chapter', 'boundary', 'document', { document: 0.9, evidence: 0.6 }),
        ]), 'same_entity_context');

        const entity = reranked.find((item) => item.targetEntityId === 'rowan')!;
        const document = reranked.find((item) => item.targetEntityId === 'chapter')!;

        expect(entity.rerankScore).toBeGreaterThan(document.rerankScore || 0);
        expect(entity.rerankSignals).toContain('product_lane:entity');
        expect(entity.rerankSignals).toContain('intent_lane:entity');
    });
});

function suggestion(source: string, target: string, structuralRole: GraphRebuildLinkSuggestion['structuralRole']): GraphRebuildLinkSuggestion {
    return {
        id: `suggestion:${source}:${target}`,
        kind: 'bridge_review',
        sourceEntityId: source,
        targetEntityId: target,
        suggestedRelationType: 'related_to',
        status: 'review',
        confidence: 0.55,
        semanticStatus: 'review',
        structuralRole,
        rationale: ['seed'],
        evidenceIds: ['e1'],
    };
}

function embedding(targets: GraphRebuildEmbeddingTargetPostProcess[]): GraphRebuildEmbeddingGraphPostProcess {
    return {
        schemaVersion: 'phoenix-embedding-graph-postprocess/v1',
        profile: {
            schemaVersion: 'phoenix-embedding-profile/v1',
            modelId: 'test',
            modelLabel: 'Test',
            modelFamily: 'test',
            dimensionLabel: '384d',
            nativeDimensions: 384,
            selectedDimensions: 384,
            taskProfile: 'semantic_topology',
            vectorSource: 'signature-preview',
            normalized: true,
            normalization: 'unit_l2',
            topologySupport: 'derived',
            supportsMultiVector: false,
            vectorHeads: [{
                id: 'dense',
                kind: 'dense',
                dimensions: 384,
                normalized: true,
                required: true,
                purpose: 'single dense semantic vector',
            }],
        },
        adapter: {
            schemaVersion: 'phoenix-embedding-model-adapter/v1',
            modelId: 'test',
            modelLabel: 'Test',
            modelFamily: 'test',
            dimensionLabel: '384d',
            nativeDimensions: 384,
            selectedDimensions: 384,
            taskProfile: 'semantic_topology',
            vectorSource: 'signature-preview',
            normalized: true,
            normalization: 'unit_l2',
            topologySupport: 'derived',
            supportsTopology: true,
            supportsMultiTask: false,
            supportsMultiVector: false,
            vectorHeads: [{
                id: 'dense',
                kind: 'dense',
                dimensions: 384,
                normalized: true,
                required: true,
                purpose: 'single dense semantic vector',
            }],
        },
        targetCount: targets.length,
        vectorDimensions: 384,
        clusters: [],
        productTopologyRegions: targets.map((target) => target.productTopologyRegion),
        targets,
        backboneEdges: [],
        bridgeEdges: [],
        outlierTargetIds: [],
        metrics: {
            clusterCount: 1,
            singletonCount: 0,
            largestClusterSize: targets.length,
            largestClusterRatio: 1,
            backboneEdgeCount: 0,
            bridgeEdgeCount: 0,
            outlierCount: 0,
            maxHubScore: 0.7,
            meanNeighborCount: 2,
        },
    };
}

function row(
    entityId: string,
    role: GraphRebuildProductTopologyRegionRole,
    lane: GraphRebuildProductLaneKind,
    weights: Partial<Record<GraphRebuildProductLaneKind, number>>,
): GraphRebuildEmbeddingTargetPostProcess {
    return {
        targetId: `embed:entity:${entityId}`,
        clusterId: 'cluster:a',
        clusterRole: 'entity_region',
        medoidTargetId: 'embed:entity:kai',
        outlierScore: role === 'outlier' ? 0.82 : 0.12,
        hubScore: role === 'core' ? 0.9 : 0.44,
        neighborCount: 3,
        productLaneFeatures: {
            semanticDepth: weights.semantic || 0,
            documentDepth: weights.document || 0,
            relationDepth: weights.relation || 0,
            clusterRadius: 0.3,
            fiberPhase: 0.4,
            confidence: 0.82,
            dominantLane: lane,
            laneWeights: {
                semantic: weights.semantic || 0,
                document: weights.document || 0,
                relation: weights.relation || 0,
                temporal: weights.temporal || 0,
                causal: weights.causal || 0,
                evidence: weights.evidence || 0,
                entity: weights.entity || 0,
            },
        },
        productTopologyRegion: {
            id: `region:${lane}`,
            role,
            laneKind: lane,
            clusterId: 'cluster:a',
            medoidTargetId: 'embed:entity:kai',
            memberCount: 2,
            density: 0.7,
            confidence: 0.82,
            bridgeTargetIds: role === 'bridge' ? [`embed:entity:${entityId}`] : [],
            backboneTargetIds: role === 'backbone' ? [`embed:entity:${entityId}`] : [],
        },
    };
}
