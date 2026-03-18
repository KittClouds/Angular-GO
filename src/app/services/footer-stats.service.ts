// src/app/services/footer-stats.service.ts
// Live stats service for the hub footer - computes real data from Dexie and editor

import { Injectable, signal, computed, inject } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { of, switchMap, startWith, distinctUntilChanged, debounceTime } from 'rxjs';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from } from 'rxjs';
import { db, Mention } from '../lib/dexie/db';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { EditorService } from './editor.service';
import { parseContentToPlainText, TextAnalytics, getEmptyAnalytics } from '../lib/analytics';
import { GoKittService } from './gokitt.service';

export interface FooterStats {
    backlinks: number;
    words: number;
    chars: number;
    totalNotes: number;
    totalEntities: number;
    isSaved: boolean;
}

function isTextAnalytics(value: unknown): value is TextAnalytics {
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

@Injectable({
    providedIn: 'root'
})
export class FooterStatsService {
    private noteEditorStore = inject(NoteEditorStore);
    private editorService = inject(EditorService);
    private goKittService = inject(GoKittService);

    // ─────────────────────────────────────────────────────────────
    // Internal state
    // ─────────────────────────────────────────────────────────────

    /** Current JSON content from editor (for analytics) */
    private currentContent = signal<string>('');

    /** Latest live analytics calculated from current editor text */
    private _liveAnalytics = signal<TextAnalytics>(getEmptyAnalytics());

    /** Monotonic request guard to drop stale async analytics results */
    private analyticsRequestVersion = 0;

    /** Save state tracking (derived from store) */
    readonly isSaved = computed(() => !this.noteEditorStore.isSaving());

    constructor() {
        // Listen to editor content changes for analytics
        this.editorService.content$.subscribe(({ json }) => {
            this.updateCurrentContent(JSON.stringify(json));
        });

        // Also load initial content when note changes
        this.noteEditorStore.activeNote$.pipe(
            distinctUntilChanged((a, b) => a?.id === b?.id)
        ).subscribe(note => {
            this.analyticsRequestVersion++;
            this._liveAnalytics.set(getEmptyAnalytics());

            if (note) {
                this.updateCurrentContent(note.content || '');
            } else {
                this.updateCurrentContent('');
            }
        });

        // Analyze the live editor text directly instead of piggybacking on scans.
        toObservable(this.currentContent).pipe(
            debounceTime(300),
        ).subscribe(async (content) => {
            if (!content) {
                return;
            }

            const plainText = parseContentToPlainText(content);
            if (!plainText.trim()) {
                return;
            }

            const requestVersion = ++this.analyticsRequestVersion;
            const res = await this.goKittService.analyzeText(plainText);
            if (requestVersion !== this.analyticsRequestVersion) {
                return;
            }

            this._liveAnalytics.set(isTextAnalytics(res) ? res : getEmptyAnalytics());
        });
    }

    private updateCurrentContent(content: string): void {
        this.currentContent.set(content);

        const plainText = parseContentToPlainText(content);
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

    /** Full text analytics from direct Go analysis of the live editor text */
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
