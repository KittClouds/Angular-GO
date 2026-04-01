import { describe, expect, it, vi } from 'vitest';

import { AnalyticsHighlightStore } from './analyticsHighlightStore';

describe('AnalyticsHighlightStore', () => {
    it('keeps detail highlights single-select while toggling the same selection off', () => {
        const store = new AnalyticsHighlightStore();
        const listener = vi.fn();
        store.subscribe(listener);

        const firstSelection = {
            noteId: 'note-1',
            key: 'echo:iron-gate',
            kind: 'repetition' as const,
            label: 'iron gate',
            ranges: [{ from: 1, to: 5, text: 'iron' }],
            paletteKey: 'repetition' as const,
        };
        const secondSelection = {
            ...firstSelection,
            key: 'echo:amber-door',
            label: 'amber door',
        };

        store.toggleSelection(firstSelection);
        expect(store.getDetailSelection()).toEqual(firstSelection);

        store.toggleSelection(secondSelection);
        expect(store.getDetailSelection()).toEqual(secondSelection);

        store.toggleSelection(secondSelection);
        expect(store.getDetailSelection()).toBeNull();
        expect(listener).toHaveBeenCalledTimes(3);
    });

    it('tracks derived sentence-variation selections independently from detail highlights', () => {
        const store = new AnalyticsHighlightStore();
        store.setSelection({
            noteId: 'note-1',
            key: 'cadence:whiplash:2',
            kind: 'cadence',
            label: '12 -> 29 words',
            ranges: [{ from: 10, to: 20, text: 'sentence' }],
            paletteKey: 'cadence',
        });

        store.setSentenceVariationHighlights('note-1', new Set(['1', '7-15']), [
            {
                noteId: 'note-1',
                key: 'sentence-variation:1',
                kind: 'sentence_variation',
                label: '1 word',
                ranges: [{ from: 0, to: 5, text: 'Tiny.' }],
                paletteKey: '1',
            },
            {
                noteId: 'note-1',
                key: 'sentence-variation:7-15',
                kind: 'sentence_variation',
                label: '7-15 words',
                ranges: [{ from: 6, to: 42, text: 'This sentence has seven words total.' }],
                paletteKey: '7-15',
            },
        ]);

        expect(store.getSelections('note-1')).toHaveLength(3);
        expect(store.getVariationSelections('note-1')).toHaveLength(2);
        expect(Array.from(store.getActiveVariationBuckets('note-1')).sort()).toEqual(['1', '7-15']);

        store.clearDetailSelection();
        expect(store.getDetailSelection()).toBeNull();
        expect(store.getVariationSelections('note-1')).toHaveLength(2);

        store.clearSentenceVariationHighlights('note-1');
        expect(store.getVariationSelections('note-1')).toHaveLength(0);
        expect(store.getActiveVariationBuckets('note-1').size).toBe(0);
    });
});
