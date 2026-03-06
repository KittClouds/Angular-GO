// src/app/lib/store/tab.store.ts
// Manages open editor tabs and keeps them in sync with note lifecycle.

import { Injectable, signal, effect, Inject, PLATFORM_ID, inject, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NoteEditorStore } from './note-editor.store';
import { db, type Note } from '../dexie/db';
import { setSetting } from '../dexie/settings.service';
import { NotesService } from '../dexie/notes.service';
import { AppOrchestrator } from '../core/app-orchestrator';
import * as ops from '../operations';

export interface EditorTab {
    id: string;
    noteId: string;
    title: string;
    active: boolean;
}

const TABS_STORAGE_KEY = 'kittclouds-open-tabs';

@Injectable({
    providedIn: 'root'
})
export class TabStore {
    private readonly isBrowser: boolean;
    private readonly noteEditorStore = inject(NoteEditorStore);
    private readonly notesService = inject(NotesService);
    private readonly orchestrator = inject(AppOrchestrator);

    readonly tabs = signal<EditorTab[]>([]);

    private isRestoring = true;
    private readonly allNotes = toSignal(this.notesService.getAllNotes$(), { initialValue: [] as Note[] });

    constructor(@Inject(PLATFORM_ID) platformId: Object) {
        this.isBrowser = isPlatformBrowser(platformId);

        // Restore tabs from persisted UI state.
        this.restoreTabs();

        // Persist tabs whenever they change (except while restoring).
        effect(() => {
            const currentTabs = this.tabs();
            if (this.isRestoring) return;
            this.persistTabs(currentTabs);
        });

        // Active note drives tab activation/opening.
        effect(() => {
            const activeNoteId = this.noteEditorStore.activeNoteId();
            if (activeNoteId) {
                this.ensureTabOpen(activeNoteId);
            }
        });

        // Reconcile tab list against live notes once boot is interactive.
        // Ensures deleted notes cannot leave ghost tabs.
        effect(() => {
            const phase = this.orchestrator.currentPhase();
            const bootReady = phase === 'ready' || phase === 'background';
            if (!bootReady || this.isRestoring) return;

            const notes = this.allNotes();
            const activeNoteId = this.noteEditorStore.activeNoteId();
            this.reconcileTabsWithNotes(notes, activeNoteId);
        });
    }

    /**
     * Ensure a tab exists for the given note ID and mark it active.
     */
    async ensureTabOpen(noteId: string): Promise<void> {
        const currentTabs = untracked(() => this.tabs());
        const existingTab = currentTabs.find(t => t.noteId === noteId);

        if (existingTab) {
            this.setActiveTabVisuals(noteId);
            return;
        }

        // Only create tabs for existing notes.
        let note: ops.Note | undefined;
        try {
            note = await ops.getNote(noteId);
        } catch (e) {
            console.warn('[TabStore] Failed to fetch note for tab open:', e);
            return;
        }

        if (!note) {
            console.warn(`[TabStore] Skipping tab open for missing note: ${noteId}`);
            if (this.noteEditorStore.activeNoteId() === noteId) {
                this.noteEditorStore.closeNote();
            }
            return;
        }

        const title = (note.title || 'Untitled Note').trim() || 'Untitled Note';
        const newTab: EditorTab = {
            id: noteId,
            noteId,
            title,
            active: true,
        };

        this.tabs.update(tabs => [
            ...tabs.map(t => ({ ...t, active: false })),
            newTab,
        ]);
    }

    /**
     * Close a specific tab.
     * Closing a tab does not delete the note.
     */
    closeTab(noteId: string): void {
        const currentTabs = this.tabs();
        const tabIndex = currentTabs.findIndex(t => t.noteId === noteId);
        if (tabIndex === -1) return;

        const isClosingActive = currentTabs[tabIndex].active;
        const newTabs = currentTabs.filter(t => t.noteId !== noteId);
        this.tabs.set(newTabs);

        if (!isClosingActive) return;

        if (newTabs.length > 0) {
            const newActiveIndex = Math.min(tabIndex, newTabs.length - 1);
            const newActiveTab = newTabs[newActiveIndex];
            this.activateTab(newActiveTab.noteId);
        } else {
            this.noteEditorStore.closeNote();
        }
    }

    /**
     * Activate a tab (click) -> open matching note.
     */
    activateTab(noteId: string): void {
        this.noteEditorStore.openNote(noteId);
    }

    /**
     * Update a tab title (optimistic/local sync).
     */
    updateTabTitle(noteId: string, newTitle: string): void {
        const normalized = newTitle.trim() || 'Untitled Note';
        this.tabs.update(tabs =>
            tabs.map(t => (t.noteId === noteId ? { ...t, title: normalized } : t))
        );
    }

    private reconcileTabsWithNotes(notes: Note[], activeNoteId: string | null): void {
        const noteById = new Map(notes.map(note => [note.id, note] as const));
        const existingTabs = untracked(() => this.tabs());

        let removedActiveIndex = -1;
        let changed = false;

        const reconciledTabs: EditorTab[] = existingTabs.flatMap((tab, index) => {
            const note = noteById.get(tab.noteId);
            if (!note) {
                changed = true;
                if (activeNoteId && tab.noteId === activeNoteId) {
                    removedActiveIndex = index;
                }
                return [];
            }

            const resolvedTitle = (note.title || 'Untitled Note').trim() || 'Untitled Note';
            const shouldBeActive = !!activeNoteId && tab.noteId === activeNoteId;

            if (tab.title !== resolvedTitle || tab.active !== shouldBeActive) {
                changed = true;
                return [{ ...tab, title: resolvedTitle, active: shouldBeActive }];
            }

            return [tab];
        });

        if (changed) {
            this.tabs.set(reconciledTabs);
        }

        if (!activeNoteId || noteById.has(activeNoteId)) {
            return;
        }

        if (reconciledTabs.length === 0) {
            this.noteEditorStore.closeNote();
            return;
        }

        const fallbackIndex = removedActiveIndex >= 0
            ? Math.min(removedActiveIndex, reconciledTabs.length - 1)
            : 0;
        const fallbackTab = reconciledTabs[fallbackIndex];
        this.noteEditorStore.openNote(fallbackTab.noteId);
    }

    private setActiveTabVisuals(activeNoteId: string): void {
        this.tabs.update(tabs =>
            tabs.map(t => ({
                ...t,
                active: t.noteId === activeNoteId,
            }))
        );
    }

    private async restoreTabs(): Promise<void> {
        if (!this.isBrowser) return;

        try {
            const setting = await db.settings.get(TABS_STORAGE_KEY);
            const tabs = setting?.value as EditorTab[] | null;

            if (tabs && Array.isArray(tabs) && tabs.length > 0) {
                console.log(`[TabStore] Restoring ${tabs.length} tabs from DB`);
                this.tabs.set(tabs);
            } else {
                console.log('[TabStore] No tabs found in DB to restore');
            }
        } catch (e) {
            console.warn('[TabStore] Failed to restore tabs', e);
        } finally {
            this.isRestoring = false;
        }
    }

    private persistTabs(tabs: EditorTab[]): void {
        if (!this.isBrowser) return;
        setSetting(TABS_STORAGE_KEY, tabs);
    }
}
