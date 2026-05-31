import { Injectable, computed, inject, signal } from '@angular/core';

import { db } from '../lib/dexie/db';
import {
    DEFAULT_GRAPH_EMBEDDING_DIMENSION_LABEL,
    DEFAULT_GRAPH_EMBEDDING_MODEL_ID,
} from '../lib/embeddings/models/ModelRegistry';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { parseContentToPlainText } from '../lib/analytics';
import { NerService } from './ner.service';
import { PhoenixMachineControlService, type PhoenixMachineModelId } from './phoenix-machine-control.service';
import { PhoenixUiApiService, type AtlasRichScanPolicy, type AtlasRichScanResult as NativeAtlasRichScanResult } from './phoenix-ui-api.service';
import type { AtlasBuildScope } from './atlas-capability-runtime.model';

export type AtlasScanPhase =
    | 'idle'
    | 'surface'
    | 'evidenceGraph'
    | 'embeddings'
    | 'overgraph'
    | 'complete'
    | 'error';

export interface AtlasScanResult {
    scanId: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    scannedNoteId?: string;
    candidateSuggestions: number;
    exportableMentions: number;
    indexedDocuments: number;
    relationCandidates: number;
    nativeResult: NativeAtlasRichScanResult;
    mode: 'rich-embeddings' | 'text-graph';
}

interface AtlasScanOptions {
    source?: 'search-panel' | 'graph-tab' | 'sidebar' | 'canvas';
    requireActiveNote?: boolean;
    lensMode?: 'global' | 'narrative' | 'note' | 'multiNote';
    buildScope?: AtlasBuildScope;
    noteIds?: string[];
    modelId?: PhoenixMachineModelId;
    modelLabel?: string;
    dimensionLabel?: string;
    policy?: AtlasRichScanPolicy;
    includeSemanticAtlas?: boolean;
}

interface SemanticDocumentRow {
    id: string;
    narrativeId: string;
    title: string;
    content: string;
    folderId?: string;
}

@Injectable({ providedIn: 'root' })
export class AtlasScanCoordinatorService {
    private readonly noteStore = inject(NoteEditorStore);
    private readonly nerService = inject(NerService);
    private readonly machine = inject(PhoenixMachineControlService);
    private readonly phoenixUiApi = inject(PhoenixUiApiService);

    readonly phase = signal<AtlasScanPhase>('idle');
    readonly message = signal<string | null>(null);
    readonly error = signal<string | null>(null);
    readonly lastResult = signal<AtlasScanResult | null>(null);
    readonly running = computed(() => this.machine.activeJob() === 'atlas-rich-scan');

    async runRichEmbeddingScan(options: AtlasScanOptions = {}): Promise<AtlasScanResult> {
        if (this.running()) {
            const existing = this.lastResult();
            if (existing) return existing;
            throw new Error('Semantic Atlas rich scan is already running.');
        }

        const scanId = `atlas-rich:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const includeSemanticAtlas = options.includeSemanticAtlas !== false;
        const startedAt = this.machine.beginAtlasRichScan(
            `${includeSemanticAtlas ? 'semantic-atlas' : 'text-graph'}:${options.source || 'scan'}`
        );
        this.error.set(null);
        this.phase.set('surface');
        this.message.set(includeSemanticAtlas
            ? 'Running native Atlas surface scan, evidence pipeline, and semantic sidecar.'
            : 'Running native Atlas surface scan and evidence graph without embeddings.');
        this.machine.transitionAtlasRichScanStage('surface');

        try {
            const activeNote = this.buildActiveNoteScanRequest();
            if (!activeNote && options.requireActiveNote !== false) {
                throw new Error('Open a note with rendered text before running Semantic Atlas scan.');
            }
            const documents = await this.loadScopedDocuments(options);
            if (!documents.length) {
                throw new Error('No notes with body text are available in the current Atlas scope.');
            }

            const scope = this.buildScanScope(options);
            const nativeResult = await this.phoenixUiApi.atlasRichScan({
                scanId,
                scope,
                policy: options.policy || 'dirty-only',
                embeddingModelId: options.modelId || DEFAULT_GRAPH_EMBEDDING_MODEL_ID,
                embeddingDimension: Number.parseInt(options.dimensionLabel || DEFAULT_GRAPH_EMBEDDING_DIMENSION_LABEL, 10) || undefined,
                returnCandidateSuggestions: true,
                includeSemanticAtlas,
                documents: documents.map((note) => ({
                    documentId: note.id,
                    noteId: note.id,
                    title: note.title,
                    text: note.content,
                    scope: {
                        narrativeId: note.narrativeId || undefined,
                        folderId: note.folderId || undefined,
                        folderPath: note.folderId || undefined,
                    },
                })),
            });

            this.phase.set('overgraph');
            this.message.set('Refreshing graph audit and Semantic Atlas projections from native output.');
            this.machine.transitionAtlasRichScanStage('overgraph');
            await this.nerService.loadAtlasSurfaceSuggestions(nativeResult.candidateSuggestions || []);
            this.phoenixUiApi.invalidateKnowledgeGraphCache();
            await this.machine.refreshAuditSafe();
            const completedAt = performance.now();
            const result: AtlasScanResult = {
                scanId,
                startedAt,
                completedAt,
                durationMs: Math.round(completedAt - startedAt),
                scannedNoteId: options.noteIds?.[0] ?? activeNote?.noteId,
                candidateSuggestions: this.nerService.suggestions().length,
                exportableMentions: this.nerService.suggestions().length,
                indexedDocuments: nativeResult.processedDocuments,
                relationCandidates: nativeResult.relationCandidateCount || 0,
                nativeResult,
                mode: includeSemanticAtlas ? 'rich-embeddings' : 'text-graph',
            };
            this.lastResult.set(result);
            this.phase.set('complete');
            this.message.set(includeSemanticAtlas
                ? `Semantic Atlas updated: ${nativeResult.processedDocuments} document${nativeResult.processedDocuments === 1 ? '' : 's'} processed, ${result.candidateSuggestions} surface candidate${result.candidateSuggestions === 1 ? '' : 's'} ready.`
                : `Text graph updated: ${nativeResult.processedDocuments} document${nativeResult.processedDocuments === 1 ? '' : 's'} processed, embeddings skipped.`);
            this.machine.finishAtlasRichScanFromResult(nativeResult, startedAt, {
                scannedNoteId: options.noteIds?.[0] ?? activeNote?.noteId,
                source: options.source || 'scan',
                includeSemanticAtlas,
            });
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.error.set(message);
            this.phase.set('error');
            this.message.set(message);
            this.machine.failAtlasRichScan(err);
            throw err;
        }
    }

    clear(): void {
        this.phase.set('idle');
        this.message.set(null);
        this.error.set(null);
    }

    private buildActiveNoteScanRequest(): { noteId: string; noteTitle: string; plainText: string } | null {
        const currentNote = this.noteStore.currentNote();
        if (!currentNote) return null;
        const plainText = parseContentToPlainText(currentNote.content || currentNote.markdownContent || '');
        if (!plainText.trim()) return null;
        return {
            noteId: currentNote.id,
            noteTitle: currentNote.title || 'Untitled Note',
            plainText,
        };
    }

    private async loadScopedDocuments(options: AtlasScanOptions): Promise<SemanticDocumentRow[]> {
        const noteIds = uniqueIds(options.noteIds || noteIdsFromBuildScope(options.buildScope));
        if (noteIds.length) {
            const rows = (await db.notes.bulkGet(noteIds)).filter((note): note is NonNullable<typeof note> => !!note);
            return this.toSemanticDocumentRows(rows);
        }
        const folderId = options.buildScope?.mode === 'folder'
            ? options.buildScope.folderId
            : this.machine.scope();
        const rows = folderId === 'global' || options.buildScope?.mode === 'global'
            ? await db.notes.toArray()
            : await db.notes.where('folderId').equals(folderId).toArray();
        return this.toSemanticDocumentRows(rows);
    }

    private toSemanticDocumentRows(rows: Array<{ id: string; narrativeId?: string; title?: string; markdownContent?: string; content?: string; folderId?: string }>): SemanticDocumentRow[] {
        return rows
            .map((note) => ({
                id: note.id,
                narrativeId: note.narrativeId || '',
                title: note.title || 'Untitled',
                content: note.markdownContent || note.content || '',
                folderId: note.folderId || '',
            }))
            .filter((note) => note.content.trim().length > 0);
    }

    private buildScanScope(options: AtlasScanOptions): { mode: string; folderId?: string; folderPath?: string; noteId?: string; noteIds?: string[] } {
        const noteIds = uniqueIds(options.noteIds || noteIdsFromBuildScope(options.buildScope));
        if (noteIds.length === 1) {
            return { mode: 'note', noteId: noteIds[0], noteIds };
        }
        if (noteIds.length > 1) {
            return { mode: 'multiNote', noteIds };
        }
        if (options.buildScope?.mode === 'folder') {
            return {
                mode: 'folder',
                folderId: options.buildScope.folderId,
                folderPath: options.buildScope.folderId,
            };
        }
        if (options.buildScope?.mode === 'global') {
            return { mode: options.lensMode || 'global' };
        }
        const scope = this.machine.scope();
        if (scope === 'global') {
            return { mode: options.lensMode || 'global' };
        }
        return {
            mode: 'folder',
            folderId: scope,
            folderPath: scope,
        };
    }
}

function uniqueIds(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function noteIdsFromBuildScope(scope: AtlasBuildScope | undefined): string[] {
    if (!scope) return [];
    if (scope.mode === 'note') return [scope.noteId];
    if (scope.mode === 'multiNote') return scope.noteIds;
    return [];
}
