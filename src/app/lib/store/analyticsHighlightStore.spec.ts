import { describe, expect, it, vi } from 'vitest';

import { AnalyticsHighlightStore } from './analyticsHighlightStore';

describe('AnalyticsHighlightStore', () => {
    it('toggles the same selection off', () => {
        const store = new AnalyticsHighlightStore();
        const listener = vi.fn();
        store.subscribe(listener);

        const selection = {
            noteId: 'note-1',
            key: 'echo:iron-gate',
            kind: 'repetition' as const,
            label: 'iron gate',
            ranges: [{ from: 1, to: 5, text: 'iron' }],
        };

        store.toggleSelection(selection);
        expect(store.getSelection()).toEqual(selection);

        store.toggleSelection(selection);
        expect(store.getSelection()).toBeNull();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('clears only matching notes', () => {
        const store = new AnalyticsHighlightStore();
        store.setSelection({
            noteId: 'note-1',
            key: 'cadence:whiplash:2',
            kind: 'cadence',
            label: '12 -> 29 words',
            ranges: [{ from: 10, to: 20, text: 'sentence' }],
        });

        store.clearForNote('note-2');
        expect(store.getSelection()).not.toBeNull();

        store.clearForNote('note-1');
        expect(store.getSelection()).toBeNull();
    });
});
