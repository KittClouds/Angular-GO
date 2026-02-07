import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideBrain, lucideSparkles, lucideZap, lucideLoader2 } from '@ng-icons/lucide';
import { NerService } from '../../../services/ner.service';
import { SuggestionCardComponent } from './suggestion-card/suggestion-card.component';
import { FormsModule } from '@angular/forms';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';

@Component({
  selector: 'app-ner-panel',
  standalone: true,
  imports: [CommonModule, NgIconComponent, SuggestionCardComponent, FormsModule],
  providers: [provideIcons({ lucideBrain, lucideSparkles, lucideZap, lucideLoader2 })],
  template: `
    <div class="flex flex-col h-full bg-background/50">
      <!-- Header -->
      <div class="p-4 border-b border-border">
        <div class="flex items-center gap-2 mb-2">
          <ng-icon name="lucideBrain" class="w-5 h-5 text-purple-500"></ng-icon>
          <span class="font-semibold">Entity Detection</span>
        </div>
        <p class="text-xs text-muted-foreground">
          GoKitt NER + LLM Enhancement
        </p>
      </div>

      <!-- Toggle Section -->
      <div class="p-4 border-b border-border space-y-3">
        <!-- FST Scanner Toggle -->
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-1.5">
              <ng-icon name="lucideZap" class="w-3.5 h-3.5 text-amber-500"></ng-icon>
              <span class="text-sm font-medium">FST Scanner</span>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">
              Unsupervised NER (WASM)
            </p>
          </div>
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

        <!-- LLM Enhancement Toggle -->
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-1.5">
              <ng-icon name="lucideSparkles" class="w-3.5 h-3.5 text-teal-500"></ng-icon>
              <span class="text-sm font-medium">LLM Enhance</span>
              @if (nerService.isLlmProcessing()) {
                <ng-icon name="lucideLoader2" class="w-3 h-3 text-teal-500 animate-spin"></ng-icon>
              }
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">
              Refine with OpenRouter
            </p>
          </div>
          <button 
            role="switch"
            [attr.aria-checked]="nerService.llmEnabled()"
            (click)="toggleLlm()"
            class="w-10 h-5 rounded-full relative transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
            [class.bg-teal-500]="nerService.llmEnabled()"
            [class.bg-muted]="!nerService.llmEnabled()"
          >
            <span 
              class="block w-4 h-4 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out mt-0.5 ml-0.5"
              [class.translate-x-5]="nerService.llmEnabled()"
            ></span>
          </button>
        </div>
      </div>

      <!-- Suggestions Section -->
      <div class="p-4 border-b border-border flex-1 min-h-0 flex flex-col">
        <div class="flex items-center justify-between mb-3 shrink-0">
          <span class="text-sm font-medium">Suggestions</span>
          <div class="flex items-center gap-2">
            @if (nerService.isAnalyzing()) {
              <span class="text-xs text-muted-foreground flex items-center gap-1">
                <ng-icon name="lucideLoader2" class="w-3 h-3 animate-spin"></ng-icon>
                Scanning...
              </span>
            }
            <span class="text-xs bg-muted px-2 py-0.5 rounded">
              {{ nerService.suggestions().length }}
            </span>
          </div>
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
               <ng-icon name="lucideSparkles" class="w-8 h-8 opacity-20 mb-2"></ng-icon>
               <p class="text-xs">No pending suggestions</p>
               <button 
                 *ngIf="nerService.fstEnabled()"
                 (click)="runAnalysis()"
                 class="mt-4 text-xs bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5"
               >
                 <ng-icon name="lucideZap" class="w-3 h-3"></ng-icon>
                 Run Manual Scan
               </button>
             </div>
           </ng-template>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-3 shrink-0 border-t border-border bg-muted/20">
        <p class="text-[10px] text-muted-foreground text-center">
          GoKitt FST → LLM Filter → Accept/Reject
        </p>
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

  toggleLlm() {
    this.nerService.toggleLlm(!this.nerService.llmEnabled());
  }

  runAnalysis() {
    const currentNote = this.noteStore.currentNote();
    if (currentNote && currentNote.content) {
      console.log('[NerPanel] Running manual scan on note:', currentNote.id);
      this.nerService.analyzeNote(currentNote.content);
    } else {
      console.warn('[NerPanel] No note content to analyze');
    }
  }
}
