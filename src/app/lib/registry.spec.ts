import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb, bridgeState, clearAllDecorationsMock } = vi.hoisted(() => {
    const mockDb = {
        entities: {
            put: vi.fn(),
            delete: vi.fn(),
            clear: vi.fn(),
        },
        edges: {
            put: vi.fn(),
            bulkDelete: vi.fn(),
            clear: vi.fn(),
        },
        entityMetadata: {
            clear: vi.fn(),
        },
    };

    const bridgeState = {
        current: null as any,
    };

    const clearAllDecorationsMock = vi.fn();

    return { mockDb, bridgeState, clearAllDecorationsMock };
});

vi.mock('./dexie', () => ({
    db: mockDb,
}));

vi.mock('./operations', () => ({
    getBridge: () => bridgeState.current,
}));

vi.mock('./dexie/decorations', () => ({
    clearAllDecorations: clearAllDecorationsMock,
}));

vi.mock('../services/phoenix-store.service', () => ({
    PhoenixStoreService: class {
        static fromDexieEntity(entity: any) {
            return entity;
        }

        static fromDexieEdge(edge: any) {
            return edge;
        }
    }
}));

import { CentralRegistry } from './registry';

function makeEntity(id: string, label: string) {
    const now = new Date('2026-03-18T12:00:00.000Z');
    return {
        id,
        label,
        kind: 'CHARACTER' as any,
        aliases: [],
        firstNote: 'note-1',
        mentionsByNote: new Map([['note-1', 1]]),
        totalMentions: 1,
        lastSeenDate: now,
        createdAt: now,
        createdBy: 'user' as const,
        registeredAt: now.getTime(),
    };
}

function seedRegistry(registry: CentralRegistry) {
    const entityA = makeEntity('entity-a', 'Alpha');
    const entityB = makeEntity('entity-b', 'Beta');
    const edge = {
        id: 'edge-a-b',
        sourceId: entityA.id,
        targetId: entityB.id,
        type: 'KNOWS',
        confidence: 1,
    };

    const state = registry as any;
    state.entityCache.set(entityA.id, entityA);
    state.entityCache.set(entityB.id, entityB);
    state.labelIndex.set(entityA.label.toLowerCase(), entityA.id);
    state.labelIndex.set(entityB.label.toLowerCase(), entityB.id);
    state.edgeCache.set(edge.id, edge);
    state.snapshot = [entityA, entityB];
    state.isRebuildingDictionary = true;

    return { entityA, entityB, edge };
}

describe('CentralRegistry persistence deletes', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();

        bridgeState.current = null;

        mockDb.entities.put.mockResolvedValue(undefined);
        mockDb.entities.delete.mockResolvedValue(undefined);
        mockDb.entities.clear.mockResolvedValue(undefined);
        mockDb.edges.put.mockResolvedValue(undefined);
        mockDb.edges.bulkDelete.mockResolvedValue(undefined);
        mockDb.edges.clear.mockResolvedValue(undefined);
        mockDb.entityMetadata.clear.mockResolvedValue(undefined);
        clearAllDecorationsMock.mockResolvedValue(undefined);
    });

    it('deletes an entity and its connected edges from cache, Dexie, and SQLite', async () => {
        const registry = new CentralRegistry();
        const { entityA, entityB, edge } = seedRegistry(registry);
        const store = {
            deleteEntity: vi.fn().mockResolvedValue(undefined),
            deleteEdge: vi.fn().mockResolvedValue(undefined),
        };

        bridgeState.current = store;

        await expect(registry.deleteEntity(entityA.id)).resolves.toBe(true);

        expect(registry.getEntityById(entityA.id)).toBeNull();
        expect(registry.getEntityById(entityB.id)?.label).toBe('Beta');
        expect(registry.getAllEntities().map(entity => entity.id)).toEqual([entityB.id]);
        expect(registry.getEdgesForEntity(entityA.id)).toEqual([]);
        expect(registry.getEdgesForEntity(entityB.id)).toEqual([]);

        expect(mockDb.entities.delete).toHaveBeenCalledWith(entityA.id);
        expect(mockDb.edges.bulkDelete).toHaveBeenCalledWith([edge.id]);
        expect(store.deleteEdge).toHaveBeenCalledWith(edge.id);
        expect(store.deleteEntity).toHaveBeenCalledWith(entityA.id);
        expect(clearAllDecorationsMock).toHaveBeenCalledOnce();
    });

    it('does not let extraction demote a user-curated entity kind', () => {
        const registry = new CentralRegistry();
        const state = registry as any;
        state.isRebuildingDictionary = true;
        bridgeState.current = {
            upsertEntity: vi.fn().mockResolvedValue(undefined),
        };

        const original = registry.registerEntity('Aella', 'CHARACTER' as any, 'note-1', { source: 'user' });
        const refreshed = registry.registerEntity('Aella', 'OTHER' as any, 'note-1', { source: 'extraction' });

        expect(original.entity.kind).toBe('CHARACTER');
        expect(refreshed.entity.kind).toBe('CHARACTER');
        expect(registry.findEntityByLabel('Aella')?.kind).toBe('CHARACTER');
        expect(mockDb.entities.put).toHaveBeenLastCalledWith(expect.objectContaining({
            label: 'Aella',
            kind: 'CHARACTER',
        }));
    });

    it('promotes weak auto-created kinds when extraction provides a stronger kind', () => {
        const registry = new CentralRegistry();
        const state = registry as any;
        state.isRebuildingDictionary = true;
        bridgeState.current = {
            upsertEntity: vi.fn().mockResolvedValue(undefined),
        };

        const original = registry.registerEntity('Kai', 'OTHER' as any, 'note-1', { source: 'auto' });
        const refreshed = registry.registerEntity('Kai', 'CHARACTER' as any, 'note-1', { source: 'extraction' });

        expect(original.entity.kind).toBe('OTHER');
        expect(refreshed.entity.kind).toBe('CHARACTER');
        expect(registry.findEntityByLabel('Kai')?.kind).toBe('CHARACTER');
    });

    it('emits live projection payloads when entities change', () => {
        const registry = new CentralRegistry();
        const state = registry as any;
        state.isRebuildingDictionary = true;
        bridgeState.current = {
            upsertEntity: vi.fn().mockResolvedValue(undefined),
        };
        const listener = vi.fn();
        const windowTarget = new EventTarget();
        vi.stubGlobal('window', windowTarget);
        windowTarget.addEventListener('entities-changed', listener);

        try {
            registry.registerEntity('Siofra', 'CHARACTER' as any, 'note-10', {
                source: 'user',
                attributes: { narrativeId: 'narrative-1' },
            });
        } finally {
            windowTarget.removeEventListener('entities-changed', listener);
        }

        const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
        const event = lastCall?.[0] as CustomEvent;
        expect(event.detail.entities).toEqual([
            expect.objectContaining({ label: 'Siofra', firstNote: 'note-10' }),
        ]);
        expect(event.detail.edges).toEqual([]);
        expect(mockDb.entities.put).toHaveBeenCalledWith(expect.objectContaining({
            label: 'Siofra',
            firstNote: 'note-10',
            narrativeId: 'narrative-1',
        }));
    });

    it('durably persists manual entity kind changes to Dexie and Phoenix', async () => {
        const registry = new CentralRegistry();
        const { entityA } = seedRegistry(registry);
        const store = {
            upsertEntity: vi.fn().mockResolvedValue(undefined),
        };

        bridgeState.current = store;

        await expect(registry.updateEntityDurable(entityA.id, {
            kind: 'LOCATION' as any,
        })).resolves.toEqual(expect.objectContaining({
            id: entityA.id,
            kind: 'LOCATION',
            createdBy: 'user',
        }));

        expect(mockDb.entities.put).toHaveBeenCalledWith(expect.objectContaining({
            id: entityA.id,
            label: entityA.label,
            kind: 'LOCATION',
            createdBy: 'user',
        }));
        expect(store.upsertEntity).toHaveBeenCalledWith(expect.objectContaining({
            id: entityA.id,
            kind: 'LOCATION',
            createdBy: 'user',
        }));
        expect(registry.getEntityById(entityA.id)?.kind).toBe('LOCATION');
    });

    it('clearAll removes all entities and edges from cache, Dexie, and SQLite', async () => {
        const registry = new CentralRegistry();
        const { entityA, entityB, edge } = seedRegistry(registry);
        const store = {
            deleteEntity: vi.fn().mockResolvedValue(undefined),
            deleteEdge: vi.fn().mockResolvedValue(undefined),
        };

        bridgeState.current = store;

        await expect(registry.clearAll()).resolves.toBe(2);

        expect(registry.getAllEntities()).toEqual([]);
        expect(registry.getEdgesForEntity(entityA.id)).toEqual([]);
        expect(registry.getEdgesForEntity(entityB.id)).toEqual([]);

        expect(mockDb.entities.clear).toHaveBeenCalledOnce();
        expect(mockDb.edges.clear).toHaveBeenCalledOnce();
        expect(mockDb.entityMetadata.clear).toHaveBeenCalledOnce();
        expect(store.deleteEdge).toHaveBeenCalledWith(edge.id);
        expect(store.deleteEntity).toHaveBeenCalledTimes(2);
        expect(store.deleteEntity).toHaveBeenCalledWith(entityA.id);
        expect(store.deleteEntity).toHaveBeenCalledWith(entityB.id);
        expect(clearAllDecorationsMock).toHaveBeenCalledOnce();
    });

    it('still deletes locally when the SQLite bridge is unavailable', async () => {
        const registry = new CentralRegistry();
        const { entityA, entityB, edge } = seedRegistry(registry);

        await expect(registry.deleteEntity(entityA.id)).resolves.toBe(true);

        expect(registry.getAllEntities().map(entity => entity.id)).toEqual([entityB.id]);
        expect(registry.getEdgesForEntity(entityB.id)).toEqual([]);
        expect(mockDb.entities.delete).toHaveBeenCalledWith(entityA.id);
        expect(mockDb.edges.bulkDelete).toHaveBeenCalledWith([edge.id]);
        expect(clearAllDecorationsMock).toHaveBeenCalledOnce();
    });
});
