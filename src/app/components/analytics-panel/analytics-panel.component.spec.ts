import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    computed,
    signal,
    ɵChangeDetectionScheduler as ChangeDetectionScheduler,
    ɵEffectScheduler as EffectScheduler,
    type EnvironmentInjector,
} from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prettyTextApiMock, keywordHighlightStoreMock } = vi.hoisted(() => ({
    prettyTextApiMock: {
        setSearchHighlightTerms: vi.fn(),
        clearSearchHighlights: vi.fn(),
        clearAnalyticsHighlights: vi.fn(),
        clearAnalyticsDetailHighlights: vi.fn(),
        toggleAnalyticsHighlights: vi.fn(),
        setSentenceVariationHighlights: vi.fn(),
        clearSentenceVariationHighlights: vi.fn(),
    },
    keywordHighlightStoreMock: {
        subscribe: vi.fn(),
        getKeywordsForNote: vi.fn(() => []),
        toggleKeyword: vi.fn(),
    },
}));

const { settingsStoreMock } = vi.hoisted(() => ({
    settingsStoreMock: new Map<string, unknown>(),
}));

vi.mock('../../api/pretty-text-api', () => ({
    getPrettyTextApi: () => prettyTextApiMock,
}));

vi.mock('../../lib/store/keywordHighlightStore', () => ({
    keywordHighlightStore: keywordHighlightStoreMock,
}));

vi.mock('../../lib/dexie/settings.service', () => ({
    getSetting: <T>(key: string, defaultValue: T): T => (
        settingsStoreMock.has(key) ? settingsStoreMock.get(key) as T : defaultValue
    ),
    setSetting: <T>(key: string, value: T): void => {
        settingsStoreMock.set(key, value);
    },
}));

import { AnalyticsPanelComponent } from './analytics-panel.component';
import { getEmptyAnalytics } from '../../lib/analytics';
import { analyticsHighlightStore } from '../../lib/store/analyticsHighlightStore';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { NotesService } from '../../lib/dexie/notes.service';
import { FooterStatsService } from '../../services/footer-stats.service';
import { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';
import { Router } from '@angular/router';

describe('AnalyticsPanelComponent search highlights', () => {
    let injector: EnvironmentInjector;
    let component: AnalyticsPanelComponent;
    let phoenixUiApiMock: { search: ReturnType<typeof vi.fn> };
    let noteStoreMock: {
        activeNoteId: ReturnType<typeof signal>;
        activeNote$: BehaviorSubject<any>;
        currentNote: ReturnType<typeof signal>;
        openNote: ReturnType<typeof vi.fn>;
    };
    let notesSubject: BehaviorSubject<Array<{ id: string; title: string }>>;
    let keywordStoreUnsubscribe: ReturnType<typeof vi.fn>;
    let footerAnalyticsSignal: ReturnType<typeof signal>;
    let footerPlainTextSignal: ReturnType<typeof signal>;
    let changeDetectionSchedulerMock: { notify: ReturnType<typeof vi.fn>; runningTick: boolean };
    let effectSchedulerMock: {
        add: ReturnType<typeof vi.fn>;
        schedule: ReturnType<typeof vi.fn>;
        flush: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
    };

    function createComponent(): void {
        vi.clearAllMocks();

        phoenixUiApiMock = {
            search: vi.fn(),
        };
        const activeNote = {
            id: 'active-note',
            title: 'Active Note',
            content: JSON.stringify({
                type: 'doc',
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'shirt shirt jacket' }],
                }],
            }),
        };

        noteStoreMock = {
            activeNoteId: signal<string | null>('active-note'),
            activeNote$: new BehaviorSubject(activeNote),
            currentNote: signal(activeNote),
            openNote: vi.fn(),
        };
        notesSubject = new BehaviorSubject([
            { id: 'note-1', title: 'First Note' },
            { id: 'note-2', title: 'Second Note' },
        ]);
        keywordStoreUnsubscribe = vi.fn();
        keywordHighlightStoreMock.subscribe.mockReturnValue(keywordStoreUnsubscribe);
        footerAnalyticsSignal = signal({
            ...getEmptyAnalytics(),
            wordCount: 1,
        });
        footerPlainTextSignal = signal('shirt shirt jacket');
        changeDetectionSchedulerMock = {
            notify: vi.fn(),
            runningTick: false,
        };
        const scheduledEffects = new Set<{ dirty?: boolean; run: () => void }>();
        let flushPending = false;
        const flushEffects = () => {
            flushPending = false;
            for (const handle of Array.from(scheduledEffects)) {
                scheduledEffects.delete(handle);
                if (handle.dirty === false) {
                    continue;
                }
                handle.run();
            }
        };
        const scheduleEffects = () => {
            if (flushPending) {
                return;
            }

            flushPending = true;
            Promise.resolve().then(flushEffects);
        };
        effectSchedulerMock = {
            add: vi.fn((handle) => {
                scheduledEffects.add(handle);
                scheduleEffects();
            }),
            schedule: vi.fn((handle) => {
                scheduledEffects.add(handle);
                scheduleEffects();
            }),
            flush: vi.fn(flushEffects),
            remove: vi.fn((handle) => {
                scheduledEffects.delete(handle);
            }),
        };

        injector = createEnvironmentInjector([
            { provide: PhoenixUiApiService, useValue: phoenixUiApiMock },
            { provide: NoteEditorStore, useValue: noteStoreMock },
            {
                provide: NotesService,
                useValue: {
                    getAllNotes$: () => notesSubject,
                },
            },
            {
                provide: FooterStatsService,
                useValue: {
                    analytics: footerAnalyticsSignal,
                    plainText: computed(() => footerPlainTextSignal()),
                },
            },
            { provide: ChangeDetectionScheduler, useValue: changeDetectionSchedulerMock },
            { provide: EffectScheduler, useValue: effectSchedulerMock },
            { provide: Router, useValue: { navigate: vi.fn() } },
        ], Injector.create({ providers: [] }));

        component = runInInjectionContext(injector, () => new AnalyticsPanelComponent());
    }

    beforeEach(() => {
        settingsStoreMock.clear();
        analyticsHighlightStore.clear();
        createComponent();
    });

    afterEach(() => {
        analyticsHighlightStore.clear();
        injector?.destroy();
    });

    it('applies parsed search highlight terms when analytics search runs', async () => {
        phoenixUiApiMock.search.mockResolvedValue([{ docID: 'note-2', score: 0.92 }]);

        await component.performSearch('"red gold" Kai');

        expect(prettyTextApiMock.setSearchHighlightTerms).toHaveBeenCalledWith(['red gold', 'kai']);
        expect(phoenixUiApiMock.search).toHaveBeenCalledWith('"red gold" Kai', 10);
        expect(component.searchResults()).toEqual([
            { id: 'note-2', score: 0.92, title: 'Second Note' },
        ]);
    });

    it('clears results and transient highlights for blank searches', async () => {
        component.searchResults.set([{ id: 'note-1', score: 0.5, title: 'First Note' }]);

        await component.performSearch('   ');

        expect(component.searchResults()).toEqual([]);
        expect(prettyTextApiMock.clearSearchHighlights).toHaveBeenCalledTimes(1);
        expect(phoenixUiApiMock.search).not.toHaveBeenCalled();
    });

    it('clears only the analytics search highlight state when requested', () => {
        component.searchInput.set('Kai');
        component.searchQuery.set('Kai');
        component.searchResults.set([{ id: 'note-1', score: 0.5, title: 'First Note' }]);

        component.clearSearchHighlight();

        expect(component.searchInput()).toBe('');
        expect(component.searchQuery()).toBe('');
        expect(component.searchResults()).toEqual([]);
        expect(prettyTextApiMock.clearSearchHighlights).toHaveBeenCalledTimes(1);
    });

    it('keeps the active search highlight in place when opening a result note', async () => {
        phoenixUiApiMock.search.mockResolvedValue([{ id: 'note-1', score: 1 }]);

        await component.performSearch('Kai');
        component.openNoteResult('note-1');

        expect(noteStoreMock.openNote).toHaveBeenCalledWith('note-1');
        expect(prettyTextApiMock.setSearchHighlightTerms).toHaveBeenCalledWith(['kai']);
        expect(prettyTextApiMock.clearSearchHighlights).not.toHaveBeenCalled();
    });

    it('adds the open note as a local result when live editor text matches but qgram returns nothing', async () => {
        phoenixUiApiMock.search.mockResolvedValue([]);

        await component.performSearch('shirt');

        expect(component.searchResults()).toEqual([
            {
                id: 'active-note',
                score: 2,
                title: 'Active Note',
                localMatchCount: 2,
            },
        ]);
    });

    it('still shows the open note local result when qgram search throws', async () => {
        phoenixUiApiMock.search.mockRejectedValue(new Error('worker failed'));

        await component.performSearch('shirt');

        expect(component.searchResults()).toEqual([
            {
                id: 'active-note',
                score: 2,
                title: 'Active Note',
                localMatchCount: 2,
            },
        ]);
    });

    it('clears only the detail analytics highlight when switching views', () => {
        component.activeHighlightId.set('echo:iron-gate');
        component.activeVariationBuckets.set(new Set(['7-15']));
        prettyTextApiMock.clearAnalyticsDetailHighlights.mockClear();

        component.setActiveView('repetition');

        expect(component.activeAnalyticsView()).toBe('repetition');
        expect(component.activeHighlightId()).toBeNull();
        expect(Array.from(component.activeVariationBuckets())).toEqual(['7-15']);
        expect(prettyTextApiMock.clearAnalyticsDetailHighlights).toHaveBeenCalledTimes(1);
    });

    it('toggles analytics detail highlights for the active note without clearing variation toggles', () => {
        component.activeHighlightId.set('old-selection');
        component.activeVariationBuckets.set(new Set(['7-15']));

        component.toggleAnalyticsHighlight('echo:iron-gate', 'repetition', 'iron gate', [
            { from: 0, to: 9, text: 'iron gate' },
        ]);

        expect(prettyTextApiMock.toggleAnalyticsHighlights).toHaveBeenCalledWith(
            'active-note',
            'echo:iron-gate',
            'repetition',
            'iron gate',
            [expect.objectContaining({
                from: 0,
                to: 9,
                text: 'iron gate',
            })],
            undefined,
        );
        expect(component.activeHighlightId()).toBe('echo:iron-gate');
        expect(Array.from(component.activeVariationBuckets())).toEqual(['7-15']);
    });

    it('builds sentence-variation highlights from cadence sentences and tags them with the bucket palette', () => {
        footerPlainTextSignal.set('Tiny. This sentence has seven words total. Another medium sentence lands here.');
        footerAnalyticsSignal.set({
            ...getEmptyAnalytics(),
            wordCount: 13,
            cadence: {
                sentences: [
                    {
                        id: 'sentence:0',
                        paragraphIndex: 0,
                        sentenceIndex: 0,
                        from: 0,
                        to: 5,
                        wordCount: 1,
                        bucket: '1',
                        snippet: 'Tiny.',
                    },
                    {
                        id: 'sentence:1',
                        paragraphIndex: 0,
                        sentenceIndex: 1,
                        from: 6,
                        to: 42,
                        wordCount: 7,
                        bucket: '7-15',
                        snippet: 'This sentence has seven words total.',
                    },
                ],
                hotspots: [],
            },
        });

        component.toggleSentenceVariationHighlight('7-15', '7-15 words');
        effectSchedulerMock.flush();

        expect(prettyTextApiMock.setSentenceVariationHighlights).toHaveBeenCalledWith(
            'active-note',
            new Set(['7-15']),
            [expect.objectContaining({
                key: 'sentence-variation:7-15',
                kind: 'sentence_variation',
                label: '7-15 words',
                paletteKey: '7-15',
                ranges: [expect.objectContaining({
                    from: 6,
                    to: 42,
                    text: 'This sentence has seven words total.',
                })],
            })],
        );
        expect(component.activeHighlightId()).toBeNull();
        expect(Array.from(component.activeVariationBuckets())).toEqual(['7-15']);
    });

    it('allows multiple active sentence-variation highlights and toggles each bucket independently', () => {
        footerPlainTextSignal.set('Tiny.');
        footerAnalyticsSignal.set({
            ...getEmptyAnalytics(),
            wordCount: 1,
            cadence: {
                sentences: [{
                    id: 'sentence:0',
                    paragraphIndex: 0,
                    sentenceIndex: 0,
                    from: 0,
                    to: 5,
                    wordCount: 1,
                    bucket: '1',
                    snippet: 'Tiny.',
                }],
                hotspots: [],
            },
        });

        component.toggleSentenceVariationHighlight('1', '1 word');
        effectSchedulerMock.flush();
        component.toggleSentenceVariationHighlight('1', '1 word');
        effectSchedulerMock.flush();

        expect(prettyTextApiMock.setSentenceVariationHighlights).toHaveBeenCalledWith(
            'active-note',
            new Set(['1']),
            [expect.objectContaining({
                key: 'sentence-variation:1',
                ranges: [expect.objectContaining({ from: 0, to: 5, text: 'Tiny.' })],
            })],
        );
        expect(prettyTextApiMock.clearSentenceVariationHighlights).toHaveBeenCalledWith('active-note');
        expect(component.activeHighlightId()).toBeNull();
        expect(component.activeVariationBuckets().size).toBe(0);
    });

    it('keeps multiple variation buckets active at the same time', () => {
        footerPlainTextSignal.set('Tiny. This sentence has seven words total.');
        footerAnalyticsSignal.set({
            ...getEmptyAnalytics(),
            wordCount: 8,
            cadence: {
                sentences: [
                    {
                        id: 'sentence:0',
                        paragraphIndex: 0,
                        sentenceIndex: 0,
                        from: 0,
                        to: 5,
                        wordCount: 1,
                        bucket: '1',
                        snippet: 'Tiny.',
                    },
                    {
                        id: 'sentence:1',
                        paragraphIndex: 0,
                        sentenceIndex: 1,
                        from: 6,
                        to: 42,
                        wordCount: 7,
                        bucket: '7-15',
                        snippet: 'This sentence has seven words total.',
                    },
                ],
                hotspots: [],
            },
        });

        component.toggleSentenceVariationHighlight('1', '1 word');
        component.toggleSentenceVariationHighlight('7-15', '7-15 words');

        expect(Array.from(component.activeVariationBuckets()).sort()).toEqual(['1', '7-15']);
    });

    it('rebuilds derived sentence-variation selections when analytics refreshes', () => {
        footerPlainTextSignal.set('Tiny.');
        footerAnalyticsSignal.set({
            ...getEmptyAnalytics(),
            wordCount: 1,
            cadence: {
                sentences: [{
                    id: 'sentence:0',
                    paragraphIndex: 0,
                    sentenceIndex: 0,
                    from: 0,
                    to: 5,
                    wordCount: 1,
                    bucket: '1',
                    snippet: 'Tiny.',
                }],
                hotspots: [],
            },
        });

        component.toggleSentenceVariationHighlight('1', '1 word');
        effectSchedulerMock.flush();

        footerPlainTextSignal.set('Tiny. Later.');
        footerAnalyticsSignal.set({
            ...getEmptyAnalytics(),
            wordCount: 2,
            cadence: {
                sentences: [
                    {
                        id: 'sentence:0',
                        paragraphIndex: 0,
                        sentenceIndex: 0,
                        from: 0,
                        to: 5,
                        wordCount: 1,
                        bucket: '1',
                        snippet: 'Tiny.',
                    },
                    {
                        id: 'sentence:1',
                        paragraphIndex: 0,
                        sentenceIndex: 1,
                        from: 6,
                        to: 12,
                        wordCount: 1,
                        bucket: '1',
                        snippet: 'Later.',
                    },
                ],
                hotspots: [],
            },
        });
        effectSchedulerMock.flush();

        expect(prettyTextApiMock.setSentenceVariationHighlights).toHaveBeenLastCalledWith(
            'active-note',
            new Set(['1']),
            [expect.objectContaining({
                key: 'sentence-variation:1',
                ranges: [
                    expect.objectContaining({ from: 0, to: 5, text: 'Tiny.' }),
                    expect.objectContaining({ from: 6, to: 12, text: 'Later.' }),
                ],
            })],
        );
    });

    it('resets the local analytics highlight state when the active note changes', () => {
        component.activeHighlightId.set('cadence:whiplash:0');
        component.activeVariationBuckets.set(new Set(['1', '7-15']));

        noteStoreMock.activeNoteId.set('next-note');
        noteStoreMock.currentNote.set({
            id: 'next-note',
            title: 'Next Note',
            content: JSON.stringify({
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Next note text' }] }],
            }),
        });
        noteStoreMock.activeNote$.next(noteStoreMock.currentNote());

        expect(component.activeHighlightId()).toBeNull();
        expect(component.activeVariationBuckets().size).toBe(0);
    });

    it('restores sentence-variation bucket state from the shared highlight store when the panel remounts', () => {
        analyticsHighlightStore.setSentenceVariationHighlights('active-note', new Set(['1', '7-15']), [
            {
                noteId: 'active-note',
                key: 'sentence-variation:1',
                kind: 'sentence_variation',
                label: '1 word',
                paletteKey: '1',
                ranges: [{ from: 0, to: 5, text: 'Tiny.' }],
            },
            {
                noteId: 'active-note',
                key: 'sentence-variation:7-15',
                kind: 'sentence_variation',
                label: '7-15 words',
                paletteKey: '7-15',
                ranges: [{ from: 6, to: 20, text: 'Longer sentence' }],
            },
        ]);

        injector.destroy();
        createComponent();

        expect(Array.from(component.activeVariationBuckets()).sort()).toEqual(['1', '7-15']);
    });

    it('restores the last active analytics subview when the panel remounts', () => {
        component.setActiveView('cadence');

        injector.destroy();
        createComponent();

        expect(component.activeAnalyticsView()).toBe('cadence');
    });

    it('releases subscriptions and store listeners when the component is destroyed', () => {
        expect(notesSubject.observers.length).toBe(1);
        expect(noteStoreMock.activeNote$.observers.length).toBe(1);

        injector.destroy();
        injector = undefined as unknown as EnvironmentInjector;

        expect(notesSubject.observers.length).toBe(0);
        expect(noteStoreMock.activeNote$.observers.length).toBe(0);
        expect(keywordStoreUnsubscribe).toHaveBeenCalledTimes(1);
    });
});
