import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppContextProviderService } from './app-context-provider.service';
import { signal } from '@angular/core';
import { emptyAppContext, EntitySnapshot } from './app-context';

// Mock dependencies to avoid side effects (like db instantiation or DI errors)
vi.mock('../../store/note-editor.store', () => ({
    NoteEditorStore: class { }
}));
vi.mock('./retrieval.service', () => ({
    RetrievalService: class {
        getFolderAncestors = vi.fn();
        getEntityNeighbors = vi.fn();
        getEntitiesByNarrative = vi.fn();
    }
}));
vi.mock('../../services/scope.service', () => ({
    ScopeService: class { }
}));

import { NoteEditorStore } from '../../store/note-editor.store';
import { RetrievalService } from './retrieval.service';
import { ScopeService } from '../../services/scope.service';


describe('AppContextProviderService', () => {
    let service: AppContextProviderService;
    let mockNoteStore: any;
    let mockRetrievalService: any;
    let mockScopeService: any;

    // Helper to create signal-like mocks
    const createSignal = (initialValue: any) => {
        const s = signal(initialValue);
        return s;
    };

    beforeEach(() => {
        // Mock NoteEditorStore
        mockNoteStore = {
            currentNote: createSignal(null),
        };

        // Mock ScopeService
        mockScopeService = {
            activeScope: createSignal({ narrativeId: 'narrative-1', id: 'scope-1' }),
        };

        // Mock RetrievalService
        mockRetrievalService = {
            getFolderAncestors: vi.fn(),
            getEntityNeighbors: vi.fn(),
            getEntitiesByNarrative: vi.fn(),
        };

        // Manual injection
        service = new AppContextProviderService(
            mockNoteStore as NoteEditorStore,
            mockRetrievalService as RetrievalService,
            mockScopeService as ScopeService
        );
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should return empty context if no note is open', async () => {
        mockNoteStore.currentNote.set(null);
        mockScopeService.activeScope.set({ narrativeId: 'narrative-1', id: 'scope-1' });

        const ctx = await service.getCurrentContext();

        // Check against expected empty context structure
        // emptyAppContext uses worldId as passed, checks narrativeId logic
        expect(ctx.activeNoteId).toBeNull();
        expect(ctx.worldId).toBe('narrative-1');
    });

    it('should populate context from active note (Narrative mode)', async () => {
        const fakeNote = {
            id: 'note-1',
            title: 'Chapter 1',
            markdownContent: 'Once upon a time...',
            folderId: 'folder-1',
            worldId: 'world-1',
            narrativeId: 'narrative-1',
            isEntity: false,
        };
        mockNoteStore.currentNote.set(fakeNote);

        const fakeEntities: EntitySnapshot[] = [
            { id: 'e1', label: 'Hero', kind: 'CHARACTER', subtype: 'PROTAGONIST' }
        ];

        mockRetrievalService.getEntitiesByNarrative.mockResolvedValue(fakeEntities);
        mockRetrievalService.getFolderAncestors.mockResolvedValue(['Global', 'Drafts']);

        const ctx = await service.getCurrentContext();

        // Verify retrieval calls
        expect(mockRetrievalService.getFolderAncestors).toHaveBeenCalledWith('folder-1');
        expect(mockRetrievalService.getEntitiesByNarrative).toHaveBeenCalledWith('narrative-1');
        expect(mockRetrievalService.getEntityNeighbors).not.toHaveBeenCalled();

        // Verify context structure
        expect(ctx.activeNoteId).toBe('note-1');
        expect(ctx.activeNoteTitle).toBe('Chapter 1');
        expect(ctx.activeNoteSnippet).toBe('Once upon a time...');
        expect(ctx.folderPath).toEqual(['Global', 'Drafts']);
        expect(ctx.nearbyEntities).toEqual(fakeEntities);
        expect(ctx.narrativeId).toBe('narrative-1');
    });

    it('should populate context from active note (Entity mode)', async () => {
        const fakeNote = {
            id: 'entity-1',
            title: 'Gandalf',
            markdownContent: 'A wizard...',
            folderId: 'folder-2',
            worldId: 'world-1',
            narrativeId: null, // No narrative specific
            isEntity: true,
        };
        mockNoteStore.currentNote.set(fakeNote);

        const fakeNeighbors: EntitySnapshot[] = [
            { id: 'e2', label: 'Frodo', kind: 'CHARACTER', subtype: 'PROTAGONIST' }
        ];

        mockRetrievalService.getEntityNeighbors.mockResolvedValue(fakeNeighbors);
        mockRetrievalService.getFolderAncestors.mockResolvedValue(['World', 'Characters']);

        const ctx = await service.getCurrentContext();

        // Verify retrieval calls
        expect(mockRetrievalService.getEntityNeighbors).toHaveBeenCalledWith('entity-1');
        expect(mockRetrievalService.getEntitiesByNarrative).not.toHaveBeenCalled();

        // Verify context structure
        expect(ctx.activeNoteId).toBe('entity-1');
        expect(ctx.nearbyEntities).toEqual(fakeNeighbors);
    });

    it('should handle missing narrative ID correctly (fallback to empty entities)', async () => {
        const fakeNote = {
            id: 'note-2',
            title: 'Random Note',
            markdownContent: 'Just text',
            folderId: 'folder-3',
            worldId: 'world-1',
            narrativeId: null,
            isEntity: false,
        };
        // Ensure active scope also has no narrative ID to force fallback
        mockScopeService.activeScope.set({ narrativeId: null, id: 'global' });
        mockNoteStore.currentNote.set(fakeNote);

        mockRetrievalService.getFolderAncestors.mockResolvedValue([]);

        const ctx = await service.getCurrentContext();

        expect(mockRetrievalService.getEntitiesByNarrative).not.toHaveBeenCalled();
        expect(mockRetrievalService.getEntityNeighbors).not.toHaveBeenCalled();
        expect(ctx.nearbyEntities).toEqual([]);
    });
});
