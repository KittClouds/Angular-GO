import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    noteSnapshots: {
        where: vi.fn(),
        put: vi.fn(),
    },
}));

vi.mock('../dexie/db', () => ({
    db: {
        noteSnapshots: mocks.noteSnapshots,
    },
}));

import { NotesService } from '../dexie/notes.service';
import type { Note, NoteSnapshot } from '../dexie/db';
import { formatSnapshotStamp, NoteSnapshotService } from './note-snapshot.service';

const NOTE: Note = {
    id: 'note-1',
    worldId: 'world-1',
    title: 'Chapter One',
    content: '{}',
    markdownContent: 'The old text.',
    folderId: 'folder-1',
    entityKind: '',
    entitySubtype: '',
    isEntity: false,
    isPinned: false,
    favorite: false,
    ownerId: 'local',
    createdAt: 1,
    updatedAt: 2,
    narrativeId: 'narrative-1',
    order: 1000,
};

describe('NoteSnapshotService', () => {
    let notesServiceMock: { createNote: ReturnType<typeof vi.fn> };
    let service: NoteSnapshotService;
    let snapshots: NoteSnapshot[];

    beforeEach(() => {
        vi.clearAllMocks();
        snapshots = [];
        notesServiceMock = {
            createNote: vi.fn().mockResolvedValue('copy-1'),
        };

        mocks.noteSnapshots.where.mockReturnValue({
            equals: vi.fn().mockReturnValue({
                toArray: vi.fn().mockImplementation(async () => [...snapshots]),
            }),
        });
        mocks.noteSnapshots.put.mockImplementation(async (snapshot: NoteSnapshot) => {
            snapshots.push(snapshot);
        });

        const injector = Injector.create({
            providers: [{ provide: NotesService, useValue: notesServiceMock }],
        });
        service = runInInjectionContext(injector, () => new NoteSnapshotService());
    });

    it('stores immutable snapshots with note provenance', async () => {
        const snapshot = await service.createSnapshot({
            note: NOTE,
            content: '{"type":"doc"}',
            markdownContent: 'The new text.',
            reason: 'manual',
        });

        expect(mocks.noteSnapshots.put).toHaveBeenCalledWith(expect.objectContaining({
            id: expect.any(String),
            noteId: 'note-1',
            title: 'Chapter One',
            markdownContent: 'The new text.',
            reason: 'manual',
            folderId: 'folder-1',
            narrativeId: 'narrative-1',
        }));
        expect(snapshot.markdownHash).toMatch(/^[a-f0-9]{8}$/);
    });

    it('deduplicates identical adjacent snapshots for the same reason', async () => {
        const first = await service.createSnapshot({
            note: NOTE,
            content: '{}',
            markdownContent: 'Same text.',
            reason: 'manual',
        });
        const second = await service.createSnapshot({
            note: NOTE,
            content: '{}',
            markdownContent: 'Same text.',
            reason: 'manual',
        });

        expect(second).toBe(first);
        expect(mocks.noteSnapshots.put).toHaveBeenCalledTimes(1);
    });

    it('restores a snapshot as a new note without mutating the original note', async () => {
        const snapshot = await service.createSnapshot({
            note: NOTE,
            content: '{"type":"doc"}',
            markdownContent: 'Recovered text.',
            reason: 'manual',
        });

        const restoredId = await service.restoreAsCopy(snapshot);

        expect(restoredId).toBe('copy-1');
        expect(notesServiceMock.createNote).toHaveBeenCalledWith(expect.objectContaining({
            title: expect.stringContaining('Chapter One'),
            content: '{"type":"doc"}',
            markdownContent: 'Recovered text.',
            folderId: 'folder-1',
            isPinned: false,
            favorite: false,
        }));
    });

    it('formats compact snapshot stamps for titles and exports', () => {
        const stamp = formatSnapshotStamp(new Date('2026-04-21T13:05:00').getTime());
        expect(stamp).toMatch(/^2026-04-21 13(05)?$/);
    });
});
