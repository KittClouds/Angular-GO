import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideSearch, lucideCalendar, lucideCalendarDays, lucideCalendarRange,
  lucideLayers, lucideCircle, lucideClock, lucideCheckCircle2, lucidePlus,
  lucideFilter, lucideGitBranch, lucideZap, lucideEye
} from '@ng-icons/lucide';
import { CalendarService, EditorScope } from '../../../services/calendar.service';
import { CalendarEvent } from '../../../lib/fantasy-calendar/types';
import { getEventTypeById } from '../../../lib/fantasy-calendar/event-type-registry';
import { EventEditDialogComponent } from '../event-edit-dialog/event-edit-dialog.component';

const SCOPE_CONFIG: Record<EditorScope, { icon: string; label: string; description: string }> = {
  day: { icon: 'lucideCalendar', label: 'Day', description: 'Events for selected day' },
  week: { icon: 'lucideCalendarDays', label: 'Week', description: 'Events for current week' },
  month: { icon: 'lucideCalendarRange', label: 'Month', description: 'All events this month' },
  period: { icon: 'lucideLayers', label: 'Period', description: 'Events in selected period' },
};

const STATUS_CONFIG = {
  'todo': { label: 'To Do', icon: 'lucideCircle', color: 'var(--chart-2, #facc15)' },
  'in-progress': { label: 'In Progress', icon: 'lucideClock', color: 'var(--chart-3, #f97316)' },
  'completed': { label: 'Completed', icon: 'lucideCheckCircle2', color: 'var(--chart-1, #22c55e)' },
} as const;

type StatusKey = keyof typeof STATUS_CONFIG;

@Component({
  selector: 'app-narrative-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIcon, EventEditDialogComponent],
  providers: [provideIcons({
    lucideSearch, lucideCalendar, lucideCalendarDays, lucideCalendarRange,
    lucideLayers, lucideCircle, lucideClock, lucideCheckCircle2, lucidePlus,
    lucideFilter, lucideGitBranch, lucideZap, lucideEye
  })],
  template: `
    <div class="bg-gradient-to-b from-background to-card border-t">
      <!-- Header -->
      <div class="p-4 border-b">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-xl font-semibold flex items-center gap-2">
              <ng-icon name="lucideCalendar" class="w-5 h-5 text-primary"></ng-icon>
              Narrative Event Editor
            </h2>
            <p class="text-sm text-muted-foreground">{{ scopeLabel() }}</p>
          </div>

          <!-- Scope Selector -->
          <div class="flex items-center gap-2">
            <button 
              *ngFor="let scope of scopes"
              (click)="setScope(scope)"
              class="px-3 py-1.5 text-sm rounded-md flex items-center gap-1 transition-colors"
              [class.bg-primary]="editorScope() === scope"
              [class.text-primary-foreground]="editorScope() === scope"
              [class.bg-muted]="editorScope() !== scope"
              [class.hover:bg-muted/80]="editorScope() !== scope"
            >
              <ng-icon [name]="getScopeIcon(scope)" class="w-4 h-4"></ng-icon>
              {{ getScopeLabel(scope) }}
            </button>
          </div>
        </div>

        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex-1 relative min-w-[200px]">
            <ng-icon name="lucideSearch" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"></ng-icon>
            <input 
              type="text"
              [(ngModel)]="searchQuery"
              placeholder="Search events..."
              class="w-full h-9 pl-9 pr-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div class="flex items-center gap-2">
            <input type="checkbox" [(ngModel)]="showCompleted" id="show-completed" class="rounded" />
            <label for="show-completed" class="text-sm">Show Completed</label>
          </div>
        </div>
      </div>

      <!-- Analytics Panel -->
      <div *ngIf="filteredEvents().length > 0" class="px-4 py-3 border-b bg-muted/5">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="flex flex-col items-center p-3 rounded-lg bg-card border">
            <span class="text-2xl font-bold text-primary">{{ stats().total }}</span>
            <span class="text-xs text-muted-foreground">Total Events</span>
          </div>
          <div class="flex flex-col items-center p-3 rounded-lg bg-card border">
            <span class="text-2xl font-bold text-emerald-500">{{ stats().completionPct }}%</span>
            <span class="text-xs text-muted-foreground">Completed</span>
            <div class="w-full h-1 mt-1 rounded-full bg-muted overflow-hidden">
              <div class="h-full bg-emerald-500 transition-all" [style.width.%]="stats().completionPct"></div>
            </div>
          </div>
          <div class="flex flex-col items-center p-3 rounded-lg bg-card border">
            <span class="text-2xl font-bold" [class.text-red-500]="stats().avgTension > 70" [class.text-amber-500]="stats().avgTension > 40 && stats().avgTension <= 70" [class.text-blue-500]="stats().avgTension <= 40">
              {{ stats().avgTension }}
            </span>
            <span class="text-xs text-muted-foreground">Avg Tension</span>
          </div>
          <div class="flex flex-col items-center p-3 rounded-lg bg-card border">
            <span class="text-2xl font-bold text-violet-500">{{ stats().withCausality }}</span>
            <span class="text-xs text-muted-foreground">Causal Links</span>
          </div>
        </div>
      </div>

      <!-- Kanban Board -->
      <div class="flex gap-4 p-4 overflow-x-auto">
        <div 
          *ngFor="let col of statusKeys"
          class="flex-1 min-w-[300px] bg-card border border-border rounded-xl shadow-sm border-t-4"
          [style.border-top-color]="getStatusColor(col)"
        >
          <!-- Column Header -->
          <div class="p-4 pb-2">
            <div class="text-base font-medium flex items-center justify-between">
              <span class="flex items-center gap-2">
                <ng-icon [name]="getStatusIcon(col)" class="w-4 h-4" [style.color]="getStatusColor(col)"></ng-icon>
                {{ getStatusLabel(col) }}
              </span>
              <span class="bg-secondary text-secondary-foreground text-xs px-1.5 py-0.5 rounded">
                {{ getColumnEvents(col).length }}
              </span>
            </div>
          </div>

          <!-- Events -->
          <div class="p-2">
            <div class="h-[350px] overflow-y-auto space-y-2 p-2">
              <div 
                *ngFor="let event of getColumnEvents(col)"
                class="p-3 rounded-lg bg-background border cursor-pointer transition-all hover:shadow-md hover:border-primary/30 mb-2"
                [class.opacity-60]="event.status === 'completed'"
                [style.border-left-width.px]="3"
                [style.border-left-color]="getEventBorderColor(event)"
                (click)="selectEvent(event)"
              >
                <div class="flex items-start justify-between gap-2 mb-2">
                  <h4 
                    class="text-sm font-medium truncate flex-1"
                    [class.line-through]="event.status === 'completed'"
                    [class.text-muted-foreground]="event.status === 'completed'"
                  >
                    {{ event.title }}
                  </h4>
                  <button 
                    (click)="toggleStatus($event, event.id)"
                    class="shrink-0 p-1 hover:bg-muted rounded transition-colors"
                  >
                    <ng-icon 
                      [name]="getEventStatusIcon(event)" 
                      class="w-4 h-4"
                      [class.text-emerald-500]="event.status === 'completed'"
                      [class.text-amber-500]="event.status === 'in-progress'"
                      [class.text-muted-foreground]="event.status === 'todo' || !event.status"
                    ></ng-icon>
                  </button>
                </div>
                <p *ngIf="event.description" class="text-xs text-muted-foreground line-clamp-2">{{ event.description }}</p>
              </div>

              <div *ngIf="getColumnEvents(col).length === 0" class="text-center text-muted-foreground text-xs py-4">
                No events
              </div>
            </div>

            <!-- Quick Add -->
            <div class="p-2 border-t mt-2">
              <div *ngIf="quickAddColumn === col" class="flex gap-2">
                <input 
                  type="text"
                  [(ngModel)]="quickAddTitle"
                  placeholder="Event title..."
                  class="flex-1 h-8 px-2 text-sm border rounded bg-background"
                  (keydown.enter)="quickAdd(col)"
                  (keydown.escape)="quickAddColumn = null"
                />
                <button 
                  class="h-8 px-2 bg-primary text-primary-foreground rounded text-sm"
                  (click)="quickAdd(col)"
                  [disabled]="!quickAddTitle.trim()"
                >
                  <ng-icon name="lucidePlus" class="w-4 h-4"></ng-icon>
                </button>
              </div>
              <button 
                *ngIf="quickAddColumn !== col"
                class="w-full flex items-center justify-start gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                (click)="startQuickAdd(col)"
              >
                <ng-icon name="lucidePlus" class="w-4 h-4"></ng-icon>
                Add Event
              </button>
            </div>
          </div>
        </div>
      </div>

      <app-event-edit-dialog
        [(visible)]="isDialogOpen"
        [eventId]="selectedEventId()"
        (visibleChange)="onDialogClose($event)"
      ></app-event-edit-dialog>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class NarrativeEditorComponent {
  readonly calendarService = inject(CalendarService);
  readonly scopes: EditorScope[] = ['day', 'week', 'month', 'period'];
  readonly statusKeys: StatusKey[] = ['todo', 'in-progress', 'completed'];

  searchQuery = '';
  showCompleted = true;
  quickAddColumn: StatusKey | null = null;
  quickAddTitle = '';

  // Dialog State
  isDialogOpen = false;
  readonly selectedEventId = signal<string | null>(null);

  readonly editorScope = this.calendarService.editorScope;
  readonly viewDate = this.calendarService.viewDate;
  readonly currentMonth = this.calendarService.currentMonth;

  readonly scopedEvents = computed(() => this.calendarService.getEventsForScope());

  readonly filteredEvents = computed(() => {
    return this.scopedEvents()
      .filter(e => {
        if (!this.showCompleted && e.status === 'completed') return false;
        if (this.searchQuery) {
          const q = this.searchQuery.toLowerCase();
          return e.title.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => a.date.dayIndex - b.date.dayIndex);
  });

  readonly columns = computed(() => ({
    'todo': this.filteredEvents().filter(e => !e.status || e.status === 'todo'),
    'in-progress': this.filteredEvents().filter(e => e.status === 'in-progress'),
    'completed': this.filteredEvents().filter(e => e.status === 'completed'),
  }));

  readonly stats = computed(() => {
    const events = this.filteredEvents();
    const completed = this.columns()['completed'].length;
    return {
      total: events.length,
      completed,
      completionPct: events.length > 0 ? Math.round((completed / events.length) * 100) : 0,
      avgTension: events.length > 0
        ? Math.round(events.reduce((sum, e) => sum + (e.tension || 0), 0) / events.length)
        : 0,
      withCausality: events.filter(e => e.causedBy?.length || e.causes?.length).length,
    };
  });

  readonly scopeLabel = computed(() => {
    switch (this.editorScope()) {
      case 'day': return `Day ${this.viewDate().dayIndex + 1}, ${this.currentMonth().name}`;
      case 'week': return `Week of Day ${this.viewDate().dayIndex + 1}`;
      case 'month': return this.currentMonth().name;
      case 'period': return 'Current Period';
    }
  });

  constructor() { }

  getScopeIcon(scope: EditorScope): string { return SCOPE_CONFIG[scope].icon; }
  getScopeLabel(scope: EditorScope): string { return SCOPE_CONFIG[scope].label; }
  getStatusIcon(status: StatusKey): string { return STATUS_CONFIG[status].icon; }
  getStatusLabel(status: StatusKey): string { return STATUS_CONFIG[status].label; }
  getStatusColor(status: StatusKey): string { return STATUS_CONFIG[status].color; }

  getColumnEvents(status: StatusKey): CalendarEvent[] {
    return this.columns()[status];
  }

  getEventBorderColor(event: CalendarEvent): string {
    const type = event.eventTypeId ? getEventTypeById(event.eventTypeId) : null;
    return type?.color || '#6366f1';
  }

  getEventStatusIcon(event: CalendarEvent): string {
    switch (event.status) {
      case 'completed': return 'lucideCheckCircle2';
      case 'in-progress': return 'lucideClock';
      default: return 'lucideCircle';
    }
  }

  setScope(scope: EditorScope) {
    this.calendarService.setEditorScope(scope);
  }

  selectEvent(event: CalendarEvent) {
    this.selectedEventId.set(event.id);
    this.isDialogOpen = true;
  }

  onDialogClose(visible: boolean) {
    this.isDialogOpen = visible;
    if (!visible) {
      this.selectedEventId.set(null);
    }
  }

  toggleStatus(e: MouseEvent, eventId: string) {
    e.stopPropagation();
    this.calendarService.toggleEventStatus(eventId);
  }

  startQuickAdd(col: StatusKey) {
    this.quickAddColumn = col;
    this.quickAddTitle = '';
  }

  async quickAdd(col: StatusKey) {
    if (!this.quickAddTitle.trim()) return;

    await this.calendarService.addEvent({
      title: this.quickAddTitle.trim(),
      date: { ...this.viewDate() },
      status: col,
      importance: 'moderate',
    });

    this.quickAddTitle = '';
    this.quickAddColumn = null;
  }
}
