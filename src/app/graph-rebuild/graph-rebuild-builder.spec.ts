import { describe, expect, it } from 'vitest';

import {
    buildGraphRebuildAliasResolver,
    buildGraphRebuildSnapshot,
    normalizeGraphRebuildCandidate,
} from './graph-rebuild-builder';
import {
    embeddingModelAdapterFromSelection,
    normalizeEmbeddingProfile,
} from './graph-rebuild-embedding-signatures';
import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';

describe('Phoenix graph rebuild builder', () => {
    it('resolves canonical Alex entities by label and alias', () => {
        const resolver = buildGraphRebuildAliasResolver([
            entity('e-kai', 'Kai', ['Captain Kai']),
            entity('e-rift', 'Rift', ['The Rift']),
        ]);

        expect(resolver.resolve(' captain kai ')?.id).toBe('e-kai');
        expect(resolver.resolve('The Rift')?.id).toBe('e-rift');
        expect(resolver.aliasCount).toBe(2);
    });

    it('normalizes NER candidates before they can feed Alex', () => {
        expect(normalizeGraphRebuildCandidate({
            label: '  Kai   Varo ',
            kind: 'character',
            aliases: ['Kai Varo', '  Captain   Kai  ', 'Captain Kai'],
            confidence: 2,
        })).toEqual({
            label: 'Kai Varo',
            kind: 'CHARACTER',
            aliases: ['Captain Kai'],
            confidence: 1,
        });
    });

    it('builds cooccurrence rows, typed facts, memory state, and embedding targets', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:one',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai', ['Captain Kai']),
                entity('e-rift', 'Rift', []),
                entity('e-hazel', 'Hazel', []),
            ],
            chunks: [
                { id: 'note-1:block:0', noteId: 'note-1', start: 0, end: 120, ordinal: 0, source: 'note-block' },
            ],
            occurrences: [
                occurrence('note-1', 'e-kai', 'Kai', 0, 3),
                occurrence('note-1', 'e-rift', 'Rift', 20, 24),
                occurrence('note-1', 'e-hazel', 'Hazel', 90, 95),
                occurrence('note-2', 'e-hazel', 'Hazel', 0, 5),
            ],
            candidateCount: 4,
            noteTexts: {
                'note-1': 'Kai approved the packet with Rift because Hazel warned Kai. Hazel stood beside Kai as Diamond rank was confirmed.',
            },
            builtAt: 10,
        });

        expect(snapshot.schemaVersion).toBe('phoenix-graph-rebuild/v1');
        expect(snapshot.nodes.map((node) => node.id).sort()).toEqual(['e-hazel', 'e-kai', 'e-rift']);
        expect(snapshot.edges.filter((edge) => edge.type === 'anchored-cooccurrence').map((edge) => [edge.sourceId, edge.targetId]).sort()).toEqual([
            ['e-hazel', 'e-kai'],
            ['e-hazel', 'e-rift'],
            ['e-kai', 'e-rift'],
        ]);
        expect(snapshot.relationships).toHaveLength(6);
        expect(snapshot.relationships.filter((row) => row.adjudicationSource === 'graph-rebuild-cooccurrence-policy')).toHaveLength(3);
        expect(snapshot.relationships.filter((row) => row.adjudicationSource === 'graph-rebuild-typed-cue-policy')).toHaveLength(3);
        expect(snapshot.relationships.map((row) => [row.relationType, row.status])).toEqual(expect.arrayContaining([
            ['co_occurs_with', 'review'],
            ['approves_or_accepts', 'accepted'],
        ]));
        expect(snapshot.counters.relationshipCandidates).toBe(6);
        expect(snapshot.counters.acceptedRelationships).toBe(3);
        expect(snapshot.counters.reviewRelationships).toBe(3);
        expect(snapshot.counters.rejectedRelationships).toBe(0);
        expect(snapshot.events.map((event) => event.id)).toEqual(['event:note-1:0:approval_event']);
        expect(snapshot.memoryState.map((state) => [state.entityId, state.key]).sort()).toEqual([
            ['e-hazel', 'rank_or_status'],
            ['e-kai', 'rank_or_status'],
            ['e-rift', 'rank_or_status'],
        ]);
        expect(kindCounts(snapshot.embeddingTargets.map((target) => target.kind))).toEqual({
            anchor: 3,
            chunk: 1,
            entity: 3,
            event: 1,
            graphFact: 6,
            memoryState: 3,
            note: 1,
        });
        expect(snapshot.embeddingTargets
            .filter((target) => target.kind === 'entity')
            .map((target) => target.entityKind)
        ).toEqual(['CHARACTER', 'CHARACTER', 'CHARACTER']);
        expect(snapshot.counters).toMatchObject({
            entities: 3,
            aliases: 1,
            candidates: 4,
            acceptedAnchors: 3,
            chunks: 1,
            events: 1,
            episodes: 1,
            memoryState: 3,
            embeddingTargets: 18,
            nodes: 3,
            edges: 6,
            structuralComponents: 1,
            structuralHubs: 3,
        });
        expect(snapshot.structuralPostProcess).toMatchObject({
            schemaVersion: 'phoenix-graph-structure/v1',
            hubEntityIds: ['e-hazel', 'e-kai', 'e-rift'],
        });
        expect(snapshot.structuralPostProcess?.components).toHaveLength(1);
    });

    it('adds deterministic topology roles for structural post-processing', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:structure',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai', []),
                entity('e-hazel', 'Hazel', []),
                entity('e-rowan', 'Rowan', []),
                entity('e-rook', 'Rook', []),
            ],
            chunks: [
                { id: 'note-1:chunk:0', noteId: 'note-1', start: 0, end: 80, ordinal: 0, source: 'dynamic-chunking' },
                { id: 'note-1:chunk:1', noteId: 'note-1', start: 81, end: 160, ordinal: 1, source: 'dynamic-chunking' },
            ],
            occurrences: [
                occurrence('note-1', 'e-kai', 'Kai', 0, 3),
                occurrence('note-1', 'e-hazel', 'Hazel', 10, 15),
                occurrence('note-1', 'e-rowan', 'Rowan', 20, 25),
                occurrence('note-1', 'e-rook', 'Rook', 90, 94),
                occurrence('note-1', 'e-rowan', 'Rowan', 100, 105),
            ],
            builtAt: 13,
        });

        const structure = snapshot.structuralPostProcess!;
        expect(structure.components.map((component) => component.size)).toEqual([4]);
        expect(structure.bridgeEdgeIds).toEqual(['e-rook:anchored-cooccurrence:e-rowan']);
        expect(structure.nodes.map((node) => [node.entityId, node.role]).sort()).toEqual([
            ['e-hazel', 'connector'],
            ['e-kai', 'connector'],
            ['e-rook', 'leaf'],
            ['e-rowan', 'hub'],
        ]);
        expect(structure.edges.find((edge) => edge.edgeId === 'e-rook:anchored-cooccurrence:e-rowan')?.role).toBe('bridge');
        expect(snapshot.graphAwareLinkSuggestions?.map((suggestion) => suggestion.kind)).toEqual(expect.arrayContaining([
            'bridge_review',
            'suspicious_leaf',
        ]));
        expect(snapshot.counters.structuralBridgeEdges).toBe(1);
        expect(snapshot.counters.graphAwareLinkSuggestions).toBeGreaterThanOrEqual(2);
    });

    it('adds model-profile-aware embedding graph post-processing without hardcoded dimensions', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:embedding-graph',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai', []),
                entity('e-rowan', 'Rowan', []),
                entity('e-allied-table', 'Allied Table', [], 'NETWORK'),
            ],
            chunks: [
                { id: 'note-1:chunk:0', noteId: 'note-1', start: 0, end: 90, ordinal: 0, source: 'dynamic-chunking' },
                { id: 'note-1:chunk:1', noteId: 'note-1', start: 91, end: 180, ordinal: 1, source: 'dynamic-chunking' },
            ],
            occurrences: [
                occurrence('note-1', 'e-kai', 'Kai', 0, 3),
                occurrence('note-1', 'e-rowan', 'Rowan', 22, 27),
                occurrence('note-1', 'e-allied-table', 'Allied Table', 98, 110),
                occurrence('note-1', 'e-kai', 'Kai', 130, 133),
            ],
            noteTexts: {
                'note-1': 'Kai and Rowan mapped the first authority packet. Allied Table reviewed the network lane while Kai prepared the graph.',
            },
            embeddingProfile: {
                modelId: 'jina-v5-nano-retrieval',
                modelLabel: 'Jina v5 Nano',
                modelFamily: 'jina-v5',
                dimensionLabel: '786d',
                nativeDimensions: 786,
                selectedDimensions: 786,
                taskProfile: 'semantic_topology',
                vectorSource: 'signature-preview',
                normalized: true,
            },
            builtAt: 15,
        });

        expect(snapshot.embeddingProfile).toMatchObject({
            modelId: 'jina-v5-nano-retrieval',
            selectedDimensions: 786,
            taskProfile: 'semantic_topology',
            topologySupport: 'native',
        });
        expect(snapshot.embeddingModelAdapter).toMatchObject({
            modelId: 'jina-v5-nano-retrieval',
            selectedDimensions: 786,
            topologySupport: 'native',
        });
        expect(snapshot.embeddingGraphPostProcess?.schemaVersion).toBe('phoenix-embedding-graph-postprocess/v1');
        expect(snapshot.embeddingGraphPostProcess?.vectorDimensions).toBe(786);
        expect(snapshot.embeddingGraphPostProcess?.clusters.length).toBeGreaterThan(0);
        expect(snapshot.embeddingGraphPostProcess?.productTopologyRegions.length).toBeGreaterThan(0);
        expect(snapshot.embeddingGraphPostProcess?.targets[0].productLaneFeatures).toMatchObject({
            semanticDepth: expect.any(Number),
            fiberPhase: expect.any(Number),
            dominantLane: expect.any(String),
            laneWeights: expect.any(Object),
        });
        expect(snapshot.embeddingGraphPostProcess?.targets[0].productTopologyRegion).toMatchObject({
            id: expect.stringContaining('product-region:'),
            role: expect.any(String),
            laneKind: expect.any(String),
        });
        expect(snapshot.counters.embeddingClusters).toBe(snapshot.embeddingGraphPostProcess?.metrics.clusterCount);
        expect(snapshot.counters.embeddingBackboneEdges).toBe(snapshot.embeddingGraphPostProcess?.metrics.backboneEdgeCount);
    });

    it('prepares model adapters for retrieval, multi-task, and high-dimension topology models', () => {
        const leafMt = embeddingModelAdapterFromSelection({
            dynamicNerId: 'dynamic_ner',
            embeddingModelId: 'mongodb-leaf-mt',
            embeddingModelLabel: 'MDBR Leaf MT',
            embeddingDimensionLabel: '786d',
            nliModelId: 'nli',
        });
        const jina = embeddingModelAdapterFromSelection({
            dynamicNerId: 'dynamic_ner',
            embeddingModelId: 'jina-v5-nano-retrieval',
            embeddingModelLabel: 'Jina v5 Nano Retrieval',
            embeddingDimensionLabel: '768d',
            nliModelId: 'nli',
        });

        expect(leafMt).toMatchObject({
            dimensionLabel: '786d',
            selectedDimensions: 786,
            modelFamily: 'mdbr-leaf-mt',
            taskProfile: 'multi_task',
            topologySupport: 'native',
            supportsTopology: true,
            supportsMultiTask: true,
            supportsMultiVector: true,
        });
        expect(leafMt.vectorHeads.map((head) => head.id)).toEqual([
            'document',
            'query',
            'topology',
            'classification',
        ]);
        expect(jina).toMatchObject({
            selectedDimensions: 768,
            modelFamily: 'jina-v5',
            taskProfile: 'retrieval',
            topologySupport: 'native',
            supportsTopology: true,
            supportsMultiVector: true,
        });
    });

    it('normalizes embedding profiles through adapter defaults for odd dimensions', () => {
        const profile = normalizeEmbeddingProfile({
            modelId: 'jina-v5-topology',
            modelLabel: 'Jina v5 Topology 786',
            dimensionLabel: '786d',
        });

        expect(profile).toMatchObject({
            selectedDimensions: 786,
            nativeDimensions: 786,
            taskProfile: 'semantic_topology',
            topologySupport: 'native',
            normalization: 'unit_l2',
            supportsMultiVector: true,
        });
        expect(profile.vectorHeads.every((head) => head.dimensions === 786)).toBe(true);
    });

    it('suggests network hub affiliations from semantic status and structural role', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:network',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai', [], 'CHARACTER'),
                entity('e-allied-table', 'Allied Table', [], 'NETWORK'),
            ],
            chunks: [
                { id: 'note-1:chunk:0', noteId: 'note-1', start: 0, end: 80, ordinal: 0, source: 'dynamic-chunking' },
            ],
            occurrences: [
                occurrence('note-1', 'e-kai', 'Kai', 0, 3),
                occurrence('note-1', 'e-allied-table', 'Allied Table', 20, 32),
            ],
            builtAt: 14,
        });

        expect(snapshot.graphAwareLinkSuggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'hub_affiliation',
                sourceEntityId: 'e-allied-table',
                targetEntityId: 'e-kai',
                suggestedRelationType: 'affiliated_with',
                semanticStatus: 'review',
                structuralRole: 'bridge',
                rerankScore: expect.any(Number),
                rerankSignals: expect.arrayContaining(['semantic:review', 'structure:bridge', expect.stringContaining('product_')]),
            }),
        ]));
    });

    it('upgrades matching relationship candidates with explicit NLI hints', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:one',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai', []),
                entity('e-hazel', 'Hazel', []),
            ],
            chunks: [
                { id: 'note-1:chunk:0', noteId: 'note-1', start: 0, end: 80, ordinal: 0, source: 'dynamic-chunking' },
            ],
            occurrences: [
                occurrence('note-1', 'e-kai', 'Kai', 0, 3),
                occurrence('note-1', 'e-hazel', 'Hazel', 10, 15),
            ],
            relationshipHints: [{
                sourceId: 'entity:e-kai',
                targetId: 'entity:e-hazel',
                relationType: 'supports',
                status: 'accepted',
                confidence: 0.94,
                source: 'nli:modernbert',
                evidence: ['judgment:j-1'],
            }],
            builtAt: 12,
        });

        expect(snapshot.relationships).toHaveLength(1);
        expect(snapshot.relationships[0]).toMatchObject({
            relationType: 'supports',
            status: 'accepted',
            adjudicationSource: 'nli:modernbert',
        });
        expect(snapshot.counters.acceptedRelationships).toBe(1);
        expect(snapshot.counters.reviewRelationships).toBe(0);
    });

    it('reports exact missing upstream reasons instead of silent empty output', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'global',
            scopeId: 'global',
            entities: [entity('e-kai', 'Kai', [])],
            occurrences: [
                occurrence('note-1', 'missing', 'Ghost', 0, 5),
                occurrence('note-1', 'e-kai', 'Kai', 4, 4),
                occurrence('note-1', 'e-kai', 'Kai', 6, 9),
            ],
            builtAt: 11,
        });

        expect(snapshot.nodes).toHaveLength(1);
        expect(snapshot.edges).toHaveLength(0);
        expect(snapshot.counters.dropReasons).toMatchObject({
            missingEntity: 1,
            invalidSpan: 1,
            singletonBucket: 1,
        });
    });
});

function entity(id: string, label: string, aliases: string[], kind = 'CHARACTER'): RegisteredEntity {
    return {
        id,
        label,
        kind: kind as any,
        aliases,
        firstNote: `${id}-note`,
        mentionsByNote: new Map(),
        totalMentions: 0,
        lastSeenDate: new Date(1),
        createdAt: new Date(1),
        createdBy: 'user',
        registeredAt: 1,
    };
}

function occurrence(noteId: string, entityId: string, surface: string, sourceStart: number, sourceEnd: number): EntityOccurrence {
    return {
        id: `${noteId}:${entityId}:${sourceStart}:${sourceEnd}`,
        noteId,
        entityId,
        entityLabel: surface,
        entityKind: 'CHARACTER',
        sourceStart,
        sourceEnd,
        surface,
        source: 'dictionary_match',
        confidence: 0.9,
        excerpt: surface,
        generation: 1,
        createdAt: 1,
        updatedAt: 1,
    };
}

function kindCounts(kinds: string[]): Record<string, number> {
    const counts = new Map<string, number>();
    for (const kind of kinds) counts.set(kind, (counts.get(kind) || 0) + 1);
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
