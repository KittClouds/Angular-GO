// Custom Slider Service
// Narrative-scoped slider definitions persisted in scoped_definitions.

import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { CustomSliderDef, db } from '../../../lib/dexie/db';
import { UMBRA_PRESETS, UmbraPreset } from '../types/umbra-presets';
import { ScopeService } from '../../../lib/services/scope.service';
import { ScopedEntityFieldService } from '../../../lib/services/scoped-entity-field.service';

const SLIDER_DEFINITION_NAMESPACE = 'fact_sheet.slider_definitions';

@Injectable({
    providedIn: 'root'
})
export class CustomSliderService {
    private scopeService = inject(ScopeService);
    private scopedFields = inject(ScopedEntityFieldService);

    private _sliders = signal<CustomSliderDef[]>([]);
    readonly sliders = this._sliders.asReadonly();

    getSlidersByKind = computed(() => {
        const byKind = new Map<string, CustomSliderDef[]>();
        for (const slider of this._sliders()) {
            const list = byKind.get(slider.entityKind) || [];
            list.push(slider);
            byKind.set(slider.entityKind, list);
        }
        return byKind;
    });

    readonly umbraPresets = UMBRA_PRESETS;

    constructor() {
        effect(() => {
            this.scopeService.resolvedScope();
            void this.loadAll();
        });
    }

    async loadAll(): Promise<void> {
        const narrativeId = this.getDefinitionNarrativeId();
        if (!narrativeId) {
            this._sliders.set([]);
            return;
        }

        const definitions = await this.scopedFields.listDefinitionPayloads<CustomSliderDef[]>(narrativeId, SLIDER_DEFINITION_NAMESPACE, []);
        if (definitions.length === 0) {
            await this.migrateLegacyDexieDefinitions(narrativeId);
            const migrated = await this.scopedFields.listDefinitionPayloads<CustomSliderDef[]>(narrativeId, SLIDER_DEFINITION_NAMESPACE, []);
            this._sliders.set(migrated.flatMap(item => item.payload));
            return;
        }

        this._sliders.set(definitions.flatMap(item => item.payload));
    }

    async getForEntityKind(entityKind: string): Promise<CustomSliderDef[]> {
        await this.loadAll();
        return this._sliders()
            .filter(slider => slider.entityKind === entityKind)
            .sort((a, b) => a.displayOrder - b.displayOrder);
    }

    async createSlider(
        entityKind: string,
        name: string,
        label: string,
        preset?: UmbraPreset
    ): Promise<CustomSliderDef> {
        const narrativeId = this.getDefinitionNarrativeId();
        if (!narrativeId) {
            throw new Error('No narrative scope available for slider definitions');
        }

        const now = Date.now();
        const id = `slider-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const existing = await this.getForEntityKind(entityKind);
        const displayOrder = existing.length * 10;
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

        await this.saveEntityKindDefinitions(narrativeId, entityKind, [...existing, slider]);
        await this.loadAll();
        return slider;
    }

    async updateUmbra(sliderId: string, preset: UmbraPreset): Promise<void> {
        await this.updateSlider(sliderId, {
            colorLow: preset.colorLow,
            colorMid: preset.colorMid,
            colorHigh: preset.colorHigh,
            umbraPreset: preset.id,
        });
    }

    async updateSlider(sliderId: string, updates: Partial<CustomSliderDef>): Promise<void> {
        const narrativeId = this.getDefinitionNarrativeId();
        if (!narrativeId) return;

        const slider = this._sliders().find(item => item.id === sliderId);
        if (!slider) return;

        const list = await this.getForEntityKind(slider.entityKind);
        const next = list.map(item =>
            item.id === sliderId
                ? { ...item, ...updates, updatedAt: Date.now() }
                : item
        );

        await this.saveEntityKindDefinitions(narrativeId, slider.entityKind, next);
        await this.loadAll();
    }

    async deleteSlider(sliderId: string): Promise<boolean> {
        const narrativeId = this.getDefinitionNarrativeId();
        if (!narrativeId) return false;

        const slider = this._sliders().find(item => item.id === sliderId);
        if (!slider || slider.isSystem) {
            console.warn('[CustomSliderService] Cannot delete system slider');
            return false;
        }

        const next = (await this.getForEntityKind(slider.entityKind)).filter(item => item.id !== sliderId);
        await this.saveEntityKindDefinitions(narrativeId, slider.entityKind, next);
        await this.loadAll();
        return true;
    }

    async reorderSliders(entityKind: string, orderedIds: string[]): Promise<void> {
        const narrativeId = this.getDefinitionNarrativeId();
        if (!narrativeId) return;

        const mapById = new Map((await this.getForEntityKind(entityKind)).map(slider => [slider.id, slider]));
        const next = orderedIds
            .map((id, index) => {
                const slider = mapById.get(id);
                if (!slider) return null;
                return {
                    ...slider,
                    displayOrder: index * 10,
                    updatedAt: Date.now(),
                };
            })
            .filter((slider): slider is CustomSliderDef => !!slider);

        await this.saveEntityKindDefinitions(narrativeId, entityKind, next);
        await this.loadAll();
    }

    private getDefinitionNarrativeId(): string {
        return this.scopeService.resolvedScope().narrativeId || 'vault:global';
    }

    private async saveEntityKindDefinitions(narrativeId: string, entityKind: string, sliders: CustomSliderDef[]): Promise<void> {
        await this.scopedFields.saveDefinitionPayload(
            narrativeId,
            SLIDER_DEFINITION_NAMESPACE,
            entityKind,
            sliders.sort((a, b) => a.displayOrder - b.displayOrder)
        );
    }

    private async migrateLegacyDexieDefinitions(narrativeId: string): Promise<void> {
        const allSliders = await db.customSliderDefs.orderBy('displayOrder').toArray();
        const byKind = new Map<string, CustomSliderDef[]>();

        for (const slider of allSliders) {
            const list = byKind.get(slider.entityKind) || [];
            list.push(slider);
            byKind.set(slider.entityKind, list);
        }

        for (const [entityKind, sliders] of byKind.entries()) {
            await this.saveEntityKindDefinitions(narrativeId, entityKind, sliders);
        }
    }
}
