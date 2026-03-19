// src/app/lib/services/folder.service.ts
// Angular service for folder CRUD with liveQuery
// Writes through to SQLite via GoKittStoreService (Direct Mode)

import { Injectable, inject } from '@angular/core';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from, Observable } from 'rxjs';
import { db, Folder, FolderSchema, AllowedSubfolderDef, AllowedNoteTypeDef } from '../dexie/db';
import { getNextFolderOrder } from '../operations';
import { GoKittStoreService } from '../../services/gokitt-store.service';
import { ScopedDocumentService } from './scoped-document.service';
import { ScopedEntityFieldService } from './scoped-entity-field.service';

@Injectable({
    providedIn: 'root'
})
export class FolderService {
    private goKittStore = inject(GoKittStoreService);
    private scopedDocuments = inject(ScopedDocumentService);
    private scopedEntityFields = inject(ScopedEntityFieldService);

    /**
     * Write-through to SQLite directly via GoKittStoreService.
     */
    private async syncToSqlite(folder: Folder): Promise<void> {
        try {
            if (this.goKittStore.isReady) {
                await this.goKittStore.upsertFolder(GoKittStoreService.fromDexieFolder(folder));
            }
        } catch (err) {
            console.warn('[FolderService] SQLite sync failed (non-fatal):', err);
        }
    }

    private async deleteFromSqlite(id: string): Promise<void> {
        try {
            if (this.goKittStore.isReady) {
                await this.goKittStore.deleteFolder(id);
            }
        } catch (err) {
            console.warn('[FolderService] SQLite delete failed (non-fatal):', err);
        }
    }
    // ==========================================================================
    // REACTIVE QUERIES (liveQuery wrapped as RxJS Observable)
    // ==========================================================================

    /**
     * Get all folders as a live-updating observable
     */
    getAllFolders$(): Observable<Folder[]> {
        return from(liveQuery(() => db.folders.toArray()) as DexieObservable<Folder[]>);
    }

    /**
     * Get folders by parent ID (for tree building)
     * Sorted by order field for drag-and-drop reordering.
     */
    getFolderChildren$(parentId: string): Observable<Folder[]> {
        return from(liveQuery(() =>
            db.folders
                .where('parentId')
                .equals(parentId)
                .sortBy('order')
        ) as DexieObservable<Folder[]>);
    }

    /**
     * Get root folders (no parent)
     * Sorted by order field for drag-and-drop reordering.
     */
    getRootFolders$(): Observable<Folder[]> {
        return from(liveQuery(() =>
            db.folders
                .where('parentId')
                .equals('')
                .sortBy('order')
        ) as DexieObservable<Folder[]>);
    }

    /**
     * Get folders by narrative ID (all in a vault)
     * Sorted by order field.
     */
    getFoldersByNarrative$(narrativeId: string): Observable<Folder[]> {
        return from(liveQuery(() =>
            db.folders
                .where('narrativeId')
                .equals(narrativeId)
                .sortBy('order')
        ) as DexieObservable<Folder[]>);
    }

    /**
     * Get a single folder by ID
     */
    getFolder$(id: string): Observable<Folder | undefined> {
        return from(liveQuery(() => db.folders.get(id)) as DexieObservable<Folder | undefined>);
    }

    // ==========================================================================
    // SCHEMA QUERIES
    // ==========================================================================

    /**
     * Get folder schema by entity kind
     */
    async getFolderSchema(entityKind: string): Promise<FolderSchema | undefined> {
        return db.folderSchemas.get(entityKind);
    }

    /**
     * Get allowed subfolders for an entity kind
     */
    async getAllowedSubfolders(entityKind: string): Promise<AllowedSubfolderDef[]> {
        const schema = await this.getFolderSchema(entityKind);
        return schema?.allowedSubfolders || [];
    }

    /**
     * Get allowed note types for an entity kind
     */
    async getAllowedNoteTypes(entityKind: string): Promise<AllowedNoteTypeDef[]> {
        const schema = await this.getFolderSchema(entityKind);
        return schema?.allowedNoteTypes || [];
    }

    /**
     * Get all folder schemas (for UI)
     */
    getAllSchemas$(): Observable<FolderSchema[]> {
        return from(liveQuery(() => db.folderSchemas.toArray()) as DexieObservable<FolderSchema[]>);
    }

    // ==========================================================================
    // CRUD OPERATIONS
    // ==========================================================================

    /**
     * Create a new folder
     */
    async createFolder(folder: Omit<Folder, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
        const id = crypto.randomUUID();
        const now = Date.now();
        const order = await getNextFolderOrder(folder.parentId);

        const fullFolder = {
            ...folder,
            id,
            order,
            createdAt: now,
            updatedAt: now,
        } as Folder;

        await db.folders.add(fullFolder);
        await this.syncToSqlite(fullFolder);

        return id;
    }

    /**
     * Create a new Narrative Vault (root folder)
     * This is a convenience method for creating vault roots with sensible defaults.
     */
    async createNarrativeVault(name: string = 'New Narrative'): Promise<string> {
        const id = crypto.randomUUID();
        const now = Date.now();
        const order = await getNextFolderOrder('');

        const folder: Folder = {
            id,
            worldId: '',
            name,
            parentId: '',              // Root level
            entityKind: 'NARRATIVE',
            entitySubtype: '',
            entityLabel: '',
            color: '',
            isTypedRoot: true,
            isSubtypeRoot: false,
            collapsed: false,
            ownerId: '',
            narrativeId: id,           // Self-referencing for vault root
            isNarrativeRoot: true,
            order,
            createdAt: now,
            updatedAt: now,
        };

        await db.folders.add(folder);
        await this.syncToSqlite(folder);

        return id;
    }

    /**
     * Create a new root folder (non-narrative)
     */
    async createRootFolder(name: string = 'New Folder'): Promise<string> {
        const id = crypto.randomUUID();
        const now = Date.now();
        const order = await getNextFolderOrder('');

        const folder: Folder = {
            id,
            worldId: '',
            name,
            parentId: '',              // Root level
            entityKind: '',
            entitySubtype: '',
            entityLabel: '',
            color: '',
            isTypedRoot: false,
            isSubtypeRoot: false,
            collapsed: false,
            ownerId: '',
            narrativeId: '',           // Global scope
            isNarrativeRoot: false,
            order,
            createdAt: now,
            updatedAt: now,
        };

        await db.folders.add(folder);
        await this.syncToSqlite(folder);

        return id;
    }

    /**
     * Create a typed root folder (entity folder at root level)
     */
    async createTypedRootFolder(entityKind: string, name: string): Promise<string> {
        const id = crypto.randomUUID();
        const now = Date.now();
        const order = await getNextFolderOrder('');

        const folder: Folder = {
            id,
            worldId: '',
            name,
            parentId: '',              // Root level
            entityKind,
            entitySubtype: '',
            entityLabel: '',
            color: '',
            isTypedRoot: true,
            isSubtypeRoot: false,
            collapsed: false,
            ownerId: '',
            narrativeId: '',           // Global scope (not in a vault)
            isNarrativeRoot: false,
            order,
            createdAt: now,
            updatedAt: now,
        };

        await db.folders.add(folder);
        await this.syncToSqlite(folder);

        if (entityKind === 'ACT' && folder.narrativeId) {
            try {
                await this.seedActScope(folder);
            } catch (err) {
                console.warn('[FolderService] Failed to seed ACT scope (non-fatal):', err);
            }
        }

        return id;
    }

    /**
     * Create a typed subfolder with proper schema inheritance
     */
    async createTypedSubfolder(
        parentId: string,
        entityKind: string,
        name: string
    ): Promise<string> {
        // Get parent folder to inherit narrativeId
        const parent = await db.folders.get(parentId);
        if (!parent) {
            throw new Error(`Parent folder ${parentId} not found`);
        }

        // Get schema for the entity kind
        const schema = await this.getFolderSchema(entityKind);

        // Determine narrativeId
        let narrativeId = parent.narrativeId;
        const isNarrativeRoot = schema?.isVaultRoot ?? false;

        const id = crypto.randomUUID();
        const now = Date.now();
        const order = await getNextFolderOrder(parentId);

        // If this IS a narrative root, its narrativeId is itself
        if (isNarrativeRoot) {
            narrativeId = id;
        }

        const folder: Folder = {
            id,
            worldId: parent.worldId,
            name,
            parentId,
            entityKind,
            entitySubtype: '',
            entityLabel: '',
            color: '',
            isTypedRoot: true,
            isSubtypeRoot: false,
            collapsed: false,
            ownerId: parent.ownerId,
            narrativeId,
            isNarrativeRoot,
            order,
            createdAt: now,
            updatedAt: now,
        };

        await db.folders.add(folder);
        await this.syncToSqlite(folder);

        return id;
    }

    /**
     * Create a typed subfolder with date metadata
     */
    async createDatedTypedSubfolder(
        parentId: string,
        entityKind: string,
        name: string,
        date: { year: number; monthIndex: number; dayIndex: number }
    ): Promise<string> {
        // Get parent folder to inherit narrativeId
        const parent = await db.folders.get(parentId);
        if (!parent) {
            throw new Error(`Parent folder ${parentId} not found`);
        }

        const id = crypto.randomUUID();
        const now = Date.now();
        const order = await getNextFolderOrder(parentId);

        const folder: Folder = {
            id,
            worldId: parent.worldId,
            name,
            parentId,
            entityKind,
            entitySubtype: '',
            entityLabel: '',
            color: '',
            isTypedRoot: true,
            isSubtypeRoot: false,
            collapsed: false,
            ownerId: parent.ownerId,
            narrativeId: parent.narrativeId, // Inherit scope
            isNarrativeRoot: false,
            order,
            createdAt: now,
            updatedAt: now,
            metadata: { date }
        };

        await db.folders.add(folder);
        await this.syncToSqlite(folder);

        return id;
    }

    /**
     * Get folders with date metadata for a specific narrative
     */
    getDatedFoldersByNarrative$(narrativeId: string): Observable<Folder[]> {
        return from(liveQuery(async () => {
            // Indexing strategy: We don't have a compound index on [narrativeId+metadata], 
            // so filter in JS. Given folder counts are usually < 1000 per vault, this is safe.
            const folders = await db.folders
                .where('narrativeId')
                .equals(narrativeId)
                .toArray();

            return folders.filter(f => f.metadata?.date !== undefined);
        }) as DexieObservable<Folder[]>);
    }

    /**
     * Create a plain subfolder (no specific entity kind)
     */
    async createSubfolder(parentId: string, name: string): Promise<string> {
        // Get parent folder to inherit narrativeId
        const parent = await db.folders.get(parentId);
        if (!parent) {
            throw new Error(`Parent folder ${parentId} not found`);
        }

        const id = crypto.randomUUID();
        const now = Date.now();
        const order = await getNextFolderOrder(parentId);

        const folder: Folder = {
            id,
            worldId: parent.worldId,
            name,
            parentId,
            entityKind: '',
            entitySubtype: '',
            entityLabel: '',
            color: '',
            isTypedRoot: false,
            isSubtypeRoot: false,
            collapsed: false,
            ownerId: parent.ownerId,
            narrativeId: parent.narrativeId, // Inherit scope
            isNarrativeRoot: false,
            order,
            createdAt: now,
            updatedAt: now,
        };

        await db.folders.add(folder);
        await this.syncToSqlite(folder);

        return id;
    }

    /**
     * Update a folder
     */
    async updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
        await db.folders.update(id, {
            ...updates,
            updatedAt: Date.now(),
        });
        // Re-read full folder and sync to SQLite
        const updated = await db.folders.get(id);
        if (updated) await this.syncToSqlite(updated);
    }

    /**
     * Delete a folder (and optionally its children)
     */
    async deleteFolder(id: string, deleteChildren = false): Promise<void> {
        if (deleteChildren) {
            // Recursively delete all children
            const children = await db.folders.where('parentId').equals(id).toArray();
            for (const child of children) {
                await this.deleteFolder(child.id, true);
            }
            // Also delete notes in this folder
            await db.notes.where('folderId').equals(id).delete();
        }
        await db.folders.delete(id);
        await this.deleteFromSqlite(id);
    }

    /**
     * Move a folder to a new parent (recalculates narrativeId)
     */
    async moveFolder(id: string, newParentId: string): Promise<void> {
        const folder = await db.folders.get(id);
        const newParent = await db.folders.get(newParentId);

        if (!folder || !newParent) {
            throw new Error('Folder or new parent not found');
        }

        // Update folder
        await db.folders.update(id, {
            parentId: newParentId,
            updatedAt: Date.now(),
        });

        // Sync the moved folder to SQLite
        const updated = await db.folders.get(id);
        if (updated) await this.syncToSqlite(updated);

        // Propagate new narrativeId if changed
        if (folder.narrativeId !== newParent.narrativeId && !folder.isNarrativeRoot) {
            await this.propagateNarrativeId(id, newParent.narrativeId);
        }
    }

    /**
     * Propagate narrativeId to all descendants
     */
    async propagateNarrativeId(folderId: string, narrativeId: string): Promise<void> {
        // Update this folder
        await db.folders.update(folderId, { narrativeId, updatedAt: Date.now() });

        // Sync updated folder to SQLite
        const updatedFolder = await db.folders.get(folderId);
        if (updatedFolder) await this.syncToSqlite(updatedFolder);

        // Update all notes in this folder
        const notes = await db.notes.where('folderId').equals(folderId).toArray();
        for (const note of notes) {
            await db.notes.update(note.id, { narrativeId, updatedAt: Date.now() });
        }

        // Recursively update child folders
        const children = await db.folders.where('parentId').equals(folderId).toArray();
        for (const child of children) {
            if (!child.isNarrativeRoot) {
                await this.propagateNarrativeId(child.id, narrativeId);
            }
        }
    }

    /**
     * Get the narrative ID for a folder (walks up tree if needed)
     */
    async getNarrativeId(folderId: string): Promise<string | null> {
        const folder = await db.folders.get(folderId);
        if (!folder) return null;

        if (folder.narrativeId) {
            return folder.narrativeId;
        }

        if (folder.parentId) {
            return this.getNarrativeId(folder.parentId);
        }

        return null;
    }

    private async seedActScope(actFolder: Folder): Promise<void> {
        const siblings = await db.folders
            .where('parentId')
            .equals(actFolder.parentId)
            .sortBy('order');

        const sourceAct = siblings
            .filter(folder => folder.entityKind === 'ACT' && folder.id !== actFolder.id && folder.order < actFolder.order)
            .sort((a, b) => b.order - a.order)[0];

        const sourceScopeFolderId = sourceAct?.id || actFolder.narrativeId;
        if (!sourceScopeFolderId || sourceScopeFolderId === actFolder.id) {
            return;
        }

        await this.scopedDocuments.cloneScopeDocuments(
            sourceScopeFolderId,
            actFolder.id,
            actFolder.narrativeId,
            sourceScopeFolderId
        );

        await this.scopedEntityFields.cloneScopeFields(
            sourceScopeFolderId,
            actFolder.id,
            actFolder.narrativeId,
            sourceScopeFolderId
        );
    }
}
