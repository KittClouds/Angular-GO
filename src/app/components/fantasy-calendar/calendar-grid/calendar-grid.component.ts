import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight } from '@ng-icons/lucide';
import { CalendarService } from '../../../services/calendar.service';
import { DayCellComponent } from '../day-cell/day-cell.component';
import { EventEditDialogComponent } from '../event-edit-dialog/event-edit-dialog.component';
import { FantasyDate } from '../../../lib/fantasy-calendar/types';
import { getWeekdayIndex } from '../../../lib/fantasy-calendar/utils';

@Component({
  selector: 'app-fantasy-calendar-grid',
  standalone: true,
  imports: [CommonModule, NgIconComponent, DayCellComponent, EventEditDialogComponent],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight })],
  template: `
    <div class="flex flex-col h-full bg-background border rounded-lg overflow-hidden shadow-sm">
      
      <!-- Header -->
      <div class="flex items-center justify-between p-4 bg-card border-b shrink-0">
        <div class="flex items-center gap-2">
          <button class="btn-ghost text-sm" (click)="calendarService.navigateYear('prev')">
            &lt; Year
          </button>
        </div>

        <div class="flex flex-col items-center">
          <span class="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">{{ calendar().name }}</span>
          <h2 class="text-xl font-semibold tracking-tight">
            {{ calendarService.viewYearFormatted() }}
            <span *ngIf="era()"> - {{ era()?.name }}</span>
          </h2>
        </div>

        <div class="flex items-center gap-2">
          <button class="btn-ghost text-sm" (click)="calendarService.navigateYear('next')">
            Year &gt;
          </button>
        </div>
      </div>

      <!-- Scrollable Grid Container -->
      <div class="flex-1 overflow-auto">
        <div class="min-w-[800px] h-full flex flex-col">
          <!-- Month Navigation & Grid Header -->
          <div class="bg-muted/30 p-2 text-center border-b font-medium shrink-0">
            <div class="flex items-center justify-center gap-4 mb-2">
              <button class="btn-icon" (click)="calendarService.navigateMonth('prev')">
                <ng-icon name="lucideChevronLeft" class="w-4 h-4"></ng-icon>
              </button>
              <span class="text-lg w-48">
                {{ currentMonth().name }}
              </span>
              <button class="btn-icon" (click)="calendarService.navigateMonth('next')">
                <ng-icon name="lucideChevronRight" class="w-4 h-4"></ng-icon>
              </button>
            </div>

            <!-- Weekday Headers -->
            <div 
              class="grid gap-1"
              [ngStyle]="{
                'grid-template-columns': 'repeat(' + calendar().weekdays.length + ', minmax(0, 1fr))'
              }"
            >
              <div 
                *ngFor="let day of calendar().weekdays"
                class="p-2 text-sm text-muted-foreground font-medium uppercase tracking-wider truncate"
              >
                {{ day.name }}
              </div>
            </div>
          </div>

          <!-- Calendar Grid -->
          <div 
            class="grid flex-1 bg-muted/20 gap-px border-b"
            [ngStyle]="gridStyle()"
          >
            <!-- Empty slots before start -->
            <div 
              *ngFor="let _ of getEmptySlotsStart()" 
              class="bg-card/50 min-h-[120px]"
            ></div>

            <!-- Days -->
            <ng-container *ngFor="let dayIndex of getDayIndices(); let i = index">
              <app-day-cell
                [dayIndex]="i"
                [date]="getDateForIndex(i)"
                [events]="getEventsForDayIndex(i)"
                [calendar]="calendar()"
                [isToday]="false"
                [isHighlighted]="viewDate().dayIndex === i"
                (onDayClick)="calendarService.selectDay(i)"
                (onAddEvent)="handleAddEvent(i)"
                (onEventClick)="handleEventClick($event)"
              ></app-day-cell>
            </ng-container>

            <!-- Empty slots after end -->
            <div 
              *ngFor="let _ of getEmptySlotsEnd()" 
              class="bg-card/50 min-h-[120px]"
            ></div>
          </div>
        </div>
      </div>

      <app-event-edit-dialog
        [(visible)]="isDialogOpen"
        [eventId]="selectedEventId()"
      ></app-event-edit-dialog>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .btn-ghost { @apply px-3 py-1.5 hover:bg-muted rounded text-foreground/80 hover:text-foreground transition-colors; }
    .btn-icon { @apply p-2 hover:bg-muted rounded text-foreground/80 hover:text-foreground transition-colors; }
  `]
})
export class FantasyCalendarGridComponent {
  readonly calendarService = inject(CalendarService);
  readonly calendar = this.calendarService.calendar;
  readonly viewDate = this.calendarService.viewDate;
  readonly currentMonth = this.calendarService.currentMonth;
  readonly daysInMonth = this.calendarService.daysInCurrentMonth;

  // Dialog State
  isDialogOpen = false;
  selectedEventId = computed(() => this.calendarService.highlightedEventId());

  readonly era = computed(() =>
    this.calendar().eras.find(e => e.id === this.calendar().defaultEraId)
  );

  readonly events = this.calendarService.eventsForCurrentMonth;

  readonly firstDayOfWeek = computed(() => {
    return getWeekdayIndex(this.calendar(), {
      ...this.viewDate(),
      dayIndex: 0
    });
  });

  readonly totalSlots = computed(() => {
    const days = this.daysInMonth();
    const start = this.firstDayOfWeek();
    const cols = this.calendar().weekdays.length;
    return Math.ceil((days + start) / cols) * cols;
  });

  gridStyle() {
    const cols = this.calendar().weekdays.length;
    return {
      'grid-template-columns': `repeat(${cols}, minmax(120px, 1fr))`,
      'grid-auto-rows': 'minmax(120px, 1fr)'
    };
  }

  getEmptySlotsStart() {
    return Array(this.firstDayOfWeek()).fill(0);
  }

  getDayIndices() {
    return Array(this.daysInMonth()).fill(0);
  }

  getEmptySlotsEnd() {
    const total = this.totalSlots();
    const used = this.daysInMonth() + this.firstDayOfWeek();
    return Array(Math.max(0, total - used)).fill(0);
  }

  getDateForIndex(dayIndex: number): FantasyDate {
    return { ...this.viewDate(), dayIndex };
  }

  getEventsForDayIndex(dayIndex: number) {
    // Optimization: Pre-filter events in computed? 
    // For now, simple filter is okay for <1000 events
    return this.events().filter(e => e.date.dayIndex === dayIndex);
  }

  // Make handleAddEvent async to await service call
  async handleAddEvent(dayIndex: number) {
    const newEventId = await this.calendarService.addEvent({
      title: 'New Event',
      date: { ...this.viewDate(), dayIndex },
      status: 'todo'
    });
    // Optional: Open dialog immediately for new event?
    // for now just add it, user can click to edit
  }

  handleEventClick(id: string) {
    this.calendarService.highlightedEventId.set(id);
    this.isDialogOpen = true;
  }
}
