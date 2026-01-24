import { Component, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    highlightingStore,
    type HighlightMode,
    HIGHLIGHT_MODE_LABELS,
    HIGHLIGHT_MODE_DESCRIPTIONS
} from '../../../../../lib/store/highlightingStore';
import type { EntityKind } from '../../../../../lib/Scanner/types';

// All entity kinds for focus mode selection
const ENTITY_KINDS: EntityKind[] = [
    'ACT', 'ARC', 'BEAT', 'CHAPTER', 'CHARACTER', 'CONCEPT', 'CREATURE',
    'EVENT', 'FACTION', 'ITEM', 'LOCATION', 'NARRATIVE', 'NETWORK',
    'NPC', 'ORGANIZATION', 'SCENE', 'TIMELINE'
];

/** Mode colors for styling */
const MODE_COLORS: Record<HighlightMode, string> = {
    clean: 'text-teal-400',
    vivid: 'text-violet-400',
    focus: 'text-amber-400',
    off: 'text-muted-foreground',
};

/** Mode icons (PrimeNG icon classes) */
const MODE_ICONS: Record<HighlightMode, string> = {
    clean: 'pi pi-eye',
    vivid: 'pi pi-sparkles',
    focus: 'pi pi-bullseye',
    off: 'pi pi-eye-slash',
};

@Component({
    selector: 'app-highlighting-mode-toggle',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './highlighting-mode-toggle.component.html',
    styleUrls: ['./highlighting-mode-toggle.component.css']
})
export class HighlightingModeToggleComponent {
    // State signals
    mode = signal<HighlightMode>('vivid');
    focusEntityKinds = signal<EntityKind[]>([]);
    isOpen = signal(false);

    // Static data for template
    modes: HighlightMode[] = ['clean', 'vivid', 'focus', 'off'];
    entityKinds = ENTITY_KINDS.sort();
    labels = HIGHLIGHT_MODE_LABELS;
    descriptions = HIGHLIGHT_MODE_DESCRIPTIONS;

    constructor() {
        // Sync with store
        const settings = highlightingStore.getSnapshot();
        this.mode.set(settings.mode);
        this.focusEntityKinds.set(settings.focusEntityKinds);

        // Subscribe to store changes
        highlightingStore.subscribe(() => {
            const s = highlightingStore.getSnapshot();
            this.mode.set(s.mode);
            this.focusEntityKinds.set(s.focusEntityKinds);
        });
    }

    getColorClass(m: HighlightMode): string {
        return MODE_COLORS[m];
    }

    getIconClass(m: HighlightMode): string {
        return MODE_ICONS[m];
    }

    toggleDropdown(): void {
        this.isOpen.update(v => !v);
    }

    closeDropdown(): void {
        this.isOpen.set(false);
    }

    selectMode(m: HighlightMode): void {
        highlightingStore.setMode(m);
        if (m !== 'focus') {
            this.closeDropdown();
        }
    }

    isKindSelected(kind: EntityKind): boolean {
        return this.focusEntityKinds().includes(kind);
    }

    toggleKind(kind: EntityKind): void {
        highlightingStore.toggleFocusKind(kind);
    }
}
