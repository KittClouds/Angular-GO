import { describe, expect, it } from 'vitest';
import { buildGraphRebuildSnapshot } from './graph-rebuild-builder';
import { buildGraphModelV2OverGraphExport } from './graph-model-v2-overgraph';

describe('graph model v2 OverGraph export', () => {
    it('emits fact vertices and role edges without turning style tags into graph objects', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'global',
            scopeId: 'global',
            noteIds: ['note-1'],
            entities: [
                entity('kai', 'Kai'),
                entity('hazel', 'Hazel'),
                entity('map', 'map', 'OBJECT'),
            ],
            chunks: [
                { id: 'chunk-1', noteId: 'note-1', start: 0, end: 32, ordinal: 0, source: 'note-block' },
            ],
            occurrences: [
                occurrence('kai', 'Kai', 0, 3),
                occurrence('hazel', 'Hazel', 9, 14),
                occurrence('map', 'map', 19, 22),
            ],
            candidateCount: 3,
            noteTexts: { 'note-1': 'Kai gave Hazel the map at dawn.' },
            builtAt: 12,
        });

        const exported = buildGraphModelV2OverGraphExport(snapshot);
        const vertexIds = exported.graphBatch.vertices.map((vertex) => vertex.id);
        const edgeTypes = exported.graphBatch.edges.map((edge) => edge.edgeType);
        const transferFact = snapshot.graphModelV2?.facts.find((fact) => fact.family === 'transfer');

        expect(exported.graphBatch.scope).toEqual({ kind: 'projection', scopeKey: 'graph-model-v2:global:global' });
        expect(vertexIds).toEqual(expect.arrayContaining([
            'atom:entity:kai',
            'atom:entity:hazel',
            transferFact?.id,
        ]));
        expect(edgeTypes).toEqual(expect.arrayContaining(['role:source', 'role:target', 'role:evidence']));
        expect(exported.graphBatch.vertices.some((vertex) => vertex.kind.includes('style'))).toBe(false);
        expect(exported.graphBatch.vertices.find((vertex) => vertex.id === 'atom:entity:kai')?.attributes).toMatchObject({
            graphModelV2: {
                targetType: 'atom',
                styleTags: { structuralKind: ['entity'] },
            },
        });
        expect(exported.summary).toMatchObject({
            atomVertices: snapshot.graphModelV2?.atoms.length,
            bundleVertices: 0,
            bundleReceipts: snapshot.graphModelV2?.bundles.length,
            factVertices: snapshot.graphModelV2?.facts.length,
            roleEdges: snapshot.graphModelV2?.roles.length,
            droppedProjectionEdges: expect.any(Number),
        });
    });

    it('keeps review co-occurrence edges in the candidate layer', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note-1',
            noteIds: ['note-1'],
            entities: [entity('kai', 'Kai'), entity('hazel', 'Hazel')],
            chunks: [{ id: 'chunk-1', noteId: 'note-1', start: 0, end: 18, ordinal: 0, source: 'note-block' }],
            occurrences: [occurrence('kai', 'Kai', 0, 3), occurrence('hazel', 'Hazel', 8, 13)],
            noteTexts: { 'note-1': 'Kai met Hazel.' },
            builtAt: 22,
        });

        const exported = buildGraphModelV2OverGraphExport(snapshot);
        expect(snapshot.graphModelV2?.facts.filter((fact) => fact.family === 'cooccurrence')).toHaveLength(0);
        expect(snapshot.graphModelV2?.bundles.filter((bundle) => bundle.family === 'cooccurrence').length).toBeGreaterThan(0);
        const cooccurrenceEdges = exported.graphBatch.edges.filter((edge) =>
            edge.attributes.graphModelV2
            && (edge.attributes.graphModelV2 as { factFamily?: string }).factFamily === 'cooccurrence'
        );

        expect(cooccurrenceEdges.length).toBeGreaterThan(0);
        expect(cooccurrenceEdges.every((edge) => edge.layer === 'candidate')).toBe(true);
        expect(exported.summary.candidateEdges).toBeGreaterThan(0);
    });

    it('exposes Busemann commitment receipts on candidate bundle projections without rendering bundle vertices', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note-1',
            noteIds: ['note-1'],
            entities: [entity('kai', 'Kai'), entity('hazel', 'Hazel')],
            chunks: [{ id: 'chunk-1', noteId: 'note-1', start: 0, end: 18, ordinal: 0, source: 'note-block' }],
            occurrences: [occurrence('kai', 'Kai', 0, 3), occurrence('hazel', 'Hazel', 8, 13)],
            noteTexts: { 'note-1': 'Kai met Hazel.' },
            builtAt: 23,
        });
        const bundle = snapshot.graphModelV2?.bundles[0];
        expect(bundle).toBeTruthy();
        bundle!.commitment = {
            family: 'RelationFamily',
            topPrototypeId: 'relation:cooccurrence',
            topLabel: 'cooccurrence',
            topScore: -0.8,
            topProbability: 0.79,
            secondPrototypeId: 'relation:approval',
            secondScore: -0.2,
            secondProbability: 0.21,
            margin: 0.6,
            entropy: 0.31,
            ambiguityScore: 0.31,
            classificationConfidence: 0.74,
            promotionReady: true,
            radialStrength: 0.7,
            topKScores: [
                { prototypeId: 'relation:cooccurrence', family: 'RelationFamily', score: -0.8, probability: 0.79 },
            ],
        };

        const exported = buildGraphModelV2OverGraphExport(snapshot);
        const bundleProjection = exported.graphBatch.edges.find((edge) =>
            (edge.attributes.graphModelV2 as { sourceBundleId?: string } | undefined)?.sourceBundleId === bundle!.id
        );
        const graphModelV2 = bundleProjection?.attributes.graphModelV2 as Record<string, unknown> | undefined;

        expect(exported.graphBatch.vertices.some((row) => row.id === bundle!.id)).toBe(false);
        expect(graphModelV2).toMatchObject({
            edgeKind: 'projection',
            sourceBundleId: bundle!.id,
            commitmentTopPrototypeId: 'relation:cooccurrence',
            promotionReady: true,
            hybridInterior: {
                mode: 'busemannCommitment',
                signature: expect.objectContaining({
                    topPrototypeId: 'relation:cooccurrence',
                    promotionReady: true,
                }),
            },
        });
    });
});

function entity(id: string, label: string, kind = 'CHARACTER') {
    return { id, label, kind, aliases: [], createdAt: 1, updatedAt: 1 } as any;
}

function occurrence(entityId: string, surface: string, sourceStart: number, sourceEnd: number) {
    return {
        id: `note-1:${entityId}:${sourceStart}`,
        entityId,
        noteId: 'note-1',
        blockId: 'chunk-1',
        surface,
        sourceStart,
        sourceEnd,
        confidence: 0.9,
        status: 'accepted',
        source: 'accepted_suggestion',
        generation: 1,
        createdAt: 1,
        updatedAt: 1,
    } as any;
}
