// src/app/services/footer-stats.service.ts
// Live stats service for the hub footer - computes real data from Dexie and editor

import { DestroyRef, Injectable, signal, computed, inject } from '@angular/core';
import { toSignal, toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, switchMap, startWith, distinctUntilChanged, debounceTime } from 'rxjs';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from } from 'rxjs';
import { db, Mention } from '../lib/dexie/db';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { EditorService } from './editor.service';
import { analyzeText, parseContentToPlainText, TextAnalytics, getEmptyAnalytics } from '../lib/analytics';

export interface FooterStats {
    backlinks: number;
    words: number;
    chars: number;
    totalNotes: number;
    totalEntities: number;
    isSaved: boolean;
}

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

    /** Save state tracking (derived from store) */
    readonly isSaved = computed(() => !this.noteEditorStore.isSaving());
    readonly plainText = computed(() => this.currentPlainText());

    constructor() {
        // Listen to editor content changes for analytics
        this.editorService.liveUpdate$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(({ plainText }) => {
                this.updateCurrentPlainText(plainText);
            });

        // Also load initial content when note changes
        this.noteEditorStore.activeNote$.pipe(
            distinctUntilChanged((a, b) => a?.id === b?.id),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(note => {
            this.analyticsRequestVersion++;
            this._liveAnalytics.set(getEmptyAnalytics());

            if (note) {
                this.updateCurrentPlainText(
                    parseContentToPlainText(note.content || note.markdownContent || '')
                );
            } else {
                this.updateCurrentPlainText('');
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
    readonly backlinks$ = toObservable(this.noteEditorStore.activeNoteId).pipe(
        distinctUntilChanged(),
        switchMap(noteId => {
            if (!noteId) return of(0);

            // Count mentions where the current note's entities appear in OTHER notes
            // This is a simplified backlink count - mentions pointing TO this note
            return from(liveQuery(async () => {
                // Get all mentions in this note to find its entities
                const mentionsInNote = await db.mentions.where('noteId').equals(noteId).toArray();
                const entityIds = [...new Set(mentionsInNote.map(m => m.entityId))];

                if (entityIds.length === 0) return 0;

                // Count mentions of these entities in OTHER notes
                let backlinkCount = 0;
                for (const entityId of entityIds) {
                    const mentions = await db.mentions
                        .where('entityId')
                        .equals(entityId)
                        .filter((m: Mention) => m.noteId !== noteId)
                        .count();
                    backlinkCount += mentions;
                }

                return backlinkCount;
            }) as DexieObservable<number>);
        }),
        startWith(0)
    );
    readonly backlinks = toSignal(this.backlinks$, { initialValue: 0 });

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
