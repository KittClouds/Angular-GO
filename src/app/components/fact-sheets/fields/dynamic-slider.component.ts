// Dynamic Slider Component
// A single stat slider with umbra gradient coloring

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Trash2, ChevronDown } from 'lucide-angular';
import { CustomSliderDef } from '../../../lib/dexie/db';
import { getUmbraColor, UMBRA_PRESETS } from '../types/umbra-presets';

@Component({
    selector: 'app-dynamic-slider',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule],
    template: `
        <div class="slider-row group">
            <!-- Header: Label + Value -->
            <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {{ slider.label }}
                </span>
                <span class="text-sm font-semibold" [style.color]="currentColor()">
                    {{ currentValue }} / {{ slider.max }}
                </span>
            </div>
            
            <!-- Slider Track -->
            <div class="slider-track relative h-2 rounded-full bg-muted/30 overflow-hidden">
                <!-- Fill -->
                <div 
                    class="slider-fill absolute inset-y-0 left-0 rounded-full transition-all duration-200"
                    [style.width.%]="fillPercentage()"
                    [style.background]="gradientCss()"
                ></div>
                
                <!-- Thumb handle (hidden input range) -->
                <input 
                    type="range"
                    class="slider-input absolute inset-0 w-full opacity-0 cursor-pointer"
                    [min]="slider.min"
                    [max]="slider.max"
                    [value]="currentValue"
                    (input)="onSliderInput($event)"
                />
            </div>
            
            <!-- Actions (visible on hover) -->
            <div class="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <!-- Umbra Preset Dropdown -->
                <div class="relative">
                    <button 
                        type="button"
                        class="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                        (click)="showUmbraMenu = !showUmbraMenu"
                    >
                        <span class="w-2 h-2 rounded-full" [style.background]="slider.colorHigh"></span>
                        {{ slider.umbraPreset || 'neutral' }}
                        <lucide-icon [img]="ChevronDown" class="w-3 h-3"></lucide-icon>
                    </button>
                    
                    <!-- Umbra Menu -->
                    @if (showUmbraMenu) {
                        <div class="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg p-1 min-w-[120px]">
                            @for (preset of umbraPresets; track preset.id) {
                                <button 
                                    type="button"
                                    class="w-full px-2 py-1 text-left text-xs hover:bg-muted/50 rounded flex items-center gap-2"
                                    (click)="selectUmbra(preset.id)"
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
                    }
                </div>
                
                <!-- Delete (only for non-system) -->
                @if (!slider.isSystem) {
                    <button 
                        type="button"
                        class="text-muted-foreground hover:text-destructive"
                        (click)="delete.emit(slider.id)"
                        title="Remove stat"
                    >
                        <lucide-icon [img]="Trash2Icon" class="w-3 h-3"></lucide-icon>
                    </button>
                }
            </div>
        </div>
    `,
    styles: [`
        .slider-row {
            padding: 0.5rem 0;
        }
        
        .slider-track {
            height: 0.5rem;
        }
        
        .slider-input {
            -webkit-appearance: none;
            height: 100%;
        }
        
        .slider-input::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: white;
            border: 2px solid currentColor;
            cursor: pointer;
            margin-top: -3px;
        }
    `]
})
export class DynamicSliderComponent {
    @Input({ required: true }) slider!: CustomSliderDef;
    @Input() currentValue: number = 0;
    @Output() valueChange = new EventEmitter<number>();
    @Output() umbraChange = new EventEmitter<string>();
    @Output() delete = new EventEmitter<string>();

    readonly Trash2Icon = Trash2;
    readonly ChevronDown = ChevronDown;
    readonly umbraPresets = UMBRA_PRESETS;

    showUmbraMenu = false;

    fillPercentage(): number {
        const range = this.slider.max - this.slider.min;
        return range > 0 ? ((this.currentValue - this.slider.min) / range) * 100 : 0;
    }

    currentColor(): string {
        return getUmbraColor(
            this.currentValue,
            this.slider.max,
            this.slider.colorLow,
            this.slider.colorMid,
            this.slider.colorHigh
        );
    }

    gradientCss(): string {
        return `linear-gradient(to right, ${this.slider.colorLow}, ${this.slider.colorMid || this.slider.colorHigh}, ${this.slider.colorHigh})`;
    }

    onSliderInput(event: Event) {
        const value = parseInt((event.target as HTMLInputElement).value, 10);
        this.valueChange.emit(value);
    }

    selectUmbra(presetId: string) {
        this.showUmbraMenu = false;
        this.umbraChange.emit(presetId);
    }
}
