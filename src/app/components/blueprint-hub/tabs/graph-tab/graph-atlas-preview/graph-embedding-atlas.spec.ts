import { describe, expect, it } from 'vitest';
import type { NoteBlockProjection } from '../../../../../lib/dexie/db';
import { buildLeafEmbeddingAtlas } from './graph-embedding-atlas';

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
});
