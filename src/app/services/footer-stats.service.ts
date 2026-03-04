// src/app/services/footer-stats.service.ts
// Live stats service for the hub footer - computes real data from Dexie and editor

import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, of, switchMap, map, startWith, distinctUntilChanged, debounceTime } from 'rxjs';
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

    /** Fallback analytics computed via explicit analyzeText call */
    private _fallbackAnalytics = signal<TextAnalytics>(getEmptyAnalytics());

    /** Save state tracking (derived from store) */
    readonly isSaved = computed(() => !this.noteEditorStore.isSaving());

    constructor() {
        // Listen to editor content changes for analytics
        this.editorService.content$.subscribe(({ json }) => {
            this.currentContent.set(JSON.stringify(json));
        });

        // Also load initial content when note changes
        this.noteEditorStore.activeNote$.pipe(
            distinctUntilChanged((a, b) => a?.id === b?.id)
        ).subscribe(note => {
            if (note) {
                this.currentContent.set(note.content || '');
            } else {
                this.currentContent.set('');
            }
        });

        // Kick off explicit analyzeText call on content changes (debounced)
        // This ensures analytics show up even when SCAN_IMPLICIT hasn't piggybacked yet
        toObservable(this.currentContent).pipe(
            debounceTime(300),
        ).subscribe(async (content) => {
            if (!content) {
                this._fallbackAnalytics.set(getEmptyAnalytics());
                return;
            }
            const plainText = parseContentToPlainText(content);
            if (!plainText.trim()) {
                this._fallbackAnalytics.set(getEmptyAnalytics());
                return;
            }

            const res = await this.goKittService.analyzeText(plainText);
            if (res) {
                this._fallbackAnalytics.set(res);
            }
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

    /** Full text analytics - piggybacked from scanner + explicit fallback */
    readonly analytics = computed<TextAnalytics>(() => {
        // Prefer piggybacked analytics from SCAN_IMPLICIT (zero-cost)
        const piggybacked = this.goKittService.activeAnalytics();
        if (piggybacked && piggybacked.wordCount > 0) return piggybacked;

        // Fallback: explicit analyzeText call
        return this._fallbackAnalytics();
    });

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
