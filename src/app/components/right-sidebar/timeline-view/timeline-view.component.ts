import { Component, ChangeDetectionStrategy, signal, inject, computed, OnInit, OnDestroy, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgxTimelineComponent, NgxTimelineEntryComponent } from '@omnedia/ngx-timeline';
import { LucideAngularModule, Plus, Trash2, Edit3, Lock, Unlock, Link } from 'lucide-angular';
import { CodexService } from '../../../lib/services/codex.service';
import { ScopeService } from '../../../lib/services/scope.service';
import { db, CodexEntry, Entity } from '../../../lib/dexie/db';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-timeline-view',
  standalone: true,
  imports: [CommonModule, FormsModule, NgxTimelineComponent, NgxTimelineEntryComponent, LucideAngularModule],
  template: `
    <div class="timeline-container p-4 h-full flex flex-col">
      <!-- Header -->
      <div class="mb-4 text-center">
        <h3 class="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-400">
          Narrative Timeline
        </h3>
        <p class="text-xs text-muted-foreground mt-1">{{ scopeLabel() }}</p>
      </div>

      <!-- Add Event Button -->
      <button
        (click)="toggleAddForm()"
        class="w-full mb-4 py-2 px-3 rounded-lg border border-dashed border-teal-500/30 text-teal-400 text-sm
               hover:bg-teal-500/10 transition-colors flex items-center justify-center gap-2">
        <lucide-icon [img]="PlusIcon" class="w-4 h-4"></lucide-icon>
        Add Event
      </button>

      <!-- Inline Add Form -->
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

      <!-- Timeline -->
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
                  <span *ngIf="event.displayTime" class="text-[10px] text-muted-foreground font-mono">{{ event.displayTime }}</span>
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
                
                <!-- Entity Chips -->
                <div class="flex flex-wrap gap-1.5" *ngIf="event.entityIds.length > 0">
                  <span
                    *ngFor="let entityId of event.entityIds"
                    class="text-[10px] bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded cursor-pointer hover:bg-teal-500/20"
                    (click)="openEntity(entityId)">
                    {{ getEntityLabel(entityId) }}
                  </span>
                </div>

                <!-- Note Link -->
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

      <!-- Empty State -->
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
export class TimelineViewComponent implements OnInit, OnDestroy {
  private codexService = inject(CodexService);
  private scopeService = inject(ScopeService);

  // Icons
  PlusIcon = Plus;
  TrashIcon = Trash2;
  EditIcon = Edit3;
  LockIcon = Lock;
  UnlockIcon = Unlock;
  LinkIcon = Link;

  // State
  events = signal<CodexEntry[]>([]);
  isAddingEvent = signal(false);
  newEventTitle = '';
  newEventDescription = '';

  // Entity cache for display names
  private entityCache = new Map<string, string>();

  // Subscriptions
  private eventsSub?: Subscription;

  scopeLabel = computed(() => {
    const scope = this.scopeService.activeScope();
    if (scope.id === 'vault:global') return 'All narratives';
    if (scope.type === 'narrative') return 'Current narrative';
    return 'Scope: ' + scope.type;
  });

  constructor() {
    effect(() => {
      // Track scope changes
      const scope = this.scopeService.activeScope();
      this.loadEvents(scope);
    });
  }

  ngOnInit() {
    // Initial load handled by effect
  }

  ngOnDestroy() {
    this.eventsSub?.unsubscribe();
  }

  private loadEvents(scope: any) { // Type 'ActiveScope' but I don't want to import it if not already imported. Actually ScopeService is imported.
    this.eventsSub?.unsubscribe();
    const narrativeId = scope.narrativeId || (scope.id === 'vault:global' ? '' : scope.id);

    // If global or no narrative, we might want to handle it differently, 
    // but for now CodexService methods usually require narrativeId or return filtered list.
    // Let's assume activeNarrativeId is available via scope service or passed.

    if (!narrativeId && scope.id !== 'vault:global') {
      // Fallback for non-narrative scopes (folder/note) -> find narrative or show empty?
      // CodexService events are narrative-scoped.
      this.events.set([]);
      return;
    }

    if (scope.id === 'vault:global') {
      // TODO: CodexService.getAllEvents() or similar? 
      // For now, let's just create a simplified query if needed or require narrative focus.
      // Actually, let's try to get events for ALL narratives if global.
      // But CodexService.getEvents$ takes a narrativeId.
      // For now, we will just clear if no narrative.
      this.events.set([]);
    } else {
      this.eventsSub = this.codexService.getEvents$(narrativeId!).subscribe(events => {
        this.events.set(events);
        this.cacheEntityLabels(events);
      });
    }
  }

  private async cacheEntityLabels(events: CodexEntry[]) {
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

    const scope = this.scopeService.activeScope();
    const narrativeId = scope.narrativeId;

    if (!narrativeId) {
      // Cannot create event without narrative context
      console.warn('Cannot create event: No active narrative scope');
      return;
    }

    await this.codexService.createEvent(
      narrativeId,
      this.newEventTitle.trim(),
      this.newEventDescription.trim()
    );

    this.isAddingEvent.set(false);
    this.resetForm();
  }

  async deleteEvent(id: string) {
    await this.codexService.deleteEntry(id);
  }

  openEntity(entityId: string) {
    // TODO: Open entity in sidebar or navigate to entity note
    console.log('[Timeline] Open entity:', entityId);
  }

  openNote(noteId: string) {
    // TODO: Navigate to note
    console.log('[Timeline] Open note:', noteId);
  }

  trackEvent(index: number, event: CodexEntry): string {
    return event.id;
  }

  // Drag and Drop Handling
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
    const scope = this.scopeService.activeScope();
    const narrativeId = scope.narrativeId;

    if (!narrativeId) {
      console.warn('[Timeline] Cannot create linked event: No active narrative scope');
      return;
    }

    // Default to 'Unscheduled' (no displayTime) or ask user
    // For now, we creates a basic event linked to the note
    await this.codexService.createEvent(
      narrativeId,
      `Event: ${noteTitle}`,
      `Linked to ${noteTitle}`,
      [], // entityIds
      undefined, // displayTime
      noteId // linkedNoteId
    );
  }
}
