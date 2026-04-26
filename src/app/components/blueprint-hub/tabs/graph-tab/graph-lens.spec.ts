import { describe, expect, it } from 'vitest';
import type { RegisteredEntity } from '../../../../lib/registry';
import { buildGraphLensView, type GraphLensState } from './graph-lens';
import type { AtlasPreviewEdge } from './graph-atlas-preview/graph-atlas-preview.component';

describe('graph lens scoping', () => {
    const entities = [
        entity('a', 'Aella', 'note-a'),
        entity('b', 'Bram', 'note-a'),
        entity('c', 'Cyra', 'note-b'),
    ];
    const edges: AtlasPreviewEdge[] = [
        edge('ab', 'a', 'b'),
        edge('ac', 'a', 'c'),
        edge('bc', 'b', 'c'),
    ];

    it('includes only entities present in a single note lens', () => {
        const view = viewFor({ mode: 'note', primaryNoteId: 'note-a', selectedNoteIds: ['note-a'] });

        expect(view.entities.map((item) => item.id)).toEqual(['a', 'b']);
    });

    it('excludes note lens edges whose endpoint is outside the note', () => {
        const view = viewFor({ mode: 'note', primaryNoteId: 'note-a', selectedNoteIds: ['note-a'] });

        expect(view.edges.map((item) => item.id)).toEqual(['ab']);
    });

    it('duplicates multi-note visual nodes while preserving source entity ids', () => {
        const view = viewFor({
            mode: 'multiNote',
            primaryNoteId: 'note-a',
            selectedNoteIds: ['note-a', 'note-b'],
        });

        const aella = view.entities.find((item) => item.id === 'note-a:a');
        expect(aella?.metadata?.['sourceEntityId']).toBe('a');
        expect(view.entities.some((item) => item.id === 'note-b:c')).toBe(true);
    });

    it('marks the primary note galaxy as foreground', () => {
        const view = viewFor({
            mode: 'multiNote',
            primaryNoteId: 'note-a',
            selectedNoteIds: ['note-a', 'note-b'],
        });

        expect(view.entities.find((item) => item.id === 'note-a:a')?.metadata?.['galaxyRole']).toBe('primary');
        expect(view.entities.find((item) => item.id === 'note-b:c')?.metadata?.['galaxyRole']).toBe('context');
    });

    function viewFor(lens: GraphLensState) {
        return buildGraphLensView({
            lens,
            notes: [
                { id: 'note-a', title: 'Note A' },
                { id: 'note-b', title: 'Note B' },
            ],
            globalEntities: entities,
            narrativeEntities: entities,
            globalEdges: edges,
            narrativeEdges: edges,
            memberships: [
                { noteId: 'note-a', entityId: 'a' },
                { noteId: 'note-a', entityId: 'b' },
                { noteId: 'note-b', entityId: 'c' },
            ],
        });
    }
});

function entity(id: string, label: string, firstNote: string): RegisteredEntity {
    return {
        id,
        label,
        kind: 'CHARACTER' as any,
        aliases: [],
        firstNote,
        mentionsByNote: new Map([[firstNote, 1]]),
        totalMentions: 1,
        lastSeenDate: new Date(2),
        createdAt: new Date(1),
        createdBy: 'user',
        registeredAt: 1,
    };
}

function edge(id: string, sourceId: string, targetId: string): AtlasPreviewEdge {
    return { id, sourceId, targetId, type: 'co-occurs', confidence: 1 };
}
