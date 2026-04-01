import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  lucideBadgeAlert,
  lucideBrain,
  lucideCpu,
  lucideLoader2,
  lucideSparkles,
  lucideZap,
} from '@ng-icons/lucide';
import { NerService } from '../../../services/ner.service';
import { SuggestionCardComponent } from './suggestion-card/suggestion-card.component';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { FooterStatsService } from '../../../services/footer-stats.service';
import { parseContentToPlainText } from '../../../lib/analytics';
import type {
  EntitySuggestionProviderId,
  EntitySuggestionProviderStatus,
  EntitySuggestionScanRequest,
} from '../../../lib/entity-suggestions/entity-suggestion.types';

@Component({
  selector: 'app-ner-panel',
  standalone: true,
  imports: [CommonModule, NgIconComponent, SuggestionCardComponent, FormsModule],
  providers: [
    provideIcons({
      lucideBadgeAlert,
      lucideBrain,
      lucideCpu,
      lucideLoader2,
      lucideSparkles,
      lucideZap,
    }),
  ],
  template: `
    <div class="flex flex-col h-full bg-background/50">
      <div class="p-4 border-b border-border">
        <div class="flex items-center gap-2 mb-2">
          <ng-icon name="lucideBrain" class="w-5 h-5 text-purple-500"></ng-icon>
          <span class="font-semibold">Entity Detection</span>
        </div>
        <p class="text-xs text-muted-foreground">
          GoKitt FST â€” WASM Unsupervised NER
        </p>
      </div>

      <div class="p-4 border-b border-border space-y-3">
        <div class="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
          <div class="flex items-center justify-between gap-3">
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

          <button
            (click)="runAnalysis('fst')"
            [disabled]="!nerService.fstEnabled() || nerService.isAnalyzing()"
            class="w-full text-xs bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-purple-300 px-3 py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5"
          >
            @if (isProviderActive('fst')) {
              <ng-icon name="lucideLoader2" class="w-3 h-3 animate-spin"></ng-icon>
              <span>Scanning with FST...</span>
            } @else {
              <ng-icon name="lucideZap" class="w-3 h-3"></ng-icon>
              <span>Run Manual Scan</span>
            }
          </button>
        </div>

        <div class="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
              <div class="flex items-center gap-1.5">
                <ng-icon name="lucideSparkles" class="w-3.5 h-3.5 text-teal-400"></ng-icon>
                <span class="text-sm font-medium">LFM 2.5 Local</span>
                <span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20">
                  experimental
                </span>
              </div>
              <p class="text-xs text-muted-foreground mt-0.5">
                Browser-local entity suggestions with JSON output
              </p>
            </div>

            <div class="flex items-center gap-1.5 flex-wrap justify-end">
              <span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60">
                q4
              </span>
              <span
                class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border"
                [class.bg-emerald-500/10]="lfmStatus().device === 'webgpu'"
                [class.text-emerald-300]="lfmStatus().device === 'webgpu'"
                [class.border-emerald-500/20]="lfmStatus().device === 'webgpu'"
                [class.bg-amber-500/10]="lfmStatus().device === 'wasm'"
                [class.text-amber-300]="lfmStatus().device === 'wasm'"
                [class.border-amber-500/20]="lfmStatus().device === 'wasm'"
                [class.bg-muted]="!lfmStatus().device"
                [class.text-muted-foreground]="!lfmStatus().device"
                [class.border-border/60]="!lfmStatus().device"
              >
                {{ getDeviceLabel(lfmStatus()) }}
              </span>
              <span
                class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border"
                [class.bg-teal-500/10]="getStatusLabel(lfmStatus()) === 'ready'"
                [class.text-teal-300]="getStatusLabel(lfmStatus()) === 'ready'"
                [class.border-teal-500/20]="getStatusLabel(lfmStatus()) === 'ready'"
                [class.bg-amber-500/10]="getStatusLabel(lfmStatus()) === 'loading'"
                [class.text-amber-300]="getStatusLabel(lfmStatus()) === 'loading'"
                [class.border-amber-500/20]="getStatusLabel(lfmStatus()) === 'loading'"
                [class.bg-red-500/10]="getStatusLabel(lfmStatus()) === 'error'"
                [class.text-red-300]="getStatusLabel(lfmStatus()) === 'error'"
                [class.border-red-500/20]="getStatusLabel(lfmStatus()) === 'error'"
                [class.bg-muted]="getStatusLabel(lfmStatus()) === 'idle'"
                [class.text-muted-foreground]="getStatusLabel(lfmStatus()) === 'idle'"
                [class.border-border/60]="getStatusLabel(lfmStatus()) === 'idle'"
              >
                {{ getStatusLabel(lfmStatus()) }}
              </span>
            </div>
          </div>

          <button
            (click)="runAnalysis('lfm_local_experiment')"
            [disabled]="nerService.isAnalyzing()"
            class="w-full text-xs bg-teal-500/10 hover:bg-teal-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-teal-300 px-3 py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5"
          >
            @if (isProviderActive('lfm_local_experiment')) {
              <ng-icon name="lucideLoader2" class="w-3 h-3 animate-spin"></ng-icon>
              <span>Running Local Model Scan...</span>
            } @else {
              <ng-icon name="lucideCpu" class="w-3 h-3"></ng-icon>
              <span>Run Local Model Scan</span>
            }
          </button>

          @if (lfmStatus().error) {
            <div class="flex items-start gap-2 text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1.5">
              <ng-icon name="lucideBadgeAlert" class="w-3.5 h-3.5 shrink-0 mt-0.5"></ng-icon>
              <span>{{ lfmStatus().error }}</span>
            </div>
          }
        </div>
      </div>

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
              *ngFor="let suggestion of nerService.suggestions()"
              [suggestion]="suggestion"
              (onAccept)="nerService.acceptSuggestion($event)"
              (onReject)="nerService.rejectSuggestion($event)"
            ></app-suggestion-card>
          </ng-container>

          <ng-template #emptyState>
            <div class="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <ng-icon name="lucideSparkles" class="w-8 h-8 opacity-20 mb-2"></ng-icon>
              <p class="text-xs">No pending suggestions</p>
              @if (nerService.errorMessage()) {
                <p class="mt-3 text-[11px] text-red-300">{{ nerService.errorMessage() }}</p>
              }
            </div>
          </ng-template>
        </div>
      </div>

      <div class="p-3 shrink-0 border-t border-border bg-muted/20">
        <p class="text-[10px] text-muted-foreground text-center">
          FST / Local LFM â†’ Accept / Reject
        </p>
      </div>
    </div>
  `,
})
export class NerPanelComponent {
  nerService = inject(NerService);
  private noteStore = inject(NoteEditorStore);
  private footerStatsService = inject(FooterStatsService);

  lfmStatus = () => this.nerService.getProviderStatus('lfm_local_experiment');

  toggleFst() {
    this.nerService.toggleFst(!this.nerService.fstEnabled());
  }

  async runAnalysis(providerId: EntitySuggestionProviderId) {
    const request = this.buildScanRequest();
    if (!request) {
      console.warn('[NerPanel] No rendered note text to analyze');
      return;
    }

    console.log('[NerPanel] Running manual scan on note:', request.noteId, providerId);
    await this.nerService.runManualScan(providerId, request);
  }

  isProviderActive(providerId: EntitySuggestionProviderId): boolean {
    return this.nerService.isAnalyzing() && this.nerService.activeProvider() === providerId;
  }

  getStatusLabel(status: EntitySuggestionProviderStatus): 'idle' | 'loading' | 'ready' | 'error' {
    if (status.loading) {
      return 'loading';
    }

    if (status.error) {
      return 'error';
    }

    if (status.ready) {
      return 'ready';
    }

    return 'idle';
  }

  getDeviceLabel(status: EntitySuggestionProviderStatus): string {
    if (status.device === 'webgpu') {
      return 'WebGPU';
    }

    if (status.device === 'wasm') {
      return 'CPU/WASM';
    }

    return 'Idle';
  }

  private buildScanRequest(): EntitySuggestionScanRequest | null {
    const currentNote = this.noteStore.currentNote();
    if (!currentNote) {
      return null;
    }

    const plainText =
      this.footerStatsService.plainText() ||
      parseContentToPlainText(currentNote.content || currentNote.markdownContent || '');

    if (!plainText.trim()) {
      return null;
    }

    return {
      noteId: currentNote.id,
      noteTitle: currentNote.title || 'Untitled Note',
      plainText,
    };
  }
}
