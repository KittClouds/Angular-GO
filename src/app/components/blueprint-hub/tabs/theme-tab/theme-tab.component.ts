import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { entityColorStore, DEFAULT_ENTITY_COLORS, DEFAULT_ENTITY_TEXT_COLORS } from '../../../../lib/store/entityColorStore';
import type { EntityKind } from '../../../../lib/Scanner/types';
import { HighlightingModeToggleComponent } from './highlighting-mode-toggle/highlighting-mode-toggle.component';

// Entity categories for organization
interface EntityCategory {
    name: string;
    icon: string;
    kinds: EntityKind[];
}

const ENTITY_CATEGORIES: EntityCategory[] = [
    {
        name: 'Characters',
        icon: 'pi pi-users',
        kinds: ['CHARACTER', 'NPC', 'CREATURE']
    },
    {
        name: 'Locations',
        icon: 'pi pi-map',
        kinds: ['LOCATION']
    },
    {
        name: 'Groups',
        icon: 'pi pi-sitemap',
        kinds: ['FACTION', 'ORGANIZATION', 'NETWORK']
    },
    {
        name: 'Narrative Structure',
        icon: 'pi pi-bookmark',
        kinds: ['NARRATIVE', 'ARC', 'ACT', 'CHAPTER', 'SCENE', 'BEAT']
    },
    {
        name: 'Events & Time',
        icon: 'pi pi-clock',
        kinds: ['EVENT', 'TIMELINE']
    },
    {
        name: 'Objects & Concepts',
        icon: 'pi pi-box',
        kinds: ['ITEM', 'CONCEPT']
    }
];

// HSL <-> Hex utilities
function hslToHex(hslString: string): string {
    try {
        const [h, s, l] = hslString.split(' ').map((v, i) =>
            i === 0 ? parseFloat(v) : parseFloat(v.replace('%', ''))
        );
        const sNorm = s / 100;
        const lNorm = l / 100;
        const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = lNorm - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; b = 0; }
        else if (h < 120) { r = x; g = c; b = 0; }
        else if (h < 180) { r = 0; g = c; b = x; }
        else if (h < 240) { r = 0; g = x; b = c; }
        else if (h < 300) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }
        const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } catch { return '#888888'; }
}

function hexToHsl(hex: string): string {
    try {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return '220 10% 50%';
        const r = parseInt(result[1], 16) / 255;
        const g = parseInt(result[2], 16) / 255;
        const b = parseInt(result[3], 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
                case g: h = ((b - r) / d + 2) * 60; break;
                case b: h = ((r - g) / d + 4) * 60; break;
            }
        }
        return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
    } catch { return '220 10% 50%'; }
}

@Component({
    selector: 'app-theme-tab',
    standalone: true,
    imports: [CommonModule, FormsModule, HighlightingModeToggleComponent],
    templateUrl: './theme-tab.component.html',
    styleUrls: ['./theme-tab.component.css']
})
export class ThemeTabComponent {
    // State
    searchQuery = signal('');
    selectedKind = signal<EntityKind>('CHARACTER');
    collapsedCategories = signal<Set<string>>(new Set());

    // Categories data
    categories = ENTITY_CATEGORIES;

    // Computed: filtered categories based on search
    filteredCategories = computed(() => {
        const query = this.searchQuery().toLowerCase();
        if (!query) return this.categories;

        return this.categories
            .map(cat => ({
                ...cat,
                kinds: cat.kinds.filter(k => k.toLowerCase().includes(query))
            }))
            .filter(cat => cat.kinds.length > 0);
    });

    // Get hex colors for the selected kind
    getHexColor(kind: EntityKind): string {
        const raw = entityColorStore.getRawHsl(kind) || DEFAULT_ENTITY_COLORS[kind] || '220 10% 50%';
        return hslToHex(raw);
    }

    getHexTextColor(kind: EntityKind): string {
        const raw = entityColorStore.getRawTextHsl(kind) || DEFAULT_ENTITY_TEXT_COLORS[kind] || '220 10% 50%';
        return hslToHex(raw);
    }

    // Update colors
    updateColor(kind: EntityKind, hexColor: string): void {
        entityColorStore.setColor(kind, hexToHsl(hexColor));
    }

    updateTextColor(kind: EntityKind, hexColor: string): void {
        entityColorStore.setTextColor(kind, hexToHsl(hexColor));
    }

    // Actions
    selectKind(kind: EntityKind): void {
        this.selectedKind.set(kind);
    }

    toggleCategory(categoryName: string): void {
        const collapsed = this.collapsedCategories();
        const newSet = new Set(collapsed);
        if (newSet.has(categoryName)) {
            newSet.delete(categoryName);
        } else {
            newSet.add(categoryName);
        }
        this.collapsedCategories.set(newSet);
    }

    isCategoryCollapsed(categoryName: string): boolean {
        return this.collapsedCategories().has(categoryName);
    }

    resetSelected(): void {
        const kind = this.selectedKind();
        entityColorStore.setColor(kind, DEFAULT_ENTITY_COLORS[kind]);
        entityColorStore.setTextColor(kind, DEFAULT_ENTITY_TEXT_COLORS[kind]);
    }

    resetAll(): void {
        entityColorStore.reset();
    }

    applyToCategory(): void {
        const kind = this.selectedKind();
        const color = entityColorStore.getRawHsl(kind);
        const textColor = entityColorStore.getRawTextHsl(kind);

        // Find the category this kind belongs to
        const category = this.categories.find(c => c.kinds.includes(kind));
        if (category) {
            for (const k of category.kinds) {
                entityColorStore.setColor(k, color);
                entityColorStore.setTextColor(k, textColor);
            }
        }
    }

    // Format kind name for display
    formatKindName(kind: EntityKind): string {
        return kind.charAt(0) + kind.slice(1).toLowerCase().replace(/_/g, ' ');
    }
}
