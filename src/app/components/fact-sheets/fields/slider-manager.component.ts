// Slider Manager Component
// Container for all sliders + Add New button

import { Component, Input, inject, signal, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Plus, X } from 'lucide-angular';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CustomSliderService } from '../services/custom-slider.service';
import { DynamicSliderComponent } from './dynamic-slider.component';
import { CustomSliderDef, db } from '../../../lib/dexie/db';
import { UMBRA_PRESETS, UmbraPreset } from '../types/umbra-presets';

@Component({
    selector: 'app-slider-manager',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule, DragDropModule, DynamicSliderComponent],
    template: `
        <div class="slider-manager space-y-2">
            <!-- Sliders List (draggable) -->
            <div 
                cdkDropList 
                (cdkDropListDropped)="onDrop($event)"
                class="space-y-1"
            >
                @for (slider of sliders(); track slider.id) {
                    <div cdkDrag class="slider-item">
                        <app-dynamic-slider
                            [slider]="slider"
                            [currentValue]="getSliderValue(slider.name)"
                            (valueChange)="onValueChange(slider.name, $event)"
                            (umbraChange)="onUmbraChange(slider.id, $event)"
                            (delete)="onDeleteSlider($event)"
                        />
                    </div>
                }
            </div>
            
            <!-- Status Conditions (for CHARACTER) -->
            @if (entityKind === 'CHARACTER') {
                <div class="pt-2 border-t border-border/30">
                    <label class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Status Conditions
                    </label>
                    <input 
                        type="text"
                        class="w-full mt-1 px-2 py-1.5 text-sm bg-transparent border-b border-border/50 focus:border-primary outline-none"
                        placeholder="Add status conditions... (Press Enter)"
                    />
                </div>
            }
            
            <!-- Add New Slider -->
            <div class="pt-2">
                @if (!showAddForm) {
                    <button 
                        type="button"
                        class="w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded-md border border-dashed border-border/50 flex items-center justify-center gap-2 transition-colors"
                        (click)="showAddForm = true"
                    >
                        <lucide-icon [img]="PlusIcon" class="w-4 h-4"></lucide-icon>
                        Add Stat
                    </button>
                } @else {
                    <div class="add-slider-form p-3 bg-muted/20 rounded-md border border-border/50 space-y-3">
                        <!-- Name Input -->
                        <div>
                            <label class="text-xs text-muted-foreground">Stat Name</label>
                            <input 
                                type="text"
                                class="w-full mt-1 px-2 py-1.5 text-sm bg-background border border-border rounded focus:border-primary outline-none"
                                placeholder="e.g., Sanity, Corruption, Renown"
                                [(ngModel)]="newSliderName"
                            />
                        </div>
                        
                        <!-- Umbra Preset Selector -->
                        <div>
                            <label class="text-xs text-muted-foreground">Color Theme</label>
                            <div class="grid grid-cols-4 gap-1 mt-1">
                                @for (preset of umbraPresets; track preset.id) {
                                    <button 
                                        type="button"
                                        class="p-1.5 rounded border text-[10px] flex flex-col items-center gap-1 transition-all"
                                        [class.border-primary]="selectedUmbra === preset.id"
                                        [class.border-border/50]="selectedUmbra !== preset.id"
                                        [class.bg-muted/50]="selectedUmbra === preset.id"
                                        (click)="selectedUmbra = preset.id"
                                    >
                                        <div class="flex gap-0.5">
                                            <span class="w-2 h-2 rounded-full" [style.background]="preset.colorLow"></span>
                                            <span class="w-2 h-2 rounded-full" [style.background]="preset.colorMid"></span>
                                            <span class="w-2 h-2 rounded-full" [style.background]="preset.colorHigh"></span>
                                        </div>
                                        {{ preset.name }}
                                    </button>
                                }
                            </div>
                        </div>
                        
                        <!-- Actions -->
                        <div class="flex items-center gap-2">
                            <button 
                                type="button"
                                class="flex-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
                                [disabled]="!newSliderName.trim()"
                                (click)="addSlider()"
                            >
                                Add
                            </button>
                            <button 
                                type="button"
                                class="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                                (click)="cancelAdd()"
                            >
                                <lucide-icon [img]="XIcon" class="w-4 h-4"></lucide-icon>
                            </button>
                        </div>
                    </div>
                }
            </div>
        </div>
    `,
    styles: [`
        .slider-item {
            cursor: grab;
        }
        .slider-item:active {
            cursor: grabbing;
        }
        .cdk-drag-preview {
            background: var(--card);
            border-radius: 0.5rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .cdk-drag-placeholder {
            opacity: 0.3;
        }
    `]
})
export class SliderManagerComponent implements OnInit {
    @Input({ required: true }) entityKind!: string;
    @Input({ required: true }) entityId!: string;

    private sliderService = inject(CustomSliderService);

    readonly PlusIcon = Plus;
    readonly XIcon = X;
    readonly umbraPresets = UMBRA_PRESETS;

    sliders = signal<CustomSliderDef[]>([]);
    sliderValues = new Map<string, number>();

    showAddForm = false;
    newSliderName = '';
    selectedUmbra = 'vitals';

    async ngOnInit() {
        await this.loadSliders();
        await this.loadValues();
    }

    async loadSliders() {
        const all = await this.sliderService.getForEntityKind(this.entityKind);
        this.sliders.set(all);
    }

    async loadValues() {
        // Load current slider values from EntityMetadata
        const metadata = await db.entityMetadata
            .where('[entityId+contextId]')
            .equals([this.entityId, 'global'])
            .toArray();

        for (const m of metadata) {
            this.sliderValues.set(m.key, parseFloat(m.value) || 0);
        }
    }

    getSliderValue(name: string): number {
        return this.sliderValues.get(name) || 0;
    }

    async onValueChange(name: string, value: number) {
        this.sliderValues.set(name, value);

        // Persist to EntityMetadata
        await db.entityMetadata.put({
            entityId: this.entityId,
            key: name,
            value: String(value),
            contextId: 'global',
        });
    }

    async onUmbraChange(sliderId: string, presetId: string) {
        const preset = UMBRA_PRESETS.find(p => p.id === presetId);
        if (preset) {
            await this.sliderService.updateUmbra(sliderId, preset);
            await this.loadSliders();
        }
    }

    async onDeleteSlider(sliderId: string) {
        if (confirm('Remove this stat? (Data will be preserved)')) {
            await this.sliderService.deleteSlider(sliderId);
            await this.loadSliders();
        }
    }

    async onDrop(event: CdkDragDrop<CustomSliderDef[]>) {
        const items = [...this.sliders()];
        moveItemInArray(items, event.previousIndex, event.currentIndex);
        this.sliders.set(items);

        // Persist new order
        await this.sliderService.reorderSliders(
            this.entityKind,
            items.map(s => s.id)
        );
    }

    async addSlider() {
        if (!this.newSliderName.trim()) return;

        const preset = UMBRA_PRESETS.find(p => p.id === this.selectedUmbra);
        await this.sliderService.createSlider(
            this.entityKind,
            this.newSliderName.trim(),
            this.newSliderName.trim(),
            preset
        );

        await this.loadSliders();
        this.cancelAdd();
    }

    cancelAdd() {
        this.showAddForm = false;
        this.newSliderName = '';
        this.selectedUmbra = 'vitals';
    }
}
