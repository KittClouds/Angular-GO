import { Component, ChangeDetectionStrategy, signal, inject, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgxTimelineComponent, NgxTimelineEntryComponent } from '@omnedia/ngx-timeline';
import { LucideAngularModule, Plus, Trash2, Link } from 'lucide-angular';
import { ScopeService } from '../../../lib/services/scope.service';
import { db } from '../../../lib/dexie/db';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { CalendarService } from '../../../services/calendar.service';
import { formatFantasyDate } from '../../../lib/fantasy-calendar/utils';
import {
  ScopedTimelineEventRecord,
  ScopedTimelineEventStoreService,
} from '../../../lib/services/scoped-timeline-event-store.service';

@Component({
  selector: 'app-timeline-view',
  standalone: true,
  imports: [CommonModule, FormsModule, NgxTimelineComponent, NgxTimelineEntryComponent, LucideAngularModule],
  template: `
    <div class="timeline-container p-4 h-full flex flex-col">
      <div class="mb-4 text-center">
        <h3 class="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-400">
          Narrative Timeline
        </h3>
        <p class="text-xs text-muted-foreground mt-1">{{ scopeLabel() }}</p>
      </div>

      <button
        (click)="toggleAddForm()"
        class="w-full mb-4 py-2 px-3 rounded-lg border border-dashed border-teal-500/30 text-teal-400 text-sm
               hover:bg-teal-500/10 transition-colors flex items-center justify-center gap-2">
        <lucide-icon [img]="PlusIcon" class="w-4 h-4"></lucide-icon>
        Add Event
      </button>

      <div *ngIf="isAddingEvent()" class="mb-4 p-3 bg-muted/20 rounded-lg border border-teal-500/20">
        <input
          [(ngModel)]="newEventTitle"
          placeholder="Event title..."
          class="w-full mb-2 px-3 py-2 bg-background/50 border border-border rounded text-sm text-foreground"
          (keydown.enter)="createEvent()"
        />
        <textarea
          [(ngModel)]="newEventDescription"
          placeholder="What happens? (optional)"
          rows="2"
          class="w-full mb-2 px-3 py-2 bg-background/50 border border-border rounded text-sm text-foreground resize-none"
        ></textarea>
        <div class="flex gap-2">
          <button
            (click)="createEvent()"
            [disabled]="!newEventTitle.trim()"
            class="flex-1 py-1.5 px-3 bg-teal-500 text-white text-sm rounded hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Add
          </button>
          <button
            (click)="cancelAdd()"
            class="py-1.5 px-3 bg-muted text-foreground text-sm rounded hover:bg-muted/80">
            Cancel
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto" *ngIf="events().length > 0">
        <om-timeline
          [orientation]="'left'"
          [entriesGap]="'1.5rem'"
          [entryGap]="'0.5rem'"
          [titleGap]="'0.5rem'"
          [titleMaxWidth]="'100%'"
          [pathWidth]="'2px'"
          [pathColor]="'rgba(255,255,255,0.1)'"
          [gradientColors]="['#2dd4bf', '#06b6d4']"
        >
          <om-timeline-entry *ngFor="let event of events(); trackBy: trackEvent">
            <ng-template #timelineTitle>
              <div class="flex items-center justify-between w-full group">
                <span class="text-sm font-bold text-teal-300">{{ event.title }}</span>
                <div class="flex items-center gap-1">
                  <span *ngIf="getEventDisplayTime(event) as displayTime" class="text-[10px] text-muted-foreground font-mono">{{ displayTime }}</span>
                  <button
                    (click)="deleteEvent(event.id)"
                    class="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-opacity">
                    <lucide-icon [img]="TrashIcon" class="w-3 h-3 text-red-400"></lucide-icon>
                  </button>
                </div>
              </div>
            </ng-template>
            <ng-template #timelineContent>
              <div class="bg-muted/20 p-3 rounded border border-white/5 text-sm text-muted-foreground">
                <p *ngIf="event.description" class="mb-2 italic">"{{ event.description }}"</p>
                <p *ngIf="!event.description" class="mb-2 text-muted-foreground/50 text-xs">No description</p>

                <div class="flex flex-wrap gap-1.5" *ngIf="event.entityIds.length > 0">
                  <span
                    *ngFor="let entityId of event.entityIds"
                    class="text-[10px] bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded cursor-pointer hover:bg-teal-500/20"
                    (click)="openEntity(entityId)">
                    {{ getEntityLabel(entityId) }}
                  </span>
                </div>

                <button
                  *ngIf="event.linkedNoteId"
                  (click)="openNote(event.linkedNoteId)"
                  class="mt-2 text-[10px] text-teal-400 hover:underline flex items-center gap-1">
                  <lucide-icon [img]="LinkIcon" class="w-3 h-3"></lucide-icon>
                  Open linked note
                </button>
              </div>
            </ng-template>
          </om-timeline-entry>
        </om-timeline>
      </div>

      <div *ngIf="events().length === 0 && !isAddingEvent()" class="flex-1 flex flex-col items-center justify-center text-center">
        <div class="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p class="text-sm text-muted-foreground mb-1">No events yet</p>
        <p class="text-xs text-muted-foreground/60">Click "Add Event" to start building your timeline</p>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      overflow: hidden;
    }

    ::ng-deep om-timeline {
      width: 100%;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TimelineViewComponent {
  private scopeService = inject(ScopeService);
  private timelineEventsStore = inject(ScopedTimelineEventStoreService);
  private noteEditorStore = inject(NoteEditorStore);
  private calendarService = inject(CalendarService);

  PlusIcon = Plus;
  TrashIcon = Trash2;
  LinkIcon = Link;

  readonly events = this.timelineEventsStore.events;
  isAddingEvent = signal(false);
  newEventTitle = '';
  newEventDescription = '';
  private entityCache = new Map<string, string>();

  scopeLabel = computed(() => {
    const scope = this.scopeService.resolvedScope();
    if (scope.scopeFolderId === 'vault:global') return 'All narratives';
    return `Scope: ${scope.scopeType}`;
  });

  constructor() {
    effect(() => {
      const events = this.events();
      void this.cacheEntityLabels(events);
    });
  }

  private async cacheEntityLabels(events: ScopedTimelineEventRecord[]) {
    const allIds = new Set<string>();
    events.forEach(e => e.entityIds.forEach(id => allIds.add(id)));

    for (const id of allIds) {
      if (!this.entityCache.has(id)) {
        const entity = await db.entities.get(id);
        this.entityCache.set(id, entity?.label || id);
      }
    }
  }

  getEntityLabel(entityId: string): string {
    return this.entityCache.get(entityId) || entityId.slice(0, 8);
  }

  toggleAddForm() {
    this.isAddingEvent.set(!this.isAddingEvent());
    if (!this.isAddingEvent()) {
      this.resetForm();
    }
  }

  cancelAdd() {
    this.isAddingEvent.set(false);
    this.resetForm();
  }

  private resetForm() {
    this.newEventTitle = '';
    this.newEventDescription = '';
  }

  async createEvent() {
    if (!this.newEventTitle.trim()) return;

    const scope = this.scopeService.resolvedScope();
    if (!scope.narrativeId || scope.scopeFolderId === 'vault:global') {
      console.warn('Cannot create event: No active narrative scope');
      return;
    }

    await this.timelineEventsStore.createEvent({
      title: this.newEventTitle.trim(),
      description: this.newEventDescription.trim() || undefined,
      entityIds: [],
      source: 'timeline',
    });

    this.isAddingEvent.set(false);
    this.resetForm();
  }

  async deleteEvent(id: string) {
    await this.timelineEventsStore.deleteEvent(id);
  }

  openEntity(entityId: string) {
    console.log('[Timeline] Open entity:', entityId);
  }

  openNote(noteId: string) {
    this.noteEditorStore.openNote(noteId);
  }

  getEventDisplayTime(event: ScopedTimelineEventRecord): string | undefined {
    if (event.calendarDate) {
      return formatFantasyDate(this.calendarService.calendar(), event.calendarDate);
    }

    return event.displayTime;
  }

  trackEvent(_index: number, event: ScopedTimelineEventRecord): string {
    return event.id;
  }

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent) {
    if (event.dataTransfer?.types.includes('application/x-shuga-note-id')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  @HostListener('drop', ['$event'])
  async onDrop(event: DragEvent) {
    const noteId = event.dataTransfer?.getData('application/x-shuga-note-id');
    const noteTitle = event.dataTransfer?.getData('text/plain');

    if (noteId && noteTitle) {
      event.preventDefault();
      await this.createEventFromNote(noteId, noteTitle);
    }
  }

  private async createEventFromNote(noteId: string, noteTitle: string) {
    const scope = this.scopeService.resolvedScope();
    if (!scope.narrativeId || scope.scopeFolderId === 'vault:global') {
      console.warn('[Timeline] Cannot create linked event: No active narrative scope');
      return;
    }

    await this.timelineEventsStore.createEvent({
      title: `Event: ${noteTitle}`,
      description: `Linked to ${noteTitle}`,
      entityIds: [],
      linkedNoteId: noteId,
      linkedNoteTitle: noteTitle,
      source: 'timeline',
    });
  }
}
