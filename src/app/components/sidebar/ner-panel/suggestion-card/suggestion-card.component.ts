import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideCheckCircle2, lucideXCircle } from '@ng-icons/lucide';
import { NerSuggestion } from '../../../../services/ner.service';

@Component({
    selector: 'app-suggestion-card',
    standalone: true,
    imports: [CommonModule, NgIconComponent],
    providers: [provideIcons({ lucideCheckCircle2, lucideXCircle })],
    template: `
    <div class="flex items-center justify-between p-2 bg-muted/50 rounded text-xs hover:bg-muted/80 transition-colors">
      <div class="flex-1 min-w-0">
        <span class="font-medium truncate block">{{ suggestion.label }}</span>
        <span class="text-muted-foreground flex items-center gap-1">
          <span class="uppercase text-[10px] tracking-wider">{{ suggestion.kind }}</span>
          <span>•</span>
          <span [class.text-green-500]="confidencePercent >= 80" [class.text-yellow-500]="confidencePercent < 80">
            {{ confidencePercent }}%
          </span>
        </span>
      </div>
      <div class="flex gap-1 shrink-0 ml-2">
        <button
          class="h-6 w-6 flex items-center justify-center rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-500 transition-colors disabled:opacity-50"
          (click)="handleAccept()"
          [disabled]="isProcessing()"
          title="Accept"
        >
          <ng-icon name="lucideCheckCircle2" class="w-3 h-3"></ng-icon>
        </button>
        <button
          class="h-6 w-6 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors disabled:opacity-50"
          (click)="handleReject()"
          [disabled]="isProcessing()"
          title="Reject"
        >
          <ng-icon name="lucideXCircle" class="w-3 h-3"></ng-icon>
        </button>
      </div>
    </div>
  `
})
export class SuggestionCardComponent {
    @Input({ required: true }) suggestion!: NerSuggestion;
    @Output() onAccept = new EventEmitter<string>();
    @Output() onReject = new EventEmitter<string>();

    isProcessing = signal(false);

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
