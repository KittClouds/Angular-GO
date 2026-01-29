import { Component, ChangeDetectionStrategy, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxTimelineComponent, NgxTimelineEntryComponent } from '@omnedia/ngx-timeline';

@Component({
  selector: 'app-timeline-view',
  standalone: true,
  imports: [CommonModule, NgxTimelineComponent, NgxTimelineEntryComponent],
  template: `
    <div class="timeline-container p-4">
      <div class="mb-6 text-center">
        <h3 class="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-cyan-400">
          Narrative Timeline
        </h3>
        <p class="text-xs text-muted-foreground mt-1">Key events in chronological order</p>
      </div>

      <om-timeline
        [orientation]="'left'"
        [entriesGap]="'2rem'"
        [entryGap]="'0.5rem'"
        [titleGap]="'0.5rem'"
        [titleMaxWidth]="'100%'"
        [pathWidth]="'2px'"
        [pathColor]="'rgba(255,255,255,0.1)'"
        [gradientColors]="['#2dd4bf', '#06b6d4']"
      >
        <!-- Mock Data for Now -->
        <om-timeline-entry>
          <ng-template #timelineTitle>
            <div class="flex items-center justify-between w-full">
              <span class="text-sm font-bold text-teal-300">The Arrival</span>
              <span class="text-[10px] text-muted-foreground font-mono">14:00</span>
            </div>
          </ng-template>
          <ng-template #timelineContent>
             <div class="bg-muted/20 p-3 rounded border border-white/5 text-sm text-muted-foreground">
               <p class="mb-2 italic">"Frodo arrives at the Prancing Pony, soaking wet and terrified."</p>
               <div class="flex gap-2">
                 <span class="text-[10px] bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded">Frodo</span>
                 <span class="text-[10px] bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded">Sam</span>
               </div>
             </div>
          </ng-template>
        </om-timeline-entry>

        <om-timeline-entry>
          <ng-template #timelineTitle>
            <div class="flex items-center justify-between w-full">
              <span class="text-sm font-bold text-teal-300">Strider's Corner</span>
              <span class="text-[10px] text-muted-foreground font-mono">15:30</span>
            </div>
          </ng-template>
          <ng-template #timelineContent>
             <div class="bg-muted/20 p-3 rounded border border-white/5 text-sm text-muted-foreground">
               <p class="mb-2 italic">"A dark figure watches from the shadows. The ring feels heavy."</p>
               <div class="flex gap-2">
                 <span class="text-[10px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded">Strider</span>
               </div>
             </div>
          </ng-template>
        </om-timeline-entry>

        <om-timeline-entry>
          <ng-template #timelineTitle>
            <div class="flex items-center justify-between w-full">
             <span class="text-sm font-bold text-teal-300">Nazgûl Attack</span>
             <span class="text-[10px] text-muted-foreground font-mono">23:00</span>
            </div>
          </ng-template>
          <ng-template #timelineContent>
             <div class="bg-muted/20 p-3 rounded border border-white/5 text-sm text-muted-foreground">
               <p class="mb-2 italic">"Feather pillows are shredded. The enemy knows they are here."</p>
               <div class="flex gap-2">
                 <span class="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">Nazgûl</span>
               </div>
             </div>
          </ng-template>
        </om-timeline-entry>

      </om-timeline>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
    }
    
    /* Override timeline styles for sidebar context */
    ::ng-deep om-timeline {
        width: 100%;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None
})
export class TimelineViewComponent { }
