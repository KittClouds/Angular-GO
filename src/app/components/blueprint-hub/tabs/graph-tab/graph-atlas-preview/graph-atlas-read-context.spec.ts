import { describe, expect, it } from 'vitest';

import { buildGraphAtlasReadContext, graphLensState } from './graph-atlas-read-context';

describe('graph atlas read context', () => {
    it('keeps the global lens independent from selected notes', () => {
        const context = buildGraphAtlasReadContext(graphLensState('global', 'note-a', ['note-a']));

        expect(context.lensMode).toBe('global');
        expect(context.noteIds).toEqual([]);
        expect(context.searchScope).toEqual({ mode: 'global' });
        expect(context.key).toBe('global');
    });

    it('keeps the narrative lens from inheriting the active editor note', () => {
        const context = buildGraphAtlasReadContext(graphLensState('narrative', 'note-a', ['note-a']));

        expect(context.lensMode).toBe('narrative');
        expect(context.noteIds).toEqual([]);
        expect(context.searchScope).toEqual({ mode: 'narrative' });
        expect(context.key).toBe('narrative');
    });

    it('uses only the explicit note for note lens reads', () => {
        const context = buildGraphAtlasReadContext(graphLensState('note', 'note-b', ['note-a']));

        expect(context.noteIds).toEqual(['note-b']);
        expect(context.searchScope).toEqual({ mode: 'note', noteId: 'note-b' });
        expect(context.key).toBe('note:note-b');
    });

    it('uses deterministic unique note ids for compare lens reads', () => {
        const context = buildGraphAtlasReadContext(graphLensState('multiNote', 'note-b', ['note-a', 'note-b', 'note-a']));

        expect(context.primaryNoteId).toBe('note-b');
        expect(context.noteIds).toEqual(['note-a', 'note-b']);
        expect(context.searchScope).toEqual({ mode: 'multiNote', noteIds: ['note-a', 'note-b'] });
        expect(context.key).toBe('multi:note-a|note-b');
    });
});
