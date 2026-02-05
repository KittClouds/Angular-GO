// src/app/lib/dexie/operations.ts
// CRUD operations for Dexie - matches React reference
// Now includes dual-write to NebulaDB via NebulaCozoBridge

import { db, Note, Folder, Entity } from './db';
import { inject, Injector, runInInjectionContext } from '@angular/core';

// Lazy accessor for NebulaCozoBridge (non-DI context compatible)
let _nebulaBridge: any = null;

function getNebulaBridge() {
    if (!_nebulaBridge) {
        // Dynamically import to avoid circular dependency
        import('../bridge/NebulaCozoBridge').then(module => {
            // The bridge is providedIn: 'root', so we need the injector
            // For now, just set a flag since we can't access injector here
            console.log('[Operations] NebulaCozoBridge module loaded');
        }).catch(() => {
            // Fallback: bridge not available
        });
    }
    return _nebulaBridge;
}

// Export setter for app initialization to provide the bridge
export function setNebulaBridge(bridge: any): void {
    _nebulaBridge = bridge;
    console.log('[Operations] NebulaCozoBridge connected');
}

// Stubbed KittCore (will be wired to WASM later)
const kittCore = {
    registryUpsertEntity: async (..._args: any[]) => { },
    registryDeleteEntity: async (_id: string) => { },
    registryGetAllEntities: async (): Promise<any[]> => []
};

// =============================================================================
// NOTE OPERATIONS
// =============================================================================

export async function createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    // Get next order for this folder
    const order = await getNextNoteOrder(note.folderId);

    const fullNote: Note = {
        ...note,
        id,
        order,
        createdAt: now,
        updatedAt: now,
    };

    await db.notes.add(fullNote);

    // Dual-write: Sync to NebulaDB (if bridge available)
    if (_nebulaBridge?.isReady()) {
        _nebulaBridge.syncNote(fullNote).catch(console.error);
    }

    // Legacy: Sync to Rust Cozo (fire-and-forget)
    syncNoteToCozo(id).catch(console.error);

    return id;
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
    const updatedAt = Date.now();

    await db.notes.update(id, {
        ...updates,
        updatedAt,
    });

    // Dual-write: Sync full note to NebulaDB
    if (_nebulaBridge?.isReady()) {
        const fullNote = await db.notes.get(id);
        if (fullNote) {
            _nebulaBridge.syncNote(fullNote).catch(console.error);
        }
    }

    syncNoteToCozo(id).catch(console.error);
}

export async function deleteNote(id: string): Promise<void> {
    await db.notes.delete(id);

    // Dual-write: Delete from NebulaDB
    if (_nebulaBridge?.isReady()) {
        _nebulaBridge.deleteNote(id).catch(console.error);
    }
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

export async function createFolder(folder: Omit<Folder, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();

    // Get next order for this parent
    const order = await getNextFolderOrder(folder.parentId);

    const fullFolder: Folder = {
        ...folder,
        id,
        order,
        createdAt: now,
        updatedAt: now,
    };

    await db.folders.add(fullFolder);

    // Dual-write: Sync to NebulaDB
    if (_nebulaBridge?.isReady()) {
        _nebulaBridge.syncFolder(fullFolder).catch(console.error);
    }

    return id;
}

export async function updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
    const updatedAt = Date.now();

    await db.folders.update(id, {
        ...updates,
        updatedAt,
    });

    // Dual-write: Sync full folder to NebulaDB
    if (_nebulaBridge?.isReady()) {
        const fullFolder = await db.folders.get(id);
        if (fullFolder) {
            _nebulaBridge.syncFolder(fullFolder).catch(console.error);
        }
    }
}

export async function deleteFolder(id: string): Promise<void> {
    await db.folders.delete(id);

    // Dual-write: Delete from NebulaDB
    if (_nebulaBridge?.isReady()) {
        _nebulaBridge.deleteFolder(id).catch(console.error);
    }
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

    // Dual-write: Sync to NebulaDB
    if (_nebulaBridge?.isReady()) {
        _nebulaBridge.syncEntity(entity).catch(console.error);
    }

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

    // Dual-write: Delete from NebulaDB
    if (_nebulaBridge?.isReady()) {
        _nebulaBridge.deleteEntity(id).catch(console.error);
    }

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
    // Currently a no-op stub
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

// =============================================================================
// REORDERING OPERATIONS (Phase B: Drag-and-Drop)
// =============================================================================

const DEFAULT_ORDER_STEP = 1000;
const MIN_ORDER_GAP = 10;  // Trigger rebalance if gap is smaller than this

/**
 * Calculate a new order value for insertion at a specific position.
 * Uses float-based ordering to minimize sibling updates.
 */
function calculateNewOrder(prevOrder: number, nextOrder: number): number {
    if (prevOrder === 0 && nextOrder === 0) {
        return DEFAULT_ORDER_STEP;  // First item
    }
    if (nextOrder === 0) {
        return prevOrder + DEFAULT_ORDER_STEP;  // Insert at end
    }
    return (prevOrder + nextOrder) / 2;  // Insert between
}

/**
 * Check if orders need rebalancing (gaps too small).
 */
function needsRebalancing(orders: number[]): boolean {
    for (let i = 1; i < orders.length; i++) {
        if (orders[i] - orders[i - 1] < MIN_ORDER_GAP) {
            return true;
        }
    }
    return false;
}

/**
 * Rebalance orders for a set of siblings to restore gap size.
 */
async function rebalanceFolderOrders(parentId: string): Promise<void> {
    const folders = await db.folders
        .where('parentId')
        .equals(parentId)
        .sortBy('order');

    const updates = folders.map((folder, index) => ({
        key: folder.id,
        changes: { order: (index + 1) * DEFAULT_ORDER_STEP }
    }));

    await db.folders.bulkUpdate(updates);
    console.log(`[Dexie] Rebalanced ${folders.length} folder orders in parent ${parentId || 'root'}`);
}

/**
 * Rebalance orders for notes in a folder.
 */
async function rebalanceNoteOrders(folderId: string): Promise<void> {
    const notes = await db.notes
        .where('folderId')
        .equals(folderId)
        .sortBy('order');

    const updates = notes.map((note, index) => ({
        key: note.id,
        changes: { order: (index + 1) * DEFAULT_ORDER_STEP }
    }));

    await db.notes.bulkUpdate(updates);
    console.log(`[Dexie] Rebalanced ${notes.length} note orders in folder ${folderId || 'root'}`);
}

/**
 * Get the next order value for a new folder in a parent.
 */
export async function getNextFolderOrder(parentId: string): Promise<number> {
    const siblings = await db.folders
        .where('parentId')
        .equals(parentId)
        .toArray();

    if (siblings.length === 0) {
        return DEFAULT_ORDER_STEP;
    }

    const maxOrder = Math.max(...siblings.map(f => f.order), 0);
    return maxOrder + DEFAULT_ORDER_STEP;
}

/**
 * Get the next order value for a new note in a folder.
 */
export async function getNextNoteOrder(folderId: string): Promise<number> {
    const siblings = await db.notes
        .where('folderId')
        .equals(folderId)
        .toArray();

    if (siblings.length === 0) {
        return DEFAULT_ORDER_STEP;
    }

    const maxOrder = Math.max(...siblings.map(n => n.order), 0);
    return maxOrder + DEFAULT_ORDER_STEP;
}

/**
 * Reorder a folder among its siblings.
 * @param folderId - The folder to move
 * @param targetIndex - The target position (0-based)
 */
export async function reorderFolder(folderId: string, targetIndex: number): Promise<void> {
    const folder = await db.folders.get(folderId);
    if (!folder) throw new Error(`Folder ${folderId} not found`);

    // Get siblings sorted by order
    const siblings = await db.folders
        .where('parentId')
        .equals(folder.parentId)
        .sortBy('order');

    // Remove the folder being moved
    const filteredSiblings = siblings.filter(f => f.id !== folderId);

    // Calculate new order
    const prevOrder = filteredSiblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = filteredSiblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    // Update the folder
    await db.folders.update(folderId, {
        order: newOrder,
        updatedAt: Date.now()
    });

    // Check if we need to rebalance
    const allOrders = [...filteredSiblings.map(f => f.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceFolderOrders(folder.parentId);
    }

    console.log(`[Dexie] Reordered folder ${folderId} to position ${targetIndex} (order: ${newOrder})`);
}

/**
 * Reorder a note among its siblings.
 * @param noteId - The note to move
 * @param targetIndex - The target position (0-based)
 */
export async function reorderNote(noteId: string, targetIndex: number): Promise<void> {
    const note = await db.notes.get(noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);

    // Get siblings sorted by order
    const siblings = await db.notes
        .where('folderId')
        .equals(note.folderId)
        .sortBy('order');

    // Remove the note being moved
    const filteredSiblings = siblings.filter(n => n.id !== noteId);

    // Calculate new order
    const prevOrder = filteredSiblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = filteredSiblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    // Update the note
    await db.notes.update(noteId, {
        order: newOrder,
        updatedAt: Date.now()
    });

    // Check if we need to rebalance
    const allOrders = [...filteredSiblings.map(n => n.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceNoteOrders(note.folderId);
    }

    console.log(`[Dexie] Reordered note ${noteId} to position ${targetIndex} (order: ${newOrder})`);
}

/**
 * Move a folder to a different parent (cross-container move).
 * @param folderId - The folder to move
 * @param targetParentId - The new parent folder ID
 * @param targetIndex - The target position in the new parent (0-based)
 */
export async function moveFolderToParent(
    folderId: string,
    targetParentId: string,
    targetIndex: number
): Promise<void> {
    const folder = await db.folders.get(folderId);
    if (!folder) throw new Error(`Folder ${folderId} not found`);

    // Get siblings in target parent
    const siblings = await db.folders
        .where('parentId')
        .equals(targetParentId)
        .sortBy('order');

    // Calculate new order
    const prevOrder = siblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = siblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    // Update folder in single transaction
    await db.folders.update(folderId, {
        parentId: targetParentId,
        order: newOrder,
        updatedAt: Date.now()
    });

    // Check if we need to rebalance in target parent
    const allOrders = [...siblings.map(f => f.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceFolderOrders(targetParentId);
    }

    console.log(`[Dexie] Moved folder ${folderId} to parent ${targetParentId} at position ${targetIndex}`);
}

/**
 * Move a note to a different folder (cross-container move).
 * @param noteId - The note to move
 * @param targetFolderId - The new folder ID
 * @param targetIndex - The target position in the new folder (0-based)
 */
export async function moveNoteToFolder(
    noteId: string,
    targetFolderId: string,
    targetIndex: number
): Promise<void> {
    const note = await db.notes.get(noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);

    // Get siblings in target folder
    const siblings = await db.notes
        .where('folderId')
        .equals(targetFolderId)
        .sortBy('order');

    // Calculate new order
    const prevOrder = siblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = siblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    // Update note in single transaction
    await db.notes.update(noteId, {
        folderId: targetFolderId,
        order: newOrder,
        updatedAt: Date.now()
    });

    // Sync to Cozo
    syncNoteToCozo(noteId).catch(console.error);

    // Check if we need to rebalance in target folder
    const allOrders = [...siblings.map(n => n.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceNoteOrders(targetFolderId);
    }

    console.log(`[Dexie] Moved note ${noteId} to folder ${targetFolderId} at position ${targetIndex}`);
}

/**
 * Swap two items (folders or notes) by ID.
 * Used by Swapy drag-and-drop.
 */
export async function swapItems(
    sourceId: string,
    targetId: string,
    type: 'folder' | 'note'
): Promise<void> {
    if (type === 'folder') {
        const [source, target] = await Promise.all([
            db.folders.get(sourceId),
            db.folders.get(targetId)
        ]);

        if (!source || !target) throw new Error('Folder not found');

        // Swap orders
        await db.folders.update(sourceId, {
            order: target.order,
            updatedAt: Date.now()
        });
        await db.folders.update(targetId, {
            order: source.order,
            updatedAt: Date.now()
        });
    } else {
        const [source, target] = await Promise.all([
            db.notes.get(sourceId),
            db.notes.get(targetId)
        ]);

        if (!source || !target) throw new Error('Note not found');

        // Swap orders
        await db.notes.update(sourceId, {
            order: target.order,
            updatedAt: Date.now()
        });
        await db.notes.update(targetId, {
            order: source.order,
            updatedAt: Date.now()
        });

        syncNoteToCozo(sourceId).catch(console.error);
        syncNoteToCozo(targetId).catch(console.error);
    }
}
