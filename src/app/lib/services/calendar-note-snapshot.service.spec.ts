import {
    Injector,
    runInInjectionContext,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getNoteMock } = vi.hoisted(() => ({
    getNoteMock: vi.fn(),
}));

vi.mock('../operations', () => ({
    getNote: getNoteMock,
}));

import type { CalendarDefinition } from '../fantasy-calendar/types';
import { NotesService } from '../dexie/notes.service';
import {
    CalendarNoteSnapshotService,
    appendCalendarEventSnapshotToDoc,
    appendCalendarEventSnapshotToMarkdown,
    normalizeNoteDocument,
} from './calendar-note-snapshot.service';

const TEST_CALENDAR: CalendarDefinition = {
    id: 'cal-1',
    name: 'Test Calendar',
    hoursPerDay: 24,
    minutesPerHour: 60,
    secondsPerMinute: 60,
    weekdays: [{ id: 'wd-1', index: 0, name: 'Day 1', shortName: 'D1' }],
    months: [{ id: 'mo-1', index: 0, name: 'Month 1', shortName: 'M1', days: 30 }],
    eras: [{ id: 'era-1', name: 'Common Era', abbreviation: 'CE', startYear: 1, direction: 'ascending' }],
    defaultEraId: 'era-1',
    epochs: [],
    timeMarkers: [],
    hasYearZero: false,
    moons: [],
    seasons: [],
    createdFrom: 'manual',
};

describe('CalendarNoteSnapshotService', () => {
    let injector: Injector & { destroy?: () => void };
    let notesServiceMock: { updateNote: ReturnType<typeof vi.fn> };
    let service: CalendarNoteSnapshotService;

    beforeEach(() => {
        notesServiceMock = {
            updateNote: vi.fn().mockResolvedValue(undefined),
        };

        injector = Injector.create({
            providers: [
                { provide: NotesService, useValue: notesServiceMock },
            ],
        }) as Injector & { destroy?: () => void };

        service = runInInjectionContext(injector, () => new CalendarNoteSnapshotService());
    });

    afterEach(() => {
        injector.destroy?.();
        vi.clearAllMocks();
    });

    it('normalizes empty note payloads and appends the snapshot blocks at the end', () => {
        const normalized = normalizeNoteDocument({}, '');
        const nextDoc = appendCalendarEventSnapshotToDoc(
            normalized,
            TEST_CALENDAR,
            { year: 1, monthIndex: 0, dayIndex: 1 },
            'Arrival',
            'The caravan arrives at dusk.'
        );

        expect(nextDoc.content).toEqual([
            expect.objectContaining({
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Event - 2 Month 1, 1 CE' }],
            }),
            expect.objectContaining({
                type: 'paragraph',
                content: [{ type: 'text', text: 'Arrival' }],
            }),
            expect.objectContaining({
                type: 'paragraph',
                content: [{ type: 'text', text: 'The caravan arrives at dusk.' }],
            }),
        ]);
    });

    it('preserves existing blocks and only appends the generated section to the end', () => {
        const doc = {
            type: 'doc' as const,
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: 'Existing Section' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Existing text.' }],
                },
            ],
        };

        const nextDoc = appendCalendarEventSnapshotToDoc(
            doc,
            TEST_CALENDAR,
            { year: 1, monthIndex: 0, dayIndex: 2 },
            'Coronation'
        );

        expect(nextDoc.content.slice(0, 2)).toEqual(doc.content);
        expect(nextDoc.content.slice(-2)).toEqual([
            expect.objectContaining({
                type: 'heading',
                content: [{ type: 'text', text: 'Event - 3 Month 1, 1 CE' }],
            }),
            expect.objectContaining({
                type: 'paragraph',
                content: [{ type: 'text', text: 'Coronation' }],
            }),
        ]);
    });

    it('updates the markdown companion content with the same appended snapshot', () => {
        const doc = {
            type: 'doc' as const,
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'Existing intro.' }],
            }],
        };

        const markdown = appendCalendarEventSnapshotToMarkdown(
            'Existing intro.',
            doc,
            TEST_CALENDAR,
            { year: 1, monthIndex: 0, dayIndex: 0 },
            'Festival',
            'Torches light the streets.'
        );

        expect(markdown).toBe([
            'Existing intro.',
            '',
            '## Event - 1 Month 1, 1 CE',
            '',
            'Festival',
            '',
            'Torches light the streets.',
        ].join('\n'));
    });

    it('writes both JSON content and markdown content when appending a snapshot to a note', async () => {
        getNoteMock.mockResolvedValue({
            id: 'note-1',
            worldId: 'world-1',
            title: 'Chapter One',
            content: '{}',
            markdownContent: '',
            folderId: 'folder-1',
            ownerId: 'local',
            createdAt: 1,
            updatedAt: 1,
            order: 1000,
            narrativeId: 'narr-1',
        });

        await service.appendEventSnapshot({
            noteId: 'note-1',
            calendar: TEST_CALENDAR,
            date: { year: 1, monthIndex: 0, dayIndex: 4 },
            title: 'Council Meeting',
            description: 'Plans are made in secret.',
        });

        expect(notesServiceMock.updateNote).toHaveBeenCalledWith('note-1', {
            content: JSON.stringify({
                type: 'doc',
                content: [
                    {
                        type: 'heading',
                        attrs: { level: 2 },
                        content: [{ type: 'text', text: 'Event - 5 Month 1, 1 CE' }],
                    },
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Council Meeting' }],
                    },
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Plans are made in secret.' }],
                    },
                ],
            }),
            markdownContent: [
                '## Event - 5 Month 1, 1 CE',
                '',
                'Council Meeting',
                '',
                'Plans are made in secret.',
            ].join('\n'),
        });
    });
});
