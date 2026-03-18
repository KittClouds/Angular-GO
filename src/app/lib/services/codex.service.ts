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

// ─── Thread Types ─────────────────────────────────────────

export interface ThreadTypeDef {
    id: string;
    label: string;
    icon: string;
    color: string;
}

export const THREAD_TYPES: ThreadTypeDef[] = [
    { id: 'main-plot',      label: 'Main Plot',      icon: 'pi pi-bookmark-fill', color: '#3b82f6' },
    { id: 'subplot',        label: 'Subplot',        icon: 'pi pi-bookmark',      color: '#8b5cf6' },
    { id: 'character-arc',  label: 'Character Arc',  icon: 'pi pi-user',          color: '#ec4899' },
    { id: 'mystery',        label: 'Mystery',        icon: 'pi pi-question-circle', color: '#f59e0b' },
    { id: 'theme',          label: 'Theme',          icon: 'pi pi-palette',       color: '#10b981' },
];

export interface ThreadStatusDef {
    id: string;
    label: string;
    color: string;
    severity: 'success' | 'warn' | 'secondary' | 'info';
}

export const THREAD_STATUSES: ThreadStatusDef[] = [
    { id: 'active',   label: 'Active',   color: '#22c55e', severity: 'success'   },
    { id: 'dormant',  label: 'Dormant',  color: '#f59e0b', severity: 'warn'      },
    { id: 'resolved', label: 'Resolved', color: '#64748b', severity: 'secondary' },
];

// Legacy compat — kept so any stale references don't explode
export type BeatTypeDef = ThreadTypeDef;
export type ActDef = { id: string; name: string; color: string; order: number };
export const BEAT_TYPES: BeatTypeDef[] = [];
export const ACTS: ActDef[] = [];

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

    // ─── Plot Threads ────────────────────────────────────────

    /**
     * Get all threads for a narrative (entryType === 'thread')
     */
    getThreads$(narrativeId: string): Observable<CodexEntry[]> {
        return from(
            liveQuery(() =>
                db.codexEntries
                    .where('[narrativeId+entryType]')
                    .equals([narrativeId, 'thread'])
                    .sortBy('order')
            ) as DexieObservable<CodexEntry[]>
        );
    }

    /**
     * Get all beats belonging to a specific thread (via parentId)
     */
    getBeatsForThread$(threadId: string): Observable<CodexEntry[]> {
        return from(
            liveQuery(() =>
                db.codexEntries
                    .where('parentId')
                    .equals(threadId)
                    .sortBy('order')
            ) as DexieObservable<CodexEntry[]>
        );
    }

    /**
     * Create a plot thread
     */
    async createThread(
        narrativeId: string,
        title: string,
        threadType: string = 'subplot',
        color?: string
    ): Promise<string> {
        const maxOrder = await this.getMaxOrder(narrativeId, 'thread');
        const typeDef = THREAD_TYPES.find(t => t.id === threadType);
        return this.createEntry({
            narrativeId,
            entryType: 'thread' as any,
            title,
            description: '',
            status: 'active' as any,
            category: threadType,
            order: maxOrder + 1,
            entityIds: [],
            color: color || typeDef?.color || '#8b5cf6',
        });
    }

    /**
     * Create a beat attached to a thread
     */
    async createBeatForThread(
        narrativeId: string,
        threadId: string,
        title: string,
        description: string = ''
    ): Promise<string> {
        const maxOrder = await this.getMaxOrderForParent(threadId);
        return this.createEntry({
            narrativeId,
            entryType: 'beat',
            title,
            description,
            status: 'planned',
            parentId: threadId,
            order: maxOrder + 1,
            entityIds: [],
        });
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
        entityIds: string[] = [],
        displayTime?: string,
        linkedNoteId?: string
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
            displayTime,
            linkedNoteId
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

    private async getMaxOrderForParent(parentId: string): Promise<number> {
        const entries = await db.codexEntries
            .where('parentId')
            .equals(parentId)
            .toArray();
        return entries.reduce((max, e) => Math.max(max, e.order), 0);
    }

    // ─── Category Helpers ───────────────────────────────────

    getWorldbuildingCategories(): CategoryDef[] {
        return WORLDBUILDING_CATEGORIES;
    }

    getCategoryDef(categoryId: string): CategoryDef | undefined {
        return WORLDBUILDING_CATEGORIES.find(c => c.id === categoryId);
    }

    // ─── Thread Helpers ─────────────────────────────────────

    getThreadTypes(): ThreadTypeDef[] {
        return THREAD_TYPES;
    }

    getThreadTypeDef(typeId: string): ThreadTypeDef | undefined {
        return THREAD_TYPES.find(t => t.id === typeId);
    }

    getThreadStatuses(): ThreadStatusDef[] {
        return THREAD_STATUSES;
    }

    getThreadStatusDef(statusId: string): ThreadStatusDef | undefined {
        return THREAD_STATUSES.find(s => s.id === statusId);
    }
}
