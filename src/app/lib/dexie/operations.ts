// src/app/lib/dexie/operations.ts
// CRUD operations for Dexie - matches React reference
// KittCore sync is stubbed until WASM is wired

import { db, Note, Folder, Entity } from './db';

// Stubbed KittCore (will be wired to WASM later)
const kittCore = {
    registryUpsertEntity: async (..._args: any[]) => { },
    registryDeleteEntity: async (_id: string) => { },
    registryGetAllEntities: async (): Promise<any[]> => []
};

// =============================================================================
// NOTE OPERATIONS
// =============================================================================

export async function createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await db.notes.add({
        ...note,
        id,
        createdAt: now,
        updatedAt: now,
    });

    // Sync to Rust Cozo (fire-and-forget)
    syncNoteToCozo(id).catch(console.error);

    return id;
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
    await db.notes.update(id, {
        ...updates,
        updatedAt: Date.now(),
    });

    syncNoteToCozo(id).catch(console.error);
}

export async function deleteNote(id: string): Promise<void> {
    await db.notes.delete(id);
    // TODO: Sync delete to Rust Cozo
}

export async function getNote(id: string): Promise<Note | undefined> {
    return db.notes.get(id);
}

export async function getAllNotes(): Promise<Note[]> {
    return db.notes.toArray();
}

export async function getNotesByFolder(folderId: string): Promise<Note[]> {
    return db.notes.where('folderId').equals(folderId).toArray();
}

// =============================================================================
// FOLDER OPERATIONS
// =============================================================================

export async function createFolder(folder: Omit<Folder, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await db.folders.add({
        ...folder,
        id,
        createdAt: now,
        updatedAt: now,
    });

    return id;
}

export async function updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
    await db.folders.update(id, {
        ...updates,
        updatedAt: Date.now(),
    });
}

export async function deleteFolder(id: string): Promise<void> {
    await db.folders.delete(id);
}

export async function getFolder(id: string): Promise<Folder | undefined> {
    return db.folders.get(id);
}

export async function getAllFolders(): Promise<Folder[]> {
    return db.folders.toArray();
}

export async function getFolderChildren(parentId: string): Promise<Folder[]> {
    return db.folders.where('parentId').equals(parentId).toArray();
}

// =============================================================================
// ENTITY OPERATIONS (Write-through to Rust Cozo)
// =============================================================================

export async function upsertEntity(entity: Entity): Promise<void> {
    await db.entities.put(entity);

    // Primary source is Rust Cozo for entities
    await kittCore.registryUpsertEntity(
        entity.id,
        entity.label,
        entity.kind,
        JSON.stringify({ aliases: entity.aliases, subtype: entity.subtype })
    );
}

export async function deleteEntity(id: string): Promise<void> {
    await db.entities.delete(id);
    await kittCore.registryDeleteEntity(id);
}

export async function getEntity(id: string): Promise<Entity | undefined> {
    return db.entities.get(id);
}

export async function getAllEntities(): Promise<Entity[]> {
    return db.entities.toArray();
}

export async function getEntitiesByKind(kind: string): Promise<Entity[]> {
    return db.entities.where('kind').equals(kind).toArray();
}

// =============================================================================
// SYNC: Dexie ↔ Rust Cozo
// =============================================================================

async function syncNoteToCozo(noteId: string): Promise<void> {
    const note = await db.notes.get(noteId);
    if (!note) return;

    // TODO: Add kittCore.cozoUpsertNote() when Rust schema includes notes
    console.log('[Dexie] Synced note to Cozo:', noteId);
}

export async function hydrateFromCozo(): Promise<void> {
    console.log('[Dexie] Hydrating entities from Rust Cozo...');

    const entities = await kittCore.registryGetAllEntities();
    if (!entities || entities.length === 0) {
        console.log('[Dexie] No entities to hydrate');
        return;
    }

    // Bulk upsert to Dexie
    await db.entities.bulkPut(entities.map((e: any) => ({
        id: e.id,
        label: e.label,
        kind: e.kind,
        subtype: e.props?.subtype,
        aliases: e.props?.aliases || [],
        firstNote: e.props?.firstNote || '',
        totalMentions: e.props?.totalMentions || 0,
        createdAt: e.props?.createdAt || Date.now(),
        updatedAt: Date.now(),
        createdBy: e.props?.createdBy || 'user',
    })));

    console.log(`[Dexie] Hydrated ${entities.length} entities`);
}
