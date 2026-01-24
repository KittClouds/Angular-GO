// src/app/lib/services/sidebar.service.ts
// Simple service to manage sidebar open/closed state

import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class SidebarService {
    // State
    private _isOpen = signal(true);

    // Getters
    get isOpen() {
        return this._isOpen;
    }

    // Actions
    toggle(): void {
        this._isOpen.update(v => !v);
    }

    open(): void {
        this._isOpen.set(true);
    }

    close(): void {
        this._isOpen.set(false);
    }
}
