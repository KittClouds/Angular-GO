// src/app/lib/nebula/operations.ts
// CRUD operations using NebulaDB as primary store
// Syncs to CozoDB via NebulaCozoBridge

import { nebulaDb, Note, Folder, Entity, Edge } from './db';

// Lazy accessor for NebulaCozoBridge
let _bridge: any = null;

export function setNebulaBridge(bridge: any): void {
    _bridge = bridge;
    console.log('[NebulaOps] Bridge connected');
}

function getBridge() {
    return _bridge;
}

// =============================================================================
// NOTE OPERATIONS
// =============================================================================

export async function createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    // Get next order for this folder
    const order = await getNextNoteOrder(note.folderId);

    const fullNote = {
        ...note,
        id,
        order,
        createdAt: now,
        updatedAt: now,
    } as Note;

    // Write to NebulaDB + queue to CozoDB
    if (_bridge?.isReady()) {
        await _bridge.syncNote(fullNote);
    } else {
        // Fallback: direct insert to NebulaDB
        await nebulaDb.notes.insert(fullNote);
    }

    return id;
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
    // Try NebulaDB first if bridge is ready
    if (_bridge?.isReady()) {
        const existing = await nebulaDb.notes.findOne({ id }) as Note | null;
        if (existing) {
            const updatedNote = {
                ...existing,
                ...updates,
                updatedAt: Date.now(),
            } as Note;
            await _bridge.syncNote(updatedNote);

            // Sync content to GoKitt DocStore (if content was updated)
            if (updates.content !== undefined) {
                syncNoteToDocStore(id, updates.content, updatedNote.updatedAt);
            }
            return;
        }
        // Note not in NebulaDB yet - fall through to Dexie fallback
    }

    // Fallback: Update via Dexie (for pre-hydration updates)
    // This keeps the app working while NebulaDB hydrates
    const { db } = await import('../dexie/db');
    const existing = await db.notes.get(id);
    if (!existing) {
        console.warn(`[NebulaOps] Note ${id} not found (pre-hydration)`);
        return;
    }

    const now = Date.now();
    await db.notes.update(id, {
        ...updates,
        updatedAt: now,
    });

    // Sync content to GoKitt DocStore (if content was updated)
    if (updates.content !== undefined) {
        syncNoteToDocStore(id, updates.content, now);
    }
}

// Lazy sync to GoKitt DocStore (fire-and-forget)
function syncNoteToDocStore(id: string, content: any, version: number): void {
    // Use the goKitt service from highlighter-api (already wired at startup)
    import('../../api/highlighter-api').then((api) => {
        const goKitt = (api as any).getGoKittService?.();
        if (goKitt) {
            const text = typeof content === 'string' ? content : JSON.stringify(content);
            goKitt.upsertNote(id, text, version).catch((e: any) =>
                console.warn('[NebulaOps] DocStore sync failed:', e)
            );
        }
    }).catch(() => {
        // Module not loaded - skip silently
    });
}

export async function deleteNote(id: string): Promise<void> {
    if (_bridge?.isReady()) {
        await _bridge.deleteNote(id);
    } else {
        await nebulaDb.notes.delete({ id });
    }
}

export async function getNote(id: string): Promise<Note | undefined> {
    // Try NebulaDB first
    const doc = await nebulaDb.notes.findOne({ id });
    if (doc) return doc as Note;

    // Fallback to Dexie if not hydrated yet
    const { db } = await import('../dexie/db');
    return db.notes.get(id);
}

export async function getAllNotes(): Promise<Note[]> {
    const docs = await nebulaDb.notes.find({});
    if (docs.length > 0) return docs as Note[];

    // Fallback to Dexie if not hydrated yet
    const { db } = await import('../dexie/db');
    return db.notes.toArray();
}

export async function getNotesByFolder(folderId: string): Promise<Note[]> {
    const docs = await nebulaDb.notes.find({ folderId });
    if (docs.length > 0) return docs as Note[];

    // Fallback to Dexie if not hydrated yet
    const { db } = await import('../dexie/db');
    return db.notes.where('folderId').equals(folderId).toArray();
}

// =============================================================================
// FOLDER OPERATIONS
// =============================================================================

export async function createFolder(folder: Omit<Folder, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
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

    if (_bridge?.isReady()) {
        await _bridge.syncFolder(fullFolder);
    } else {
        await nebulaDb.folders.insert(fullFolder);
    }

    return id;
}

export async function updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
    const existing = await nebulaDb.folders.findOne({ id }) as Folder | null;
    if (!existing) return;

    const updatedFolder = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
    } as Folder;

    if (_bridge?.isReady()) {
        await _bridge.syncFolder(updatedFolder);
    } else {
        await nebulaDb.folders.update({ id }, { $set: updatedFolder });
    }
}

export async function deleteFolder(id: string): Promise<void> {
    if (_bridge?.isReady()) {
        await _bridge.deleteFolder(id);
    } else {
        await nebulaDb.folders.delete({ id });
    }
}

export async function getFolder(id: string): Promise<Folder | undefined> {
    const doc = await nebulaDb.folders.findOne({ id });
    return doc as Folder | undefined;
}

export async function getAllFolders(): Promise<Folder[]> {
    const docs = await nebulaDb.folders.find({});
    return docs as Folder[];
}

export async function getFolderChildren(parentId: string): Promise<Folder[]> {
    const docs = await nebulaDb.folders.find({ parentId });
    return docs as Folder[];
}

// =============================================================================
// ENTITY OPERATIONS
// =============================================================================

export async function upsertEntity(entity: Entity): Promise<void> {
    if (_bridge?.isReady()) {
        await _bridge.syncEntity(entity);
    } else {
        const existing = await nebulaDb.entities.findOne({ id: entity.id });
        if (existing) {
            await nebulaDb.entities.update({ id: entity.id }, { $set: entity });
        } else {
            await nebulaDb.entities.insert(entity);
        }
    }
}

export async function deleteEntity(id: string): Promise<void> {
    if (_bridge?.isReady()) {
        await _bridge.deleteEntity(id);
    } else {
        await nebulaDb.entities.delete({ id });
    }
}

export async function getEntity(id: string): Promise<Entity | undefined> {
    const doc = await nebulaDb.entities.findOne({ id });
    return doc as Entity | undefined;
}

export async function getAllEntities(): Promise<Entity[]> {
    const docs = await nebulaDb.entities.find({});
    return docs as Entity[];
}

export async function getEntitiesByKind(kind: string): Promise<Entity[]> {
    const docs = await nebulaDb.entities.find({ kind });
    return docs as Entity[];
}

// =============================================================================
// ORDERING HELPERS
// =============================================================================

const DEFAULT_ORDER_STEP = 1000;

export async function getNextNoteOrder(folderId: string): Promise<number> {
    const siblings = await nebulaDb.notes.find({ folderId });
    if (siblings.length === 0) {
        return DEFAULT_ORDER_STEP;
    }
    const maxOrder = Math.max(...siblings.map((n: any) => n.order || 0), 0);
    return maxOrder + DEFAULT_ORDER_STEP;
}

export async function getNextFolderOrder(parentId: string): Promise<number> {
    const siblings = await nebulaDb.folders.find({ parentId });
    if (siblings.length === 0) {
        return DEFAULT_ORDER_STEP;
    }
    const maxOrder = Math.max(...siblings.map((f: any) => f.order || 0), 0);
    return maxOrder + DEFAULT_ORDER_STEP;
}
