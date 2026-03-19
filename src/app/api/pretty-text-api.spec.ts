import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const runMock = vi.fn();
const addCandidatesMock = vi.fn();

vi.mock('../lib/Scanner', () => ({
    getDecorationStyle: vi.fn(() => ''),
    getDecorationClass: vi.fn(() => ''),
}));

vi.mock('../lib/Scanner/anchor-utils', () => ({
    realignSpans: vi.fn((spans) => spans),
}));

vi.mock('../lib/Scanner/prosemirror-bridge', () => ({
    extractText: vi.fn(() => ({
        text: 'Kai crossed the room.',
        segments: [{ pmPos: 1, concatStart: 0, length: 21, text: 'Kai crossed the room.' }],
    })),
    docContent: vi.fn(() => 'Kai crossed the room.'),
    remapSpans: vi.fn((spans) => spans),
    remapSpansPermissive: vi.fn((spans) => ({ spans, dropped: 0, crossed: 0 })),
}));

vi.mock('../lib/Scanner/keyword-focus', () => ({
    createKeywordFocusSpans: vi.fn(() => []),
}));

vi.mock('../lib/Scanner/highlight-scanner', () => ({
    HighlightScanner: class HighlightScanner { }
}));

vi.mock('../lib/Scanner/discovery-scanner', () => ({
    DiscoveryScanner: class DiscoveryScanner { }
}));

vi.mock('../lib/Scanner/graph-scanner', () => ({
    GraphScanner: class GraphScanner { }
}));

vi.mock('../lib/Scanner/scan-pipeline', () => ({
    ScanPipeline: class ScanPipeline {
        run = runMock;
    }
}));

vi.mock('../lib/store/highlightingStore', () => ({
    highlightingStore: {
        subscribe: vi.fn(),
        getSettings: vi.fn(() => ({ mode: 'all', focusEntityKinds: [] })),
        getMode: vi.fn(() => 'all'),
        setMode: vi.fn(),
    }
}));

vi.mock('../lib/store/analyticsHighlightStore', () => ({
    analyticsHighlightStore: {
        subscribe: vi.fn(),
        getSelection: vi.fn(() => null),
        clearForNote: vi.fn(),
        setSelection: vi.fn(),
        toggleSelection: vi.fn(),
        clear: vi.fn(),
    }
}));

vi.mock('../lib/store/keywordHighlightStore', () => ({
    keywordHighlightStore: {
        subscribe: vi.fn(),
        getKeywordsForNote: vi.fn(() => []),
        setKeywordsForNote: vi.fn(),
        toggleKeyword: vi.fn(),
        clearKeywordsForNote: vi.fn(),
    }
}));

vi.mock('../lib/store/searchHighlightStore', () => ({
    searchHighlightStore: {
        subscribe: vi.fn(),
        getTerms: vi.fn(() => []),
        setTerms: vi.fn(),
        clear: vi.fn(),
    }
}));

vi.mock('../lib/dexie/decorations', () => ({
    getNoteDecorations: vi.fn(async () => null),
    saveNoteDecorations: vi.fn(async () => undefined),
    getDecorationContentHash: vi.fn(async () => null),
    hashContent: vi.fn((text: string) => `hash:${text.length}`),
}));

vi.mock('../lib/registry', () => ({
    smartGraphRegistry: {
        isRegisteredEntity: vi.fn(() => false),
        upsertRelationship: vi.fn(),
    }
}));

vi.mock('./pretty-text-cache', () => ({
    filterCachedEntitySpans: vi.fn((spans) => spans),
}));

vi.mock('../lib/Scanner/scanCoordinatorInstance', () => ({
    getScanCoordinator: vi.fn(() => ({
        onKeystroke: vi.fn(),
        onEntityDecoration: vi.fn(),
    }))
}));

describe('PrettyTextAPI implicit discovery behavior', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        runMock.mockResolvedValue({ highlights: [], discovery: null, graph: null });
        addCandidatesMock.mockClear();
        (globalThis as any).window = new EventTarget();
    });

    afterEach(() => {
        delete (globalThis as any).window;
    });

    async function loadApi() {
        const mod = await import('./pretty-text-api');
        const api = mod.getPrettyTextApi();
        mod.setDiscoveryStore({ addCandidates: addCandidatesMock } as any);
        mod.setGoKittService({} as any);
        return { mod, api };
    }

    it('uses skipDiscovery=true for implicit note-open scans', async () => {
        const { api } = await loadApi();
        api.setNoteId('note-1', 'world-1');

        api.getDecorations({ type: 'doc' } as any);
        await Promise.resolve();

        expect(runMock).toHaveBeenCalledTimes(1);
        expect(runMock.mock.calls[0][1]).toMatchObject({
            skipDiscovery: true,
            noteId: 'note-1',
        });
        expect(addCandidatesMock).not.toHaveBeenCalled();
    });

    it('keeps gokitt-ready rescans discovery-free', async () => {
        const { api } = await loadApi();
        api.setNoteId('note-1', 'world-1');

        window.dispatchEvent(new Event('gokitt-ready'));
        api.getDecorations({ type: 'doc' } as any);
        await Promise.resolve();

        expect(runMock.mock.calls.length).toBeGreaterThan(0);
        expect(runMock.mock.calls.every(([, opts]) => opts.skipDiscovery === true)).toBe(true);
    });

    it('keeps forceRescan discovery-free', async () => {
        const { api } = await loadApi();
        api.setNoteId('note-1', 'world-1');
        (api as any).lastDoc = { type: 'doc' };

        api.forceRescan();
        await Promise.resolve();

        expect(runMock).toHaveBeenCalledTimes(1);
        expect(runMock.mock.calls[0][1]).toMatchObject({
            skipDiscovery: true,
            noteId: 'note-1',
        });
    });
});
