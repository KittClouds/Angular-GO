// src/app/lib/dexie/decorations.ts
// Decoration utilities for Dexie (IndexedDB) storage
// Matches React reference exactly

import { db } from './db';
import type { DecorationSpan } from '../Scanner/types';

/**
 * djb2 hash - fast, good distribution for strings
 */
export function hashContent(content: string): string {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
        hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

// In-memory decoration cache for speed
const decorationCache = new Map<string, { spans: DecorationSpan[], contentHash: string, updatedAt: number }>();

/**
 * Save decoration spans for a note (replaces old spans)
 * Called by workers after scan completes
 */
export async function saveNoteDecorations(
    noteId: string,
    spans: DecorationSpan[],
    contentHash?: string
): Promise<void> {
    const now = Date.now();

    // Update in-memory cache for speed
    decorationCache.set(noteId, {
        spans,
        contentHash: contentHash ?? '',
        updatedAt: now,
    });

    // Validations
    if (!noteId) return;

    try {
        // Persist to Dexie
        await db.transaction('rw', [db.decorationSpans, db.decorationMeta], async () => {
            await db.decorationSpans.put({
                noteId,
                spans,
                contentHash: contentHash ?? '',
                updatedAt: now
            });

            await db.decorationMeta.put({
                noteId,
                version: 1,
                lastScan: now,
            });
        });
        // console.log(`[Dexie] Persisted ${spans.length} decorations for note ${noteId}`);
    } catch (err) {
        console.warn(`[Dexie] Failed to persist decorations for ${noteId}:`, err);
    }
}

/**
 * Get the content hash for a note's cached decorations
 */
export async function getDecorationContentHash(noteId: string): Promise<string | null> {
    // Check memory first
    const cached = decorationCache.get(noteId);
    if (cached) return cached.contentHash;

    // Check DB
    const record = await db.decorationSpans.get(noteId);
    return record?.contentHash ?? null;
}

/**
 * Get decorations for a note
 */
export async function getNoteDecorations(noteId: string): Promise<DecorationSpan[]> {
    // Check memory first
    const cached = decorationCache.get(noteId);
    if (cached) return cached.spans;

    // Check DB
    try {
        const record = await db.decorationSpans.get(noteId);
        if (record) {
            // Hydrate memory cache
            decorationCache.set(noteId, {
                spans: record.spans,
                contentHash: record.contentHash,
                updatedAt: record.updatedAt
            });
            return record.spans;
        }
    } catch (err) {
        console.warn(`[Dexie] Failed to load decorations for ${noteId}:`, err);
    }
    return [];
}

/**
 * Clear all decorations for a note
 */
export async function clearNoteDecorations(noteId: string): Promise<void> {
    decorationCache.delete(noteId);
    await db.decorationSpans.delete(noteId);
    await db.decorationMeta.delete(noteId);
}

/**
 * Clear all decorations (e.g., on major entity changes)
 */
export async function clearAllDecorations(): Promise<void> {
    decorationCache.clear();
    await db.decorationSpans.clear();
    await db.decorationMeta.clear();
}
