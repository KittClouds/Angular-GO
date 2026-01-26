// src/app/lib/store/note-editor.store.ts
// Single source of truth for the currently active note
// Uses signals + Dexie liveQuery for reactive state
// INCLUDES: localStorage persistence for active note and editor position

import { Injectable, signal, computed, effect, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject, from, of, switchMap, debounceTime, distinctUntilChanged } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { db, Note } from '../dexie/db';
import * as ops from '../dexie/operations';

const ACTIVE_NOTE_KEY = 'kittclouds-active-note';
const EDITOR_POSITION_KEY = 'kittclouds-editor-position';

interface EditorPosition {
    noteId: string;
    scrollTop: number;
    cursorFrom: number;
    cursorTo: number;
}

@Injectable({
    providedIn: 'root'
})
export class NoteEditorStore {
    private isBrowser: boolean;

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

    /** Cached editor position for restoration */
    private pendingPosition: EditorPosition | null = null;

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

    /** Signal-based accessor for the current note (for signal consumers like AnalyticsPanel) */
    readonly currentNote = toSignal(this.activeNote$, { initialValue: undefined });

    // ─────────────────────────────────────────────────────────────
    // Constructor: Setup debounced save pipeline + persistence
    // ─────────────────────────────────────────────────────────────

    constructor(@Inject(PLATFORM_ID) platformId: Object) {
        this.isBrowser = isPlatformBrowser(platformId);

        // Restore active note from storage on init
        this.restoreActiveNote();

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

        // Persist active note ID whenever it changes
        effect(() => {
            const noteId = this.activeNoteId();
            this.persistActiveNote(noteId);
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Persistence Methods
    // ─────────────────────────────────────────────────────────────

    private restoreActiveNote(): void {
        if (!this.isBrowser) return;

        const storedNoteId = localStorage.getItem(ACTIVE_NOTE_KEY);
        if (storedNoteId) {
            console.log(`[NoteEditorStore] Restoring active note: ${storedNoteId}`);

            // Load saved position
            const positionJson = localStorage.getItem(EDITOR_POSITION_KEY);
            if (positionJson) {
                try {
                    const position = JSON.parse(positionJson) as EditorPosition;
                    if (position.noteId === storedNoteId) {
                        this.pendingPosition = position;
                        console.log(`[NoteEditorStore] Loaded editor position:`, position);
                    }
                } catch (e) {
                    console.warn('[NoteEditorStore] Failed to parse stored position');
                }
            }

            // Verify note still exists before opening
            db.notes.get(storedNoteId).then(note => {
                if (note) {
                    this.activeNoteId.set(storedNoteId);
                } else {
                    console.warn(`[NoteEditorStore] Stored note ${storedNoteId} no longer exists`);
                    localStorage.removeItem(ACTIVE_NOTE_KEY);
                    localStorage.removeItem(EDITOR_POSITION_KEY);
                }
            });
        }
    }

    private persistActiveNote(noteId: string | null): void {
        if (!this.isBrowser) return;

        if (noteId) {
            localStorage.setItem(ACTIVE_NOTE_KEY, noteId);
        } else {
            localStorage.removeItem(ACTIVE_NOTE_KEY);
            localStorage.removeItem(EDITOR_POSITION_KEY);
        }
    }

    /**
     * Get pending position for restoration (consumed once).
     * Called by editor component after loading.
     */
    getPendingPosition(): EditorPosition | null {
        const position = this.pendingPosition;
        this.pendingPosition = null; // Consume it
        return position;
    }

    /**
     * Save current editor position (called by editor on scroll/cursor change).
     * Debounce this call from the editor side.
     */
    saveEditorPosition(scrollTop: number, cursorFrom: number, cursorTo: number): void {
        if (!this.isBrowser) return;

        const noteId = this.activeNoteId();
        if (!noteId) return;

        const position: EditorPosition = {
            noteId,
            scrollTop,
            cursorFrom,
            cursorTo
        };

        localStorage.setItem(EDITOR_POSITION_KEY, JSON.stringify(position));
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
        this.pendingPosition = null; // Clear pending position when switching notes
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
    /**
     * Rename any note by ID.
     */
    async renameNote(id: string, title: string): Promise<void> {
        await ops.updateNote(id, { title });
        console.log(`[NoteEditorStore] Renamed note ${id} to "${title}"`);
    }
}
