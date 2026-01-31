// src/app/lib/services/codex.service.ts
// Unified Codex Service for managing Facts, Beats, and Events

import { Injectable } from '@angular/core';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from, Observable } from 'rxjs';
import { db, CodexEntry } from '../dexie/db';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// CATEGORY DEFINITIONS
// =============================================================================

export interface CategoryDef {
    id: string;
    label: string;
    icon: string;
    color: string;
    description?: string;
}

export const WORLDBUILDING_CATEGORIES: CategoryDef[] = [
    { id: 'overview', label: 'World Overview', icon: 'pi pi-globe', color: '#06b6d4', description: 'Essential characteristics and foundation of your world.' },
    { id: 'geography', label: 'Geography and Ecosystems', icon: 'pi pi-image', color: '#10b981', description: 'Physical layout, natural resources, and environments.' },
    { id: 'cultures', label: 'Cultures and Societies', icon: 'pi pi-users', color: '#f59e0b', description: 'Social, political, and cultural makeup.' },
    { id: 'magic', label: 'Magic and Technology', icon: 'pi pi-bolt', color: '#8b5cf6', description: 'Systems of power and their costs.' },
    { id: 'religion', label: 'Religion and Mythology', icon: 'pi pi-star', color: '#ec4899', description: 'Gods, myths, and faith.' },
    { id: 'politics', label: 'Politics and Power', icon: 'pi pi-briefcase', color: '#ef4444', description: 'Governments, rulers, and conflicts.' },
    { id: 'art', label: 'Art and Entertainment', icon: 'pi pi-book', color: '#3b82f6', description: 'Creative expression in your world.' },
];

export interface BeatTypeDef {
    id: string;
    label: string;
    actId: string;
    color: string;
    order: number;
}

export const BEAT_TYPES: BeatTypeDef[] = [
    // Act 1
    { id: 'opening-image', label: 'Opening Image', actId: 'act1', color: '#3b82f6', order: 1 },
    { id: 'theme-stated', label: 'Theme Stated', actId: 'act1', color: '#8b5cf6', order: 2 },
    { id: 'setup', label: 'Set-Up', actId: 'act1', color: '#10b981', order: 3 },
    { id: 'catalyst', label: 'Catalyst', actId: 'act1', color: '#f59e0b', order: 4 },
    { id: 'debate', label: 'Debate', actId: 'act1', color: '#ec4899', order: 5 },
    { id: 'break-into-2', label: 'Break Into Act 2', actId: 'act1', color: '#ef4444', order: 6 },
    // Act 2
    { id: 'b-story', label: 'B-Story', actId: 'act2', color: '#f59e0b', order: 7 },
    { id: 'fun-and-games', label: 'Fun and Games', actId: 'act2', color: '#ec4899', order: 8 },
    { id: 'midpoint', label: 'Midpoint', actId: 'act2', color: '#8b5cf6', order: 9 },
    { id: 'bad-guys-close-in', label: 'Bad Guys Close In', actId: 'act2', color: '#ef4444', order: 10 },
    { id: 'all-is-lost', label: 'All Is Lost', actId: 'act2', color: '#64748b', order: 11 },
    { id: 'dark-night', label: 'Dark Night of the Soul', actId: 'act2', color: '#1e293b', order: 12 },
    // Act 3
    { id: 'break-into-3', label: 'Break Into Act 3', actId: 'act3', color: '#ef4444', order: 13 },
    { id: 'finale', label: 'Finale', actId: 'act3', color: '#dc2626', order: 14 },
    { id: 'final-image', label: 'Final Image', actId: 'act3', color: '#3b82f6', order: 15 },
];

export interface ActDef {
    id: string;
    name: string;
    color: string;
    order: number;
}

export const ACTS: ActDef[] = [
    { id: 'act1', name: 'Act 1', color: '#3b82f6', order: 1 },
    { id: 'act2', name: 'Act 2', color: '#f59e0b', order: 2 },
    { id: 'act3', name: 'Act 3', color: '#ef4444', order: 3 },
];

@Injectable({
    providedIn: 'root'
})
export class CodexService {

    // ─── Queries ────────────────────────────────────────────

    /**
     * Get all facts for a narrative, optionally filtered by category
     */
    getFacts$(narrativeId: string, category?: string): Observable<CodexEntry[]> {
        return from(
            liveQuery(() => {
                if (category) {
                    return db.codexEntries
                        .where('[narrativeId+entryType+category]')
                        .equals([narrativeId, 'fact', category])
                        .sortBy('order');
                }
                return db.codexEntries
                    .where('[narrativeId+entryType]')
                    .equals([narrativeId, 'fact'])
                    .sortBy('order');
            }) as DexieObservable<CodexEntry[]>
        );
    }

    /**
     * Get all beats for a narrative, optionally filtered by act
     */
    getBeats$(narrativeId: string, actId?: string): Observable<CodexEntry[]> {
        return from(
            liveQuery(() => {
                if (actId) {
                    return db.codexEntries
                        .where('[narrativeId+entryType+category]')
                        .equals([narrativeId, 'beat', actId])
                        .sortBy('order');
                }
                return db.codexEntries
                    .where('[narrativeId+entryType]')
                    .equals([narrativeId, 'beat'])
                    .sortBy('order');
            }) as DexieObservable<CodexEntry[]>
        );
    }

    /**
     * Get all events for a narrative
     */
    getEvents$(narrativeId: string): Observable<CodexEntry[]> {
        return from(
            liveQuery(() =>
                db.codexEntries
                    .where('[narrativeId+entryType]')
                    .equals([narrativeId, 'event'])
                    .sortBy('order')
            ) as DexieObservable<CodexEntry[]>
        );
    }

    /**
     * Get all entries (any type) linked to a specific entity
     */
    getEntriesForEntity$(entityId: string): Observable<CodexEntry[]> {
        return from(
            liveQuery(async () => {
                const all = await db.codexEntries.toArray();
                return all.filter(e => e.entityIds.includes(entityId));
            }) as DexieObservable<CodexEntry[]>
        );
    }

    /**
     * Get entries created from a specific span
     */
    async getEntriesFromSpan(spanId: string): Promise<CodexEntry[]> {
        return db.codexEntries.where('sourceSpanId').equals(spanId).toArray();
    }

    /**
     * Get a single entry by ID
     */
    async getEntryById(id: string): Promise<CodexEntry | undefined> {
        return db.codexEntries.get(id);
    }

    /**
     * Count entries by category for a narrative
     */
    async countByCategory(narrativeId: string, entryType: 'fact' | 'beat' | 'event'): Promise<Map<string, number>> {
        const entries = await db.codexEntries
            .where('[narrativeId+entryType]')
            .equals([narrativeId, entryType])
            .toArray();

        const counts = new Map<string, number>();
        for (const entry of entries) {
            const cat = entry.category || 'uncategorized';
            counts.set(cat, (counts.get(cat) || 0) + 1);
        }
        return counts;
    }

    // ─── Mutations ──────────────────────────────────────────

    /**
     * Create a new Codex entry
     */
    async createEntry(entry: Omit<CodexEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        const now = Date.now();
        const id = uuidv4();

        const fullEntry: CodexEntry = {
            ...entry,
            id,
            createdAt: now,
            updatedAt: now,
        };

        await db.codexEntries.add(fullEntry);
        console.log(`[CodexService] Created ${entry.entryType}:`, entry.title);
        return id;
    }

    /**
     * Update an existing entry
     */
    async updateEntry(id: string, updates: Partial<CodexEntry>): Promise<void> {
        await db.codexEntries.update(id, {
            ...updates,
            updatedAt: Date.now()
        });
    }

    /**
     * Delete an entry
     */
    async deleteEntry(id: string): Promise<void> {
        await db.codexEntries.delete(id);
    }

    // ─── Quick Actions ────────────────────────────────────

    /**
     * Create a fact from a text selection
     */
    async createFactFromSelection(
        narrativeId: string,
        spanId: string,
        noteId: string,
        category: string,
        title: string,
        description: string = ''
    ): Promise<string> {
        const maxOrder = await this.getMaxOrder(narrativeId, 'fact', category);
        return this.createEntry({
            narrativeId,
            entryType: 'fact',
            title,
            description,
            status: 'draft',
            category,
            order: maxOrder + 1,
            sourceSpanId: spanId,
            sourceNoteId: noteId,
            entityIds: [],
        });
    }

    /**
     * Create a beat from a text selection
     */
    async createBeatFromSelection(
        narrativeId: string,
        spanId: string,
        noteId: string,
        actId: string,
        beatType: string,
        title: string,
        description: string = ''
    ): Promise<string> {
        const maxOrder = await this.getMaxOrder(narrativeId, 'beat', actId);
        return this.createEntry({
            narrativeId,
            entryType: 'beat',
            title,
            description,
            status: 'planned',
            category: actId,
            subcategory: beatType,
            order: maxOrder + 1,
            sourceSpanId: spanId,
            sourceNoteId: noteId,
            entityIds: [],
        });
    }

    /**
     * Create a timeline event
     */
    async createEvent(
        narrativeId: string,
        title: string,
        description: string = '',
        entityIds: string[] = []
    ): Promise<string> {
        const maxOrder = await this.getMaxOrder(narrativeId, 'event');
        return this.createEntry({
            narrativeId,
            entryType: 'event',
            title,
            description,
            status: 'draft',
            order: maxOrder + 1,
            entityIds,
        });
    }

    // ─── Entity Linking ─────────────────────────────────────

    async linkEntity(entryId: string, entityId: string): Promise<void> {
        const entry = await db.codexEntries.get(entryId);
        if (!entry) return;

        if (!entry.entityIds.includes(entityId)) {
            await db.codexEntries.update(entryId, {
                entityIds: [...entry.entityIds, entityId],
                updatedAt: Date.now()
            });
        }
    }

    async unlinkEntity(entryId: string, entityId: string): Promise<void> {
        const entry = await db.codexEntries.get(entryId);
        if (!entry) return;

        await db.codexEntries.update(entryId, {
            entityIds: entry.entityIds.filter(id => id !== entityId),
            updatedAt: Date.now()
        });
    }

    // ─── Reordering ─────────────────────────────────────────

    async reorderEntries(entryIds: string[]): Promise<void> {
        await db.transaction('rw', db.codexEntries, async () => {
            for (let i = 0; i < entryIds.length; i++) {
                await db.codexEntries.update(entryIds[i], {
                    order: i + 1,
                    updatedAt: Date.now()
                });
            }
        });
    }

    async moveToCategory(entryId: string, newCategory: string): Promise<void> {
        await db.codexEntries.update(entryId, {
            category: newCategory,
            updatedAt: Date.now()
        });
    }

    async moveToAct(entryId: string, newActId: string): Promise<void> {
        await db.codexEntries.update(entryId, {
            category: newActId,
            updatedAt: Date.now()
        });
    }

    // ─── Helpers ────────────────────────────────────────────

    private async getMaxOrder(narrativeId: string, entryType: string, category?: string): Promise<number> {
        let entries: CodexEntry[];
        if (category) {
            entries = await db.codexEntries
                .where('[narrativeId+entryType+category]')
                .equals([narrativeId, entryType, category])
                .toArray();
        } else {
            entries = await db.codexEntries
                .where('[narrativeId+entryType]')
                .equals([narrativeId, entryType])
                .toArray();
        }
        return entries.reduce((max, e) => Math.max(max, e.order), 0);
    }

    // ─── Category Helpers ───────────────────────────────────

    getWorldbuildingCategories(): CategoryDef[] {
        return WORLDBUILDING_CATEGORIES;
    }

    getBeatTypes(): BeatTypeDef[] {
        return BEAT_TYPES;
    }

    getActs(): ActDef[] {
        return ACTS;
    }

    getBeatTypesForAct(actId: string): BeatTypeDef[] {
        return BEAT_TYPES.filter(bt => bt.actId === actId);
    }

    getCategoryDef(categoryId: string): CategoryDef | undefined {
        return WORLDBUILDING_CATEGORIES.find(c => c.id === categoryId);
    }

    getBeatTypeDef(beatTypeId: string): BeatTypeDef | undefined {
        return BEAT_TYPES.find(bt => bt.id === beatTypeId);
    }

    getActDef(actId: string): ActDef | undefined {
        return ACTS.find(a => a.id === actId);
    }
}
