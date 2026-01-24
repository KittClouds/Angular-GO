// src/app/lib/services/scope.service.ts
// Angular service for scope computation and entity filtering

import { Injectable, signal, computed } from '@angular/core';
import { db, Note, Entity, Folder } from '../dexie/db';
import type { TreeNode } from '../arborist/types';

// =============================================================================
// SCOPE TYPES
// =============================================================================

/**
 * The type of scope determines query behavior:
 * - 'note': Show only entities from this specific note
 * - 'folder': Show aggregated entities from all notes in folder subtree
 * - 'narrative': Show all entities from entire narrative vault
 */
export type ScopeType = 'note' | 'folder' | 'narrative';

/**
 * The currently active scope
 */
export interface ActiveScope {
    type: ScopeType;
    id: string;
    narrativeId?: string;
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

@Injectable({
    providedIn: 'root'
})
export class ScopeService {
    // Active scope state
    private _activeScope = signal<ActiveScope>(GLOBAL_SCOPE);

    // Getters
    get activeScope() {
        return this._activeScope;
    }

    // ==========================================================================
    // SCOPE COMPUTATION (Pure Functions)
    // ==========================================================================

    /**
     * Compute the scope for a tree node based on its position.
     *
     * Rules:
     * 1. If node is inside a narrative vault → scope = 'narrative'
     * 2. If node is a folder (not narrative) → scope = 'folder'
     * 3. If node is a note → scope = 'note'
     */
    computeNodeScope(node: TreeNode): NodeScope {
        const nodeId = node.id;
        const nodeType = node.type;

        // Check if inside a narrative vault
        if (node.narrativeId) {
            return {
                nodeId,
                nodeType,
                scopeType: 'narrative',
                scopeId: node.narrativeId,
                narrativeId: node.narrativeId,
            };
        }

        // Folder scope
        if (nodeType === 'folder') {
            return {
                nodeId,
                nodeType,
                scopeType: 'folder',
                scopeId: nodeId,
                narrativeId: undefined,
            };
        }

        // Note scope
        return {
            nodeId,
            nodeType,
            scopeType: 'note',
            scopeId: nodeId,
            narrativeId: undefined,
        };
    }

    /**
     * Compute active scope from tree selection
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
        };
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
    }

    /**
     * Set scope from a selected tree node
     */
    setScopeFromNode(node: TreeNode | null): void {
        this._activeScope.set(this.computeActiveScope(node));
    }

    /**
     * Reset to global scope
     */
    resetToGlobal(): void {
        this._activeScope.set(GLOBAL_SCOPE);
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
            const notes = await db.notes
                .where('narrativeId')
                .equals(scope.id)
                .toArray();
            return notes.map(n => n.id);
        }

        if (scope.type === 'folder') {
            if (scope.id === 'vault:global') {
                const notes = await db.notes.toArray();
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
        const folderNotes = await db.notes.where('folderId').equals(folderId).toArray();
        notes.push(...folderNotes.map(n => n.id));

        // Get child folders and recurse
        const children = await db.folders.where('parentId').equals(folderId).toArray();
        for (const child of children) {
            const childNotes = await this.getNotesInFolderTree(child.id);
            notes.push(...childNotes);
        }

        return notes;
    }

    /**
     * Get entities in the current scope
     */
    async getEntitiesInScope(scope: ActiveScope): Promise<Entity[]> {
        if (scope.type === 'narrative') {
            return db.entities
                .where('narrativeId')
                .equals(scope.id)
                .toArray();
        }

        // For folder/note scopes, get all entities from notes in scope
        const noteIds = await this.getNotesInScope(scope);
        const mentions = await db.mentions
            .where('noteId')
            .anyOf(noteIds)
            .toArray();

        const entityIds = [...new Set(mentions.map(m => m.entityId))];
        const entities = await db.entities
            .where('id')
            .anyOf(entityIds)
            .toArray();

        return entities;
    }
}
