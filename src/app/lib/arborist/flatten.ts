// src/app/lib/arborist/flatten.ts
// Utility to flatten nested tree → flat visible nodes array for virtual scroll

import type { TreeNode, FlatTreeNode, ExpansionState } from './types';
import { getEntityColor } from '../store/entityColorStore';

/**
 * Flatten a nested tree structure into a flat array of visible nodes.
 * Only nodes whose ancestors are all expanded are included.
 * Propagates narrativeId from vault roots to children.
 *
 * @param nodes - Root level tree nodes
 * @param expansion - Set of expanded folder IDs
 * @returns Flat array suitable for virtual scroll
 */
export function flattenTree(
    nodes: TreeNode[],
    expansion: ExpansionState
): FlatTreeNode[] {
    const result: FlatTreeNode[] = [];

    function traverse(
        node: TreeNode,
        level: number,
        parentExpanded: boolean,
        ancestorHasSibling: boolean[],
        isLastChild: boolean,
        inheritedNarrativeId: string | undefined
    ): void {
        if (!parentExpanded && level > 0) return;

        const isFolder = node.type === 'folder';
        const hasChildren = !!(node.children && node.children.length > 0);
        const isExpanded = expansion.has(node.id);

        // Determine narrativeId: if this is a vault root, use its own id
        // Otherwise inherit from parent
        let effectiveNarrativeId = inheritedNarrativeId;
        if (node.isNarrativeRoot) {
            effectiveNarrativeId = node.id;
        } else if (node.narrativeId) {
            effectiveNarrativeId = node.narrativeId;
        }

        // Compute effective color
        // Narrative roots get a special color (purple/violet)
        let effectiveColor: string | undefined;
        if (node.isNarrativeRoot) {
            effectiveColor = 'hsl(270, 70%, 60%)'; // Distinct narrative color
        } else if (node.entityKind) {
            effectiveColor = getEntityColor(node.entityKind);
        } else if (node.color) {
            effectiveColor = node.color;
        }

        const flatNode: FlatTreeNode = {
            ...node,
            level,
            isExpanded,
            isVisible: true,
            effectiveColor,
            hasChildren,
            isLastChild,
            ancestorHasSibling: [...ancestorHasSibling],
            narrativeId: effectiveNarrativeId,
        };

        result.push(flatNode);

        // Recurse into children if expanded
        if (hasChildren && isExpanded && node.children) {
            const childCount = node.children.length;
            node.children.forEach((child, idx) => {
                const childIsLast = idx === childCount - 1;
                traverse(
                    child,
                    level + 1,
                    true,
                    [...ancestorHasSibling, !isLastChild],
                    childIsLast,
                    effectiveNarrativeId
                );
            });
        }
    }

    const rootCount = nodes.length;
    nodes.forEach((node, idx) => {
        const isLast = idx === rootCount - 1;
        traverse(node, 0, true, [], isLast, node.narrativeId);
    });

    return result;
}

/**
 * Toggle expansion state for a node
 */
export function toggleExpansion(
    expansion: ExpansionState,
    nodeId: string
): ExpansionState {
    const newExpansion = new Set(expansion);
    if (newExpansion.has(nodeId)) {
        newExpansion.delete(nodeId);
    } else {
        newExpansion.add(nodeId);
    }
    return newExpansion;
}

/**
 * Expand all folders in the tree
 */
export function expandAll(nodes: TreeNode[]): ExpansionState {
    const expansion = new Set<string>();

    function collectFolders(node: TreeNode): void {
        if (node.type === 'folder') {
            expansion.add(node.id);
            node.children?.forEach(collectFolders);
        }
    }

    nodes.forEach(collectFolders);
    return expansion;
}

/**
 * Collapse all folders
 */
export function collapseAll(): ExpansionState {
    return new Set<string>();
}
