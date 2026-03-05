/**
 * Operations Module — Pure SQLite CRUD
 * 
 * Architecture (Pure OPFS + Go Memory):
 * - GoKittStoreService is the ONLY source of truth
 * - Dexie is an ephemeral, in-memory state cache for Angular UI
 * - DataSyncService is ELIMINATED
 * - All CRUD goes directly to Go SQLite via the WASM worker
 */
import { db } from './dexie/db';
import { GoKittStoreService, StoreNote, StoreFolder, StoreEntity, StoreEdge } from '../services/gokitt-store.service';

// =============================================================================
// INTERFACES
// =============================================================================

export interface Note {
    id: string;
    worldId: string;
    title: string;
    content: any;
    markdownContent: string;
    folderId: string;
    entityKind?: string;
    entitySubtype?: string;
    isEntity?: boolean;
    isPinned?: boolean;
    favorite?: boolean;
    ownerId: string;
    createdAt: number;
    updatedAt: number;
    narrativeId?: string;
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
    aliases?: string[];
    firstNote?: string;
    totalMentions?: number;
    createdAt: number;
    updatedAt: number;
    createdBy?: 'user' | 'extraction' | 'auto';
    narrativeId?: string;
}

export interface Edge {
    id: string;
    sourceId: string;
    targetId: string;
    relType: string;
    confidence?: number;
    bidirectional?: boolean;
}

// =============================================================================
// STORE ACCESS (Direct to GoKittStoreService — NO DataSyncService)
// =============================================================================

let _store: GoKittStoreService | null = null;
let _storeResolve: (() => void) | null = null;
const _storeReady = new Promise<void>(resolve => { _storeResolve = resolve; });

export function setGoSqliteBridge(store: GoKittStoreService): void {
    _store = store;
    console.log('[Operations] GoKittStoreService connected (Direct Mode)');
    _storeResolve?.();
}

function requireStore(): GoKittStoreService {
    if (!_store || !_store.isReady) {
        throw new Error('[Operations] GoKittStoreService not ready - called too early');
    }
    return _store;
}

async function waitForStore(): Promise<GoKittStoreService> {
    await _storeReady;
    return _store!;
}

export function getBridge(): GoKittStoreService | null {
    return _store?.isReady ? _store : null;
}

// =============================================================================
// DEXIE WARMING (Best-effort ephemeral state cache)
// =============================================================================

function warmDexieNote(note: Note): void {
    db.notes.put(note as any).catch(() => { });
}

function warmDexieFolder(folder: Folder): void {
    db.folders.put(folder as any).catch(() => { });
}

function warmDexieEntity(entity: Entity): void {
    db.entities.put(entity as any).catch(() => { });
}

// =============================================================================
// NOTE OPERATIONS
// =============================================================================

export async function createNote(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
    const store = requireStore();
    const id = crypto.randomUUID();
    const now = Date.now();
    const order = await getNextNoteOrder(note.folderId);

    const fullNote: Note = {
        ...note,
        id,
        order,
        createdAt: now,
        updatedAt: now,
    } as Note;

    await store.upsertNote(GoKittStoreService.fromDexieNote(fullNote));
    warmDexieNote(fullNote);
    return id;
}

export async function updateNote(id: string, updates: Partial<Note>): Promise<void> {
    const store = await waitForStore();
    const existing = await store.getNote(id);
    if (!existing) {
        console.warn(`[Operations] Note ${id} not found`);
        return;
    }

    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    await store.upsertNote(merged as StoreNote);
    warmDexieNote(storeNoteToNote(merged as StoreNote));

    if (updates.content !== undefined) {
        syncNoteToDocStore(id, updates.content, merged.updatedAt);
    }
}

function syncNoteToDocStore(id: string, content: any, version: number): void {
    import('../api/pretty-text-api').then((api) => {
        const goKitt = (api as any).getGoKittService?.();
        if (goKitt) {
            const text = typeof content === 'string' ? content : JSON.stringify(content);
            goKitt.upsertNote(id, text, version).catch((e: any) =>
                console.warn('[Operations] DocStore sync failed:', e)
            );
        }
    }).catch(() => { });
}

export async function deleteNote(id: string): Promise<void> {
    const store = requireStore();
    await store.deleteNote(id);
    db.notes.delete(id).catch(() => { });
}

export async function getNote(id: string): Promise<Note | undefined> {
    const store = getBridge();
    if (!store) return undefined;
    const note = await store.getNote(id);
    return note ? storeNoteToNote(note) : undefined;
}

export async function getAllNotes(): Promise<Note[]> {
    const store = getBridge();
    if (!store) return [];
    const notes = await store.listNotes();
    return notes.map(storeNoteToNote);
}

export async function getNotesByFolder(folderId: string): Promise<Note[]> {
    const store = getBridge();
    if (!store) return [];
    const notes = await store.listNotes(folderId);
    return notes.map(storeNoteToNote);
}

export async function getNotesByNarrative(narrativeId: string): Promise<Note[]> {
    const store = getBridge();
    if (!store) return [];
    const allNotes = await store.listNotes();
    return allNotes
        .filter(n => n.narrativeId === narrativeId)
        .map(storeNoteToNote);
}

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
// FOLDER OPERATIONS
// =============================================================================

export async function createFolder(folder: Omit<Folder, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
    const store = requireStore();
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

    await store.upsertFolder(GoKittStoreService.fromDexieFolder(fullFolder));
    warmDexieFolder(fullFolder);
    return id;
}

export async function updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
    const store = requireStore();
    const existing = await store.getFolder(id);
    if (!existing) {
        console.warn(`[Operations] Folder ${id} not found`);
        return;
    }

    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    await store.upsertFolder(merged as StoreFolder);
    warmDexieFolder(storeFolderToFolder(merged as StoreFolder));
}

export async function deleteFolder(id: string): Promise<void> {
    const store = requireStore();
    await store.deleteFolder(id);
    db.folders.delete(id).catch(() => { });
}

export async function getFolder(id: string): Promise<Folder | undefined> {
    const store = getBridge();
    if (!store) return undefined;
    const folder = await store.getFolder(id);
    return folder ? storeFolderToFolder(folder) : undefined;
}

export async function getAllFolders(): Promise<Folder[]> {
    const store = getBridge();
    if (!store) return [];
    const folders = await store.listFolders();
    return folders.map(storeFolderToFolder);
}

export async function getFolderChildren(parentId: string): Promise<Folder[]> {
    const store = getBridge();
    if (!store) return [];
    const allFolders = await store.listFolders();
    return allFolders
        .filter(f => f.parentId === parentId)
        .map(storeFolderToFolder);
}

function storeFolderToFolder(sf: StoreFolder): Folder {
    let attributes: Record<string, any> | undefined;
    if (sf.attributes) {
        try { attributes = typeof sf.attributes === 'string' ? JSON.parse(sf.attributes) : sf.attributes; } catch { /* ignore */ }
    }
    return {
        id: sf.id,
        worldId: sf.worldId,
        name: sf.name,
        parentId: sf.parentId || '',
        entityKind: sf.entityKind || '',
        entitySubtype: sf.entitySubtype || '',
        entityLabel: sf.entityLabel || '',
        color: sf.color || '',
        isTypedRoot: sf.isTypedRoot || false,
        isSubtypeRoot: sf.isSubtypeRoot || false,
        collapsed: sf.collapsed || false,
        ownerId: sf.ownerId || '',
        createdAt: sf.createdAt,
        updatedAt: sf.updatedAt,
        narrativeId: sf.narrativeId || '',
        isNarrativeRoot: sf.isNarrativeRoot || false,
        networkId: undefined,
        metadata: undefined,
        attributes,
        order: sf.folderOrder,
    };
}

// =============================================================================
// ENTITY OPERATIONS
// =============================================================================

export async function upsertEntity(entity: Entity): Promise<void> {
    const store = getBridge();
    if (!store) {
        console.warn('[Operations] Store not ready for entity upsert');
        return;
    }
    await store.upsertEntity(GoKittStoreService.fromDexieEntity(entity));
    warmDexieEntity(entity);
}

export async function deleteEntity(id: string): Promise<void> {
    const store = getBridge();
    if (!store) return;
    await store.deleteEntity(id);
    db.entities.delete(id).catch(() => { });
}

export async function getEntity(id: string): Promise<Entity | undefined> {
    const store = getBridge();
    if (!store) return undefined;
    const entity = await store.getEntity(id);
    return entity ? storeEntityToEntity(entity) : undefined;
}

export async function getAllEntities(): Promise<Entity[]> {
    const store = getBridge();
    if (!store) return [];
    const entities = await store.listEntities();
    return entities.map(storeEntityToEntity);
}

export async function getEntitiesByKind(kind: string): Promise<Entity[]> {
    const store = getBridge();
    if (!store) return [];
    const entities = await store.listEntities();
    return entities.filter(e => e.kind === kind).map(storeEntityToEntity);
}

export async function getEntitiesByNarrative(narrativeId: string): Promise<Entity[]> {
    const store = getBridge();
    if (!store) return [];
    const entities = await store.listEntities();
    return entities.filter(e => e.narrativeId === narrativeId).map(storeEntityToEntity);
}

function storeEntityToEntity(se: StoreEntity): Entity {
    return {
        id: se.id,
        label: se.label,
        kind: se.kind,
        subtype: se.subtype,
        aliases: se.aliases || [],
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

function calculateNewOrder(prevOrder: number, nextOrder: number): number {
    if (prevOrder === 0 && nextOrder === 0) return DEFAULT_ORDER_STEP;
    if (nextOrder === 0) return prevOrder + DEFAULT_ORDER_STEP;
    return (prevOrder + nextOrder) / 2;
}

function needsRebalancing(orders: number[]): boolean {
    for (let i = 1; i < orders.length; i++) {
        if (orders[i] - orders[i - 1] < MIN_ORDER_GAP) return true;
    }
    return false;
}

async function rebalanceNoteOrders(folderId: string): Promise<void> {
    const store = getBridge();
    if (!store) return;
    const notes = await getNotesByFolder(folderId);
    notes.sort((a, b) => a.order - b.order);
    for (let i = 0; i < notes.length; i++) {
        const updated = { ...notes[i], order: (i + 1) * DEFAULT_ORDER_STEP };
        await store.upsertNote(GoKittStoreService.fromDexieNote(updated));
    }
    console.log(`[Operations] Rebalanced ${notes.length} note orders in folder ${folderId || 'root'}`);
}

async function rebalanceFolderOrders(parentId: string): Promise<void> {
    const store = getBridge();
    if (!store) return;
    const folders = await getFolderChildren(parentId);
    folders.sort((a, b) => a.order - b.order);
    for (let i = 0; i < folders.length; i++) {
        const updated = { ...folders[i], order: (i + 1) * DEFAULT_ORDER_STEP };
        await store.upsertFolder(GoKittStoreService.fromDexieFolder(updated));
    }
    console.log(`[Operations] Rebalanced ${folders.length} folder orders in parent ${parentId || 'root'}`);
}

export async function reorderNote(noteId: string, targetIndex: number): Promise<void> {
    const store = requireStore();
    const note = await store.getNote(noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);

    const siblings = await getNotesByFolder(note.folderId);
    siblings.sort((a, b) => a.order - b.order);
    const filteredSiblings = siblings.filter(n => n.id !== noteId);

    const prevOrder = filteredSiblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = filteredSiblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    await store.upsertNote({ ...note, order: newOrder, updatedAt: Date.now() } as StoreNote);

    const allOrders = [...filteredSiblings.map(n => n.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceNoteOrders(note.folderId);
    }
    console.log(`[Operations] Reordered note ${noteId} to position ${targetIndex}`);
}

export async function reorderFolder(folderId: string, targetIndex: number): Promise<void> {
    const folder = await getFolder(folderId);
    if (!folder) throw new Error(`Folder ${folderId} not found`);

    const store = requireStore();
    const siblings = await getFolderChildren(folder.parentId);
    siblings.sort((a, b) => a.order - b.order);
    const filteredSiblings = siblings.filter(f => f.id !== folderId);

    const prevOrder = filteredSiblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = filteredSiblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    await store.upsertFolder(GoKittStoreService.fromDexieFolder({ ...folder, order: newOrder, updatedAt: Date.now() }));

    const allOrders = [...filteredSiblings.map(f => f.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceFolderOrders(folder.parentId);
    }
    console.log(`[Operations] Reordered folder ${folderId} to position ${targetIndex}`);
}

export async function moveNoteToFolder(noteId: string, targetFolderId: string, targetIndex: number): Promise<void> {
    const store = requireStore();
    const note = await store.getNote(noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);

    const siblings = await getNotesByFolder(targetFolderId);
    siblings.sort((a, b) => a.order - b.order);

    const prevOrder = siblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = siblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    await store.upsertNote({
        ...note,
        folderId: targetFolderId,
        order: newOrder,
        updatedAt: Date.now()
    } as StoreNote);

    const allOrders = [...siblings.map(n => n.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceNoteOrders(targetFolderId);
    }
    console.log(`[Operations] Moved note ${noteId} to folder ${targetFolderId}`);
}

export async function moveFolderToParent(folderId: string, targetParentId: string, targetIndex: number): Promise<void> {
    const folder = await getFolder(folderId);
    if (!folder) throw new Error(`Folder ${folderId} not found`);

    const store = requireStore();
    const siblings = await getFolderChildren(targetParentId);
    siblings.sort((a, b) => a.order - b.order);

    const prevOrder = siblings[targetIndex - 1]?.order ?? 0;
    const nextOrder = siblings[targetIndex]?.order ?? 0;
    const newOrder = calculateNewOrder(prevOrder, nextOrder);

    await store.upsertFolder(GoKittStoreService.fromDexieFolder({
        ...folder,
        parentId: targetParentId,
        order: newOrder,
        updatedAt: Date.now()
    }));

    const allOrders = [...siblings.map(f => f.order), newOrder].sort((a, b) => a - b);
    if (needsRebalancing(allOrders)) {
        await rebalanceFolderOrders(targetParentId);
    }
    console.log(`[Operations] Moved folder ${folderId} to parent ${targetParentId}`);
}

export async function swapItems(sourceId: string, targetId: string, type: 'folder' | 'note'): Promise<void> {
    const store = requireStore();

    if (type === 'folder') {
        const source = await getFolder(sourceId);
        const target = await getFolder(targetId);
        if (!source || !target) throw new Error('Folder not found');

        await store.upsertFolder(GoKittStoreService.fromDexieFolder({ ...source, order: target.order, updatedAt: Date.now() }));
        await store.upsertFolder(GoKittStoreService.fromDexieFolder({ ...target, order: source.order, updatedAt: Date.now() }));
    } else {
        const source = await store.getNote(sourceId);
        const target = await store.getNote(targetId);
        if (!source || !target) throw new Error('Note not found');

        await store.upsertNote({ ...source, order: target.order, updatedAt: Date.now() } as StoreNote);
        await store.upsertNote({ ...target, order: source.order, updatedAt: Date.now() } as StoreNote);
    }

    console.log(`[Operations] Swapped ${type}s: ${sourceId} <-> ${targetId}`);
}
