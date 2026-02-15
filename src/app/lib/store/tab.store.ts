// src/app/lib/store/tab.store.ts
// Manages the state of open tabs in the editor header

import { Injectable, signal, computed, effect, Inject, PLATFORM_ID, inject, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NoteEditorStore } from './note-editor.store';
import { db } from '../dexie/db';
import { getSetting, setSetting } from '../dexie/settings.service';
import * as ops from '../operations';

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

    // Prevent persistence while restoring
    private isRestoring = true;

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

            // CRITICAL: Don't persist empty list while restoring!
            if (this.isRestoring) return;

            this.persistTabs(currentTabs);
        });

        // ─────────────────────────────────────────────────────────────
        // Sync with NoteEditorStore
        // ─────────────────────────────────────────────────────────────

        // When the active note changes in the editor store, update our tabs
        effect(() => {
            const activeNoteId = this.noteEditorStore.activeNoteId();

            if (activeNoteId) {
                // If we are still restoring, maybe we shouldn't act yet?
                // actually ensureTabOpen handles checking existing tabs.
                // But if restoreTabs is async, tabs() might be empty.
                // However, restoreTabs calls set() which triggers effects.
                this.ensureTabOpen(activeNoteId);
            }
        });

        // ─────────────────────────────────────────────────────────────
        // Reactive Title Sync
        // When the current note's title changes in Dexie (via liveQuery),
        // update the corresponding tab title to stay in sync.
        // This fixes the issue where tabs show "Untitled Note" but
        // the sidebar shows the actual note name like "girls".
        // ─────────────────────────────────────────────────────────────
        effect(() => {
            const currentNote = this.noteEditorStore.currentNote();
            if (!currentNote) return;

            // Find the tab for this note and update its title if different
            const currentTabs = untracked(() => this.tabs());
            const existingTab = currentTabs.find(t => t.noteId === currentNote.id);

            if (existingTab && existingTab.title !== currentNote.title) {
                console.log(`[TabStore] Syncing tab title: "${existingTab.title}" → "${currentNote.title}"`);
                this.updateTabTitle(currentNote.id, currentNote.title || 'Untitled');
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
            // Fetch note title to create new tab (using GoSQLite via operations)
            // Fallback to db.notes if ops is slow/not ready
            let title = 'Untitled Note';
            try {
                const note = await ops.getNote(noteId);
                if (note) title = note.title || 'Untitled';
            } catch (e) {
                console.warn('[TabStore] Failed to fetch note title for tab:', e);
            }

            const newTab: EditorTab = {
                id: noteId,
                noteId: noteId,
                title: title,
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

    private async restoreTabs() {
        if (!this.isBrowser) return;
        try {
            // Bypass sync cache and read from DB directly to avoid race conditions
            // getSetting returns value or default, but we want direct DB access here
            // because settings cache might not be hydrated yet.
            const s = await db.settings.get(TABS_STORAGE_KEY);
            const tabs = s?.value as EditorTab[] | null;

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

    private persistTabs(tabs: EditorTab[]) {
        if (!this.isBrowser) return;
        setSetting(TABS_STORAGE_KEY, tabs);
    }
}
