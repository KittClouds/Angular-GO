import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TtsService, TTS_VOICES, TtsVoice } from '../../../services/tts.service';

@Component({
    selector: 'app-tts-settings-popup',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="relative">
        <!-- Settings Cog Button -->
        <button (click)="togglePopup()"
                class="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 focus:outline-none"
                [class.text-teal-600]="isOpen" [class.dark:text-teal-400]="isOpen"
                title="TTS Settings">
            <i class="pi pi-cog text-[10px]"></i>
        </button>

        <!-- Popup Card -->
        @if (isOpen) {
            <div class="absolute bottom-8 left-0 w-64 bg-slate-900 border border-teal-700/50 rounded-lg shadow-xl z-50 overflow-hidden">
                <!-- Header -->
                <div class="px-3 py-2 bg-teal-900/40 border-b border-teal-700/30 flex items-center justify-between">
                    <span class="text-xs font-medium text-teal-100 flex items-center gap-1.5">
                        <i class="pi pi-volume-up text-[10px]"></i>
                        TTS Settings
                    </span>
                    <button (click)="togglePopup()" class="text-white/60 hover:text-white">
                        <i class="pi pi-times text-[10px]"></i>
                    </button>
                </div>

                <!-- Content -->
                <div class="p-3 space-y-3">
                    <!-- Voice Selection -->
                    <div>
                        <label class="text-[10px] text-white/60 uppercase tracking-wide mb-1 block">Voice</label>
                        <div class="grid grid-cols-2 gap-1.5">
                            @for (voice of voices; track voice.id) {
                                <button 
                                    (click)="selectVoice(voice)"
                                    class="px-2 py-1.5 text-[11px] rounded border transition-all"
                                    [class.bg-teal-700]="ttsService.selectedVoice().id === voice.id"
                                    [class.border-teal-500]="ttsService.selectedVoice().id === voice.id"
                                    [class.text-white]="ttsService.selectedVoice().id === voice.id"
                                    [class.bg-slate-800]="ttsService.selectedVoice().id !== voice.id"
                                    [class.border-slate-700]="ttsService.selectedVoice().id !== voice.id"
                                    [class.text-white/70]="ttsService.selectedVoice().id !== voice.id"
                                    [class.hover:border-teal-600]="ttsService.selectedVoice().id !== voice.id">
                                    <div class="flex items-center gap-1">
                                        <i class="pi text-[8px]" 
                                           [class.pi-user]="voice.gender === 'male'"
                                           [class.pi-heart]="voice.gender === 'female'"></i>
                                        {{ voice.name }}
                                    </div>
                                </button>
                            }
                        </div>
                    </div>

                    <!-- Model Status -->
                    <div class="pt-2 border-t border-slate-700/50">
                        <div class="flex items-center justify-between text-[10px]">
                            <span class="text-white/60">Model Status</span>
                            <span class="flex items-center gap-1"
                                  [class.text-green-400]="ttsService.modelState() === 'ready'"
                                  [class.text-yellow-400]="ttsService.modelState() === 'loading'"
                                  [class.text-red-400]="ttsService.modelState() === 'error'"
                                  [class.text-white/50]="ttsService.modelState() === 'idle'">
                                <i class="pi text-[8px]"
                                   [class.pi-check-circle]="ttsService.modelState() === 'ready'"
                                   [class.pi-spin]="ttsService.modelState() === 'loading'"
                                   [class.pi-spinner]="ttsService.modelState() === 'loading'"
                                   [class.pi-times-circle]="ttsService.modelState() === 'error'"
                                   [class.pi-circle]="ttsService.modelState() === 'idle'"></i>
                                {{ statusLabel() }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        }

        <!-- Backdrop to close -->
        @if (isOpen) {
            <div (click)="togglePopup()" class="fixed inset-0 z-40"></div>
        }
    </div>
  `,
    styles: [`
        :host { display: contents; }
    `]
})
export class TtsSettingsPopupComponent {
    ttsService = inject(TtsService);

    isOpen = false;
    voices = TTS_VOICES;

    togglePopup() {
        this.isOpen = !this.isOpen;
    }

    selectVoice(voice: TtsVoice) {
        this.ttsService.setVoice(voice);
    }

    statusLabel = computed(() => {
        switch (this.ttsService.modelState()) {
            case 'ready': return 'Ready';
            case 'loading': return `${this.ttsService.loadProgress()}%`;
            case 'error': return 'Error';
            default: return 'Not Loaded';
        }
    });
}
