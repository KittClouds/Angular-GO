import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GraphHotCache } from './GraphHotCache';
import type { CozoEntity } from './GraphRegistry';

// Mock localStorage
const mockStore: Record<string, string> = {};
const localStorageMock = {
    getItem: vi.fn((key: string) => mockStore[key] || null),
    setItem: vi.fn((key: string, value: string) => { mockStore[key] = value; }),
    removeItem: vi.fn((key: string) => { delete mockStore[key]; }),
    clear: vi.fn(() => { for (const key in mockStore) delete mockStore[key]; }),
    length: 0,
    key: vi.fn(),
};

function createMockEntity(id: string, label: string, kind: string = 'CHARACTER', aliases: string[] = []): CozoEntity {
    return {
        id,
        label,
        normalized: label.toLowerCase(),
        kind: kind as any,
        firstNote: 'note-1',
        createdAt: new Date(),
        createdBy: 'user',
        aliases,
    };
}

describe('GraphHotCache', () => {
    let cache: GraphHotCache;

    beforeEach(() => {
        for (const key in mockStore) delete mockStore[key];
        vi.stubGlobal('localStorage', localStorageMock);
        cache = new GraphHotCache({ bootCacheEnabled: false }); // Disable for unit tests
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('Entity Operations', () => {
        it('should store and retrieve entity by ID', () => {
            const entity = createMockEntity('ent-1', 'Alice');
            cache.setEntity(entity);

            const retrieved = cache.getEntity('ent-1');
            expect(retrieved).toBeDefined();
            expect(retrieved?.label).toBe('Alice');
        });

        it('should find entity by label (case-insensitive)', () => {
            const entity = createMockEntity('ent-1', 'Alice Darkwood');
            cache.setEntity(entity);

            expect(cache.findEntityByLabel('Alice Darkwood')).toBeDefined();
            expect(cache.findEntityByLabel('alice darkwood')).toBeDefined();
            expect(cache.findEntityByLabel('ALICE DARKWOOD')).toBeDefined();
            expect(cache.findEntityByLabel('  Alice Darkwood  ')).toBeDefined(); // Trimmed
        });

        it('should find entity by alias', () => {
            const entity = createMockEntity('ent-1', 'Alice Darkwood', 'CHARACTER', ['The Shadow', 'Lady A']);
            cache.setEntity(entity);

            expect(cache.findEntityByLabel('The Shadow')).toBeDefined();
            expect(cache.findEntityByLabel('the shadow')).toBeDefined();
            expect(cache.findEntityByLabel('Lady A')).toBeDefined();
        });

        it('should return null for unknown entity', () => {
            expect(cache.getEntity('nonexistent')).toBeNull();
            expect(cache.findEntityByLabel('Unknown Entity')).toBeNull();
        });

        it('should hasEntity return correct boolean', () => {
            const entity = createMockEntity('ent-1', 'Alice', 'CHARACTER', ['Shadow']);
            cache.setEntity(entity);

            expect(cache.hasEntity('Alice')).toBe(true);
            expect(cache.hasEntity('Shadow')).toBe(true);
            expect(cache.hasEntity('Unknown')).toBe(false);
        });

        it('should update entity and reindex', () => {
            const entity1 = createMockEntity('ent-1', 'Alice');
            cache.setEntity(entity1);

            // Update with new label
            const entity2 = createMockEntity('ent-1', 'Alicia'); // Same ID, different label
            cache.setEntity(entity2);

            expect(cache.findEntityByLabel('Alicia')).toBeDefined();
            expect(cache.findEntityByLabel('Alice')).toBeNull(); // Old label gone
        });

        it('should remove entity and all indices', () => {
            const entity = createMockEntity('ent-1', 'Alice', 'CHARACTER', ['Shadow']);
            cache.setEntity(entity);

            cache.removeEntity('ent-1');

            expect(cache.getEntity('ent-1')).toBeNull();
            expect(cache.findEntityByLabel('Alice')).toBeNull();
            expect(cache.findEntityByLabel('Shadow')).toBeNull();
        });

        it('should filter entities by kind', () => {
            cache.setEntity(createMockEntity('ent-1', 'Alice', 'CHARACTER'));
            cache.setEntity(createMockEntity('ent-2', 'Bob', 'CHARACTER'));
            cache.setEntity(createMockEntity('ent-3', 'The Tavern', 'LOCATION'));

            const characters = cache.getEntitiesByKind('CHARACTER');
            expect(characters).toHaveLength(2);

            const locations = cache.getEntitiesByKind('LOCATION');
            expect(locations).toHaveLength(1);
        });
    });

    describe('LRU Eviction', () => {
        it('should evict oldest entities when max size exceeded', () => {
            const smallCache = new GraphHotCache({ maxEntities: 3, bootCacheEnabled: false });

            smallCache.setEntity(createMockEntity('ent-1', 'First'));
            smallCache.setEntity(createMockEntity('ent-2', 'Second'));
            smallCache.setEntity(createMockEntity('ent-3', 'Third'));

            // Access first to update lastAccessed
            smallCache.getEntity('ent-1');

            // Add fourth, should evict Second (oldest non-accessed)
            smallCache.setEntity(createMockEntity('ent-4', 'Fourth'));

            expect(smallCache.size).toBe(3);
            expect(smallCache.getEntity('ent-1')).toBeDefined(); // Still there, was accessed
            expect(smallCache.getEntity('ent-4')).toBeDefined(); // Newest
            // Either ent-2 or ent-3 evicted (depends on timing)
        });
    });

    describe('Cache Lifecycle', () => {
        it('should report stats correctly', () => {
            cache.setEntity(createMockEntity('ent-1', 'Alice'));
            cache.setEntity(createMockEntity('ent-2', 'Bob'));

            const stats = cache.getStats();
            expect(stats.entities).toBe(2);
            expect(stats.warmed).toBe(false);
        });

        it('should invalidate all and reset state', () => {
            cache.setEntity(createMockEntity('ent-1', 'Alice'));
            cache.setEntity(createMockEntity('ent-2', 'Bob'));

            cache.invalidateAll();

            expect(cache.size).toBe(0);
            expect(cache.isWarmed).toBe(false);
        });
    });

    describe('Boot Cache Integration', () => {
        it('should warm from boot cache when enabled', () => {
            const bootCache = new GraphHotCache({ bootCacheEnabled: true });

            // Seed boot cache
            mockStore['cozo-boot-cache'] = JSON.stringify({
                version: 1,
                entities: [
                    { id: 'ent-1', label: 'Alice', kind: 'CHARACTER' },
                    { id: 'ent-2', label: 'Bob', kind: 'CHARACTER' },
                ],
                totalRelationships: 0,
                lastUpdatedAt: Date.now()
            });

            const loaded = bootCache.warmFromBootCache();
            expect(loaded).toBe(2);
            expect(bootCache.isWarmed).toBe(true);
            expect(bootCache.findEntityByLabel('Alice')).toBeDefined();
        });

        it('should sync to boot cache on entity changes', () => {
            const bootCache = new GraphHotCache({ bootCacheEnabled: true });
            bootCache.setEntity(createMockEntity('ent-1', 'Alice'));

            bootCache.syncToBootCache();

            expect(mockStore['cozo-boot-cache']).toBeDefined();
            const saved = JSON.parse(mockStore['cozo-boot-cache']);
            expect(saved.entities).toHaveLength(1);
            expect(saved.entities[0].label).toBe('Alice');
        });
    });
});
