// src/app/lib/services/right-sidebar.service.ts
// Service to manage right sidebar open/closed state
// Now persists to Dexie via AppStateService

import { Injectable, inject, computed } from '@angular/core';
import { AppStateService } from './app-state.service';
import { RightSidebarPanel } from '../dexie/db';

@Injectable({
    providedIn: 'root'
})
export class RightSidebarService {
    private appState = inject(AppStateService);

    // Computed getters from persisted state
    readonly mode = this.appState.rightSidebarMode;
    readonly isOpen = computed(() => this.mode() === 'open');
    readonly isClosed = computed(() => this.mode() === 'closed');

    // Active panel management
    readonly activePanel = this.appState.rightSidebarActivePanel;

    // Actions - delegate to AppStateService for persistence
    open() { this.appState.setRightSidebarMode('open'); }
    close() { this.appState.setRightSidebarMode('closed'); }
    toggle() { this.appState.toggleRightSidebar(); }

    setActivePanel(panel: RightSidebarPanel): void {
        this.appState.setRightSidebarActivePanel(panel);
    }
}
