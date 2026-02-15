// src/app/lib/services/sidebar.service.ts
// Service to manage sidebar open/collapsed/closed state
// Now persists to Dexie via AppStateService

import { Injectable, inject, computed } from '@angular/core';
import { AppStateService } from './app-state.service';

@Injectable({
    providedIn: 'root'
})
export class SidebarService {
    private appState = inject(AppStateService);

    // Computed getters for template convenience (from persisted state)
    readonly mode = this.appState.leftSidebarMode;
    readonly isOpen = computed(() => this.mode() === 'open');
    readonly isCollapsed = computed(() => this.mode() === 'collapsed');
    readonly isClosed = computed(() => this.mode() === 'closed');

    // Actions - delegate to AppStateService for persistence
    setMode(mode: 'open' | 'collapsed' | 'closed'): void {
        this.appState.setLeftSidebarMode(mode);
    }

    open(): void {
        this.appState.setLeftSidebarMode('open');
    }

    collapse(): void {
        this.appState.setLeftSidebarMode('collapsed');
    }

    close(): void {
        this.appState.setLeftSidebarMode('closed');
    }

    // Toggle between open and collapsed (for footer button)
    toggleCollapse(): void {
        this.appState.toggleLeftSidebar();
    }

    // Toggle between open/collapsed and closed (for header button)
    toggleClose(): void {
        const current = this.mode();
        this.setMode(current === 'closed' ? 'open' : 'closed');
    }
}
