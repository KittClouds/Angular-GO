// src/app/lib/ngrx/ui.store.ts
// UI State - NgRx SignalStore v21
// Sidebar visibility, panel states, hub tabs

import { computed } from '@angular/core';
import {
    signalStore,
    withState,
    withComputed,
    withMethods,
    patchState,
} from '@ngrx/signals';
import { withStorageSync } from './storage-sync.feature';

// ============================================
// TYPES
// ============================================

export type RightSidebarView = 'entity' | 'ai' | 'analytics';
export type LeftSidebarView = 'notes' | 'ner' | 'search';

// ============================================
// STATE INTERFACE
// ============================================

export interface UiState {
    /** Left sidebar open/closed */
    leftSidebarOpen: boolean;

    /** Left sidebar current view */
    leftSidebarView: LeftSidebarView;

    /** Right sidebar open/closed */
    rightSidebarOpen: boolean;

    /** Right sidebar current view */
    rightSidebarView: RightSidebarView;

    /** Blueprint Hub modal open/closed */
    blueprintHubOpen: boolean;

    /** Active tab in Blueprint Hub */
    activeHubTab: string;

    /** Footer expanded */
    footerExpanded: boolean;
}

// ============================================
// INITIAL STATE
// ============================================

const initialState: UiState = {
    leftSidebarOpen: true,
    leftSidebarView: 'notes',
    rightSidebarOpen: true,
    rightSidebarView: 'entity',
    blueprintHubOpen: false,
    activeHubTab: 'entities',
    footerExpanded: false,
};

// ============================================
// SIGNAL STORE
// ============================================

export const UiStore = signalStore(
    { providedIn: 'root' },

    // Base state
    withState<UiState>(initialState),

    // Persist UI state to localStorage
    withStorageSync<UiState>('kittclouds-ui-state', {
        debounceMs: 100,
    }),

    // Computed values
    withComputed((state) => ({
        anySidebarOpen: computed(() =>
            state.leftSidebarOpen() || state.rightSidebarOpen()
        ),

        layoutClass: computed(() => {
            const left = state.leftSidebarOpen();
            const right = state.rightSidebarOpen();
            if (left && right) return 'both-sidebars';
            if (left) return 'left-only';
            if (right) return 'right-only';
            return 'no-sidebars';
        }),
    })),

    // Actions
    withMethods((store) => ({
        // LEFT SIDEBAR
        toggleLeftSidebar(): void {
            patchState(store, { leftSidebarOpen: !store.leftSidebarOpen() });
            (store as any)._persistToStorage();
        },

        setLeftSidebarOpen(open: boolean): void {
            patchState(store, { leftSidebarOpen: open });
            (store as any)._persistToStorage();
        },

        setLeftSidebarView(view: LeftSidebarView): void {
            patchState(store, { leftSidebarView: view, leftSidebarOpen: true });
            (store as any)._persistToStorage();
        },

        // RIGHT SIDEBAR
        toggleRightSidebar(): void {
            patchState(store, { rightSidebarOpen: !store.rightSidebarOpen() });
            (store as any)._persistToStorage();
        },

        setRightSidebarOpen(open: boolean): void {
            patchState(store, { rightSidebarOpen: open });
            (store as any)._persistToStorage();
        },

        setRightSidebarView(view: RightSidebarView): void {
            patchState(store, { rightSidebarView: view, rightSidebarOpen: true });
            (store as any)._persistToStorage();
        },

        // BLUEPRINT HUB
        openBlueprintHub(tab?: string): void {
            patchState(store, {
                blueprintHubOpen: true,
                ...(tab ? { activeHubTab: tab } : {}),
            });
        },

        closeBlueprintHub(): void {
            patchState(store, { blueprintHubOpen: false });
        },

        setHubTab(tab: string): void {
            patchState(store, { activeHubTab: tab });
            (store as any)._persistToStorage();
        },

        // FOOTER
        toggleFooter(): void {
            patchState(store, { footerExpanded: !store.footerExpanded() });
            (store as any)._persistToStorage();
        },
    })),
);

// ============================================
// TYPE EXPORT
// ============================================

export type UiStoreType = InstanceType<typeof UiStore>;
