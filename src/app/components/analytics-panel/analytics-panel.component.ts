// src/app/components/analytics-panel/analytics-panel.component.ts
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    BarChart3,
    FileText,
    LucideAngularModule,
    Search,
    Settings,
    Sparkles,
    X,
} from 'lucide-angular';

import { getPrettyTextApi } from '../../api/pretty-text-api';
import { FlowScoreComponent } from './flow-score/flow-score.component';
import { MeterAnalysisComponent } from './meter-analysis/meter-analysis.component';
import {
    AnalyticsHighlightRange,
    TextAnalytics,
    WritingLensId,
    WritingLensItem,
    buildWritingWorkbench,
} from '../../lib/analytics';
import { createKeywordFocusSpans, parseSearchHighlightTerms } from '../../lib/Scanner/keyword-focus';
import {
    AnalyticsHighlightKind,
    AnalyticsHighlightPaletteKey,
    SentenceVariationBucket,
} from '../../lib/Scanner/types';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { analyticsHighlightStore, type AnalyticsHighlightSelection } from '../../lib/store/analyticsHighlightStore';
import { keywordHighlightStore } from '../../lib/store/keywordHighlightStore';
import { getSetting, setSetting } from '../../lib/dexie/settings.service';
import { FooterStatsService } from '../../services/footer-stats.service';
import { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';
import { NotesService } from '../../lib/dexie/notes.service';
import type { PhoenixLineSearchHit } from '../../lib/search/phoenix-line-search';

interface AnalyticsSearchResult {
    id: string;
    score: number;
    title: string;
    localMatchCount?: number;
    sourceLabel?: string;
    routeLabel?: string;
}

const ANALYTICS_VIEW_STORAGE_KEY = 'analytics-panel:active-view';
const ANALYTICS_PANEL_MODE_STORAGE_KEY = 'analytics-panel:mode';
const ANALYTICS_RETRIEVAL_MODE_STORAGE_KEY = 'analytics-panel:retrieval-mode';
const ANALYTICS_SEMANTIC_MODEL_STORAGE_KEY = 'analytics-panel:semantic-model';
type AnalyticsPanelMode = 'prose' | 'meter';
type RetrievalMode = 'bm25' | 'semantic';
type SemanticRetrievalModel = 'bge-small-rust' | 'jina-v5-nano-retrieval';

@Component({
    selector: 'app-analytics-panel',
    standalone: true,
    imports: [CommonModule, LucideAngularModule, FlowScoreComponent, MeterAnalysisComponent],
    templateUrl: './analytics-panel.component.html',
    styleUrls: ['./analytics-panel.component.css'],
})
export class AnalyticsPanelComponent {
    private destroyRef = inject(DestroyRef);
    private phoenixUiApi = inject(PhoenixUiApiService);
    private notesService = inject(NotesService);
    private noteStore = inject(NoteEditorStore);
    private footerStatsService = inject(FooterStatsService);
    private prettyTextApi = getPrettyTextApi();
    private noteTitleMap = new Map<string, string>();

    readonly FileText = FileText;
    readonly Sparkles = Sparkles;
    readonly Settings = Settings;
    readonly X = X;
    readonly Search = Search;
    readonly BarChart3 = BarChart3;

    searchInput = signal('');
    searchQuery = signal('');
    isSearching = signal(false);
    searchResults = signal<AnalyticsSearchResult[]>([]);
    retrievalMode = signal<RetrievalMode>(
        getSetting<RetrievalMode>(ANALYTICS_RETRIEVAL_MODE_STORAGE_KEY, 'bm25'),
    );
    semanticModel = signal<SemanticRetrievalModel>(
        normalizeSemanticModel(getSetting<string>(ANALYTICS_SEMANTIC_MODEL_STORAGE_KEY, 'jina-v5-nano-retrieval')),
    );
    isRetrievalSettingsOpen = signal(false);

    activeAnalyticsView = signal<WritingLensId>(
        normalizeWritingLens(getSetting<string>(ANALYTICS_VIEW_STORAGE_KEY, 'keyword')),
    );
    activePanelMode = signal<AnalyticsPanelMode>(
        getSetting<AnalyticsPanelMode>(ANALYTICS_PANEL_MODE_STORAGE_KEY, 'prose'),
    );
    activeHighlightId = signal<string | null>(null);
    isKeywordsExpanded = signal(false);
    keywordSelectionVersion = signal(0);
    activeVariationBuckets = signal<Set<SentenceVariationBucket>>(new Set());

    analytics = computed<TextAnalytics>(() => this.footerStatsService.analytics());
    currentPlainText = computed(() => this.footerStatsService.plainText());
    activeNoteId = computed(() => this.noteStore.activeNoteId());
    hasContent = computed(() => this.analytics().wordCount > 0);
    hasActiveSearchHighlight = computed(() => this.searchQuery().trim().length > 0);
    retrievalModeLabel = computed(() => this.retrievalMode() === 'semantic' ? 'Embeddings' : 'BM25');
    retrievalPlaceholder = computed(() => (
        this.retrievalMode() === 'semantic'
            ? 'Search by meaning...'
            : 'Search notes...'
    ));
    retrievalRouteLabel = computed(() => (
        this.retrievalMode() === 'semantic'
            ? `Phoenix semantic ANN · ${this.semanticModelLabel()}`
            : 'BM25 line search'
    ));

    writingWorkbench = computed(() => buildWritingWorkbench(this.currentPlainText(), this.analytics()));
    lensSummaries = computed(() => this.writingWorkbench().summaries);
    overviewChips = computed(() => this.writingWorkbench().overview);
    activeLensSummary = computed(() => (
        this.lensSummaries().find(lens => lens.id === this.activeAnalyticsView()) ?? this.lensSummaries()[0]
    ));
    activeLensItems = computed(() => this.writingWorkbench().itemsByLens[this.activeAnalyticsView()] ?? []);
    displayedLensItems = computed(() => {
        const items = this.activeLensItems();
        const compactLimit = this.activeAnalyticsView() === 'keyword' ? 8 : 12;
        const limit = this.isKeywordsExpanded() ? 40 : compactLimit;
        return items.slice(0, limit);
    });
    hiddenLensItemCount = computed(() => Math.max(0, this.activeLensItems().length - this.displayedLensItems().length));

    filteredKeywords = computed(() => this.analytics().keywordDensity || []);
    displayedKeywords = computed(() => (
        this.isKeywordsExpanded() ? this.filteredKeywords() : this.filteredKeywords().slice(0, 5)
    ));
    selectedKeywords = computed(() => {
        this.keywordSelectionVersion();
        return new Set(keywordHighlightStore.getKeywordsForNote(this.noteStore.activeNoteId()));
    });
    hasActiveAnalyticsHighlights = computed(() => (
        !!this.activeHighlightId() || this.activeVariationBuckets().size > 0
    ));

    constructor() {
        this.restoreAnalyticsPanelState(this.noteStore.activeNoteId());

        this.notesService.getAllNotes$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(notes => {
                this.noteTitleMap.clear();
                notes.forEach(note => this.noteTitleMap.set(note.id, note.title || 'Untitled'));
            });

        this.noteStore.activeNote$
            .pipe(
                distinctUntilChanged((left, right) => left?.id === right?.id),
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

    updateSearchInput(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        this.searchInput.set(target?.value ?? '');
    }

    async performSearch(query: string): Promise<void> {
        this.searchQuery.set(query);
        if (!query.trim()) {
            this.searchResults.set([]);
            this.prettyTextApi.clearSearchHighlights();
            return;
        }

        this.prettyTextApi.setSearchHighlightTerms(parseSearchHighlightTerms(query));
        this.isSearching.set(true);
        const openNoteResult = this.buildOpenNoteMatchResult(query);
        let mapped: AnalyticsSearchResult[] = [];

        try {
            mapped = await this.runRetrievalSearch(query);
        } catch (err) {
            console.error('[AnalyticsPanel] Search failed:', err);
        } finally {
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

    setRetrievalMode(mode: RetrievalMode): void {
        this.retrievalMode.set(mode);
        setSetting(ANALYTICS_RETRIEVAL_MODE_STORAGE_KEY, mode);
        if (this.searchQuery().trim()) {
            void this.performSearch(this.searchQuery());
        }
    }

    toggleRetrievalSettings(): void {
        this.isRetrievalSettingsOpen.update(open => !open);
    }

    setSemanticModel(model: SemanticRetrievalModel): void {
        this.semanticModel.set(model);
        setSetting(ANALYTICS_SEMANTIC_MODEL_STORAGE_KEY, model);
        if (this.searchQuery().trim() && this.retrievalMode() === 'semantic') {
            void this.performSearch(this.searchQuery());
        }
    }

    semanticModelLabel(): string {
        return this.semanticModel() === 'jina-v5-nano-retrieval'
            ? 'Jina v5 Nano 768d'
            : 'BGE Small Rust 384d';
    }

    openNoteResult(noteId: string): void {
        this.noteStore.openNote(noteId);
    }

    isKeywordChecked(keyword: string): boolean {
        return this.selectedKeywords().has(keyword);
    }

    toggleKeywordHighlight(keyword: string): void {
        const noteId = this.noteStore.activeNoteId();
        if (!noteId) return;
        keywordHighlightStore.toggleKeyword(noteId, keyword);
    }

    setActiveView(view: WritingLensId): void {
        this.activeAnalyticsView.set(view);
        setSetting(ANALYTICS_VIEW_STORAGE_KEY, view);
        this.prettyTextApi.clearAnalyticsDetailHighlights();
        this.activeHighlightId.set(null);
    }

    setActivePanelMode(mode: AnalyticsPanelMode): void {
        this.activePanelMode.set(mode);
        setSetting(ANALYTICS_PANEL_MODE_STORAGE_KEY, mode);
        this.clearActiveHighlight();
    }

    clearActiveHighlight(): void {
        this.prettyTextApi.clearAnalyticsHighlights();
        this.activeHighlightId.set(null);
        this.activeVariationBuckets.set(new Set());
    }

    toggleWritingLensItem(item: WritingLensItem): void {
        if (item.lensId === 'keyword') {
            this.toggleKeywordHighlight(item.label);
            return;
        }
        this.toggleAnalyticsHighlight(item.id, item.highlightKind, item.label, item.ranges, item.paletteKey);
    }

    isWritingLensItemActive(item: WritingLensItem): boolean {
        if (item.lensId === 'keyword') {
            return this.isKeywordChecked(item.label);
        }
        return this.activeHighlightId() === item.id;
    }

    toggleAnalyticsHighlight(
        id: string,
        kind: AnalyticsHighlightKind,
        label: string,
        ranges: AnalyticsHighlightRange[] | null | undefined,
        paletteKey?: AnalyticsHighlightPaletteKey,
    ): void {
        const noteId = this.noteStore.activeNoteId();
        if (!noteId || !ranges?.length) return;

        const enrichedRanges = this.enrichAnalyticsHighlightRanges(ranges);
        if (enrichedRanges.length === 0) return;

        this.prettyTextApi.toggleAnalyticsHighlights(noteId, id, kind, label, enrichedRanges, paletteKey);
        this.activeHighlightId.set(this.activeHighlightId() === id ? null : id);
    }

    toggleSentenceVariationHighlight(bucket: SentenceVariationBucket, _label?: string): void {
        if (!this.hasSentenceVariationBucket(bucket)) return;

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

    formatTime(minutes: number, seconds: number): string {
        if (minutes === 0 && seconds === 0) return '< 1 sec';
        if (minutes === 0) return `${seconds} sec`;
        if (seconds === 0) return `${minutes} min`;
        return `${minutes} min ${seconds} sec`;
    }

    private buildOpenNoteMatchResult(query: string): AnalyticsSearchResult | null {
        const noteId = this.noteStore.activeNoteId();
        const currentNote = typeof this.noteStore.currentNote === 'function'
            ? this.noteStore.currentNote()
            : undefined;
        const text = [this.currentPlainText(), currentNote?.markdownContent || '']
            .find(candidate => candidate.trim().length > 0) || '';

        if (!noteId || !text.trim()) return null;

        const terms = parseSearchHighlightTerms(query);
        if (terms.length === 0) return null;

        const matches = createKeywordFocusSpans([{ pmPos: 0, concatStart: 0, length: text.length, text }], terms);
        if (matches.length === 0) return null;

        return {
            id: noteId,
            score: matches.length,
            title: currentNote?.title || this.noteTitleMap.get(noteId) || 'Open Note',
            localMatchCount: matches.length,
            sourceLabel: 'Open note',
            routeLabel: 'live editor',
        };
    }

    private async runRetrievalSearch(query: string): Promise<AnalyticsSearchResult[]> {
        if (this.retrievalMode() === 'semantic') {
            const response = await this.phoenixUiApi.semanticSearch(query, 10);
            return this.mapPhoenixSearchResults(response, 'Embeddings', `semantic ANN · ${this.semanticModelLabel()}`);
        }
        const hits = await this.phoenixUiApi.lineSearch(query, 32);
        return this.mapLineSearchResults(hits).slice(0, 10);
    }

    private mapPhoenixSearchResults(
        rawResults: any[],
        sourceLabel: string,
        routeLabel: string,
    ): AnalyticsSearchResult[] {
        return (Array.isArray(rawResults) ? rawResults : [])
            .map(result => {
                const id = result.DocID || result.docID || result.id;
                return {
                    id,
                    score: result.Score || result.score || 0,
                    title: this.noteTitleMap.get(id) || result.title || 'Unknown Note',
                    sourceLabel,
                    routeLabel,
                };
            })
            .filter(result => !!result.id)
            .sort((left, right) => right.score - left.score);
    }

    private mapLineSearchResults(hits: PhoenixLineSearchHit[]): AnalyticsSearchResult[] {
        const byNote = new Map<string, AnalyticsSearchResult>();
        for (const hit of hits) {
            const current = byNote.get(hit.noteId);
            if (current) {
                current.score += hit.score;
                current.localMatchCount = (current.localMatchCount || 0) + Math.max(1, hit.matches.length);
                continue;
            }
            byNote.set(hit.noteId, {
                id: hit.noteId,
                score: hit.score,
                title: hit.title || this.noteTitleMap.get(hit.noteId) || 'Unknown Note',
                localMatchCount: Math.max(1, hit.matches.length),
                sourceLabel: 'BM25',
                routeLabel: 'line search',
            });
        }
        return Array.from(byNote.values()).sort((left, right) => right.score - left.score);
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
            case '1': return '1 word';
            case '2-6': return '2-6 words';
            case '7-15': return '7-15 words';
            case '16-25': return '16-25 words';
            case '26-39': return '26-39 words';
            case '40+': return '40+ words';
        }
    }

    private restoreAnalyticsPanelState(noteId: string | null | undefined): void {
        this.activeVariationBuckets.set(analyticsHighlightStore.getActiveVariationBuckets(noteId ?? null));
    }
}

function normalizeSemanticModel(value: string | null | undefined): SemanticRetrievalModel {
    return value === 'bge-small-rust' ? 'bge-small-rust' : 'jina-v5-nano-retrieval';
}

function normalizeWritingLens(value: string): WritingLensId {
    switch (value) {
        case 'keyword':
        case 'repetition':
        case 'proximity':
        case 'cadence':
        case 'negation':
        case 'ornament':
        case 'distance':
        case 'diction':
            return value;
        default:
            return 'keyword';
    }
}
