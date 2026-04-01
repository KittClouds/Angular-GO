import { Injectable, isDevMode } from '@angular/core';
import { Subject } from 'rxjs';
import { Crepe } from '@milkdown/crepe';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { stripDerivedEntityMarksInDocJson } from '../components/editor/entity-mark-sanitizer';

export interface EditorLiveUpdate {
    noteId: string | null;
    revision: number;
    plainText: string;
    textLength: number;
    timings: {
        plainTextMs: number;
    };
}

export type EditorSnapshotReason = 'manual-save' | 'before-unload' | 'note-switch' | 'api';

export interface EditorSnapshot {
    json: object;
    markdown: string;
    timings: {
        jsonMs: number;
        markdownMs: number;
        totalMs: number;
    };
}

export type EditorPositionPersistMode = 'debounced' | 'manual-save' | 'before-unload' | 'note-switch';

type EditorPerfTelemetry = {
    liveUpdateCount: number;
    snapshotCount: number;
    analyticsRequestCount: number;
    staleAnalyticsCount: number;
    positionPersistCount: number;
    lastLiveUpdate: {
        noteId: string | null;
        revision: number;
        textLength: number;
        plainTextMs: number;
    } | null;
    lastSnapshot: {
        reason: EditorSnapshotReason;
        jsonMs: number;
        markdownMs: number;
        totalMs: number;
        markdownLength: number;
    } | null;
    lastAnalyticsRequest: {
        noteId: string | null;
        requestChars: number;
        requestBytes: number;
        roundTripMs: number;
        stale: boolean;
    } | null;
    lastPositionPersist: {
        noteId: string | null;
        mode: EditorPositionPersistMode;
    } | null;
};

type PerfWindow = typeof globalThis & {
    __kittEditorPerf?: EditorPerfTelemetry;
};

function nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

@Injectable({
    providedIn: 'root'
})
export class EditorService {
    private crepe?: Crepe;
    private readonly latestLiveContentByNote = new Map<string, EditorLiveUpdate>();
    private undoTrigger = new Subject<void>();
    private redoTrigger = new Subject<void>();

    undo$ = this.undoTrigger.asObservable();
    redo$ = this.redoTrigger.asObservable();

    private saveRequestSubject = new Subject<void>();
    saveRequest$ = this.saveRequestSubject.asObservable();
    private liveUpdateSubject = new Subject<EditorLiveUpdate>();
    liveUpdate$ = this.liveUpdateSubject.asObservable();
    private readonly devPerfEnabled = isDevMode();
    private readonly telemetry: EditorPerfTelemetry = {
        liveUpdateCount: 0,
        snapshotCount: 0,
        analyticsRequestCount: 0,
        staleAnalyticsCount: 0,
        positionPersistCount: 0,
        lastLiveUpdate: null,
        lastSnapshot: null,
        lastAnalyticsRequest: null,
        lastPositionPersist: null,
    };

    constructor() { }

    registerEditor(crepe: Crepe) {
        this.crepe = crepe;
    }

    unregisterEditor(crepe?: Crepe) {
        if (!crepe || this.crepe === crepe) {
            this.crepe = undefined;
        }
    }

    /**
     * Get the Crepe editor instance
     */
    getCrepe(): Crepe | undefined {
        return this.crepe;
    }

    /**
     * Check if editor is registered and ready
     */
    hasEditor(): boolean {
        return !!this.crepe;
    }

    undo() {
        if (this.crepe) {
            try {
                this.crepe.editor.ctx.get(commandsCtx).call(undoCommand.key);
            } catch (e) {
                console.error('Undo failed', e);
            }
        }
    }

    redo() {
        if (this.crepe) {
            try {
                this.crepe.editor.ctx.get(commandsCtx).call(redoCommand.key);
            } catch (e) {
                console.error('Redo failed', e);
            }
        }
    }

    save() {
        if (!this.crepe) {
            return;
        }
        this.saveRequestSubject.next();
    }

    updateLiveContent(content: EditorLiveUpdate) {
        if (content.noteId) {
            this.latestLiveContentByNote.set(content.noteId, content);
        }
        this.liveUpdateSubject.next(content);
        this.recordLiveUpdate(content);
    }

    captureSnapshot(reason: EditorSnapshotReason = 'api'): EditorSnapshot | null {
        if (!this.crepe) {
            return null;
        }

        let editorView: { state: { doc: { toJSON: () => object } } } | null = null;
        try {
            editorView = this.crepe.editor.ctx.get(editorViewCtx);
        } catch {
            return null;
        }

        if (!editorView) {
            return null;
        }

        const snapshotStart = nowMs();
        const jsonStart = nowMs();
        const rawJson = editorView.state.doc.toJSON() as any;
        const json = stripDerivedEntityMarksInDocJson(rawJson).content as object;
        const jsonMs = nowMs() - jsonStart;

        const markdownStart = nowMs();
        const markdown = this.crepe.getMarkdown();
        const markdownMs = nowMs() - markdownStart;
        const totalMs = nowMs() - snapshotStart;

        const snapshot: EditorSnapshot = {
            json,
            markdown,
            timings: {
                jsonMs,
                markdownMs,
                totalMs,
            },
        };

        this.recordSnapshot(reason, snapshot);
        return snapshot;
    }

    recordPositionPersist(noteId: string | null, mode: EditorPositionPersistMode) {
        if (!this.devPerfEnabled) {
            return;
        }

        this.telemetry.positionPersistCount++;
        this.telemetry.lastPositionPersist = { noteId, mode };
        this.publishTelemetry();
    }

    recordAnalyticsRequest(metrics: {
        noteId: string | null;
        requestChars: number;
        requestBytes: number;
        roundTripMs: number;
        stale: boolean;
    }) {
        if (!this.devPerfEnabled) {
            return;
        }

        this.telemetry.analyticsRequestCount++;
        if (metrics.stale) {
            this.telemetry.staleAnalyticsCount++;
        }
        this.telemetry.lastAnalyticsRequest = { ...metrics };
        this.publishTelemetry();
    }

    getPerfSnapshot(): EditorPerfTelemetry | null {
        if (!this.devPerfEnabled) {
            return null;
        }

        return {
            ...this.telemetry,
            lastLiveUpdate: this.telemetry.lastLiveUpdate ? { ...this.telemetry.lastLiveUpdate } : null,
            lastSnapshot: this.telemetry.lastSnapshot ? { ...this.telemetry.lastSnapshot } : null,
            lastAnalyticsRequest: this.telemetry.lastAnalyticsRequest ? { ...this.telemetry.lastAnalyticsRequest } : null,
            lastPositionPersist: this.telemetry.lastPositionPersist ? { ...this.telemetry.lastPositionPersist } : null,
        };
    }

    private recordLiveUpdate(content: EditorLiveUpdate) {
        if (!this.devPerfEnabled) {
            return;
        }

        this.telemetry.liveUpdateCount++;
        this.telemetry.lastLiveUpdate = {
            noteId: content.noteId,
            revision: content.revision,
            textLength: content.textLength,
            plainTextMs: content.timings.plainTextMs,
        };
        this.publishTelemetry();
    }

    private recordSnapshot(reason: EditorSnapshotReason, snapshot: EditorSnapshot) {
        if (!this.devPerfEnabled) {
            return;
        }

        this.telemetry.snapshotCount++;
        this.telemetry.lastSnapshot = {
            reason,
            jsonMs: snapshot.timings.jsonMs,
            markdownMs: snapshot.timings.markdownMs,
            totalMs: snapshot.timings.totalMs,
            markdownLength: snapshot.markdown.length,
        };
        this.publishTelemetry();
    }

    private publishTelemetry() {
        if (!this.devPerfEnabled) {
            return;
        }

        (globalThis as PerfWindow).__kittEditorPerf = this.getPerfSnapshot() ?? undefined;
    }
}
