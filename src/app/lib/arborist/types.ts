// src/app/lib/arborist/types.ts
// Tree node types for file tree - matches React reference

/**
 * Unified tree node for the file tree
 * Represents both folders and notes
 */
export interface TreeNode {
    id: string;
    name: string;
    type: 'folder' | 'note';
    children?: TreeNode[];

    // Hierarchy
    parentId?: string;

    // Folder-specific
    entityKind?: string;   // e.g., 'CHARACTER', 'LOCATION', 'NARRATIVE', etc.
    entitySubtype?: string;
    isTypedRoot?: boolean;
    isSubtypeRoot?: boolean;
    color?: string;

    // Note-specific
    isEntity?: boolean;
    favorite?: boolean;
    isPinned?: boolean;

    // Narrative isolation
    narrativeId?: string;
    isNarrativeRoot?: boolean;
}

/**
 * Flattened node for virtual scroll rendering
 * Includes computed display properties
 */
export interface FlatTreeNode extends TreeNode {
    level: number;
    isExpanded: boolean;
    isVisible: boolean;
    effectiveColor?: string;
    hasChildren: boolean;
    isLastChild: boolean;
    /** Ancestor expansion state for drawing connector lines */
    ancestorHasSibling: boolean[];
}

/**
 * Tree expansion state - tracks which folders are open
 */
export type ExpansionState = Set<string>;
