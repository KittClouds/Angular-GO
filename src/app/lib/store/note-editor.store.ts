// src/app/lib/store/note-editor.store.ts
// Single source of truth for the currently active note
// Uses signals + Dexie liveQuery for reactive state

import { Injectable, signal, computed } from '@angular/core';
import { Observable, Subject, from, of, switchMap, debounceTime, distinctUntilChanged } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { db, Note } from '../dexie/db';
import * as ops from '../dexie/operations';

@Injectable({
    providedIn: 'root'
})
export class NoteEditorStore {
    // ─────────────────────────────────────────────────────────────
    // State (Signals)
    // ─────────────────────────────────────────────────────────────

    /** ID of the currently open note (null = no note open) */
    readonly activeNoteId = signal<string | null>(null);

    /** Loading state for UI feedback */
    readonly isLoading = signal(false);

    /** Computed: whether a note is currently open */
    readonly isNoteOpen = computed(() => this.activeNoteId() !== null);

    /** Pending save content (debounced) */
    private saveSubject = new Subject<{ json: object; markdown: string }>();

    // ─────────────────────────────────────────────────────────────
    // Derived State (Observables from liveQuery)
    // ─────────────────────────────────────────────────────────────

    /** 
     * Reactive stream of the active note data.
     * Automatically updates when:
     * - activeNoteId changes
     * - The note is modified in Dexie (from any source)
     */
    readonly activeNote$: Observable<Note | undefined> = toObservable(this.activeNoteId).pipe(
        distinctUntilChanged(),
        switchMap(id => {
            if (!id) return of(undefined);
            return from(liveQuery(() => db.notes.get(id)) as DexieObservable<Note | undefined>);
        })
    );

    // ─────────────────────────────────────────────────────────────
    // Constructor: Setup debounced save pipeline
    // ─────────────────────────────────────────────────────────────

    constructor() {
        // Debounce saves by 300ms to avoid hammering IndexedDB
        this.saveSubject.pipe(
            debounceTime(300)
        ).subscribe(async ({ json, markdown }) => {
            const noteId = this.activeNoteId();
            if (!noteId) return;

            try {
                await ops.updateNote(noteId, {
                    content: JSON.stringify(json),
                    markdownContent: markdown,
                });
                console.log(`[NoteEditorStore] Saved note ${noteId}`);
            } catch (e) {
                console.error('[NoteEditorStore] Failed to save note:', e);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Open a note for editing.
     * This sets the activeNoteId, which triggers activeNote$ to emit.
     */
    openNote(id: string): void {
        if (this.activeNoteId() === id) return; // Already open

        console.log(`[NoteEditorStore] Opening note: ${id}`);
        this.isLoading.set(true);
        this.activeNoteId.set(id);

        // Loading will be cleared when editor receives the content
        setTimeout(() => this.isLoading.set(false), 100);
    }

    /**
     * Close the current note (clear editor).
     */
    closeNote(): void {
        console.log('[NoteEditorStore] Closing note');
        this.activeNoteId.set(null);
    }

    /**
     * Queue a content save (debounced).
     * Called by EditorComponent on every document change.
     */
    saveContent(json: object, markdown: string): void {
        this.saveSubject.next({ json, markdown });
    }

    /**
     * Force an immediate save (bypass debounce).
     * Useful for explicit "Save" button or before navigation.
     */
    async saveContentNow(json: object, markdown: string): Promise<void> {
        const noteId = this.activeNoteId();
        if (!noteId) return;

        await ops.updateNote(noteId, {
            content: JSON.stringify(json),
            markdownContent: markdown,
        });
        console.log(`[NoteEditorStore] Force-saved note ${noteId}`);
    }

    /**
     * Create a new note and immediately open it for editing.
     */
    async createAndOpenNote(folderId: string = '', narrativeId: string = ''): Promise<string> {
        console.log(`[NoteEditorStore] Creating new note in folder: ${folderId || 'root'}`);

        const id = await ops.createNote({
            worldId: '',
            title: 'Untitled Note',
            content: '{}',
            markdownContent: '',
            folderId,
            entityKind: '',
            entitySubtype: '',
            isEntity: false,
            isPinned: false,
            favorite: false,
            ownerId: '',
            narrativeId,
        });

        this.openNote(id);
        return id;
    }

    /**
     * Update the title of the active note.
     */
    async updateTitle(title: string): Promise<void> {
        const noteId = this.activeNoteId();
        if (!noteId) return;

        await ops.updateNote(noteId, { title });
        console.log(`[NoteEditorStore] Updated title: ${title}`);
    }
}
