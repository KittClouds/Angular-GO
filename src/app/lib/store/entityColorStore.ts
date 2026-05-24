// src/lib/store/entityColorStore.ts
// Unified Entity Color System - Single source of truth for all entity colors
// Uses CSS custom properties for live updates across the entire app
// Supports both PILL colors (background/border) and TEXT colors (foreground)

import type { EntityKind } from '../Scanner/types';
import type { EntitySourceSystem } from '../registry';

// ============================================
// DEFAULT COLORS (HSL VALUES)
// ============================================

// HSL values without the hsl() wrapper - used in CSS as: hsl(var(--entity-character))
// These are used for pill backgrounds/borders
export const DEFAULT_ENTITY_COLORS: Record<EntityKind, string> = {
    CHARACTER: '280 70% 60%',      // Purple
    LOCATION: '200 75% 55%',       // Blue
    NPC: '30 80% 55%',             // Orange
    ITEM: '45 90% 50%',            // Gold
    FACTION: '0 70% 55%',          // Red
    SCENE: '330 70% 60%',          // Pink
    EVENT: '25 90% 55%',           // Orange
    CONCEPT: '170 65% 45%',        // Teal
    ARC: '270 70% 60%',            // Violet
    ACT: '230 80% 55%',            // Royal Blue
    CHAPTER: '175 65% 45%',        // Teal
    BEAT: '320 70% 55%',           // Magenta
    TIMELINE: '50 85% 50%',        // Gold
    NARRATIVE: '250 60% 55%',      // Indigo
    NETWORK: '190 70% 50%',        // Cyan
    CUSTOM: '0 0% 50%',            // Gray
    OTHER: '0 0% 50%',             // Gray
    UNKNOWN: '0 0% 50%',
    ORGANIZATION: '300 70% 60%',   // Magenta-ish/Pink
    CREATURE: '140 70% 50%',       // Green
};

// Default TEXT colors - typically same as pill colors but can be customized separately
// These are used for text foreground (implicit entities, headers, etc.)
export const DEFAULT_ENTITY_TEXT_COLORS: Record<EntityKind, string> = {
    CHARACTER: '280 70% 60%',      // Purple
    LOCATION: '200 75% 55%',       // Blue
    NPC: '30 80% 55%',             // Orange
    ITEM: '45 90% 50%',            // Gold
    FACTION: '0 70% 55%',          // Red
    SCENE: '330 70% 60%',          // Pink
    EVENT: '25 90% 55%',           // Orange
    CONCEPT: '170 65% 45%',        // Teal
    ARC: '270 70% 60%',            // Violet
    ACT: '230 80% 55%',            // Royal Blue
    CHAPTER: '175 65% 45%',        // Teal
    BEAT: '320 70% 55%',           // Magenta
    TIMELINE: '50 85% 50%',        // Gold
    NARRATIVE: '250 60% 55%',      // Indigo
    NETWORK: '190 70% 50%',        // Cyan
    CUSTOM: '0 0% 50%',            // Gray
    OTHER: '0 0% 50%',             // Gray
    UNKNOWN: '0 0% 50%',
    ORGANIZATION: '300 70% 60%',   // Magenta-ish/Pink
    CREATURE: '140 70% 50%',       // Green
};

export const DEFAULT_ENTITY_SOURCE_COLORS: Record<EntitySourceSystem, string> = {
    user: '175 65% 45%',
    dynamic_ner: '280 70% 60%',
    graph_pipeline: '190 70% 50%',
    ingestion: '200 75% 55%',
    auto: '220 10% 50%',
    import: '45 90% 50%',
    legacy: '0 0% 50%',
};

export function normalizeEntityKind(kind: EntityKind | string | null | undefined): EntityKind | null {
    const normalized = String(kind || '').trim().toUpperCase().replace(/[-\s]+/g, '_') as EntityKind;
    return Object.prototype.hasOwnProperty.call(DEFAULT_ENTITY_COLORS, normalized) ? normalized : null;
}

export function normalizeEntitySourceSystem(source: EntitySourceSystem | string | null | undefined): EntitySourceSystem | null {
    const normalized = String(source || '').trim().toLowerCase().replace(/[-\s]+/g, '_') as EntitySourceSystem;
    return Object.prototype.hasOwnProperty.call(DEFAULT_ENTITY_SOURCE_COLORS, normalized) ? normalized : null;
}

// ============================================
// STORE CLASS - PURE RUNTIME REGISTRY
// No localStorage persistence - CSS variables are the source of truth
// ============================================

class EntityColorStore {
    private colors: Record<EntityKind, string>;
    private textColors: Record<EntityKind, string>;
    private sourceColors: Record<EntitySourceSystem, string>;
    private listeners: Set<() => void> = new Set();
    private initialized = false;
    // Cached snapshots for useSyncExternalStore - same reference until data changes
    private snapshot: Record<EntityKind, string>;
    private textSnapshot: Record<EntityKind, string>;
    private sourceSnapshot: Record<EntitySourceSystem, string>;

    constructor() {
        this.colors = { ...DEFAULT_ENTITY_COLORS };
        this.textColors = { ...DEFAULT_ENTITY_TEXT_COLORS };
        this.sourceColors = { ...DEFAULT_ENTITY_SOURCE_COLORS };
        this.snapshot = this.colors;
        this.textSnapshot = this.textColors;
        this.sourceSnapshot = this.sourceColors;
    }

    /**
     * Initialize store - must be called after DOM is ready
     * Always uses DEFAULT colors and syncs to CSS variables
     * NO localStorage loading - pure runtime defaults
     */
    initialize(): void {
        if (this.initialized) return;

        // Always start with defaults - no stale state
        this.colors = { ...DEFAULT_ENTITY_COLORS };
        this.textColors = { ...DEFAULT_ENTITY_TEXT_COLORS };
        this.sourceColors = { ...DEFAULT_ENTITY_SOURCE_COLORS };
        this.snapshot = { ...this.colors };
        this.textSnapshot = { ...this.textColors };
        this.sourceSnapshot = { ...this.sourceColors };

        // Sync all colors to CSS variables
        this.syncAllToCssVars();

        this.initialized = true;
        console.log('[EntityColorStore] Initialized with', Object.keys(this.colors).length, 'pill colors, text colors, and source colors');
    }

    // ============================================
    // GETTERS - CSS Variable Format
    // ============================================

    /**
     * Get pill color as CSS hsl() string using CSS variable
     * Returns: 'hsl(var(--entity-character))'
     */
    getEntityColor(kind: EntityKind | string): string {
        const varName = this.getCssVarName(kind);
        return `hsl(var(${varName}))`;
    }

    /**
     * Get text color as CSS hsl() string using CSS variable
     * Returns: 'hsl(var(--entity-character-text))'
     */
    getEntityTextColor(kind: EntityKind | string): string {
        const varName = this.getTextCssVarName(kind);
        return `hsl(var(${varName}))`;
    }

    /**
     * Get background color with opacity
     * Returns: 'hsl(var(--entity-character) / 0.2)'
     */
    getEntityBgColor(kind: EntityKind | string, opacity = 0.2): string {
        const varName = this.getCssVarName(kind);
        return `hsl(var(${varName}) / ${opacity})`;
    }

    getSourceColor(source: EntitySourceSystem | string): string {
        const varName = this.getSourceCssVarName(source);
        return `hsl(var(${varName}))`;
    }

    getSourceBgColor(source: EntitySourceSystem | string, opacity = 0.16): string {
        const varName = this.getSourceCssVarName(source);
        return `hsl(var(${varName}) / ${opacity})`;
    }

    /**
     * Get CSS variable name for pill color
     * Returns: '--entity-character'
     */
    getCssVarName(kind: EntityKind | string): string {
        return `--entity-${(normalizeEntityKind(kind) ?? 'UNKNOWN').toLowerCase().replace(/_/g, '-')}`;
    }

    getTextCssVarName(kind: EntityKind | string): string {
        return `--entity-${(normalizeEntityKind(kind) ?? 'UNKNOWN').toLowerCase().replace(/_/g, '-')}-text`;
    }

    getSourceCssVarName(source: EntitySourceSystem | string): string {
        return `--entity-source-${(normalizeEntitySourceSystem(source) ?? 'legacy').replace(/_/g, '-')}`;
    }

    /**
     * Get raw HSL value for pill color (without hsl() wrapper)
     * Returns: '280 70% 60%'
     */
    getRawHsl(kind: EntityKind | string): string {
        const normalized = normalizeEntityKind(kind);
        return normalized ? this.colors[normalized] : '220 10% 50%';
    }

    /**
     * Get raw HSL value for text color (without hsl() wrapper)
     * Returns: '280 70% 60%'
     */
    getRawTextHsl(kind: EntityKind | string): string {
        const normalized = normalizeEntityKind(kind);
        return normalized ? this.textColors[normalized] : '220 10% 50%';
    }

    getRawSourceHsl(source: EntitySourceSystem | string): string {
        return this.sourceColors[normalizeEntitySourceSystem(source) ?? 'legacy'] || DEFAULT_ENTITY_SOURCE_COLORS.legacy;
    }

    /**
     * Get snapshot of all pill colors - returns STABLE reference for useSyncExternalStore
     */
    getSnapshot(): Record<EntityKind, string> {
        return this.snapshot;
    }

    /**
     * Get snapshot of all text colors - returns STABLE reference for useSyncExternalStore
     */
    getTextSnapshot(): Record<EntityKind, string> {
        return this.textSnapshot;
    }

    getSourceSnapshot(): Record<EntitySourceSystem, string> {
        return this.sourceSnapshot;
    }

    /**
     * Get all pill colors (creates new object - use getSnapshot for React hooks)
     */
    getAllColors(): Record<EntityKind, string> {
        return { ...this.colors };
    }

    /**
     * Get all text colors (creates new object - use getTextSnapshot for React hooks)
     */
    getAllTextColors(): Record<EntityKind, string> {
        return { ...this.textColors };
    }

    getAllSourceColors(): Record<EntitySourceSystem, string> {
        return { ...this.sourceColors };
    }

    // ============================================
    // SETTERS - Update CSS variables live (session only)
    // ============================================

    /**
     * Set pill color for a kind - updates CSS variable immediately
     * Changes are session-only, NOT persisted to localStorage
     */
    setColor(kind: EntityKind, hslValue: string): void {
        this.colors[kind] = hslValue;
        this.setCssVar(kind, hslValue);
        this.notify();
    }

    /**
     * Set text color for a kind - updates CSS variable immediately
     * Changes are session-only, NOT persisted to localStorage
     */
    setTextColor(kind: EntityKind, hslValue: string): void {
        this.textColors[kind] = hslValue;
        this.setTextCssVar(kind, hslValue);
        this.notify();
    }

    setSourceColor(source: EntitySourceSystem, hslValue: string): void {
        this.sourceColors[source] = hslValue;
        this.setSourceCssVar(source, hslValue);
        this.notify();
    }

    /**
     * Set multiple pill colors at once
     */
    setColors(colors: Partial<Record<EntityKind, string>>): void {
        for (const [kind, hsl] of Object.entries(colors)) {
            if (hsl) {
                this.colors[kind as EntityKind] = hsl;
                this.setCssVar(kind as EntityKind, hsl);
            }
        }
        this.notify();
    }

    /**
     * Set multiple text colors at once
     */
    setTextColors(colors: Partial<Record<EntityKind, string>>): void {
        for (const [kind, hsl] of Object.entries(colors)) {
            if (hsl) {
                this.textColors[kind as EntityKind] = hsl;
                this.setTextCssVar(kind as EntityKind, hsl);
            }
        }
        this.notify();
    }

    /**
     * Reset all colors to defaults
     */
    reset(): void {
        this.colors = { ...DEFAULT_ENTITY_COLORS };
        this.textColors = { ...DEFAULT_ENTITY_TEXT_COLORS };
        this.sourceColors = { ...DEFAULT_ENTITY_SOURCE_COLORS };
        this.syncAllToCssVars();
        this.notify();
    }

    resetSourceColor(source: EntitySourceSystem): void {
        this.setSourceColor(source, DEFAULT_ENTITY_SOURCE_COLORS[source]);
    }

    // ============================================
    // CSS VARIABLE MANAGEMENT
    // ============================================

    private setCssVar(kind: EntityKind | string, hslValue: string): void {
        const varName = this.getCssVarName(kind);
        // Only run on client
        if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty(varName, hslValue);
        }
    }

    private setTextCssVar(kind: EntityKind | string, hslValue: string): void {
        const varName = this.getTextCssVarName(kind);
        // Only run on client
        if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty(varName, hslValue);
        }
    }

    private setSourceCssVar(source: EntitySourceSystem | string, hslValue: string): void {
        const varName = this.getSourceCssVarName(source);
        if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty(varName, hslValue);
        }
    }

    private syncAllToCssVars(): void {
        for (const [kind, hsl] of Object.entries(this.colors)) {
            this.setCssVar(kind, hsl);
        }
        for (const [kind, hsl] of Object.entries(this.textColors)) {
            this.setTextCssVar(kind, hsl);
        }
        for (const [source, hsl] of Object.entries(this.sourceColors)) {
            this.setSourceCssVar(source, hsl);
        }
    }

    // ============================================
    // SUBSCRIPTIONS
    // ============================================

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        // Create new snapshot references so useSyncExternalStore detects change
        this.snapshot = { ...this.colors };
        this.textSnapshot = { ...this.textColors };
        this.sourceSnapshot = { ...this.sourceColors };
        this.listeners.forEach(fn => fn());
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const entityColorStore = new EntityColorStore();

// ============================================
// CONVENIENCE FUNCTIONS (for easy import)
// ============================================

/**
 * Get entity pill color as CSS hsl() string using CSS variable
 * Usage: style={{ backgroundColor: getEntityColor('CHARACTER') }}
 * Returns: 'hsl(var(--entity-character))'
 */
export function getEntityColor(kind: EntityKind | string | undefined): string {
    if (!kind) return 'hsl(var(--entity-unknown))';
    return entityColorStore.getEntityColor(kind);
}

/**
 * Get entity text color as CSS hsl() string using CSS variable
 * Usage: style={{ color: getEntityTextColor('CHARACTER') }}
 * Returns: 'hsl(var(--entity-character-text))'
 */
export function getEntityTextColor(kind: EntityKind | string | undefined): string {
    if (!kind) return 'hsl(var(--entity-unknown-text))';
    return entityColorStore.getEntityTextColor(kind);
}

/**
 * Get entity background color with opacity
 * Usage: style={{ backgroundColor: getEntityBgColor('CHARACTER') }}
 * Returns: 'hsl(var(--entity-character) / 0.2)'
 */
export function getEntityBgColor(kind: EntityKind | string | undefined, opacity = 0.2): string {
    if (!kind) return `hsl(var(--entity-unknown) / ${opacity})`;
    return entityColorStore.getEntityBgColor(kind, opacity);
}

export function getEntitySourceColor(source: EntitySourceSystem | string | undefined): string {
    if (!source) return 'hsl(var(--entity-source-legacy))';
    return entityColorStore.getSourceColor(source);
}

export function getEntitySourceBgColor(source: EntitySourceSystem | string | undefined, opacity = 0.16): string {
    if (!source) return `hsl(var(--entity-source-legacy) / ${opacity})`;
    return entityColorStore.getSourceBgColor(source, opacity);
}

/**
 * Get CSS variable name for pill color
 * Returns: '--entity-character'
 */
export function getEntityColorVar(kind: EntityKind | string): string {
    return entityColorStore.getCssVarName(kind);
}

/**
 * Get CSS variable name for text color
 * Returns: '--entity-character-text'
 */
export function getEntityTextColorVar(kind: EntityKind | string): string {
    return entityColorStore.getTextCssVarName(kind);
}
