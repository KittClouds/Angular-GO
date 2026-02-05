// Custom Slider Service
// Manages CRUD operations for custom slider definitions

import { Injectable, signal, computed } from '@angular/core';
import { db, CustomSliderDef } from '../../../lib/dexie/db';
import { UMBRA_PRESETS, UmbraPreset } from '../types/umbra-presets';

@Injectable({
    providedIn: 'root'
})
export class CustomSliderService {
    // Signal-based state for reactivity
    private _sliders = signal<CustomSliderDef[]>([]);
    readonly sliders = this._sliders.asReadonly();

    // Get sliders by entity kind
    getSlidersByKind = computed(() => {
        const byKind = new Map<string, CustomSliderDef[]>();
        for (const slider of this._sliders()) {
            const list = byKind.get(slider.entityKind) || [];
            list.push(slider);
            byKind.set(slider.entityKind, list);
        }
        return byKind;
    });

    // Umbra presets for UI
    readonly umbraPresets = UMBRA_PRESETS;

    constructor() {
        this.loadAll();
    }

    /**
     * Load all custom sliders from Dexie
     */
    async loadAll(): Promise<void> {
        const sliders = await db.customSliderDefs.orderBy('displayOrder').toArray();
        this._sliders.set(sliders);
    }

    /**
     * Get sliders for a specific entity kind
     */
    async getForEntityKind(entityKind: string): Promise<CustomSliderDef[]> {
        return await db.customSliderDefs
            .where('entityKind')
            .equals(entityKind)
            .sortBy('displayOrder');
    }

    /**
     * Create a new custom slider
     */
    async createSlider(
        entityKind: string,
        name: string,
        label: string,
        preset?: UmbraPreset
    ): Promise<CustomSliderDef> {
        const now = Date.now();
        const id = `slider-${now}-${Math.random().toString(36).slice(2, 8)}`;

        // Get current count for display order
        const existing = await this.getForEntityKind(entityKind);
        const displayOrder = existing.length * 10;

        // Use preset or default to neutral
        const defaultPreset = preset || UMBRA_PRESETS.find(p => p.id === 'neutral')!;

        const slider: CustomSliderDef = {
            id,
            entityKind,
            name: name.toLowerCase().replace(/\s+/g, '_'),
            label,
            colorLow: defaultPreset.colorLow,
            colorMid: defaultPreset.colorMid,
            colorHigh: defaultPreset.colorHigh,
            umbraPreset: defaultPreset.id,
            min: 0,
            max: 100,
            icon: 'Activity',
            isSystem: false,
            displayOrder,
            createdAt: now,
            updatedAt: now,
        };

        await db.customSliderDefs.put(slider);
        await this.loadAll();
        return slider;
    }

    /**
     * Update a slider's umbra preset
     */
    async updateUmbra(sliderId: string, preset: UmbraPreset): Promise<void> {
        await db.customSliderDefs.update(sliderId, {
            colorLow: preset.colorLow,
            colorMid: preset.colorMid,
            colorHigh: preset.colorHigh,
            umbraPreset: preset.id,
            updatedAt: Date.now(),
        });
        await this.loadAll();
    }

    /**
     * Update slider properties
     */
    async updateSlider(sliderId: string, updates: Partial<CustomSliderDef>): Promise<void> {
        await db.customSliderDefs.update(sliderId, {
            ...updates,
            updatedAt: Date.now(),
        });
        await this.loadAll();
    }

    /**
     * Delete a custom slider (only if not system)
     */
    async deleteSlider(sliderId: string): Promise<boolean> {
        const slider = await db.customSliderDefs.get(sliderId);
        if (!slider || slider.isSystem) {
            console.warn('[CustomSliderService] Cannot delete system slider');
            return false;
        }

        await db.customSliderDefs.delete(sliderId);
        await this.loadAll();
        return true;
    }

    /**
     * Reorder sliders via drag-and-drop
     */
    async reorderSliders(entityKind: string, orderedIds: string[]): Promise<void> {
        const updates = orderedIds.map((id, index) =>
            db.customSliderDefs.update(id, { displayOrder: index * 10, updatedAt: Date.now() })
        );
        await Promise.all(updates);
        await this.loadAll();
    }
}
