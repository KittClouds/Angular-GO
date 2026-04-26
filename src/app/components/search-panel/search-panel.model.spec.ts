import { describe, expect, it } from 'vitest';

import { buildGraphPreview, buildSearchSnippet } from './search-panel.model';

describe('search panel model helpers', () => {
    it('builds a compact graph preview from audit samples', () => {
        const preview = buildGraphPreview({
            notes: 1,
            registryEntities: 2,
            registryEdges: 0,
            graphNodes: 2,
            graphEdges: 1,
            liveDocuments: 1,
            indexedDocuments: 1,
            staleDocuments: 0,
            staleDocumentIds: [],
            orphanEdges: 0,
            duplicateEdges: 0,
            nodeKinds: [],
            edgeTypes: [],
            updatedAt: 1,
            sampleNodes: [
                { id: 'a', label: 'Aella', kind: 'entity', noteId: 'n1', documentId: 'n1', folderId: 'f1' },
                { id: 'b', label: 'Kai', kind: 'entity', noteId: 'n1', documentId: 'n1', folderId: 'f1' },
            ],
            sampleEdges: [
                { sourceId: 'a', targetId: 'b', edgeType: 'mentions', noteId: 'n1', documentId: 'n1', folderId: 'f1' },
            ],
            orphanEdgeSamples: [],
            duplicateEdgeSamples: [],
        });

        expect(preview.nodes).toHaveLength(2);
        expect(preview.edges).toHaveLength(1);
        expect(preview.edges[0]).toMatchObject({ id: 'a:b:mentions:0' });
    });

    it('builds a bounded snippet around a matching query', () => {
        const snippet = buildSearchSnippet('Aella walked into the harbor with Kai beside her.', 'harbor');

        expect(snippet).toContain('harbor');
        expect(snippet.length).toBeLessThan(80);
    });
});
