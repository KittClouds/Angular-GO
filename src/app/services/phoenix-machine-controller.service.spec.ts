import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { entityRows, signalTotal, noteById } = vi.hoisted(() => ({
    entityRows: [] as Array<{ noteId: string; generation: number }>,
    signalTotal: { value: 0 },
    noteById: new Map<string, any>(),
}));

const { syncLiveNoteEntityOccurrencesMock } = vi.hoisted(() => ({
    syncLiveNoteEntityOccurrencesMock: vi.fn(),
}));

vi.mock('../lib/dexie/db', () => ({
    db: {
        notes: {
            get: vi.fn(async (noteId: string) => noteById.get(noteId)),
        },
        entityNoteIndex: {
            where: vi.fn(() => ({
                equals: vi.fn((noteId: string) => ({
                    toArray: vi.fn(async () => entityRows.filter(row => row.noteId === noteId)),
                })),
            })),
        },
    },
}));

vi.mock('../lib/notes/entity-occurrence-rows', () => ({
    getEntitySignalRows: vi.fn(async () => ({
        rows: [],
        breakdown: {
            tagged: 0,
            matched: signalTotal.value,
            evidence: 0,
            suggested: 0,
            total: signalTotal.value,
        },
    })),
}));

vi.mock('../lib/notes/entity-occurrence-index', () => ({
    syncLiveNoteEntityOccurrences: syncLiveNoteEntityOccurrencesMock,
}));

import { NoteEditorStore } from '../lib/store/note-editor.store';
import { EditorService } from './editor.service';
import { PhoenixMachineControllerService } from './phoenix-machine-controller.service';
import { PhoenixUiApiService } from './phoenix-ui-api.service';

describe('PhoenixMachineControllerService', () => {
    let injector: EnvironmentInjector;
    let service: PhoenixMachineControllerService;
    let liveUpdateSubject: Subject<any>;
    let activeNoteSubject: BehaviorSubject<any>;

    beforeEach(() => {
        entityRows.length = 0;
        signalTotal.value = 0;
        noteById.clear();
        syncLiveNoteEntityOccurrencesMock.mockReset();
        syncLiveNoteEntityOccurrencesMock.mockResolvedValue(undefined);

        liveUpdateSubject = new Subject<any>();
        activeNoteSubject = new BehaviorSubject<any>(undefined);

        injector = createEnvironmentInjector([
            PhoenixMachineControllerService,
            {
                provide: EditorService,
                useValue: { liveUpdate$: liveUpdateSubject },
            },
            {
                provide: NoteEditorStore,
                useValue: { activeNote$: activeNoteSubject },
            },
            {
                provide: PhoenixUiApiService,
                useValue: {
                    scanEntityMentionsAsync: vi.fn(async () => []),
                },
            },
        ], Injector.create({ providers: [] }));
        service = runInInjectionContext(injector, () => injector.get(PhoenixMachineControllerService));
    });

    afterEach(() => injector.destroy());

    it('shows cached signals on note open without running a scanner', async () => {
        entityRows.push({ noteId: 'note-1', generation: 10 });
        signalTotal.value = 8;

        await service.noteOpened('note-1', 'Aella walked.', 10);

        expect(service.activeSignals()).toMatchObject({
            noteId: 'note-1',
            status: 'fresh',
            count: 8,
        });
        expect(syncLiveNoteEntityOccurrencesMock).not.toHaveBeenCalled();
    });

    it('marks signals dirty on edit without scanning', async () => {
        await service.noteOpened('note-1', 'Aella walked.', 10);

        liveUpdateSubject.next({
            noteId: 'note-1',
            revision: 11,
            plainText: 'Aella walked home.',
            textLength: 18,
            timings: { plainTextMs: 1 },
        });

        expect(service.activeSignals()).toMatchObject({
            noteId: 'note-1',
            status: 'stale',
            generation: 11,
        });
        expect(service.stages().signals.status).toBe('dirty');
        expect(syncLiveNoteEntityOccurrencesMock).not.toHaveBeenCalled();
    });

    it('runs signal occurrence sync only for an explicit scan command', async () => {
        signalTotal.value = 9;
        noteById.set('note-1', {
            id: 'note-1',
            content: '',
            markdownContent: 'Kai waited.',
            version: 12,
            updatedAt: 12,
        });

        await service.noteOpened('note-1', 'Kai waited.', 12);
        await service.scanSignalsNow('note-1');

        expect(syncLiveNoteEntityOccurrencesMock).toHaveBeenCalledTimes(1);
        expect(syncLiveNoteEntityOccurrencesMock.mock.calls[0].slice(0, 3)).toEqual([
            'note-1',
            'Kai waited.',
            12,
        ]);
        expect(service.activeSignals()).toMatchObject({
            noteId: 'note-1',
            status: 'fresh',
            count: 9,
        });
    });
});
