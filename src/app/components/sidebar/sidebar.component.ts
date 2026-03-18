// src/app/components/sidebar/sidebar.component.ts
// Sidebar with file tree and action buttons - wired to Dexie and document ingestion.

import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { LucideAngularModule, Plus, FolderPlus, BookOpen, Users, MapPin, Package, Lightbulb, Calendar, Clock, GitBranch, Layers, BookMarked, Film, Zap, Shield, User, Folder, PanelLeft, PanelLeftClose, FileText, Search, Undo, Redo, Sun, Moon, Brain, MoveVertical, RefreshCw, Share2, Upload, MessageCircle } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { SidebarService } from '../../lib/services/sidebar.service';
import { FolderService } from '../../lib/services/folder.service';
import { NotesService } from '../../lib/dexie/notes.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { ThemeService } from '../../lib/services/theme.service';
import { EditorService } from '../../services/editor.service';
import { ReorderService } from '../../lib/services/reorder.service';
import { GoKittService } from '../../services/gokitt.service';
import { FileTreeComponent } from './file-tree/file-tree.component';
import { SearchPanelComponent } from '../search-panel/search-panel.component';
import { NerPanelComponent } from './ner-panel/ner-panel.component';
import { DocumentIngestionService, DocumentIngestionMode, DocumentIngestionResult } from '../../lib/services/document-ingestion.service';
import type { TreeNode } from '../../lib/arborist/types';
import type { Folder as DexieFolder, Note } from '../../lib/dexie/db';
import { getSetting, setSetting } from '../../lib/dexie/settings.service';

interface EntityFolderOption {
    entityKind: string;
    label: string;
    icon: any;
    color: string;
}

interface FolderOption {
    id: string;
    name: string;
    label: string;
    entityKind: string;
    isNarrativeRoot: boolean;
}

interface CreateFolderOption {
    entityKind: string;
    label: string;
    description: string;
}

const ENTITY_FOLDER_OPTIONS: EntityFolderOption[] = [
    { entityKind: 'NARRATIVE', label: 'Narrative Timeline Folder', icon: BookOpen, color: 'hsl(270, 70%, 60%)' },
    { entityKind: 'TIMELINE', label: 'General Timeline Folder', icon: Clock, color: 'hsl(180, 60%, 50%)' },
    { entityKind: 'ARC', label: 'Arc Folder', icon: GitBranch, color: 'hsl(280, 60%, 55%)' },
    { entityKind: 'ACT', label: 'Act Folder', icon: Layers, color: 'hsl(220, 70%, 60%)' },
    { entityKind: 'CHAPTER', label: 'Chapter Folder', icon: BookMarked, color: 'hsl(30, 70%, 55%)' },
    { entityKind: 'EVENT', label: 'Event Folder', icon: Calendar, color: 'hsl(320, 70%, 60%)' },
    { entityKind: 'CHARACTER', label: 'Character Folder', icon: Users, color: 'hsl(200, 80%, 60%)' },
    { entityKind: 'LOCATION', label: 'Location Folder', icon: MapPin, color: 'hsl(140, 60%, 50%)' },
    { entityKind: 'NPC', label: 'NPC Folder', icon: User, color: 'hsl(190, 70%, 55%)' },
    { entityKind: 'ITEM', label: 'Item Folder', icon: Package, color: 'hsl(40, 80%, 60%)' },
    { entityKind: 'CONCEPT', label: 'Concept Folder', icon: Lightbulb, color: 'hsl(60, 70%, 50%)' },
];

const ROOT_CREATE_FOLDER_OPTIONS: CreateFolderOption[] = [
    { entityKind: '', label: 'Regular Folder', description: 'Create a plain root folder.' },
    ...ENTITY_FOLDER_OPTIONS.map(option => ({
        entityKind: option.entityKind,
        label: option.label,
        description: `Create a ${option.entityKind.toLowerCase()} root folder.`,
    })),
];

@Component({
    selector: 'app-sidebar',
    standalone: true,
    imports: [CommonModule, DialogModule, FileTreeComponent, LucideAngularModule, SearchPanelComponent, NerPanelComponent],
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent implements OnInit, OnDestroy {
    sidebarService = inject(SidebarService);
    themeService = inject(ThemeService);
    editorService = inject(EditorService);
    reorderService = inject(ReorderService);
    private folderService = inject(FolderService);
    private notesService = inject(NotesService);
    private noteEditorStore = inject(NoteEditorStore);
    private goKittService = inject(GoKittService);
    private documentIngestionService = inject(DocumentIngestionService);
    private router = inject(Router);

    private foldersSubscription?: Subscription;
    private notesSubscription?: Subscription;

    private static readonly VIEW_STORAGE_KEY = 'kittclouds_sidebar_view';
    viewMode = signal<'files' | 'search' | 'ner'>(this.loadSavedViewMode());

    readonly Plus = Plus;
    readonly Upload = Upload;
    readonly FolderPlus = FolderPlus;
    readonly BookOpen = BookOpen;
    readonly Folder = Folder;
    readonly PanelLeft = PanelLeft;
    readonly PanelLeftClose = PanelLeftClose;
    readonly FileText = FileText;
    readonly Calendar = Calendar;
    readonly Search = Search;
    readonly Undo = Undo;
    readonly Redo = Redo;
    readonly Sun = Sun;
    readonly Moon = Moon;
    readonly Brain = Brain;
    readonly MoveVertical = MoveVertical;
    readonly RefreshCw = RefreshCw;
    readonly Share2 = Share2;
    readonly MessageCircle = MessageCircle;

    isScanning = signal(false);
    readonly entityFolderOptions = ENTITY_FOLDER_OPTIONS;
    folderDropdownOpen = signal(false);

    private folders = signal<DexieFolder[]>([]);
    private notes = signal<Note[]>([]);

    treeData = computed<TreeNode[]>(() => this.buildTree(this.folders(), this.notes()));
    folderOptions = computed<FolderOption[]>(() => this.buildFolderOptions(this.folders()));
    selectedDestinationFolder = computed(() => this.folderOptions().find(folder => folder.id === this.importDestinationFolderId()) ?? null);
    supportedImportFilesCount = computed(() => this.selectedImportFiles().filter(file => this.isTxtFile(file.name)).length);
    skippedImportFilesCount = computed(() => this.selectedImportFiles().length - this.supportedImportFilesCount());
    importPreviewFiles = computed(() => this.selectedImportFiles().slice(0, 6).map(file => this.getDisplayFileName(file)));
    canStartImport = computed(() => {
        return Boolean(this.importDestinationFolderId())
            && this.supportedImportFilesCount() > 0
            && !this.importInProgress();
    });

    collapsedNodes = computed<TreeNode[]>(() => {
        return this.treeData().filter(node => !node.parentId || node.parentId === '');
    });

    importDialogOpen = signal(false);
    importMode = signal<DocumentIngestionMode>('files');
    selectedImportFiles = signal<File[]>([]);
    importInProgress = signal(false);
    importProgress = signal({ processed: 0, total: 0 });
    importResult = signal<DocumentIngestionResult | null>(null);
    importError = signal('');
    importDestinationFolderId = signal('');

    createFolderOpen = signal(false);
    createFolderName = signal('');
    createFolderEntityKind = signal('');
    createFolderOptions = signal<CreateFolderOption[]>(ROOT_CREATE_FOLDER_OPTIONS);
    createFolderError = signal('');
    createFolderInProgress = signal(false);

    private loadSavedViewMode(): 'files' | 'search' | 'ner' {
        const saved = getSetting<string | null>(SidebarComponent.VIEW_STORAGE_KEY, null);
        if (saved === 'files' || saved === 'search' || saved === 'ner') return saved;
        return 'files';
    }

    setViewMode(mode: 'files' | 'search' | 'ner'): void {
        this.viewMode.set(mode);
        setSetting(SidebarComponent.VIEW_STORAGE_KEY, mode);
        this.sidebarService.open();
    }

    ngOnInit(): void {
        this.foldersSubscription = this.folderService.getAllFolders$().subscribe(folders => {
            this.folders.set(folders);
        });

        this.notesSubscription = this.notesService.getAllNotes$().subscribe(notes => {
            this.notes.set(notes);
        });
    }

    ngOnDestroy(): void {
        this.foldersSubscription?.unsubscribe();
        this.notesSubscription?.unsubscribe();
    }

    private buildTree(folders: DexieFolder[], notes: Note[]): TreeNode[] {
        const folderChildrenMap = new Map<string, DexieFolder[]>();
        const rootFolders: DexieFolder[] = [];

        for (const folder of folders) {
            if (!folder.parentId || folder.parentId === '') {
                rootFolders.push(folder);
            } else {
                const siblings = folderChildrenMap.get(folder.parentId) || [];
                siblings.push(folder);
                folderChildrenMap.set(folder.parentId, siblings);
            }
        }

        const notesByFolder = new Map<string, Note[]>();
        const rootNotes: Note[] = [];

        for (const note of notes) {
            if (!note.folderId || note.folderId === '') {
                rootNotes.push(note);
            } else {
                const folderNotes = notesByFolder.get(note.folderId) || [];
                folderNotes.push(note);
                notesByFolder.set(note.folderId, folderNotes);
            }
        }

        const sortByOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;

        const buildFolderNode = (folder: DexieFolder): TreeNode => {
            const childFolders = (folderChildrenMap.get(folder.id) || []).sort(sortByOrder);
            const childNotes = (notesByFolder.get(folder.id) || []).sort(sortByOrder);

            const children: TreeNode[] = [
                ...childFolders.map(buildFolderNode),
                ...childNotes.map(note => this.noteToTreeNode(note)),
            ];

            return {
                id: folder.id,
                name: folder.name,
                type: 'folder',
                entityKind: folder.entityKind || undefined,
                isTypedRoot: folder.isTypedRoot,
                isNarrativeRoot: folder.isNarrativeRoot,
                narrativeId: folder.narrativeId || undefined,
                children: children.length > 0 ? children : undefined,
            };
        };

        rootFolders.sort(sortByOrder);
        rootNotes.sort(sortByOrder);

        return [
            ...rootFolders.map(buildFolderNode),
            ...rootNotes.map(note => this.noteToTreeNode(note)),
        ];
    }

    private buildFolderOptions(folders: DexieFolder[]): FolderOption[] {
        const childrenByParent = new Map<string, DexieFolder[]>();
        const rootFolders: DexieFolder[] = [];
        const sortByOrder = (a: DexieFolder, b: DexieFolder) => a.order - b.order;
        const options: FolderOption[] = [];

        for (const folder of folders) {
            if (!folder.parentId) {
                rootFolders.push(folder);
                continue;
            }

            const siblings = childrenByParent.get(folder.parentId) || [];
            siblings.push(folder);
            childrenByParent.set(folder.parentId, siblings);
        }

        const walk = (folder: DexieFolder, parentPath: string): void => {
            const currentPath = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
            options.push({
                id: folder.id,
                name: folder.name,
                label: currentPath,
                entityKind: folder.entityKind,
                isNarrativeRoot: folder.isNarrativeRoot,
            });

            const children = (childrenByParent.get(folder.id) || []).sort(sortByOrder);
            for (const child of children) {
                walk(child, currentPath);
            }
        };

        for (const root of rootFolders.sort(sortByOrder)) {
            walk(root, '');
        }

        return options;
    }

    private noteToTreeNode(note: Note): TreeNode {
        return {
            id: note.id,
            name: note.title,
            type: 'note',
            isEntity: note.isEntity,
            entityKind: note.entityKind || undefined,
            narrativeId: note.narrativeId || undefined,
        };
    }

    async createNote(): Promise<void> {
        const id = await this.noteEditorStore.createAndOpenNote('', '');
        console.log(`[Sidebar] Created and opened note: ${id}`);
    }

    toggleFolderDropdown(): void {
        this.folderDropdownOpen.update(open => !open);
    }

    closeFolderDropdown(): void {
        this.folderDropdownOpen.set(false);
    }

    async createEntityFolder(option: EntityFolderOption): Promise<void> {
        const isNarrativeRoot = option.entityKind === 'NARRATIVE';

        if (isNarrativeRoot) {
            const id = await this.folderService.createNarrativeVault(option.label.replace(' Folder', ''));
            console.log(`[Sidebar] Created narrative vault: ${id}`);
        } else {
            const id = await this.folderService.createTypedRootFolder(option.entityKind, option.label.replace(' Folder', ''));
            console.log(`[Sidebar] Created typed folder: ${id}`);
        }

        this.closeFolderDropdown();
    }

    async createRegularFolder(): Promise<void> {
        const id = await this.folderService.createRootFolder('New Folder');
        console.log(`[Sidebar] Created folder: ${id}`);
        this.closeFolderDropdown();
    }

    async createNarrative(): Promise<void> {
        const id = await this.folderService.createNarrativeVault('New Narrative');
        console.log(`[Sidebar] Created narrative vault: ${id}`);
    }

    async openImportDialog(): Promise<void> {
        this.closeFolderDropdown();
        this.importDialogOpen.set(true);
        this.importMode.set('files');
        this.selectedImportFiles.set([]);
        this.importInProgress.set(false);
        this.importProgress.set({ processed: 0, total: 0 });
        this.importResult.set(null);
        this.importError.set('');
        this.createFolderOpen.set(false);
        this.createFolderName.set('');
        this.createFolderError.set('');

        const destinationFolderId = await this.documentIngestionService.resolveDefaultDestinationFolderId();
        this.importDestinationFolderId.set(destinationFolderId || '');
        await this.refreshCreateFolderOptions();
    }

    closeImportDialog(): void {
        if (this.importInProgress()) return;
        this.importDialogOpen.set(false);
    }

    async chooseImportSource(mode: DocumentIngestionMode): Promise<void> {
        this.importError.set('');
        this.importResult.set(null);
        this.importMode.set(mode);

        const batch = mode === 'folder'
            ? await this.documentIngestionService.openFolderPicker()
            : await this.documentIngestionService.openFilesPicker();

        if (!batch) {
            return;
        }

        this.importMode.set(batch.mode);
        this.selectedImportFiles.set(batch.files);
        this.importProgress.set({ processed: 0, total: batch.files.filter(file => this.isTxtFile(file.name)).length });

        if (batch.files.length > 0 && batch.files.every(file => !this.isTxtFile(file.name))) {
            this.importError.set('No .txt files were found in the selection.');
        }
    }

    async setImportDestination(folderId: string): Promise<void> {
        this.importDestinationFolderId.set(folderId);
        this.createFolderError.set('');
        await this.refreshCreateFolderOptions();
    }

    toggleCreateFolderPanel(): void {
        this.createFolderOpen.update(open => !open);
        this.createFolderError.set('');
        if (this.createFolderOpen()) {
            void this.refreshCreateFolderOptions();
        }
    }

    async createFolderForImport(): Promise<void> {
        this.createFolderError.set('');
        this.createFolderInProgress.set(true);

        try {
            const folderId = await this.documentIngestionService.createDestinationFolder(
                this.importDestinationFolderId(),
                this.createFolderEntityKind(),
                this.createFolderName()
            );
            this.importDestinationFolderId.set(folderId);
            this.createFolderName.set('');
            this.createFolderOpen.set(false);
            await this.refreshCreateFolderOptions();
        } catch (error) {
            this.createFolderError.set(error instanceof Error ? error.message : 'Folder creation failed.');
        } finally {
            this.createFolderInProgress.set(false);
        }
    }

    async runImport(): Promise<void> {
        if (!this.canStartImport()) {
            if (!this.importDestinationFolderId()) {
                this.importError.set('Choose a destination folder or create one before importing.');
            } else if (this.supportedImportFilesCount() === 0) {
                this.importError.set('Select at least one .txt file before importing.');
            }
            return;
        }

        this.importError.set('');
        this.importResult.set(null);
        this.importInProgress.set(true);
        this.importProgress.set({ processed: 0, total: this.supportedImportFilesCount() });

        try {
            const result = await this.documentIngestionService.ingestDocuments({
                mode: this.importMode(),
                destinationFolderId: this.importDestinationFolderId(),
                files: this.selectedImportFiles(),
                conflictPolicy: 'suffix',
            }, (processed, total) => {
                this.importProgress.set({ processed, total });
            });

            this.importResult.set(result);
        } catch (error) {
            this.importError.set(error instanceof Error ? error.message : 'Import failed.');
        } finally {
            this.importInProgress.set(false);
        }
    }

    async refreshCreateFolderOptions(): Promise<void> {
        const destinationFolderId = this.importDestinationFolderId();

        if (!destinationFolderId) {
            this.createFolderOptions.set(ROOT_CREATE_FOLDER_OPTIONS);
            if (!ROOT_CREATE_FOLDER_OPTIONS.some(option => option.entityKind === this.createFolderEntityKind())) {
                this.createFolderEntityKind.set(ROOT_CREATE_FOLDER_OPTIONS[0].entityKind);
            }
            return;
        }

        const destinationFolder = this.folders().find(folder => folder.id === destinationFolderId);
        if (!destinationFolder?.entityKind) {
            this.createFolderOptions.set([{ entityKind: '', label: 'Regular Folder', description: 'Create a plain subfolder here.' }]);
            this.createFolderEntityKind.set('');
            return;
        }

        const allowedSubfolders = await this.folderService.getAllowedSubfolders(destinationFolder.entityKind);
        const options: CreateFolderOption[] = [
            { entityKind: '', label: 'Regular Folder', description: 'Create a plain subfolder here.' },
            ...allowedSubfolders.map(subfolder => ({
                entityKind: subfolder.entityKind,
                label: subfolder.label,
                description: subfolder.description || `Create a ${subfolder.entityKind.toLowerCase()} subfolder here.`,
            })),
        ];

        this.createFolderOptions.set(options);
        if (!options.some(option => option.entityKind === this.createFolderEntityKind())) {
            this.createFolderEntityKind.set(options[0]?.entityKind || '');
        }
    }

    getCreateFolderParentLabel(): string {
        return this.selectedDestinationFolder()?.label || 'Root level';
    }

    getCreateFolderOptionLabel(entityKind: string): string {
        return this.createFolderOptions().find(option => option.entityKind === entityKind)?.label || 'Regular Folder';
    }

    getDisplayFileName(file: File): string {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        return relative && relative.length > 0 ? relative : file.name;
    }

    isTxtFile(fileName: string): boolean {
        return fileName.toLowerCase().endsWith('.txt');
    }

    toggleReorderMode(): void {
        this.reorderService.toggleReorderMode();
    }

    getNodeIcon(node: TreeNode): any {
        if (node.type === 'folder') {
            if (node.isNarrativeRoot) return this.BookOpen;
            return this.Folder;
        }
        return this.FileText;
    }

    onCollapsedNodeClick(node: TreeNode): void {
        if (node.type === 'note') {
            this.noteEditorStore.openNote(node.id);
        } else {
            this.sidebarService.open();
        }
    }

    toggleSearch(): void {
        if (this.viewMode() !== 'search') {
            this.setViewMode('search');
        } else {
            this.setViewMode('files');
        }
    }

    toggleNer(): void {
        if (this.viewMode() !== 'ner') {
            this.setViewMode('ner');
        } else {
            this.setViewMode('files');
        }
    }

    async triggerGraphScan(): Promise<void> {
        const note = this.noteEditorStore.currentNote();
        if (!note) {
            console.warn('[Sidebar] No note open to scan.');
            return;
        }

        if (!this.goKittService.isReady) {
            console.warn('[Sidebar] GoKitt WASM not ready.');
            return;
        }

        this.isScanning.set(true);

        try {
            const result = await this.goKittService.scan(note.markdownContent || '', {
                worldId: note.narrativeId || 'global',
                parentPath: note.folderId || undefined,
            });

            if (result && !result.error) {
                await this.goKittService.persistGraph(
                    result,
                    note.id,
                    note.narrativeId || undefined
                );
            }
        } catch (error) {
            console.error('[Sidebar] Graph scan failed:', error);
        } finally {
            this.isScanning.set(false);
        }
    }

    navigateToCalendar(): void {
        this.router.navigate(['/calendar']);
    }

    navigateToGraph(): void {
        this.router.navigate(['/graph']);
    }

    navigateToChat(): void {
        this.router.navigate(['/chat']);
    }
}
