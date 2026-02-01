import { Injectable, inject, signal, computed, Injector, effect } from '@angular/core';
import { liveQuery } from 'dexie';
import { from, Observable, combineLatest, map } from 'rxjs';
import { db, Folder, Note } from '../dexie/db';
import { FolderService } from './folder.service'; // Assuming available
import { NoteEditorStore } from '../store/note-editor.store'; // To get active note

export interface Chapter {
    id: string;
    title: string;
    order: number;
    folderId: string;
}

@Injectable({
    providedIn: 'root'
})
export class ChapterService {
    private noteEditorStore = inject(NoteEditorStore);

    // State
    // The currently manually selected chapter (if any). 
    // If null, we might auto-select based on active note.
    private manualChapterId = signal<string | 'global' | null>(null);

    // Computed: The resolved active chapter ID
    // Priority: Manual Selection > Active Note's Chapter > Global
    activeChapterId = computed(() => {
        const manual = this.manualChapterId();
        if (manual) return manual;

        const activeNoteId = this.noteEditorStore.activeNoteId(); // Assuming this signal exists
        // We need to map note -> chapter. This is harder synchronously in a computed.
        // For now, let's rely on an effect or subscription to update a "autoChapterId" signal.

        return this.autoChapterId() || 'global';
    });

    // Helper signal derived from async sources
    private autoChapterId = signal<string | null>(null);

    // List of all detected chapters
    chapters = signal<Chapter[]>([]);

    constructor() {
        // Use effect to watch the active note
        const injector = inject(Injector); // Need to import Injector
        effect(() => {
            const noteId = this.noteEditorStore.activeNoteId();
            this.updateAutoChapter(noteId);
        });

        this.initChaptersSubscription();
    }

    // =========================================================================
    // INITIALIZATION & SUBSCRIPTIONS
    // =========================================================================

    private initChaptersSubscription() {
        // Query for folders named "Chapters" (case insensitive? usually fixed structure)
        // Then query notes within those folders. 
        // OR: User defined manual ordering.

        // For MVP: Look for a folder named "Chapters" inside a "NARRATIVE" kind folder? 
        // Or just any folder named "Chapters". 
        // As per request: "Narrative folder exists... contains Chapters".

        // Let's watch all folders first to find the ID of the "Chapters" folder.
        liveQuery(async () => {
            // 1. Find "Narrative" folder (root or high level)
            // 2. Find "Chapters" folder inside it.
            // 3. Get notes in "Chapters", sorted by order.

            // Simplification: Find ANY folder named "Chapters".
            const chaptersFolder = await db.folders.where('name').equals('Chapters').first();

            if (!chaptersFolder) return [];

            // Get notes in this folder
            const notes = await db.notes.where('folderId').equals(chaptersFolder.id).sortBy('order');

            return notes.map(n => ({
                id: n.id,
                title: n.title,
                order: n.order,
                folderId: n.folderId
            }));
        }).subscribe({
            next: (chapters) => this.chapters.set(chapters as Chapter[]),
            error: (err) => console.error('[ChapterService] Error loading chapters:', err)
        });
    }

    private initAutoSelectionSubscription() {
        // Listen to active note and check if it is one of our chapters
        // This pushes to autoChapterId
        // We use an effect or subscription on the store
        // Since we can't easily inject store and sub to signal in constructor without effect:
        // We'll trust the component using this service or use an effect in a component? 
        // No, Service should own this.

        // Since signals are reactive, we can use a computed if the source is available.
        // But note->chapter lookup requires async DB or checking the `chapters` array.

        // We can check if `chapters` contains the `activeNoteId`.
        const activeId = this.noteEditorStore.activeNoteId;

        // Simple reactive check:
        // When activeNote changes, check if it's in our chapter list
        // We can do this via an effect if we were in an injection context, but purely services... 
        // We can use native JS interval or RxJS on the store if it exposes observables.

        // For now, let's expose a method `checkAutoChapter(noteId)` that the Sidebar/Editor calls?
        // Better: effect() in the constructor? Angular 16+ allows this.
    }

    // Called by components to manually set context
    setManualChapter(chapterId: string | 'global') {
        this.manualChapterId.set(chapterId);
    }

    clearManualChapter() {
        this.manualChapterId.set(null);
    }

    // Updated automatic detection based on note
    updateAutoChapter(noteId: string | null) {
        if (!noteId) {
            this.autoChapterId.set(null);
            return;
        }

        const takesPrecedence = true; // Navigation always takes precedence?
        const isChapter = this.chapters().find(c => c.id === noteId);

        if (isChapter) {
            this.autoChapterId.set(noteId);
            // If the user navigates to a chapter, that should become the active context
            // clearing any previous manual override.
            this.manualChapterId.set(null);
        }
    }

    // =========================================================================
    // INHERITANCE LOGIC
    // =========================================================================

    /**
     * Get the chain of context IDs [global, ch1, ch2, ... target]
     */
    getInheritanceChain(targetCtxId: string): string[] {
        if (targetCtxId === 'global') return ['global'];

        const allChapters = this.chapters();
        const targetIndex = allChapters.findIndex(c => c.id === targetCtxId);

        if (targetIndex === -1) return ['global', targetCtxId]; // Fallback

        // Chain is Global + all chapters up to target
        const chain = ['global'];
        for (let i = 0; i <= targetIndex; i++) {
            chain.push(allChapters[i].id);
        }
        return chain;
    }
}
