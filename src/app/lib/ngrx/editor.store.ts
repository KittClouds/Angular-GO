// src/app/lib/ngrx/editor.store.ts
// Editor State - NgRx SignalStore v21
// Scroll position, cursor, pending restore

import { computed } from '@angular/core';
import {
    signalStore,
    withState,
    withMethods,
    patchState,
    withComputed,
} from '@ngrx/signals';
import { withStorageSync } from './storage-sync.feature';

// ============================================
// STATE INTERFACE
// ============================================

export interface EditorPosition {
    noteId: string;
    scrollTop: number;
    cursorFrom: number;
    cursorTo: number;
}

export interface EditorState {
    /** Last saved position per note */
    positions: Record<string, EditorPosition>;

    /** Current note being edited */
    currentNoteId: string | null;

    /** Whether we have a pending position to restore */
    pendingRestore: boolean;
}

// ============================================
// INITIAL STATE
// ============================================

const initialState: EditorState = {
    positions: {},
    currentNoteId: null,
    pendingRestore: false,
};

// ============================================
// SIGNAL STORE
// ============================================

export const EditorStore = signalStore(
    { providedIn: 'root' },

    // Base state
    withState<EditorState>(initialState),

    // Persist positions to localStorage
    withStorageSync<EditorState>('kittclouds-editor-positions', {
        keys: ['positions'],
        debounceMs: 500,
    }),

    // Computed values
    withComputed((state) => ({
        currentPosition: computed((): EditorPosition | null => {
            const noteId = state.currentNoteId();
            if (!noteId) return null;
            return state.positions()[noteId] || null;
        }),

        shouldRestore: computed(() =>
            state.pendingRestore() && state.currentNoteId() !== null
        ),
    })),

    // Actions
    withMethods((store) => ({
        setCurrentNote(noteId: string): void {
            const hasPosition = !!store.positions()[noteId];
            patchState(store, {
                currentNoteId: noteId,
                pendingRestore: hasPosition,
            });
        },

        clearCurrentNote(): void {
            patchState(store, {
                currentNoteId: null,
                pendingRestore: false,
            });
        },

        savePosition(noteId: string, scrollTop: number, cursorFrom: number, cursorTo: number): void {
            const position: EditorPosition = { noteId, scrollTop, cursorFrom, cursorTo };

            patchState(store, (state) => ({
                positions: {
                    ...state.positions,
                    [noteId]: position,
                },
            }));

            (store as any)._persistToStorage();
        },

        getPositionToRestore(noteId: string): EditorPosition | null {
            return store.positions()[noteId] || null;
        },

        markRestoreConsumed(): void {
            patchState(store, { pendingRestore: false });
        },

        clearPosition(noteId: string): void {
            patchState(store, (state) => {
                const { [noteId]: _, ...rest } = state.positions;
                return { positions: rest };
            });
            (store as any)._persistToStorage();
        },
    })),
);

// ============================================
// TYPE EXPORT
// ============================================

export type EditorStoreType = InstanceType<typeof EditorStore>;
