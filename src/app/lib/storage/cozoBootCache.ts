/**
 * Cozo Boot Cache
 * 
 * Stores lightweight entity metadata in localStorage for instant UI rendering.
 * Boot cache pattern for fast UI hydration from localStorage.
 */

const CACHE_KEY = 'cozo-boot-cache';
const CACHE_VERSION = 2; // Bumped for narrativeId

export interface CozoBootCacheEntity {
    id: string;
    label: string;
    kind: string;
    subtype?: string;
    aliases?: string[];
    narrativeId?: string;
}

export interface CozoBootCache {
    version: number;
    entities: CozoBootCacheEntity[];
    totalRelationships: number;
    lastUpdatedAt: number;
}

/**
 * Load the Cozo boot cache from localStorage
 */
export function loadCozoBootCache(): CozoBootCache | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as CozoBootCache;
        if (parsed.version !== CACHE_VERSION) {
            console.warn('[CozoBootCache] Version mismatch, clearing cache');
            localStorage.removeItem(CACHE_KEY);
            return null;
        }

        console.log(`[CozoBootCache] Loaded ${parsed.entities.length} entities from cache`);
        return parsed;
    } catch (e) {
        console.warn('[CozoBootCache] Failed to load:', e);
        return null;
    }
}

/**
 * Save the Cozo boot cache to localStorage
 */
export function saveCozoBootCache(cache: CozoBootCache): void {
    try {
        cache.version = CACHE_VERSION;
        cache.lastUpdatedAt = Date.now();
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('[CozoBootCache] Failed to save:', e);
    }
}

/**
 * Build the boot cache from SmartGraphRegistry entities
 */
export function buildCozoBootCache(
    entities: { id: string; label: string; kind: string; subtype?: string; aliases?: string[]; narrativeId?: string }[],
    totalRelationships: number
): CozoBootCache {
    return {
        version: CACHE_VERSION,
        entities: entities.map(e => ({
            id: e.id,
            label: e.label,
            kind: e.kind,
            subtype: e.subtype,
            aliases: e.aliases,
            narrativeId: e.narrativeId
        })),
        totalRelationships,
        lastUpdatedAt: Date.now(),
    };
}

/**
 * Clear the boot cache
 */
export function clearCozoBootCache(): void {
    localStorage.removeItem(CACHE_KEY);
}
