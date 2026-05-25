import { describe, expect, it } from 'vitest';
import { DEFAULT_ENTITY_COLORS, DEFAULT_GRAPH_NODE_COLORS } from '../../../../../lib/store/entityColorStore';
import type { NoteBlockProjection } from '../../../../../lib/dexie/db';
import { buildLeafEmbeddingAtlas } from './graph-embedding-atlas';
import { buildGraphRebuildEmbeddingAtlas } from './graph-rebuild-embedding-atlas';

function block(id: string, text: string, ordinal: number): NoteBlockProjection {
    return {
        id,
        noteId: 'note-1',
        worldId: 'world-1',
        narrativeId: 'narrative-1',
        folderId: 'folder-1',
        ordinal,
        path: `block-${ordinal}`,
        nodeType: 'paragraph',
        text,
        textHash: id,
        startOffset: ordinal * 10,
        endOffset: ordinal * 10 + text.length,
        lineCount: 1,
        updatedAt: 1,
    };
}

describe('embedding atlas projection', () => {
    it('places embedding nodes on a sphere shell instead of an axis-clamped box', () => {
        const atlas = buildLeafEmbeddingAtlas([
            block('a', 'Aella and Kai crossed the lantern refuge.', 0),
            block('b', 'Iriane watched the rain and named the seam.', 1),
            block('c', 'Rowan kept the door while Siofra listened.', 2),
            block('d', 'Aurora charted old routes through the storm.', 3),
            block('e', 'Phaeris laughed at the impossible timing.', 4),
            block('f', 'Isolde measured the silence before moving.', 5),
        ]);

        const radii = atlas.nodes.map(node => Math.hypot(node.atlasX || 0, node.atlasY || 0, node.atlasZ || 0));
        for (const radius of radii) {
            expect(radius).toBeGreaterThan(1.03);
            expect(radius).toBeLessThan(1.13);
        }

        const maxAxis = Math.max(...atlas.nodes.flatMap(node => [
            Math.abs(node.atlasX || 0),
            Math.abs(node.atlasY || 0),
            Math.abs(node.atlasZ || 0),
        ]));
        expect(maxAxis).toBeLessThanOrEqual(1.08);
    });

    it('renders graph-rebuild embedding targets for chunks, anchors, entities, and graph links', () => {
        const atlas = buildGraphRebuildEmbeddingAtlas({
            schemaVersion: 'phoenix-graph-rebuild/v1',
            id: 'snapshot-1',
            source: 'phoenix-graph-rebuild',
            scopeKind: 'global',
            scopeId: 'global',
            noteIds: ['note-1'],
            builtAt: 1,
            chunks: [{ id: 'chunk-1', noteId: 'note-1', start: 0, end: 40, ordinal: 0, source: 'dynamic-chunking' }],
            mentions: [],
            entityAnchors: [{
                id: 'anchor-1',
                noteId: 'note-1',
                chunkId: 'chunk-1',
                surface: 'Kai',
                sourceStart: 0,
                sourceEnd: 3,
                source: 'accepted_suggestion',
                confidence: 0.9,
                entityId: 'kai',
                status: 'accepted',
                generation: 1,
            }],
            relationships: [],
            events: [],
            episodes: [],
            temporalEdges: [],
            causalEdges: [],
            memoryState: [],
            embeddingTargets: [
                { id: 'embed:note:note-1', kind: 'note', sourceId: 'note-1', noteId: 'note-1', label: 'Note 1', text: 'chapter text', evidenceIds: [] },
                { id: 'embed:chunk:chunk-1', kind: 'chunk', sourceId: 'chunk-1', noteId: 'note-1', chunkId: 'chunk-1', label: 'Chunk 1', text: 'Kai entered the room.', evidenceIds: [] },
                { id: 'embed:anchor:anchor-1', kind: 'anchor', sourceId: 'anchor-1', noteId: 'note-1', chunkId: 'chunk-1', entityId: 'kai', label: 'Kai', text: 'Kai', evidenceIds: ['anchor-1'] },
                { id: 'embed:entity:kai', kind: 'entity', sourceId: 'kai', entityId: 'kai', label: 'Kai', text: 'Kai', evidenceIds: ['anchor-1'] },
                { id: 'embed:entity:hazel', kind: 'entity', sourceId: 'hazel', entityId: 'hazel', label: 'Hazel', text: 'Hazel', evidenceIds: [] },
                { id: 'embed:entity:baton', kind: 'entity', sourceId: 'baton', entityId: 'baton', entityKind: 'LOCATION', label: 'Baton Rouge', text: 'Baton Rouge', evidenceIds: ['anchor-location'] },
                { id: 'embed:anchor:anchor-location', kind: 'anchor', sourceId: 'anchor-location', noteId: 'note-1', chunkId: 'chunk-1', entityId: 'baton', entityKind: 'LOCATION', label: 'Baton Rouge', text: 'Baton Rouge', evidenceIds: ['anchor-location'] },
                { id: 'embed:graph-fact:co', kind: 'graphFact', sourceId: 'co', label: 'Kai co_occurs_with Hazel', text: 'Kai co_occurs_with Hazel [review]', evidenceIds: [] },
                { id: 'embed:graph-fact:observe', kind: 'graphFact', sourceId: 'observe', label: 'Kai observes Hazel', text: 'Kai observes Hazel [accepted]', evidenceIds: [] },
                { id: 'embed:graph-fact:comment', kind: 'graphFact', sourceId: 'comment', label: 'Kai comments on Hazel', text: 'Kai comments on Hazel [accepted]', evidenceIds: [] },
                { id: 'embed:graph-fact:authority', kind: 'graphFact', sourceId: 'authority', label: 'authority_chain_event', text: 'Joint Chiefs authority chain event [accepted]', evidenceIds: [] },
            ],
            embeddingVectors: [],
            projectionRefs: [],
            nodes: [],
            edges: [{ id: 'edge-1', sourceId: 'kai', targetId: 'hazel', type: 'co_occurs_with', weight: 1, confidence: 0.7, evidenceAnchorIds: ['anchor-1'], scopeKeys: ['chunk-1'], noteIds: ['note-1'] }],
            counters: null as any,
        }, 'hybrid');

        expect(atlas.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
            'embed:chunk:chunk-1',
            'embed:anchor:anchor-1',
            'embed:entity:kai',
        ]));
        expect(atlas.edges.map((edge) => edge.type)).toEqual(expect.arrayContaining([
            'note-chunk',
            'chunk-anchor',
            'anchor-entity',
            'co_occurs_with',
        ]));
        const nodes = new Map(atlas.nodes.map((node) => [node.id, node]));
        const colors = new Map(atlas.nodes.map((node) => [node.id, node.colorHsl]));
        const styleLabDefaults = new Set(Object.values(DEFAULT_ENTITY_COLORS));
        expect(nodes.get('embed:entity:baton')?.kind).toBe('location');
        expect(nodes.get('embed:anchor:anchor-location')?.kind).toBe('anchor');
        expect(colors.get('embed:entity:baton')).toBe(DEFAULT_ENTITY_COLORS.LOCATION);
        expect(colors.get('embed:anchor:anchor-location')).toBe(DEFAULT_ENTITY_COLORS.LOCATION);
        expect(colors.get('embed:graph-fact:co')).toBe(DEFAULT_GRAPH_NODE_COLORS.cooccurrence);
        expect(colors.get('embed:graph-fact:observe')).toBe(DEFAULT_GRAPH_NODE_COLORS.observation);
        expect(colors.get('embed:graph-fact:comment')).toBe(DEFAULT_GRAPH_NODE_COLORS.communication);
        expect(colors.get('embed:graph-fact:authority')).toBe(DEFAULT_GRAPH_NODE_COLORS.authority);
        expect(styleLabDefaults.has(colors.get('embed:graph-fact:co') || '')).toBe(false);
        expect(styleLabDefaults.has(colors.get('embed:graph-fact:observe') || '')).toBe(false);
        expect(styleLabDefaults.has(colors.get('embed:graph-fact:comment') || '')).toBe(false);
        expect(atlas.sourceLabel).toContain('graph rebuild snapshot');
    });

    it('carries embedding topology into Product manifold metadata without linking identities', () => {
        const atlas = buildGraphRebuildEmbeddingAtlas({
            schemaVersion: 'phoenix-graph-rebuild/v1',
            id: 'snapshot-product',
            source: 'phoenix-graph-rebuild',
            scopeKind: 'global',
            scopeId: 'global',
            noteIds: ['note-1'],
            builtAt: 1,
            chunks: [],
            mentions: [],
            entityAnchors: [],
            relationships: [],
            events: [],
            episodes: [],
            temporalEdges: [],
            causalEdges: [],
            memoryState: [],
            embeddingTargets: [
                { id: 'embed:entity:kai', kind: 'entity', sourceId: 'kai', entityId: 'kai', label: 'Kai', text: 'Kai maps Red Mesa', evidenceIds: [] },
                { id: 'embed:entity:rowan', kind: 'entity', sourceId: 'rowan', entityId: 'rowan', label: 'Rowan', text: 'Rowan reads authority lines', evidenceIds: [] },
            ],
            embeddingVectors: [],
            projectionRefs: [],
            nodes: [],
            edges: [],
            counters: null as any,
            embeddingProfile: {
                schemaVersion: 'phoenix-embedding-profile/v1',
                modelId: 'mongodb-leaf-mt',
                modelLabel: 'MDBR Leaf MT',
                modelFamily: 'mdbr-leaf-mt',
                dimensionLabel: '786d',
                nativeDimensions: 786,
                selectedDimensions: 786,
                taskProfile: 'multi_task',
                vectorSource: 'signature-preview',
                normalized: true,
            },
            embeddingGraphPostProcess: {
                schemaVersion: 'phoenix-embedding-graph-postprocess/v1',
                profile: null as any,
                vectorDimensions: 786,
                clusters: [],
                productTopologyRegions: [{
                    id: 'product-region:embedding-cluster:0:entity:core',
                    role: 'core',
                    laneKind: 'entity',
                    clusterId: 'embedding-cluster:0',
                    medoidTargetId: 'embed:entity:kai',
                    memberCount: 2,
                    density: 0.8,
                    confidence: 0.9,
                    bridgeTargetIds: [],
                    backboneTargetIds: ['embed:entity:rowan'],
                }],
                targets: [{
                    targetId: 'embed:entity:kai',
                    clusterId: 'embedding-cluster:0',
                    clusterRole: 'entity_region',
                    medoidTargetId: 'embed:entity:kai',
                    outlierScore: 0.1,
                    hubScore: 0.8,
                    neighborCount: 1,
                    productLaneFeatures: {
                        semanticDepth: 0.9,
                        documentDepth: 0.25,
                        relationDepth: 0.2,
                        clusterRadius: 0.4,
                        fiberPhase: 0.33,
                        confidence: 0.88,
                        dominantLane: 'entity',
                        laneWeights: {
                            semantic: 0.9,
                            document: 0.25,
                            relation: 0.2,
                            temporal: 0.1,
                            causal: 0.1,
                            evidence: 0.16,
                            entity: 0.78,
                        },
                    },
                    productTopologyRegion: {
                        id: 'product-region:embedding-cluster:0:entity:core',
                        role: 'core',
                        laneKind: 'entity',
                        clusterId: 'embedding-cluster:0',
                        medoidTargetId: 'embed:entity:kai',
                        memberCount: 2,
                        density: 0.8,
                        confidence: 0.9,
                        bridgeTargetIds: [],
                        backboneTargetIds: ['embed:entity:rowan'],
                    },
                }],
                backboneEdges: [],
                bridgeEdges: [],
                outlierTargetIds: [],
                metrics: {
                    clusterCount: 1,
                    singletonCount: 0,
                    largestClusterSize: 2,
                    largestClusterRatio: 1,
                    backboneEdgeCount: 0,
                    bridgeEdgeCount: 0,
                    outlierCount: 0,
                    maxHubScore: 0.8,
                    meanNeighborCount: 1,
                },
            },
        }, 'product');

        const kai = atlas.nodes.find((node) => node.id === 'embed:entity:kai')!;
        expect(kai.metadata?.product).toMatchObject({
            role: 'embeddingTarget',
            clusterId: 'embedding-cluster:0',
            medoidTargetId: 'embed:entity:kai',
            dominantLane: 'entity',
            region: expect.objectContaining({
                role: 'core',
                laneKind: 'entity',
            }),
        });
        expect(kai.metadata?.lorentz).toMatchObject({
            level: 0,
            primaryTreeKind: 'identity',
            regionRole: 'core',
            dominantLane: 'entity',
        });
        expect(kai.metadata?.hopf).toMatchObject({
            fiberKind: 'identity',
            phase: 0.33,
        });
    });
});
