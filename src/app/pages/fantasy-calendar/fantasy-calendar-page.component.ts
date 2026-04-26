import { Component, effect, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FantasyCalendarGridComponent } from '../../components/fantasy-calendar/calendar-grid/calendar-grid.component';
import { CalendarSidebarComponent } from '../../components/fantasy-calendar/calendar-sidebar/calendar-sidebar.component';
import { CalendarWizardComponent } from '../../components/fantasy-calendar/calendar-wizard/calendar-wizard.component';
import { TimelineBarComponent } from '../../components/fantasy-calendar/timeline-bar/timeline-bar.component';
import { NarrativeEditorComponent } from '../../components/fantasy-calendar/narrative-editor/narrative-editor.component';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendarDays, lucideWand2, lucideLayers, lucideTable } from '@ng-icons/lucide';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

type ViewMode = 'wizard' | 'calendar' | 'timeline' | 'kanban';

@Component({
  selector: 'app-fantasy-calendar-page',
  standalone: true,
  imports: [
    CommonModule,
    NgIcon,
    FantasyCalendarGridComponent,
    CalendarSidebarComponent,
    CalendarWizardComponent,
    TimelineBarComponent,
    NarrativeEditorComponent
  ],
  providers: [provideIcons({ lucideCalendarDays, lucideWand2, lucideLayers, lucideTable })],
  template: `
    <div class="h-full flex flex-col bg-background">
      <!-- Top Nav Tabs -->
      <div class="flex items-center gap-4 px-6 py-3 border-b bg-card">
        <h1 class="text-lg font-semibold">Fantasy Calendar</h1>
        <div class="flex-1"></div>
        <div class="flex gap-1">
          <button 
            *ngFor="let mode of modes"
            (click)="setViewMode(mode.id)"
            class="px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition-colors"
            [class.bg-primary]="viewMode() === mode.id"
            [class.text-primary-foreground]="viewMode() === mode.id"
            [class.hover:bg-muted]="viewMode() !== mode.id"
            >
            <ng-icon [name]="mode.icon" class="w-4 h-4"></ng-icon>
            {{ mode.label }}
          </button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="flex-1 overflow-hidden">
        <!-- Wizard View -->
        <div *ngIf="viewMode() === 'wizard'" class="h-full overflow-y-auto">
          <app-calendar-wizard (onComplete)="onWizardComplete()"></app-calendar-wizard>
        </div>

        <!-- Calendar View (Grid + Sidebar) -->
        <div *ngIf="viewMode() === 'calendar'" class="h-full flex">
          <app-calendar-sidebar 
            (onBackToEditor)="navigateToEditor()"
          ></app-calendar-sidebar>
          <div class="flex-1 overflow-y-auto p-4">
            <app-fantasy-calendar-grid></app-fantasy-calendar-grid>
          </div>
        </div>

        <!-- Timeline View -->
        <div *ngIf="viewMode() === 'timeline'" class="h-full overflow-y-auto">
          <app-timeline-bar [scale]="'month'"></app-timeline-bar>
        </div>

        <!-- Kanban View -->
        <div *ngIf="viewMode() === 'kanban'" class="h-full overflow-y-auto">
          <app-narrative-editor></app-narrative-editor>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
  `]
})
export class FantasyCalendarPageComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  readonly viewMode = signal<ViewMode>('calendar');
  readonly pendingRouteMode = signal<ViewMode | null>(null);
  readonly routeViewMode = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => {
        const view = params.get('view');
        return isViewMode(view) ? view : null;
      })
    ),
    { initialValue: null as ViewMode | null }
  );

  readonly modes: { id: ViewMode; label: string; icon: string }[] = [
    { id: 'wizard', label: 'Setup', icon: 'lucideWand2' },
    { id: 'calendar', label: 'Calendar', icon: 'lucideCalendarDays' },
    { id: 'timeline', label: 'Timeline', icon: 'lucideLayers' },
    { id: 'kanban', label: 'Kanban', icon: 'lucideTable' },
  ];

  constructor() {
    effect(() => {
      const routeMode = this.routeViewMode();
      const pending = this.pendingRouteMode();
      if (pending) {
        if (routeMode === pending) {
          this.pendingRouteMode.set(null);
        } else {
          return;
        }
      }
      if (routeMode && routeMode !== this.viewMode()) {
        this.viewMode.set(routeMode);
      }
    });
  }

  onWizardComplete() {
    void this.setViewMode('calendar');
  }

  navigateToEditor() {
    this.router.navigate(['/']);
  }

  async setViewMode(mode: ViewMode): Promise<boolean> {
    this.pendingRouteMode.set(mode);
    this.viewMode.set(mode);
    const ok = await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: mode },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    if (!ok) {
      this.pendingRouteMode.set(null);
    }
    return ok;
  }
}

function isViewMode(value: string | null): value is ViewMode {
  return value === 'wizard' || value === 'calendar' || value === 'timeline' || value === 'kanban';
}
