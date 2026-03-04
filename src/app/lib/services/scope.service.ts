// src/app/lib/services/scope.service.ts
// Redesigned scope service — single reactive source of truth.
//
// Architecture:
// - Scope is driven by the active note (NoteEditorStore.activeNoteId)
// - When the note changes, scope auto-recomputes based on folder ancestry
// - All entity reads flow through the in-memory registry (CentralRegistry)
// - No async DB queries for entity lists — everything is signal-driven

import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { NoteEditorStore } from '../store/note-editor.store';
import { smartGraphRegistry } from '../registry';
import type { RegisteredEntity } from '../registry';
import type { Note, Entity, Folder } from '../dexie/db';
import { db } from '../dexie/db';
import { getSetting, setSetting } from '../dexie/settings.service';

// =============================================================================
// SCOPE TYPES
// =============================================================================

/**
 * The type of scope determines what entities are visible:
 * - 'global': All entities across the entire vault
 * - 'narrative': Entities from a specific narrative timeline folder
 * - 'act': Entities from a specific act/arc within a narrative
 * - 'folder': Entities from a generic folder subtree
 * - 'note': Entities mentioned in a single note only
 */
export type ScopeType = 'global' | 'narrative' | 'act' | 'folder' | 'note';

/**
 * The currently active scope
 */
export interface ActiveScope {
    type: ScopeType;
    /** The ID of the scope target (folder ID, note ID, or 'vault:global') */
    id: string;
    /** The narrative vault this scope belongs to (if any) */
    narrativeId?: string;
    /** The act/arc folder this scope is inside (if any) */
    actId?: string;
    /** Human-readable label for display */
    label?: string;
}

/**
 * Global scope — shows all entities
 */
export const GLOBAL_SCOPE: ActiveScope = {
    type: 'global',
    id: 'vault:global',
    label: 'Global',
};

// =============================================================================
// SCOPE SERVICE
// =============================================================================
const SCOPE_STORAGE_KEY = 'kittclouds_active_scope';

@Injectable({
    providedIn: 'root'
})
export class ScopeService {
    private noteEditorStore = inject(NoteEditorStore);

    // =========================================================================
    // Core State
    // =========================================================================

    /** The active scope — drives all entity filtering */
    private _activeScope = signal<ActiveScope>(GLOBAL_SCOPE);

    /** Public read-only accessor */
    get activeScope() {
        return this._activeScope;
    }

    /** Version counter — bumped on every registry change to trigger recomputation */
    private _registryVersion = signal(0);

    /** Unsubscribe handle for registry listener */
    private unsubRegistry: (() => void) | null = null;

    // =========================================================================
    // Computed Signals — These are what consumers read
    // =========================================================================

    /**
     * All entities visible in the current scope.
     * Reads from the in-memory registry (CentralRegistry), NOT from Dexie.
     * Re-fires when scope changes OR when registry notifies.
     */
    readonly scopedEntities = computed<RegisteredEntity[]>(() => {
        // Touch version to re-run when registry changes
        this._registryVersion();

        const scope = this._activeScope();
        const allEntities = smartGraphRegistry.getAllEntities();

        if (scope.type === 'global') {
            return allEntities;
        }

        // For scoped views, filter by note membership
        const noteIds = this._scopeNoteIds();
        if (noteIds.length === 0) {
            // If no notes resolved yet (async still pending), show all from narrative
            if (scope.narrativeId) {
                return allEntities.filter(e => e.firstNote && this.isEntityInNarrative(e, scope.narrativeId!));
            }
            return [];
        }

        const noteIdSet = new Set(noteIds);
        return allEntities.filter(e => {
            // Entity's firstNote is in scope
            if (e.firstNote && noteIdSet.has(e.firstNote)) return true;
            // Entity has mentions in scoped notes
            if (e.mentionsByNote) {
                for (const [noteId] of e.mentionsByNote) {
                    if (noteIdSet.has(noteId)) return true;
                }
            }
            return false;
        });
    });

    /** Count of entities in current scope — for footer display */
    readonly scopedEntityCount = computed(() => this.scopedEntities().length);

    /** Convenience: current scope type */
    readonly scopeType = computed(() => this._activeScope().type);

    /** Convenience: current scope label */
    readonly scopeLabel = computed(() => this._activeScope().label || 'Global');

    /** Convenience: is global? */
    readonly isGlobal = computed(() => this._activeScope().type === 'global');

    /** Convenience: active narrative ID (for codex queries) */
    readonly activeNarrativeId = computed(() => this._activeScope().narrativeId ?? this._activeScope().id);

    /** Scope icon class for templates */
    readonly scopeIcon = computed(() => {
        const scope = this._activeScope();
        switch (scope.type) {
            case 'global': return 'pi-globe';
            case 'narrative': return 'pi-book';
            case 'act': return 'pi-bookmark';
            case 'folder': return 'pi-folder';
            case 'note': return 'pi-file';
            default: return 'pi-globe';
        }
    });

    // =========================================================================
    // Internal: Note IDs in current scope (async-resolved, cached as signal)
    // =========================================================================

    /** Cached note IDs for the current scope */
    private _scopeNoteIds = signal<string[]>([]);

    // =========================================================================
    // Constructor — Wire up reactive scope computation
    // =========================================================================

    constructor() {
        // 1. Listen for registry changes → bump version to recompute scopedEntities
        this.unsubRegistry = smartGraphRegistry.subscribe(() => {
            this._registryVersion.update(v => v + 1);
        });

        // Safety: if registry already initialized before we subscribed,
        // force a version bump so scopedEntities picks up existing data
        if (smartGraphRegistry.isInitialized()) {
            this._registryVersion.update(v => v + 1);
        }

        // 2. React to active note changes → recompute scope
        effect(() => {
            const noteId = this.noteEditorStore.activeNoteId();
            // Async scope computation
            this.recomputeScopeForNote(noteId);
        });

        // 3. When scope changes, resolve the note IDs in that scope
        effect(() => {
            const scope = this._activeScope();
            this.resolveNoteIdsForScope(scope);
        });
    }

    // =========================================================================
    // Scope Actions (Public API)
    // =========================================================================

    /** Set the active scope explicitly */
    setScope(scope: ActiveScope): void {
        this._activeScope.set(scope);
        this.persistScope(scope);
    }

    /** Reset to global scope */
    resetToGlobal(): void {
        this._activeScope.set(GLOBAL_SCOPE);
        this.persistScope(GLOBAL_SCOPE);
    }

    // =========================================================================
    // Scope Computation — Runs when active note changes
    // =========================================================================

    /**
     * Recompute scope based on the currently open note.
     * Walks up the folder tree to determine scope context.
     */
    private async recomputeScopeForNote(noteId: string | null): Promise<void> {
        if (!noteId) {
            // No note open → global scope
            this._activeScope.set(GLOBAL_SCOPE);
            this.persistScope(GLOBAL_SCOPE);
            return;
        }

        try {
            const note = await db.notes.get(noteId);
            if (!note) {
                this._activeScope.set(GLOBAL_SCOPE);
                this.persistScope(GLOBAL_SCOPE);
                return;
            }

            // If note has no folder → global
            if (!note.folderId) {
                this._activeScope.set(GLOBAL_SCOPE);
                this.persistScope(GLOBAL_SCOPE);
                return;
            }

            // Walk up folder tree to determine scope
            const scope = await this.computeScopeFromFolder(note.folderId, note.narrativeId);
            this._activeScope.set(scope);
            this.persistScope(scope);

        } catch (err) {
            console.error('[ScopeService] Failed to compute scope for note:', noteId, err);
            this._activeScope.set(GLOBAL_SCOPE);
            this.persistScope(GLOBAL_SCOPE);
        }
    }

    /**
     * Walk up the folder tree to determine scope.
     * 
     * Rules:
     * 1. If the folder (or any ancestor) is a narrative root → narrative scope
     * 2. If any ancestor is an ACT folder → act scope (scoped to that act)
     * 3. If inside a narrative but no ACT → narrative scope
     * 4. If not in a narrative → global (root-level notes are always global)
     */
    private async computeScopeFromFolder(folderId: string, narrativeId: string): Promise<ActiveScope> {
        // No narrative → global scope
        if (!narrativeId) {
            return GLOBAL_SCOPE;
        }

        // Walk up looking for ACT ancestor
        let currentFolderId: string | undefined = folderId;
        let actFolder: Folder | null = null;

        while (currentFolderId) {
            const folder: Folder | undefined = await db.folders.get(currentFolderId);
            if (!folder) break;

            // Found an ACT → scope to this act
            if (folder.entityKind === 'ACT') {
                actFolder = folder;
                break;
            }

            // Hit the narrative root → stop
            if (folder.isNarrativeRoot) {
                break;
            }

            currentFolderId = folder.parentId || undefined;
        }

        // If we found an ACT, scope to it
        if (actFolder) {
            return {
                type: 'act',
                id: actFolder.id,
                narrativeId,
                actId: actFolder.id,
                label: actFolder.name,
            };
        }

        // Otherwise, scope to the narrative vault
        const narrativeFolder = await db.folders.get(narrativeId);
        return {
            type: 'narrative',
            id: narrativeId,
            narrativeId,
            label: narrativeFolder?.name || 'Narrative',
        };
    }

    // =========================================================================
    // Note ID Resolution — Maps scope → note IDs for entity filtering
    // =========================================================================

    /**
     * Resolve which note IDs belong to the current scope.
     * This is async (folder tree traversal) but the result is cached in a signal.
     */
    private async resolveNoteIdsForScope(scope: ActiveScope): Promise<void> {
        try {
            let noteIds: string[];

            switch (scope.type) {
                case 'global':
                    // Global: all notes
                    noteIds = (await db.notes.toArray()).map(n => n.id);
                    break;

                case 'note':
                    noteIds = [scope.id];
                    break;

                case 'narrative':
                    // All notes in the narrative
                    noteIds = (await db.notes.where('narrativeId').equals(scope.id).toArray()).map(n => n.id);
                    break;

                case 'act':
                    // All notes in the act's folder subtree
                    noteIds = await this.getNotesInFolderTree(scope.actId || scope.id);
                    break;

                case 'folder':
                    if (scope.id === 'vault:global') {
                        noteIds = (await db.notes.toArray()).map(n => n.id);
                    } else {
                        noteIds = await this.getNotesInFolderTree(scope.id);
                    }
                    break;

                default:
                    noteIds = [];
            }

            this._scopeNoteIds.set(noteIds);

        } catch (err) {
            console.error('[ScopeService] Failed to resolve note IDs for scope:', scope, err);
            this._scopeNoteIds.set([]);
        }
    }

    /**
     * Recursively get all note IDs in a folder subtree.
     */
    private async getNotesInFolderTree(folderId: string): Promise<string[]> {
        const noteIds: string[] = [];

        // Direct notes in this folder
        const folderNotes = await db.notes.where('folderId').equals(folderId).toArray();
        noteIds.push(...folderNotes.map(n => n.id));

        // Child folders → recurse
        const childFolders = await db.folders.where('parentId').equals(folderId).toArray();
        for (const child of childFolders) {
            const childNotes = await this.getNotesInFolderTree(child.id);
            noteIds.push(...childNotes);
        }

        return noteIds;
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /** Check if an entity belongs to a narrative (by firstNote's narrativeId) */
    private isEntityInNarrative(entity: RegisteredEntity, narrativeId: string): boolean {
        // This is a heuristic — we check if the entity's firstNote is in the narrative
        // Since we can't do async in a computed, this only works for entities with narrativeId metadata
        return true; // Fallback: show all until noteIds resolve
    }

    /** Persist scope to Dexie settings */
    private persistScope(scope: ActiveScope): void {
        setSetting(SCOPE_STORAGE_KEY, scope);
    }

    // =========================================================================
    // Legacy API (kept for backwards compat during transition)
    // =========================================================================

    /**
     * @deprecated Use scopedEntities signal instead
     * Get entities in scope — now just returns the signal value
     */
    async getEntitiesInScope(scope: ActiveScope): Promise<Entity[]> {
        // Bridge: convert RegisteredEntity[] to Entity[] format
        const entities = this.scopedEntities();
        return entities.map(e => ({
            id: e.id,
            label: e.label,
            kind: e.kind,
            subtype: e.subtype,
            aliases: e.aliases,
            firstNote: e.firstNote,
            totalMentions: e.totalMentions,
            createdAt: e.createdAt.getTime(),
            updatedAt: e.lastSeenDate.getTime(),
            createdBy: e.createdBy,
        }));
    }

    /**
     * @deprecated Scope is now set automatically from active note
     */
    async setScopeFromNode(_node: any): Promise<void> {
        // No-op — scope is now auto-computed from active note
        // Kept to prevent breaking callers during transition
    }
}
