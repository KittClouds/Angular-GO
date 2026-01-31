// src/app/services/footer-stats.service.ts
// Live stats service for the hub footer - computes real data from Dexie and editor

import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, of, switchMap, map, startWith, distinctUntilChanged, debounceTime } from 'rxjs';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from } from 'rxjs';
import { db } from '../lib/dexie/db';
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

@Injectable({
    providedIn: 'root'
})
export class FooterStatsService {
    private noteEditorStore = inject(NoteEditorStore);
    private editorService = inject(EditorService);

    // ─────────────────────────────────────────────────────────────
    // Internal state
    // ─────────────────────────────────────────────────────────────

    /** Current JSON content from editor (for analytics) */
    private currentContent = signal<string>('');

    /** Save state tracking */
    readonly isSaved = signal(true);
    private saveTimeout: any = null;

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
                        .filter(m => m.noteId !== noteId)
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

    /** Full text analytics - same as Analytics Panel */
    readonly analytics = computed<TextAnalytics>(() => {
        const content = this.currentContent();
        if (!content) return getEmptyAnalytics();

        const plainText = parseContentToPlainText(content);
        if (!plainText.trim()) return getEmptyAnalytics();

        return analyzeText(plainText);
    });

    /** Word count - from analytics */
    readonly wordCount = computed(() => this.analytics().wordCount);

    /** Character count - from analytics */
    readonly charCount = computed(() => this.analytics().characterCount);

    // ─────────────────────────────────────────────────────────────
    // Constructor: Subscribe to editor content updates
    // ─────────────────────────────────────────────────────────────

    constructor() {
        // Listen to editor content changes
        this.editorService.content$.subscribe(({ json, markdown }) => {
            // Use JSON content for analytics (same as Analytics Panel)
            this.currentContent.set(JSON.stringify(json));

            // Mark as unsaved, then saved after debounce
            this.isSaved.set(false);

            if (this.saveTimeout) {
                clearTimeout(this.saveTimeout);
            }

            // Match the save debounce timing from NoteEditorStore (300ms + buffer)
            this.saveTimeout = setTimeout(() => {
                this.isSaved.set(true);
            }, 500);
        });

        // Also load initial content when note changes
        this.noteEditorStore.activeNote$.pipe(
            distinctUntilChanged((a, b) => a?.id === b?.id)
        ).subscribe(note => {
            if (note) {
                // Use JSON content (note.content) for consistency with analytics
                this.currentContent.set(note.content || '');
                this.isSaved.set(true);
            } else {
                this.currentContent.set('');
                this.isSaved.set(true);
            }
        });
    }

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
