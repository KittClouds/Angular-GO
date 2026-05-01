import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlueprintHubService } from '../blueprint-hub.service';
import { FooterStatsService } from '../../../services/footer-stats.service';
import { TtsService } from '../../../services/tts.service';
import { ScopeService } from '../../../lib/services/scope.service';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { ThemeService } from '../../../lib/services/theme.service';
import { EditorService } from '../../../services/editor.service';
import { TtsSettingsPopupComponent } from './tts-settings-popup.component';
import { NgxGradientTextComponent } from '@omnedia/ngx-gradient-text';
import {
    graphGalaxyRuntimeMeter,
    type GraphGalaxyRuntimeSnapshot,
} from '../tabs/graph-tab/graph-atlas-preview/graph-galaxy-runtime-meter';

type GradientColorStage = {
    below: number;
    color: string;
};

type GradientThemeConfig = {
    start: GradientColorStage[];
    end: GradientColorStage[];
};

type BacklinkTab = 'tagged' | 'matched' | 'evidence' | 'suggested';

@Component({
    selector: 'app-hub-footer',
    standalone: true,
    imports: [CommonModule, TtsSettingsPopupComponent, NgxGradientTextComponent],
    templateUrl: './hub-footer.component.html',
    styleUrl: './hub-footer.component.css'
})
export class HubFooterComponent implements OnInit, OnDestroy {
    hubService = inject(BlueprintHubService);
    statsService = inject(FooterStatsService);
    ttsService = inject(TtsService);
    scopeService = inject(ScopeService);
    themeService = inject(ThemeService);
    private editorService = inject(EditorService);
    private noteStore = inject(NoteEditorStore);
    private hostElement = inject(ElementRef<HTMLElement>);

    readonly isBacklinkPopoverOpen = signal(false);
    readonly activeBacklinkTab = signal<BacklinkTab>('tagged');
    readonly graphMeter = signal<GraphGalaxyRuntimeSnapshot>(graphGalaxyRuntimeMeter.snapshot());
    readonly backlinkBreakdown = computed(() => this.statsService.backlinkBreakdown());
    readonly visibleBacklinkRows = computed(() => {
        const tab = this.activeBacklinkTab();
        const rows = this.statsService.backlinkRows();
        if (tab === 'tagged') {
            return rows.filter((row) => row.method === 'manual_tag');
        }
        if (tab === 'matched') {
            return rows.filter((row) => row.method === 'dictionary_match');
        }
        if (tab === 'evidence') {
            return rows.filter((row) => row.method === 'machine_evidence');
        }
        return rows.filter((row) => row.method === 'machine_suggestion');
    });

    // ========================================================================
    // Note Length Health Gradient
    // ========================================================================
    // Standard note limit: 50k characters
    // Green (healthy) -> Yellow (warning) -> Red (danger)

    private readonly CHAR_LIMIT = 50000;
    private readonly WORD_LIMIT = 7500;
    private readonly WORD_HEALTHY_MAX = 3000;
    private readonly WORD_WARNING_MAX = 4500;
    private readonly WORD_DANGER_MAX = 6000;

    private readonly charDarkGradient: GradientThemeConfig = {
        start: [
            { below: 0.5, color: '#32CD32' },
            { below: 0.8, color: '#9ACD32' },
            { below: Number.POSITIVE_INFINITY, color: '#FFA500' },
        ],
        end: [
            { below: 0.3, color: '#00FF7F' },
            { below: 0.5, color: '#7CFC00' },
            { below: 0.7, color: '#ADFF2F' },
            { below: 0.85, color: '#FFD700' },
            { below: 1.0, color: '#FF6347' },
            { below: Number.POSITIVE_INFINITY, color: '#FF0000' },
        ],
    };

    private readonly charLightGradient: GradientThemeConfig = {
        start: [
            { below: 0.5, color: '#16a34a' },
            { below: 0.8, color: '#ca8a04' },
            { below: Number.POSITIVE_INFINITY, color: '#ea580c' },
        ],
        end: [
            { below: 0.3, color: '#15803d' },
            { below: 0.5, color: '#16a34a' },
            { below: 0.7, color: '#65a30d' },
            { below: 0.85, color: '#d97706' },
            { below: 1.0, color: '#dc2626' },
            { below: Number.POSITIVE_INFINITY, color: '#b91c1c' },
        ],
    };

    private readonly wordDarkGradient: GradientThemeConfig = {
        start: [
            { below: this.WORD_HEALTHY_MAX, color: '#32CD32' },
            { below: this.WORD_WARNING_MAX, color: '#9ACD32' },
            { below: this.WORD_DANGER_MAX, color: '#FFA500' },
            { below: this.WORD_LIMIT, color: '#FFA500' },
            { below: Number.POSITIVE_INFINITY, color: '#FF4500' },
        ],
        end: [
            { below: this.WORD_HEALTHY_MAX, color: '#00FF7F' },
            { below: this.WORD_WARNING_MAX, color: '#ADFF2F' },
            { below: this.WORD_DANGER_MAX, color: '#FFD700' },
            { below: this.WORD_LIMIT, color: '#FF6347' },
            { below: Number.POSITIVE_INFINITY, color: '#FF0000' },
        ],
    };

    private readonly wordLightGradient: GradientThemeConfig = {
        start: [
            { below: this.WORD_HEALTHY_MAX, color: '#16a34a' },
            { below: this.WORD_WARNING_MAX, color: '#65a30d' },
            { below: this.WORD_DANGER_MAX, color: '#ca8a04' },
            { below: this.WORD_LIMIT, color: '#ea580c' },
            { below: Number.POSITIVE_INFINITY, color: '#b91c1c' },
        ],
        end: [
            { below: this.WORD_HEALTHY_MAX, color: '#15803d' },
            { below: this.WORD_WARNING_MAX, color: '#65a30d' },
            { below: this.WORD_DANGER_MAX, color: '#d97706' },
            { below: this.WORD_LIMIT, color: '#dc2626' },
            { below: Number.POSITIVE_INFINITY, color: '#b91c1c' },
        ],
    };

    /** Text to display: "5756 chars" */
    charCountText = computed(() => `${this.statsService.charCount()} chars`);
    wordCountText = computed(() => `${this.statsService.wordCount()} words`);

    /** Health ratio: 0 (empty) to 1+ (at/over limit) */
    charHealthRatio = computed(() => {
        const count = this.statsService.charCount();
        return Math.min(count / this.CHAR_LIMIT, 1.5); // Cap at 1.5 for extra red
    });

    wordHealthRatio = computed(() => {
        const count = this.statsService.wordCount();
        return Math.min(count / this.WORD_LIMIT, 1.5);
    });

    /** Gradient start color */
    charGradientStart = computed(() => {
        return this.resolveGradientColors(
            this.charHealthRatio(),
            this.charDarkGradient,
            this.charLightGradient,
        ).start;
    });

    /** Gradient end color */
    charGradientEnd = computed(() => {
        return this.resolveGradientColors(
            this.charHealthRatio(),
            this.charDarkGradient,
            this.charLightGradient,
        ).end;
    });

    wordGradientStart = computed(() => {
        return this.resolveGradientColors(
            this.statsService.wordCount(),
            this.wordDarkGradient,
            this.wordLightGradient,
        ).start;
    });

    wordGradientEnd = computed(() => {
        return this.resolveGradientColors(
            this.statsService.wordCount(),
            this.wordDarkGradient,
            this.wordLightGradient,
        ).end;
    });

    private graphMeterTimer: ReturnType<typeof setInterval> | null = null;

    ngOnInit(): void {
        this.refreshGraphMeter();
        this.graphMeterTimer = setInterval(() => this.refreshGraphMeter(), 1000);
    }

    ngOnDestroy(): void {
        if (this.graphMeterTimer) {
            clearInterval(this.graphMeterTimer);
            this.graphMeterTimer = null;
        }
    }

    graphMeterTitle(): string {
        const snapshot = this.graphMeter();
        const mb = (snapshot.backingPixels * 4 / 1024 / 1024).toFixed(1);
        return [
            `Graph canvases: ${snapshot.activeCanvases}`,
            `Active surfaces: ${snapshot.activeSurfaces}`,
            `GPU: ${snapshot.webglContexts > 0 ? 'on' : 'off'} (${snapshot.webglContexts} WebGL context${snapshot.webglContexts === 1 ? '' : 's'})`,
            `RAF: ${snapshot.rafActive} active / ${snapshot.rafSleeping} sleeping`,
            `Compiler: ${snapshot.compilerSource}`,
            `Scene: ${snapshot.nodes} nodes / ${snapshot.links} links`,
            `Canvas backing: ${mb} MB`,
        ].join('\n');
    }

    onPlayClick(): void {
        const state = this.ttsService.modelState();
        if (state !== 'ready') {
            this.ttsService.loadModel();
            return;
        }

        if (this.ttsService.isPlaying()) {
            if (this.ttsService.isPaused()) {
                this.ttsService.resume();
            }
            return;
        }

        const noteId = this.noteStore.activeNoteId();
        if (!noteId) {
            console.warn('[HubFooter] No note open to read.');
            return;
        }

        const snapshot = this.editorService.captureSnapshot('api');
        const note = this.noteStore.currentNote();
        const content = snapshot?.markdown ?? note?.markdownContent;
        if (!content || content.trim().length === 0) {
            console.warn('[HubFooter] Note has no content.');
            return;
        }

        // Strip markdown syntax for cleaner speech
        const cleanText = this.stripMarkdown(content);
        this.ttsService.speak(cleanText);
    }

    onPauseClick(): void {
        if (this.ttsService.isPlaying() && !this.ttsService.isPaused()) {
            this.ttsService.pause();
        } else if (this.ttsService.isPaused()) {
            this.ttsService.resume();
        }
    }

    onStopClick(): void {
        this.ttsService.stop();
    }

    private stripMarkdown(text: string): string {
        return text
            // Remove code blocks first (before other processing)
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`([^`]+)`/g, '$1')
            // Remove HTML tags
            .replace(/<[^>]+>/g, '')
            // Remove images
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
            // Remove links but keep text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // Remove entity syntax
            .replace(/\[([A-Z]+)\|([^\]]+)\]/g, '$2')
            .replace(/\[\[([^\]]+)\]\]/g, '$1')
            // Remove headers
            .replace(/^#{1,6}\s+/gm, '')
            // Remove blockquotes
            .replace(/^>\s*/gm, '')
            // Remove list markers (bullets and numbers)
            .replace(/^[\s]*[-*+]\s+/gm, '')
            .replace(/^[\s]*\d+\.\s+/gm, '')
            // Remove bold/italic markers
            .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
            // Remove strikethrough
            .replace(/~~([^~]+)~~/g, '$1')
            // Remove horizontal rules
            .replace(/^[-*_]{3,}\s*$/gm, '')
            // Remove table formatting
            .replace(/\|/g, ' ')
            .replace(/^[\s]*[-:]+[\s]*$/gm, '')
            // Normalize whitespace
            .replace(/\n{2,}/g, '. ')
            .replace(/\n/g, ' ')
            .replace(/\s{2,}/g, ' ')
            // Clean up punctuation
            .replace(/\.{2,}/g, '.')
            .replace(/\s+([.,!?])/g, '$1')
            .trim();
    }

    private resolveGradientColors(
        value: number,
        darkGradient: GradientThemeConfig,
        lightGradient: GradientThemeConfig,
    ): { start: string; end: string } {
        const themeGradient = this.themeService.isDark() ? darkGradient : lightGradient;
        return {
            start: this.resolveGradientColor(value, themeGradient.start),
            end: this.resolveGradientColor(value, themeGradient.end),
        };
    }

    private resolveGradientColor(value: number, stages: GradientColorStage[]): string {
        return stages.find(stage => value < stage.below)?.color ?? stages[stages.length - 1].color;
    }

    private refreshGraphMeter(): void {
        this.graphMeter.set(graphGalaxyRuntimeMeter.snapshot());
    }

    toggleBacklinkPopover(event: MouseEvent): void {
        event.stopPropagation();
        const next = !this.isBacklinkPopoverOpen();
        this.isBacklinkPopoverOpen.set(next);
        if (next && this.visibleBacklinkRows().length === 0) {
            const breakdown = this.backlinkBreakdown();
            this.activeBacklinkTab.set(
                breakdown.tagged > 0 ? 'tagged' : breakdown.matched > 0 ? 'matched' : 'tagged',
            );
        }
    }

    setBacklinkTab(tab: BacklinkTab): void {
        this.activeBacklinkTab.set(tab);
    }

    openBacklinkSource(noteId?: string): void {
        if (!noteId) {
            return;
        }
        this.isBacklinkPopoverOpen.set(false);
        void this.noteStore.openNote(noteId);
    }

    @HostListener('document:click', ['$event'])
    handleDocumentClick(event: MouseEvent): void {
        if (!this.isBacklinkPopoverOpen()) {
            return;
        }
        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }
        if (this.hostElement.nativeElement.contains(target)) {
            return;
        }
        this.isBacklinkPopoverOpen.set(false);
    }
}
