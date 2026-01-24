// src/app/lib/store/highlightingStore.ts
// Highlighting Mode Settings - Pure TypeScript Store with localStorage persistence
// Controls how entities are decorated in the editor with LIVE updates

import type { EntityKind } from '../Scanner/types';

// ============================================
// TYPES
// ============================================

export type HighlightMode = 'clean' | 'vivid' | 'focus' | 'off';

export interface HighlightSettings {
    /** Current highlighting mode */
    mode: HighlightMode;
    /** Entity kinds to highlight in Focus mode (multiple selection) */
    focusEntityKinds: EntityKind[];
    /** Whether to show wikilink decorations */
    showWikilinks: boolean;
    /** Whether to show tag decorations */
    showTags: boolean;
    /** Whether to show @mention decorations */
    showMentions: boolean;
    /** Whether to show temporal expression decorations */
    showTemporal: boolean;
}

/** Default settings - Clean mode as default */
export const DEFAULT_HIGHLIGHT_SETTINGS: HighlightSettings = {
    mode: 'vivid',
    focusEntityKinds: [],
    showWikilinks: true,
    showTags: true,
    showMentions: true,
    showTemporal: true,
};

/** Human-readable mode labels */
export const HIGHLIGHT_MODE_LABELS: Record<HighlightMode, string> = {
    clean: 'Clean',
    vivid: 'Vivid',
    focus: 'Focus',
    off: 'Off',
};

/** Mode descriptions for UI tooltips */
export const HIGHLIGHT_MODE_DESCRIPTIONS: Record<HighlightMode, string> = {
    clean: 'Minimal highlighting - shows entities on interaction',
    vivid: 'Full colorful highlighting - all entities always visible',
    focus: 'Only highlight selected entity types',
    off: 'No entity highlighting',
};

// ============================================
// STORAGE KEY
// ============================================

const STORAGE_KEY = 'highlighting-settings';

// ============================================
// STORE CLASS
// ============================================

class HighlightingStore {
    private settings: HighlightSettings;
    private listeners: Set<() => void> = new Set();
    // CACHED snapshot for useSyncExternalStore - same reference until data changes
    private snapshot: HighlightSettings;

    constructor() {
        // Load from localStorage on construction
        this.settings = this.loadFromStorage();
        this.snapshot = this.settings; // Initial snapshot
    }

    // ============================================
    // SUBSCRIPTIONS (for Angular effects / React hooks)
    // ============================================

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        // Create new snapshot reference when data changes
        this.snapshot = { ...this.settings };
        this.listeners.forEach(fn => fn());
    }

    // ============================================
    // GETTERS - STABLE REFERENCES
    // ============================================

    /** 
     * Get settings snapshot - returns SAME reference until data changes
     * (Required for React useSyncExternalStore to avoid infinite loops)
     */
    getSnapshot(): HighlightSettings {
        return this.snapshot;
    }

    /** @deprecated Use getSnapshot() for React hooks */
    getSettings(): HighlightSettings {
        return this.snapshot;
    }

    getMode(): HighlightMode {
        return this.settings.mode;
    }

    getFocusEntityKinds(): EntityKind[] {
        return this.settings.focusEntityKinds;
    }

    // ============================================
    // SETTERS (with live notification)
    // ============================================

    setSettings(updates: Partial<HighlightSettings>): void {
        this.settings = { ...this.settings, ...updates };
        this.saveToStorage();
        this.notify();
    }

    setMode(mode: HighlightMode): void {
        if (this.settings.mode === mode) return; // No-op if same
        this.settings = { ...this.settings, mode };
        this.saveToStorage();
        this.notify();
    }

    setFocusEntityKinds(kinds: EntityKind[]): void {
        this.settings = { ...this.settings, focusEntityKinds: kinds };
        this.saveToStorage();
        this.notify();
    }

    toggleFocusKind(kind: EntityKind): void {
        const kinds = this.settings.focusEntityKinds;
        const newKinds = kinds.includes(kind)
            ? kinds.filter(k => k !== kind)
            : [...kinds, kind];
        this.settings = { ...this.settings, focusEntityKinds: newKinds };
        this.saveToStorage();
        this.notify();
    }

    // ============================================
    // PERSISTENCE
    // ============================================

    private loadFromStorage(): HighlightSettings {
        try {
            if (typeof localStorage === 'undefined') {
                return { ...DEFAULT_HIGHLIGHT_SETTINGS };
            }
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                return { ...DEFAULT_HIGHLIGHT_SETTINGS, ...parsed };
            }
        } catch (e) {
            console.warn('[HighlightingStore] Failed to load from localStorage:', e);
        }
        return { ...DEFAULT_HIGHLIGHT_SETTINGS };
    }

    private saveToStorage(): void {
        try {
            if (typeof localStorage === 'undefined') return;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
        } catch (e) {
            console.warn('[HighlightingStore] Failed to save to localStorage:', e);
        }
    }

    reset(): void {
        this.settings = { ...DEFAULT_HIGHLIGHT_SETTINGS };
        this.saveToStorage();
        this.notify();
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const highlightingStore = new HighlightingStore();
