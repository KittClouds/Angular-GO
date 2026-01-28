import { Component, EventEmitter, Output, computed, signal, model, inject, effect } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronDown, lucideChevronUp, lucidePlus, lucideCalendar,
  lucideTag, lucidePalette, lucideClock, lucideX, lucideFolder, lucideFolderPlus
} from '@ng-icons/lucide';
import { CalendarService } from '../../../services/calendar.service';
import { FolderService } from '../../../lib/services/folder.service';
import { AllowedSubfolderDef, Folder } from '../../../lib/dexie/db';
import { CalendarEvent, EventImportance, EventCategory } from '../../../lib/fantasy-calendar/types';
import { getEventTypesForScale, getEventTypeById, DEFAULT_EVENT_TYPE_ID, EventTypeDefinition } from '../../../lib/fantasy-calendar/event-type-registry';

const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899',
];

interface PendingEvent extends Omit<CalendarEvent, 'id' | 'calendarId'> {
  tempId: string;
}

type CreationMode = 'event' | 'entity';

@Component({
  selector: 'app-event-creator',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [provideIcons({
    lucideChevronDown, lucideChevronUp, lucidePlus, lucideCalendar,
    lucideTag, lucidePalette, lucideClock, lucideX, lucideFolder, lucideFolderPlus
  })],
  template: `
    <div class="space-y-3">
      <!-- Quick Add Row -->
      <div class="flex gap-2">
        <input
          type="text"
          [placeholder]="mode() === 'event' ? 'What happened?' : 'Folder Name (e.g. Act 1)'"
          [(ngModel)]="title"
          (keydown.enter)="!isExpanded() && handleAdd()"
          class="flex-1 h-9 px-3 rounded-md border text-sm bg-background w-full focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          class="btn-icon h-9 w-9 border"
          (click)="toggleExpanded()"
        >
          <ng-icon [name]="isExpanded() ? 'lucideChevronUp' : 'lucideChevronDown'" class="w-4 h-4"></ng-icon>
        </button>
      </div>

      <!-- Expandable Details -->
      <div *ngIf="isExpanded()" class="space-y-4 pt-2 border-t mt-2">
        
        <!-- Mode Switcher -->
        <div class="flex gap-2 p-1 bg-muted/30 rounded-lg">
            <button 
                class="flex-1 text-xs py-1.5 rounded-md font-medium transition-colors flex items-center justify-center gap-2"
                [class]="mode() === 'event' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/50'"
                (click)="setMode('event')"
            >
                <ng-icon name="lucideCalendar" class="w-3 h-3"></ng-icon> Event
            </button>
            <button 
                class="flex-1 text-xs py-1.5 rounded-md font-medium transition-colors flex items-center justify-center gap-2"
                [class]="mode() === 'entity' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/50'"
                (click)="setMode('entity')"
                [disabled]="!hasNarrative()"
                [title]="!hasNarrative() ? 'Create a Narrative Folder in Sidebar first' : 'Create Entity Folder'"
            >
                <ng-icon name="lucideFolderPlus" class="w-3 h-3"></ng-icon> Structure
            </button>
        </div>

        <!-- EVENT MODE: Type Picker -->
        <div class="space-y-2" *ngIf="mode() === 'event'">
          <label class="text-xs text-muted-foreground font-medium">Event Type</label>
          <div class="h-20 overflow-y-auto border rounded p-2 bg-muted/10">
            <div class="flex flex-wrap gap-1">
              <button
                *ngFor="let type of eventTypes()"
                (click)="handleSelectType(type)"
                class="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all border-l-2"
                [class.bg-primary]="selectedTypeId() === type.id"
                [class.text-primary-foreground]="selectedTypeId() === type.id"
                [class.bg-muted-50]="selectedTypeId() !== type.id"
                [style.border-left-color]="type.color"
              >
                {{ type.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- ENTITY MODE: Folder Type Picker -->
        <div class="space-y-2" *ngIf="mode() === 'entity'">
            <label class="text-xs text-muted-foreground font-medium">Folder Type</label>
            <div class="h-20 overflow-y-auto border rounded p-2 bg-muted/10">
                <div class="flex flex-wrap gap-1" *ngIf="allowedSubfolders().length > 0; else noTypes">
                    <button
                        *ngFor="let type of allowedSubfolders()"
                        (click)="handleSelectFolderType(type)"
                        class="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all border border-border hover:border-primary/50"
                        [class.bg-primary]="selectedFolderKind() === type.entityKind"
                        [class.text-primary-foreground]="selectedFolderKind() === type.entityKind"
                        [class.bg-background]="selectedFolderKind() !== type.entityKind"
                    >
                        {{ type.label }}
                    </button>
                </div>
                <ng-template #noTypes>
                    <div class="text-xs text-muted-foreground italic p-2">
                        No structural folders available. Check Narrative schema.
                    </div>
                </ng-template>
            </div>
        </div>

        <!-- Date Row -->
        <div class="flex gap-2">
          <div class="flex-1">
            <label class="text-xs text-muted-foreground font-medium">Day</label>
            <select [(ngModel)]="day" class="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm">
              <option *ngFor="let d of dayOptions()" [value]="d">{{ d }}</option>
            </select>
          </div>
          <div class="flex-[2]">
            <label class="text-xs text-muted-foreground font-medium">Month & Year</label>
            <div class="h-9 px-2 bg-muted/50 rounded-md flex items-center text-sm text-muted-foreground border">
              {{ currentMonth().name }}, {{ viewYearFormatted() }}
            </div>
          </div>
        </div>

        <!-- Description -->
        <div *ngIf="mode() === 'event'">
          <label class="text-xs text-muted-foreground font-medium">Description</label>
           <textarea
            [(ngModel)]="description"
            rows="2"
            class="flex min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Details..."
          ></textarea>
        </div>

        <!-- Color & Importance (Event Only) -->
        <div class="flex gap-4" *ngIf="mode() === 'event'">
          <div class="flex-1">
            <label class="text-xs text-muted-foreground font-medium">Color</label>
            <div class="flex gap-1 mt-1 flex-wrap">
              <button
                *ngFor="let c of colorPresets"
                (click)="color.set(color() === c ? undefined : c)"
                class="w-5 h-5 rounded-full transition-all border border-border"
                [class.ring-2]="color() === c"
                [class.ring-offset-1]="color() === c"
                [class.scale-110]="color() === c"
                [style.background-color]="c"
              ></button>
            </div>
          </div>
          <div class="flex-1">
            <label class="text-xs text-muted-foreground font-medium">Importance</label>
             <select [(ngModel)]="importance" class="flex h-7 w-full rounded-md border bg-background px-2 text-xs">
              <option value="trivial">Trivial</option>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <!-- Tags (simplified) - Event Only -->
        <div *ngIf="mode() === 'event'">
           <label class="text-xs text-muted-foreground font-medium">Tags</label>
           <div class="flex flex-wrap gap-1 mb-2">
            <span *ngFor="let tag of tags()" class="bg-secondary text-secondary-foreground text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1">
              {{ tag }}
              <button (click)="removeTag(tag)" class="hover:text-destructive"><ng-icon name="lucideX" class="w-3 h-3"></ng-icon></button>
            </span>
           </div>
           <div class="flex gap-1">
            <input 
              [(ngModel)]="newTag" 
              (keydown.enter)="addTag()"
              placeholder="Add tag..." 
              class="flex-1 h-7 text-xs px-2 border rounded"
            />
            <button class="btn-icon h-7 w-7 border" (click)="addTag()">
              <ng-icon name="lucidePlus" class="w-3 h-3"></ng-icon>
            </button>
           </div>
        </div>

      </div>

      <!-- Pending Events List (Event Mode Only) -->
      <div *ngIf="mode() === 'event' && pendingEvents().length > 0" class="space-y-1 bg-muted/30 p-2 rounded-md border text-xs">
        <label class="text-xs text-muted-foreground">Pending Events ({{ pendingEvents().length }})</label>
        <div *ngFor="let evt of pendingEvents()" class="flex justify-between items-center bg-background p-1.5 rounded border">
          <span class="truncate flex-1">{{ evt.title }}</span>
          <span class="text-muted-foreground ml-2">Day {{ evt.date.dayIndex + 1 }}</span>
          <button (click)="removePending(evt.tempId)" class="ml-2 text-destructive hover:text-destructive/80">
            <ng-icon name="lucideX" class="w-3 h-3"></ng-icon>
          </button>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex gap-2 text-sm">
        <button 
          *ngIf="isExpanded() && mode() === 'event'"
          class="flex-1 btn-secondary h-8 flex items-center justify-center gap-1"
          (click)="handleQueueEvent()"
          [disabled]="!title.trim()"
        >
          <ng-icon name="lucidePlus" class="w-3 h-3"></ng-icon> Queue
        </button>
        <button 
          class="flex-[2] btn-primary h-8 flex items-center justify-center gap-1"
          (click)="handleAdd()"
          [disabled]="canAdd()"
        >
          <ng-icon name="lucidePlus" class="w-3 h-3"></ng-icon>
          {{ getAddButtonLabel() }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .btn-icon { @apply flex items-center justify-center hover:bg-muted rounded transition-colors; }
    .btn-primary { @apply bg-primary text-primary-foreground hover:bg-primary/90 rounded font-medium transition-colors disabled:opacity-50; }
    .btn-secondary { @apply bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded font-medium transition-colors disabled:opacity-50; }
  `]
})
export class EventCreatorComponent {
  readonly calendarService = inject(CalendarService);
  readonly folderService = inject(FolderService);

  // State
  readonly isExpanded = signal(false);
  readonly mode = signal<CreationMode>('event');

  // Reactive Roots for Narrative Detection
  readonly roots = toSignal(this.folderService.getRootFolders$(), { initialValue: [] });
  readonly narrativeInfo = computed(() => {
    const n = this.roots().find(r => r.entityKind === 'NARRATIVE');
    return n ? { exists: true, id: n.id } : { exists: false, id: null };
  });

  readonly hasNarrative = computed(() => this.narrativeInfo().exists);
  readonly activeNarrativeId = computed(() => this.narrativeInfo().id);

  readonly allowedSubfolders = signal<AllowedSubfolderDef[]>([]);

  // Form inputs
  title = '';
  description = '';
  selectedTypeId = signal(DEFAULT_EVENT_TYPE_ID);
  selectedFolderKind = signal<string | null>(null);
  day = '1';
  color = signal<string | undefined>(undefined);
  importance = signal<EventImportance>('moderate');
  tags = signal<string[]>([]);
  newTag = '';
  pendingEvents = signal<PendingEvent[]>([]);

  // Calendar context
  readonly calendar = this.calendarService.calendar;
  readonly viewDate = this.calendarService.viewDate;
  readonly currentMonth = this.calendarService.currentMonth;
  readonly daysInCurrentMonth = this.calendarService.daysInCurrentMonth;
  readonly viewYearFormatted = this.calendarService.viewYearFormatted;

  readonly eventTypes = computed(() => getEventTypesForScale('month'));
  readonly dayOptions = computed(() =>
    Array.from({ length: this.daysInCurrentMonth() }, (_, i) => String(i + 1))
  );
  readonly colorPresets = COLOR_PRESETS;

  constructor() {
    // Auto-load schema when narrative becomes available
    effect(() => {
      if (this.hasNarrative()) {
        this.loadNarrativeSchema();
      }
    });
  }

  async loadNarrativeSchema() {
    const subfolders = await this.folderService.getAllowedSubfolders('NARRATIVE');
    this.allowedSubfolders.set(subfolders);
    if (subfolders.length > 0 && !this.selectedFolderKind()) {
      // Only set default if not already set or valid
      this.selectedFolderKind.set(subfolders[0].entityKind);
    }
  }

  toggleExpanded() {
    this.isExpanded.update(v => !v);
  }

  setMode(m: CreationMode) {
    this.mode.set(m);
  }

  handleSelectType(type: EventTypeDefinition) {
    this.selectedTypeId.set(type.id);
    this.importance.set(type.importance);
    if (!this.color()) {
      this.color.set(type.color);
    }
  }

  handleSelectFolderType(def: AllowedSubfolderDef) {
    this.selectedFolderKind.set(def.entityKind);
  }

  addTag() {
    if (this.newTag.trim() && !this.tags().includes(this.newTag.trim())) {
      this.tags.update(t => [...t, this.newTag.trim()]);
      this.newTag = '';
    }
  }

  removeTag(tag: string) {
    this.tags.update(t => t.filter(x => x !== tag));
  }

  // --- Logic for EVENTS ---

  createEventObject(): PendingEvent | null {
    if (!this.title.trim()) return null;

    const typeDef = getEventTypeById(this.selectedTypeId());

    return {
      tempId: Math.random().toString(36),
      title: this.title.trim(),
      description: this.description.trim() || undefined,
      date: {
        year: this.viewDate().year,
        monthIndex: this.viewDate().monthIndex,
        dayIndex: parseInt(this.day) - 1
      },
      importance: this.importance(),
      category: typeDef?.category || 'general',
      color: this.color() || typeDef?.color,
      eventTypeId: this.selectedTypeId() !== DEFAULT_EVENT_TYPE_ID ? this.selectedTypeId() : undefined,
      tags: this.tags().length > 0 ? this.tags() : undefined,
      status: 'todo'
    };
  }

  handleQueueEvent() {
    const evt = this.createEventObject();
    if (evt) {
      this.pendingEvents.update(p => [...p, evt]);
      // soft reset
      this.title = '';
      this.description = '';
    }
  }

  // --- Main Add Handler ---

  async handleAdd() {
    if (this.mode() === 'event') {
      await this.handleAddEvents();
    } else {
      await this.handleAddEntityFolder();
    }
  }

  async handleAddEvents() {
    const currentEvt = this.createEventObject();
    const all = [...this.pendingEvents()];

    if (currentEvt) all.push(currentEvt);
    if (all.length === 0) return;

    await Promise.all(all.map(evt => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tempId, ...data } = evt;
      return this.calendarService.addEvent(data);
    }));

    this.pendingEvents.set([]);
    this.resetForm();
    this.isExpanded.set(false);
  }

  async handleAddEntityFolder() {
    const name = this.title.trim();
    const kind = this.selectedFolderKind();
    const narrativeId = this.activeNarrativeId();

    if (!name || !kind || !narrativeId) return;

    const date = {
      year: this.viewDate().year,
      monthIndex: this.viewDate().monthIndex,
      dayIndex: parseInt(this.day) - 1
    };

    // We create it under the Narrative Root
    await this.folderService.createDatedTypedSubfolder(
      narrativeId,
      kind,
      name,
      date
    );

    this.resetForm();
    this.isExpanded.set(false);
  }


  removePending(tempId: string) {
    this.pendingEvents.update(p => p.filter(x => x.tempId !== tempId));
  }

  resetForm() {
    this.title = '';
    this.description = '';
    this.tags.set([]);
    this.color.set(undefined);
    this.selectedTypeId.set(DEFAULT_EVENT_TYPE_ID);
    // keep day
  }

  canAdd(): boolean {
    if (this.mode() === 'event') {
      return !this.title.trim() && this.pendingEvents().length === 0;
    } else {
      return !this.title.trim() || !this.selectedFolderKind();
    }
  }

  getAddButtonLabel() {
    if (this.mode() === 'entity') {
      return 'Create Folder';
    }

    const count = this.pendingEvents().length;
    if (count > 0) {
      return this.title.trim() ? `Add ${count + 1} Events` : `Add ${count} Pending Events`;
    }
    return this.isExpanded() ? 'Add Event' : `Add to ${this.currentMonth().name}`;
  }
}
