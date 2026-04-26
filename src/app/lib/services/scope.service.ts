// src/app/lib/services/scope.service.ts
// Shared folder-backed scope resolution for all narrative-aware UI.

import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { NoteEditorStore } from '../store/note-editor.store';
import type { RegisteredEntity } from '../registry';
import type { Note, Entity, Folder } from '../dexie/db';
import { db } from '../dexie/db';
import { setSetting } from '../dexie/settings.service';
import { PhoenixProjectionService } from '../../services/phoenix-projection.service';

export type ScopeType = 'global' | 'narrative' | 'act' | 'folder' | 'note';

export interface EffectiveScopeTarget {
    scopeType: ScopeType;
    scopeFolderId: string;
    narrativeId?: string;
    actFolderId?: string;
    selectedNoteId?: string;
    lineageFolderIds: string[];
    label?: string;
}

export interface ActiveScope {
    type: ScopeType;
    id: string;
    narrativeId?: string;
    actId?: string;
    scopeType?: ScopeType;
    scopeFolderId?: string;
    actFolderId?: string;
    selectedNoteId?: string;
    lineageFolderIds?: string[];
    selectedFolderId?: string;
    label?: string;
}

export interface ResolvedScope extends ActiveScope {
    scopeType: ScopeType;
    scopeFolderId: string;
    actFolderId?: string;
    selectedNoteId?: string;
    lineageFolderIds: string[];
}

export const GLOBAL_SCOPE: ResolvedScope = {
    type: 'global',
    id: 'vault:global',
    scopeType: 'global',
    scopeFolderId: 'vault:global',
    lineageFolderIds: [],
    label: 'Global',
};

const SCOPE_STORAGE_KEY = 'kittclouds_active_scope';

@Injectable({
    providedIn: 'root'
})
export class ScopeService {
    private noteEditorStore = inject(NoteEditorStore);
    private projection = inject(PhoenixProjectionService);

    private _activeScope = signal<ResolvedScope>(GLOBAL_SCOPE);
    private _scopeNoteIds = signal<string[]>([]);

    get activeScope() {
        return this._activeScope;
    }

    readonly resolvedScope = computed<ResolvedScope>(() => this._activeScope());

    readonly effectiveScopeTarget = computed<EffectiveScopeTarget>(() => {
        const scope = this._activeScope();
        return {
            scopeType: scope.scopeType,
            scopeFolderId: scope.scopeFolderId,
            narrativeId: scope.narrativeId,
            actFolderId: scope.actFolderId,
            selectedNoteId: scope.selectedNoteId,
            lineageFolderIds: scope.lineageFolderIds,
            label: scope.label,
        };
    });

    readonly scopedEntities = computed<RegisteredEntity[]>(() => {
        const scope = this._activeScope();
        const allEntities = this.projection.entities();

        if (scope.type === 'global') {
            return allEntities;
        }

        const noteIds = this._scopeNoteIds();
        if (noteIds.length === 0) {
            if (scope.narrativeId) {
                return allEntities.filter(e => e.firstNote && this.isEntityInNarrative(e, scope.narrativeId!));
            }
            return [];
        }

        const noteIdSet = new Set(noteIds);
        const scoped = allEntities.filter(e => {
            if (e.firstNote && noteIdSet.has(e.firstNote)) return true;
            if (e.mentionsByNote) {
                for (const [noteId] of e.mentionsByNote) {
                    if (noteIdSet.has(noteId)) return true;
                }
            }
            return false;
        });
        if (scoped.length > 0 || scope.type === 'note') {
            return scoped;
        }
        return allEntities;
    });

    readonly scopedEntityCount = computed(() => this.scopedEntities().length);
    readonly scopeType = computed(() => this._activeScope().type);
    readonly scopeLabel = computed(() => this._activeScope().label || 'Global');
    readonly isGlobal = computed(() => this._activeScope().type === 'global');
    readonly activeNarrativeId = computed(() => this._activeScope().narrativeId ?? '');
    readonly activeScopeFolderId = computed(() => this._activeScope().scopeFolderId);

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

    constructor() {
        effect(() => {
            const noteId = this.noteEditorStore.activeNoteId();
            this.recomputeScopeForNote(noteId);
        });

        effect(() => {
            const scope = this._activeScope();
            this.resolveNoteIdsForScope(scope);
        });
    }

    setScope(scope: ActiveScope): void {
        const normalized = this.normalizeScope(scope);
        this._activeScope.set(normalized);
        this.persistScope(normalized);
    }

    async setScopeFromFolder(folderId: string): Promise<void> {
        if (!folderId) {
            this.resetToGlobal();
            return;
        }

        try {
            const folder = await db.folders.get(folderId);
            if (!folder) {
                this.resetToGlobal();
                return;
            }

            if (!folder.narrativeId) {
                this.setScope({
                    type: 'folder',
                    id: folder.id,
                    scopeType: 'folder',
                    scopeFolderId: folder.id,
                    selectedFolderId: folder.id,
                    lineageFolderIds: [folder.id],
                    label: folder.name || 'Folder',
                });
                return;
            }

            const scope = await this.computeScopeFromFolder(folder.id, folder.narrativeId);
            this.setScope(scope);
        } catch (err) {
            console.error('[ScopeService] Failed to set scope from folder:', folderId, err);
        }
    }

    resetToGlobal(): void {
        this._activeScope.set(GLOBAL_SCOPE);
        this.persistScope(GLOBAL_SCOPE);
    }

    async resolveEffectiveScopeTarget(contextId?: string | null): Promise<EffectiveScopeTarget> {
        if (!contextId || contextId === 'global') {
            const scope = this._activeScope();
            if (scope.narrativeId) {
                return {
                    scopeType: scope.type,
                    scopeFolderId: scope.scopeFolderId,
                    narrativeId: scope.narrativeId,
                    actFolderId: scope.actFolderId,
                    selectedNoteId: scope.selectedNoteId,
                    lineageFolderIds: scope.lineageFolderIds,
                    label: scope.label,
                };
            }
            return GLOBAL_SCOPE;
        }

        if (contextId === 'vault:global') {
            return GLOBAL_SCOPE;
        }

        const note = await db.notes.get(contextId);
        if (note?.folderId) {
            const scope = await this.computeScopeFromFolder(note.folderId, note.narrativeId, note.id);
            return this.toEffectiveTarget(scope);
        }

        const folder = await db.folders.get(contextId);
        if (folder) {
            if (folder.narrativeId) {
                const scope = await this.computeScopeFromFolder(folder.id, folder.narrativeId);
                return this.toEffectiveTarget(scope);
            }

            return {
                scopeType: 'folder',
                scopeFolderId: folder.id,
                narrativeId: undefined,
                actFolderId: undefined,
                selectedNoteId: undefined,
                lineageFolderIds: [folder.id],
                label: folder.name || 'Folder',
            };
        }

        return this.toEffectiveTarget(this._activeScope());
    }

    buildScopeFallbackChain(target: EffectiveScopeTarget): string[] {
        if (!target.scopeFolderId || target.scopeFolderId === 'vault:global') {
            return [];
        }

        const ordered = [
            target.narrativeId,
            target.actFolderId,
            target.scopeFolderId,
        ].filter((id): id is string => !!id && id !== 'vault:global');

        return [...new Set(ordered)];
    }

    private async recomputeScopeForNote(noteId: string | null): Promise<void> {
        if (!noteId) {
            this._activeScope.set(GLOBAL_SCOPE);
            this.persistScope(GLOBAL_SCOPE);
            return;
        }

        try {
            const note = await db.notes.get(noteId);
            if (!note || !note.folderId) {
                this._activeScope.set(GLOBAL_SCOPE);
                this.persistScope(GLOBAL_SCOPE);
                return;
            }

            const scope = await this.computeScopeFromFolder(note.folderId, note.narrativeId, note.id);
            this._activeScope.set(scope);
            this.persistScope(scope);
        } catch (err) {
            console.error('[ScopeService] Failed to compute scope for note:', noteId, err);
            this._activeScope.set(GLOBAL_SCOPE);
            this.persistScope(GLOBAL_SCOPE);
        }
    }

    private async computeScopeFromFolder(folderId: string, narrativeId: string, selectedNoteId?: string): Promise<ResolvedScope> {
        if (!narrativeId) {
            const folder = await db.folders.get(folderId);
            return {
                type: 'folder',
                id: folderId,
                scopeType: 'folder',
                scopeFolderId: folderId,
                selectedFolderId: folderId,
                selectedNoteId,
                lineageFolderIds: folder ? (await this.getFolderLineage(folderId)).map(item => item.id) : [folderId],
                label: folder?.name || 'Folder',
            };
        }

        const lineage = await this.getFolderLineage(folderId);
        const lineageIds = lineage.map(folder => folder.id);
        const actFolder = lineage.find(folder => folder.entityKind === 'ACT') || null;
        const narrativeFolder = lineage.find(folder => folder.isNarrativeRoot) || await db.folders.get(narrativeId);

        if (actFolder) {
            return {
                type: 'act',
                id: actFolder.id,
                scopeType: 'act',
                scopeFolderId: actFolder.id,
                selectedFolderId: folderId,
                selectedNoteId,
                narrativeId,
                actId: actFolder.id,
                actFolderId: actFolder.id,
                lineageFolderIds: lineageIds,
                label: actFolder.name,
            };
        }

        return {
            type: 'narrative',
            id: narrativeId,
            scopeType: 'narrative',
            scopeFolderId: narrativeId,
            selectedFolderId: folderId,
            selectedNoteId,
            narrativeId,
            lineageFolderIds: lineageIds,
            label: narrativeFolder?.name || 'Narrative',
        };
    }

    private async resolveNoteIdsForScope(scope: ResolvedScope): Promise<void> {
        try {
            let noteIds: string[];

            switch (scope.type) {
                case 'global':
                    noteIds = (await db.notes.toArray()).map(n => n.id);
                    break;

                case 'note':
                    noteIds = scope.selectedNoteId ? [scope.selectedNoteId] : [scope.id];
                    break;

                case 'narrative':
                    noteIds = (await db.notes.where('narrativeId').equals(scope.scopeFolderId).toArray()).map(n => n.id);
                    break;

                case 'act':
                case 'folder':
                    noteIds = await this.getNotesInFolderTree(scope.scopeFolderId);
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

    private async getNotesInFolderTree(folderId: string): Promise<string[]> {
        const noteIds: string[] = [];
        const folderNotes = await db.notes.where('folderId').equals(folderId).toArray();
        noteIds.push(...folderNotes.map(n => n.id));

        const childFolders = await db.folders.where('parentId').equals(folderId).toArray();
        for (const child of childFolders) {
            const childNotes = await this.getNotesInFolderTree(child.id);
            noteIds.push(...childNotes);
        }

        return noteIds;
    }

    private async getFolderLineage(folderId: string): Promise<Folder[]> {
        const lineage: Folder[] = [];
        let currentFolderId: string | undefined = folderId;

        while (currentFolderId) {
            const folder: Folder | undefined = await db.folders.get(currentFolderId);
            if (!folder) break;
            lineage.push(folder);
            currentFolderId = folder.parentId || undefined;
        }

        return lineage;
    }

    private normalizeScope(scope: ActiveScope): ResolvedScope {
        if (scope.type === 'global' || scope.id === 'vault:global') {
            return GLOBAL_SCOPE;
        }

        const scopeFolderId =
            scope.scopeFolderId ||
            scope.actFolderId ||
            scope.actId ||
            (scope.type === 'narrative' ? (scope.narrativeId || scope.id) : scope.id);

        const actFolderId = scope.actFolderId || scope.actId;
        const scopeType = scope.scopeType || scope.type;
        const selectedFolderId = scope.selectedFolderId || (scope.type !== 'note' ? scope.id : undefined);

        return {
            ...scope,
            scopeType,
            scopeFolderId,
            actId: actFolderId,
            actFolderId,
            selectedFolderId,
            lineageFolderIds: scope.lineageFolderIds?.length ? scope.lineageFolderIds : [...new Set([
                scope.narrativeId,
                actFolderId,
                scopeFolderId,
            ].filter((id): id is string => !!id && id !== 'vault:global'))],
        };
    }

    private toEffectiveTarget(scope: ResolvedScope): EffectiveScopeTarget {
        return {
            scopeType: scope.scopeType,
            scopeFolderId: scope.scopeFolderId,
            narrativeId: scope.narrativeId,
            actFolderId: scope.actFolderId,
            selectedNoteId: scope.selectedNoteId,
            lineageFolderIds: scope.lineageFolderIds,
            label: scope.label,
        };
    }

    private isEntityInNarrative(_entity: RegisteredEntity, _narrativeId: string): boolean {
        return true;
    }

    private persistScope(scope: ResolvedScope): void {
        setSetting(SCOPE_STORAGE_KEY, scope);
    }

    async getEntitiesInScope(_scope: ActiveScope): Promise<Entity[]> {
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

    async setScopeFromNode(_node: any): Promise<void> {
        // Legacy no-op.
    }
}
