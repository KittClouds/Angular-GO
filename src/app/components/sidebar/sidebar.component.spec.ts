import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
    type EnvironmentInjector,
} from '@angular/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarComponent } from './sidebar.component';
import { SidebarService } from '../../lib/services/sidebar.service';
import { ThemeService } from '../../lib/services/theme.service';
import { EditorService } from '../../services/editor.service';
import { ReorderService } from '../../lib/services/reorder.service';
import { FolderService } from '../../lib/services/folder.service';
import { NotesService } from '../../lib/dexie/notes.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { GoKittService } from '../../services/gokitt.service';
import { DocumentIngestionService } from '../../lib/services/document-ingestion.service';
import { DocumentExportService } from '../../lib/services/document-export.service';
import { Router } from '@angular/router';
import { PhoenixChatService } from '../../lib/services/phoenix-chat.service';
import { GraphPipelineService } from '../../services/graph-pipeline.service';
import { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';

describe('SidebarComponent graph scan', () => {
    let injector: EnvironmentInjector;
    let component: SidebarComponent;
    let graphPipelineMock: { runNoteGraphPipeline: ReturnType<typeof vi.fn> };
    let goKittMock: { isReady: boolean; scan: ReturnType<typeof vi.fn>; persistGraph: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        graphPipelineMock = {
            runNoteGraphPipeline: vi.fn().mockResolvedValue({}),
        };
        goKittMock = {
            isReady: true,
            scan: vi.fn(),
            persistGraph: vi.fn(),
        };

        injector = createEnvironmentInjector([
            { provide: SidebarService, useValue: { open: vi.fn(), isOpen: vi.fn(() => true) } },
            { provide: ThemeService, useValue: {} },
            { provide: EditorService, useValue: {} },
            { provide: ReorderService, useValue: { toggleReorderMode: vi.fn() } },
            { provide: FolderService, useValue: { getAllFolders$: () => of([]), getAllowedSubfolders: vi.fn().mockResolvedValue([]) } },
            { provide: NotesService, useValue: { getAllNotes$: () => of([]) } },
            {
                provide: NoteEditorStore,
                useValue: {
                    currentNote: vi.fn(() => ({
                        id: 'note-1',
                        title: 'Untitled',
                        markdownContent: 'Ryan entered New Rome.',
                        content: 'Ryan entered New Rome.',
                        worldId: 'world-1',
                        narrativeId: 'narr-1',
                        folderId: 'folder-1',
                    })),
                },
            },
            { provide: GoKittService, useValue: goKittMock },
            { provide: DocumentIngestionService, useValue: {} },
            { provide: DocumentExportService, useValue: { exportText: vi.fn() } },
            { provide: Router, useValue: { navigate: vi.fn(), events: of(), url: '/' } },
            { provide: PhoenixChatService, useValue: { threads: signal([]), loadThread: vi.fn() } },
            { provide: GraphPipelineService, useValue: graphPipelineMock },
            { provide: PhoenixUiApiService, useValue: { isReady: true } },
        ], Injector.create({ providers: [] }));

        component = runInInjectionContext(injector, () => new SidebarComponent());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('delegates graph scan to the full graph pipeline service', async () => {
        await component.triggerGraphScan();

        expect(graphPipelineMock.runNoteGraphPipeline).toHaveBeenCalledTimes(1);
        expect(goKittMock.scan).not.toHaveBeenCalled();
        expect(goKittMock.persistGraph).not.toHaveBeenCalled();
        expect(component.isScanning()).toBe(false);
    });
});
