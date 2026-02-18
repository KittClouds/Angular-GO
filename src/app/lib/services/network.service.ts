// src/app/lib/services/network.service.ts
// Angular service for network CRUD with liveQuery
// DUAL-WRITE: Live UI via Dexie, Persistence via GoKitt

import { Injectable, inject } from '@angular/core';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from, Observable } from 'rxjs';
import {
    db,
    NetworkSchema,
    NetworkInstance,
    NetworkRelationship,
    NetworkRelationshipDef
} from '../dexie/db';
import { GoKittService } from '../../services/gokitt.service'; // Adjust path if needed

@Injectable({
    providedIn: 'root'
})
export class NetworkService {
    private goKitt = inject(GoKittService);

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
        const instance: NetworkInstance = {
            id,
            schemaId,
            name,
            rootFolderId,
            entityIds: [],
            narrativeId,
            createdAt: now,
            updatedAt: now,
        };

        // Dexie (UI)
        await db.networkInstances.add(instance);

        // GoKitt (Backend)
        this.goKitt.storeUpsertNetworkInstance(instance).catch(e => {
            console.error('[NetworkService] GoKitt sync failed:', e);
        });

        return id;
    }

    /**
     * Update a network instance
     */
    async updateInstance(id: string, updates: Partial<NetworkInstance>): Promise<void> {
        // Dexie (UI)
        await db.networkInstances.update(id, {
            ...updates,
            updatedAt: Date.now(),
        });

        // Backend Sync
        const current = await db.networkInstances.get(id);
        if (current) {
            this.goKitt.storeUpsertNetworkInstance(current).catch(e => {
                console.error('[NetworkService] GoKitt sync failed:', e);
            });
        }
    }

    /**
     * Delete a network instance
     */
    async deleteInstance(id: string): Promise<void> {
        // Dexie (UI)
        await db.networkRelationships.where('networkId').equals(id).delete();
        await db.networkInstances.delete(id);

        // Backend Sync
        this.goKitt.storeDeleteNetworkInstance(id).catch(e => {
            console.error('[NetworkService] GoKitt delete failed:', e);
        });
    }

    /**
     * Add entity to network
     */
    async addEntityToNetwork(networkId: string, entityId: string): Promise<void> {
        const instance = await db.networkInstances.get(networkId);
        if (!instance) return;

        if (!instance.entityIds.includes(entityId)) {
            // Update entity list in instance (Legacy way, but we keep it for now)
            instance.entityIds.push(entityId);
            const now = Date.now();
            await db.networkInstances.update(networkId, {
                entityIds: instance.entityIds,
                updatedAt: now,
            });

            // Sync Instance Update
            this.goKitt.storeUpsertNetworkInstance(instance).catch(e => console.error('[NetworkService] Sync instance failed', e));

            // Sync Membership (New explicit table in Go)
            this.goKitt.storeUpsertNetworkMembership({
                networkId,
                entityId,
                x: 0,
                y: 0,
                fixed: false
            }).catch(e => console.error('[NetworkService] GoKitt membership sync failed', e));
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

        // Sync instance update
        this.goKitt.storeUpsertNetworkInstance(instance).catch(e => console.error(e));

        // Delete membership from GoKitt
        this.goKitt.storeDeleteNetworkMembership(networkId, entityId).catch(e =>
            console.error('[NetworkService] GoKitt membership delete failed:', e)
        );

        // Remove relationships involving this entity
        const relsToDelete = await db.networkRelationships
            .filter(r =>
                r.networkId === networkId &&
                (r.sourceEntityId === entityId || r.targetEntityId === entityId)
            )
            .toArray();

        await db.networkRelationships.bulkDelete(relsToDelete.map(r => r.id));

        // Sync relationship deletes to GoKitt
        for (const rel of relsToDelete) {
            this.goKitt.storeDeleteNetworkRelationship(networkId, rel.id).catch(e =>
                console.error('[NetworkService] GoKitt relationship delete failed:', e)
            );
        }
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

        const rel: NetworkRelationship = {
            id,
            networkId,
            sourceEntityId,
            targetEntityId,
            relationshipCode,
            strength: options?.strength,
            notes: options?.notes,
            createdAt: now,
            updatedAt: now,
        };

        await db.networkRelationships.add(rel);

        // GoKitt Sync
        this.goKitt.storeUpsertNetworkRelationship(rel).catch(e => console.error(e));

        // Check if we should auto-create inverse
        const instance = await db.networkInstances.get(networkId);
        if (instance) {
            const schema = await db.networkSchemas.get(instance.schemaId);
            if (schema?.autoCreateInverse) {
                const relDef = schema.relationships.find(r => r.code === relationshipCode);
                if (relDef?.inverseCode) {
                    // Create inverse relationship
                    const inverseRel: NetworkRelationship = {
                        id: crypto.randomUUID(),
                        networkId,
                        sourceEntityId: targetEntityId,
                        targetEntityId: sourceEntityId,
                        relationshipCode: relDef.inverseCode,
                        strength: options?.strength,
                        createdAt: now,
                        updatedAt: now,
                    };
                    await db.networkRelationships.add(inverseRel);
                    this.goKitt.storeUpsertNetworkRelationship(inverseRel).catch(e => console.error(e));
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

        const current = await db.networkRelationships.get(id);
        if (current) {
            this.goKitt.storeUpsertNetworkRelationship(current).catch(e => console.error(e));
        }
    }

    /**
     * Delete a relationship
     */
    async deleteRelationship(id: string): Promise<void> {
        // Get the relationship before deleting to get networkId
        const rel = await db.networkRelationships.get(id);
        await db.networkRelationships.delete(id);

        // Sync to GoKitt
        if (rel) {
            this.goKitt.storeDeleteNetworkRelationship(rel.networkId, id).catch(e =>
                console.error('[NetworkService] GoKitt relationship delete failed:', e)
            );
        }
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
