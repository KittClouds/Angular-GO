import { Injectable, computed, inject, signal } from '@angular/core';

import { db } from '../lib/dexie/db';
import * as ops from '../lib/operations';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { GraphVizService, type ForceGraphData } from './graph-viz.service';
import { KnowledgeService } from './knowledge.service';
import { PhoenixUiApiService, type KnowledgeGraphData } from './phoenix-ui-api.service';

export type PhoenixGraphIndexMode = 'active-note' | 'note' | 'folder' | 'narrative' | 'global';
export type PhoenixGraphIndexPolicy = 'dirty-only' | 'force';
export type PhoenixGraphScopeState = 'idle' | 'dirty' | 'indexing' | 'clean' | 'failed';

export interface PhoenixGraphScope {
    worldId: string;
    narrativeId?: string;
    folderId: string;
    folderPath: string;
}

export interface PhoenixGraphIndexOptions {
    policy?: PhoenixGraphIndexPolicy;
    syncGraph?: boolean;
    reason?: string;
    scope?: Partial<PhoenixGraphScope>;
}

export interface PhoenixGraphScopeStatus {
    key: string;
    state: PhoenixGraphScopeState;
    dirtyNoteIds: string[];
    reason?: string;
    lastIndexedAt?: number;
    error?: string;
}

export interface PhoenixGraphViewResult {
    rawGraph: KnowledgeGraphData;
    graphData: ForceGraphData;
}

export interface PhoenixGraphIndexResult {
    mode: PhoenixGraphIndexMode;
    scope: PhoenixGraphScope;
    processedNotes: number;
    skippedNotes: number;
    projection: PhoenixGraphProjectionSummary;
    runResult: any | null;
    graph?: PhoenixGraphViewResult;
}

export interface PhoenixGraphProjectionSummary {
    liveDocuments: number;
    staleDocuments: string[];
    replacedDocuments: string[];
    deletedRows: number;
}

interface PhoenixGraphNoteLike {
    id: string;
    title?: string;
    content?: unknown;
    markdownContent?: string;
    worldId?: string;
    narrativeId?: string;
    folderId?: string;
}

interface PhoenixGraphActiveJob {
    mode: PhoenixGraphIndexMode;
    scopeKey: string;
    startedAt: number;
    noteCount: number;
}

@Injectable({ providedIn: 'root' })
export class PhoenixGraphOrchestratorService {
    private readonly phoenixUiApi = inject(PhoenixUiApiService);
    private readonly knowledge = inject(KnowledgeService);
    private readonly graphViz = inject(GraphVizService);
    private readonly noteStore = inject(NoteEditorStore);

    private readonly statusesSignal = signal<Record<string, PhoenixGraphScopeStatus>>({});
    private jobChain: Promise<void> = Promise.resolve();

    readonly activeJob = signal<PhoenixGraphActiveJob | null>(null);
    readonly scopeStatuses = computed(() => this.statusesSignal());

    markNoteDirty(note: PhoenixGraphNoteLike, reason = 'note-updated'): void {
        const scope = this.scopeFromNote(note);
        const key = this.scopeKey(scope);
        const previous = this.statusesSignal()[key];
        const dirtyNoteIds = new Set(previous?.dirtyNoteIds || []);
        dirtyNoteIds.add(note.id);
        this.setStatus(scope, {
            state: 'dirty',
            dirtyNoteIds: Array.from(dirtyNoteIds),
            reason,
            error: undefined,
        });
    }

    getScopeIndexStatus(scope: Partial<PhoenixGraphScope> = {}): PhoenixGraphScopeStatus {
        const resolved = this.normalizeScope(scope);
        const key = this.scopeKey(resolved);
        return this.statusesSignal()[key] || {
            key,
            state: 'idle',
            dirtyNoteIds: [],
        };
    }

    async indexActiveNote(options: PhoenixGraphIndexOptions = {}): Promise<PhoenixGraphIndexResult> {
        const note = this.noteStore.currentNote();
        if (!note) {
            throw new Error('No active note is open for graph indexing.');
        }
        return this.indexNote(note, { ...options, policy: options.policy || 'force' });
    }

    async indexNote(note: PhoenixGraphNoteLike, options: PhoenixGraphIndexOptions = {}): Promise<PhoenixGraphIndexResult> {
        return this.indexNotes('note', [note], { ...options, policy: options.policy || 'force' });
    }

    async indexFolder(folderId: string, options: PhoenixGraphIndexOptions = {}): Promise<PhoenixGraphIndexResult> {
        const notes = await this.hydrateBodies(await ops.getNotesByFolder(folderId));
        const folderPath = await this.resolveFolderPath(folderId);
        return this.indexNotes('folder', notes, {
            ...options,
            scope: {
                ...options.scope,
                folderId,
                folderPath: folderPath || folderId || 'global',
            },
        });
    }

    async indexNarrative(narrativeId: string, options: PhoenixGraphIndexOptions = {}): Promise<PhoenixGraphIndexResult> {
        const notes = await this.hydrateBodies(await ops.getNotesByNarrative(narrativeId));
        return this.indexNotes('narrative', notes, {
            ...options,
            scope: {
                ...options.scope,
                narrativeId,
                folderId: options.scope?.folderId || narrativeId || 'global',
                folderPath: options.scope?.folderPath || narrativeId || 'global',
            },
        });
    }

    async indexGlobal(options: PhoenixGraphIndexOptions = {}): Promise<PhoenixGraphIndexResult> {
        const notes = await this.hydrateBodies(await ops.getAllNotes());
        return this.indexNotes('global', notes, {
            ...options,
            scope: { worldId: 'global', folderId: 'global', folderPath: 'global', ...options.scope },
        });
    }

    async loadGraphView(options: { sync?: boolean } = {}): Promise<PhoenixGraphViewResult> {
        await this.knowledge.ensureReady();
        if (options.sync) {
            const syncResult = await this.knowledge.sync();
            if (!syncResult.success) {
                throw new Error(syncResult.error || 'knowledge graph sync failed');
            }
        }
        const rawGraph = await this.knowledge.getGraph();
        return {
            rawGraph,
            graphData: this.graphViz.fromKnowledgeGraph(rawGraph),
        };
    }

    private async indexNotes(
        mode: PhoenixGraphIndexMode,
        incomingNotes: PhoenixGraphNoteLike[],
        options: PhoenixGraphIndexOptions,
    ): Promise<PhoenixGraphIndexResult> {
        const notes = await this.hydrateBodies(incomingNotes);
        const scope = await this.resolveScope(notes, options.scope);
        const key = this.scopeKey(scope);

        return this.enqueue(async () => {
            const status = this.statusesSignal()[key];
            const dirtyNoteIds = new Set(status?.dirtyNoteIds || []);
            const filteredNotes = this.filterNotesByPolicy(notes, options.policy || 'dirty-only', dirtyNoteIds);
            this.activeJob.set({ mode, scopeKey: key, startedAt: Date.now(), noteCount: filteredNotes.length });
            this.setStatus(scope, { state: 'indexing', reason: options.reason, error: undefined });

            try {
                let runResult: any | null = null;
                const projection = this.projectionSummary(notes, filteredNotes);
                if (filteredNotes.length > 0) {
                    await this.knowledge.ensureReady();
                    runResult = await this.phoenixUiApi.systemRun({
                        ingest: {
                            scope,
                            documents: filteredNotes.map((note) => this.toPhoenixDocument(note, scope)),
                            commit: false,
                        },
                        commit: { scope },
                    });
                }
                await this.phoenixUiApi.rebuildRuntimeIndexes(`graph-orchestrator:${mode}:${options.policy || 'dirty-only'}`);

                const graph = options.syncGraph === false
                    ? undefined
                    : await this.loadGraphView({ sync: true });
                const processedIds = new Set(filteredNotes.map((note) => note.id));
                const remainingDirty = (status?.dirtyNoteIds || []).filter((id) => !processedIds.has(id));
                this.setStatus(scope, {
                    state: remainingDirty.length > 0 ? 'dirty' : 'clean',
                    dirtyNoteIds: remainingDirty,
                    lastIndexedAt: Date.now(),
                    reason: options.reason,
                    error: undefined,
                });
                return {
                    mode,
                    scope,
                    processedNotes: filteredNotes.length,
                    skippedNotes: Math.max(0, notes.length - filteredNotes.length),
                    projection,
                    runResult,
                    graph,
                };
            } catch (error) {
                this.setStatus(scope, {
                    state: 'failed',
                    dirtyNoteIds: status?.dirtyNoteIds || notes.map((note) => note.id),
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            } finally {
                this.activeJob.set(null);
            }
        });
    }

    private projectionSummary(
        notes: readonly PhoenixGraphNoteLike[],
        replacedNotes: readonly PhoenixGraphNoteLike[],
    ): PhoenixGraphProjectionSummary {
        return {
            liveDocuments: new Set(notes.map((note) => note.id).filter(Boolean)).size,
            staleDocuments: [],
            replacedDocuments: Array.from(new Set(replacedNotes.map((note) => note.id).filter(Boolean))).sort(),
            deletedRows: 0,
        };
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const next = this.jobChain.then(task, task);
        this.jobChain = next.then(() => undefined, () => undefined);
        return next;
    }

    private filterNotesByPolicy(
        notes: PhoenixGraphNoteLike[],
        policy: PhoenixGraphIndexPolicy,
        dirtyNoteIds: Set<string>,
    ): PhoenixGraphNoteLike[] {
        if (policy === 'force' || dirtyNoteIds.size === 0) {
            return notes;
        }
        return notes.filter((note) => dirtyNoteIds.has(note.id));
    }

    private async hydrateBodies(notes: PhoenixGraphNoteLike[]): Promise<PhoenixGraphNoteLike[]> {
        const idsToLoad = notes
            .filter((note) => note.id && !this.noteHasBody(note))
            .map((note) => note.id);
        const loaded = idsToLoad.length ? await ops.getNotesByIds(Array.from(new Set(idsToLoad))) : [];
        const loadedMap = new Map(loaded.map((note) => [note.id, note]));
        return notes.map((note) => loadedMap.get(note.id) || note);
    }

    private noteHasBody(note: PhoenixGraphNoteLike): boolean {
        return Boolean(String(note.markdownContent || note.content || '').trim());
    }

    private toPhoenixDocument(note: PhoenixGraphNoteLike, scope: PhoenixGraphScope): Record<string, unknown> {
        return {
            documentId: note.id,
            noteId: note.id,
            title: note.title || note.id,
            text: this.noteText(note),
            scope,
        };
    }

    private noteText(note: PhoenixGraphNoteLike): string {
        if (note.markdownContent) {
            return note.markdownContent;
        }
        return typeof note.content === 'string' ? note.content : JSON.stringify(note.content || '');
    }

    private async resolveScope(
        notes: PhoenixGraphNoteLike[],
        explicit: Partial<PhoenixGraphScope> = {},
    ): Promise<PhoenixGraphScope> {
        const base = this.normalizeScope({ ...this.scopeFromNote(notes[0]), ...explicit });
        if (explicit.folderPath || !base.folderId || base.folderId === 'global') {
            return base;
        }
        return {
            ...base,
            folderPath: await this.resolveFolderPath(base.folderId) || base.folderPath,
        };
    }

    private scopeFromNote(note?: PhoenixGraphNoteLike): PhoenixGraphScope {
        const worldId = note?.worldId || 'global';
        const narrativeId = note?.narrativeId || undefined;
        const folderId = note?.folderId || note?.narrativeId || note?.worldId || 'global';
        return {
            worldId,
            narrativeId,
            folderId,
            folderPath: folderId,
        };
    }

    private normalizeScope(scope: Partial<PhoenixGraphScope> = {}): PhoenixGraphScope {
        const worldId = scope.worldId || 'global';
        const folderId = scope.folderId || scope.narrativeId || worldId || 'global';
        return {
            worldId,
            narrativeId: scope.narrativeId || undefined,
            folderId,
            folderPath: scope.folderPath || folderId,
        };
    }

    private scopeKey(scope: Partial<PhoenixGraphScope>): string {
        const normalized = this.normalizeScope(scope);
        return [
            normalized.worldId,
            normalized.narrativeId || '',
            normalized.folderId,
        ].join('|');
    }

    private setStatus(scope: PhoenixGraphScope, patch: Partial<PhoenixGraphScopeStatus>): void {
        const key = this.scopeKey(scope);
        const previous = this.statusesSignal()[key] || { key, state: 'idle' as const, dirtyNoteIds: [] };
        this.statusesSignal.update((statuses) => ({
            ...statuses,
            [key]: {
                ...previous,
                ...patch,
                key,
                dirtyNoteIds: patch.dirtyNoteIds ?? previous.dirtyNoteIds,
            },
        }));
    }

    private async resolveFolderPath(folderId: string): Promise<string | undefined> {
        if (!folderId) {
            return undefined;
        }

        const seen = new Set<string>();
        const segments: string[] = [];
        let currentId = folderId;

        while (currentId && !seen.has(currentId)) {
            seen.add(currentId);
            const folder = await db.folders.get(currentId);
            if (!folder) {
                break;
            }
            segments.unshift(folder.name || folder.id);
            currentId = folder.parentId || '';
        }

        return segments.length > 0 ? segments.join(' / ') : undefined;
    }
}
