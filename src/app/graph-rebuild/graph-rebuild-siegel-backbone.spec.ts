import { describe, expect, it } from 'vitest';

import { buildSiegelBackboneProjectionReceipt } from './graph-rebuild-siegel-backbone';
import type { GraphRebuildSnapshot } from './graph-rebuild-snapshot';

describe('buildSiegelBackboneProjectionReceipt', () => {
    it('measures asymmetric parent-child Finsler structure without native sidecars', async () => {
        const snapshot = snapshotWithTargets([
            target('doc', 'document_spine', 'Document root', [], 0),
            target('chunk', 'chunk_spine', 'Chunk one', ['doc'], 1),
            target('entity', 'entity_anchor', 'Kai', ['chunk'], 2),
        ]);

        const receipt = await buildSiegelBackboneProjectionReceipt(snapshot, { nativeRunner: null });

        expect(receipt.mode).toBe('siegel');
        expect(receipt.status).toBe('synced');
        expect(receipt.targetCount).toBe(3);
        expect(receipt.counters).toEqual(expect.objectContaining({
            siegelEnabled: 1,
            siegelFallback: 1,
            siegelGenus: 3,
            siegelMatrixCells: 6,
            siegelParentEdges: 2,
            siegelDistanceEvaluations: 4,
            siegelAsymmetricPairs: 2,
            siegelHierarchyViolations: 0,
        }));
    });

    it('uses native kernel receipts when a runner is available', async () => {
        const snapshot = snapshotWithTargets([
            target('doc', 'document_spine', 'Document root', [], 0),
            target('chunk', 'chunk_spine', 'Chunk one', ['doc'], 1),
        ]);

        const receipt = await buildSiegelBackboneProjectionReceipt(snapshot, {
            nativeRunner: async () => ({
                contract: {
                    targetCount: 2,
                    directedEdgeCount: 1,
                    genus: 3,
                    matrixCells: 6,
                    distanceEvaluations: 2,
                    asymmetricPairCount: 1,
                    hierarchyViolationCount: 0,
                    estimatedBytes: 104,
                    timings: { buildMs: 1, matrixPlanMs: 2, distanceMs: 3 },
                },
                counters: { pairCount: 1, skippedEdgeCount: 0 },
                parentPairs: 1,
                backbonePairs: 0,
                bridgePairs: 0,
            }),
        });

        expect(receipt.status).toBe('synced');
        expect(receipt.message).toContain('Native Siegel-Finsler');
        expect(receipt.counters).toEqual(expect.objectContaining({
            siegelNative: 1,
            siegelPairs: 1,
            siegelDistanceMs: 3,
        }));
    });

    it('skips cleanly when no targets are available', async () => {
        const receipt = await buildSiegelBackboneProjectionReceipt(snapshotWithTargets([]));

        expect(receipt.status).toBe('skipped');
        expect(receipt.targetCount).toBe(0);
        expect(receipt.message).toContain('no embedding targets');
    });
});

function snapshotWithTargets(targets: GraphRebuildSnapshot['embeddingTargets']): GraphRebuildSnapshot {
    return {
        schemaVersion: 'phoenix-graph-rebuild/v1',
        id: 'snapshot:test',
        source: 'phoenix-graph-rebuild',
        scopeKind: 'note',
        scopeId: 'note:test',
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
        embeddingTargets: targets,
        embeddingVectors: [],
        projectionRefs: [],
        nodes: [],
        edges: [],
        counters: {
            entities: 0,
            aliases: 0,
            candidates: 0,
            mentions: 0,
            acceptedAnchors: 0,
            chunks: 0,
            relationshipCandidates: 0,
            relationships: 0,
            acceptedRelationships: 0,
            reviewRelationships: 0,
            rejectedRelationships: 0,
            events: 0,
            episodes: 0,
            temporalEdges: 0,
            causalEdges: 0,
            memoryState: 0,
            embeddingTargets: targets.length,
            embeddingVectors: 0,
            projectionRefs: 0,
            nodes: 0,
            edges: 0,
            dropReasons: {
                missingEntity: 0,
                invalidSpan: 0,
                duplicateAnchor: 0,
                singletonBucket: 0,
                missingChunk: 0,
            },
        },
    };
}

function target(
    id: string,
    lane: GraphRebuildSnapshot['embeddingTargets'][number]['lane'],
    label: string,
    parentIds: string[],
    admissionTier: number,
): GraphRebuildSnapshot['embeddingTargets'][number] {
    return {
        id,
        kind: lane || 'unknown',
        sourceId: id,
        noteId: 'note-1',
        label,
        text: label,
        evidenceIds: [],
        lane,
        parentIds,
        admissionTier,
    };
}
