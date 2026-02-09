// src/app/lib/ngrx/app.store.ts
// Global Application State - NgRx SignalStore v21
// Single source of truth for active note, loading state, etc.

import { computed } from '@angular/core';
import {
    signalStore,
    withState,
    withComputed,
    withMethods,
    patchState,
    withHooks,
} from '@ngrx/signals';
import { withStorageSync } from './storage-sync.feature';

// ============================================
// STATE INTERFACE
// ============================================

export interface AppState {
    /** ID of the currently open note (null = no note open) */
    activeNoteId: string | null;

    /** Last opened note ID - used for startup restoration */
    lastNoteId: string | null;

    /** Whether GoKitt WASM is ready */
    wasmReady: boolean;

    /** Global loading state */
    isLoading: boolean;

    /** Active narrative/world context */
    activeNarrativeId: string | null;
}

// ============================================
// INITIAL STATE
// ============================================

const initialState: AppState = {
    activeNoteId: null,
    lastNoteId: null,
    wasmReady: false,
    isLoading: false,
    activeNarrativeId: null,
};

// ============================================
// SIGNAL STORE
// ============================================

export const AppStore = signalStore(
    { providedIn: 'root' },

    // Base state
    withState<AppState>(initialState),

    // Persist lastNoteId and activeNarrativeId to localStorage
    withStorageSync<AppState>('kittclouds-app-state', {
        keys: ['lastNoteId', 'activeNarrativeId'],
        debounceMs: 200,
    }),

    // Computed values
    withComputed((state) => ({
        /** Whether a note is currently open */
        isNoteOpen: computed(() => state.activeNoteId() !== null),

        /** Whether app is ready to load note (WASM ready) */
        canLoadNote: computed(() => state.wasmReady() && !state.isLoading()),
    })),

    // Actions
    withMethods((store) => ({
        /**
         * Open a note for editing.
         * Also sets lastNoteId for startup restoration.
         */
        openNote(noteId: string): void {
            if (store.activeNoteId() === noteId) return;

            console.log(`[AppStore] Opening note: ${noteId}`);
            patchState(store, {
                activeNoteId: noteId,
                lastNoteId: noteId,
                isLoading: true,
            });

            // Persist to storage
            (store as any)._persistToStorage();
        },

        /**
         * Close the current note.
         */
        closeNote(): void {
            console.log('[AppStore] Closing note');
            patchState(store, {
                activeNoteId: null,
                isLoading: false,
            });
        },

        /**
         * Mark loading as complete.
         */
        setLoaded(): void {
            patchState(store, { isLoading: false });
        },

        /**
         * Mark WASM as ready.
         */
        setWasmReady(): void {
            console.log('[AppStore] WASM ready');
            patchState(store, { wasmReady: true });
        },

        /**
         * Set active narrative/world context.
         */
        setNarrative(narrativeId: string | null): void {
            patchState(store, { activeNarrativeId: narrativeId });
            (store as any)._persistToStorage();
        },

        /**
         * Restore last opened note on startup.
         */
        restoreLastNote(): string | null {
            const lastId = store.lastNoteId();
            if (lastId) {
                console.log(`[AppStore] Restoring last note: ${lastId}`);
            }
            return lastId;
        },
    })),

    // Lifecycle hooks
    withHooks({
        onInit(store: any) {
            console.log('[AppStore] Initialized');

            // Listen for GoKitt ready event
            if (typeof window !== 'undefined') {
                window.addEventListener('gokitt-ready', () => {
                    store.setWasmReady();
                }, { once: true });
            }
        },
    }),
);

// ============================================
// TYPE EXPORT
// ============================================

export type AppStoreType = InstanceType<typeof AppStore>;
