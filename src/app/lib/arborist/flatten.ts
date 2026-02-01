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

    // Global counters per narrative (Act 1, 2... Chapter 1, 2... Arc 1, 2...)
    const narrativeCounters = new Map<string, { acts: number, chapters: number, arcs: number }>();

    function traverse(
        node: TreeNode,
        level: number,
        parentVisible: boolean,
        ancestorHasSibling: boolean[],
        isLastChild: boolean,
        inheritedNarrativeId: string | undefined,
        passedManuscriptIndex: number | undefined,
        parentKind?: string
    ): void {
        // NOTE: We do NOT return early even if !parentVisible. 
        // We must traverse hidden nodes to update global counters.

        const isFolder = node.type === 'folder';
        const hasChildren = !!(node.children && node.children.length > 0);
        const isExpanded = expansion.has(node.id);

        // Determine narrativeId
        let effectiveNarrativeId = inheritedNarrativeId;
        if (node.isNarrativeRoot) {
            effectiveNarrativeId = node.id;
        } else if (node.narrativeId) {
            effectiveNarrativeId = node.narrativeId;
        }

        // Initialize counters for this narrative if needed
        const currentNarrativeId = effectiveNarrativeId || 'global';
        if (!narrativeCounters.has(currentNarrativeId)) {
            narrativeCounters.set(currentNarrativeId, { acts: 0, chapters: 0, arcs: 0 });
        }
        const counters = narrativeCounters.get(currentNarrativeId)!;

        // Compute effective color
        let effectiveColor: string | undefined;
        if (node.isNarrativeRoot) {
            effectiveColor = 'hsl(270, 70%, 60%)';
        } else if (node.entityKind) {
            effectiveColor = getEntityColor(node.entityKind);
        } else if (node.color) {
            effectiveColor = node.color;
        }

        // Manuscript Mode Logic - Global vs Local
        let manuscriptIndex: number | undefined = passedManuscriptIndex;
        let manuscriptLabel: string | undefined;

        if (node.entityKind === 'ACT') {
            counters.acts++;
            manuscriptIndex = counters.acts;
            manuscriptLabel = `Act ${manuscriptIndex}. `;
        } else if (node.entityKind === 'CHAPTER') {
            counters.chapters++;
            manuscriptIndex = counters.chapters;
            manuscriptLabel = `${manuscriptIndex}. `;
        } else if (node.entityKind === 'ARC') {
            counters.arcs++;
            manuscriptIndex = counters.arcs;
            manuscriptLabel = `Arc ${manuscriptIndex}. `;
        } else if (passedManuscriptIndex !== undefined) {
            // Local or Shared numbering passed from parent loop
            if (parentKind === 'CHAPTER' || parentKind === 'ARC') {
                manuscriptLabel = `${passedManuscriptIndex}. `;
            }
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
            manuscriptIndex,
            manuscriptLabel
        };

        // Only add to result if visually visible
        if (parentVisible) {
            result.push(flatNode);
        }

        // Recurse into children
        if (hasChildren && node.children) {
            const childrenVisible = parentVisible && isExpanded;

            // Track if we've found the first note in this Chapter/Arc folder
            // The first note inherits the identifier; subsequent notes increment it.
            let firstNoteFound = false;

            const childCount = node.children.length;
            node.children.forEach((child, idx) => {
                const childIsLast = idx === childCount - 1;

                // Calculate manuscript index for child
                let childManuscriptIndex: number | undefined;

                if ((node.entityKind === 'CHAPTER' || node.entityKind === 'ARC') &&
                    (child.type === 'note' || child.entityKind === 'SCENE' || child.entityKind === 'ARC')) {
                    // Start of complex shared numbering logic
                    if (!firstNoteFound) {
                        // The FIRST note inside the Folder inherits its number
                        childManuscriptIndex = manuscriptIndex;
                        firstNoteFound = true;
                    } else {
                        // Subsequent notes overflow and increment appropriate counter
                        if (node.entityKind === 'CHAPTER') {
                            counters.chapters++;
                            childManuscriptIndex = counters.chapters;
                        } else if (node.entityKind === 'ARC') {
                            counters.arcs++;
                            childManuscriptIndex = counters.arcs;
                        }
                    }
                }

                traverse(
                    child,
                    level + 1,
                    childrenVisible,
                    [...ancestorHasSibling, !isLastChild],
                    childIsLast,
                    effectiveNarrativeId,
                    childManuscriptIndex,
                    node.entityKind || (node.isNarrativeRoot ? 'NARRATIVE' : undefined)
                );
            });
        }
    }

    const rootCount = nodes.length;
    nodes.forEach((node, idx) => {
        const isLast = idx === rootCount - 1;
        traverse(node, 0, true, [], isLast, node.narrativeId, undefined, undefined);
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
