import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideBrain, lucideAlertTriangle, lucideSparkles } from '@ng-icons/lucide';
import { NerService } from '../../../services/ner.service';
import { SuggestionCardComponent } from './suggestion-card/suggestion-card.component';
import { FormsModule } from '@angular/forms';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';

@Component({
  selector: 'app-ner-panel',
  standalone: true,
  imports: [CommonModule, NgIconComponent, SuggestionCardComponent, FormsModule],
  providers: [provideIcons({ lucideBrain, lucideAlertTriangle, lucideSparkles })],
  template: `
    <div class="flex flex-col h-full bg-background/50">
      <!-- Header -->
      <div class="p-4 border-b border-border">
        <div class="flex items-center gap-2 mb-2">
          <ng-icon name="lucideBrain" class="w-5 h-5 text-purple-500"></ng-icon>
          <span class="font-semibold">Entity Detection</span>
        </div>
        <p class="text-xs text-muted-foreground">
          Detect and manage entities in your notes
        </p>
      </div>

      <!-- FST Scanner Toggle -->
      <div class="p-4 border-b border-border">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <span class="text-sm font-medium">FST Scanner</span>
            <p className="text-xs text-muted-foreground">
              Instant entity detection (WASM)
            </p>
          </div>
          <!-- Simple Toggle implementation -->
          <button 
            role="switch"
            [attr.aria-checked]="nerService.fstEnabled()"
            (click)="toggleFst()"
            class="w-10 h-5 rounded-full relative transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
            [class.bg-purple-500]="nerService.fstEnabled()"
            [class.bg-muted]="!nerService.fstEnabled()"
          >
            <span 
              class="block w-4 h-4 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out mt-0.5 ml-0.5"
              [class.translate-x-5]="nerService.fstEnabled()"
            ></span>
          </button>
        </div>
      </div>

      <!-- Native NER Notice -->
      <div class="p-4 border-b border-border bg-muted/30">
        <div class="flex items-start gap-2 text-sm">
          <ng-icon name="lucideAlertTriangle" class="w-4 h-4 text-amber-500 shrink-0 mt-0.5"></ng-icon>
          <div>
            <p class="font-medium text-muted-foreground">AI NER Available in Desktop App</p>
            <p class="text-xs text-muted-foreground mt-1">
              The GLiNER AI model for advanced entity extraction requires the native desktop application.
            </p>
          </div>
        </div>
      </div>

      <!-- Suggestions Section -->
      <div class="p-4 border-b border-border flex-1 min-h-0 flex flex-col">
        <div class="flex items-center justify-between mb-3 shrink-0">
          <span class="text-sm font-medium">Pending Suggestions</span>
          <span class="text-xs bg-muted px-2 py-0.5 rounded">
            {{ nerService.suggestions().length }}
          </span>
        </div>

        <div class="overflow-y-auto flex-1 -mx-2 px-2 space-y-2">
           <ng-container *ngIf="nerService.suggestions().length > 0; else emptyState">
             <app-suggestion-card
               *ngFor="let s of nerService.suggestions()"
               [suggestion]="s"
               (onAccept)="nerService.acceptSuggestion($event)"
               (onReject)="nerService.rejectSuggestion($event)"
             ></app-suggestion-card>
           </ng-container>

           <ng-template #emptyState>
             <div class="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
               <p class="text-xs">No pending suggestions</p>
               <button 
                 *ngIf="nerService.fstEnabled()"
                 (click)="runAnalysis()"
                 class="mt-4 text-xs bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 rounded-md transition-colors"
               >
                 Run Manual Scan
               </button>
             </div>
           </ng-template>
        </div>
      </div>

      <!-- Footer Help -->
      <div class="p-4 shrink-0 border-t border-border">
        <div class="text-center text-muted-foreground">
           <ng-icon name="lucideSparkles" class="w-6 h-6 mx-auto mb-2 opacity-30"></ng-icon>
            <p class="text-xs">
                 Use bracket syntax like <code class="bg-muted px-1 rounded">[CHARACTER|Name]</code> to create entities manually
            </p>
        </div>
      </div>
    </div>
  `
})
export class NerPanelComponent {
  nerService = inject(NerService);
  private noteStore = inject(NoteEditorStore);

  toggleFst() {
    this.nerService.toggleFst(!this.nerService.fstEnabled());
  }

  runAnalysis() {
    // Get current note content from the store
    const currentNote = this.noteStore.currentNote();
    if (currentNote && currentNote.content) {
      console.log('[NerPanel] Running manual scan on note:', currentNote.id);
      this.nerService.analyzeNote(currentNote.content);
    } else {
      console.warn('[NerPanel] No note content to analyze');
    }
  }
}
