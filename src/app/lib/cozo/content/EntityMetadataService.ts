/**
 * Entity Metadata Service - CozoDB Native
 * 
 * Replaces FactSheetService with graph-native metadata storage.
 * Uses entity_metadata relation for key-value pairs.
 * Adds entity_cards relation for custom card groupings.
 */

import { cozoDb } from '../db';
import type { EntityKind } from '../utils';

// =============================================================================
// TYPES
// =============================================================================

export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect' | 'textarea' | 'entity-link' | 'relationship';

export interface MetadataField {
    entityId: string;
    key: string;
    value: string;
    fieldType?: FieldType;
    cardId?: string;
}

export interface MetaCard {
    id: string;
    entityId: string;
    name: string;
    color?: string;
    icon?: string;
    displayOrder: number;
    isCollapsed: boolean;
    createdAt: number;
    updatedAt: number;
}

// =============================================================================
// SCHEMA CREATION
// =============================================================================

const ENTITY_CARDS_SCHEMA = `
:create entity_cards {
    entity_id: String,
    card_id: String
    =>
    name: String,
    color: String,
    icon: String,
    display_order: Int,
    is_collapsed: Bool,
    created_at: Float,
    updated_at: Float
}
`;

/**
 * Ensure the entity_cards schema exists
 * Called during initialization
 */
export function ensureMetadataSchemas(): void {
    try {
        cozoDb.run(ENTITY_CARDS_SCHEMA);
        console.log('[EntityMetadataService] Schema entity_cards created');
    } catch (err: any) {
        if (!String(err).includes('already exists')) {
            console.error('[EntityMetadataService] Schema creation failed:', err);
        }
    }
}

// =============================================================================
// METADATA OPERATIONS
// =============================================================================

export class EntityMetadataService {

    /**
     * Get all metadata for an entity
     */
    getMetadata(entityId: string): MetadataField[] {
        const script = `
            ?[entity_id, key, value] :=
                *entity_metadata{entity_id, key, value},
                entity_id == $entity_id
        `;
        const result = cozoDb.runQuery(script, { entity_id: entityId });
        return (result.rows || []).map((row: any[]) => ({
            entityId: row[0],
            key: row[1],
            value: row[2],
        }));
    }

    /**
     * Get a single metadata value
     */
    getValue(entityId: string, key: string): string | null {
        const script = `
            ?[value] :=
                *entity_metadata{entity_id, key, value},
                entity_id == $entity_id,
                key == $key
        `;
        const result = cozoDb.runQuery(script, { entity_id: entityId, key });
        if (result.rows?.length) {
            return result.rows[0][0];
        }
        return null;
    }

    /**
     * Set a metadata value (upsert)
     */
    setValue(entityId: string, key: string, value: any): void {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

        const script = `
            ?[entity_id, key, value] <- [[$entity_id, $key, $value]]
            :put entity_metadata {entity_id, key => value}
        `;
        cozoDb.runMutation(script, {
            entity_id: entityId,
            key,
            value: stringValue
        });
    }

    /**
     * Set multiple metadata values at once
     */
    setMultiple(entityId: string, metadata: Record<string, any>): void {
        for (const [key, value] of Object.entries(metadata)) {
            if (value !== null && value !== undefined) {
                this.setValue(entityId, key, value);
            } else {
                this.deleteValue(entityId, key);
            }
        }
    }

    /**
     * Delete a metadata value
     */
    deleteValue(entityId: string, key: string): void {
        const script = `
            ?[entity_id, key] <- [[$entity_id, $key]]
            :rm entity_metadata {entity_id, key}
        `;
        cozoDb.runMutation(script, { entity_id: entityId, key });
    }

    /**
     * Delete all metadata for an entity
     */
    deleteAllForEntity(entityId: string): void {
        const script = `
            ?[entity_id, key] :=
                *entity_metadata{entity_id, key},
                entity_id == $entity_id
            :rm entity_metadata {entity_id, key}
        `;
        cozoDb.runMutation(script, { entity_id: entityId });
    }

    // =========================================================================
    // META CARDS
    // =========================================================================

    /**
     * Get all custom cards for an entity
     */
    getCards(entityId: string): MetaCard[] {
        const script = `
            ?[entity_id, card_id, name, color, icon, display_order, is_collapsed, created_at, updated_at] :=
                *entity_cards{entity_id, card_id, name, color, icon, display_order, is_collapsed, created_at, updated_at},
                entity_id == $entity_id
            :order display_order
        `;
        const result = cozoDb.runQuery(script, { entity_id: entityId });
        return (result.rows || []).map((row: any[]) => ({
            id: row[1],
            entityId: row[0],
            name: row[2],
            color: row[3] || undefined,
            icon: row[4] || undefined,
            displayOrder: row[5],
            isCollapsed: row[6],
            createdAt: row[7],
            updatedAt: row[8],
        }));
    }

    /**
     * Create a new custom card
     */
    createCard(params: {
        entityId: string;
        name: string;
        color?: string;
        icon?: string;
    }): MetaCard {
        const { entityId, name, color, icon } = params;
        const cardId = crypto.randomUUID();
        const timestamp = Date.now();

        // Get current max order
        const existingCards = this.getCards(entityId);
        const displayOrder = existingCards.length;

        const script = `
            ?[entity_id, card_id, name, color, icon, display_order, is_collapsed, created_at, updated_at] <- [[
                $entity_id, $card_id, $name, $color, $icon, $display_order, false, $timestamp, $timestamp
            ]]
            :put entity_cards {entity_id, card_id => name, color, icon, display_order, is_collapsed, created_at, updated_at}
        `;
        cozoDb.runMutation(script, {
            entity_id: entityId,
            card_id: cardId,
            name,
            color: color ?? '',
            icon: icon ?? '',
            display_order: displayOrder,
            timestamp
        });

        return {
            id: cardId,
            entityId,
            name,
            color,
            icon,
            displayOrder,
            isCollapsed: false,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
    }

    /**
     * Update a card
     */
    updateCard(entityId: string, cardId: string, updates: Partial<Omit<MetaCard, 'id' | 'entityId' | 'createdAt'>>): void {
        const existing = this.getCards(entityId).find(c => c.id === cardId);
        if (!existing) return;

        const timestamp = Date.now();
        const script = `
            ?[entity_id, card_id, name, color, icon, display_order, is_collapsed, created_at, updated_at] <- [[
                $entity_id, $card_id, $name, $color, $icon, $display_order, $is_collapsed, $created_at, $updated_at
            ]]
            :put entity_cards {entity_id, card_id => name, color, icon, display_order, is_collapsed, created_at, updated_at}
        `;
        cozoDb.runMutation(script, {
            entity_id: entityId,
            card_id: cardId,
            name: updates.name ?? existing.name,
            color: updates.color ?? existing.color ?? '',
            icon: updates.icon ?? existing.icon ?? '',
            display_order: updates.displayOrder ?? existing.displayOrder,
            is_collapsed: updates.isCollapsed ?? existing.isCollapsed,
            created_at: existing.createdAt,
            updated_at: timestamp
        });
    }

    /**
     * Delete a card and its associated fields
     */
    deleteCard(entityId: string, cardId: string): void {
        // Delete card
        const script = `
            ?[entity_id, card_id] <- [[$entity_id, $card_id]]
            :rm entity_cards {entity_id, card_id}
        `;
        cozoDb.runMutation(script, { entity_id: entityId, card_id: cardId });

        // Delete metadata fields that belong to this card
        // Fields are stored with keys like "cardId:fieldName"
        const metadata = this.getMetadata(entityId);
        for (const field of metadata) {
            if (field.key.startsWith(`${cardId}:`)) {
                this.deleteValue(entityId, field.key);
            }
        }
    }

    /**
     * Delete all cards for an entity
     */
    deleteAllCardsForEntity(entityId: string): void {
        const script = `
            ?[entity_id, card_id] :=
                *entity_cards{entity_id, card_id},
                entity_id == $entity_id
            :rm entity_cards {entity_id, card_id}
        `;
        cozoDb.runMutation(script, { entity_id: entityId });
    }

    // =========================================================================
    // CONVENIENCE: Structured Field Access
    // =========================================================================

    /**
     * Get a structured field (parses JSON if needed)
     */
    getStructuredValue<T>(entityId: string, key: string): T | null {
        const raw = this.getValue(entityId, key);
        if (raw === null) return null;

        try {
            return JSON.parse(raw) as T;
        } catch {
            return raw as unknown as T;
        }
    }

    /**
     * Get all metadata as a record
     */
    getAsRecord(entityId: string): Record<string, any> {
        const metadata = this.getMetadata(entityId);
        const record: Record<string, any> = {};

        for (const field of metadata) {
            try {
                record[field.key] = JSON.parse(field.value);
            } catch {
                record[field.key] = field.value;
            }
        }

        return record;
    }
}

// Singleton
export const entityMetadataService = new EntityMetadataService();

// NOTE: ensureMetadataSchemas() is called by entityAttributeStore.init()
// after CozoDB is initialized via AppOrchestrator
