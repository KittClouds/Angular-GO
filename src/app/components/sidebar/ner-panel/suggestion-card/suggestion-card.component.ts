import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideCheckCircle2, lucideXCircle, lucideSparkles, lucideInfo } from '@ng-icons/lucide';
import { NerSuggestion } from '../../../../services/ner.service';

@Component({
  selector: 'app-suggestion-card',
  standalone: true,
  imports: [CommonModule, NgIconComponent],
  providers: [provideIcons({ lucideCheckCircle2, lucideXCircle, lucideSparkles, lucideInfo })],
  template: `
    <div 
      class="p-2.5 bg-muted/50 rounded-lg text-xs hover:bg-muted/80 transition-all border border-transparent hover:border-border/50"
      [class.ring-1]="suggestion.llmEnhanced"
      [class.ring-teal-500/30]="suggestion.llmEnhanced"
    >
      <!-- Main Row -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="font-semibold truncate">{{ suggestion.label }}</span>
            @if (suggestion.llmEnhanced) {
              <ng-icon 
                name="lucideSparkles" 
                class="w-3 h-3 text-teal-400 shrink-0" 
                title="LLM Enhanced"
              ></ng-icon>
            }
          </div>
          <div class="flex items-center gap-1.5 mt-1 text-muted-foreground">
            <span 
              class="uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded-sm"
              [class.bg-purple-500/20]="true"
              [class.text-purple-300]="true"
            >{{ suggestion.kind }}</span>
            <span class="text-[10px]">•</span>
            <span 
              class="text-[10px] font-medium"
              [class.text-green-400]="confidencePercent >= 80" 
              [class.text-amber-400]="confidencePercent >= 50 && confidencePercent < 80"
              [class.text-red-400]="confidencePercent < 50"
            >
              {{ confidencePercent }}%
            </span>
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="flex gap-1 shrink-0">
          <button
            class="h-7 w-7 flex items-center justify-center rounded-md hover:bg-green-500/20 text-green-400 transition-colors disabled:opacity-50"
            (click)="handleAccept()"
            [disabled]="isProcessing()"
            title="Accept"
          >
            <ng-icon name="lucideCheckCircle2" class="w-4 h-4"></ng-icon>
          </button>
          <button
            class="h-7 w-7 flex items-center justify-center rounded-md hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
            (click)="handleReject()"
            [disabled]="isProcessing()"
            title="Reject"
          >
            <ng-icon name="lucideXCircle" class="w-4 h-4"></ng-icon>
          </button>
        </div>
      </div>

      <!-- LLM Reasoning (if available) -->
      @if (suggestion.llmReasoning && showReasoning()) {
        <div class="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          <span class="italic">{{ suggestion.llmReasoning }}</span>
        </div>
      }

      <!-- Toggle reasoning -->
      @if (suggestion.llmReasoning) {
        <button 
          class="mt-1.5 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          (click)="showReasoning.set(!showReasoning())"
        >
          <ng-icon name="lucideInfo" class="w-2.5 h-2.5"></ng-icon>
          {{ showReasoning() ? 'Hide' : 'Why?' }}
        </button>
      }
    </div>
  `
})
export class SuggestionCardComponent {
  @Input({ required: true }) suggestion!: NerSuggestion;
  @Output() onAccept = new EventEmitter<string>();
  @Output() onReject = new EventEmitter<string>();

  isProcessing = signal(false);
  showReasoning = signal(false);

  get confidencePercent(): number {
    return Math.round(this.suggestion.confidence * 100);
  }

  async handleAccept() {
    this.isProcessing.set(true);
    await this.onAccept.emit(this.suggestion.id);
    this.isProcessing.set(false);
  }

  async handleReject() {
    this.isProcessing.set(true);
    await this.onReject.emit(this.suggestion.id);
    this.isProcessing.set(false);
  }
}
