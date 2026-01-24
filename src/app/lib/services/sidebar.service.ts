// src/app/lib/services/sidebar.service.ts
// Service to manage sidebar open/collapsed/closed state

import { Injectable, signal, computed } from '@angular/core';

export type SidebarMode = 'open' | 'collapsed' | 'closed';

@Injectable({
    providedIn: 'root'
})
export class SidebarService {
    // State: three modes
    private _mode = signal<SidebarMode>('open');

    // Computed getters for template convenience
    readonly mode = this._mode.asReadonly();
    readonly isOpen = computed(() => this._mode() === 'open');
    readonly isCollapsed = computed(() => this._mode() === 'collapsed');
    readonly isClosed = computed(() => this._mode() === 'closed');

    // Actions
    setMode(mode: SidebarMode): void {
        this._mode.set(mode);
    }

    open(): void {
        this._mode.set('open');
    }

    collapse(): void {
        this._mode.set('collapsed');
    }

    close(): void {
        this._mode.set('closed');
    }

    // Toggle between open and collapsed (for footer button)
    toggleCollapse(): void {
        this._mode.update(m => m === 'open' ? 'collapsed' : 'open');
    }

    // Toggle between open/collapsed and closed (for header button)
    toggleClose(): void {
        this._mode.update(m => m === 'closed' ? 'open' : 'closed');
    }
}
