// src/app/lib/store/note-editor.store.ts
// Single source of truth for the currently active note
// Uses signals + Dexie liveQuery for reactive state
// INCLUDES: Dexie settings persistence for active note and editor position

import { Injectable, signal, computed, effect, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject, from, of, switchMap, debounceTime, distinctUntilChanged } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { db, Note } from '../dexie/db';
import { getSetting, setSetting, removeSetting } from '../dexie/settings.service';
import * as ops from '../operations';

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
    private saveSubject = new Subject<{ noteId: string; json: object; markdown: string }>();

    /** Cached editor position for restoration */
    private pendingPosition: EditorPosition | null = null;



    /** Flag to prevent clearing storage during initial restoration */
    private isRestoring = true; // Default to true to block effects until restoration is complete

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
        console.log('[NoteEditorStore] Constructor called');

        // Restore active note from storage on init
        this.restoreActiveNote();

        // Debounce saves by 300ms to avoid hammering IndexedDB
        // IMPORTANT: Use noteId from payload, NOT activeNoteId() - to avoid race conditions
        this.saveSubject.pipe(
            debounceTime(300)
        ).subscribe(async ({ noteId, json, markdown }) => {
            // Verify the note is still the active one to avoid saving stale content
            if (this.activeNoteId() !== noteId) {
                console.log(`[NoteEditorStore] Skipped save for ${noteId} (no longer active)`);
                return;
            }

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
            // Don't wipe storage if we are in the middle of restoring
            if (noteId === null && this.isRestoring) {
                console.log('[NoteEditorStore] Skipping persistence wipe during restoration');
                return;
            }
            console.log(`[NoteEditorStore] Persistence effect triggered. ID: ${noteId}`);
            this.persistActiveNote(noteId);
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Persistence Methods
    // ─────────────────────────────────────────────────────────────

    private async restoreActiveNote(): Promise<void> {
        if (!this.isBrowser) return;

        console.log('[NoteEditorStore] restoreActiveNote: Checking Dexie directly...');

        try {
            // Bypass synchronous cache (which might be empty due to race condition) and read from DB
            const setting = await db.settings.get(ACTIVE_NOTE_KEY);
            const storedNoteId = setting?.value as string | undefined;
            console.log(`[NoteEditorStore] restoreActiveNote: Found in Dexie: "${storedNoteId}"`);

            if (storedNoteId) {
                // Restore position too
                const posSetting = await db.settings.get(EDITOR_POSITION_KEY);
                const position = posSetting?.value as EditorPosition | undefined;

                if (position && position.noteId === storedNoteId) {
                    this.pendingPosition = position;
                    console.log(`[NoteEditorStore] Loaded editor position:`, position);
                }

                // Verify note exists
                const note = await db.notes.get(storedNoteId);
                if (note) {
                    this.activeNoteId.set(storedNoteId);
                    console.log(`[NoteEditorStore] Restoring active note: ${storedNoteId}`);
                } else {
                    console.log(`[NoteEditorStore] Note ${storedNoteId} not found in DB`);
                    // Explicitly clear here since effect won't fire if signal is null
                    removeSetting(ACTIVE_NOTE_KEY);
                    removeSetting(EDITOR_POSITION_KEY);
                }
            }
        } catch (e) {
            console.error('[NoteEditorStore] Restoration failed', e);
        } finally {
            this.isRestoring = false;
            console.log('[NoteEditorStore] Restoration check complete. isRestoring = false');
        }
    }

    private persistActiveNote(noteId: string | null): void {
        if (!this.isBrowser) return;

        if (noteId) {
            console.log(`[NoteEditorStore] Persisting active note ID: ${noteId}`);
            setSetting(ACTIVE_NOTE_KEY, noteId);
        } else {
            console.log(`[NoteEditorStore] Clearing active note ID (noteId is null)`);
            removeSetting(ACTIVE_NOTE_KEY);
            removeSetting(EDITOR_POSITION_KEY);
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

        setSetting(EDITOR_POSITION_KEY, position);
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
     * Captures noteId at call time to prevent race conditions when switching notes.
     */
    saveContent(json: object, markdown: string): void {
        const noteId = this.activeNoteId();
        if (!noteId) return;
        this.saveSubject.next({ noteId, json, markdown });
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
