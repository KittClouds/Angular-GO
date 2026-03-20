import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, effectMock } = vi.hoisted(() => ({
    dbMock: {
        entities: {
            get: vi.fn(async () => undefined),
        },
    },
    effectMock: vi.fn((callback: () => void) => {
        callback();
        return { destroy: vi.fn() };
    }),
}));

vi.mock('@angular/core', async () => {
    const actual = await vi.importActual<typeof import('@angular/core')>('@angular/core');
    return {
        ...actual,
        effect: effectMock,
    };
});

vi.mock('../../../lib/dexie/db', () => ({
    db: dbMock,
}));

import {
    Injector,
    computed,
    runInInjectionContext,
    signal,
} from '@angular/core';
import type { CalendarDefinition } from '../../../lib/fantasy-calendar/types';
import type { ResolvedScope } from '../../../lib/services/scope.service';
import { ScopeService } from '../../../lib/services/scope.service';
import { ScopedTimelineEventStoreService } from '../../../lib/services/scoped-timeline-event-store.service';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { CalendarService } from '../../../services/calendar.service';
import { TimelineViewComponent } from './timeline-view.component';

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

const ACT_SCOPE: ResolvedScope = {
    type: 'act',
    id: 'act-1',
    narrativeId: 'narr-1',
    actId: 'act-1',
    scopeType: 'act',
    scopeFolderId: 'act-1',
    actFolderId: 'act-1',
    lineageFolderIds: ['narr-1', 'act-1'],
    label: 'Act One',
};

describe('TimelineViewComponent', () => {
    let injector: Injector & { destroy?: () => void };
    let noteEditorStoreMock: { openNote: ReturnType<typeof vi.fn> };
    let timelineStoreMock: {
        events: ReturnType<typeof signal<any[]>>;
        createEvent: ReturnType<typeof vi.fn>;
        deleteEvent: ReturnType<typeof vi.fn>;
    };
    let component: TimelineViewComponent;

    beforeEach(() => {
        noteEditorStoreMock = {
            openNote: vi.fn(),
        };
        timelineStoreMock = {
            events: signal([
                {
                    id: 'event-1',
                    title: 'Festival',
                    description: 'Lanterns fill the streets.',
                    order: 1,
                    entityIds: [],
                    source: 'calendar',
                    linkedNoteId: 'note-1',
                    linkedNoteTitle: 'Festival Prep',
                    calendarDate: { year: 1, monthIndex: 0, dayIndex: 2 },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ]),
            createEvent: vi.fn().mockResolvedValue(undefined),
            deleteEvent: vi.fn().mockResolvedValue(undefined),
        };

        injector = Injector.create({
            providers: [
                {
                    provide: ScopeService,
                    useValue: {
                        resolvedScope: computed(() => ACT_SCOPE),
                    },
                },
                { provide: ScopedTimelineEventStoreService, useValue: timelineStoreMock },
                { provide: NoteEditorStore, useValue: noteEditorStoreMock },
                { provide: CalendarService, useValue: { calendar: signal(TEST_CALENDAR) } },
            ],
        }) as Injector & { destroy?: () => void };

        component = runInInjectionContext(injector, () => new TimelineViewComponent());
    });

    afterEach(() => {
        injector.destroy?.();
        vi.clearAllMocks();
    });

    it('surfaces calendar-created events from the shared store and formats their fantasy date labels', () => {
        expect(component.events()).toEqual([
            expect.objectContaining({
                id: 'event-1',
                source: 'calendar',
                linkedNoteId: 'note-1',
            }),
        ]);
        expect(component.getEventDisplayTime(component.events()[0])).toBe('3 Month 1, 1 CE');
    });

    it('opens the linked note through the note editor store', () => {
        component.openNote('note-1');

        expect(noteEditorStoreMock.openNote).toHaveBeenCalledWith('note-1');
    });
});
