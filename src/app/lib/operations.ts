// src/app/lib/operations.ts
// CRUD operations using GoSQLite as primary store
// NO COZODB. NO DEXIE (except model cache).

import type { DataSyncService } from './bridge/DataSyncService';
import type { GoKittStoreService, StoreNote, StoreEntity, StoreFolder } from '../services/gokitt-store.service';

// Re-export types for consumers
export interface Note {
    id: string;
    worldId: string;
    title: string;
    content: string;
    markdownContent: string;
    folderId: string;
    entityKind: string;
    entitySubtype: string;
    isEntity: boolean;
    isPinned: boolean;
    favorite: boolean;
    ownerId: string;
    createdAt: number;
    updatedAt: number;
    narrativeId: string;
    order: number;
}

export interface Folder {
    id: string;
    worldId: string;
    name: string;
    parentId: string;
    entityKind: string;
    entitySubtype: string;
    entityLabel: string;
    color: string;
    isTypedRoot: boolean;
    isSubtypeRoot: boolean;
    collapsed: boolean;
    ownerId: string;
    createdAt: number;
    updatedAt: number;
    narrativeId: string;
    isNarrativeRoot: boolean;
    networkId?: string;
    metadata?: {
        date?: { year: number; monthIndex: number; dayIndex: number };
    };
    attributes?: Record<string, any>;
    order: number;
}

export interface Entity {
    id: string;
    label: string;
    kind: string;
    subtype?: string;
    aliases: string[];
    firstNote: string;
    totalMentions: number;
    createdAt: number;
    updatedAt: number;
    createdBy: 'user' | 'extraction' | 'auto';
    narrativeId?: string;
}

// =============================================================================
// BRIDGE ACCESS
// =============================================================================

let _bridge: DataSyncService | null = null;
let _bridgeResolve: (() => void) | null = null;
const _bridgeReady = new Promise<void>(resolve => { _bridgeResolve = resolve; });

export function setGoSqliteBridge(bridge: DataSyncService): void {
    _bridge = bridge;
    console.log('[Operations] DataSyncService connected');
    _bridgeResolve?.();
}

function requireBridge(): DataSyncService {
    if (!_bridge || !_bridge.isReadySync()) {
        throw new Error('[Operations] Sync Service not ready - called too early');
    }
    return _bridge;
}

/** Wait for bridge to be ready (for writes that arrive before boot completes) */
async function waitForBridge(): Promise<DataSyncService> {
    await _bridgeReady;
    return _bridge!;
}

function getBridge(): DataSyncService | null {
    return _bridge?.isReadySync() ? _bridge : null;
}


// =============================================================================
// NOTE OPERATIONS
// =============================================================================

export async function createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
    const bridge = requireBridge();
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
    } as Note;

    // Write to GoSQLite
    await bridge.syncNote(fullNote as any);

    return id;
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
    const bridge = await waitForBridge();

    // Get existing from GoSQLite
    const existing = await bridge.getNote(id);
    if (!existing) {
        console.warn(`[Operations] Note ${id} not found`);
        return;
    }

    const updatedNote = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
    };

    await bridge.syncNote(updatedNote as any);

    // Sync content to GoKitt DocStore (if content was updated)
    if (updates.content !== undefined) {
        syncNoteToDocStore(id, updates.content, updatedNote.updatedAt);
    }
}

// Lazy sync to GoKitt DocStore (fire-and-forget)
function syncNoteToDocStore(id: string, content: any, version: number): void {
    import('../api/pretty-text-api').then((api) => {
        const goKitt = (api as any).getGoKittService?.();
        if (goKitt) {
            const text = typeof content === 'string' ? content : JSON.stringify(content);
            goKitt.upsertNote(id, text, version).catch((e: any) =>
                console.warn('[Operations] DocStore sync failed:', e)
            );
        }
    }).catch(() => {
        // Module not loaded - skip silently
    });
}

export async function deleteNote(id: string): Promise<void> {
    const bridge = requireBridge();
    await bridge.deleteNote(id);
}

export async function getNote(id: string): Promise<Note | undefined> {
    const bridge = getBridge();
    if (!bridge) return undefined;

    const note = await bridge.getNote(id);
    return note ? storeNoteToNote(note) : undefined;
}

export async function getAllNotes(): Promise<Note[]> {
    const bridge = getBridge();
    if (!bridge) return [];

    const notes = await bridge.getAllNotes();
    return notes.map(storeNoteToNote);
}

export async function getNotesByFolder(folderId: string): Promise<Note[]> {
    const bridge = getBridge();
    if (!bridge) return [];

    const notes = await bridge.getNotesByFolder(folderId);
    return notes.map(storeNoteToNote);
}

export async function getNotesByNarrative(narrativeId: string): Promise<Note[]> {
    const bridge = getBridge();
    if (!bridge) return [];

    // Query notes by narrativeId from GoSQLite via bridge
    const allNotes = await bridge.getAllNotes();
    return allNotes
        .filter(n => n.narrativeId === narrativeId)
        .map(storeNoteToNote);
}

// Convert StoreNote to Note interface
function storeNoteToNote(sn: StoreNote): Note {
    return {
        id: sn.id,
        worldId: sn.worldId,
        title: sn.title,
        content: sn.content,
        markdownContent: sn.markdownContent,
        folderId: sn.folderId,
        entityKind: sn.entityKind,
        entitySubtype: sn.entitySubtype,
        isEntity: sn.isEntity,
        isPinned: sn.isPinned,
        favorite: sn.favorite,
        ownerId: sn.ownerId,
        createdAt: sn.createdAt,
        updatedAt: sn.updatedAt,
        narrativeId: sn.narrativeId,
        order: sn.order,
    };
}

// =============================================================================
// FOLDER OPERATIONS (folders now in GoSQLite, not CozoDB)
// =============================================================================

export async function createFolder(folder: Omit<Folder, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
    const bridge = requireBridge();
    const id = crypto.randomUUID();
    const now = Date.now();

    const order = await getNextFolderOrder(folder.parentId);

    const fullFolder: Folder = {
        ...folder,
        id,
        order,
        createdAt: now,
        updatedAt: now,
    } as Folder;

    await bridge.syncFolder(fullFolder as any);
    return id;
}

export async function updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
    const bridge = requireBridge();

    // Get folder from GoSQLite
    const existing = await bridge.getFolder(id);
    if (!existing) {
        console.warn(`[Operations] Folder ${id} not found`);
        return;
    }

    const updatedFolder = {
        ...existing,
        ...updates,
        updatedAt: Date.now(),
    };

    await bridge.syncFolder(updatedFolder as any);
}

export async function deleteFolder(id: string): Promise<void> {
    const bridge = requireBridge();
    await bridge.deleteFolder(id);
}

export async function getFolder(id: string): Promise<Folder | undefined> {
    const bridge = getBridge();
    if (!bridge) return undefined;

    const folder = await bridge.getFolder(id);
    return folder ? storeFolderToFolder(folder) : undefined;
}

export async function getAllFolders(): Promise<Folder[]> {
    const bridge = getBridge();
    if (!bridge) return [];

    const folders = await bridge.getAllFolders();
    return folders.map(storeFolderToFolder);
}

export async function getFolderChildren(parentId: string): Promise<Folder[]> {
    const bridge = getBridge();
    if (!bridge) return [];

    const allFolders = await bridge.getAllFolders();
    return allFolders
        .filter(f => f.parentId === parentId)
        .map(storeFolderToFolder);
}

function storeFolderToFolder(sf: StoreFolder): Folder {
    return {
        id: sf.id,
        worldId: sf.worldId,
        name: sf.name,
        parentId: sf.parentId || '',
        entityKind: '',      // Not in StoreFolder - use default
        entitySubtype: '',   // Not in StoreFolder - use default
        entityLabel: '',     // Not in StoreFolder - use default
        color: '',           // Not in StoreFolder - use default
        isTypedRoot: false,  // Not in StoreFolder - use default
        isSubtypeRoot: false, // Not in StoreFolder - use default
        collapsed: false,    // Not in StoreFolder - use default
        ownerId: '',         // Not in StoreFolder - use default
        createdAt: sf.createdAt,
        updatedAt: sf.updatedAt,
        narrativeId: sf.narrativeId || '',
        isNarrativeRoot: false, // Not in StoreFolder - use default
        networkId: undefined,   // Not in StoreFolder
        metadata: undefined,    // Not in StoreFolder
        order: sf.folderOrder,
    };
}

// =============================================================================
// ENTITY OPERATIONS (GraphRegistry is the source of truth, this is secondary)
// =============================================================================

export async function upsertEntity(entity: Entity): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
        console.warn('[Operations] Bridge not ready for entity upsert');
        return;
    }

    await bridge.syncEntity(entity as any);
}

export async function deleteEntity(id: string): Promise<void> {
    const bridge = getBridge();
    if (!bridge) return;

    await bridge.deleteEntity(id);
}

export async function getEntity(id: string): Promise<Entity | undefined> {
    const bridge = getBridge();
    if (!bridge) return undefined;

    const entity = await bridge.getEntity(id);
    return entity ? storeEntityToEntity(entity) : undefined;
}

export async function getAllEntities(): Promise<Entity[]> {
    const bridge = getBridge();
    if (!bridge) return [];

    const entities = await bridge.getAllEntities();
    return entities.map(storeEntityToEntity);
}

export async function getEntitiesByKind(kind: string): Promise<Entity[]> {
    const bridge = getBridge();
    if (!bridge) return [];

    const entities = await bridge.getAllEntities();
    return entities.filter(e => e.kind === kind).map(storeEntityToEntity);
}

export async function getEntitiesByNarrative(narrativeId: string): Promise<Entity[]> {
    const bridge = getBridge();
    if (!bridge) return [];

    const entities = await bridge.getAllEntities();
    return entities.filter(e => e.narrativeId === narrativeId).map(storeEntityToEntity);
}

function storeEntityToEntity(se: StoreEntity): Entity {
    return {
        id: se.id,
        label: se.label,
        kind: se.kind,
        subtype: se.subtype,
        aliases: se.aliases,
        firstNote: se.firstNote,
        totalMentions: se.totalMentions,
        createdAt: se.createdAt,
        updatedAt: se.updatedAt,
        createdBy: se.createdBy as 'user' | 'extraction' | 'auto',
        narrativeId: se.narrativeId,
    };
}

// =============================================================================
// ORDERING HELPERS
// =============================================================================

const DEFAULT_ORDER_STEP = 1000;
const MIN_ORDER_GAP = 10;

export async function getNextNoteOrder(folderId: string): Promise<number> {
    const notes = await getNotesByFolder(folderId);
    if (notes.length === 0) return DEFAULT_ORDER_STEP;
    const maxOrder = Math.max(...notes.map(n => n.order || 0), 0);
    return maxOrder + DEFAULT_ORDER_STEP;
}

export async function getNextFolderOrder(parentId: string): Promise<number> {
    const folders = await getFolderChildren(parentId);
    if (folders.length === 0) return DEFAULT_ORDER_STEP;
    const maxOrder = Math.max(...folders.map(f => f.order || 0), 0);
    return maxOrder + DEFAULT_ORDER_STEP;
}

// =============================================================================
// REORDER OPERATIONS
// =============================================================================

/**
 * Calculate a new order value for insertion at a specific position.
 */
function calculateNewOrder(prevOrder: number, nextOrder: number): number {
    if (prevOrder === 0 && nextOrder === 0) {
        return DEFAULT_ORDER_STEP;
    }
    if (nextOrder === 0) {
        return prevOrder + DEFAULT_ORDER_STEP;
    }
    return (prevOrder + nextOrder) / 2;
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
 * Rebalance orders for notes in a folder.
 */
async function rebalanceNoteOrders(folderId: string): Promise<void> {
    const bridge = getBridge();
    if (!bridge) return;

    const notes = await getNotesByFolder(folderId);
    notes.sort((a, b) => a.order - b.order);

    for (let i = 0; i < notes.length; i++) {
        await bridge.syncNote({ ...notes[i], order: (i + 1) * DEFAULT_ORDER_STEP } as any);
    }
    console.log(`[Operations] Rebalanced ${notes.length} note orders in folder ${folderId || 'root'}`);
}

/**
 * Rebalance orders for folders in a parent.
 */
async function rebalanceFolderOrders(parentId: string): Promise<void> {
    const bridge = getBridge();
    if (!bridge) return;

    const folders = await getFolderChildren(parentId);
    folders.sort((a, b) => a.order - b.order);

    for (let i = 0; i < folders.length; i++) {
        await bridge.syncFolder({ ...folders[i], order: (i + 1) * DEFAULT_ORDER_STEP } as any);
    }
    console.log(`[Operations] Rebalanced ${folders.length} folder orders in parent ${parentId || 'root'}`);
}

/**
 * Reorder a note among its siblings.
 */
export async function reorderNote(noteId: string, targetIndex: number): Promise<void> {
    const bridge = requireBridge();
    const note = await bridge.getNote(noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);

    const siblings = await getNotesByFolder(note.folderId);
    siblings.sort((a, b) => a.order - b.order);

    const filteredSiblings = siblings.filter(n => n.id !== noteId);

    const prevOrder = filteredSiblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = filteredSiblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    await bridge.syncNote({ ...note, order: newOrder, updatedAt: Date.now() } as any);

    const allOrders = [...filteredSiblings.map(n => n.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceNoteOrders(note.folderId);
    }

    console.log(`[Operations] Reordered note ${noteId} to position ${targetIndex}`);
}

/**
 * Reorder a folder among its siblings.
 */
export async function reorderFolder(folderId: string, targetIndex: number): Promise<void> {
    const folder = await getFolder(folderId);
    if (!folder) throw new Error(`Folder ${folderId} not found`);

    const bridge = requireBridge();
    const siblings = await getFolderChildren(folder.parentId);
    siblings.sort((a, b) => a.order - b.order);

    const filteredSiblings = siblings.filter(f => f.id !== folderId);

    const prevOrder = filteredSiblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = filteredSiblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    await bridge.syncFolder({ ...folder, order: newOrder, updatedAt: Date.now() } as any);

    const allOrders = [...filteredSiblings.map(f => f.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceFolderOrders(folder.parentId);
    }

    console.log(`[Operations] Reordered folder ${folderId} to position ${targetIndex}`);
}

/**
 * Move a note to a different folder.
 */
export async function moveNoteToFolder(noteId: string, targetFolderId: string, targetIndex: number): Promise<void> {
    const bridge = requireBridge();
    const note = await bridge.getNote(noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);

    const siblings = await getNotesByFolder(targetFolderId);
    siblings.sort((a, b) => a.order - b.order);

    const prevOrder = siblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = siblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    await bridge.syncNote({
        ...note,
        folderId: targetFolderId,
        order: newOrder,
        updatedAt: Date.now()
    } as any);

    const allOrders = [...siblings.map(n => n.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceNoteOrders(targetFolderId);
    }

    console.log(`[Operations] Moved note ${noteId} to folder ${targetFolderId}`);
}

/**
 * Move a folder to a different parent.
 */
export async function moveFolderToParent(folderId: string, targetParentId: string, targetIndex: number): Promise<void> {
    const folder = await getFolder(folderId);
    if (!folder) throw new Error(`Folder ${folderId} not found`);

    const bridge = requireBridge();
    const siblings = await getFolderChildren(targetParentId);
    siblings.sort((a, b) => a.order - b.order);

    const prevOrder = siblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = siblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    await bridge.syncFolder({
        ...folder,
        parentId: targetParentId,
        order: newOrder,
        updatedAt: Date.now()
    } as any);

    const allOrders = [...siblings.map(f => f.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceFolderOrders(targetParentId);
    }

    console.log(`[Operations] Moved folder ${folderId} to parent ${targetParentId}`);
}

/**
 * Swap two items by ID.
 */
export async function swapItems(sourceId: string, targetId: string, type: 'folder' | 'note'): Promise<void> {
    const bridge = requireBridge();

    if (type === 'folder') {
        const source = await getFolder(sourceId);
        const target = await getFolder(targetId);
        if (!source || !target) throw new Error('Folder not found');

        await bridge.syncFolder({ ...source, order: target.order, updatedAt: Date.now() } as any);
        await bridge.syncFolder({ ...target, order: source.order, updatedAt: Date.now() } as any);
    } else {
        const source = await bridge.getNote(sourceId);
        const target = await bridge.getNote(targetId);
        if (!source || !target) throw new Error('Note not found');

        await bridge.syncNote({ ...source, order: target.order, updatedAt: Date.now() } as any);
        await bridge.syncNote({ ...target, order: source.order, updatedAt: Date.now() } as any);
    }

    console.log(`[Operations] Swapped ${type}s: ${sourceId} <-> ${targetId}`);
}
