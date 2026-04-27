import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
    ɵChangeDetectionScheduler as ChangeDetectionScheduler,
    ɵEffectScheduler as EffectScheduler,
    type EnvironmentInjector
} from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/store/note-editor.store', () => ({
    NoteEditorStore: class NoteEditorStore {},
}));

vi.mock('./editor.service', () => ({
    EditorService: class EditorService {},
}));

vi.mock('dexie', () => ({
    liveQuery: vi.fn((query: () => unknown) => Promise.resolve().then(query)),
}));

const { entityNoteIndexRows } = vi.hoisted(() => ({
    entityNoteIndexRows: [] as Array<{ noteId: string; generation: number }>,
}));

vi.mock('../lib/dexie/db', () => ({
    Mention: class Mention {},
    db: {
        notes: {
            count: vi.fn(async () => 0),
        },
        entities: {
            count: vi.fn(async () => 0),
        },
        mentions: {
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    toArray: vi.fn(async () => []),
                    filter: vi.fn(() => ({
                        count: vi.fn(async () => 0),
                    })),
                    count: vi.fn(async () => 0),
                })),
            })),
        },
        entityNoteIndex: {
            where: vi.fn(() => ({
                equals: vi.fn((noteId: string) => ({
                    toArray: vi.fn(async () => entityNoteIndexRows.filter(row => row.noteId === noteId)),
                })),
            })),
        },
    },
}));

const { analyzeTextMock } = vi.hoisted(() => ({
    analyzeTextMock: vi.fn(),
}));

const {
    scheduleLoadedNoteEntityOccurrenceRebuildMock,
    syncLiveNoteEntityOccurrencesMock,
} = vi.hoisted(() => ({
    scheduleLoadedNoteEntityOccurrenceRebuildMock: vi.fn(),
    syncLiveNoteEntityOccurrencesMock: vi.fn(),
}));

vi.mock('../lib/notes/entity-occurrence-index', () => ({
    scheduleLoadedNoteEntityOccurrenceRebuild: scheduleLoadedNoteEntityOccurrenceRebuildMock,
    syncLiveNoteEntityOccurrences: syncLiveNoteEntityOccurrencesMock,
}));

vi.mock('../lib/analytics', async () => {
    const actual = await vi.importActual<typeof import('../lib/analytics')>('../lib/analytics');
    return {
        ...actual,
        analyzeText: analyzeTextMock,
    };
});

import { getEmptyAnalytics, type TextAnalytics } from '../lib/analytics';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { EditorService } from './editor.service';
import { FooterStatsService } from './footer-stats.service';

function makeAnalytics(overrides: Partial<TextAnalytics> = {}): TextAnalytics {
    return {
        ...getEmptyAnalytics(),
        wordCount: 2,
        characterCount: 11,
        characterCountNoSpaces: 10,
        sentenceCount: 1,
        paragraphCount: 1,
        keywordDensity: [{ word: 'hello', count: 1, percentage: 50 }],
        ...overrides,
    };
}

function runEffectHandle(handle: { dirty?: boolean; run: () => void }) {
    if (handle.dirty === false) {
        return;
    }

    handle.run();
}

describe('FooterStatsService live analytics', () => {
    let injector: EnvironmentInjector;
    let liveUpdateSubject: Subject<any>;
    let activeNoteSubject: BehaviorSubject<any>;
    let noteStoreMock: {
        activeNote$: BehaviorSubject<any>;
        activeNoteId: ReturnType<typeof signal>;
        isSaving: ReturnType<typeof signal>;
    };
    let editorServiceMock: { liveUpdate$: Subject<any>; recordAnalyticsRequest: ReturnType<typeof vi.fn> };
    let changeDetectionSchedulerMock: { notify: ReturnType<typeof vi.fn>; runningTick: boolean };
    let effectSchedulerMock: {
        add: ReturnType<typeof vi.fn>;
        schedule: ReturnType<typeof vi.fn>;
        flush: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
    };
    let service: FooterStatsService;

    beforeEach(() => {
        vi.useFakeTimers();

        liveUpdateSubject = new Subject<any>();
        activeNoteSubject = new BehaviorSubject<any>(undefined);
        noteStoreMock = {
            activeNote$: activeNoteSubject,
            activeNoteId: signal<string | null>(null),
            isSaving: signal(false),
        };
        analyzeTextMock.mockReset();
        entityNoteIndexRows.length = 0;
        scheduleLoadedNoteEntityOccurrenceRebuildMock.mockReset();
        scheduleLoadedNoteEntityOccurrenceRebuildMock.mockResolvedValue(undefined);
        syncLiveNoteEntityOccurrencesMock.mockReset();
        syncLiveNoteEntityOccurrencesMock.mockResolvedValue(undefined);
        editorServiceMock = {
            liveUpdate$: liveUpdateSubject,
            recordAnalyticsRequest: vi.fn(),
        };
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
                runEffectHandle(handle);
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
            { provide: NoteEditorStore, useValue: noteStoreMock },
            { provide: EditorService, useValue: editorServiceMock },
            { provide: ChangeDetectionScheduler, useValue: changeDetectionSchedulerMock },
            { provide: EffectScheduler, useValue: effectSchedulerMock },
        ], Injector.create({ providers: [] }));

        service = runInInjectionContext(injector, () => new FooterStatsService());
    });

    afterEach(() => {
        injector.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('updates analytics from live editor content after the debounce', async () => {
        const payload = makeAnalytics();
        analyzeTextMock.mockReturnValue(payload);

        liveUpdateSubject.next({ noteId: 'note-1', revision: 1, plainText: 'hello world', textLength: 11, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(300);

        expect(analyzeTextMock).toHaveBeenCalledWith('hello world');
        expect(service.analytics()).toEqual(payload);
        expect(service.plainText()).toBe('hello world');
        expect(editorServiceMock.recordAnalyticsRequest).not.toHaveBeenCalled();
    });

    it('resets analytics to empty for blank content and malformed local payloads', async () => {
        analyzeTextMock.mockReturnValue(makeAnalytics());
        liveUpdateSubject.next({ noteId: 'note-1', revision: 1, plainText: 'hello world', textLength: 11, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(300);
        expect(service.analytics().wordCount).toBe(2);

        liveUpdateSubject.next({ noteId: 'note-1', revision: 2, plainText: '', textLength: 0, timings: { plainTextMs: 1 } });
        expect(service.analytics()).toEqual(getEmptyAnalytics());
        await vi.advanceTimersByTimeAsync(300);
        expect(analyzeTextMock).toHaveBeenCalledTimes(1);

        analyzeTextMock.mockReturnValueOnce({ invalid: true });
        liveUpdateSubject.next({ noteId: 'note-1', revision: 3, plainText: 'bad payload', textLength: 11, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(300);
        expect(service.analytics()).toEqual(getEmptyAnalytics());
    });

    it('accepts enriched analytics payloads and normalizes partial section payloads', async () => {
        const enriched = makeAnalytics({
            repetition: {
                totalFlags: 1,
                items: [{
                    id: 'echo:iron-gate',
                    phrase: 'iron gate',
                    occurrenceCount: 3,
                    severity: 'medium',
                    snippets: ['The iron gate slammed shut.'],
                    highlightRanges: [{ from: 4, to: 13, text: 'iron gate' }],
                }],
            },
            proximity: {
                totalFlags: 1,
                items: [{
                    id: 'prox:ember',
                    root: 'ember',
                    surfaceForms: ['embers', 'ember-lit'],
                    partOfSpeech: 'noun',
                    minWordDistance: 4,
                    severity: 'low',
                    snippets: ['Bright embers glowed beside the ember-lit grate.'],
                    highlightRanges: [
                        { from: 7, to: 13, text: 'embers' },
                        { from: 32, to: 41, text: 'ember-lit' },
                    ],
                }],
            },
            cadence: {
                sentences: [{
                    id: 'cadence:0',
                    paragraphIndex: 0,
                    sentenceIndex: 0,
                    from: 0,
                    to: 24,
                    wordCount: 4,
                    bucket: '2-6',
                    snippet: 'Short beat. Tiny pause.',
                }],
                hotspots: [{
                    id: 'cadence:whiplash:0',
                    type: 'whiplash',
                    label: '4 -> 22 words',
                    severity: 'medium',
                    explanation: 'Abrupt rhythm jump detected.',
                    sentenceIds: ['cadence:0', 'cadence:1'],
                    highlightRanges: [{ from: 0, to: 24, text: 'Short beat. Tiny pause.' }],
                }],
            },
        });

        analyzeTextMock.mockReturnValue(enriched);
        liveUpdateSubject.next({ noteId: 'note-1', revision: 1, plainText: 'Short beat. Tiny pause.', textLength: 23, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(300);

        expect(service.analytics()).toEqual(enriched);

        const partial = {
            wordCount: 4,
            characterCount: 21,
            characterCountNoSpaces: 18,
            sentenceCount: 2,
            paragraphCount: 1,
            flowScore: 84,
            keywordDensity: [{ word: 'kai', count: 2, percentage: 50 }],
        };

        analyzeTextMock.mockReturnValueOnce(partial);
        liveUpdateSubject.next({ noteId: 'note-1', revision: 2, plainText: 'Kai moved. Kai spoke.', textLength: 21, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(300);

        expect(service.analytics()).toEqual({
            ...getEmptyAnalytics(),
            ...partial,
        });

        analyzeTextMock.mockReturnValueOnce({
            ...enriched,
            repetition: { totalFlags: 1 },
        });
        liveUpdateSubject.next({ noteId: 'note-1', revision: 3, plainText: 'Broken repetition payload', textLength: 25, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(300);

        expect(service.analytics()).toEqual({
            ...enriched,
            repetition: getEmptyAnalytics().repetition,
        });
    });

    it('recomputes analytics from the latest live editor text on successive edits', async () => {
        liveUpdateSubject.next({ noteId: 'note-1', revision: 1, plainText: 'first draft', textLength: 11, timings: { plainTextMs: 1 } });
        analyzeTextMock.mockReturnValueOnce(makeAnalytics({ wordCount: 99, characterCount: 999 }));
        await vi.advanceTimersByTimeAsync(300);

        expect(service.analytics()).toEqual(makeAnalytics({ wordCount: 99, characterCount: 999 }));

        liveUpdateSubject.next({ noteId: 'note-1', revision: 2, plainText: 'second draft', textLength: 12, timings: { plainTextMs: 1 } });
        const latest = makeAnalytics({ wordCount: 3, characterCount: 12, characterCountNoSpaces: 11 });
        analyzeTextMock.mockReturnValueOnce(latest);
        await vi.advanceTimersByTimeAsync(300);

        expect(service.analytics()).toEqual(latest);
    });

    it('refreshes live signal rows from editor text after the live debounce', async () => {
        noteStoreMock.activeNoteId.set('note-1');

        liveUpdateSubject.next({ noteId: 'note-1', revision: 7, plainText: 'Aella walked.', textLength: 13, timings: { plainTextMs: 1 } });
        expect(service.signalLifecycle()).toBe('queued');
        await vi.advanceTimersByTimeAsync(449);
        expect(syncLiveNoteEntityOccurrencesMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(syncLiveNoteEntityOccurrencesMock).toHaveBeenCalledWith('note-1', 'Aella walked.', 7);
        expect(service.signalLifecycle()).toBe('idle');
    });

    it('coalesces rapid live signal refreshes and keeps only the latest text', async () => {
        noteStoreMock.activeNoteId.set('note-1');

        liveUpdateSubject.next({ noteId: 'note-1', revision: 1, plainText: 'Aella', textLength: 5, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(100);
        liveUpdateSubject.next({ noteId: 'note-1', revision: 2, plainText: 'Aella and Kai.', textLength: 14, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(449);
        expect(syncLiveNoteEntityOccurrencesMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(syncLiveNoteEntityOccurrencesMock).toHaveBeenCalledTimes(1);
        expect(syncLiveNoteEntityOccurrencesMock).toHaveBeenCalledWith('note-1', 'Aella and Kai.', 2);
    });

    it('ignores live signal updates from stale notes', async () => {
        noteStoreMock.activeNoteId.set('note-2');

        liveUpdateSubject.next({ noteId: 'note-1', revision: 1, plainText: 'Aella walked.', textLength: 13, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(1000);

        expect(syncLiveNoteEntityOccurrencesMock).not.toHaveBeenCalled();
    });

    it('does not rescan signals just because a note was opened when rows are already fresh', async () => {
        noteStoreMock.activeNoteId.set('note-1');
        entityNoteIndexRows.push({ noteId: 'note-1', generation: 10 });

        activeNoteSubject.next({
            id: 'note-1',
            content: '',
            markdownContent: 'Aella walked.',
            version: 10,
            updatedAt: 10,
        });

        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1000);

        expect(syncLiveNoteEntityOccurrencesMock).not.toHaveBeenCalled();
    });

    it('keeps live signal snapshots per note so switching back is warm', async () => {
        noteStoreMock.activeNoteId.set('note-1');
        liveUpdateSubject.next({ noteId: 'note-1', revision: 7, plainText: 'Aella walked.', textLength: 13, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(450);
        expect(syncLiveNoteEntityOccurrencesMock).toHaveBeenCalledTimes(1);

        noteStoreMock.activeNoteId.set('note-2');
        liveUpdateSubject.next({ noteId: 'note-2', revision: 3, plainText: 'Kai waited.', textLength: 11, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(450);
        expect(syncLiveNoteEntityOccurrencesMock).toHaveBeenCalledTimes(2);

        noteStoreMock.activeNoteId.set('note-1');
        liveUpdateSubject.next({ noteId: 'note-1', revision: 8, plainText: 'Aella walked.', textLength: 13, timings: { plainTextMs: 1 } });
        await vi.advanceTimersByTimeAsync(1000);

        expect(syncLiveNoteEntityOccurrencesMock).toHaveBeenCalledTimes(2);
    });
});
