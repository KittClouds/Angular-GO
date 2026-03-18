import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchHighlightStore } from './searchHighlightStore';

describe('SearchHighlightStore', () => {
    let store: SearchHighlightStore;

    beforeEach(() => {
        store = new SearchHighlightStore();
    });

    it('stores unique transient search terms', () => {
        store.setTerms(['kai', 'kai', 'red gold']);

        expect(store.getTerms()).toEqual(['kai', 'red gold']);
    });

    it('notifies subscribers when terms change and when cleared', () => {
        const listener = vi.fn();
        store.subscribe(listener);

        store.setTerms(['kai']);
        store.clear();

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('does not emit when the same terms are set repeatedly', () => {
        const listener = vi.fn();
        store.subscribe(listener);

        store.setTerms(['kai', 'hand']);
        store.setTerms(['kai', 'hand']);

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
