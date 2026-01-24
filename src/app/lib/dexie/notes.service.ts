// src/app/lib/dexie/notes.service.ts
// Angular service for reactive note operations using Dexie liveQuery

import { Injectable } from '@angular/core';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from, Observable } from 'rxjs';
import { db, Note, Folder, Entity } from './db';
import * as ops from './operations';

@Injectable({
    providedIn: 'root'
})
export class NotesService {
    // ==========================================================================
    // REACTIVE QUERIES (liveQuery wrapped as RxJS Observable)
    // ==========================================================================

    /**
     * Get all notes as a live-updating observable
     */
    getAllNotes$(): Observable<Note[]> {
        return from(liveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray()) as DexieObservable<Note[]>);
    }

    /**
     * Get notes in a specific folder
     */
    getNotesByFolder$(folderId: string): Observable<Note[]> {
        return from(liveQuery(() => db.notes.where('folderId').equals(folderId).toArray()) as DexieObservable<Note[]>);
    }

    /**
     * Get a single note by ID
     */
    getNote$(id: string): Observable<Note | undefined> {
        return from(liveQuery(() => db.notes.get(id)) as DexieObservable<Note | undefined>);
    }

    /**
     * Get all folders as a live-updating observable
     */
    getAllFolders$(): Observable<Folder[]> {
        return from(liveQuery(() => db.folders.toArray()) as DexieObservable<Folder[]>);
    }

    /**
     * Get folder children
     */
    getFolderChildren$(parentId: string): Observable<Folder[]> {
        return from(liveQuery(() => db.folders.where('parentId').equals(parentId).toArray()) as DexieObservable<Folder[]>);
    }

    /**
     * Get all entities as a live-updating observable
     */
    getAllEntities$(): Observable<Entity[]> {
        return from(liveQuery(() => db.entities.orderBy('label').toArray()) as DexieObservable<Entity[]>);
    }

    /**
     * Get entities by kind
     */
    getEntitiesByKind$(kind: string): Observable<Entity[]> {
        return from(liveQuery(() => db.entities.where('kind').equals(kind).toArray()) as DexieObservable<Entity[]>);
    }

    // ==========================================================================
    // CRUD OPERATIONS (pass-through to operations module)
    // ==========================================================================

    async createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        return ops.createNote(note);
    }

    async updateNote(id: string, updates: Partial<Note>): Promise<void> {
        return ops.updateNote(id, updates);
    }

    async deleteNote(id: string): Promise<void> {
        return ops.deleteNote(id);
    }

    async createFolder(folder: Omit<Folder, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        return ops.createFolder(folder);
    }

    async updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
        return ops.updateFolder(id, updates);
    }

    async deleteFolder(id: string): Promise<void> {
        return ops.deleteFolder(id);
    }

    async upsertEntity(entity: Entity): Promise<void> {
        return ops.upsertEntity(entity);
    }

    async deleteEntity(id: string): Promise<void> {
        return ops.deleteEntity(id);
    }

    // ==========================================================================
    // UTILITY
    // ==========================================================================

    /**
     * Initialize default data if database is empty
     */
    async initializeDefaults(worldId: string = 'default'): Promise<void> {
        const noteCount = await db.notes.count();
        if (noteCount === 0) {
            // Create a default "Inbox" folder
            const inboxId = await this.createFolder({
                worldId,
                name: 'Inbox',
                parentId: '',
                entityKind: '',
                entitySubtype: '',
                entityLabel: '',
                color: '',
                isTypedRoot: false,
                isSubtypeRoot: false,
                collapsed: false,
                ownerId: 'local',
                narrativeId: '',
                isNarrativeRoot: false
            });

            // Create a welcome note
            await this.createNote({
                worldId,
                title: 'Welcome to Crepe',
                content: '# Welcome!\n\nStart writing your world...',
                markdownContent: '# Welcome!\n\nStart writing your world...',
                folderId: inboxId,
                entityKind: '',
                entitySubtype: '',
                isEntity: false,
                isPinned: false,
                favorite: false,
                ownerId: 'local',
                narrativeId: ''
            });

            console.log('[NotesService] Initialized default data');
        }
    }
}
