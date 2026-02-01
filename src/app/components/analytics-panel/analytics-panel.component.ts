// src/app/components/analytics-panel/analytics-panel.component.ts
import { Component, inject, computed, signal, importProvidersFrom } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, FileText, Clock, MessageSquare, BookOpen, TrendingUp, Hash, ChevronDown, ChevronUp, Sparkles } from 'lucide-angular';
import { NgxNumberTickerComponent } from '@omnedia/ngx-number-ticker';

import { FlowScoreComponent } from './flow-score/flow-score.component';
import { analyzeText, parseContentToPlainText, getEmptyAnalytics, TextAnalytics } from '../../lib/analytics';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { EditorService } from '../../services/editor.service';

@Component({
    selector: 'app-analytics-panel',
    standalone: true,
    imports: [
        CommonModule,
        LucideAngularModule,
        NgxNumberTickerComponent,

        FlowScoreComponent
    ],
    template: `
        <div class="analytics-content">
            @if (!hasContent()) {
                <!-- Empty State -->
                <div class="empty-state">
                    <lucide-icon [img]="FileText" class="h-10 w-10 text-muted-foreground/50"></lucide-icon>
                    <p class="text-sm text-muted-foreground mt-2">Start writing to see analytics</p>
                </div>
            } @else {
                <!-- Document Stats -->
                <section class="analytics-section">
                    <div class="section-header">
                        <lucide-icon [img]="FileText" class="h-4 w-4 text-primary"></lucide-icon>
                        <span>Document Stats</span>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-row">
                            <span class="stat-label">Words</span>
                            <om-number-ticker 
                                [countTo]="analytics().wordCount"
                                [countDuration]="300"
                                styleClass="stat-value"
                            ></om-number-ticker>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Characters</span>
                            <om-number-ticker 
                                [countTo]="analytics().characterCount"
                                [countDuration]="300"
                                styleClass="stat-value"
                            ></om-number-ticker>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Characters (no spaces)</span>
                            <om-number-ticker 
                                [countTo]="analytics().characterCountNoSpaces"
                                [countDuration]="300"
                                styleClass="stat-value"
                            ></om-number-ticker>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Sentences</span>
                            <om-number-ticker 
                                [countTo]="analytics().sentenceCount"
                                [countDuration]="300"
                                styleClass="stat-value"
                            ></om-number-ticker>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Paragraphs</span>
                            <om-number-ticker 
                                [countTo]="analytics().paragraphCount"
                                [countDuration]="300"
                                styleClass="stat-value"
                            ></om-number-ticker>
                        </div>
                    </div>
                </section>

                <!-- Reading Metrics -->
                <section class="analytics-section">
                    <div class="section-header">
                        <lucide-icon [img]="BookOpen" class="h-4 w-4 text-primary"></lucide-icon>
                        <span>Reading Metrics</span>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-row">
                            <span class="stat-label">Reading Level</span>
                            <span class="stat-badge">{{ analytics().readingLevel }}</span>
                        </div>
                        <div class="stat-row">
                            <div class="flex items-center gap-1.5">
                                <lucide-icon [img]="Clock" class="h-3.5 w-3.5 text-muted-foreground"></lucide-icon>
                                <span class="stat-label">Reading Time</span>
                            </div>
                            <span class="stat-badge font-mono">{{ formatTime(analytics().readingTimeMinutes, analytics().readingTimeSeconds) }}</span>
                        </div>
                        <div class="stat-row">
                            <div class="flex items-center gap-1.5">
                                <lucide-icon [img]="MessageSquare" class="h-3.5 w-3.5 text-muted-foreground"></lucide-icon>
                                <span class="stat-label">Speaking Time</span>
                            </div>
                            <span class="stat-badge font-mono">{{ formatTime(analytics().speakingTimeMinutes, analytics().speakingTimeSeconds) }}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Avg. Sentence Length</span>
                            <span class="stat-badge font-mono">{{ analytics().averageSentenceLength }} words</span>
                        </div>
                    </div>
                </section>

                <!-- Flow Score -->
                <section class="analytics-section flow-section">
                    <app-flow-score
                        [score]="analytics().flowScore"
                        [distribution]="analytics().sentenceLengthDistribution"
                        [insights]="analytics().flowInsights"
                    />
                </section>

                <!-- Keyword Density -->
                <section class="analytics-section">
                    <div class="section-header">
                        <lucide-icon [img]="Hash" class="h-4 w-4 text-primary"></lucide-icon>
                        <span>Keyword Density</span>
                    </div>
                    
                    <!-- Filter buttons -->
                    <div class="keyword-filters">
                        @for (count of [1, 2, 3]; track count) {
                            <button 
                                class="filter-btn"
                                [class.active]="minCount() === count"
                                (click)="minCount.set(count)"
                            >
                                ×{{ count }}+
                            </button>
                        }
                    </div>

                    <!-- Keyword list -->
                    <div class="keyword-list">
                        @if (filteredKeywords().length === 0) {
                            <p class="text-xs text-muted-foreground italic py-2">
                                No keywords match the filter.
                            </p>
                        } @else {
                            @for (item of displayedKeywords(); track item.word; let i = $index) {
                                <div class="keyword-row" [class.top-keyword]="i < 3">
                                    <span class="keyword-word">{{ item.word }}</span>
                                    <span class="keyword-stats">
                                        {{ item.count }} ({{ item.percentage }}%)
                                    </span>
                                </div>
                            }
                            
                            @if (filteredKeywords().length > 5) {
                                <button 
                                    class="expand-keywords-btn"
                                    (click)="isKeywordsExpanded.set(!isKeywordsExpanded())"
                                >
                                    @if (isKeywordsExpanded()) {
                                        Show less
                                        <lucide-icon [img]="ChevronUp" class="h-3 w-3 ml-1"></lucide-icon>
                                    } @else {
                                        Show {{ filteredKeywords().length - 5 }} more
                                        <lucide-icon [img]="ChevronDown" class="h-3 w-3 ml-1"></lucide-icon>
                                    }
                                </button>
                            }
                        }
                    </div>
                </section>
            }
        </div>
    `,
    styles: [`
        .analytics-content {
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
        }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            text-align: center;
        }

        .analytics-section {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        .section-header {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.875rem;
            font-weight: 500;
            color: hsl(var(--foreground));
        }

        .stats-grid {
            padding-left: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }

        .stat-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.25rem 0;
        }

        .stat-label {
            font-size: 0.875rem;
            color: hsl(var(--muted-foreground));
        }

        :host ::ng-deep .stat-value {
            font-family: ui-monospace, monospace;
            font-size: 0.75rem;
            padding: 0.125rem 0.5rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 0.25rem;
            color: hsl(var(--foreground));
        }

        .stat-badge {
            font-size: 0.75rem;
            padding: 0.125rem 0.5rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 0.25rem;
            color: hsl(var(--foreground));
        }

        .flow-section {
            padding: 0.5rem 0;
            margin-top: 0.25rem;
        }

        .keyword-filters {
            display: flex;
            gap: 0.25rem;
        }

        .filter-btn {
            padding: 0.25rem 0.5rem;
            font-size: 0.75rem;
            border-radius: 0.25rem;
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: hsl(var(--muted-foreground));
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .filter-btn:hover {
            background: rgba(255, 255, 255, 0.05);
        }

        .filter-btn.active {
            background: rgba(20, 184, 166, 0.2);
            border-color: rgba(20, 184, 166, 0.5);
            color: hsl(var(--foreground));
        }

        .keyword-list {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            margin-top: 0.5rem;
        }

        .keyword-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.25rem 0;
            font-size: 0.875rem;
        }

        .keyword-word {
            color: hsl(var(--muted-foreground));
        }

        .keyword-row.top-keyword .keyword-word {
            font-weight: 500;
            color: hsl(var(--foreground));
        }

        .keyword-stats {
            font-size: 0.75rem;
            padding: 0.125rem 0.5rem;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0.25rem;
            color: hsl(var(--muted-foreground));
        }

        .expand-keywords-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 0.5rem;
            margin-top: 0.5rem;
            font-size: 0.75rem;
            color: hsl(var(--muted-foreground));
            background: transparent;
            border: none;
            cursor: pointer;
            transition: color 0.2s ease;
        }

        .expand-keywords-btn:hover {
            color: hsl(var(--foreground));
        }
    `]
})
export class AnalyticsPanelComponent {
    private noteStore = inject(NoteEditorStore);
    private editorService = inject(EditorService);

    minCount = signal(1);
    isKeywordsExpanded = signal(false);

    // Real-time content from editor (immediate updates on typing/paste)
    private liveContent = signal<string>('');

    // Icons
    readonly FileText = FileText;
    readonly Clock = Clock;
    readonly MessageSquare = MessageSquare;
    readonly BookOpen = BookOpen;
    readonly TrendingUp = TrendingUp;
    readonly Hash = Hash;
    readonly ChevronDown = ChevronDown;
    readonly ChevronUp = ChevronUp;
    readonly Sparkles = Sparkles;

    constructor() {
        // Subscribe to real-time editor content changes
        this.editorService.content$.subscribe(({ json }) => {
            // Convert JSON to string for analysis
            this.liveContent.set(JSON.stringify(json));
        });
    }

    // Prefer live content if available, fallback to saved note content
    private currentContent = computed(() => {
        const live = this.liveContent();
        if (live) return live;

        const note = this.noteStore.currentNote();
        return note?.content ?? '';
    });

    // Parse and analyze content
    analytics = computed<TextAnalytics>(() => {
        const content = this.currentContent();
        if (!content) return getEmptyAnalytics();

        const plainText = parseContentToPlainText(content);
        if (!plainText.trim()) return getEmptyAnalytics();

        return analyzeText(plainText);
    });

    hasContent = computed(() => this.analytics().wordCount > 0);

    filteredKeywords = computed(() => {
        return this.analytics().keywordDensity.filter(k => k.count >= this.minCount());
    });

    displayedKeywords = computed(() => {
        const keywords = this.filteredKeywords();
        return this.isKeywordsExpanded() ? keywords : keywords.slice(0, 5);
    });

    formatTime(minutes: number, seconds: number): string {
        if (minutes === 0 && seconds === 0) return '< 1 sec';
        if (minutes === 0) return `${seconds} sec`;
        if (seconds === 0) return `${minutes} min`;
        return `${minutes} min ${seconds} sec`;
    }
}
