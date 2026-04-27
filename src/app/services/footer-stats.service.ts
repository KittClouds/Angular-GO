// src/app/services/footer-stats.service.ts
// Live stats service for the hub footer - computes real data from Dexie and editor

import { DestroyRef, Injectable, signal, computed, inject } from '@angular/core';
import { toSignal, toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, switchMap, startWith, distinctUntilChanged, debounceTime } from 'rxjs';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from } from 'rxjs';
import { db } from '../lib/dexie/db';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { EditorService } from './editor.service';
import { analyzeText, parseContentToPlainText, TextAnalytics, getEmptyAnalytics } from '../lib/analytics';
import {
    syncLiveNoteEntityOccurrences,
} from '../lib/notes/entity-occurrence-index';
import {
    getEntitySignalRows,
    type EntitySignalBreakdown,
    type EntitySignalRow,
} from '../lib/notes/entity-occurrence-rows';

export interface FooterStats {
    backlinks: number;
    words: number;
    chars: number;
    totalNotes: number;
    totalEntities: number;
    isSaved: boolean;
}

const EMPTY_BACKLINK_BREAKDOWN: EntitySignalBreakdown = {
    tagged: 0,
    matched: 0,
    evidence: 0,
    suggested: 0,
    total: 0,
};

const EMPTY_BACKLINK_DATA: { rows: EntitySignalRow[]; breakdown: EntitySignalBreakdown } = {
    rows: [],
    breakdown: EMPTY_BACKLINK_BREAKDOWN,
};

const SIGNAL_REFRESH_BOUNDARY_MS = 650;
const SIGNAL_REFRESH_EDIT_MS = 1400;
const SIGNAL_REFRESH_PASTE_MS = 450;
const SIGNAL_REFRESH_CLEAR_MS = 250;
const SIGNAL_REFRESH_MIN_DELTA = 2;
const SIGNAL_REFRESH_PASTE_DELTA = 48;

function isSeverity(value: unknown): value is 'low' | 'medium' | 'high' {
    return value === 'low' || value === 'medium' || value === 'high';
}

function isHighlightRange(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { from?: unknown; to?: unknown; text?: unknown };
    return typeof candidate.from === 'number'
        && typeof candidate.to === 'number'
        && typeof candidate.text === 'string';
}

function isRepetitionItem(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as {
        id?: unknown;
        phrase?: unknown;
        occurrenceCount?: unknown;
        severity?: unknown;
        snippets?: unknown;
        highlightRanges?: unknown;
    };

    return typeof candidate.id === 'string'
        && typeof candidate.phrase === 'string'
        && typeof candidate.occurrenceCount === 'number'
        && isSeverity(candidate.severity)
        && Array.isArray(candidate.snippets)
        && candidate.snippets.every(snippet => typeof snippet === 'string')
        && Array.isArray(candidate.highlightRanges)
        && candidate.highlightRanges.every(isHighlightRange);
}

function isProximityItem(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as {
        id?: unknown;
        root?: unknown;
        surfaceForms?: unknown;
        partOfSpeech?: unknown;
        minWordDistance?: unknown;
        severity?: unknown;
        snippets?: unknown;
        highlightRanges?: unknown;
    };

    return typeof candidate.id === 'string'
        && typeof candidate.root === 'string'
        && Array.isArray(candidate.surfaceForms)
        && candidate.surfaceForms.every(form => typeof form === 'string')
        && typeof candidate.partOfSpeech === 'string'
        && typeof candidate.minWordDistance === 'number'
        && isSeverity(candidate.severity)
        && Array.isArray(candidate.snippets)
        && candidate.snippets.every(snippet => typeof snippet === 'string')
        && Array.isArray(candidate.highlightRanges)
        && candidate.highlightRanges.every(isHighlightRange);
}

function isCadenceSentence(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as {
        id?: unknown;
        paragraphIndex?: unknown;
        sentenceIndex?: unknown;
        from?: unknown;
        to?: unknown;
        wordCount?: unknown;
        bucket?: unknown;
        snippet?: unknown;
    };

    return typeof candidate.id === 'string'
        && typeof candidate.paragraphIndex === 'number'
        && typeof candidate.sentenceIndex === 'number'
        && typeof candidate.from === 'number'
        && typeof candidate.to === 'number'
        && typeof candidate.wordCount === 'number'
        && typeof candidate.bucket === 'string'
        && typeof candidate.snippet === 'string';
}

function isCadenceHotspot(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as {
        id?: unknown;
        type?: unknown;
        label?: unknown;
        severity?: unknown;
        explanation?: unknown;
        sentenceIds?: unknown;
        highlightRanges?: unknown;
    };

    return typeof candidate.id === 'string'
        && (candidate.type === 'monotony' || candidate.type === 'whiplash')
        && typeof candidate.label === 'string'
        && isSeverity(candidate.severity)
        && typeof candidate.explanation === 'string'
        && Array.isArray(candidate.sentenceIds)
        && candidate.sentenceIds.every(sentenceId => typeof sentenceId === 'string')
        && Array.isArray(candidate.highlightRanges)
        && candidate.highlightRanges.every(isHighlightRange);
}

function isTextAnalytics(value: unknown): value is TextAnalytics {
    return isCoreTextAnalytics(value)
        && hasValidRepetitionSection(value)
        && hasValidProximitySection(value)
        && hasValidCadenceSection(value);
}

function isCoreTextAnalytics(value: unknown): value is Pick<TextAnalytics, 'wordCount' | 'characterCount' | 'characterCountNoSpaces' | 'sentenceCount' | 'paragraphCount' | 'flowScore' | 'keywordDensity'> {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<TextAnalytics>;
    return typeof candidate.wordCount === 'number'
        && typeof candidate.characterCount === 'number'
        && typeof candidate.characterCountNoSpaces === 'number'
        && typeof candidate.sentenceCount === 'number'
        && typeof candidate.paragraphCount === 'number'
        && typeof candidate.flowScore === 'number'
        && Array.isArray(candidate.keywordDensity);
}

function hasValidRepetitionSection(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { repetition?: { items?: unknown; totalFlags?: unknown } };
    return !!candidate.repetition
        && Array.isArray(candidate.repetition.items)
        && candidate.repetition.items.every(isRepetitionItem)
        && typeof candidate.repetition.totalFlags === 'number';
}

function hasValidProximitySection(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { proximity?: { items?: unknown; totalFlags?: unknown } };
    return !!candidate.proximity
        && Array.isArray(candidate.proximity.items)
        && candidate.proximity.items.every(isProximityItem)
        && typeof candidate.proximity.totalFlags === 'number';
}

function hasValidCadenceSection(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { cadence?: { sentences?: unknown; hotspots?: unknown } };
    return !!candidate.cadence
        && Array.isArray(candidate.cadence.sentences)
        && candidate.cadence.sentences.every(isCadenceSentence)
        && Array.isArray(candidate.cadence.hotspots)
        && candidate.cadence.hotspots.every(isCadenceHotspot);
}

function normalizeTextAnalytics(value: unknown): TextAnalytics | null {
    if (!isCoreTextAnalytics(value)) {
        return null;
    }

    const fallback = getEmptyAnalytics();
    const candidate = value as Partial<TextAnalytics>;

    return {
        ...fallback,
        ...candidate,
        repetition: hasValidRepetitionSection(value)
            ? candidate.repetition as TextAnalytics['repetition']
            : fallback.repetition,
        proximity: hasValidProximitySection(value)
            ? candidate.proximity as TextAnalytics['proximity']
            : fallback.proximity,
        cadence: hasValidCadenceSection(value)
            ? candidate.cadence as TextAnalytics['cadence']
            : fallback.cadence,
    };
}

function endsOnSignalBoundary(text: string): boolean {
    return /[\s.!?;:,\n]$/.test(text);
}

function hashSignalText(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function normalizeSignalGeneration(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : Date.now();
}

@Injectable({
    providedIn: 'root'
})
export class FooterStatsService {
    private destroyRef = inject(DestroyRef);
    private noteEditorStore = inject(NoteEditorStore);
    private editorService = inject(EditorService);

    // ─────────────────────────────────────────────────────────────
    // Internal state
    // ─────────────────────────────────────────────────────────────

    /** Current plain text from editor (for analytics and local search) */
    private currentPlainText = signal('');

    /** Latest live analytics calculated from current editor text */
    private _liveAnalytics = signal<TextAnalytics>(getEmptyAnalytics());

    /** Monotonic request guard to drop stale async analytics results */
    private analyticsRequestVersion = 0;

    /** Debounced live signal row refresh for current editor text */
    private signalRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    private signalRefreshRequestVersion = 0;
    private readonly lastSignalSnapshots = new Map<string, { textHash: string; textLength: number; generation: number }>();
    private _signalLifecycle = signal<'idle' | 'queued' | 'refreshing'>('idle');

    /** Save state tracking (derived from store) */
    readonly isSaved = computed(() => !this.noteEditorStore.isSaving());
    readonly plainText = computed(() => this.currentPlainText());
    readonly signalLifecycle = computed(() => this._signalLifecycle());

    constructor() {
        this.destroyRef.onDestroy(() => this.clearSignalRefreshTimer());

        // Listen to editor content changes for analytics
        this.editorService.liveUpdate$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(({ noteId, revision, plainText }) => {
                this.updateCurrentPlainText(plainText);
                if (typeof noteId === 'string') {
                    this.scheduleLiveSignalRefresh(noteId, plainText, revision);
                }
            });

        // Also load initial content when note changes
        this.noteEditorStore.activeNote$.pipe(
            distinctUntilChanged((a, b) => a?.id === b?.id),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(note => {
            this.analyticsRequestVersion++;
            this._liveAnalytics.set(getEmptyAnalytics());

            if (note) {
                const plainText = parseContentToPlainText(note.content || note.markdownContent || '');
                this.updateCurrentPlainText(plainText);
                void this.maybeRefreshOpenedNoteSignals(
                    note.id,
                    plainText,
                    normalizeSignalGeneration(note.version || note.updatedAt),
                );
            } else {
                this.updateCurrentPlainText('');
                this.clearSignalRefreshTimer();
            }
        });

        // Analyze the live editor text directly instead of piggybacking on scans.
        toObservable(this.currentPlainText).pipe(
            debounceTime(300),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe((content) => {
            if (!content) {
                return;
            }

            if (!content.trim()) {
                return;
            }

            const requestVersion = ++this.analyticsRequestVersion;
            try {
                const analytics = normalizeTextAnalytics(analyzeText(content)) ?? getEmptyAnalytics();
                if (requestVersion !== this.analyticsRequestVersion) {
                    return;
                }

                this._liveAnalytics.set(analytics);
            } catch (error) {
                console.error('[FooterStatsService] Local text analytics failed:', error);
                if (requestVersion !== this.analyticsRequestVersion) {
                    return;
                }

                this._liveAnalytics.set(getEmptyAnalytics());
            }
        });
    }

    private updateCurrentPlainText(plainText: string): void {
        this.currentPlainText.set(plainText);

        if (!plainText.trim()) {
            this.analyticsRequestVersion++;
            this._liveAnalytics.set(getEmptyAnalytics());
        }
    }

    private scheduleLiveSignalRefresh(
        noteId: string,
        plainText: string,
        revision = Date.now(),
        force = false,
    ): void {
        const activeNoteId = this.noteEditorStore.activeNoteId();
        if (!noteId || (activeNoteId && activeNoteId !== noteId)) {
            return;
        }

        const previous = this.lastSignalSnapshots.get(noteId);
        const trimmed = plainText.trim();
        const textHash = hashSignalText(plainText);
        const delay = this.signalRefreshDelay(previous?.textLength || 0, plainText);
        if (!force && previous?.textHash === textHash && previous.textLength === plainText.length) {
            return;
        }
        if (!force && trimmed && delay === null) {
            return;
        }

        const requestVersion = ++this.signalRefreshRequestVersion;
        const refreshDelay = force || !trimmed
            ? SIGNAL_REFRESH_CLEAR_MS
            : delay ?? SIGNAL_REFRESH_EDIT_MS;
        this.clearSignalRefreshTimer();
        this._signalLifecycle.set('queued');
        this.signalRefreshTimer = setTimeout(() => {
            this.signalRefreshTimer = null;
            void this.flushLiveSignalRefresh(noteId, plainText, revision, requestVersion);
        }, refreshDelay);
    }

    private async flushLiveSignalRefresh(
        noteId: string,
        plainText: string,
        revision: number,
        requestVersion: number,
    ): Promise<void> {
        if (requestVersion !== this.signalRefreshRequestVersion) {
            return;
        }

        this._signalLifecycle.set('refreshing');
        try {
            await syncLiveNoteEntityOccurrences(noteId, plainText, revision || Date.now());
            if (requestVersion === this.signalRefreshRequestVersion) {
                this.rememberSignalSnapshot(noteId, plainText, normalizeSignalGeneration(revision));
            }
        } catch (error) {
            console.warn('[FooterStatsService] Live signal refresh skipped:', error);
        } finally {
            if (requestVersion === this.signalRefreshRequestVersion) {
                this._signalLifecycle.set('idle');
            }
        }
    }

    private clearSignalRefreshTimer(): void {
        if (this.signalRefreshTimer) {
            clearTimeout(this.signalRefreshTimer);
            this.signalRefreshTimer = null;
        }
        this._signalLifecycle.set('idle');
    }

    private signalRefreshDelay(previousTextLength: number, nextText: string): number | null {
        if (!nextText.trim()) {
            return SIGNAL_REFRESH_CLEAR_MS;
        }

        const delta = Math.abs(nextText.length - previousTextLength);
        if (!previousTextLength || delta >= SIGNAL_REFRESH_PASTE_DELTA) {
            return SIGNAL_REFRESH_PASTE_MS;
        }
        if (delta < SIGNAL_REFRESH_MIN_DELTA && !endsOnSignalBoundary(nextText)) {
            return null;
        }
        if (endsOnSignalBoundary(nextText)) {
            return SIGNAL_REFRESH_BOUNDARY_MS;
        }
        return SIGNAL_REFRESH_EDIT_MS;
    }

    private async maybeRefreshOpenedNoteSignals(noteId: string, plainText: string, generation: number): Promise<void> {
        const activeNoteId = this.noteEditorStore.activeNoteId();
        if (!noteId || (activeNoteId && activeNoteId !== noteId)) {
            return;
        }

        const requestVersion = ++this.signalRefreshRequestVersion;
        this.clearSignalRefreshTimer();

        const textHash = hashSignalText(plainText);
        const previous = this.lastSignalSnapshots.get(noteId);
        if (previous?.textHash === textHash && previous.textLength === plainText.length && previous.generation >= generation) {
            return;
        }

        const isFresh = await this.hasFreshSignalRows(noteId, generation);
        if (requestVersion !== this.signalRefreshRequestVersion) {
            return;
        }

        if (isFresh) {
            this.rememberSignalSnapshot(noteId, plainText, generation);
            return;
        }

        this.scheduleLiveSignalRefresh(noteId, plainText, generation, true);
    }

    private async hasFreshSignalRows(noteId: string, generation: number): Promise<boolean> {
        try {
            const rows = await db.entityNoteIndex.where('noteId').equals(noteId).toArray();
            if (!rows.length) {
                return false;
            }
            return rows.some(row => typeof row.generation === 'number' && row.generation >= generation);
        } catch {
            return false;
        }
    }

    private rememberSignalSnapshot(noteId: string, plainText: string, generation: number): void {
        this.lastSignalSnapshots.set(noteId, {
            textHash: hashSignalText(plainText),
            textLength: plainText.length,
            generation,
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Live Queries from Dexie
    // ─────────────────────────────────────────────────────────────

    /** Total notes count - live query */
    readonly totalNotes$ = from(liveQuery(() => db.notes.count()) as DexieObservable<number>);
    readonly totalNotes = toSignal(this.totalNotes$, { initialValue: 0 });

    /** Total entities count - live query */
    readonly totalEntities$ = from(liveQuery(() => db.entities.count()) as DexieObservable<number>);
    readonly totalEntities = toSignal(this.totalEntities$, { initialValue: 0 });

    /** Backlinks for current note - live query based on active note ID */
    readonly backlinkData$ = toObservable(this.noteEditorStore.activeNoteId).pipe(
        distinctUntilChanged(),
        switchMap(noteId => {
            if (!noteId) return of(EMPTY_BACKLINK_DATA);
            return from(liveQuery(async () => getEntitySignalRows(noteId)) as DexieObservable<{
                rows: EntitySignalRow[];
                breakdown: EntitySignalBreakdown;
            }>);
        }),
        startWith(EMPTY_BACKLINK_DATA)
    );
    readonly backlinkData = toSignal(this.backlinkData$, { initialValue: EMPTY_BACKLINK_DATA });
    readonly backlinks = computed(() => this.backlinkData().breakdown.total);
    readonly backlinkRows = computed(() => this.backlinkData().rows);
    readonly backlinkBreakdown = computed(() => this.backlinkData().breakdown);

    // ─────────────────────────────────────────────────────────────
    // Computed Stats from Editor Content (using text-analytics)
    // ─────────────────────────────────────────────────────────────

    /** Full text analytics from direct TypeScript analysis of the live editor text */
    readonly analytics = computed<TextAnalytics>(() => this._liveAnalytics());

    /** Word count - from analytics */
    readonly wordCount = computed(() => this.analytics().wordCount);

    /** Character count - from analytics */
    readonly charCount = computed(() => this.analytics().characterCount);

    // ─────────────────────────────────────────────────────────────
    // Aggregated stats object for convenience
    // ─────────────────────────────────────────────────────────────

    readonly stats = computed<FooterStats>(() => ({
        backlinks: this.backlinks(),
        words: this.wordCount(),
        chars: this.charCount(),
        totalNotes: this.totalNotes(),
        totalEntities: this.totalEntities(),
        isSaved: this.isSaved()
    }));
}
