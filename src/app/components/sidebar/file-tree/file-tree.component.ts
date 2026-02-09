// src/app/components/sidebar/file-tree/file-tree.component.ts
// Main file tree component with virtual scroll and context menu - WIRED to Dexie

import { Component, signal, computed, Input, inject, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect, Injector, runInInjectionContext, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollerModule } from 'primeng/scroller';
import { LucideAngularModule, Plus, FolderPlus, Pencil, Trash2, Users, MapPin, Calendar, Film, Zap, GitBranch, Layers, BookOpen, Clock, Lightbulb, Package, Shield, FileText } from 'lucide-angular';
import { TreeNodeComponent } from './tree-node.component';
import type { TreeNode, FlatTreeNode, ExpansionState } from '../../../lib/arborist/types';
import type { AllowedSubfolderDef, AllowedNoteTypeDef } from '../../../lib/dexie/db';
import { flattenTree, toggleExpansion } from '../../../lib/arborist/flatten';
import { FolderService } from '../../../lib/services/folder.service';
import { NotesService } from '../../../lib/dexie/notes.service';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { ScopeService } from '../../../lib/services/scope.service';
import { ReorderService } from '../../../lib/services/reorder.service';
import { AppStore } from '../../../lib/ngrx';

@Component({
    selector: 'app-file-tree',
    standalone: true,
    imports: [CommonModule, ScrollerModule, TreeNodeComponent, LucideAngularModule],
    template: `
        <div class="h-full w-full flex flex-col relative" #treeContainer>
            <!-- Virtual Scroller -->
            <p-scroller
                [items]="flatNodes()"
                [itemSize]="28"
                scrollHeight="100%"
                styleClass="h-full w-full"
                [lazy]="false">
                <ng-template pTemplate="item" let-node let-options="options">
                    <!-- Swapy slot wrapper (only in reorder mode) -->
                    <div
                        [attr.data-swapy-slot]="reorderService.isReorderMode() ? 'slot-' + node.id : null"
                        class="w-full">
                        <div
                            [attr.data-swapy-item]="reorderService.isReorderMode() ? 'item-' + node.id : null"
                            class="w-full">
                            <app-tree-node
                                [node]="node"
                                [selected]="selectedId() === node.id"
                                [isEditing]="editingNodeId() === node.id"
                                [isReorderMode]="reorderService.isReorderMode()"
                                [isBeingDragged]="reorderService.draggedNodeId() === node.id"
                                (toggle)="onToggle($event)"
                                (select)="onSelect($event)"
                                (menuClick)="onMenuClick($event)"
                                (startRename)="onStartRename($event)"
                                (rename)="onRename($event)">
                            </app-tree-node>
                        </div>
                    </div>
                </ng-template>
            </p-scroller>

            <!-- Context Menu Dropdown -->
            <div
                *ngIf="menuOpen()"
                class="fixed z-[1000] min-w-56 bg-popover border border-border rounded-lg shadow-lg py-1 text-sm"
                [style.top.px]="menuPosition().y"
                [style.left.px]="menuPosition().x">

                <!-- Folder Actions (Creation) -->
                <ng-container *ngIf="menuNode()?.type === 'folder'">
                    <button class="menu-item" (click)="handleAction('new-note')">
                        <lucide-icon [img]="Plus" size="14" class="text-muted-foreground"></lucide-icon>
                        New note
                    </button>
                    <button class="menu-item" (click)="handleAction('new-subfolder')">
                        <lucide-icon [img]="FolderPlus" size="14" class="text-muted-foreground"></lucide-icon>
                        New subfolder
                    </button>

                    <!-- Typed Subfolders (from schema) -->
                    <ng-container *ngIf="menuAllowedSubfolders().length > 0">
                        <div class="h-px bg-border my-1"></div>
                        <button
                            *ngFor="let subfolder of menuAllowedSubfolders()"
                            class="menu-item"
                            (click)="handleAddTypedFolder(subfolder)">
                            <lucide-icon [img]="getIconForKind(subfolder.entityKind)" size="14"
                                [style.color]="getColorForKind(subfolder.entityKind)"></lucide-icon>
                            Add {{ subfolder.label }}
                        </button>
                    </ng-container>

                    <!-- Typed Notes (from schema) -->
                    <ng-container *ngIf="menuAllowedNoteTypes().length > 0">
                        <div class="h-px bg-border my-1"></div>
                        <button
                            *ngFor="let noteType of menuAllowedNoteTypes()"
                            class="menu-item"
                            (click)="handleAddTypedNote(noteType)">
                            <lucide-icon [img]="getIconForKind(noteType.entityKind)" size="14"
                                [style.color]="getColorForKind(noteType.entityKind)"></lucide-icon>
                            New {{ noteType.label }}
                        </button>
                    </ng-container>
                    
                    <div class="h-px bg-border my-1"></div>
                </ng-container>

                <!-- Common Actions (Rename/Delete) -->
                <button class="menu-item" (click)="handleAction('rename')">
                    <lucide-icon [img]="Pencil" size="14" class="text-muted-foreground"></lucide-icon>
                    Rename
                </button>
                <button class="menu-item text-destructive" (click)="handleAction('delete')">
                    <lucide-icon [img]="Trash2" size="14" class="text-destructive"></lucide-icon>
                    Delete {{ menuNode()?.type === 'folder' ? 'folder' : 'note' }}
                </button>
            </div>

            <!-- Backdrop to close menu -->
            <div
                *ngIf="menuOpen()"
                class="fixed inset-0 z-[999]"
                (click)="closeMenu()">
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            height: 100%;
            width: 100%;
        }

        ::ng-deep .p-scroller {
            height: 100% !important;
        }

        ::ng-deep .p-scroller-content {
            padding: 0 !important;
        }

        .menu-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            width: 100%;
            padding: 0.375rem 0.75rem;
            text-align: left;
            cursor: pointer;
            transition: background-color 0.1s;
        }

        .menu-item:hover {
            background-color: hsl(var(--accent));
        }
    `]
})
export class FileTreeComponent implements AfterViewInit, OnDestroy {
    private folderService = inject(FolderService);
    private notesService = inject(NotesService);
    private noteEditorStore = inject(NoteEditorStore);
    private scopeService = inject(ScopeService);
    reorderService = inject(ReorderService);
    private injector = inject(Injector);
    private destroyRef = inject(DestroyRef);
    private appStore = inject(AppStore);

    // ViewChild for Swapy container
    @ViewChild('treeContainer') treeContainer!: ElementRef<HTMLDivElement>;

    // Input: the nested tree data
    @Input() set tree(value: TreeNode[]) {
        this._tree.set(value);
    }

    // State
    private _tree = signal<TreeNode[]>([]);
    private expansion = signal<ExpansionState>(new Set());
    selectedId = signal<string | null>(null);
    editingNodeId = signal<string | null>(null);

    // Menu state
    menuOpen = signal(false);
    menuPosition = signal({ x: 0, y: 0 });
    menuNode = signal<FlatTreeNode | null>(null);
    menuAllowedSubfolders = signal<AllowedSubfolderDef[]>([]);
    menuAllowedNoteTypes = signal<AllowedNoteTypeDef[]>([]);

    // Icons
    readonly Plus = Plus;
    readonly FolderPlus = FolderPlus;
    readonly Pencil = Pencil;
    readonly Trash2 = Trash2;
    readonly Users = Users;
    readonly MapPin = MapPin;
    readonly Calendar = Calendar;
    readonly Film = Film;
    readonly Zap = Zap;
    readonly GitBranch = GitBranch;
    readonly Layers = Layers;
    readonly BookOpen = BookOpen;
    readonly Clock = Clock;
    readonly Lightbulb = Lightbulb;
    readonly Package = Package;
    readonly Shield = Shield;
    readonly FileText = FileText;

    // Icon mapping
    private iconMap: Record<string, any> = {
        'NARRATIVE': BookOpen,
        'CHARACTER': Users,
        'LOCATION': MapPin,
        'ITEM': Package,
        'CONCEPT': Lightbulb,
        'EVENT': Calendar,
        'TIMELINE': Clock,
        'ARC': GitBranch,
        'ACT': Layers,
        'CHAPTER': BookOpen,
        'SCENE': Film,
        'BEAT': Zap,
        'NPC': Users,
        'FACTION': Shield,
    };

    // Color mapping
    private colorMap: Record<string, string> = {
        'NARRATIVE': 'hsl(270, 70%, 60%)',
        'CHARACTER': 'hsl(200, 80%, 60%)',
        'LOCATION': 'hsl(140, 60%, 50%)',
        'ITEM': 'hsl(40, 80%, 60%)',
        'CONCEPT': 'hsl(60, 70%, 50%)',
        'EVENT': 'hsl(320, 70%, 60%)',
        'TIMELINE': 'hsl(180, 60%, 50%)',
        'ARC': 'hsl(280, 60%, 55%)',
        'ACT': 'hsl(220, 70%, 60%)',
        'CHAPTER': 'hsl(30, 70%, 55%)',
        'SCENE': 'hsl(350, 65%, 55%)',
        'BEAT': 'hsl(50, 80%, 55%)',
        'NPC': 'hsl(190, 70%, 55%)',
        'FACTION': 'hsl(0, 65%, 55%)',
    };

    getIconForKind(kind: string): any {
        return this.iconMap[kind] || FolderPlus;
    }

    getColorForKind(kind: string): string {
        return this.colorMap[kind] || 'currentColor';
    }

    // Computed: flattened visible nodes
    flatNodes = computed(() => {
        return flattenTree(this._tree(), this.expansion());
    });

    onToggle(nodeId: string): void {
        this.expansion.update(exp => toggleExpansion(exp, nodeId));
    }

    expandNode(nodeId: string): void {
        this.expansion.update(exp => {
            const newExp = new Set(exp);
            newExp.add(nodeId);
            return newExp;
        });
    }

    onSelect(node: FlatTreeNode): void {
        this.selectedId.set(node.id);

        // Update active scope when selection changes
        this.scopeService.setScopeFromNode(node);

        if (node.type === 'folder') {
            // Toggle folder expansion
            this.onToggle(node.id);
        } else if (node.type === 'note') {
            // Open note in editor
            this.noteEditorStore.openNote(node.id);
            this.appStore.openNote(node.id);
        }
    }

    onStartRename(node: FlatTreeNode): void {
        this.editingNodeId.set(node.id);
    }

    async onRename(event: { node: FlatTreeNode; newName: string }): Promise<void> {
        const { node, newName } = event;
        this.editingNodeId.set(null); // Clear editing state

        // Only save if name actually changed
        if (newName && newName !== node.name) {
            try {
                if (node.type === 'folder') {
                    await this.folderService.updateFolder(node.id, { name: newName });
                    console.log(`[FileTree] Renamed folder "${node.name}" → "${newName}"`);
                } else {
                    await this.notesService.updateNote(node.id, { title: newName });
                    console.log(`[FileTree] Renamed note "${node.name}" → "${newName}"`);
                }
            } catch (e) {
                console.error('[FileTree] Rename failed:', e);
            }
        }
    }

    async onMenuClick(event: { node: FlatTreeNode; event: MouseEvent }): Promise<void> {
        const { node, event: mouseEvent } = event;

        // Load allowed subfolders/note types from schema
        let subfolders: AllowedSubfolderDef[] = [];
        let noteTypes: AllowedNoteTypeDef[] = [];

        if (node.entityKind) {
            subfolders = await this.folderService.getAllowedSubfolders(node.entityKind);
            noteTypes = await this.folderService.getAllowedNoteTypes(node.entityKind);
        }

        this.menuAllowedSubfolders.set(subfolders);
        this.menuAllowedNoteTypes.set(noteTypes);
        this.menuNode.set(node);
        this.menuPosition.set({ x: mouseEvent.clientX, y: mouseEvent.clientY });
        this.menuOpen.set(true);
    }

    closeMenu(): void {
        this.menuOpen.set(false);
        this.menuNode.set(null);
    }

    // ─────────────────────────────────────────────────────────────
    // WIRED ACTIONS - Now actually do things!
    // ─────────────────────────────────────────────────────────────

    async handleAction(type: 'new-note' | 'new-subfolder' | 'rename' | 'delete'): Promise<void> {
        const node = this.menuNode();
        if (!node) return;

        switch (type) {
            case 'new-note':
                await this.createNoteInFolder(node);
                this.expandNode(node.id);
                break;
            case 'new-subfolder':
                await this.createSubfolder(node);
                this.expandNode(node.id);
                break;
            case 'rename':
                this.editingNodeId.set(node.id);
                break;
            case 'delete':
                if (node.type === 'folder') {
                    await this.deleteFolder(node);
                } else {
                    await this.deleteNote(node);
                }
                break;
        }

        this.closeMenu();
    }

    async handleAddTypedFolder(subfolder: AllowedSubfolderDef): Promise<void> {
        const node = this.menuNode();
        if (!node) return;

        console.log(`[FileTree] Creating ${subfolder.entityKind} folder under ${node.name}`);

        await this.folderService.createTypedSubfolder(
            node.id,
            subfolder.entityKind,
            subfolder.label
        );
        this.expandNode(node.id);

        this.closeMenu();
    }

    async handleAddTypedNote(noteType: AllowedNoteTypeDef): Promise<void> {
        const node = this.menuNode();
        if (!node) return;

        console.log(`[FileTree] Creating ${noteType.entityKind} note in ${node.name}`);

        await this.notesService.createNote({
            worldId: '',
            title: `New ${noteType.label}`,
            content: '{}',
            markdownContent: '',
            folderId: node.id,                      // NESTED under this folder!
            entityKind: noteType.entityKind,
            entitySubtype: '',
            isEntity: true,                         // Entity notes are entities
            isPinned: false,
            favorite: false,
            ownerId: '',
            narrativeId: node.narrativeId || '',    // Inherit scope from parent
        });
        this.expandNode(node.id);

        this.closeMenu();
    }

    // ─────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────

    private async createNoteInFolder(folder: FlatTreeNode): Promise<void> {
        console.log(`[FileTree] Creating note in folder: ${folder.name}`);

        await this.notesService.createNote({
            worldId: '',
            title: 'Untitled Note',
            content: '{}',
            markdownContent: '',
            folderId: folder.id,                    // NESTED under this folder!
            entityKind: '',
            entitySubtype: '',
            isEntity: false,
            isPinned: false,
            favorite: false,
            ownerId: '',
            narrativeId: folder.narrativeId || '',  // Inherit scope
        });
    }

    private async createSubfolder(parent: FlatTreeNode): Promise<void> {
        console.log(`[FileTree] Creating subfolder under: ${parent.name}`);

        // Use the typed subfolder creation if parent has entityKind,
        // otherwise create a plain subfolder
        if (parent.entityKind) {
            await this.folderService.createTypedSubfolder(
                parent.id,
                parent.entityKind,  // Inherit parent's kind
                'New Folder'
            );
        } else {
            await this.folderService.createSubfolder(parent.id, 'New Folder');
        }
    }

    private async deleteFolder(folder: FlatTreeNode): Promise<void> {
        console.log(`[FileTree] Deleting folder: ${folder.name}`);

        // Delete with children
        await this.folderService.deleteFolder(folder.id, true);
    }

    private async deleteNote(note: FlatTreeNode): Promise<void> {
        console.log(`[FileTree] Deleting note: ${note.name}`);
        await this.notesService.deleteNote(note.id);
    }

    // ─────────────────────────────────────────────────────────────
    // Lifecycle Hooks for Swapy Integration
    // ─────────────────────────────────────────────────────────────

    ngAfterViewInit(): void {
        // Set container for reorder service
        if (this.treeContainer) {
            this.reorderService.setContainer(this.treeContainer.nativeElement);
        }

        // Watch for reorder mode changes - run in injection context
        runInInjectionContext(this.injector, () => {
            const reorderEffect = effect(() => {
                if (this.reorderService.isReorderMode()) {
                    // Enable Swapy when reorder mode is active
                    if (this.treeContainer) {
                        this.reorderService.enableReorderMode(this.treeContainer.nativeElement, 'siblings-only');
                    }
                } else {
                    // Swapy is disabled via service
                }
            });

            // Clean up effect when component is destroyed
            this.destroyRef.onDestroy(() => {
                reorderEffect.destroy();
            });
        });
    }

    ngOnDestroy(): void {
        // Clean up Swapy
        this.reorderService.disableReorderMode();
    }
}
