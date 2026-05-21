import { describe, expect, it } from 'vitest';

import {
    GRAPH_REBUILD_NAMESPACE,
    graphRebuildSnapshotToScopedDocument,
    scopedDocumentToGraphRebuildSnapshot,
} from './graph-rebuild.service';
import type { GraphRebuildSnapshot } from './graph-rebuild-snapshot';

describe('GraphRebuildService persistence helpers', () => {
    it('roundtrips explicit graph snapshots through Overgraph scoped documents', () => {
        const snapshot: GraphRebuildSnapshot = {
            schemaVersion: 'phoenix-graph-rebuild/v1',
            id: 'graph-rebuild:global:1',
            source: 'phoenix-graph-rebuild',
            scopeKind: 'global',
            scopeId: 'global',
            noteIds: ['note-1'],
            builtAt: 100,
            chunks: [],
            mentions: [],
            entityAnchors: [],
            relationships: [],
            events: [],
            episodes: [],
            temporalEdges: [],
            causalEdges: [],
            memoryState: [],
            embeddingTargets: [],
            embeddingVectors: [],
            projectionRefs: [],
            nodes: [],
            edges: [],
            counters: {
                entities: 2,
                aliases: 1,
                candidates: 0,
                mentions: 0,
                acceptedAnchors: 0,
                chunks: 0,
                relationships: 0,
                events: 0,
                episodes: 0,
                temporalEdges: 0,
                causalEdges: 0,
                memoryState: 0,
                embeddingTargets: 0,
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

        const document = graphRebuildSnapshotToScopedDocument(snapshot);

        expect(document.namespace).toBe(GRAPH_REBUILD_NAMESPACE);
        expect(document.scopeFolderId).toBe('global');
        expect(scopedDocumentToGraphRebuildSnapshot(document)).toEqual(snapshot);
    });
});
