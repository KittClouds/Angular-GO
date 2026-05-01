import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged } from 'rxjs';

import { parseContentToPlainText } from '../lib/analytics';
import { db } from '../lib/dexie/db';
import {
    syncLiveNoteEntityOccurrences,
    type EntityMentionScanner,
    type EntityScanScope,
} from '../lib/notes/entity-occurrence-index';
import { getEntitySignalRows } from '../lib/notes/entity-occurrence-rows';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { EditorService } from './editor.service';
import { PhoenixUiApiService } from './phoenix-ui-api.service';

export type PhoenixSignalStatus = 'unknown' | 'fresh' | 'stale' | 'pending' | 'refreshing' | 'error';
export type PhoenixMachineStage = 'signals' | 'surface' | 'evidenceGraph' | 'embeddings' | 'overgraph';
export type PhoenixMachineStageStatus = 'idle' | 'dirty' | 'queued' | 'running' | 'ready' | 'error';

export interface PhoenixSignalSnapshot {
    noteId: string | null;
    status: PhoenixSignalStatus;
    count: number;
    generation: number;
    updatedAt: number;
    error?: string;
}

export interface PhoenixMachineStageSnapshot {
    stage: PhoenixMachineStage;
    status: PhoenixMachineStageStatus;
    updatedAt: number;
    reason?: string;
    error?: string;
}

interface NoteTextSnapshot {
    textHash: string;
    textLength: number;
    generation: number;
    plainText: string;
}

const EMPTY_SIGNAL_SNAPSHOT: PhoenixSignalSnapshot = {
    noteId: null,
    status: 'unknown',
    count: 0,
    generation: 0,
    updatedAt: 0,
};

function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function normalizeGeneration(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : Date.now();
}

function hashText(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

@Injectable({ providedIn: 'root' })
export class PhoenixMachineControllerService {
    private readonly destroyRef = inject(DestroyRef);
    private readonly editorService = inject(EditorService);
    private readonly noteStore = inject(NoteEditorStore);
    private readonly phoenixUiApi = inject(PhoenixUiApiService);

    private readonly activeNoteIdState = signal<string | null>(null);
    private readonly signalByNote = signal<Record<string, PhoenixSignalSnapshot>>({});
    private readonly textByNote = new Map<string, NoteTextSnapshot>();
    private readonly scanEpochByNote = new Map<string, number>();
    private readonly stageByName = signal<Record<PhoenixMachineStage, PhoenixMachineStageSnapshot>>({
        signals: this.stage('signals', 'idle'),
        surface: this.stage('surface', 'idle'),
        evidenceGraph: this.stage('evidenceGraph', 'idle'),
        embeddings: this.stage('embeddings', 'idle'),
        overgraph: this.stage('overgraph', 'idle'),
    });

    readonly activeNoteId = computed(() => this.activeNoteIdState());
    readonly activeSignals = computed<PhoenixSignalSnapshot>(() => {
        const noteId = this.activeNoteIdState();
        return noteId ? this.signalByNote()[noteId] ?? { ...EMPTY_SIGNAL_SNAPSHOT, noteId } : EMPTY_SIGNAL_SNAPSHOT;
    });
    readonly signalLifecycle = computed<'idle' | 'queued' | 'refreshing'>(() => {
        const status = this.activeSignals().status;
        if (status === 'pending') return 'queued';
        if (status === 'refreshing') return 'refreshing';
        return 'idle';
    });
    readonly stages = computed(() => this.stageByName());

    private readonly signalScanner: EntityMentionScanner = {
        scanEntityMentionsAsync: (text: string, scope?: EntityScanScope) =>
            this.phoenixUiApi.scanEntityMentionsAsync(text, scope),
    };

    constructor() {
        this.editorService.liveUpdate$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(({ noteId, revision, plainText }) => {
                if (noteId) {
                    this.noteEdited(noteId, plainText, revision);
                }
            });

        this.noteStore.activeNote$.pipe(
            distinctUntilChanged((left, right) => left?.id === right?.id),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(note => {
            if (!note) {
                this.activeNoteIdState.set(null);
                return;
            }

            const plainText = parseContentToPlainText(note.content || note.markdownContent || '');
            void this.noteOpened(note.id, plainText, normalizeGeneration(note.version || note.updatedAt));
        });
    }

    noteEdited(noteId: string, plainText: string, generation = Date.now()): void {
        const normalizedGeneration = normalizeGeneration(generation);
        const previous = this.textByNote.get(noteId);
        const nextHash = hashText(plainText);
        this.textByNote.set(noteId, {
            textHash: nextHash,
            textLength: plainText.length,
            generation: normalizedGeneration,
            plainText,
        });

        if (previous?.textHash === nextHash && previous.textLength === plainText.length) {
            return;
        }

        this.bumpScanEpoch(noteId);
        this.writeSignal(noteId, {
            status: 'stale',
            generation: normalizedGeneration,
        });
        this.setStage('signals', 'dirty', 'editor-change');
        this.setStage('surface', 'dirty', 'editor-change');
    }

    async noteOpened(noteId: string, plainText: string, generation = Date.now()): Promise<void> {
        const normalizedGeneration = normalizeGeneration(generation);
        const epoch = this.bumpScanEpoch(noteId);
        this.activeNoteIdState.set(noteId);
        this.textByNote.set(noteId, {
            textHash: hashText(plainText),
            textLength: plainText.length,
            generation: normalizedGeneration,
            plainText,
        });

        const [count, fresh] = await Promise.all([
            this.cachedSignalCount(noteId),
            this.hasFreshSignalRows(noteId, normalizedGeneration),
        ]);
        if (this.scanEpochByNote.get(noteId) !== epoch) {
            return;
        }

        this.writeSignal(noteId, {
            count,
            generation: normalizedGeneration,
            status: fresh ? 'fresh' : 'stale',
        });
        this.setStage('signals', fresh ? 'ready' : 'dirty', fresh ? 'note-open-cache' : 'note-open-stale');
    }

    markSaved(noteId: string, generation = Date.now()): void {
        this.writeSignal(noteId, {
            status: 'stale',
            generation: normalizeGeneration(generation),
        });
        this.setStage('signals', 'dirty', 'note-save');
    }

    queueSignals(noteId = this.activeNoteIdState()): void {
        if (!noteId) {
            return;
        }
        this.writeSignal(noteId, { status: 'pending' });
        this.setStage('signals', 'queued', 'explicit-queue');
    }

    async scanSignalsNow(noteId = this.activeNoteIdState()): Promise<void> {
        if (!noteId) {
            return;
        }

        const textSnapshot = this.textByNote.get(noteId) ?? await this.loadNoteText(noteId);
        const epoch = this.bumpScanEpoch(noteId);
        this.writeSignal(noteId, {
            status: 'refreshing',
            generation: textSnapshot.generation,
        });
        this.setStage('signals', 'running', 'manual-scan');

        try {
            await syncLiveNoteEntityOccurrences(
                noteId,
                textSnapshot.plainText,
                textSnapshot.generation,
                this.signalScanner,
            );
            if (this.scanEpochByNote.get(noteId) !== epoch) {
                return;
            }

            this.writeSignal(noteId, {
                status: 'fresh',
                count: await this.cachedSignalCount(noteId),
                generation: textSnapshot.generation,
            });
            this.setStage('signals', 'ready', 'manual-scan');
        } catch (error) {
            if (this.scanEpochByNote.get(noteId) !== epoch) {
                return;
            }

            const message = error instanceof Error ? error.message : String(error);
            this.writeSignal(noteId, { status: 'error', error: message });
            this.setStage('signals', 'error', 'manual-scan', message);
        }
    }

    beginStage(stage: PhoenixMachineStage, reason: string): void {
        this.setStage(stage, 'running', reason);
    }

    finishStage(stage: PhoenixMachineStage, reason: string): void {
        this.setStage(stage, 'ready', reason);
    }

    failStage(stage: PhoenixMachineStage, reason: string, error: unknown): void {
        this.setStage(stage, 'error', reason, error instanceof Error ? error.message : String(error));
    }

    private writeSignal(noteId: string, patch: Partial<Omit<PhoenixSignalSnapshot, 'noteId'>>): void {
        const previous = this.signalByNote()[noteId] ?? { ...EMPTY_SIGNAL_SNAPSHOT, noteId };
        this.signalByNote.update(current => ({
            ...current,
            [noteId]: {
                ...previous,
                ...patch,
                noteId,
                updatedAt: Date.now(),
            },
        }));
    }

    private async loadNoteText(noteId: string): Promise<NoteTextSnapshot> {
        const note = await db.notes.get(noteId);
        const plainText = parseContentToPlainText(note?.content || note?.markdownContent || '');
        const generation = normalizeGeneration(note?.version || note?.updatedAt);
        const snapshot = {
            textHash: hashText(plainText),
            textLength: plainText.length,
            generation,
            plainText,
        };
        this.textByNote.set(noteId, snapshot);
        return snapshot;
    }

    private async cachedSignalCount(noteId: string): Promise<number> {
        try {
            return (await getEntitySignalRows(noteId)).breakdown.total;
        } catch {
            return 0;
        }
    }

    private async hasFreshSignalRows(noteId: string, generation: number): Promise<boolean> {
        try {
            const rows = await db.entityNoteIndex.where('noteId').equals(noteId).toArray();
            return rows.some(row => typeof row.generation === 'number' && row.generation >= generation);
        } catch {
            return false;
        }
    }

    private bumpScanEpoch(noteId: string): number {
        const next = (this.scanEpochByNote.get(noteId) || 0) + 1;
        this.scanEpochByNote.set(noteId, next);
        return next;
    }

    private stage(stage: PhoenixMachineStage, status: PhoenixMachineStageStatus): PhoenixMachineStageSnapshot {
        return { stage, status, updatedAt: Date.now() };
    }

    private setStage(
        stage: PhoenixMachineStage,
        status: PhoenixMachineStageStatus,
        reason?: string,
        error?: string,
    ): void {
        this.stageByName.update(current => ({
            ...current,
            [stage]: {
                stage,
                status,
                reason,
                error,
                updatedAt: nowMs(),
            },
        }));
    }
}
