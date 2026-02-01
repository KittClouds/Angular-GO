import { Injectable, computed, signal, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { combineLatest } from 'rxjs';
import { NotesService } from '../lib/dexie/notes.service';
import { FolderService } from '../lib/services/folder.service';
import { Note, Folder } from '../lib/dexie/db';
import {
    CalendarDefinition,
    FantasyDate,
    CalendarEvent,
    MonthDefinition,
    EraDefinition,
    WeekdayDefinition,
    Period,
    EditorScope,
    EntityRef,
    CausalChain,
    TimeMarker,
    OrbitalMechanics,
    EpochDefinition
} from '../lib/fantasy-calendar/types';

// Re-export EditorScope for consumers
export type { EditorScope } from '../lib/fantasy-calendar/types';
import {
    getDaysInMonth,
    formatYearWithEra,
    navigateYear as utilNavigateYear,
    generateUUID
} from '../lib/fantasy-calendar/utils';
import { generateOrbitalCalendar } from '../lib/fantasy-calendar/orbital';

// Config interface for creating a calendar
export interface CalendarConfig {
    name: string;
    startingYear: number;
    eraName: string;
    eraAbbreviation: string;
    monthNames: string[];
    weekdayNames: string[];
    orbitalMechanics?: OrbitalMechanics;
    eras?: EraDefinition[];
    epochs?: EpochDefinition[];
    timeMarkers?: TimeMarker[];
    hasYearZero?: boolean;
}

// Default calendar implementation
export const DEFAULT_CALENDAR: CalendarDefinition = {
    id: 'cal_default',
    name: 'New World Calendar',
    hoursPerDay: 24,
    minutesPerHour: 60,
    secondsPerMinute: 60,
    weekdays: Array.from({ length: 7 }, (_, i) => ({
        id: `wd_${i}`, index: i, name: `Day ${i + 1}`, shortName: `D${i + 1}`
    })),
    months: Array.from({ length: 12 }, (_, i) => ({
        id: `mo_${i}`, index: i, name: `Month ${i + 1}`, shortName: `M${i + 1}`, days: 30
    })),
    eras: [{ id: 'era_1', name: 'Common Era', abbreviation: 'CE', startYear: 1, direction: 'ascending' }],
    defaultEraId: 'era_1',
    epochs: [],
    timeMarkers: [],
    hasYearZero: false,
    moons: [{ id: 'moon_1', name: 'Luna', cycleDays: 28, color: '#e2e8f0' }],
    seasons: [],
    createdFrom: 'manual'
};

@Injectable({
    providedIn: 'root'
})
export class CalendarService {
    // === STATE SIGNALS ===
    private notesService = inject(NotesService);
    private folderService = inject(FolderService);

    // === STATE SIGNALS ===
    readonly calendar = signal<CalendarDefinition>(DEFAULT_CALENDAR);

    // Derived events from NotesService (Single Source of Truth)
    readonly events = toSignal(
        combineLatest([
            this.notesService.getNotesByEntityKind$('EVENT'),
            this.folderService.getAllFolders$()
        ]).pipe(
            map(([notes, folders]) => {
                const noteEvents = notes.map(note => this.mapNoteToEvent(note));
                const folderEvents = folders
                    .filter(f => f.metadata?.date)
                    .map(f => this.mapFolderToEvent(f));
                return [...noteEvents, ...folderEvents];
            })
        ),
        { initialValue: [] }
    );


    readonly periods = signal<Period[]>([]);
    readonly viewDate = signal<FantasyDate>({ year: 1, monthIndex: 0, dayIndex: 0 });
    readonly highlightedEventId = signal<string | null>(null);
    readonly editorScope = signal<EditorScope>('day');
    readonly isGenerating = signal<boolean>(false);

    // === COMPUTED VALUES ===
    readonly currentMonth = computed(() => {
        const cal = this.calendar();
        const date = this.viewDate();
        return cal.months[date.monthIndex] || cal.months[0];
    });

    readonly daysInCurrentMonth = computed(() => {
        return getDaysInMonth(this.currentMonth(), this.viewDate().year);
    });

    readonly viewYearFormatted = computed(() => {
        return formatYearWithEra(this.calendar(), this.viewDate().year);
    });

    readonly eventsForCurrentMonth = computed(() => {
        const allEvents = this.events();
        const date = this.viewDate();
        // Intentionally not filtering by entity focus yet (can add later)
        return allEvents.filter(e =>
            e.date.year === date.year &&
            e.date.monthIndex === date.monthIndex
        );
    });

    readonly scopedEvents = computed(() => {
        const scope = this.editorScope();
        const events = this.events();
        const viewDate = this.viewDate();
        const currentMonth = this.currentMonth();
        const daysInMonth = this.daysInCurrentMonth();
        const monthEvents = this.eventsForCurrentMonth();

        switch (scope) {
            case 'day':
                return events.filter(e =>
                    e.date.year === viewDate.year &&
                    e.date.monthIndex === viewDate.monthIndex &&
                    e.date.dayIndex === viewDate.dayIndex
                );
            case 'week': {
                const weekStart = viewDate.dayIndex; // Simplified: week starts at current day?
                // Actually, let's stick to the React logic: 
                // Logic was: weekStart = viewDate.dayIndex, weekEnd = min(weekStart+6, daysInMonth-1)
                const weekEnd = Math.min(weekStart + 6, daysInMonth - 1);
                return events.filter(e =>
                    e.date.year === viewDate.year &&
                    e.date.monthIndex === viewDate.monthIndex &&
                    e.date.dayIndex >= weekStart &&
                    e.date.dayIndex <= weekEnd
                );
            }
            case 'month':
                return monthEvents;
            case 'period':
                return events; // Return all for now, logic needed for actual period filter
            default:
                return events;
        }
    });

    constructor() {
        // Load from localStorage if available (simple persistence for now)
        const savedCal = localStorage.getItem('fantasy_calendar_def');
        if (savedCal) {
            try {
                this.calendar.set(JSON.parse(savedCal));
            } catch (e) { console.error('Failed to load calendar', e); }
        }

        const savedPeriods = localStorage.getItem('fantasy_calendar_periods');
        if (savedPeriods) {
            try {
                this.periods.set(JSON.parse(savedPeriods));
            } catch (e) { console.error('Failed to load periods', e); }
        }

        // Auto-save effect
        effect(() => {
            localStorage.setItem('fantasy_calendar_def', JSON.stringify(this.calendar()));
            // Events are now handled by Dexie/NotesService, no need to save to localStorage
            localStorage.setItem('fantasy_calendar_periods', JSON.stringify(this.periods()));
        });
    }

    // === NAVIGATION ===

    navigateMonth(dir: 'prev' | 'next') {
        const current = this.viewDate();
        const cal = this.calendar();

        let newMonth = current.monthIndex + (dir === 'next' ? 1 : -1);
        let newYear = current.year;

        if (newMonth < 0) {
            newMonth = cal.months.length - 1;
            newYear = utilNavigateYear(current.year, 'prev', cal.hasYearZero);
        } else if (newMonth >= cal.months.length) {
            newMonth = 0;
            newYear = utilNavigateYear(current.year, 'next', cal.hasYearZero);
        }

        this.viewDate.set({ ...current, monthIndex: newMonth, year: newYear, dayIndex: 0 });
    }

    navigateYear(dir: 'prev' | 'next') {
        const current = this.viewDate();
        const cal = this.calendar();
        this.viewDate.set({
            ...current,
            year: utilNavigateYear(current.year, dir, cal.hasYearZero)
        });
    }

    navigateDay(dir: 'prev' | 'next') {
        const current = this.viewDate();
        const cal = this.calendar();
        const daysInMonth = getDaysInMonth(cal.months[current.monthIndex], current.year);

        let newDay = current.dayIndex + (dir === 'next' ? 1 : -1);
        let newMonth = current.monthIndex;
        let newYear = current.year;

        if (newDay < 0) {
            newMonth = current.monthIndex - 1;
            if (newMonth < 0) {
                newMonth = cal.months.length - 1;
                newYear = utilNavigateYear(current.year, 'prev', cal.hasYearZero);
            }
            const prevMonthDef = cal.months[newMonth];
            // simplified logic
            newDay = getDaysInMonth(prevMonthDef, newYear) - 1;
        } else if (newDay >= daysInMonth) {
            newMonth = current.monthIndex + 1;
            if (newMonth >= cal.months.length) {
                newMonth = 0;
                newYear = utilNavigateYear(current.year, 'next', cal.hasYearZero);
            }
            newDay = 0;
        }

        this.viewDate.set({ ...current, dayIndex: newDay, monthIndex: newMonth, year: newYear });
    }

    selectDay(dayIndex: number) {
        this.viewDate.update(d => ({ ...d, dayIndex }));
    }

    goToYear(year: number) {
        this.viewDate.update(d => ({ ...d, year, monthIndex: 0, dayIndex: 0 }));
    }

    // === EVENT CRUD ===

    // === EVENT CRUD ===

    async addEvent(eventData: Omit<CalendarEvent, 'id' | 'calendarId'>): Promise<string> {
        const tempId = generateUUID();
        const fullEvent: CalendarEvent = {
            ...eventData,
            id: tempId,
            calendarId: this.calendar().id,
            createdAt: new Date().toISOString()
        };

        const note = this.mapEventToNote(fullEvent);
        // We use the ID from generateUUID mostly, but createNote generates a new ID.
        // Actually, createNote ignores the ID passed in Omit<..., 'id'>.
        // But we want to ensure the link. 
        // NotesService.createNote returns a Promise<string> of the new ID.
        // So we should probably let NotesService handle the ID, or if we need to control it, we might need a different method.
        // For now, let's just create it and let the signal update the UI.

        return this.notesService.createNote(note);
    }

    async updateEvent(id: string, updates: Partial<CalendarEvent>) {
        // We need to fetch the existing note to merge the content
        // Since we don't have direct sync access to the note object here easily without subscription,
        // we can assume the 'events' signal has the latest data, or we can just fetch the note.
        // But 'updates' might contain 'date' which is inside the JSON content.

        const currentEvent = this.events().find(e => e.id === id);
        if (!currentEvent) return;

        const updatedEvent = { ...currentEvent, ...updates, updatedAt: new Date().toISOString() };
        const noteUpdates: Partial<Note> = {
            title: updatedEvent.title,
            updatedAt: Date.now(),
            content: JSON.stringify(updatedEvent),
            markdownContent: updatedEvent.description || '' // Keep description visible in markdown preview
        };

        await this.notesService.updateNote(id, noteUpdates);
    }

    async removeEvent(id: string) {
        await this.notesService.deleteNote(id);
    }

    async toggleEventStatus(id: string) {
        const event = this.events().find(e => e.id === id);
        if (!event) return;

        const statusCycle: Record<string, 'todo' | 'in-progress' | 'completed'> = {
            'undefined': 'in-progress',
            'todo': 'in-progress',
            'in-progress': 'completed',
            'completed': 'todo'
        };

        const currentStatus = event.status || 'todo';
        await this.updateEvent(id, { status: statusCycle[currentStatus] });
    }

    // === MAPPERS ===

    private mapNoteToEvent(note: Note): CalendarEvent {
        let eventData: Partial<CalendarEvent> = {};
        try {
            eventData = JSON.parse(note.content);
        } catch (e) {
            console.error('Failed to parse event data for note', note.id, e);
            // Fallback for broken JSON
        }

        return {
            id: note.id,
            calendarId: eventData.calendarId || this.calendar().id,
            title: note.title,
            date: eventData.date || { year: 1, monthIndex: 0, dayIndex: 0 },
            endDate: eventData.endDate,
            color: eventData.color,
            description: eventData.description,
            importance: eventData.importance,
            type: eventData.type,
            entityId: eventData.entityId,
            tags: eventData.tags,
            status: eventData.status,
            createdAt: new Date(note.createdAt).toISOString(),
            updatedAt: new Date(note.updatedAt).toISOString()
        };
    }

    private mapEventToNote(event: CalendarEvent): Omit<Note, 'id' | 'createdAt' | 'updatedAt'> {
        return {
            worldId: 'default', // TODO: support multiple worlds
            title: event.title,
            content: JSON.stringify(event),
            markdownContent: event.description || '',
            folderId: '', // Root or specific events folder?
            entityKind: 'EVENT',
            entitySubtype: event.type || '',
            isEntity: true, // It shows up in the file tree
            isPinned: false,
            favorite: false,
            ownerId: 'local',
            narrativeId: '',
            order: 0 // Default order
        };
    }

    // === PERIOD CONFIG ===

    addPeriod(periodData: Omit<Period, 'id' | 'calendarId'>): Period {
        const newPeriod: Period = {
            ...periodData,
            id: generateUUID(),
            calendarId: this.calendar().id,
            createdAt: new Date().toISOString()
        };
        this.periods.update(list => [...list, newPeriod]);
        return newPeriod;
    }

    updatePeriod(id: string, updates: Partial<Period>) {
        this.periods.update(list =>
            list.map(p => p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p)
        );
    }

    removePeriod(id: string) {
        this.periods.update(list => list.filter(p => p.id !== id));
    }

    // === EDITOR SCOPE ===

    setEditorScope(scope: EditorScope) {
        this.editorScope.set(scope);
    }

    getEventsForScope(): CalendarEvent[] {
        return this.scopedEvents();
    }

    // Export EditorScope type for consumers


    // === CALENDAR GENERATION ===

    private mapFolderToEvent(folder: Folder): CalendarEvent {
        // Default assumption: use metadata date or fallback to year 1
        const date = folder.metadata?.date || { year: 1, monthIndex: 0, dayIndex: 0 };
        return {
            id: folder.id,
            calendarId: this.calendar().id,
            title: folder.name,
            date: date,
            color: folder.color || '#3b82f6', // Default blue if no color
            description: `Entity Folder: ${folder.entityKind}`,
            importance: 'major', // Acts/Chapters are usually major
            type: folder.entityKind, // e.g., 'ACT', 'CHAPTER'
            status: 'completed', // Folders "exist", so they are "completed" events? Or just generic.
            entityId: folder.id, // Link back to folder
            tags: [folder.entityKind],
            createdAt: new Date(folder.createdAt).toISOString(),
            updatedAt: new Date(folder.updatedAt).toISOString()
        };
    }

    async createCalendar(config: CalendarConfig) {
        this.isGenerating.set(true);

        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 500));

        const calId = generateUUID();
        const eraId = generateUUID();

        // Default months if none
        let months: MonthDefinition[] = config.monthNames.map((name, i) => ({
            id: generateUUID(),
            index: i,
            name: name || `Month ${i + 1}`,
            shortName: name?.substring(0, 3) || `M${i + 1}`,
            days: 30
        }));

        if (months.length === 0) {
            for (let i = 0; i < 12; i++) {
                months.push({
                    id: generateUUID(),
                    index: i,
                    name: `Month ${i + 1}`,
                    shortName: `M${i + 1}`,
                    days: 30
                });
            }
        }

        const era: EraDefinition = {
            id: eraId,
            name: config.eraName || 'Common Era',
            abbreviation: config.eraAbbreviation || 'CE',
            startYear: 1,
            direction: 'ascending'
        };

        const weekdays: WeekdayDefinition[] = (config.weekdayNames || []).map((name, i) => ({
            id: generateUUID(),
            index: i,
            name: name || `Day ${i + 1}`,
            shortName: `D${i + 1}`
        }));

        if (weekdays.length === 0) {
            // Default 7 days
            for (let i = 0; i < 7; i++) {
                weekdays.push({ id: generateUUID(), index: i, name: `Day ${i + 1}`, shortName: `D${i + 1}` });
            }
        }

        const eras = config.eras && config.eras.length > 0 ? config.eras : [era];

        const newCalendar: CalendarDefinition = {
            ...DEFAULT_CALENDAR,
            id: calId,
            name: config.name || 'Unnamed Calendar',
            weekdays,
            months,
            eras,
            defaultEraId: eras[0].id,
            epochs: config.epochs || [],
            timeMarkers: config.timeMarkers || [],
            hasYearZero: config.hasYearZero ?? false,
            orbitalMechanics: config.orbitalMechanics,
            createdFrom: config.orbitalMechanics ? 'orbital' : 'manual'
        };

        this.calendar.set(newCalendar);
        this.viewDate.set({
            year: config.startingYear || 1,
            monthIndex: 0,
            dayIndex: 0,
            eraId: eras[0].id
        });

        this.isGenerating.set(false);
    }
}
