// src/app/lib/services/right-sidebar.service.ts
import { Injectable, signal, computed } from '@angular/core';

export type SidebarMode = 'open' | 'closed';

@Injectable({
    providedIn: 'root'
})
export class RightSidebarService {
    // Default open? Or closed? Usually right sidebar is secondary, so maybe separate state.
    // User said "add a sidebar", implying it should likely be visible. Let's default to open for now so they see it.
    private _mode = signal<SidebarMode>('open');

    readonly isOpen = computed(() => this._mode() === 'open');
    readonly isClosed = computed(() => this._mode() === 'closed');

    open() { this._mode.set('open'); }
    close() { this._mode.set('closed'); }
    toggle() { this._mode.update(m => m === 'open' ? 'closed' : 'open'); }
}
