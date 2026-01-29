// src/app/lib/store/tab.store.ts
// Manages the state of open tabs in the editor header

import { Injectable, signal, computed, effect, Inject, PLATFORM_ID, inject, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NoteEditorStore } from './note-editor.store';
import { db } from '../dexie/db';

export interface EditorTab {
    id: string;      // Usually same as noteId
    noteId: string;
    title: string;
    active: boolean;
}

const TABS_STORAGE_KEY = 'kittclouds-open-tabs';

@Injectable({
    providedIn: 'root'
})
export class TabStore {
    private isBrowser: boolean;
    private noteEditorStore = inject(NoteEditorStore);

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    // List of open tabs
    readonly tabs = signal<EditorTab[]>([]);

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(@Inject(PLATFORM_ID) platformId: Object) {
        this.isBrowser = isPlatformBrowser(platformId);

        // Restore tabs from storage
        this.restoreTabs();

        // Persist tabs whenever they change
        effect(() => {
            const currentTabs = this.tabs();
            this.persistTabs(currentTabs);
        });

        // ─────────────────────────────────────────────────────────────
        // Sync with NoteEditorStore
        // ─────────────────────────────────────────────────────────────

        // When the active note changes in the editor store, update our tabs
        effect(() => {
            const activeNoteId = this.noteEditorStore.activeNoteId();

            if (activeNoteId) {
                this.ensureTabOpen(activeNoteId);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Ensure a tab exists for the given note ID and select it.
     * Fetches title from DB if needed.
     * IMPORTANT: Uses untracked() to avoid creating signal dependency loops.
     */
    async ensureTabOpen(noteId: string) {
        // Use untracked to prevent the effect from tracking the tabs signal
        const currentTabs = untracked(() => this.tabs());
        const existingTab = currentTabs.find(t => t.noteId === noteId);

        if (existingTab) {
            // Tab exists, just make sure it's marked active (visual only)
            // The actual activation logic happens via updating NoteEditorStore
            this.setActiveTabVisuals(noteId);
        } else {
            // Fetch note title to create new tab
            const note = await db.notes.get(noteId);
            if (!note) return;

            const newTab: EditorTab = {
                id: noteId,
                noteId: noteId,
                title: note.title || 'Untitled',
                active: true
            };

            // Deactivate other tabs and add new one
            this.tabs.update(tabs => [
                ...tabs.map(t => ({ ...t, active: false })),
                newTab
            ]);
        }
    }

    /**
     * Close a specific tab.
     * If it was active, switch to the nearest neighbor.
     */
    closeTab(noteId: string) {
        const currentTabs = this.tabs();
        const tabIndex = currentTabs.findIndex(t => t.noteId === noteId);
        if (tabIndex === -1) return;

        const isClosingActive = currentTabs[tabIndex].active;
        const newTabs = currentTabs.filter(t => t.noteId !== noteId);

        this.tabs.set(newTabs);

        if (isClosingActive) {
            if (newTabs.length > 0) {
                // Determine new active note (try right, then left)
                const newActiveIndex = Math.min(tabIndex, newTabs.length - 1);
                const newActiveTab = newTabs[newActiveIndex];
                this.activateTab(newActiveTab.noteId);
            } else {
                // No tabs left
                this.noteEditorStore.closeNote();
            }
        }
    }

    /**
     * Activate a tab (clicks).
     * This drives the NoteEditorStore.
     */
    activateTab(noteId: string) {
        this.noteEditorStore.openNote(noteId);
    }

    /**
     * Update a tab's title (e.g. on rename)
     */
    updateTabTitle(noteId: string, newTitle: string) {
        this.tabs.update(tabs =>
            tabs.map(t => t.noteId === noteId ? { ...t, title: newTitle } : t)
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    private setActiveTabVisuals(activeNoteId: string) {
        this.tabs.update(tabs =>
            tabs.map(t => ({
                ...t,
                active: t.noteId === activeNoteId
            }))
        );
    }

    private restoreTabs() {
        if (!this.isBrowser) return;
        try {
            const stored = localStorage.getItem(TABS_STORAGE_KEY);
            if (stored) {
                const tabs = JSON.parse(stored);
                this.tabs.set(tabs);
            }
        } catch (e) {
            console.warn('[TabStore] Failed to restore tabs', e);
        }
    }

    private persistTabs(tabs: EditorTab[]) {
        if (!this.isBrowser) return;
        localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    }
}
