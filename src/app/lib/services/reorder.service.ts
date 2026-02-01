// src/app/lib/services/reorder.service.ts
// Service for managing drag-and-drop reorder mode with Swapy

import { Injectable, signal, inject, Injector, runInInjectionContext } from '@angular/core';
import { createSwapy, Swapy, SwapEvent } from 'swapy';
import type { FlatTreeNode } from '../arborist/types';
import { reorderFolder, reorderNote, moveFolderToParent, moveNoteToFolder, swapItems } from '../dexie/operations';

export type ReorderScope = 'siblings-only' | 'cross-folder';

@Injectable({
    providedIn: 'root'
})
export class ReorderService {
    // State
    isReorderMode = signal(false);
    reorderScope = signal<ReorderScope>('siblings-only');

    // Swapy instance
    private swapy: Swapy | null = null;
    private containerElement: HTMLElement | null = null;

    // Track drag state
    isDragging = signal(false);
    draggedNodeId = signal<string | null>(null);

    constructor(private injector: Injector) { }

    /**
     * Enable reorder mode and initialize Swapy on a container.
     * @param container - The HTML element containing reorderable items
     * @param scope - Whether to allow cross-folder moves or siblings only
     */
    /**
     * Enable reorder mode and initialize Swapy on a container.
     * @param container - The HTML element containing reorderable items
     * @param scope - Whether to allow cross-folder moves or siblings only
     */
    enableReorderMode(container: HTMLElement, scope: ReorderScope = 'siblings-only'): void {
        // Cleanup existing instance without notifying listeners (avoids infinite loop)
        this.cleanupSwapy();

        this.containerElement = container;
        this.reorderScope.set(scope);

        // Initialize Swapy
        this.swapy = createSwapy(container, {
            animation: 'dynamic'
        });

        // Listen for swap events
        this.swapy.onSwap((event: SwapEvent) => {
            runInInjectionContext(this.injector, async () => {
                await this.handleSwap(event);
            });
        });

        this.isReorderMode.set(true);
        console.log('[ReorderService] Reorder mode enabled');
    }

    /**
     * Disable reorder mode and clean up Swapy.
     */
    disableReorderMode(): void {
        this.cleanupSwapy();
        this.containerElement = null;
        this.isReorderMode.set(false);
        this.isDragging.set(false);
        this.draggedNodeId.set(null);
        console.log('[ReorderService] Reorder mode disabled');
    }

    /**
     * Internally destroy Swapy instance without changing active mode signals.
     */
    private cleanupSwapy(): void {
        if (this.swapy) {
            this.swapy.destroy();
            this.swapy = null;
        }
    }

    /**
     * Toggle reorder mode on/off.
     */
    toggleReorderMode(): void {
        if (this.isReorderMode()) {
            this.disableReorderMode();
        } else if (this.containerElement) {
            this.enableReorderMode(this.containerElement, this.reorderScope());
        }
    }

    /**
     * Set the container element for reordering.
     * This should be called before enableReorderMode.
     */
    setContainer(container: HTMLElement | null): void {
        this.containerElement = container;
    }

    /**
     * Handle a swap event from Swapy.
     */
    private async handleSwap(event: SwapEvent): Promise<void> {
        // Swapy event properties vary by version - use type assertion
        const swapEvent = event as any;
        const slotId = swapEvent.slotId || swapEvent.destinationId;
        const itemId = swapEvent.itemId || swapEvent.sourceId;

        if (!slotId || !itemId) {
            console.warn('[ReorderService] Invalid swap data', event);
            return;
        }

        // Extract the actual node IDs from the slot/item IDs
        // Format: "slot-{id}" and "item-{id}"
        const sourceId = this.draggedNodeId();
        const targetId = this.extractNodeId(itemId);

        if (!sourceId || sourceId === targetId) return;

        try {
            // Determine if this is same-container or cross-container
            const sourceNode = this.findNodeById(sourceId);
            const targetNode = this.findNodeById(targetId);

            if (!sourceNode || !targetNode) {
                console.warn('[ReorderService] Could not find nodes for swap');
                return;
            }

            if (sourceNode.type !== targetNode.type) {
                // Can't swap folder with note
                console.warn('[ReorderService] Cannot swap different node types');
                return;
            }

            // Check if same parent (sibling reorder) or different parent (cross-container move)
            const sameParent = this.areNodesInSameContainer(sourceNode, targetNode);

            if (sameParent) {
                // Simple swap of orders
                await swapItems(sourceId, targetId, sourceNode.type);
                console.log(`[ReorderService] Swapped ${sourceNode.type}s: ${sourceId} ↔ ${targetId}`);
            } else if (this.reorderScope() === 'cross-folder') {
                // Cross-container move
                await this.handleCrossContainerMove(sourceNode, targetNode);
            } else {
                console.warn('[ReorderService] Cross-container moves not allowed in current scope');
            }
        } catch (error) {
            console.error('[ReorderService] Swap failed:', error);
        }
    }

    /**
     * Extract the node ID from a Swapy slot/item ID.
     */
    private extractNodeId(swapyId: string): string {
        // Swapy IDs are formatted as "slot-{id}" or "item-{id}"
        // Extract the actual ID after the prefix
        const match = swapyId.match(/^(?:slot|item)-(.+)$/);
        return match ? match[1] : swapyId;
    }

    /**
     * Find a node by its ID in the current tree.
     */
    private findNodeById(id: string): FlatTreeNode | null {
        const nodes = this.getCurrentNodes();
        return nodes.find(n => n.id === id) || null;
    }

    /**
     * Check if two nodes are in the same container (same parent folder).
     */
    private areNodesInSameContainer(node1: FlatTreeNode, node2: FlatTreeNode): boolean {
        if (node1.type !== node2.type) return false;

        if (node1.type === 'folder') {
            // Compare parentId - access from the extended node data
            const parent1 = (node1 as any).parentId || '';
            const parent2 = (node2 as any).parentId || '';
            return parent1 === parent2;
        } else {
            // Compare folderId
            const folder1 = (node1 as any).folderId || '';
            const folder2 = (node2 as any).folderId || '';
            return folder1 === folder2;
        }
    }

    /**
     * Handle moving a node to a different container.
     */
    private async handleCrossContainerMove(source: FlatTreeNode, target: FlatTreeNode): Promise<void> {
        if (source.type === 'folder') {
            const targetParentId = (target as any).parentId || '';
            const siblings = await this.getFolderSiblings(targetParentId);
            const targetIndex = siblings.findIndex(f => f.id === target.id);
            await moveFolderToParent(source.id, targetParentId, Math.max(0, targetIndex));
        } else {
            const targetFolderId = (target as any).folderId || '';
            const siblings = await this.getNoteSiblings(targetFolderId);
            const targetIndex = siblings.findIndex(n => n.id === target.id);
            await moveNoteToFolder(source.id, targetFolderId, Math.max(0, targetIndex));
        }
    }

    /**
     * Get sibling folders for a parent.
     */
    private async getFolderSiblings(parentId: string): Promise<Array<{ id: string; order: number }>> {
        const { db } = await import('../dexie/db');
        return db.folders
            .where('parentId')
            .equals(parentId)
            .sortBy('order');
    }

    /**
     * Get sibling notes for a folder.
     */
    private async getNoteSiblings(folderId: string): Promise<Array<{ id: string; order: number }>> {
        const { db } = await import('../dexie/db');
        return db.notes
            .where('folderId')
            .equals(folderId)
            .sortBy('order');
    }

    // Storage for current nodes (set by component)
    private currentNodes: FlatTreeNode[] = [];

    /**
     * Set the current list of nodes (called by component).
     */
    setCurrentNodes(nodes: FlatTreeNode[]): void {
        this.currentNodes = nodes;
    }

    /**
     * Get the current list of nodes.
     */
    private getCurrentNodes(): FlatTreeNode[] {
        return this.currentNodes;
    }

    /**
     * Set the currently dragged node ID.
     * Called by the component on drag start.
     */
    setDraggedNodeId(id: string | null): void {
        this.draggedNodeId.set(id);
        this.isDragging.set(id !== null);
    }
}
