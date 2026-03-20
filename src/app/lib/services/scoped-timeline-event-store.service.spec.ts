import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedScope } from './scope.service';

const { dbMock, effectMock } = vi.hoisted(() => ({
    dbMock: {
        codexEntries: {
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    sortBy: vi.fn(async () => []),
                })),
            })),
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

vi.mock('../dexie/db', () => ({
    db: dbMock,
}));

import {
    Injector,
    computed,
    runInInjectionContext,
    signal,
} from '@angular/core';
import { ScopeService } from './scope.service';
import { ScopedDocumentService } from './scoped-document.service';
import { ScopedTimelineEventStoreService } from './scoped-timeline-event-store.service';

const NARRATIVE_SCOPE: ResolvedScope = {
    type: 'narrative',
    id: 'narr-1',
    narrativeId: 'narr-1',
    scopeType: 'narrative',
    scopeFolderId: 'narr-1',
    lineageFolderIds: ['narr-1'],
    label: 'Narrative',
};

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function docKey(scopeFolderId: string): string {
    return `${scopeFolderId}:timeline:events`;
}

async function flushEffects(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('ScopedTimelineEventStoreService', () => {
    let injector: Injector & { destroy?: () => void };
    let scopeSignal: ReturnType<typeof signal<ResolvedScope>>;
    let documents: Map<string, unknown>;
    let scopedDocumentsMock: {
        findPayload: ReturnType<typeof vi.fn>;
        getPayload: ReturnType<typeof vi.fn>;
        savePayload: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        documents = new Map<string, unknown>();
        scopeSignal = signal<ResolvedScope>(NARRATIVE_SCOPE);
        scopedDocumentsMock = {
            findPayload: vi.fn(async (scopeFolderId: string) => {
                const value = documents.get(docKey(scopeFolderId));
                return value ? clone(value) : null;
            }),
            getPayload: vi.fn(async (
                scopeFolderId: string,
                _narrativeId: string,
                _namespace: string,
                _documentKey: string,
                defaultValue: unknown,
                fallback?: () => Promise<unknown>
            ) => {
                const existing = documents.get(docKey(scopeFolderId));
                if (existing !== undefined) {
                    return clone(existing);
                }

                const migrated = fallback ? await fallback() : undefined;
                if (migrated !== undefined) {
                    documents.set(docKey(scopeFolderId), clone(migrated));
                    return clone(migrated);
                }

                return clone(defaultValue);
            }),
            savePayload: vi.fn(async (
                scopeFolderId: string,
                _narrativeId: string,
                _namespace: string,
                _documentKey: string,
                payload: unknown
            ) => {
                documents.set(docKey(scopeFolderId), clone(payload));
            }),
        };

        injector = Injector.create({
            providers: [
                {
                    provide: ScopeService,
                    useValue: {
                        resolvedScope: computed(() => scopeSignal()),
                    },
                },
                { provide: ScopedDocumentService, useValue: scopedDocumentsMock },
            ],
        }) as Injector & { destroy?: () => void };
    });

    afterEach(() => {
        injector.destroy?.();
        vi.clearAllMocks();
    });

    async function createService(): Promise<ScopedTimelineEventStoreService> {
        const service = runInInjectionContext(injector, () => new ScopedTimelineEventStoreService());
        await flushEffects();
        return service;
    }

    it('creates, orders, updates, and deletes shared scoped events', async () => {
        documents.set(docKey('narr-1'), {
            events: [
                {
                    id: 'event-2',
                    title: 'Second',
                    description: '',
                    order: 2,
                    entityIds: [],
                    source: 'timeline',
                    createdAt: 20,
                    updatedAt: 20,
                },
                {
                    id: 'event-1',
                    title: 'First',
                    description: '',
                    order: 1,
                    entityIds: [],
                    source: 'timeline',
                    createdAt: 10,
                    updatedAt: 10,
                },
            ],
        });

        const service = await createService();

        expect(service.events().map(event => event.id)).toEqual(['event-1', 'event-2']);

        const created = await service.createEvent({
            title: 'Coronation',
            description: 'The crown passes hands.',
            source: 'calendar',
            calendarDate: { year: 1, monthIndex: 0, dayIndex: 2 },
            linkedNoteId: 'note-1',
            linkedNoteTitle: 'Chapter One',
            status: 'todo',
        });

        expect(created).not.toBeNull();
        expect(created?.order).toBe(3);
        expect(service.events().map(event => event.title)).toEqual(['First', 'Second', 'Coronation']);

        await service.updateEvent(created!.id, {
            title: 'Coronation Revised',
            status: 'completed',
            displayTime: '3 Month 1, 1 CE',
        });

        const updated = service.events().find(event => event.id === created!.id);
        expect(updated).toMatchObject({
            title: 'Coronation Revised',
            status: 'completed',
            displayTime: '3 Month 1, 1 CE',
            linkedNoteId: 'note-1',
            source: 'calendar',
        });

        await service.deleteEvent('event-1');

        expect(service.events().map(event => event.id)).toEqual(['event-2', created!.id]);
        expect(scopedDocumentsMock.savePayload).toHaveBeenCalled();
        expect(documents.get(docKey('narr-1'))).toEqual({
            events: expect.arrayContaining([
                expect.objectContaining({ id: 'event-2', title: 'Second' }),
                expect.objectContaining({ id: created!.id, title: 'Coronation Revised' }),
            ]),
        });
    });

    it('normalizes legacy scoped timeline payloads that do not include the new calendar fields', async () => {
        documents.set(docKey('narr-1'), {
            events: [
                {
                    id: 'legacy-1',
                    title: 'Legacy Event',
                    order: 7,
                    entityIds: ['entity-1'],
                    displayTime: 'Dawn',
                    createdAt: 1,
                    updatedAt: 2,
                },
            ],
        });

        const service = await createService();

        expect(service.events()).toEqual([
            expect.objectContaining({
                id: 'legacy-1',
                title: 'Legacy Event',
                description: '',
                order: 7,
                entityIds: ['entity-1'],
                displayTime: 'Dawn',
                source: 'timeline',
                linkedNoteId: undefined,
                linkedNoteTitle: undefined,
                calendarDate: undefined,
            }),
        ]);
    });
});
