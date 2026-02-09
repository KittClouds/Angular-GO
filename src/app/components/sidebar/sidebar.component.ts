// src/app/components/sidebar/sidebar.component.ts
// Sidebar with file tree and action buttons - WIRED to Dexie

import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Plus, FolderPlus, BookOpen, Users, MapPin, Package, Lightbulb, Calendar, Clock, GitBranch, Layers, BookMarked, Film, Zap, Shield, User, Folder, PanelLeft, PanelLeftClose, FileText, Search, Undo, Redo, Sun, Moon, Brain, MoveVertical, RefreshCw, Share2 } from 'lucide-angular';
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
import type { TreeNode } from '../../lib/arborist/types';
import type { Folder as DexieFolder, Note, FolderSchema } from '../../lib/dexie/db';
import { AppStore } from '../../lib/ngrx';

// Entity folder types for the dropdown (matches reference)
interface EntityFolderOption {
    entityKind: string;
    label: string;
    icon: any;
    color: string;
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

@Component({
    selector: 'app-sidebar',
    standalone: true,
    imports: [CommonModule, FileTreeComponent, LucideAngularModule, SearchPanelComponent, NerPanelComponent],
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
    private router = inject(Router);
    private appStore = inject(AppStore);

    // Subscriptions
    private foldersSubscription?: Subscription;
    private notesSubscription?: Subscription;

    // View Mode State - persisted to localStorage
    private static readonly VIEW_STORAGE_KEY = 'kittclouds_sidebar_view';
    viewMode = signal<'files' | 'search' | 'ner'>(this.loadSavedViewMode());

    private loadSavedViewMode(): 'files' | 'search' | 'ner' {
        if (typeof localStorage === 'undefined') return 'files';
        const saved = localStorage.getItem(SidebarComponent.VIEW_STORAGE_KEY);
        if (saved === 'files' || saved === 'search' || saved === 'ner') return saved;
        return 'files';
    }

    setViewMode(mode: 'files' | 'search' | 'ner'): void {
        this.viewMode.set(mode);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SidebarComponent.VIEW_STORAGE_KEY, mode);
        }
        this.sidebarService.open();
    }

    // Icons for template
    readonly Plus = Plus;
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
    readonly Brain = Brain; // Add Brain icon for NER
    readonly MoveVertical = MoveVertical; // Add MoveVertical icon for reorder mode
    readonly RefreshCw = RefreshCw; // Add RefreshCw icon for graph scan
    readonly Share2 = Share2; // Add Share2 icon for graph page

    // Graph scan state
    isScanning = signal(false);

    // Entity folder options for dropdown
    readonly entityFolderOptions = ENTITY_FOLDER_OPTIONS;

    // Folder dropdown state
    folderDropdownOpen = signal(false);

    // Raw data from Dexie
    private folders = signal<DexieFolder[]>([]);
    private notes = signal<Note[]>([]);

    // Computed tree from Dexie data
    treeData = computed<TreeNode[]>(() => this.buildTree(this.folders(), this.notes()));

    // Collapsed view: show only root-level items (folders + notes without parent)
    collapsedNodes = computed<TreeNode[]>(() => {
        return this.treeData().filter(node => !node.parentId || node.parentId === '');
    });

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    ngOnInit(): void {
        // Subscribe to live folder updates
        this.foldersSubscription = this.folderService.getAllFolders$().subscribe(folders => {
            this.folders.set(folders);
        });

        // Subscribe to live note updates  
        this.notesSubscription = this.notesService.getAllNotes$().subscribe(notes => {
            this.notes.set(notes);
        });
    }

    ngOnDestroy(): void {
        this.foldersSubscription?.unsubscribe();
        this.notesSubscription?.unsubscribe();
    }

    // ─────────────────────────────────────────────────────────────
    // Tree Building (Dexie → TreeNode)
    // ─────────────────────────────────────────────────────────────

    private buildTree(folders: DexieFolder[], notes: Note[]): TreeNode[] {
        // Build a map of folder children
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

        // Build a map of notes by folder
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

        // Helper to sort by order
        const sortByOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;

        // Recursively build tree
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

        // Build root level
        rootFolders.sort(sortByOrder);
        rootNotes.sort(sortByOrder);

        const rootNodes: TreeNode[] = [
            ...rootFolders.map(buildFolderNode),
            ...rootNotes.map(note => this.noteToTreeNode(note)),
        ];

        return rootNodes;
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

    // ─────────────────────────────────────────────────────────────
    // Quick Actions
    // ─────────────────────────────────────────────────────────────

    async createNote(): Promise<void> {
        console.log('[Sidebar] Creating new note at root');
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
        console.log(`[Sidebar] Creating ${option.entityKind} folder`);

        // Check if this is a narrative (vault root)
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
        console.log('[Sidebar] Creating regular folder');
        const id = await this.folderService.createRootFolder('New Folder');
        console.log(`[Sidebar] Created folder: ${id}`);
        this.closeFolderDropdown();
    }

    async createNarrative(): Promise<void> {
        console.log('[Sidebar] Creating new Narrative Vault');
        const id = await this.folderService.createNarrativeVault('New Narrative');
        console.log(`[Sidebar] Created narrative vault: ${id}`);
    }

    // ─────────────────────────────────────────────────────────────
    // Reorder Mode
    // ─────────────────────────────────────────────────────────────

    toggleReorderMode(): void {
        this.reorderService.toggleReorderMode();
    }

    // ─────────────────────────────────────────────────────────────
    // Collapsed View Helpers
    // ─────────────────────────────────────────────────────────────

    getNodeIcon(node: TreeNode): any {
        if (node.type === 'folder') {
            if (node.isNarrativeRoot) return this.BookOpen;
            return this.Folder;
        }
        return this.FileText;
    }


    onCollapsedNodeClick(node: TreeNode): void {
        if (node.type === 'note') {
            // Open note in editor
            this.noteEditorStore.openNote(node.id);
            this.appStore.openNote(node.id);
        } else {
            // Expand sidebar to show folder contents
            this.sidebarService.open();
        }
    }

    toggleSearch() {
        if (this.viewMode() !== 'search') {
            this.setViewMode('search');
        } else {
            this.setViewMode('files');
        }
    }

    toggleNer() {
        if (this.viewMode() !== 'ner') {
            this.setViewMode('ner');
        } else {
            this.setViewMode('files');
        }
    }

    // setViewMode is defined at the top of the class with localStorage persistence

    // ─────────────────────────────────────────────────────────────
    // Graph Scan
    // ─────────────────────────────────────────────────────────────

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
        console.log(`[Sidebar] 🔄 Triggering graph scan for note: ${note.title}`);

        try {
            const result = await this.goKittService.scan(note.markdownContent || '', {
                worldId: note.narrativeId || 'global',
                parentPath: note.folderId || undefined,
            });

            console.log('[Sidebar] ✅ Graph scan complete:', result);

            // Persist to CozoDB
            if (result && !result.error) {
                const stats = this.goKittService.persistGraph(
                    result,
                    note.id,
                    note.narrativeId || undefined
                );
                console.log('[Sidebar] 💾 Graph persisted:', stats);
            }
        } catch (error) {
            console.error('[Sidebar] Graph scan failed:', error);
        } finally {
            this.isScanning.set(false);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Navigation
    // ─────────────────────────────────────────────────────────────

    navigateToCalendar(): void {
        this.router.navigate(['/calendar']);
    }

    navigateToGraph(): void {
        this.router.navigate(['/graph']);
    }
}
