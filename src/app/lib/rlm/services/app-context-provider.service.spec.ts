import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { AppContextProviderService } from './app-context-provider.service';
import { emptyAppContext } from './app-context';

// Mock DI-heavy deps
vi.mock('../../store/note-editor.store', () => ({
    NoteEditorStore: class { },
}));
vi.mock('../../services/scope.service', () => ({
    ScopeService: class { },
}));

describe('AppContextProviderService', () => {
    let service: AppContextProviderService;
    let noteStoreMock: any;
    let scopeServiceMock: any;

    beforeEach(() => {
        noteStoreMock = {
            currentNote: signal(null),
        };
        scopeServiceMock = {
            activeScope: signal({ narrativeId: 'narrative-1', id: 'scope-1' }),
        };

        // Manual construction via prototype trick (inject() removed from service)
        service = Object.assign(Object.create(AppContextProviderService.prototype), {
            noteStore: noteStoreMock,
            scopeService: scopeServiceMock,
        });
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should return empty context if no note is open', async () => {
        noteStoreMock.currentNote.set(null);
        scopeServiceMock.activeScope.set({ narrativeId: 'narrative-1', id: 'scope-1' });

        const ctx = await service.getCurrentContext();
        expect(ctx.activeNoteId).toBeNull();
        expect(ctx.worldId).toBe('narrative-1');
    });

    it('should populate context from active note', async () => {
        const fakeNote = {
            id: 'note-1',
            title: 'Chapter 1',
            markdownContent: 'Once upon a time...',
            folderId: 'folder-1',
            worldId: 'world-1',
            narrativeId: 'narrative-1',
        };
        noteStoreMock.currentNote.set(fakeNote);

        const ctx = await service.getCurrentContext();

        expect(ctx.activeNoteId).toBe('note-1');
        expect(ctx.activeNoteTitle).toBe('Chapter 1');
        expect(ctx.activeNoteSnippet).toBe('Once upon a time...');
        expect(ctx.narrativeId).toBe('narrative-1');
        // Folder path and entities are empty (no WASM store hook yet)
        expect(ctx.folderPath).toEqual([]);
        expect(ctx.nearbyEntities).toEqual([]);
    });

    it('should fall back to scope narrativeId when note has none', async () => {
        const fakeNote = {
            id: 'note-2',
            title: 'Orphan Note',
            markdownContent: 'text',
            folderId: 'f',
            worldId: 'w1',
            narrativeId: null,
        };
        scopeServiceMock.activeScope.set({ narrativeId: 'from-scope', id: 'scope-1' });
        noteStoreMock.currentNote.set(fakeNote);

        const ctx = await service.getCurrentContext();
        expect(ctx.narrativeId).toBe('from-scope');
    });

    it('should truncate note snippet to 500 chars', async () => {
        const longContent = 'x'.repeat(1000);
        noteStoreMock.currentNote.set({
            id: 'n', title: 'T', markdownContent: longContent,
            folderId: 'f', worldId: 'w', narrativeId: null,
        });

        const ctx = await service.getCurrentContext();
        expect(ctx.activeNoteSnippet.length).toBe(500);
    });
});
