import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { db } from '../dexie/db';
import { ScopeService } from './scope.service';
import { ScopedDocumentService } from './scoped-document.service';
import type { EventImportance, EventCategory, FantasyDate } from '../fantasy-calendar/types';

export type ScopedTimelineEventSource = 'calendar' | 'timeline';
export type ScopedTimelineEventStatus = 'todo' | 'in-progress' | 'completed' | 'draft' | 'locked';

export interface ScopedTimelineEventRecord {
    id: string;
    title: string;
    description: string;
    order: number;
    entityIds: string[];
    displayTime?: string;
    linkedNoteId?: string;
    linkedNoteTitle?: string;
    calendarDate?: FantasyDate;
    source: ScopedTimelineEventSource;
    status?: ScopedTimelineEventStatus;
    color?: string;
    eventTypeId?: string;
    importance?: EventImportance;
    category?: EventCategory;
    type?: string;
    tags?: string[];
    createdAt: number;
    updatedAt: number;
}

export interface ScopedTimelineEventDocument {
    events: ScopedTimelineEventRecord[];
}

export interface CreateScopedTimelineEventInput {
    title: string;
    description?: string;
    entityIds?: string[];
    displayTime?: string;
    linkedNoteId?: string;
    linkedNoteTitle?: string;
    calendarDate?: FantasyDate;
    source: ScopedTimelineEventSource;
    status?: ScopedTimelineEventStatus;
    color?: string;
    eventTypeId?: string;
    importance?: EventImportance;
    category?: EventCategory;
    type?: string;
    tags?: string[];
}

export interface UpdateScopedTimelineEventInput extends Partial<CreateScopedTimelineEventInput> {
    order?: number;
}

const TIMELINE_NAMESPACE = 'timeline';
const TIMELINE_KEY = 'events';

export const DEFAULT_SCOPED_TIMELINE_DOCUMENT: ScopedTimelineEventDocument = { events: [] };

interface TimelineReadContext {
    narrativeId: string;
    readScopeFolderId: string;
    writeScopeFolderId: string;
    doc: ScopedTimelineEventDocument;
}

@Injectable({
    providedIn: 'root'
})
export class ScopedTimelineEventStoreService {
    private readonly scopeService = inject(ScopeService);
    private readonly scopedDocuments = inject(ScopedDocumentService);

    readonly events = signal<ScopedTimelineEventRecord[]>([]);
    readonly isLoading = signal(false);
    readonly activeScope = computed(() => this.scopeService.resolvedScope());

    private readonly refreshTick = signal(0);
    private latestLoadId = 0;

    constructor() {
        effect(() => {
            this.activeScope();
            this.refreshTick();
            void this.loadEventsForActiveScope();
        });
    }

    refresh(): void {
        this.refreshTick.update(value => value + 1);
    }

    async createEvent(input: CreateScopedTimelineEventInput): Promise<ScopedTimelineEventRecord | null> {
        const context = await this.getWritableContext();
        if (!context) {
            return null;
        }

        const now = Date.now();
        const nextOrder = context.doc.events.reduce((max, event) => Math.max(max, event.order), 0) + 1;
        const event = this.normalizeEvent({
            ...input,
            id: crypto.randomUUID(),
            order: nextOrder,
            createdAt: now,
            updatedAt: now,
        });

        context.doc.events.push(event);
        await this.saveDocument(context);
        this.events.set(this.sortEvents(context.doc.events));
        this.refresh();
        return event;
    }

    async updateEvent(id: string, updates: UpdateScopedTimelineEventInput): Promise<void> {
        const context = await this.getWritableContext();
        if (!context) {
            return;
        }

        const index = context.doc.events.findIndex(event => event.id === id);
        if (index === -1) {
            return;
        }

        const existing = context.doc.events[index];
        context.doc.events[index] = this.normalizeEvent({
            ...existing,
            ...updates,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: Date.now(),
        });

        await this.saveDocument(context);
        this.events.set(this.sortEvents(context.doc.events));
        this.refresh();
    }

    async deleteEvent(id: string): Promise<void> {
        const context = await this.getWritableContext();
        if (!context) {
            return;
        }

        const nextEvents = context.doc.events.filter(event => event.id !== id);
        if (nextEvents.length === context.doc.events.length) {
            return;
        }

        context.doc.events = nextEvents;
        await this.saveDocument(context);
        this.events.set(this.sortEvents(context.doc.events));
        this.refresh();
    }

    private async loadEventsForActiveScope(): Promise<void> {
        const loadId = ++this.latestLoadId;
        this.isLoading.set(true);

        try {
            const context = await this.getReadContext();
            if (loadId !== this.latestLoadId) {
                return;
            }

            this.events.set(context ? this.sortEvents(context.doc.events) : []);
        } finally {
            if (loadId === this.latestLoadId) {
                this.isLoading.set(false);
            }
        }
    }

    private async getReadContext(): Promise<TimelineReadContext | null> {
        const scope = this.activeScope();
        const narrativeId = scope.narrativeId;
        if (!narrativeId || scope.scopeFolderId === 'vault:global') {
            return null;
        }

        const exact = await this.scopedDocuments.findPayload(
            scope.scopeFolderId,
            TIMELINE_NAMESPACE,
            TIMELINE_KEY,
            DEFAULT_SCOPED_TIMELINE_DOCUMENT
        );

        if (exact) {
            return {
                narrativeId,
                readScopeFolderId: scope.scopeFolderId,
                writeScopeFolderId: scope.scopeFolderId,
                doc: this.normalizeDocument(exact),
            };
        }

        if (scope.scopeFolderId !== narrativeId) {
            const narrativeDoc = await this.scopedDocuments.getPayload(
                narrativeId,
                narrativeId,
                TIMELINE_NAMESPACE,
                TIMELINE_KEY,
                DEFAULT_SCOPED_TIMELINE_DOCUMENT,
                async () => this.loadLegacyTimelineDocument(narrativeId)
            );

            return {
                narrativeId,
                readScopeFolderId: narrativeId,
                writeScopeFolderId: scope.scopeFolderId,
                doc: this.normalizeDocument(narrativeDoc),
            };
        }

        const rootDoc = await this.scopedDocuments.getPayload(
            narrativeId,
            narrativeId,
            TIMELINE_NAMESPACE,
            TIMELINE_KEY,
            DEFAULT_SCOPED_TIMELINE_DOCUMENT,
            async () => this.loadLegacyTimelineDocument(narrativeId)
        );

        return {
            narrativeId,
            readScopeFolderId: narrativeId,
            writeScopeFolderId: narrativeId,
            doc: this.normalizeDocument(rootDoc),
        };
    }

    private async getWritableContext(): Promise<TimelineReadContext | null> {
        const context = await this.getReadContext();
        if (!context) {
            return null;
        }

        return {
            ...context,
            doc: this.cloneDocument(context.doc),
        };
    }

    private async saveDocument(context: TimelineReadContext): Promise<void> {
        const seededFromScopeFolderId = context.readScopeFolderId !== context.writeScopeFolderId
            ? context.readScopeFolderId
            : undefined;

        await this.scopedDocuments.savePayload(
            context.writeScopeFolderId,
            context.narrativeId,
            TIMELINE_NAMESPACE,
            TIMELINE_KEY,
            context.doc,
            seededFromScopeFolderId
        );
    }

    private async loadLegacyTimelineDocument(narrativeId: string): Promise<ScopedTimelineEventDocument | undefined> {
        const legacy = await db.codexEntries
            .where('[narrativeId+entryType]')
            .equals([narrativeId, 'event'])
            .sortBy('order');

        if (legacy.length === 0) {
            return undefined;
        }

        return {
            events: legacy.map(entry => this.normalizeEvent({
                id: entry.id,
                title: entry.title,
                description: entry.description,
                order: entry.order,
                entityIds: entry.entityIds,
                displayTime: entry.displayTime,
                linkedNoteId: entry.linkedNoteId,
                source: 'timeline',
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
            })),
        };
    }

    private normalizeDocument(doc: Partial<ScopedTimelineEventDocument> | null | undefined): ScopedTimelineEventDocument {
        return {
            events: Array.isArray(doc?.events)
                ? doc.events.map(event => this.normalizeEvent(event))
                : [],
        };
    }

    private normalizeEvent(event: Partial<ScopedTimelineEventRecord>): ScopedTimelineEventRecord {
        const createdAt = typeof event.createdAt === 'number' ? event.createdAt : Date.now();
        return {
            id: typeof event.id === 'string' ? event.id : crypto.randomUUID(),
            title: typeof event.title === 'string' ? event.title : 'Untitled Event',
            description: typeof event.description === 'string' ? event.description : '',
            order: typeof event.order === 'number' ? event.order : 0,
            entityIds: Array.isArray(event.entityIds) ? event.entityIds.filter((id): id is string => typeof id === 'string') : [],
            displayTime: typeof event.displayTime === 'string' ? event.displayTime : undefined,
            linkedNoteId: typeof event.linkedNoteId === 'string' ? event.linkedNoteId : undefined,
            linkedNoteTitle: typeof event.linkedNoteTitle === 'string' ? event.linkedNoteTitle : undefined,
            calendarDate: this.normalizeFantasyDate(event.calendarDate),
            source: event.source === 'calendar' ? 'calendar' : 'timeline',
            status: this.normalizeStatus(event.status),
            color: typeof event.color === 'string' ? event.color : undefined,
            eventTypeId: typeof event.eventTypeId === 'string' ? event.eventTypeId : undefined,
            importance: this.normalizeImportance(event.importance),
            category: this.normalizeCategory(event.category),
            type: typeof event.type === 'string' ? event.type : undefined,
            tags: Array.isArray(event.tags) ? event.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
            createdAt,
            updatedAt: typeof event.updatedAt === 'number' ? event.updatedAt : createdAt,
        };
    }

    private normalizeFantasyDate(date: unknown): FantasyDate | undefined {
        if (!date || typeof date !== 'object') {
            return undefined;
        }

        const candidate = date as Partial<FantasyDate>;
        if (
            typeof candidate.year !== 'number' ||
            typeof candidate.monthIndex !== 'number' ||
            typeof candidate.dayIndex !== 'number'
        ) {
            return undefined;
        }

        return {
            year: candidate.year,
            monthIndex: candidate.monthIndex,
            dayIndex: candidate.dayIndex,
            eraId: typeof candidate.eraId === 'string' ? candidate.eraId : undefined,
            hour: typeof candidate.hour === 'number' ? candidate.hour : undefined,
            minute: typeof candidate.minute === 'number' ? candidate.minute : undefined,
        };
    }

    private normalizeStatus(status: unknown): ScopedTimelineEventStatus | undefined {
        switch (status) {
            case 'todo':
            case 'in-progress':
            case 'completed':
            case 'draft':
            case 'locked':
                return status;
            default:
                return undefined;
        }
    }

    private normalizeImportance(importance: unknown): EventImportance | undefined {
        switch (importance) {
            case 'trivial':
            case 'minor':
            case 'moderate':
            case 'major':
            case 'critical':
                return importance;
            default:
                return undefined;
        }
    }

    private normalizeCategory(category: unknown): EventCategory | undefined {
        switch (category) {
            case 'general':
            case 'battle':
            case 'political':
            case 'personal':
            case 'discovery':
            case 'disaster':
            case 'celebration':
            case 'death':
            case 'birth':
            case 'travel':
            case 'custom':
                return category;
            default:
                return undefined;
        }
    }

    private sortEvents(events: ScopedTimelineEventRecord[]): ScopedTimelineEventRecord[] {
        return [...events].sort((a, b) => {
            if (a.order !== b.order) {
                return a.order - b.order;
            }
            return a.createdAt - b.createdAt;
        });
    }

    private cloneDocument(doc: ScopedTimelineEventDocument): ScopedTimelineEventDocument {
        return JSON.parse(JSON.stringify(doc)) as ScopedTimelineEventDocument;
    }
}
