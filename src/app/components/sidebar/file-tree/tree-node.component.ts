// src/app/components/sidebar/file-tree/tree-node.component.ts
// Individual tree row - VS Code style with connector lines

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Folder, FolderOpen, FileText, Star, BookOpen, MoreVertical } from 'lucide-angular';
import type { FlatTreeNode } from '../../../lib/arborist/types';

@Component({
    selector: 'app-tree-node',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    template: `
        <div
            class="tree-node relative flex items-center gap-1.5 h-7 w-full group pr-2 cursor-pointer transition-colors duration-100"
            [class.bg-accent]="selected"
            [class.hover:bg-muted/50]="!selected"
            [class.narrative-root]="node.isNarrativeRoot"
            [style.paddingLeft.px]="node.level * 16"
            (click)="onNodeClick()">

            <!-- Connector Lines (VS Code structured style) -->
            <ng-container *ngIf="node.level > 0">
                <!-- Ancestor vertical guides -->
                <ng-container *ngFor="let hasSibling of node.ancestorHasSibling; let i = index">
                    <div
                        *ngIf="hasSibling"
                        class="absolute top-0 bottom-0 opacity-30"
                        [style.left.px]="i * 16 + 8"
                        [style.width.px]="1"
                        [style.backgroundColor]="node.effectiveColor || 'currentColor'">
                    </div>
                </ng-container>

                <!-- Current level vertical line -->
                <div
                    class="absolute opacity-30"
                    [style.left.px]="(node.level - 1) * 16 + 8"
                    [style.top]="0"
                    [style.bottom]="node.isLastChild ? '50%' : '0'"
                    [style.width.px]="1"
                    [style.backgroundColor]="node.effectiveColor || 'currentColor'">
                </div>
            </ng-container>

            <!-- Toggle Dot (folders only) -->
            <button
                *ngIf="node.type === 'folder'"
                class="flex items-center justify-center shrink-0 z-10 w-4 h-4 transition-all duration-150 hover:scale-110"
                [class.invisible]="!node.hasChildren"
                (click)="onToggle($event)">
                <!-- Expanded = hollow ring -->
                <div
                    *ngIf="node.isExpanded"
                    class="w-2 h-2 rounded-full border-[1.5px] transition-all"
                    [style.borderColor]="node.effectiveColor || 'currentColor'">
                </div>
                <!-- Collapsed = filled dot -->
                <div
                    *ngIf="!node.isExpanded"
                    class="w-2 h-2 rounded-full transition-all"
                    [style.backgroundColor]="node.effectiveColor || 'currentColor'">
                </div>
            </button>

            <!-- Spacer for notes (align with folder toggles) -->
            <div *ngIf="node.type === 'note'" class="w-4 h-4 shrink-0"></div>

            <!-- Icon: Narrative roots get special BookOpen icon -->
            <lucide-icon
                *ngIf="node.type === 'folder' && node.isNarrativeRoot"
                [img]="BookOpen"
                size="14"
                class="shrink-0 z-10"
                [style.color]="node.effectiveColor">
            </lucide-icon>
            <lucide-icon
                *ngIf="node.type === 'folder' && !node.isNarrativeRoot"
                [img]="node.isExpanded ? FolderOpen : Folder"
                size="14"
                class="shrink-0 z-10"
                [style.color]="node.effectiveColor">
            </lucide-icon>
            <lucide-icon
                *ngIf="node.type === 'note'"
                [img]="FileText"
                size="14"
                class="shrink-0 z-10 text-muted-foreground">
            </lucide-icon>

            <!-- Name: Narrative roots and typed roots get colored text -->
            <span
                class="truncate text-xs flex-1 z-10"
                [class.font-semibold]="node.isNarrativeRoot"
                [style.color]="(node.type === 'folder' && (node.isTypedRoot || node.isNarrativeRoot)) ? node.effectiveColor : null">
                {{ node.name || (node.type === 'folder' ? 'New Folder' : 'Untitled') }}
            </span>

            <!-- Narrative Badge (special) -->
            <span
                *ngIf="node.isNarrativeRoot"
                class="text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 z-10 uppercase tracking-wider"
                style="background-color: hsl(270, 70%, 60%, 0.15); color: hsl(270, 70%, 60%);">
                NARRATIVE
            </span>

            <!-- Entity Badge (non-narrative) -->
            <span
                *ngIf="node.entityKind && !node.isNarrativeRoot"
                class="text-[9px] px-1 py-0.5 rounded font-semibold shrink-0 z-10 uppercase tracking-wider"
                [style.backgroundColor]="'hsl(var(--entity-' + node.entityKind.toLowerCase() + ') / 0.15)'"
                [style.color]="'hsl(var(--entity-' + node.entityKind.toLowerCase() + '))'">
                {{ node.entitySubtype ? (node.entityKind + ':' + node.entitySubtype) : node.entityKind }}
            </span>

            <!-- Favorite Star -->
            <lucide-icon
                *ngIf="node.favorite"
                [img]="Star"
                size="12"
                class="shrink-0 z-10 fill-yellow-400 text-yellow-400">
            </lucide-icon>

            <!-- Kebab Menu (appears on hover) -->
            <button
                class="shrink-0 z-10 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
                (click)="onMenuClick($event)">
                <lucide-icon [img]="MoreVertical" size="14" class="text-muted-foreground"></lucide-icon>
            </button>
        </div>
    `,
    styles: [`
        :host {
            display: block;
        }
        .narrative-root {
            background: linear-gradient(90deg, hsl(270, 70%, 60%, 0.05) 0%, transparent 100%);
        }
    `]
})
export class TreeNodeComponent {
    @Input() node!: FlatTreeNode;
    @Input() selected = false;

    @Output() toggle = new EventEmitter<string>();
    @Output() select = new EventEmitter<FlatTreeNode>();
    @Output() menuClick = new EventEmitter<{ node: FlatTreeNode; event: MouseEvent }>();

    // Icons
    readonly Folder = Folder;
    readonly FolderOpen = FolderOpen;
    readonly FileText = FileText;
    readonly Star = Star;
    readonly BookOpen = BookOpen;
    readonly MoreVertical = MoreVertical;

    onToggle(event: Event): void {
        event.stopPropagation();
        if (this.node.type === 'folder') {
            this.toggle.emit(this.node.id);
        }
    }

    onNodeClick(): void {
        this.select.emit(this.node);
    }

    onMenuClick(event: MouseEvent): void {
        event.stopPropagation();
        this.menuClick.emit({ node: this.node, event });
    }
}

