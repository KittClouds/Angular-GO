import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
    type EnvironmentInjector,
} from '@angular/core';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prettyTextApiMock, keywordHighlightStoreMock } = vi.hoisted(() => ({
    prettyTextApiMock: {
        setSearchHighlightTerms: vi.fn(),
        clearSearchHighlights: vi.fn(),
        clearAnalyticsHighlights: vi.fn(),
        toggleAnalyticsHighlights: vi.fn(),
    },
    keywordHighlightStoreMock: {
        subscribe: vi.fn(() => () => undefined),
        getKeywordsForNote: vi.fn(() => []),
        toggleKeyword: vi.fn(),
    },
}));

vi.mock('../../api/pretty-text-api', () => ({
    getPrettyTextApi: () => prettyTextApiMock,
}));

vi.mock('../../lib/store/keywordHighlightStore', () => ({
    keywordHighlightStore: keywordHighlightStoreMock,
}));

import { AnalyticsPanelComponent } from './analytics-panel.component';
import { getEmptyAnalytics } from '../../lib/analytics';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { NotesService } from '../../lib/dexie/notes.service';
import { EditorService } from '../../services/editor.service';
import { FooterStatsService } from '../../services/footer-stats.service';
import { GoKittService } from '../../services/gokitt.service';
import { Router } from '@angular/router';

describe('AnalyticsPanelComponent search highlights', () => {
    let injector: EnvironmentInjector;
    let component: AnalyticsPanelComponent;
    let goKittMock: { search: ReturnType<typeof vi.fn> };
    let noteStoreMock: {
        activeNoteId: ReturnType<typeof signal>;
        activeNote$: BehaviorSubject<any>;
        currentNote: ReturnType<typeof signal>;
        openNote: ReturnType<typeof vi.fn>;
    };
    let editorContentSubject: Subject<{ json: object; markdown: string }>;

    beforeEach(() => {
        vi.clearAllMocks();

        goKittMock = {
            search: vi.fn(),
        };
        editorContentSubject = new Subject<{ json: object; markdown: string }>();
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

        injector = createEnvironmentInjector([
            { provide: GoKittService, useValue: goKittMock },
            { provide: NoteEditorStore, useValue: noteStoreMock },
            {
                provide: NotesService,
                useValue: {
                    getAllNotes$: () => of([
                        { id: 'note-1', title: 'First Note' },
                        { id: 'note-2', title: 'Second Note' },
                    ]),
                },
            },
            {
                provide: FooterStatsService,
                useValue: {
                    analytics: signal({
                        ...getEmptyAnalytics(),
                        wordCount: 1,
                    }),
                },
            },
            {
                provide: EditorService,
                useValue: {
                    content$: editorContentSubject,
                },
            },
            { provide: Router, useValue: { navigate: vi.fn() } },
        ], Injector.create({ providers: [] }));

        component = runInInjectionContext(injector, () => new AnalyticsPanelComponent());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('applies parsed search highlight terms when analytics search runs', async () => {
        goKittMock.search.mockResolvedValue([{ docID: 'note-2', score: 0.92 }]);

        await component.performSearch('"red gold" Kai');

        expect(prettyTextApiMock.setSearchHighlightTerms).toHaveBeenCalledWith(['red gold', 'kai']);
        expect(goKittMock.search).toHaveBeenCalledWith('"red gold" Kai', 10);
        expect(component.searchResults()).toEqual([
            { id: 'note-2', score: 0.92, title: 'Second Note' },
        ]);
    });

    it('clears results and transient highlights for blank searches', async () => {
        component.searchResults.set([{ id: 'note-1', score: 0.5, title: 'First Note' }]);

        await component.performSearch('   ');

        expect(component.searchResults()).toEqual([]);
        expect(prettyTextApiMock.clearSearchHighlights).toHaveBeenCalledTimes(1);
        expect(goKittMock.search).not.toHaveBeenCalled();
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
        goKittMock.search.mockResolvedValue([{ id: 'note-1', score: 1 }]);

        await component.performSearch('Kai');
        component.openNoteResult('note-1');

        expect(noteStoreMock.openNote).toHaveBeenCalledWith('note-1');
        expect(prettyTextApiMock.setSearchHighlightTerms).toHaveBeenCalledWith(['kai']);
        expect(prettyTextApiMock.clearSearchHighlights).not.toHaveBeenCalled();
    });

    it('adds the open note as a local result when live editor text matches but qgram returns nothing', async () => {
        goKittMock.search.mockResolvedValue([]);

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
        goKittMock.search.mockRejectedValue(new Error('worker failed'));

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

    it('clears transient analytics highlights when switching views', () => {
        component.activeHighlightId.set('echo:iron-gate');

        component.setActiveView('repetition');

        expect(component.activeAnalyticsView()).toBe('repetition');
        expect(component.activeHighlightId()).toBeNull();
        expect(prettyTextApiMock.clearAnalyticsHighlights).toHaveBeenCalledTimes(1);
    });

    it('toggles analytics highlights for the active note and clears stale selection first', () => {
        component.activeHighlightId.set('old-selection');

        component.toggleAnalyticsHighlight('echo:iron-gate', 'repetition', 'iron gate', [
            { from: 0, to: 9, text: 'iron gate' },
        ]);

        expect(prettyTextApiMock.clearAnalyticsHighlights).toHaveBeenCalledTimes(1);
        expect(prettyTextApiMock.toggleAnalyticsHighlights).toHaveBeenCalledWith(
            'active-note',
            'echo:iron-gate',
            'repetition',
            'iron gate',
            [{ from: 0, to: 9, text: 'iron gate' }],
        );
        expect(component.activeHighlightId()).toBe('echo:iron-gate');
    });

    it('resets the local analytics highlight state when the active note changes', () => {
        component.activeHighlightId.set('cadence:whiplash:0');

        noteStoreMock.activeNote$.next({
            id: 'next-note',
            title: 'Next Note',
            content: JSON.stringify({
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Next note text' }] }],
            }),
        });

        expect(component.activeHighlightId()).toBeNull();
    });
});
