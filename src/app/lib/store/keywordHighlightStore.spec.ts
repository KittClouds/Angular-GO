import { describe, expect, it, vi } from 'vitest';

import { KeywordHighlightStore } from './keywordHighlightStore';

describe('KeywordHighlightStore', () => {
    it('toggles keywords per note and persists normalized values', () => {
        const writes: Array<Record<string, string[]>> = [];
        const store = new KeywordHighlightStore(
            vi.fn(() => ({})),
            vi.fn((_key, value) => {
                writes.push(structuredClone(value));
            }),
        );

        store.toggleKeyword('note-1', 'Said');
        store.toggleKeyword('note-1', 'still');
        store.toggleKeyword('note-2', 'Said');

        expect(store.getKeywordsForNote('note-1')).toEqual(['said', 'still']);
        expect(store.getKeywordsForNote('note-2')).toEqual(['said']);
        expect(writes.at(-1)).toEqual({
            'note-1': ['said', 'still'],
            'note-2': ['said'],
        });
    });

    it('removes note state when the last selected keyword is unchecked', () => {
        const store = new KeywordHighlightStore(
            vi.fn(() => ({
                'note-1': ['said'],
            })),
            vi.fn(),
        );

        store.toggleKeyword('note-1', 'said');

        expect(store.getKeywordsForNote('note-1')).toEqual([]);
    });
});
