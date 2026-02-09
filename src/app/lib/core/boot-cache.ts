// src/app/lib/core/boot-cache.ts
// Pre-Angular Boot Cache
// Hydrates critical data from IndexedDB BEFORE Angular bootstraps
// This ensures registry data is available synchronously when components mount

import { db } from '../dexie';
import type { Entity, Edge, Note } from '../dexie';

export interface BootData {
    entities: Entity[];
    edges: Edge[];
    notes: Note[];
    loadedAt: number;
    duration: number;
}

// Module-level cache - populated before Angular boots
let _bootData: BootData | null = null;
let _bootPromise: Promise<BootData> | null = null;

/**
 * Pre-fetch critical data from IndexedDB
 * Call this in main.ts BEFORE bootstrapApplication()
 */
export async function preloadBootCache(): Promise<BootData> {
    if (_bootData) return _bootData;
    if (_bootPromise) return _bootPromise;

    _bootPromise = _loadBootData();
    return _bootPromise;
}

async function _loadBootData(): Promise<BootData> {
    const start = performance.now();
    console.log('[BootCache] Starting pre-Angular data load...');

    try {
        // Open Dexie and load in parallel
        const [entities, edges, notes] = await Promise.all([
            db.entities.toArray(),
            db.edges.toArray(),
            db.notes.toArray()
        ]);

        const duration = Math.round(performance.now() - start);

        _bootData = {
            entities,
            edges,
            notes,
            loadedAt: Date.now(),
            duration
        };

        console.log(`[BootCache] ✓ Loaded ${entities.length} entities, ${edges.length} edges, ${notes.length} notes in ${duration}ms`);
        return _bootData;

    } catch (err) {
        console.error('[BootCache] Failed to load boot data:', err);
        // Return empty but don't block boot
        _bootData = {
            entities: [],
            edges: [],
            notes: [],
            loadedAt: Date.now(),
            duration: 0
        };
        return _bootData;
    }
}

/**
 * Get cached boot data synchronously
 * Returns null if preloadBootCache() hasn't completed
 */
export function getBootCache(): BootData | null {
    return _bootData;
}

/**
 * Check if boot cache is ready
 */
export function isBootCacheReady(): boolean {
    return _bootData !== null;
}

/**
 * Wait for boot cache to be ready
 */
export async function waitForBootCache(): Promise<BootData> {
    if (_bootData) return _bootData;
    if (_bootPromise) return _bootPromise;
    return preloadBootCache();
}
