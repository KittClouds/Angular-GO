import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const opsMock = vi.hoisted(() => ({
    getAllNotes: vi.fn(),
    getNotesByFolder: vi.fn(),
    getNotesByIds: vi.fn(),
    getNotesByNarrative: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
    folders: { get: vi.fn() },
}));

vi.mock('../lib/operations', () => opsMock);
vi.mock('../lib/dexie/db', () => ({ db: dbMock }));

import { type ForceGraphData, GraphVizService } from './graph-viz.service';
import { KnowledgeService } from './knowledge.service';
import { PhoenixGraphOrchestratorService } from './phoenix-graph-orchestrator.service';
import { PhoenixUiApiService } from './phoenix-ui-api.service';
import { NoteEditorStore } from '../lib/store/note-editor.store';

describe('PhoenixGraphOrchestratorService', () => {
    let injector: EnvironmentInjector;
    let service: PhoenixGraphOrchestratorService;
    let phoenixUiApiMock: {
        systemRun: ReturnType<typeof vi.fn>;
        rebuildRuntimeIndexes: ReturnType<typeof vi.fn>;
    };
    let knowledgeMock: {
        ensureReady: ReturnType<typeof vi.fn>;
        sync: ReturnType<typeof vi.fn>;
        getGraph: ReturnType<typeof vi.fn>;
    };
    let graphVizMock: { fromKnowledgeGraph: ReturnType<typeof vi.fn> };
    let noteStoreMock: { currentNote: ReturnType<typeof vi.fn> };

    const rawGraph = {
        nodes: { 'char-ryan': { id: 'char-ryan', kind: 'CHARACTER', label: 'Ryan' } },
        edges: [],
    };
    const graphData: ForceGraphData = {
        nodes: [{ id: 'char-ryan', name: 'Ryan', kind: 'CHARACTER' }],
        links: [],
        stats: { totalNodes: 1, totalLinks: 0, kindCounts: { CHARACTER: 1 }, typeCounts: {} },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        opsMock.getNotesByIds.mockResolvedValue([]);
        dbMock.folders.get.mockImplementation(async (id: string) => {
            if (id === 'folder-1') return { id, name: 'Scenes', parentId: 'vault-1' };
            if (id === 'vault-1') return { id, name: 'Narrative', parentId: '' };
            return undefined;
        });
        phoenixUiApiMock = {
            systemRun: vi.fn().mockResolvedValue({ ingest: { ok: true }, commit: { ok: true } }),
            rebuildRuntimeIndexes: vi.fn().mockResolvedValue({ diagnostics: [] }),
        };
        knowledgeMock = {
            ensureReady: vi.fn().mockResolvedValue(undefined),
            sync: vi.fn().mockResolvedValue({ success: true }),
            getGraph: vi.fn().mockResolvedValue(rawGraph),
        };
        graphVizMock = {
            fromKnowledgeGraph: vi.fn().mockReturnValue(graphData),
        };
        noteStoreMock = { currentNote: vi.fn() };

        injector = createEnvironmentInjector([
            { provide: PhoenixUiApiService, useValue: phoenixUiApiMock },
            { provide: KnowledgeService, useValue: knowledgeMock },
            { provide: GraphVizService, useValue: graphVizMock },
            { provide: NoteEditorStore, useValue: noteStoreMock },
        ], Injector.create({ providers: [] }));

        service = runInInjectionContext(injector, () => new PhoenixGraphOrchestratorService());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('indexes a note through the retained system pipeline with resolved folder provenance', async () => {
        const note = {
            id: 'note-1',
            title: 'Untitled',
            markdownContent: 'Ryan entered New Rome.',
            worldId: 'world-1',
            narrativeId: 'narr-1',
            folderId: 'folder-1',
        };

        const result = await service.indexNote(note, { syncGraph: true });

        const scope = {
            worldId: 'world-1',
            narrativeId: 'narr-1',
            folderId: 'folder-1',
            folderPath: 'Narrative / Scenes',
        };
        expect(phoenixUiApiMock.systemRun).toHaveBeenCalledWith({
            ingest: {
                scope,
                commit: false,
                documents: [{
                    documentId: 'note-1',
                    noteId: 'note-1',
                    title: 'Untitled',
                    text: 'Ryan entered New Rome.',
                    scope,
                }],
            },
            commit: { scope },
        });
        expect(knowledgeMock.sync).toHaveBeenCalledTimes(1);
        expect(phoenixUiApiMock.rebuildRuntimeIndexes).toHaveBeenCalledWith('graph-orchestrator:note:force');
        expect(result.processedNotes).toBe(1);
        expect(result.projection.replacedDocuments).toEqual(['note-1']);
        expect(result.projection.deletedRows).toBe(0);
        expect(result.graph?.graphData).toEqual(graphData);
        expect(service.getScopeIndexStatus(scope).state).toBe('clean');
    });

    it('uses dirty-only folder indexing when a scope already has tracked dirty notes', async () => {
        const dirtyNote = {
            id: 'dirty-note',
            title: 'Dirty',
            markdownContent: 'Fresh text.',
            worldId: 'global',
            folderId: 'folder-1',
        };
        const cleanNote = {
            id: 'clean-note',
            title: 'Clean',
            markdownContent: 'Old text.',
            worldId: 'global',
            folderId: 'folder-1',
        };
        service.markNoteDirty(dirtyNote);
        opsMock.getNotesByFolder.mockResolvedValue([dirtyNote, cleanNote]);

        const result = await service.indexFolder('folder-1', { policy: 'dirty-only', syncGraph: false });

        const request = phoenixUiApiMock.systemRun.mock.calls[0][0] as any;
        expect(request.ingest.commit).toBe(false);
        expect(request.ingest.documents).toHaveLength(1);
        expect(request.ingest.documents[0].noteId).toBe('dirty-note');
        expect(phoenixUiApiMock.rebuildRuntimeIndexes).toHaveBeenCalledWith('graph-orchestrator:folder:dirty-only');
        expect(result.processedNotes).toBe(1);
        expect(result.skippedNotes).toBe(1);
    });

    it('loads a persisted graph view without running an ingest job', async () => {
        const result = await service.loadGraphView({ sync: true });

        expect(phoenixUiApiMock.systemRun).not.toHaveBeenCalled();
        expect(knowledgeMock.sync).toHaveBeenCalledTimes(1);
        expect(graphVizMock.fromKnowledgeGraph).toHaveBeenCalledWith(rawGraph);
        expect(result.rawGraph).toEqual(rawGraph);
    });
});
