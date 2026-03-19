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

vi.mock('../services/gokitt-store.service', () => ({
    GoKittStoreService: class {
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
