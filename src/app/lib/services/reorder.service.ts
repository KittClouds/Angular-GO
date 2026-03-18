// src/app/lib/services/reorder.service.ts
// Service for managing drag-and-drop reorder mode with Swapy

import { Injectable, signal, Injector, runInInjectionContext } from '@angular/core';
import { createSwapy, Swapy, SwapEvent } from 'swapy';
import type { FlatTreeNode } from '../arborist/types';
import {
    moveFolderToParent,
    moveNoteToFolder,
    swapItems,
    getFolderChildren,
    getNotesByFolder
} from '../operations';

export type ReorderScope = 'siblings-only' | 'cross-folder';

@Injectable({
    providedIn: 'root'
})
export class ReorderService {
    isReorderMode = signal(false);
    reorderScope = signal<ReorderScope>('cross-folder');

    private swapy: Swapy | null = null;
    private containerElement: HTMLElement | null = null;

    isDragging = signal(false);
    draggedNodeId = signal<string | null>(null);

    private currentNodes: FlatTreeNode[] = [];

    constructor(private injector: Injector) { }

    enableReorderMode(container: HTMLElement, scope: ReorderScope = 'siblings-only'): void {
        this.cleanupSwapy();

        this.containerElement = container;
        this.reorderScope.set(scope);
        this.isReorderMode.set(true);

        setTimeout(() => {
            if (!this.containerElement || !this.isReorderMode()) return;

            this.swapy = createSwapy(this.containerElement, {
                animation: 'dynamic'
            });

            this.swapy.onSwapStart((event) => {
                this.setDraggedNodeId(this.extractNodeId(event.draggingItem));
            });

            this.swapy.onSwap((event: SwapEvent) => {
                runInInjectionContext(this.injector, async () => {
                    await this.handleSwap(event);
                });
            });

            this.swapy.onSwapEnd(() => {
                this.setDraggedNodeId(null);
            });

            console.log('[ReorderService] Reorder mode enabled & Swapy initialized');
        }, 150);
    }

    disableReorderMode(): void {
        this.cleanupSwapy();
        this.containerElement = null;
        this.isReorderMode.set(false);
        this.isDragging.set(false);
        this.draggedNodeId.set(null);
        console.log('[ReorderService] Reorder mode disabled');
    }

    update(): void {
        if (this.swapy && this.isReorderMode()) {
            this.swapy.update();
        }
    }

    private cleanupSwapy(): void {
        if (this.swapy) {
            this.swapy.destroy();
            this.swapy = null;
        }
    }

    toggleReorderMode(scope: ReorderScope = 'cross-folder'): void {
        if (this.isReorderMode()) {
            this.disableReorderMode();
        } else if (this.containerElement) {
            this.enableReorderMode(this.containerElement, scope);
        }
    }

    setContainer(container: HTMLElement | null): void {
        this.containerElement = container;
    }

    setCurrentNodes(nodes: FlatTreeNode[]): void {
        this.currentNodes = nodes;
    }

    setDraggedNodeId(id: string | null): void {
        this.draggedNodeId.set(id);
        this.isDragging.set(id !== null);
    }

    private async handleSwap(event: SwapEvent): Promise<void> {
        const sourceId = this.extractNodeId(event.draggingItem || this.draggedNodeId() || '');
        const targetId = this.extractNodeId(event.swappedWithItem || event.toSlot || '');

        if (!sourceId || !targetId || sourceId === targetId) {
            return;
        }

        try {
            const sourceNode = this.findNodeById(sourceId);
            const targetNode = this.findNodeById(targetId);

            if (!sourceNode || !targetNode) {
                console.warn('[ReorderService] Could not find nodes for swap');
                return;
            }

            const sameType = sourceNode.type === targetNode.type;
            const sameParent = sameType && this.areNodesInSameContainer(sourceNode, targetNode);

            // Turn off Swapy to prevent its own DOM animation from racing with Angular's structural DOM teardown.
            // We will restart it after Angular's reactive changes settle.
            this.cleanupSwapy();

            if (sameType && sameParent) {
                await swapItems(sourceId, targetId, sourceNode.type);
                console.log(`[ReorderService] Swapped ${sourceNode.type}s: ${sourceId} <-> ${targetId}`);
            } else {
                if (this.reorderScope() !== 'cross-folder') {
                    console.warn('[ReorderService] Cross-container moves not allowed in current scope');
                } else {
                    await this.handleCrossContainerMove(sourceNode, targetNode);
                }
            }

            // After DB operations conclude, give Angular a tick to repaint the `<ng-container *ngFor>` DOM nodes,
            // then resurrect Swapy cleanly on the fresh DOM.
            setTimeout(() => {
                if (this.containerElement && this.isReorderMode()) {
                    this.enableReorderMode(this.containerElement, this.reorderScope());
                }
            }, 50);

        } catch (error) {
            console.error('[ReorderService] Swap failed:', error);
            // Attempt to recover Swapy if the backend op fails
            setTimeout(() => {
                if (this.containerElement && this.isReorderMode()) {
                    this.enableReorderMode(this.containerElement, this.reorderScope());
                }
            }, 50);
        }
    }

    private extractNodeId(swapyId: string): string {
        const match = swapyId.match(/^(?:slot|item)-(.+)$/);
        return match ? match[1] : swapyId;
    }

    private findNodeById(id: string): FlatTreeNode | null {
        return this.currentNodes.find(n => n.id === id) || null;
    }

    private areNodesInSameContainer(node1: FlatTreeNode, node2: FlatTreeNode): boolean {
        if (node1.type !== node2.type) return false;

        if (node1.type === 'folder') {
            const parent1 = (node1 as any).parentId || '';
            const parent2 = (node2 as any).parentId || '';
            return parent1 === parent2;
        }

        const folder1 = (node1 as any).folderId || '';
        const folder2 = (node2 as any).folderId || '';
        return folder1 === folder2;
    }

    private async handleCrossContainerMove(source: FlatTreeNode, target: FlatTreeNode): Promise<void> {
        if (source.type === 'folder') {
            if (target.type !== 'folder') {
                console.warn('[ReorderService] Folder moves require a folder target');
                return;
            }

            const targetParentId = (target as any).parentId || '';
            const siblings = await this.getFolderSiblings(targetParentId);
            const targetIndex = siblings.findIndex(f => f.id === target.id);
            await moveFolderToParent(source.id, targetParentId, Math.max(0, targetIndex));
            return;
        }

        const targetFolderId = target.type === 'folder'
            ? target.id
            : ((target as any).folderId || '');
        const siblings = await this.getNoteSiblings(targetFolderId);
        const targetIndex = target.type === 'folder'
            ? siblings.length
            : siblings.findIndex(n => n.id === target.id);

        await moveNoteToFolder(
            source.id,
            targetFolderId,
            targetIndex === -1 ? siblings.length : Math.max(0, targetIndex)
        );
    }

    private async getFolderSiblings(parentId: string): Promise<Array<{ id: string; order: number }>> {
        const folders = await getFolderChildren(parentId);
        return folders.sort((a, b) => a.order - b.order);
    }

    private async getNoteSiblings(folderId: string): Promise<Array<{ id: string; order: number }>> {
        const notes = await getNotesByFolder(folderId);
        return notes.sort((a, b) => a.order - b.order);
    }
}


