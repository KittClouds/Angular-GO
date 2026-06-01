import { Component, input, signal, computed, effect, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, CdkDrag, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { LucideAngularModule } from 'lucide-angular';
import { Knob } from 'primeng/knob';
import { Slider } from 'primeng/slider';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { FactSheetCardComponent } from '../fact-sheet-card/fact-sheet-card.component';
import { FactSheetService, CardWithFields } from '../fact-sheet.service';
import { EntityGraphFactSheetService } from '../entity-graph-fact-sheet.service';
import type { EntityGraphFactSheetRelationRow, EntityGraphFactSheetView } from '../entity-graph-fact-sheet';
import { FactSheetFieldSchema } from '../../../lib/dexie';
import { SliderManagerComponent } from '../fields/slider-manager.component';
import { smartGraphRegistry } from '../../../lib/registry';
import { UMBRA_PRESETS, getUmbraColor } from '../types/umbra-presets';
import { calculateScaledStat } from '../../../lib/math/progression.math';
export interface ParsedEntity {
  id: string;
  kind: string;
  label: string;
  subtype?: string;
  noteId?: string;
}

@Component({
  selector: 'app-fact-sheet-container',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    CdkDropList,
    CdkDrag,
    Knob,
    Slider,
    InputText,
    InputNumber,
    FactSheetCardComponent,
    SliderManagerComponent,
  ],
  template: `
    @if (entity(); as ent) {
      <div class="fact-sheet-container p-3 space-y-3 pb-20">
        <!-- Entity Header -->
        <div class="text-center pb-2 border-b border-border/50">
          <span class="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            {{ ent.kind }}
          </span>
          <h3 class="text-lg font-semibold text-foreground">{{ ent.label }}</h3>
          @if (ent.subtype) {
            <span class="text-xs text-muted-foreground">{{ ent.subtype }}</span>
          }
        </div>

        <!-- Cards with CDK DragDrop -->
        <div
          cdkDropList
          class="cards-list space-y-3"
          (cdkDropListDropped)="onDrop($event)"
        >
          @for (card of orderedCards(); track card.schema.id) {
            <app-fact-sheet-card
              cdkDrag
              class="block"
              [title]="card.schema.title"
              [icon]="card.schema.icon"
              [gradientCss]="card.gradientCss"
            >
                @for (field of card.fields; track field.id) {
                  <div class="field-item">
                    @if (usesDirectFieldLabel(field)) {
                      <label
                        class="text-xs font-medium text-muted-foreground block mb-1"
                        [id]="getFieldLabelId(card.schema.cardId, field.fieldName)"
                        [attr.for]="getFieldControlId(card.schema.cardId, field.fieldName)"
                      >
                        {{ field.label }}
                      </label>
                    } @else {
                      <span
                        class="text-xs font-medium text-muted-foreground block mb-1"
                        [id]="getFieldLabelId(card.schema.cardId, field.fieldName)"
                      >
                        {{ field.label }}
                      </span>
                    }

                    @switch (field.fieldType) {
                      <!-- EDITABLE TEXT / TEXTAREA -->
                      @case ('text') {
                        @if (editingField() === field.fieldName) {
                          @if (isLongTextField(field.fieldName)) {
                            <textarea
                              [id]="getFieldControlId(card.schema.cardId, field.fieldName)"
                              [attr.name]="getFieldControlName(card.schema.cardId, field.fieldName)"
                              class="w-full text-sm bg-background border border-border rounded p-2 min-h-[5rem] focus:outline-none focus:ring-1 focus:ring-primary"
                              [ngModel]="getValue(field.fieldName) || ''"
                              [attr.aria-labelledby]="getFieldLabelId(card.schema.cardId, field.fieldName)"
                              (ngModelChange)="onTextChange(field.fieldName, $event)"
                              (blur)="stopEditing()"
                              autofocus
                            ></textarea>
                          } @else {
                            <input
                              [id]="getFieldControlId(card.schema.cardId, field.fieldName)"
                              [attr.name]="getFieldControlName(card.schema.cardId, field.fieldName)"
                              pInputText
                              type="text"
                              class="w-full text-sm"
                              [ngModel]="getValue(field.fieldName) || ''"
                              [attr.aria-labelledby]="getFieldLabelId(card.schema.cardId, field.fieldName)"
                              (ngModelChange)="onTextChange(field.fieldName, $event)"
                              (blur)="stopEditing()"
                              (keydown.enter)="stopEditing()"
                              autofocus
                            />
                          }
                        } @else {
                          <div
                            class="text-sm cursor-pointer hover:bg-muted/30 rounded px-2 py-1 -mx-2 transition-colors whitespace-pre-wrap"
                            [class.text-muted-foreground/60]="!getValue(field.fieldName)"
                            [class.italic]="!getValue(field.fieldName)"
                            (click)="startEditing(field.fieldName)"
                          >
                            {{ getValue(field.fieldName) || field.placeholder || 'Click to edit...' }}
                          </div>
                        }
                      }

                      <!-- EDITABLE NUMBER -->
                      @case ('number') {
                        <div class="flex items-center gap-2">
                          <p-inputNumber
                            [inputId]="getFieldControlId(card.schema.cardId, field.fieldName)"
                            [name]="getFieldControlName(card.schema.cardId, field.fieldName)"
                            [ariaLabelledBy]="getFieldLabelId(card.schema.cardId, field.fieldName)"
                            [(ngModel)]="numberModels()[field.fieldName]"
                            (ngModelChange)="onNumberChange(field.fieldName, $event)"
                            [showButtons]="true"
                            buttonLayout="horizontal"
                            [min]="field.min ?? 0"
                            [max]="field.max ?? 999999"
                            [step]="field.step ?? 1"
                            decrementButtonClass="p-button-secondary !bg-muted !border-border !text-foreground"
                            incrementButtonClass="p-button-secondary !bg-muted !border-border !text-foreground"
                            incrementButtonIcon="pi pi-plus"
                            decrementButtonIcon="pi pi-minus"
                            inputStyleClass="!bg-background !text-foreground !border-y !border-border text-center !w-16"
                          />
                          @if (field.unit) {
                            <span class="text-xs text-muted-foreground">{{ field.unit }}</span>
                          }
                        </div>
                      }

                      <!-- DROPDOWN SELECT -->
                      @case ('dropdown') {
                        <select
                          [id]="getFieldControlId(card.schema.cardId, field.fieldName)"
                          [attr.name]="getFieldControlName(card.schema.cardId, field.fieldName)"
                          class="w-full text-sm bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                          [ngModel]="getValue(field.fieldName) || ''"
                          [attr.aria-labelledby]="getFieldLabelId(card.schema.cardId, field.fieldName)"
                          (ngModelChange)="onDropdownChange(field.fieldName, $event)"
                        >
                          <option value="" disabled>Select {{ field.label }}...</option>
                          @for (opt of parseOptions(field.options); track opt) {
                            <option [value]="opt">{{ opt }}</option>
                          }
                        </select>
                      }

                      <!-- EDITABLE ARRAY (CUSTOM TAG EDITOR) -->
                      @case ('array') {
                        <div class="flex flex-wrap gap-2 mb-2">
                          @for (item of getArrayValue(field.fieldName); track $index) {
                            <span class="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full border border-primary/20">
                              {{ item }}
                              <button
                                (click)="removeArrayItem(field.fieldName, $index)"
                                class="hover:text-primary-foreground hover:bg-primary rounded-full w-4 h-4 flex items-center justify-center transition-colors"
                              >×</button>
                            </span>
                          }
                        </div>
                        <input
                          [id]="getFieldControlId(card.schema.cardId, field.fieldName)"
                          [attr.name]="getFieldControlName(card.schema.cardId, field.fieldName)"
                          type="text"
                          class="w-full text-sm bg-transparent border-b border-border/50 focus:border-primary transition-colors py-1 outline-none placeholder:text-muted-foreground/50 italic"
                          [placeholder]="'Add ' + field.label.toLowerCase() + '... (Press Enter)'"
                          [attr.aria-labelledby]="getFieldLabelId(card.schema.cardId, field.fieldName)"
                          (keydown.enter)="addArrayItem(field.fieldName, $event)"
                        />
                      }

                      <!-- INTERACTIVE PROGRESS (SLIDER) -->
                      @case ('progress') {
                        <div class="progress-field" [style.--progress-color]="getProgressColor(field)">
                          <div class="flex items-center justify-between mb-1">
                            <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {{ fieldNameTitle(field.currentField!) }}
                            </span>
                            <span class="text-sm font-medium" [style.color]="getProgressColor(field)">
                              {{ getValue(field.currentField!) ?? 0 }} / {{ getCalculatedMax(field) }}
                            </span>
                          </div>
                          <p-slider
                            [(ngModel)]="progressModels()[field.fieldName]"
                            (ngModelChange)="onProgressChange(field, $event)"
                            [min]="0"
                            [max]="getCalculatedMax(field)"
                            [ariaLabelledBy]="getFieldLabelId(card.schema.cardId, field.fieldName)"
                            [style]="{ width: '100%', '--progress-color': getProgressColor(field) }"
                          />
                        </div>
                      }

                      <!-- STAT GRID WITH KNOBS -->
                      @case ('stat-grid') {
                        <div class="grid grid-cols-3 gap-3">
                          @for (stat of parseStats(field.stats); track stat.name) {
                            <div class="stat-knob text-center">
                              <div
                                class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1"
                                [id]="getStatLabelId(card.schema.cardId, field.fieldName, stat.name)"
                              >
                                {{ stat.abbr }}
                              </div>
                              <p-knob
                                [(ngModel)]="statModels()[stat.name]"
                                (ngModelChange)="onStatChange(stat.name, $event)"
                                [size]="60"
                                [min]="1"
                                [max]="100"
                                [strokeWidth]="8"
                                valueColor="#a855f7"
                                rangeColor="#374151"
                                textColor="#e5e7eb"
                                [ariaLabel]="stat.label"
                                [ariaLabelledBy]="getStatLabelId(card.schema.cardId, field.fieldName, stat.name)"
                              />
                            </div>
                          }
                        </div>
                      }

                      <!-- RELATIONSHIP -->
                      @case ('relationship') {
                         <div class="space-y-2">
                              @if (relationshipView(); as graphView) {
                                <div class="grid grid-cols-4 gap-1.5">
                                  <div class="rounded border border-teal-300/15 bg-teal-400/5 px-2 py-1">
                                    <span class="block truncate text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Committed</span>
                                    <strong class="text-xs text-teal-100">{{ graphView.summary.committed }}</strong>
                                  </div>
                                  <div class="rounded border border-fuchsia-300/15 bg-fuchsia-400/5 px-2 py-1">
                                    <span class="block truncate text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Facts</span>
                                    <strong class="text-xs text-fuchsia-100">{{ graphView.summary.promoted }}</strong>
                                  </div>
                                  <div class="rounded border border-amber-300/15 bg-amber-400/5 px-2 py-1">
                                    <span class="block truncate text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Review</span>
                                    <strong class="text-xs text-amber-100">{{ graphView.summary.review }}</strong>
                                  </div>
                                  <div class="rounded border border-cyan-300/15 bg-cyan-400/5 px-2 py-1">
                                    <span class="block truncate text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Network</span>
                                    <strong class="text-xs text-cyan-100">{{ graphView.summary.network }}</strong>
                                  </div>
                                </div>
                                @if (getRelationshipRows().length === 0) {
                                  <div class="rounded border border-border/50 bg-muted/20 p-2 text-sm italic text-muted-foreground/70">
                                    No graph relationships yet
                                  </div>
                                } @else {
                                  <div class="space-y-1.5">
                                    @for (rel of getRelationshipRows(); track rel.id) {
                                      <div class="rounded border border-border/50 bg-muted/25 px-2.5 py-2">
                                        <div class="flex min-w-0 items-center justify-between gap-2">
                                          <div class="flex min-w-0 items-center gap-2">
                                            <span class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">
                                              {{ relationSourceLabel(rel.source) }}
                                            </span>
                                            <span class="truncate text-sm font-semibold text-foreground">
                                              {{ relationshipTargetText(rel) }}
                                            </span>
                                          </div>
                                          <span class="shrink-0 text-[10px] font-mono text-teal-200">
                                            {{ formatConfidence(rel.confidence) }}
                                          </span>
                                        </div>
                                        <div class="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                                          <span class="shrink-0 font-mono uppercase tracking-wider">{{ rel.relationType }}</span>
                                          <span class="truncate">{{ rel.status }}</span>
                                          @if (rel.evidenceCount > 0) {
                                            <span class="shrink-0">{{ rel.evidenceCount }} evidence</span>
                                          }
                                        </div>
                                      </div>
                                    }
                                  </div>
                                }
                             }
                        </div>
                      }

                      <!-- DYNAMIC SLIDERS (Custom Stats) -->
                      @case ('dynamic-sliders') {
                        <app-slider-manager
                          [entityKind]="ent.kind"
                          [entityId]="ent.id"
                        />
                      }

                      @default {
                        <div class="text-sm text-muted-foreground/60 italic">
                          {{ field.fieldType }} field
                        </div>
                      }
                    }
                  </div>
                }
            </app-fact-sheet-card>
          }
        </div>

        @if (orderedCards().length === 0) {
          <div class="text-center text-muted-foreground py-8">
            No schema found for {{ ent.kind }}
          </div>
        }
      </div>
    } @else {
      <div class="flex flex-col items-center justify-center h-full p-6 text-center">
        <lucide-icon name="file-question" class="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p class="text-sm text-muted-foreground">Select an entity to view details</p>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
    }

    .fact-sheet-container {
      min-height: 100%;
    }

    .field-item {
      padding: 0.5rem 0;
    }

    .field-item + .field-item {
      border-top: 1px solid hsl(var(--border) / 0.3);
      padding-top: 0.75rem;
      margin-top: 0.5rem;
    }

    /* CDK Drag styling */
    .card-drag-item {
      position: relative;
    }

    .drag-handle {
      position: absolute;
      left: -20px;
      top: 50%;
      transform: translateY(-50%);
      cursor: grab;
      opacity: 0;
      transition: opacity 0.15s ease;
      padding: 4px;
    }

    .card-drag-item:hover .drag-handle {
      opacity: 1;
    }

    .cdk-drag-preview {
      box-shadow: 0 5px 25px rgba(0, 0, 0, 0.3);
      border-radius: 8px;
      opacity: 0.9;
    }

    .cdk-drag-placeholder {
      opacity: 0.3;
    }

    .cdk-drag-animating {
      transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
    }

    /* PrimeNG overrides for dark theme */
    :host ::ng-deep {
      .p-inputtext, .p-inputnumber-input {
        background: hsl(var(--background)) !important;
        border-color: hsl(var(--border)) !important;
        color: hsl(var(--foreground)) !important;
        font-size: 0.875rem;
        padding: 0.375rem 0.5rem;
      }
      
      .p-inputnumber-button {
          background: hsl(var(--muted)) !important;
          border-color: hsl(var(--border)) !important;
          color: hsl(var(--foreground)) !important;
      }

      .p-slider {
        background: hsl(var(--muted));
        height: 0.5rem;
        border-radius: 9999px;

        .p-slider-range {
          border-radius: 9999px;
        }

        .p-slider-range {
          border-radius: 9999px;
          background: var(--progress-color, #3b82f6) !important;
          transition: background 0.2s ease;
        }

        .p-slider-handle {
          width: 0.7rem;
          height: 0.7rem;
          background: var(--progress-color, #3b82f6) !important;
          border: 1px solid rgba(255, 255, 255, 0.8) !important;
          top: 50% !important;
          margin-top: -0.35rem !important; /* Half of height */
          transition: transform 0.1s ease, background 0.2s ease;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        
        .p-slider-handle:hover {
            transform: scale(1.3);
            background: var(--progress-color, #3b82f6) !important;
            border-color: #ffffff !important;
        }
      }

      .p-knob svg {
        .p-knob-range {
          stroke: #374151;
        }
        .p-knob-value {
          stroke: #a855f7;
        }
        text {
          fill: hsl(var(--foreground));
          font-size: 1rem;
          font-weight: 600;
        }
      }
    }

    .stat-knob {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
  `,
})
export class FactSheetContainerComponent implements OnInit {
  private factSheetService = inject(FactSheetService);
  private graphFactSheets = inject(EntityGraphFactSheetService);
  private relationshipLoadSeq = 0;

  entity = input<ParsedEntity | null>(null);
  contextId = input<string>('global'); // Default to global context

  private cards = computed(() => {
    const ent = this.entity();
    if (!ent) return [];
    return this.factSheetService.getCardsSync(ent.kind);
  });

  orderedCards = signal<CardWithFields[]>([]);
  attributes = signal<Record<string, any>>({});
  relationshipView = signal<EntityGraphFactSheetView>(emptyRelationshipView('', 'global'));

  editingField = signal<string | null>(null);

  numberModels = signal<Record<string, number>>({});
  arrayModels = signal<Record<string, string[]>>({});
  progressModels = signal<Record<string, number>>({});
  statModels = signal<Record<string, number>>({});

  constructor() {
    effect(() => {
      const c = this.cards();
      this.orderedCards.set([...c]);
    });

    effect(() => {
      const ent = this.entity();
      const ctx = this.contextId(); // React to context changes
      const requestId = ++this.relationshipLoadSeq;

      if (ent) {
        this.relationshipView.set(emptyRelationshipView(ent.id, ctx));
        // Always load generic attributes first, then context specific?
        // Service handles merging now.
        // We force load to ensure we get the merged view for this context.
        this.factSheetService.loadAttributes(ent.id, ctx).then((attrs) => {
          if (requestId !== this.relationshipLoadSeq) return;
          this.loadAttributesIntoModels(attrs);
          void this.loadRelationshipView(ent, ctx, attrs, requestId);
        });
      } else {
        this.attributes.set({});
        this.relationshipView.set(emptyRelationshipView('', ctx));
        this.resetModels();
      }
    });
  }

  ngOnInit() {
    // Initial load handled by effect
  }

  private loadAttributesIntoModels(attrs: Record<string, any>) {
    this.attributes.set(attrs);

    const nums: Record<string, number> = {};
    const arrs: Record<string, string[]> = {};
    const progs: Record<string, number> = {};
    const stats: Record<string, number> = {};

    for (const [key, val] of Object.entries(attrs)) {
      if (typeof val === 'number') {
        nums[key] = val;
        if (key.endsWith('Current')) {
          const baseName = key.replace('Current', '');
          progs[baseName] = val;
        }
      } else if (Array.isArray(val)) {
        arrs[key] = val;
      }
    }

    if (attrs['stats'] && typeof attrs['stats'] === 'object') {
      for (const [statName, statVal] of Object.entries(attrs['stats'] as Record<string, any>)) {
        if (typeof statVal === 'number') {
          stats[statName] = statVal;
        }
      }
    }

    this.numberModels.set(nums);
    this.arrayModels.set(arrs);
    this.progressModels.set(progs);
    this.statModels.set(stats);
  }

  private resetModels() {
    this.numberModels.set({});
    this.arrayModels.set({});
    this.progressModels.set({});
    this.statModels.set({});
  }

  private async loadRelationshipView(
    entity: ParsedEntity,
    contextId: string,
    attrs: Record<string, any>,
    requestId: number,
  ): Promise<void> {
    const view = await this.graphFactSheets.loadView(entity, contextId, attrs).catch((error) => {
      console.warn('[FactSheet] Graph relationship view failed:', error);
      return emptyRelationshipView(entity.id, contextId);
    });
    if (requestId === this.relationshipLoadSeq) this.relationshipView.set(view);
  }

  getValue(fieldName: string): any {
    return this.attributes()[fieldName];
  }

  getArrayValue(fieldName: string): any[] {
    const val = this.getValue(fieldName);
    return Array.isArray(val) ? val : [];
  }

  getRelationshipRows(): EntityGraphFactSheetRelationRow[] {
    return this.relationshipView().relationships.slice(0, 12);
  }

  relationshipTargetText(row: EntityGraphFactSheetRelationRow): string {
    const prefix = row.direction === 'incoming' ? 'from ' : row.direction === 'outgoing' ? 'to ' : '';
    return `${prefix}${row.targetLabel}`;
  }

  relationSourceLabel(source: EntityGraphFactSheetRelationRow['source']): string {
    switch (source) {
      case 'registry': return 'truth';
      case 'compilerFact': return 'fact';
      case 'compilerBundle': return 'bundle';
      case 'factSheetCuration': return 'staged';
    }
  }

  formatConfidence(value: number): string {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  }

  parseStats(statsJson: string | undefined): Array<{ name: string; abbr: string; label: string }> {
    if (!statsJson) return [];
    try {
      return JSON.parse(statsJson);
    } catch {
      return [];
    }
  }

  parseOptions(optionsJson: string | undefined): string[] {
    if (!optionsJson) return [];
    try {
      return JSON.parse(optionsJson);
    } catch {
      return [];
    }
  }

  getProgressColor(field: FactSheetFieldSchema): string {
    const current = this.getValue(field.currentField!) ?? 0;
    const max = this.getCalculatedMax(field);

    if (max === 0) return 'hsl(0, 80%, 60%)';

    // Map field names to Umbra Presets for custom themes
    let presetId = '';
    const name = field.fieldName.toLowerCase();

    if (name === 'health') presetId = 'vitals';
    else if (name === 'mana') presetId = 'magic';
    else if (name === 'stamina') presetId = 'nature';
    else if (name === 'xp') presetId = 'gold';

    const preset = UMBRA_PRESETS.find(p => p.id === presetId);
    if (preset) {
      return getUmbraColor(current, max, preset.colorLow, preset.colorMid, preset.colorHigh);
    }

    // Default fallback (Red-Yellow-Green HSL)
    const percentage = Math.min(100, Math.max(0, (current / max) * 100));
    const hue = (percentage / 100) * 120;
    return `hsl(${hue}, 80%, 50%)`;
  }

  getCalculatedMax(field: FactSheetFieldSchema): number {
    const baseMax = this.getValue(field.maxField!) ?? 100;
    const name = field.fieldName.toLowerCase();

    // Only scale core vitals. XP is now included as requested.
    if (['health', 'mana', 'stamina', 'xp'].includes(name)) {
      const level = this.getValue('level') ?? 1;
      return calculateScaledStat(baseMax, level);
    }

    return baseMax;
  }

  fieldNameTitle(fieldName: string): string {
    return fieldName.replace('Current', '');
  }

  usesDirectFieldLabel(field: FactSheetFieldSchema): boolean {
    return field.fieldType === 'number'
      || field.fieldType === 'dropdown'
      || field.fieldType === 'array';
  }

  getFieldLabelId(cardId: string, fieldName: string): string {
    return `${this.getFieldBaseId(cardId, fieldName)}-label`;
  }

  getFieldControlId(cardId: string, fieldName: string, part: string = 'input'): string {
    return `${this.getFieldBaseId(cardId, fieldName)}-${this.sanitizeControlSegment(part)}`;
  }

  getFieldControlName(cardId: string, fieldName: string, part: string = 'input'): string {
    return `${this.getFieldBaseId(cardId, fieldName)}-${this.sanitizeControlSegment(part)}`;
  }

  getStatLabelId(cardId: string, fieldName: string, statName: string): string {
    return `${this.getFieldBaseId(cardId, fieldName)}-${this.sanitizeControlSegment(statName)}-label`;
  }

  // =========================================================================
  // Editing handlers
  // =========================================================================

  isLongTextField(fieldName: string): boolean {
    const longFields = ['background', 'notes', 'publicNotes', 'privateNotes', 'goals', 'fears', 'personality'];
    return longFields.includes(fieldName);
  }

  startEditing(fieldName: string) {
    this.editingField.set(fieldName);
  }

  stopEditing() {
    this.editingField.set(null);
  }

  async onTextChange(fieldName: string, value: string) {
    const entity = this.entity();
    if (!entity) return;

    this.attributes.update(a => ({ ...a, [fieldName]: value }));
    await this.factSheetService.setAttribute(entity.id, fieldName, value, this.contextId());

    // Sync fullName to registry as an alias (so entity detection picks it up)
    if (fieldName === 'fullName' && value.trim()) {
      this.syncAliasesToRegistry(entity.id);
    }
  }

  async onNumberChange(fieldName: string, value: number) {
    const entity = this.entity();
    if (!entity || value === null) return;

    this.numberModels.update(m => ({ ...m, [fieldName]: value }));
    this.attributes.update(a => ({ ...a, [fieldName]: value }));
    await this.factSheetService.setAttribute(entity.id, fieldName, value, this.contextId());
  }

  async onDropdownChange(fieldName: string, value: string) {
    const entity = this.entity();
    if (!entity) return;

    this.attributes.update(a => ({ ...a, [fieldName]: value }));
    await this.factSheetService.setAttribute(entity.id, fieldName, value, this.contextId());
  }

  async addArrayItem(fieldName: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim();
    if (!value) return;

    const entity = this.entity();
    if (!entity) return;

    const currentArray = this.getArrayValue(fieldName);
    const newArray = [...currentArray, value];

    this.arrayModels.update(m => ({ ...m, [fieldName]: newArray }));
    this.attributes.update(a => ({ ...a, [fieldName]: newArray }));
    await this.factSheetService.setAttribute(entity.id, fieldName, newArray, this.contextId());

    input.value = ''; // Clear input

    // Sync aliases to registry for entity detection
    if (fieldName === 'aliases') {
      this.syncAliasesToRegistry(entity.id);
    }
  }

  async removeArrayItem(fieldName: string, index: number) {
    const entity = this.entity();
    if (!entity) return;

    const currentArray = this.getArrayValue(fieldName);
    const newArray = currentArray.filter((_, i) => i !== index);

    this.arrayModels.update(m => ({ ...m, [fieldName]: newArray }));
    this.attributes.update(a => ({ ...a, [fieldName]: newArray }));
    await this.factSheetService.setAttribute(entity.id, fieldName, newArray, this.contextId());

    // Sync aliases to registry for entity detection
    if (fieldName === 'aliases') {
      this.syncAliasesToRegistry(entity.id);
    }
  }

  /**
   * Sync aliases + fullName to registry so entity detection picks them up.
   * Combines the 'aliases' array with 'fullName' (if set) into the registry's alias list.
   */
  private syncAliasesToRegistry(entityId: string) {
    const attrs = this.attributes();
    const aliases: string[] = attrs['aliases'] || [];
    const fullName = attrs['fullName'] as string || '';

    // Combine: fullName (if non-empty) + all manual aliases
    const allAliases: string[] = [];
    if (fullName.trim()) {
      allAliases.push(fullName.trim());
    }
    allAliases.push(...aliases.filter(a => a.trim()));

    void smartGraphRegistry.updateEntityDurable(entityId, { aliases: allAliases })
      .then(() => {
        console.log(`[FactSheet] Synced aliases to registry: ${allAliases.join(', ')}`);
      })
      .catch(err => {
        console.warn('[FactSheet] Failed to sync aliases to registry:', err);
      });
  }

  async onProgressChange(field: FactSheetFieldSchema, value: number) {
    const entity = this.entity();
    if (!entity || !field.currentField) return;

    const fieldName = field.fieldName;
    this.progressModels.update(m => ({ ...m, [fieldName]: value }));
    this.attributes.update(a => ({ ...a, [field.currentField!]: value }));
    await this.factSheetService.setAttribute(entity.id, field.currentField!, value, this.contextId());
  }

  async onStatChange(statName: string, value: number) {
    const entity = this.entity();
    if (!entity) return;

    this.statModels.update(m => ({ ...m, [statName]: value }));

    const currentStats = this.attributes()['stats'] || {};
    const newStats = { ...currentStats, [statName]: value };
    this.attributes.update(a => ({ ...a, stats: newStats }));
    await this.factSheetService.setAttribute(entity.id, 'stats', newStats, this.contextId());
  }

  onDrop(event: CdkDragDrop<CardWithFields[]>) {
    const cards = [...this.orderedCards()];
    moveItemInArray(cards, event.previousIndex, event.currentIndex);
    this.orderedCards.set(cards);
  }

  private getFieldBaseId(cardId: string, fieldName: string): string {
    const ent = this.entity();
    return [
      'fact-sheet',
      this.sanitizeControlSegment(this.contextId()),
      this.sanitizeControlSegment(ent?.kind),
      this.sanitizeControlSegment(ent?.id),
      this.sanitizeControlSegment(cardId),
      this.sanitizeControlSegment(fieldName),
    ].join('-');
  }

  private sanitizeControlSegment(value: string | null | undefined): string {
    const sanitized = (value ?? 'field')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return sanitized || 'field';
  }
}

function emptyRelationshipView(entityId: string, scopeId: string): EntityGraphFactSheetView {
  return {
    entityId,
    scopeId,
    relationships: [],
    summary: {
      total: 0,
      committed: 0,
      promoted: 0,
      review: 0,
      staged: 0,
      network: 0,
      evidenceAnchors: 0,
    },
  };
}
