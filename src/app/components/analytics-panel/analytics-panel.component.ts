// src/app/components/analytics-panel/analytics-panel.component.ts
import { Component, DestroyRef, inject, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { LucideAngularModule, FileText, Clock, MessageSquare, BookOpen, TrendingUp, Hash, ChevronDown, ChevronUp, Sparkles, Target, X } from 'lucide-angular';
import { NgxNumberTickerComponent } from '@omnedia/ngx-number-ticker';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged } from 'rxjs';

import { getPrettyTextApi } from '../../api/pretty-text-api';
import { FlowScoreComponent } from './flow-score/flow-score.component';
import { AnalyticsHighlightRange, TextAnalytics } from '../../lib/analytics';
import { createKeywordFocusSpans, parseSearchHighlightTerms } from '../../lib/Scanner/keyword-focus';
import { AnalyticsHighlightKind, AnalyticsHighlightPaletteKey, SentenceVariationBucket } from '../../lib/Scanner/types';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { analyticsHighlightStore, type AnalyticsHighlightSelection } from '../../lib/store/analyticsHighlightStore';
import { keywordHighlightStore } from '../../lib/store/keywordHighlightStore';
import { getSetting, setSetting } from '../../lib/dexie/settings.service';
import { FooterStatsService } from '../../services/footer-stats.service';
import { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';
import { NotesService } from '../../lib/dexie/notes.service';

interface AnalyticsSearchResult {
    id: string;
    score: number;
    title: string;
    localMatchCount?: number;
}

const ANALYTICS_VIEW_STORAGE_KEY = 'analytics-panel:active-view';

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
            <!-- Search Section -->
            <section class="analytics-section">
                <div class="section-header">
                    <div class="flex items-center gap-2">
                        <lucide-icon [img]="Sparkles" class="h-4 w-4 text-primary"></lucide-icon>
                        <span>Semantic Search</span>
                    </div>
                    <button
                        class="ml-auto p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors"
                        (click)="openEval()"
                        title="Open RAPTOR Evaluation Harness"
                    >
                        <lucide-icon [img]="Target" class="h-3 w-3"></lucide-icon>
                    </button>
                </div>
                <div class="search-box">
                    <input
                        type="text"
                        class="search-input"
                        placeholder="Search notes..."
                        [value]="searchInput()"
                        (input)="updateSearchInput($event)"
                        (keyup.enter)="performSearch(searchInput())"
                    />
                    <button class="search-btn" (click)="performSearch(searchInput())" title="Search analytics">
                        <lucide-icon [img]="Sparkles" class="h-3 w-3"></lucide-icon>
                    </button>
                    <button
                        class="search-btn search-clear-btn"
                        [disabled]="!hasActiveSearchHighlight()"
                        (click)="clearSearchHighlight()"
                        title="Clear search highlight"
                    >
                        <lucide-icon [img]="X" class="h-3 w-3"></lucide-icon>
                    </button>
                </div>

                @if (isSearching()) {
                    <div class="text-xs text-muted-foreground animate-pulse px-2">Searching...</div>
                }

                @if (searchResults().length > 0) {
                    <div class="search-results">
                        @for (res of searchResults(); track res.id) {
                            <div class="search-result-item" (click)="openNoteResult(res.id)">
                                <span class="result-title">{{ res.title }}</span>
                                @if (res.localMatchCount) {
                                    <span class="result-score">{{ res.localMatchCount }} match{{ res.localMatchCount === 1 ? '' : 'es' }}</span>
                                } @else {
                                    <span class="result-score">{{ res.score | number:'1.2-2' }}</span>
                                }
                            </div>
                        }
                    </div>
                } @else if (searchQuery() && !isSearching()) {
                     <div class="text-xs text-muted-foreground px-2">No results found.</div>
                }
            </section>

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
                        [sentences]="analytics().cadence.sentences"
                        [activeVariationBuckets]="activeVariationBuckets()"
                        (variationToggle)="toggleSentenceVariationHighlight($event.bucket, $event.label)"
                    />
                </section>

                <!-- Text Analytics Detail -->
                <section class="analytics-section">
                    <div class="section-header flex items-center justify-between w-full">
                        <div class="flex items-center gap-2">
                            <lucide-icon [img]="Hash" class="h-4 w-4 text-primary"></lucide-icon>
                            <span class="capitalize">{{ activeAnalyticsView() }}</span>
                        </div>
                        @if (hasActiveAnalyticsHighlights()) {
                            <button class="text-[0.65rem] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 bg-white/5 hover:bg-white/10 px-1.5 py-0.5 rounded border border-white/5" (click)="clearActiveHighlight()" title="Clear Highlight">
                                <lucide-icon [img]="X" class="h-3 w-3"></lucide-icon> Clear
                            </button>
                        }
                    </div>

                    <!-- View Selector buttons -->
                    <div class="keyword-filters">
                        <button class="filter-btn" [class.active]="activeAnalyticsView() === 'keyword'" (click)="setActiveView('keyword')">Keyword</button>
                        <button class="filter-btn" [class.active]="activeAnalyticsView() === 'repetition'" (click)="setActiveView('repetition')">Rep.</button>
                        <button class="filter-btn" [class.active]="activeAnalyticsView() === 'proximity'" (click)="setActiveView('proximity')">Prox.</button>
                        <button class="filter-btn" [class.active]="activeAnalyticsView() === 'cadence'" (click)="setActiveView('cadence')">Cadence</button>
                    </div>

                    <!-- Sub-view content -->
                    <div class="keyword-list">
                        @if (activeAnalyticsView() === 'keyword') {
                            @if (filteredKeywords().length === 0) {
                                <p class="text-xs text-muted-foreground italic py-2">
                                    No keywords found.
                                </p>
                            } @else {
                                @for (item of displayedKeywords(); track item.word; let i = $index) {
                                    <div class="keyword-row" [class.top-keyword]="i < 3">
                                        <label class="keyword-label-group">
                                            <input
                                                type="checkbox"
                                                class="keyword-checkbox"
                                                [checked]="isKeywordChecked(item.word)"
                                                (change)="toggleKeywordHighlight(item.word)"
                                            />
                                            <span class="keyword-word">{{ item.word }}</span>
                                        </label>
                                        <span class="keyword-stats shrink-0">
                                            {{ item.count }} ({{ item.percentage }}%)
                                        </span>
                                    </div>
                                }
                                @if (filteredKeywords().length > 5) {
                                    <button class="expand-keywords-btn" (click)="isKeywordsExpanded.set(!isKeywordsExpanded())">
                                        @if (isKeywordsExpanded()) {
                                            Show less <lucide-icon [img]="ChevronUp" class="h-3 w-3 ml-1"></lucide-icon>
                                        } @else {
                                            Show {{ filteredKeywords().length - 5 }} more <lucide-icon [img]="ChevronDown" class="h-3 w-3 ml-1"></lucide-icon>
                                        }
                                    </button>
                                }
                            }
                        }

                        @if (activeAnalyticsView() === 'repetition') {
                            @if (!analytics().repetition.items.length) {
                                <p class="text-xs text-muted-foreground italic py-2">No significant repetitions found.</p>
                            } @else {
                                @for (item of analytics().repetition.items; track item.id) {
                                    <div class="keyword-row cursor-pointer hover:bg-white/5 rounded px-1 -mx-1 transition-colors group"
                                         [class.active-highlight]="activeHighlightId() === item.id"
                                         (click)="toggleAnalyticsHighlight(item.id, 'repetition', item.phrase, item.highlightRanges)">
                                        <div class="flex items-center gap-2 min-w-0">
                                            <span class="keyword-word truncate group-hover:text-foreground transition-colors" [class.text-amber-400]="item.severity === 'high'">{{ item.phrase }}</span>
                                        </div>
                                        <span class="keyword-stats shrink-0">{{ item.occurrenceCount }}x</span>
                                    </div>
                                }
                            }
                        }

                        @if (activeAnalyticsView() === 'proximity') {
                            @if (!analytics().proximity.items.length) {
                                <p class="text-xs text-muted-foreground italic py-2">No proximity warnings found.</p>
                            } @else {
                                @for (item of analytics().proximity.items; track item.id) {
                                    <div class="keyword-row cursor-pointer hover:bg-white/5 rounded px-1 -mx-1 transition-colors group flex-col items-start gap-1"
                                         [class.active-highlight]="activeHighlightId() === item.id"
                                         (click)="toggleAnalyticsHighlight(item.id, 'proximity', item.root, item.highlightRanges)">
                                        <div class="flex items-center justify-between w-full">
                                            <div class="flex items-center gap-2 min-w-0">
                                                <span class="keyword-word font-medium truncate group-hover:text-foreground transition-colors" [class.text-amber-400]="item.severity === 'high'">{{ item.root }}</span>
                                                <span class="text-[0.65rem] text-muted-foreground uppercase border border-white/10 border-solid rounded px-1 shrink-0">{{ item.partOfSpeech }}</span>
                                            </div>
                                            <span class="keyword-stats shrink-0" title="Min word distance">{{ item.minWordDistance }}d</span>
                                        </div>
                                        <div class="text-[0.7rem] text-muted-foreground truncate w-full" title="Forms: {{ item.surfaceForms.join(', ') }}">
                                            {{ item.surfaceForms.join(', ') }}
                                        </div>
                                    </div>
                                }
                            }
                        }

                        @if (activeAnalyticsView() === 'cadence') {
                            @if (!analytics().cadence.hotspots.length) {
                                <p class="text-xs text-muted-foreground italic py-2">No cadence hotspots detected.</p>
                            } @else {
                                @for (hotspot of analytics().cadence.hotspots; track hotspot.id) {
                                    <div class="keyword-row cursor-pointer hover:bg-white/5 rounded px-1 -mx-1 transition-colors group flex-col items-start gap-1"
                                         [class.active-highlight]="activeHighlightId() === hotspot.id"
                                         (click)="toggleAnalyticsHighlight(hotspot.id, 'cadence', hotspot.label, hotspot.highlightRanges)">
                                        <div class="flex items-center justify-between w-full">
                                            <span class="keyword-word font-medium truncate group-hover:text-foreground transition-colors" [class.text-amber-400]="hotspot.severity === 'high'">{{ hotspot.label }}</span>
                                            <span class="keyword-stats shrink-0 text-[0.65rem] capitalize">{{ hotspot.type }}</span>
                                        </div>
                                        <div class="text-[0.7rem] text-muted-foreground line-clamp-2 w-full leading-tight">
                                            {{ hotspot.explanation }}
                                        </div>
                                    </div>
                                }
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

        .search-box {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 0.5rem;
        }

        .search-input {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0.25rem;
            padding: 0.25rem 0.5rem;
            font-size: 0.875rem;
            color: hsl(var(--foreground));
            outline: none;
        }

        .search-input:focus {
            border-color: hsl(var(--primary));
        }

        .search-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0.25rem;
            color: hsl(var(--muted-foreground));
            cursor: pointer;
        }

        .search-btn:hover {
            color: hsl(var(--primary));
            border-color: hsl(var(--primary));
        }

        .search-btn:disabled {
            cursor: default;
            opacity: 0.45;
            color: hsl(var(--muted-foreground));
            border-color: rgba(255, 255, 255, 0.1);
        }

        .search-btn:disabled:hover {
            color: hsl(var(--muted-foreground));
            border-color: rgba(255, 255, 255, 0.1);
        }

        .search-results {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            max-height: 200px;
            overflow-y: auto;
        }

        .search-result-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.375rem 0.5rem;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 0.25rem;
            cursor: pointer;
            transition: background 0.2s;
        }

        .search-result-item:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .result-title {
            font-size: 0.8rem;
            color: hsl(var(--foreground));
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 180px;
        }

        .result-score {
            font-size: 0.7rem;
            color: hsl(var(--muted-foreground));
            font-family: monospace;
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
            gap: 0.75rem;
        }

        .keyword-label-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            min-width: 0;
            cursor: pointer;
        }

        .keyword-checkbox {
            width: 0.875rem;
            height: 0.875rem;
            accent-color: rgb(45, 212, 191);
            cursor: pointer;
            flex-shrink: 0;
        }

        .keyword-word {
            color: hsl(var(--muted-foreground));
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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

        .active-highlight {
            background: rgba(255, 255, 255, 0.1) !important;
        }
    `]
})
export class AnalyticsPanelComponent {
    private destroyRef = inject(DestroyRef);
    private phoenixUiApi = inject(PhoenixUiApiService);
    private notesService = inject(NotesService);
    private noteStore = inject(NoteEditorStore);
    private footerStatsService = inject(FooterStatsService);
    private router = inject(Router);
    private prettyTextApi = getPrettyTextApi();

    // Search State
    searchInput = signal('');
    searchQuery = signal('');
    isSearching = signal(false);
    searchResults = signal<AnalyticsSearchResult[]>([]);

    // Note Lookup Map (ID -> Title)
    private noteTitleMap = new Map<string, string>();

    // View state
    activeAnalyticsView = signal<'keyword' | 'repetition' | 'proximity' | 'cadence'>(
        getSetting<'keyword' | 'repetition' | 'proximity' | 'cadence'>(ANALYTICS_VIEW_STORAGE_KEY, 'keyword'),
    );
    activeHighlightId = signal<string | null>(null);

    // existing state
    isKeywordsExpanded = signal(false);
    keywordSelectionVersion = signal(0);
    activeVariationBuckets = signal<Set<SentenceVariationBucket>>(new Set());

    // ... Icons ...
    readonly FileText = FileText;
    readonly Clock = Clock;
    readonly MessageSquare = MessageSquare;
    readonly BookOpen = BookOpen;
    readonly TrendingUp = TrendingUp;
    readonly Hash = Hash;
    readonly ChevronDown = ChevronDown;
    readonly ChevronUp = ChevronUp;
    readonly Sparkles = Sparkles;
    readonly Target = Target;
    readonly X = X;

    constructor() {
        this.restoreAnalyticsPanelState(this.noteStore.activeNoteId());

        // Build note title map
        this.notesService.getAllNotes$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(notes => {
                this.noteTitleMap.clear();
                notes.forEach(n => this.noteTitleMap.set(n.id, n.title || 'Untitled'));
            });

        this.noteStore.activeNote$
            .pipe(
                distinctUntilChanged((a, b) => a?.id === b?.id),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe(note => {
                const noteId = note?.id ?? this.noteStore.activeNoteId();
                this.prettyTextApi.clearAnalyticsDetailHighlights();
                this.activeHighlightId.set(null);
                this.restoreAnalyticsPanelState(noteId);
            });

        const unsubscribeKeywordStore = keywordHighlightStore.subscribe(() => {
            this.keywordSelectionVersion.update(version => version + 1);
        });
        this.destroyRef.onDestroy(unsubscribeKeywordStore);

        const unsubscribeAnalyticsHighlightStore = analyticsHighlightStore.subscribe(() => {
            this.restoreAnalyticsPanelState(this.noteStore.activeNoteId());
        });
        this.destroyRef.onDestroy(unsubscribeAnalyticsHighlightStore);

        effect(() => {
            const noteId = this.noteStore.activeNoteId();
            const activeBuckets = this.activeVariationBuckets();
            const analytics = this.analytics();
            const text = this.currentPlainText();

            if (!noteId || activeBuckets.size === 0 || !text) {
                this.prettyTextApi.clearSentenceVariationHighlights(noteId ?? undefined);
                return;
            }

            this.prettyTextApi.setSentenceVariationHighlights(
                noteId,
                activeBuckets,
                this.buildSentenceVariationSelections(noteId, activeBuckets, text, analytics),
            );
        });
    }

    // Parse and analyze content
    analytics = computed<TextAnalytics>(() => this.footerStatsService.analytics());

    hasContent = computed(() => this.analytics().wordCount > 0);
    hasActiveSearchHighlight = computed(() => this.searchQuery().trim().length > 0);

    filteredKeywords = computed(() => {
        return this.analytics().keywordDensity || [];
    });

    displayedKeywords = computed(() => {
        const keywords = this.filteredKeywords();
        return this.isKeywordsExpanded() ? keywords : keywords.slice(0, 5);
    });

    currentPlainText = computed(() => this.footerStatsService.plainText());

    selectedKeywords = computed(() => {
        this.keywordSelectionVersion();
        return new Set(keywordHighlightStore.getKeywordsForNote(this.noteStore.activeNoteId()));
    });

    hasActiveAnalyticsHighlights = computed(() => (
        !!this.activeHighlightId() || this.activeVariationBuckets().size > 0
    ));

    updateSearchInput(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        this.searchInput.set(target?.value ?? '');
    }

    async performSearch(query: string) {
        this.searchQuery.set(query);
        if (!query.trim()) {
            this.searchResults.set([]);
            this.prettyTextApi.clearSearchHighlights();
            return;
        }

        this.prettyTextApi.setSearchHighlightTerms(parseSearchHighlightTerms(query));
        this.isSearching.set(true);
        const openNoteResult = this.buildOpenNoteMatchResult(query);
        let rawResults: any[] = [];

        try {
            // Search via WASM
            const response = await this.phoenixUiApi.search(query, 10);
            rawResults = Array.isArray(response) ? response : [];
        } catch (err) {
            console.error('[AnalyticsPanel] Search failed:', err);
        } finally {
            const mapped = rawResults.map(r => ({
                id: r.DocID || r.docID || r.id, // Handle Go capitalization variance
                score: r.Score || r.score || 0,
                title: this.noteTitleMap.get(r.DocID || r.docID || r.id) || 'Unknown Note'
            }));

            if (openNoteResult && !mapped.some(result => result.id === openNoteResult.id)) {
                mapped.unshift(openNoteResult);
            }

            this.searchResults.set(mapped);
            this.isSearching.set(false);
        }
    }

    clearSearchHighlight(): void {
        this.searchInput.set('');
        this.searchQuery.set('');
        this.searchResults.set([]);
        this.prettyTextApi.clearSearchHighlights();
    }

    openNoteResult(noteId: string) {
        this.noteStore.openNote(noteId);
    }

    openEval() {
        this.router.navigate(['/playground']);
    }

    isKeywordChecked(keyword: string): boolean {
        return this.selectedKeywords().has(keyword);
    }

    toggleKeywordHighlight(keyword: string): void {
        const noteId = this.noteStore.activeNoteId();
        if (!noteId) {
            return;
        }

        keywordHighlightStore.toggleKeyword(noteId, keyword);
    }

    setActiveView(view: 'keyword' | 'repetition' | 'proximity' | 'cadence') {
        this.activeAnalyticsView.set(view);
        setSetting(ANALYTICS_VIEW_STORAGE_KEY, view);
        this.prettyTextApi.clearAnalyticsDetailHighlights();
        this.activeHighlightId.set(null);
    }

    clearActiveHighlight() {
        this.prettyTextApi.clearAnalyticsHighlights();
        this.activeHighlightId.set(null);
        this.activeVariationBuckets.set(new Set());
    }

    toggleAnalyticsHighlight(
        id: string,
        kind: AnalyticsHighlightKind,
        label: string,
        ranges: AnalyticsHighlightRange[] | null | undefined,
        paletteKey?: AnalyticsHighlightPaletteKey,
    ) {
        const noteId = this.noteStore.activeNoteId();
        if (!noteId || !ranges?.length) return;

        const enrichedRanges = this.enrichAnalyticsHighlightRanges(ranges);
        if (enrichedRanges.length === 0) {
            return;
        }

        this.prettyTextApi.toggleAnalyticsHighlights(noteId, id, kind, label, enrichedRanges, paletteKey);

        if (this.activeHighlightId() === id) {
            this.activeHighlightId.set(null);
        } else {
            this.activeHighlightId.set(id);
        }
    }

    toggleSentenceVariationHighlight(bucket: SentenceVariationBucket, _label?: string): void {
        if (!this.hasSentenceVariationBucket(bucket)) {
            return;
        }

        this.activeVariationBuckets.update(current => {
            const next = new Set(current);
            if (next.has(bucket)) {
                next.delete(bucket);
            } else {
                next.add(bucket);
            }
            return next;
        });
    }

    private buildOpenNoteMatchResult(query: string): AnalyticsSearchResult | null {
        const noteId = this.noteStore.activeNoteId();
        const currentNote = typeof this.noteStore.currentNote === 'function'
            ? this.noteStore.currentNote()
            : undefined;
        const textCandidates = [
            this.currentPlainText(),
            currentNote?.markdownContent || '',
        ];
        const text = textCandidates.find(candidate => candidate.trim().length > 0) || '';

        if (!noteId || !text.trim()) {
            return null;
        }

        const terms = parseSearchHighlightTerms(query);
        if (terms.length === 0) {
            return null;
        }

        const matches = createKeywordFocusSpans([{
            pmPos: 0,
            concatStart: 0,
            length: text.length,
            text,
        }], terms);

        if (matches.length === 0) {
            return null;
        }

        return {
            id: noteId,
            score: matches.length,
            title: currentNote?.title || this.noteTitleMap.get(noteId) || 'Open Note',
            localMatchCount: matches.length,
        };
    }

    // ... formatTime ...
    formatTime(minutes: number, seconds: number): string {
        if (minutes === 0 && seconds === 0) return '< 1 sec';
        if (minutes === 0) return `${seconds} sec`;
        if (seconds === 0) return `${minutes} min`;
        return `${minutes} min ${seconds} sec`;
    }

    private buildSentenceVariationSelections(
        noteId: string,
        buckets: ReadonlySet<SentenceVariationBucket>,
        text: string,
        analytics: TextAnalytics,
    ): AnalyticsHighlightSelection[] {
        return Array.from(buckets)
            .map(bucket => ({
                noteId,
                key: `sentence-variation:${bucket}`,
                kind: 'sentence_variation' as const,
                label: this.getSentenceVariationLabel(bucket),
                paletteKey: bucket,
                ranges: analytics.cadence.sentences
                    .filter(sentence => sentence.bucket === bucket && sentence.to > sentence.from)
                    .map(sentence => ({
                        from: sentence.from,
                        to: sentence.to,
                        text: text.slice(sentence.from, sentence.to),
                    }))
                    .filter(range => range.text.length > 0),
            }))
            .filter(selection => selection.ranges.length > 0);
    }

    private hasSentenceVariationBucket(bucket: SentenceVariationBucket): boolean {
        return this.analytics().cadence.sentences.some(
            sentence => sentence.bucket === bucket && sentence.to > sentence.from,
        );
    }

    private enrichAnalyticsHighlightRanges(ranges: AnalyticsHighlightRange[]): AnalyticsHighlightRange[] {
        return ranges.filter(range => range.to > range.from && range.text.trim().length > 0);
    }

    private getSentenceVariationLabel(bucket: SentenceVariationBucket): string {
        switch (bucket) {
            case '1':
                return '1 word';
            case '2-6':
                return '2-6 words';
            case '7-15':
                return '7-15 words';
            case '16-25':
                return '16-25 words';
            case '26-39':
                return '26-39 words';
            case '40+':
                return '40+ words';
        }
    }

    private restoreAnalyticsPanelState(noteId: string | null | undefined): void {
        const normalizedNoteId = noteId ?? null;
        this.activeVariationBuckets.set(analyticsHighlightStore.getActiveVariationBuckets(normalizedNoteId));
    }

}
