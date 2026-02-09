// src/app/lib/services/scope.service.ts
// Angular service for scope computation and entity filtering
// Uses GoSQLite operations for data access

import { Injectable, signal, computed } from '@angular/core';
import type { Note, Entity, Folder } from '../dexie/db';
import type { TreeNode } from '../arborist/types';
import * as ops from '../operations';

// =============================================================================
// SCOPE TYPES
// =============================================================================

/**
 * The type of scope determines query behavior:
 * - 'note': Show only entities from this specific note
 * - 'folder': Show aggregated entities from all notes in folder subtree
 * - 'act': Show entities from this Act's subtree (NEW: scope boundary within narrative)
 * - 'narrative': Show all entities from entire narrative vault
 */
export type ScopeType = 'note' | 'folder' | 'act' | 'narrative';

/**
 * The currently active scope
 */
export interface ActiveScope {
    type: ScopeType;
    id: string;
    narrativeId?: string;
    actId?: string;  // NEW: Track which Act we're inside (for act scope)
}

/**
 * Computed scope for a tree node
 */
export interface NodeScope {
    nodeId: string;
    nodeType: 'note' | 'folder';
    scopeType: ScopeType;
    scopeId: string;
    narrativeId?: string;
    actId?: string;  // NEW: Track which Act we're inside
}

/**
 * Global scope - shows all entities
 */
export const GLOBAL_SCOPE: ActiveScope = {
    type: 'folder',
    id: 'vault:global',
    narrativeId: undefined,
};

// =============================================================================
// SCOPE SERVICE
// =============================================================================
const SCOPE_STORAGE_KEY = 'kittclouds_active_scope';

@Injectable({
    providedIn: 'root'
})
export class ScopeService {
    // Active scope state - initialized from localStorage
    private _activeScope = signal<ActiveScope>(this.loadPersistedScope());

    // Getters
    get activeScope() {
        return this._activeScope;
    }

    /**
     * Load persisted scope from localStorage
     */
    private loadPersistedScope(): ActiveScope {
        if (typeof localStorage === 'undefined') return GLOBAL_SCOPE;
        try {
            const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Validate structure
                if (parsed && parsed.type && parsed.id) {
                    return parsed as ActiveScope;
                }
            }
        } catch (e) {
            console.warn('[ScopeService] Failed to load persisted scope:', e);
        }
        return GLOBAL_SCOPE;
    }

    /**
     * Persist scope to localStorage
     */
    private persistScope(scope: ActiveScope): void {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
        } catch (e) {
            console.warn('[ScopeService] Failed to persist scope:', e);
        }
    }

    // Computed: Active narrative ID (convenience for Codex queries)
    activeNarrativeId = computed(() => this._activeScope().narrativeId ?? this._activeScope().id);

    // ==========================================================================
    // SCOPE COMPUTATION (Pure Functions)
    // ==========================================================================

    /**
     * Compute the scope for a tree node based on its position.
     *
     * Rules:
     * 1. If node IS an ACT folder → scope = 'act' (ACT is scope boundary)
     * 2. If node is inside a narrative and has ACT ancestor → scope = 'act' (scoped to that act)
     * 3. If node is inside a narrative but no ACT ancestor → scope = 'narrative'
     * 4. If node is a folder (not in narrative) → scope = 'folder'
     * 5. If node is a note (not in narrative) → scope = 'note'
     */
    computeNodeScope(node: TreeNode): NodeScope {
        const nodeId = node.id;
        const nodeType = node.type;

        // Check if inside a narrative vault
        if (node.narrativeId) {
            // Check if this node IS an ACT
            if (nodeType === 'folder' && node.entityKind === 'ACT') {
                return {
                    nodeId,
                    nodeType,
                    scopeType: 'act',
                    scopeId: nodeId,
                    narrativeId: node.narrativeId,
                    actId: nodeId,
                };
            }

            // NOTE: For child nodes of an ACT, we need to find the ACT ancestor
            // This is handled in computeActiveScopeAsync() since it requires DB lookup
            // For now, return narrative scope (will be upgraded if ACT found)
            return {
                nodeId,
                nodeType,
                scopeType: 'narrative',
                scopeId: node.narrativeId,
                narrativeId: node.narrativeId,
            };
        }

        // Folder scope (outside narrative)
        if (nodeType === 'folder') {
            return {
                nodeId,
                nodeType,
                scopeType: 'folder',
                scopeId: nodeId,
                narrativeId: undefined,
            };
        }

        // Note scope (outside narrative)
        return {
            nodeId,
            nodeType,
            scopeType: 'note',
            scopeId: nodeId,
            narrativeId: undefined,
        };
    }

    /**
     * Compute active scope from tree selection (sync version for backwards compat)
     * NOTE: Use computeActiveScopeAsync for proper ACT ancestor detection
     */
    computeActiveScope(selectedNode: TreeNode | null): ActiveScope {
        if (!selectedNode) {
            return GLOBAL_SCOPE;
        }

        const nodeScope = this.computeNodeScope(selectedNode);

        return {
            type: nodeScope.scopeType,
            id: nodeScope.scopeId,
            narrativeId: nodeScope.narrativeId,
            actId: nodeScope.actId,
        };
    }

    /**
     * Compute active scope with async ACT ancestor lookup
     * This properly detects if a node is inside an ACT folder
     */
    async computeActiveScopeAsync(selectedNode: TreeNode | null): Promise<ActiveScope> {
        if (!selectedNode) {
            return GLOBAL_SCOPE;
        }

        // If not in a narrative, use sync computation
        if (!selectedNode.narrativeId) {
            return this.computeActiveScope(selectedNode);
        }

        // If this IS an ACT, return act scope
        if (selectedNode.type === 'folder' && selectedNode.entityKind === 'ACT') {
            return {
                type: 'act',
                id: selectedNode.id,
                narrativeId: selectedNode.narrativeId,
                actId: selectedNode.id,
            };
        }

        // Check for ACT ancestor
        const actAncestor = await this.findActAncestor(selectedNode);
        if (actAncestor) {
            return {
                type: 'act',
                id: actAncestor.id,
                narrativeId: selectedNode.narrativeId,
                actId: actAncestor.id,
            };
        }

        // No ACT ancestor - use full narrative scope
        return {
            type: 'narrative',
            id: selectedNode.narrativeId,
            narrativeId: selectedNode.narrativeId,
        };
    }

    /**
     * Find the nearest ACT ancestor folder for a given node
     */
    private async findActAncestor(node: TreeNode): Promise<Folder | null> {
        // Get the parent folder ID
        let parentId: string | undefined;

        if (node.type === 'note') {
            // For notes, get the folderId from the note
            const note = await ops.getNote(node.id);
            parentId = note?.folderId;
        } else {
            parentId = node.parentId;
        }

        // Walk up the tree looking for an ACT
        while (parentId) {
            const folder = await ops.getFolder(parentId);
            if (!folder) break;

            if (folder.entityKind === 'ACT') {
                return folder;
            }

            // Stop if we hit the narrative root
            if (folder.isNarrativeRoot) {
                break;
            }

            parentId = folder.parentId;
        }

        return null;
    }

    /**
     * Build a scope ID string
     */
    buildScopeId(type: ScopeType, id: string): string {
        return `${type}:${id}`;
    }

    /**
     * Parse a scope ID string
     */
    parseScopeId(scopeId: string): { type: ScopeType; id: string } {
        const [type, ...rest] = scopeId.split(':');
        return {
            type: type as ScopeType,
            id: rest.join(':'),
        };
    }

    // ==========================================================================
    // SCOPE ACTIONS
    // ==========================================================================

    /**
     * Set the active scope
     */
    setScope(scope: ActiveScope): void {
        this._activeScope.set(scope);
        this.persistScope(scope);
    }

    /**
     * Set scope from a selected tree node (async for proper ACT detection)
     */
    async setScopeFromNode(node: TreeNode | null): Promise<void> {
        const scope = await this.computeActiveScopeAsync(node);
        this._activeScope.set(scope);
        this.persistScope(scope);
    }

    /**
     * Reset to global scope
     */
    resetToGlobal(): void {
        this._activeScope.set(GLOBAL_SCOPE);
        this.persistScope(GLOBAL_SCOPE);
    }

    // ==========================================================================
    // SCOPE QUERIES
    // ==========================================================================

    /**
     * Get note IDs in the current scope
     */
    async getNotesInScope(scope: ActiveScope): Promise<string[]> {
        if (scope.type === 'note') {
            return [scope.id];
        }

        if (scope.type === 'narrative') {
            const notes = await ops.getNotesByNarrative(scope.id);
            return notes.map(n => n.id);
        }

        // ACT scope: Get all notes in this Act's folder subtree
        if (scope.type === 'act') {
            const actId = scope.actId || scope.id;
            return this.getNotesInFolderTree(actId);
        }

        if (scope.type === 'folder') {
            if (scope.id === 'vault:global') {
                const notes = await ops.getAllNotes();
                return notes.map(n => n.id);
            }
            // Get all notes in folder subtree
            return this.getNotesInFolderTree(scope.id);
        }

        return [];
    }

    /**
     * Get all notes in a folder tree (recursive)
     */
    private async getNotesInFolderTree(folderId: string): Promise<string[]> {
        const notes: string[] = [];

        // Get notes directly in this folder
        const folderNotes = await ops.getNotesByFolder(folderId);
        notes.push(...folderNotes.map(n => n.id));

        // Get child folders and recurse
        const children = await ops.getFolderChildren(folderId);
        for (const child of children) {
            const childNotes = await this.getNotesInFolderTree(child.id);
            notes.push(...childNotes);
        }

        return notes;
    }

    /**
     * Get entities in the current scope.
     * 
     * Finding logic:
     * 1. Entities with matching `narrativeId` (direct assignment)
     * 2. Entities whose `firstNote` is in the scope's notes
     * 3. Entities mentioned in any note within the scope
     */
    async getEntitiesInScope(scope: ActiveScope): Promise<Entity[]> {
        // Global scope: return all entities
        if (scope.id === 'vault:global') {
            return ops.getAllEntities();
        }

        const noteIds = await this.getNotesInScope(scope);
        const entityMap = new Map<string, Entity>();

        // 1. Direct: entities with matching narrativeId (for narrative scopes)
        if (scope.type === 'narrative') {
            const directEntities = await ops.getEntitiesByNarrative(scope.id);
            for (const e of directEntities) {
                entityMap.set(e.id, e);
            }
        }

        // 2. Entities whose firstNote is within the scope's notes
        if (noteIds.length > 0) {
            const allEntities = await ops.getAllEntities();
            for (const e of allEntities) {
                if (e.firstNote && noteIds.includes(e.firstNote)) {
                    entityMap.set(e.id, e);
                }
            }

            // 3. Entities mentioned in notes within scope
            // Note: Mentions query would ideally be in ops but for now 
            // we rely on CozoDB to have this data synced
            const allEntitiesFiltered = allEntities.filter(e =>
                noteIds.some(nid => e.firstNote === nid)
            );
            for (const e of allEntitiesFiltered) {
                entityMap.set(e.id, e);
            }
        }

        return Array.from(entityMap.values());
    }
}
