// src/app/lib/services/network.service.ts
// Angular service for network CRUD with liveQuery

import { Injectable } from '@angular/core';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from, Observable } from 'rxjs';
import {
    db,
    NetworkSchema,
    NetworkInstance,
    NetworkRelationship,
    NetworkRelationshipDef
} from '../dexie/db';

@Injectable({
    providedIn: 'root'
})
export class NetworkService {
    // ==========================================================================
    // SCHEMA QUERIES
    // ==========================================================================

    /**
     * Get all network schemas
     */
    getAllSchemas$(): Observable<NetworkSchema[]> {
        return from(liveQuery(() => db.networkSchemas.toArray()) as DexieObservable<NetworkSchema[]>);
    }

    /**
     * Get a schema by ID
     */
    async getSchema(id: string): Promise<NetworkSchema | undefined> {
        return db.networkSchemas.get(id);
    }

    /**
     * Get schema by kind
     */
    async getSchemaByKind(kind: string): Promise<NetworkSchema | undefined> {
        return db.networkSchemas.where('kind').equals(kind).first();
    }

    // ==========================================================================
    // INSTANCE QUERIES
    // ==========================================================================

    /**
     * Get all network instances
     */
    getAllInstances$(): Observable<NetworkInstance[]> {
        return from(liveQuery(() => db.networkInstances.toArray()) as DexieObservable<NetworkInstance[]>);
    }

    /**
     * Get instances by narrative
     */
    getInstancesByNarrative$(narrativeId: string): Observable<NetworkInstance[]> {
        return from(liveQuery(() =>
            db.networkInstances.where('narrativeId').equals(narrativeId).toArray()
        ) as DexieObservable<NetworkInstance[]>);
    }

    /**
     * Get instance by ID
     */
    getInstance$(id: string): Observable<NetworkInstance | undefined> {
        return from(liveQuery(() => db.networkInstances.get(id)) as DexieObservable<NetworkInstance | undefined>);
    }

    /**
     * Get instance by root folder
     */
    async getInstanceByFolder(folderId: string): Promise<NetworkInstance | undefined> {
        return db.networkInstances.where('rootFolderId').equals(folderId).first();
    }

    // ==========================================================================
    // RELATIONSHIP QUERIES
    // ==========================================================================

    /**
     * Get all relationships for a network
     */
    getRelationships$(networkId: string): Observable<NetworkRelationship[]> {
        return from(liveQuery(() =>
            db.networkRelationships.where('networkId').equals(networkId).toArray()
        ) as DexieObservable<NetworkRelationship[]>);
    }

    /**
     * Get relationships for an entity
     */
    getEntityRelationships$(entityId: string): Observable<NetworkRelationship[]> {
        return from(liveQuery(() =>
            db.networkRelationships
                .filter(r => r.sourceEntityId === entityId || r.targetEntityId === entityId)
                .toArray()
        ) as DexieObservable<NetworkRelationship[]>);
    }

    // ==========================================================================
    // INSTANCE CRUD
    // ==========================================================================

    /**
     * Create a network instance
     */
    async createInstance(
        schemaId: string,
        name: string,
        rootFolderId: string,
        narrativeId: string
    ): Promise<string> {
        const id = crypto.randomUUID();
        const now = Date.now();

        await db.networkInstances.add({
            id,
            schemaId,
            name,
            rootFolderId,
            entityIds: [],
            narrativeId,
            createdAt: now,
            updatedAt: now,
        });

        return id;
    }

    /**
     * Update a network instance
     */
    async updateInstance(id: string, updates: Partial<NetworkInstance>): Promise<void> {
        await db.networkInstances.update(id, {
            ...updates,
            updatedAt: Date.now(),
        });
    }

    /**
     * Delete a network instance
     */
    async deleteInstance(id: string): Promise<void> {
        // Delete all relationships in this network
        await db.networkRelationships.where('networkId').equals(id).delete();
        // Delete the instance
        await db.networkInstances.delete(id);
    }

    /**
     * Add entity to network
     */
    async addEntityToNetwork(networkId: string, entityId: string): Promise<void> {
        const instance = await db.networkInstances.get(networkId);
        if (!instance) return;

        if (!instance.entityIds.includes(entityId)) {
            instance.entityIds.push(entityId);
            await db.networkInstances.update(networkId, {
                entityIds: instance.entityIds,
                updatedAt: Date.now(),
            });
        }
    }

    /**
     * Remove entity from network
     */
    async removeEntityFromNetwork(networkId: string, entityId: string): Promise<void> {
        const instance = await db.networkInstances.get(networkId);
        if (!instance) return;

        instance.entityIds = instance.entityIds.filter(id => id !== entityId);
        await db.networkInstances.update(networkId, {
            entityIds: instance.entityIds,
            updatedAt: Date.now(),
        });

        // Remove relationships involving this entity
        await db.networkRelationships
            .filter(r =>
                r.networkId === networkId &&
                (r.sourceEntityId === entityId || r.targetEntityId === entityId)
            )
            .delete();
    }

    // ==========================================================================
    // RELATIONSHIP CRUD
    // ==========================================================================

    /**
     * Create a relationship
     */
    async createRelationship(
        networkId: string,
        sourceEntityId: string,
        targetEntityId: string,
        relationshipCode: string,
        options?: { strength?: number; notes?: string }
    ): Promise<string> {
        const id = crypto.randomUUID();
        const now = Date.now();

        await db.networkRelationships.add({
            id,
            networkId,
            sourceEntityId,
            targetEntityId,
            relationshipCode,
            strength: options?.strength,
            notes: options?.notes,
            createdAt: now,
            updatedAt: now,
        });

        // Check if we should auto-create inverse
        const instance = await db.networkInstances.get(networkId);
        if (instance) {
            const schema = await db.networkSchemas.get(instance.schemaId);
            if (schema?.autoCreateInverse) {
                const relDef = schema.relationships.find(r => r.code === relationshipCode);
                if (relDef?.inverseCode) {
                    // Create inverse relationship
                    await db.networkRelationships.add({
                        id: crypto.randomUUID(),
                        networkId,
                        sourceEntityId: targetEntityId,
                        targetEntityId: sourceEntityId,
                        relationshipCode: relDef.inverseCode,
                        strength: options?.strength,
                        createdAt: now,
                        updatedAt: now,
                    });
                }
            }
        }

        return id;
    }

    /**
     * Update a relationship
     */
    async updateRelationship(id: string, updates: Partial<NetworkRelationship>): Promise<void> {
        await db.networkRelationships.update(id, {
            ...updates,
            updatedAt: Date.now(),
        });
    }

    /**
     * Delete a relationship
     */
    async deleteRelationship(id: string): Promise<void> {
        await db.networkRelationships.delete(id);
    }

    // ==========================================================================
    // UTILITY
    // ==========================================================================

    /**
     * Get relationship definition from schema
     */
    async getRelationshipDef(
        schemaId: string,
        code: string
    ): Promise<NetworkRelationshipDef | undefined> {
        const schema = await db.networkSchemas.get(schemaId);
        return schema?.relationships.find(r => r.code === code);
    }
}
