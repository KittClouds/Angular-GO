import { Injectable } from '@angular/core';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from, Observable } from 'rxjs';
import {
    db,
    Entity,
    EntityMetadata,
    FactSheetCardSchema,
    FactSheetFieldSchema,
} from '../../lib/dexie';
import { ChapterService } from '../../lib/services/chapter.service';
import { inject } from '@angular/core';
import { DEFAULT_ENTITY_SCHEMAS } from '../../lib/schemas/entity-fact-sheet-schemas';

// ============================================================================
// DEFAULT SCHEMAS - Loaded synchronously, no async delay
// ============================================================================

const DEFAULT_CHARACTER_CARDS: FactSheetCardSchema[] = [
    { id: 'CHARACTER::identity', entityKind: 'CHARACTER', cardId: 'identity', title: 'Identity Core', icon: 'User', gradient: 'from-blue-500 to-cyan-500', displayOrder: 0, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::progression', entityKind: 'CHARACTER', cardId: 'progression', title: 'Progression & Vitals', icon: 'Zap', gradient: 'from-pink-500 to-rose-500', displayOrder: 1, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::attributes', entityKind: 'CHARACTER', cardId: 'attributes', title: 'Attributes', icon: 'BarChart3', gradient: 'from-purple-500 to-violet-500', displayOrder: 2, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::abilities', entityKind: 'CHARACTER', cardId: 'abilities', title: 'Abilities & Skills', icon: 'Sparkles', gradient: 'from-amber-500 to-orange-500', displayOrder: 3, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::inventory', entityKind: 'CHARACTER', cardId: 'inventory', title: 'Inventory', icon: 'Package', gradient: 'from-emerald-500 to-teal-500', displayOrder: 4, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::relationships', entityKind: 'CHARACTER', cardId: 'relationships', title: 'Relationships', icon: 'Users', gradient: 'from-red-500 to-pink-500', displayOrder: 5, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::notes', entityKind: 'CHARACTER', cardId: 'notes', title: 'Notes & Secrets', icon: 'StickyNote', gradient: 'from-slate-500 to-gray-500', displayOrder: 6, isSystem: true, createdAt: 0, updatedAt: 0 },
];

const DEFAULT_CHARACTER_FIELDS: FactSheetFieldSchema[] = [
    // Identity Core
    { id: 'CHARACTER::identity::fullName', entityKind: 'CHARACTER', cardId: 'identity', fieldName: 'fullName', fieldType: 'text', label: 'Full Name', placeholder: 'Click to add name...', displayOrder: 0, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::identity::aliases', entityKind: 'CHARACTER', cardId: 'identity', fieldName: 'aliases', fieldType: 'array', label: 'Aliases', displayOrder: 1, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::identity::occupation', entityKind: 'CHARACTER', cardId: 'identity', fieldName: 'occupation', fieldType: 'text', label: 'Occupation/Class', placeholder: 'Click to add occupation...', displayOrder: 2, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::identity::background', entityKind: 'CHARACTER', cardId: 'identity', fieldName: 'background', fieldType: 'text', label: 'Background', placeholder: 'Click to add background...', multiline: true, displayOrder: 3, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::identity::personality', entityKind: 'CHARACTER', cardId: 'identity', fieldName: 'personality', fieldType: 'text', label: 'Personality', placeholder: 'Click to add personality...', multiline: true, displayOrder: 4, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::identity::age', entityKind: 'CHARACTER', cardId: 'identity', fieldName: 'age', fieldType: 'number', label: 'Age', min: 0, defaultValue: '0', displayOrder: 5, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::identity::species', entityKind: 'CHARACTER', cardId: 'identity', fieldName: 'species', fieldType: 'text', label: 'Species/Race', placeholder: 'Click to add species...', displayOrder: 6, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::identity::gender', entityKind: 'CHARACTER', cardId: 'identity', fieldName: 'gender', fieldType: 'text', label: 'Gender', placeholder: 'Click to add gender...', displayOrder: 7, isSystem: true, createdAt: 0, updatedAt: 0 },
    // Progression & Vitals - Now uses dynamic sliders
    { id: 'CHARACTER::progression::level', entityKind: 'CHARACTER', cardId: 'progression', fieldName: 'level', fieldType: 'number', label: 'Level', min: 1, defaultValue: '1', displayOrder: 0, isSystem: true, createdAt: 0, updatedAt: 0 },

    // Default Vitals (Restored)
    { id: 'CHARACTER::progression::xp', entityKind: 'CHARACTER', cardId: 'progression', fieldName: 'xp', fieldType: 'progress', label: 'Experience', currentField: 'xpCurrent', maxField: 'xpRequired', color: '#eab308', displayOrder: 1, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::progression::health', entityKind: 'CHARACTER', cardId: 'progression', fieldName: 'health', fieldType: 'progress', label: 'Health', currentField: 'healthCurrent', maxField: 'healthMax', color: '#ef4444', displayOrder: 2, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::progression::mana', entityKind: 'CHARACTER', cardId: 'progression', fieldName: 'mana', fieldType: 'progress', label: 'Mana', currentField: 'manaCurrent', maxField: 'manaMax', color: '#3b82f6', displayOrder: 3, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::progression::stamina', entityKind: 'CHARACTER', cardId: 'progression', fieldName: 'stamina', fieldType: 'progress', label: 'Stamina', currentField: 'staminaCurrent', maxField: 'staminaMax', color: '#22c55e', displayOrder: 4, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::progression::statusConditions', entityKind: 'CHARACTER', cardId: 'progression', fieldName: 'statusConditions', fieldType: 'array', label: 'Status Conditions', displayOrder: 5, isSystem: true, createdAt: 0, updatedAt: 0 },

    // Custom Stats (Dynamic)
    { id: 'CHARACTER::progression::dynamicSliders', entityKind: 'CHARACTER', cardId: 'progression', fieldName: 'dynamicSliders', fieldType: 'dynamic-sliders', label: 'Custom Stats', displayOrder: 6, isSystem: true, createdAt: 0, updatedAt: 0 },
    // Attributes
    {
        id: 'CHARACTER::attributes::stats', entityKind: 'CHARACTER', cardId: 'attributes', fieldName: 'stats', fieldType: 'stat-grid', label: 'Core Stats', stats: JSON.stringify([
            { name: 'strength', label: 'Strength', abbr: 'STR' },
            { name: 'dexterity', label: 'Dexterity', abbr: 'DEX' },
            { name: 'constitution', label: 'Constitution', abbr: 'CON' },
            { name: 'intelligence', label: 'Intelligence', abbr: 'INT' },
            { name: 'wisdom', label: 'Wisdom', abbr: 'WIS' },
            { name: 'charisma', label: 'Charisma', abbr: 'CHA' },
        ]), displayOrder: 0, isSystem: true, createdAt: 0, updatedAt: 0
    },
    // Abilities & Skills
    { id: 'CHARACTER::abilities::abilities', entityKind: 'CHARACTER', cardId: 'abilities', fieldName: 'abilities', fieldType: 'array', label: 'Abilities', displayOrder: 0, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::abilities::skills', entityKind: 'CHARACTER', cardId: 'abilities', fieldName: 'skills', fieldType: 'array', label: 'Skills', displayOrder: 1, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::abilities::languages', entityKind: 'CHARACTER', cardId: 'abilities', fieldName: 'languages', fieldType: 'array', label: 'Languages', displayOrder: 2, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::abilities::proficiencies', entityKind: 'CHARACTER', cardId: 'abilities', fieldName: 'proficiencies', fieldType: 'array', label: 'Proficiencies', displayOrder: 3, isSystem: true, createdAt: 0, updatedAt: 0 },
    // Inventory
    { id: 'CHARACTER::inventory::equippedItems', entityKind: 'CHARACTER', cardId: 'inventory', fieldName: 'equippedItems', fieldType: 'array', label: 'Equipped', displayOrder: 0, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::inventory::carriedItems', entityKind: 'CHARACTER', cardId: 'inventory', fieldName: 'carriedItems', fieldType: 'array', label: 'Carried', displayOrder: 1, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::inventory::gold', entityKind: 'CHARACTER', cardId: 'inventory', fieldName: 'gold', fieldType: 'number', label: 'Gold', min: 0, defaultValue: '0', displayOrder: 2, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::inventory::carryCapacity', entityKind: 'CHARACTER', cardId: 'inventory', fieldName: 'carryCapacity', fieldType: 'number', label: 'Carry Capacity', min: 0, unit: 'lbs', displayOrder: 3, isSystem: true, createdAt: 0, updatedAt: 0 },
    // Relationships
    { id: 'CHARACTER::relationships::relationships', entityKind: 'CHARACTER', cardId: 'relationships', fieldName: 'relationships', fieldType: 'relationship', label: 'Connections', displayOrder: 0, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::relationships::factions', entityKind: 'CHARACTER', cardId: 'relationships', fieldName: 'factions', fieldType: 'array', label: 'Faction Affiliations', displayOrder: 1, isSystem: true, createdAt: 0, updatedAt: 0 },
    // Notes & Secrets
    { id: 'CHARACTER::notes::publicNotes', entityKind: 'CHARACTER', cardId: 'notes', fieldName: 'publicNotes', fieldType: 'text', label: 'Public Notes', placeholder: 'Notes visible to all...', multiline: true, displayOrder: 0, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::notes::privateNotes', entityKind: 'CHARACTER', cardId: 'notes', fieldName: 'privateNotes', fieldType: 'text', label: 'Private Notes', placeholder: 'Hidden notes and secrets...', multiline: true, displayOrder: 1, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::notes::goals', entityKind: 'CHARACTER', cardId: 'notes', fieldName: 'goals', fieldType: 'array', label: 'Goals', displayOrder: 2, isSystem: true, createdAt: 0, updatedAt: 0 },
    { id: 'CHARACTER::notes::fears', entityKind: 'CHARACTER', cardId: 'notes', fieldName: 'fears', fieldType: 'array', label: 'Fears', displayOrder: 3, isSystem: true, createdAt: 0, updatedAt: 0 },
];

// Default schemas by kind - synchronous access
// Merge CHARACTER (inline) with imported schemas for all other kinds
const DEFAULT_SCHEMAS: Record<string, { cards: FactSheetCardSchema[]; fields: FactSheetFieldSchema[] }> = {
    CHARACTER: { cards: DEFAULT_CHARACTER_CARDS, fields: DEFAULT_CHARACTER_FIELDS },
    ...DEFAULT_ENTITY_SCHEMAS,
};

// Pre-computed gradient CSS - no runtime calculation needed
const GRADIENT_CSS_MAP: Record<string, string> = {
    'from-blue-500 to-cyan-500': 'linear-gradient(to right, #3b82f6, #06b6d4)',
    'from-pink-500 to-rose-500': 'linear-gradient(to right, #ec4899, #f43f5e)',
    'from-purple-500 to-violet-500': 'linear-gradient(to right, #a855f7, #8b5cf6)',
    'from-amber-500 to-orange-500': 'linear-gradient(to right, #f59e0b, #f97316)',
    'from-emerald-500 to-teal-500': 'linear-gradient(to right, #10b981, #14b8a6)',
    'from-red-500 to-pink-500': 'linear-gradient(to right, #ef4444, #ec4899)',
    'from-slate-500 to-gray-500': 'linear-gradient(to right, #64748b, #6b7280)',
    // Additional gradients for new entity types
    'from-emerald-500 to-green-500': 'linear-gradient(to right, #10b981, #22c55e)',
    'from-blue-500 to-indigo-500': 'linear-gradient(to right, #3b82f6, #6366f1)',
    'from-amber-500 to-yellow-500': 'linear-gradient(to right, #f59e0b, #eab308)',
    'from-purple-500 to-pink-500': 'linear-gradient(to right, #a855f7, #ec4899)',
    'from-indigo-500 to-purple-500': 'linear-gradient(to right, #6366f1, #a855f7)',
    'from-teal-500 to-cyan-500': 'linear-gradient(to right, #14b8a6, #06b6d4)',
    'from-red-500 to-orange-500': 'linear-gradient(to right, #ef4444, #f97316)',
    'from-red-500 to-rose-500': 'linear-gradient(to right, #ef4444, #f43f5e)',
    'from-yellow-500 to-amber-500': 'linear-gradient(to right, #eab308, #f59e0b)',
    'from-cyan-500 to-teal-500': 'linear-gradient(to right, #06b6d4, #14b8a6)',
    'from-orange-500 to-amber-500': 'linear-gradient(to right, #f97316, #f59e0b)',
};

/**
 * Get pre-computed gradient CSS from gradient class string
 */
function getGradientCss(gradient: string): string {
    return GRADIENT_CSS_MAP[gradient] || 'linear-gradient(to right, #3b82f6, #06b6d4)';
}

/**
 * Grouped card with its fields - includes pre-computed gradientCss
 */
export interface CardWithFields {
    schema: FactSheetCardSchema;
    fields: FactSheetFieldSchema[];
    gradientCss: string;  // Pre-computed: 'linear-gradient(to right, #3b82f6, #06b6d4)'
}

/**
 * FactSheetService
 *
 * Service layer for fact sheet operations.
 * - Provides SYNCHRONOUS defaults (like colorStore)
 * - Uses liveQuery for reactive Dexie updates
 * - Caches schemas in memory for instant access
 */
@Injectable({ providedIn: 'root' })
export class FactSheetService {
    // In-memory cache - populated synchronously from defaults
    private schemaCache: Map<string, CardWithFields[]> = new Map();
    // Cache is now Map<entityId, Map<contextId, Record<string, any>>> ?
    // Or just simple cache of the "current view"?
    // For simplicity, we cache the LAST LOADED view so synchronous getters work for the active view.
    private attributeCache: Map<string, Record<string, any>> = new Map();

    // We also need the ChapterService for inheritance, but circular dependency risk if not careful.
    // We'll inject it.
    private chapterService = inject(ChapterService);
    private initialized = false;

    constructor() {
        // Pre-populate cache with defaults synchronously
        this.initializeFromDefaults();
        // Then sync to Dexie in background (fire and forget)
        this.syncToDexie();
    }

    // =========================================================================
    // SYNCHRONOUS GETTERS (instant, no async)
    // =========================================================================

    /**
     * Get cards with fields for an entity kind - SYNCHRONOUS
     * Returns cached defaults immediately, Dexie updates come later
     */
    getCardsSync(entityKind: string): CardWithFields[] {
        return this.schemaCache.get(entityKind) || [];
    }

    /**
     * Get attributes for an entity - SYNCHRONOUS
     * Returns cached values, may be empty on first call
     */
    getAttributesSync(entityId: string): Record<string, any> {
        return this.attributeCache.get(entityId) || {};
    }

    /**
     * Check if we have a schema for this kind
     */
    hasSchema(entityKind: string): boolean {
        return this.schemaCache.has(entityKind);
    }

    // =========================================================================
    // REACTIVE QUERIES (liveQuery as Observable)
    // =========================================================================

    /**
     * Get all entities as a live-updating observable
     */
    getAllEntities$(): Observable<Entity[]> {
        return from(liveQuery(() => db.entities.orderBy('label').toArray()) as DexieObservable<Entity[]>);
    }

    /**
     * Get attributes for an entity as live-updating observable
     */
    getAttributes$(entityId: string): Observable<EntityMetadata[]> {
        return from(liveQuery(() =>
            db.entityMetadata.where('entityId').equals(entityId).toArray()
        ) as DexieObservable<EntityMetadata[]>);
    }

    // =========================================================================
    // ATTRIBUTE MUTATIONS
    // =========================================================================

    /**
     * Set a single attribute - updates cache immediately, persists to Dexie
     */
    async setAttribute(entityId: string, key: string, value: any, contextId: string = 'global'): Promise<void> {
        // Update cache immediately (optimistic)
        const cached = this.attributeCache.get(entityId) || {};
        cached[key] = value;
        this.attributeCache.set(entityId, cached);

        // Persist to Dexie
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);

        // Use put to upsert based on composite key [entityId+key+contextId]
        await db.entityMetadata.put({
            entityId,
            key,
            value: serialized,
            contextId
        });
    }

    /**
     * Load attributes for an entity into cache with INHERITANCE
     * contextId: The specific chapter/scope to view.
     */
    async loadAttributes(entityId: string, contextId: string = 'global'): Promise<Record<string, any>> {
        // 1. Get inheritance chain (e.g., ['global', 'ch1', 'ch2', 'ch3'])
        const chain = this.chapterService.getInheritanceChain(contextId);

        // 2. Fetch all metadata for this entity where contextId is in the chain
        const rows = await db.entityMetadata
            .where('entityId').equals(entityId)
            .filter(row => chain.includes(row.contextId || 'global')) // 'global' fallback for old data
            .toArray();

        // 3. Merge values in order of the chain
        const result: Record<string, any> = {};

        // Sort rows by chain index to ensure correct override order
        rows.sort((a, b) => {
            const idxA = chain.indexOf(a.contextId || 'global');
            const idxB = chain.indexOf(b.contextId || 'global');
            return idxA - idxB;
        });

        for (const row of rows) {
            try {
                result[row.key] = JSON.parse(row.value);
            } catch {
                result[row.key] = row.value;
            }
        }

        this.attributeCache.set(entityId, result);
        return result;
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Populate schema cache from hardcoded defaults - SYNCHRONOUS
     */
    private initializeFromDefaults(): void {
        for (const [kind, data] of Object.entries(DEFAULT_SCHEMAS)) {
            const cardsWithFields: CardWithFields[] = data.cards.map(card => ({
                schema: card,
                fields: data.fields.filter(f => f.cardId === card.cardId).sort((a, b) => a.displayOrder - b.displayOrder),
                gradientCss: getGradientCss(card.gradient),  // Pre-computed!
            }));
            this.schemaCache.set(kind, cardsWithFields);
        }
        console.log('[FactSheetService] Initialized with default schemas:', [...this.schemaCache.keys()]);
    }

    /**
     * Sync defaults to Dexie (background, non-blocking)
     */
    private async syncToDexie(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        try {
            // Check if CHARACTER schema exists in Dexie
            const existingCount = await db.factSheetCardSchemas.where('entityKind').equals('CHARACTER').count();
            if (existingCount === 0) {
                const now = Date.now();
                const cards = DEFAULT_CHARACTER_CARDS.map(c => ({ ...c, createdAt: now, updatedAt: now }));
                const fields = DEFAULT_CHARACTER_FIELDS.map(f => ({ ...f, createdAt: now, updatedAt: now }));
                await db.factSheetCardSchemas.bulkPut(cards);
                await db.factSheetFieldSchemas.bulkPut(fields);
                console.log('[FactSheetService] Synced CHARACTER schema to Dexie');
            }

        } catch (err) {
            console.error('[FactSheetService] Error syncing to Dexie:', err);
        }
    }
}
