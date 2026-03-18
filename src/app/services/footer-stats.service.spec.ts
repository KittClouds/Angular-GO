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

vi.mock('./gokitt.service', () => ({
    GoKittService: class GoKittService {},
}));

vi.mock('dexie', () => ({
    liveQuery: vi.fn((query: () => unknown) => Promise.resolve().then(query)),
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
    },
}));

import { getEmptyAnalytics, type TextAnalytics } from '../lib/analytics';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { EditorService } from './editor.service';
import { FooterStatsService } from './footer-stats.service';
import { GoKittService } from './gokitt.service';

function makeDoc(text: string) {
    return {
        type: 'doc',
        content: text
            ? [{
                type: 'paragraph',
                content: [{ type: 'text', text }],
            }]
            : [{ type: 'paragraph' }],
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });

    return { promise, resolve };
}

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
    let contentSubject: Subject<{ json: object; markdown: string }>;
    let activeNoteSubject: BehaviorSubject<any>;
    let noteStoreMock: {
        activeNote$: BehaviorSubject<any>;
        activeNoteId: ReturnType<typeof signal>;
        isSaving: ReturnType<typeof signal>;
    };
    let editorServiceMock: { content$: Subject<{ json: object; markdown: string }> };
    let goKittServiceMock: { analyzeText: ReturnType<typeof vi.fn> };
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

        contentSubject = new Subject<{ json: object; markdown: string }>();
        activeNoteSubject = new BehaviorSubject<any>(undefined);
        noteStoreMock = {
            activeNote$: activeNoteSubject,
            activeNoteId: signal<string | null>(null),
            isSaving: signal(false),
        };
        editorServiceMock = {
            content$: contentSubject,
        };
        goKittServiceMock = {
            analyzeText: vi.fn(),
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
            { provide: GoKittService, useValue: goKittServiceMock },
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
        goKittServiceMock.analyzeText.mockResolvedValue(payload);

        contentSubject.next({ json: makeDoc('hello world'), markdown: 'hello world' });
        await vi.advanceTimersByTimeAsync(300);

        expect(goKittServiceMock.analyzeText).toHaveBeenCalledWith('hello world');
        expect(service.analytics()).toEqual(payload);
    });

    it('resets analytics to empty for blank content and malformed Go payloads', async () => {
        goKittServiceMock.analyzeText.mockResolvedValue(makeAnalytics());
        contentSubject.next({ json: makeDoc('hello world'), markdown: 'hello world' });
        await vi.advanceTimersByTimeAsync(300);
        expect(service.analytics().wordCount).toBe(2);

        contentSubject.next({ json: makeDoc(''), markdown: '' });
        expect(service.analytics()).toEqual(getEmptyAnalytics());
        await vi.advanceTimersByTimeAsync(300);
        expect(goKittServiceMock.analyzeText).toHaveBeenCalledTimes(1);

        goKittServiceMock.analyzeText.mockResolvedValueOnce({ invalid: true });
        contentSubject.next({ json: makeDoc('bad payload'), markdown: 'bad payload' });
        await vi.advanceTimersByTimeAsync(300);
        expect(service.analytics()).toEqual(getEmptyAnalytics());
    });

    it('ignores stale async analytics responses when newer typing arrives', async () => {
        const first = createDeferred<TextAnalytics>();
        const second = createDeferred<TextAnalytics>();

        goKittServiceMock.analyzeText
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise);

        contentSubject.next({ json: makeDoc('first draft'), markdown: 'first draft' });
        await vi.advanceTimersByTimeAsync(300);

        contentSubject.next({ json: makeDoc('second draft'), markdown: 'second draft' });
        await vi.advanceTimersByTimeAsync(300);

        first.resolve(makeAnalytics({ wordCount: 99, characterCount: 999 }));
        await Promise.resolve();
        expect(service.analytics()).toEqual(getEmptyAnalytics());

        const latest = makeAnalytics({ wordCount: 3, characterCount: 12, characterCountNoSpaces: 11 });
        second.resolve(latest);
        await Promise.resolve();

        expect(service.analytics()).toEqual(latest);
    });
});
