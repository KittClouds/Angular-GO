// src/app/lib/dexie/settings.service.ts
// Unified settings store backed by Dexie (replaces all localStorage usage)
// Pattern: Boot-loaded in-memory Map + write-through to IndexedDB
// NO localStorage. All reads are synchronous from memory.

import { db } from './db';
import type { Setting } from './db';

// Module-level cache — populated once at boot, sync reads forever after
const _cache = new Map<string, any>();
let _initialized = false;

/**
 * Load ALL settings from Dexie into memory.
 * Called once during boot (in boot-cache.ts), before Angular bootstraps.
 */
export async function loadSettings(): Promise<Map<string, any>> {
    if (_initialized) return _cache;

    try {
        const settings = await db.settings.toArray();
        for (const s of settings) {
            _cache.set(s.key, s.value);
        }
        _initialized = true;
        console.log(`[Settings] ✓ Loaded ${settings.length} settings from Dexie`);
    } catch (err) {
        console.error('[Settings] Failed to load settings:', err);
        _initialized = true; // Don't retry, just use defaults
    }

    return _cache;
}

/**
 * Load settings from a pre-fetched array (used by boot-cache).
 * Avoids a second Dexie read.
 */
export function hydrateFromBootData(settings: Setting[]): void {
    if (_initialized) return;
    for (const s of settings) {
        _cache.set(s.key, s.value);
    }
    _initialized = true;
    console.log(`[Settings] ✓ Hydrated ${settings.length} settings from boot cache`);
}

/**
 * Get a setting value synchronously from memory.
 * Returns `defaultValue` if not found.
 */
export function getSetting<T>(key: string, defaultValue: T): T {
    if (_cache.has(key)) {
        return _cache.get(key) as T;
    }
    return defaultValue;
}

/**
 * Set a setting value. Updates memory immediately, writes to Dexie async.
 */
export function setSetting<T>(key: string, value: T): void {
    console.log(`[Settings] setSetting: "${key}" =`, value);
    _cache.set(key, value);
    // Fire-and-forget write to Dexie
    db.settings.put({ key, value }).catch(err => {
        console.warn(`[Settings] Failed to persist setting '${key}':`, err);
    });
}

/**
 * Remove a setting. Updates memory immediately, deletes from Dexie async.
 */
export function removeSetting(key: string): void {
    _cache.delete(key);
    db.settings.delete(key).catch(err => {
        console.warn(`[Settings] Failed to delete setting '${key}':`, err);
    });
}

/**
 * Check if a setting exists.
 */
export function hasSetting(key: string): boolean {
    return _cache.has(key);
}

/**
 * Debug: Get all settings (for console inspection)
 */
export function getAllSettings(): Record<string, any> {
    return Object.fromEntries(_cache);
}

// Expose for debugging
if (typeof window !== 'undefined') {
    (window as any).dexieSettings = { getAll: getAllSettings };
}
