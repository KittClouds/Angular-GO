import { describe, expect, it } from 'vitest';
import { DEFAULT_ENTITY_COLORS } from '../../../../../lib/store/entityColorStore';
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
                { id: 'embed:graph-fact:co', kind: 'graphFact', sourceId: 'co', label: 'Kai co_occurs_with Hazel', text: 'Kai co_occurs_with Hazel [review]', evidenceIds: [] },
                { id: 'embed:graph-fact:observe', kind: 'graphFact', sourceId: 'observe', label: 'Kai observes Hazel', text: 'Kai observes Hazel [accepted]', evidenceIds: [] },
                { id: 'embed:graph-fact:comment', kind: 'graphFact', sourceId: 'comment', label: 'Kai comments on Hazel', text: 'Kai comments on Hazel [accepted]', evidenceIds: [] },
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
        const colors = new Map(atlas.nodes.map((node) => [node.id, node.colorHsl]));
        const styleLabDefaults = new Set(Object.values(DEFAULT_ENTITY_COLORS));
        expect(colors.get('embed:graph-fact:co')).toBe('215 10% 62%');
        expect(colors.get('embed:graph-fact:observe')).toBe('188 82% 62%');
        expect(colors.get('embed:graph-fact:comment')).toBe('162 72% 57%');
        expect(styleLabDefaults.has(colors.get('embed:graph-fact:co') || '')).toBe(false);
        expect(styleLabDefaults.has(colors.get('embed:graph-fact:observe') || '')).toBe(false);
        expect(styleLabDefaults.has(colors.get('embed:graph-fact:comment') || '')).toBe(false);
        expect(atlas.sourceLabel).toContain('graph rebuild snapshot');
    });
});
