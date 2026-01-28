import { Component, Output, EventEmitter, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus } from '@ng-icons/lucide';
import { CalendarDefinition, CalendarEvent, FantasyDate } from '../../../lib/fantasy-calendar/types';
import { getMoonPhase } from '../../../lib/fantasy-calendar/utils';
import { getEventTypeById } from '../../../lib/fantasy-calendar/event-type-registry';
import { EventCardComponent } from '../event-card/event-card.component';
import { CalendarService } from '../../../services/calendar.service';

@Component({
  selector: 'app-day-cell',
  standalone: true,
  imports: [CommonModule, NgIcon, EventCardComponent],
  providers: [provideIcons({ lucidePlus })],
  template: `
    <div 
      class="relative flex flex-col min-h-[100px] bg-card border-t border-l p-1.5 hover:bg-accent/5 transition-colors cursor-pointer group"
      [class.ring-1]="isHighlighted()"
      [class.ring-primary-50]="isHighlighted()"
      [class.bg-primary-5]="isHighlighted()"
      [class.bg-primary-10]="isToday()"
      (click)="onDayClick.emit()"
    >
      <!-- Day Header -->
      <div class="flex items-center justify-between mb-1 shrink-0">
        <div class="flex items-center gap-1">
          <!-- Day Number -->
          <span 
            class="text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full"
            [class.bg-primary]="isToday()"
            [class.text-primary-foreground]="isToday()"
          >
            {{ displayDay }}
          </span>

          <!-- Moon Phases -->
          <div class="flex gap-0.5">
            <div 
              *ngFor="let moon of calendar().moons.slice(0, 2)"
              class="w-2 h-2 rounded-full border border-border/50"
              [style.background]="getMoonGradient(moon, date())"
              [title]="moon.name"
            ></div>
          </div>
        </div>

        <!-- Quick Add Button -->
        <button 
          (click)="handleAddClick($event)"
          class="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted text-muted-foreground hover:text-foreground"
          title="Add event"
        >
          <ng-icon name="lucidePlus" class="w-3 h-3"></ng-icon>
        </button>
      </div>

      <!-- Events -->
      <div class="flex-1 min-h-0 space-y-0.5 overflow-hidden">
        <ng-container *ngFor="let event of sortedEvents().slice(0, 4)">
          <app-event-card 
            *ngIf="event.showInCell !== false"
            [event]="event"
            [compact]="true"
            (cardClick)="onEventClick.emit(event.id)"
          ></app-event-card>
        </ng-container>
        
        <!-- Overflow -->
        <div 
          *ngIf="sortedEvents().length > 4"
          class="text-[9px] text-muted-foreground text-center py-0.5"
        >
          +{{ sortedEvents().length - 4 }} more
        </div>

        <!-- Empty State -->
        <div *ngIf="sortedEvents().length === 0" class="flex-1 flex items-center justify-center opacity-0 group-hover:opacity-30 transition-opacity">
          <ng-icon name="lucidePlus" class="w-4 h-4 text-muted-foreground"></ng-icon>
        </div>
      </div>

      <!-- Completion Indicator -->
      <div 
        *ngIf="events().length > 0 && completedCount() > 0"
        class="absolute bottom-1 right-1 text-[8px] text-muted-foreground/60"
        [title]="completedCount() + '/' + events().length + ' completed'"
      >
        {{ completedCount() }}/{{ events().length }}
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
  `]
})
export class DayCellComponent {
  readonly dayIndex = input.required<number>();
  readonly date = input.required<FantasyDate>();
  readonly events = input.required<CalendarEvent[]>();
  readonly calendar = input.required<CalendarDefinition>();
  readonly isToday = input<boolean>(false);
  readonly isHighlighted = input<boolean>(false);

  @Output() onDayClick = new EventEmitter<void>();
  @Output() onAddEvent = new EventEmitter<void>();
  @Output() onEventClick = new EventEmitter<string>();

  constructor(private calendarService: CalendarService) { }

  get displayDay(): number {
    return this.dayIndex() + 1;
  }

  readonly sortedEvents = computed(() => {
    return [...this.events()].sort((a, b) => {
      const order = { 'in-progress': 0, 'todo': 1, 'completed': 2, undefined: 1 };
      return (order[(a.status || 'todo') as keyof typeof order] ?? 1) - (order[(b.status || 'todo') as keyof typeof order] ?? 1);
    });
  });

  readonly completedCount = computed(() =>
    this.events().filter(e => e.status === 'completed').length
  );

  getMoonGradient(moon: any, date: FantasyDate): string {
    const phase = getMoonPhase(moon, this.calendar(), date);
    return `linear-gradient(90deg, ${moon.color} ${phase * 100}%, transparent 0%)`;
  }

  handleAddClick(e: MouseEvent) {
    e.stopPropagation();
    this.onAddEvent.emit();
  }
}
