import { Injectable, inject } from '@angular/core';

import { SqlitePersistenceService } from '../lib/sqlite/persistence/SqlitePersistenceService';
import { PhoenixWasmService } from './phoenix-wasm.service';

export interface StoreNote {
    id: string;
    worldId: string;
    title: string;
    content: string;
    markdownContent: string;
    folderId: string;
    entityKind: string;
    entitySubtype: string;
    isEntity: boolean;
    isPinned: boolean;
    favorite: boolean;
    ownerId: string;
    narrativeId: string;
    order: number;
    createdAt: number;
    updatedAt: number;
    version?: number;
}

export interface StoreEntity {
    id: string;
    label: string;
    kind: string;
    subtype?: string;
    aliases: string[];
    firstNote: string;
    totalMentions: number;
    narrativeId?: string;
    createdBy: 'user' | 'extraction' | 'auto';
    createdAt: number;
    updatedAt: number;
}

export interface StoreEdge {
    id: string;
    sourceId: string;
    targetId: string;
    relType: string;
    confidence: number;
    bidirectional: boolean;
    sourceNote?: string;
    createdAt: number;
}

export interface StoreFolder {
    id: string;
    name: string;
    parentId?: string;
    worldId: string;
    narrativeId?: string;
    folderOrder: number;
    entityKind: string;
    entitySubtype: string;
    entityLabel: string;
    color: string;
    isTypedRoot: boolean;
    isSubtypeRoot: boolean;
    collapsed: boolean;
    ownerId: string;
    isNarrativeRoot: boolean;
    attributes?: string;
    createdAt: number;
    updatedAt: number;
}

export interface StoreScopedDocument {
    id: string;
    scopeFolderId: string;
    narrativeId: string;
    namespace: string;
    documentKey: string;
    payload: string;
    seededFromScopeFolderId?: string;
    createdAt: number;
    updatedAt: number;
}

export interface StoreScopedEntityField {
    id: string;
    entityId: string;
    scopeFolderId: string;
    narrativeId: string;
    fieldKey: string;
    valueJson: string;
    seededFromScopeFolderId?: string;
    createdAt: number;
    updatedAt: number;
}

export interface StoreScopedDefinition {
    id: string;
    narrativeId: string;
    namespace: string;
    definitionKey: string;
    payload: string;
    createdAt: number;
    updatedAt: number;
}

export interface StoreDiscoveryCandidate {
    token: string;
    kind: number;
    score: number;
    status: number;
    lastSeen: number;
    firstSeen: number;
    count: number;
}

export interface StoreEntityCard {
    entityId: string;
    cardId: string;
    name: string;
    color: string;
    icon: string;
    displayOrder: number;
    isCollapsed: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface StoreFolderSchema {
    id: string;
    entityKind: string;
    subtype?: string;
    name: string;
    description?: string;
    allowedSubfolders: unknown[];
    allowedNoteTypes: unknown[];
    isVaultRoot: boolean;
    containerOnly: boolean;
    propagateKindToChildren: boolean;
    icon?: string;
    isSystem: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface StoreNetworkInstance {
    id: string;
    schemaId: string;
    name: string;
    rootFolderId: string;
    rootEntityId?: string;
    entityIds: string[];
    narrativeId: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
}

export interface StoreNetworkMembership {
    networkId: string;
    entityId: string;
    x: number;
    y: number;
    fixed: boolean;
}

export interface StoreNetworkRelationship {
    id: string;
    networkId: string;
    sourceEntityId: string;
    targetEntityId: string;
    relationshipCode: string;
    strength?: number;
    startDate?: number;
    endDate?: number;
    notes?: string;
    createdAt: number;
    updatedAt: number;
}

@Injectable({ providedIn: 'root' })
export class PhoenixStoreService {
    private readonly phoenix = inject(PhoenixWasmService);
    private readonly persistence = inject(SqlitePersistenceService);

    private initialized = false;
    private initPromise: Promise<void> | null = null;
    private snapshotTimeout: ReturnType<typeof setTimeout> | null = null;
    private snapshotsPaused = false;

    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.initializeInternal().catch((error) => {
            this.initPromise = null;
            throw error;
        });
        return this.initPromise;
    }

    async tryInitialize(): Promise<boolean> {
        if (this.initialized) return true;
        if (!this.canInitialize) return false;

        try {
            await this.initialize();
            return this.initialized;
        } catch {
            return false;
        }
    }

    get isReady(): boolean {
        return this.initialized;
    }

    get canInitialize(): boolean {
        return this.phoenix.isReady;
    }

    pauseSnapshots(): void {
        this.snapshotsPaused = true;
        if (this.snapshotTimeout) {
            clearTimeout(this.snapshotTimeout);
            this.snapshotTimeout = null;
        }
    }

    resumeSnapshots(): void {
        this.snapshotsPaused = false;
    }

    async triggerSnapshot(): Promise<void> {
        if (!this.initialized || this.snapshotsPaused) {
            return;
        }
        const snapshot = await this.exportDatabase();
        await this.persistence.saveSnapshot(snapshot);
    }

    async upsertNote(note: StoreNote): Promise<void> {
        await this.ensureInitialized();
        await this.relationDelete('notes', { id: note.id });
        await this.relationUpsert('notes', noteToRow(note));
        this.scheduleSnapshot();
    }

    async getNote(id: string): Promise<StoreNote | null> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('notes', { id, is_current: true });
        const row = rows.sort((left, right) => (right.version || 0) - (left.version || 0))[0];
        return row ? rowToNote(row) : null;
    }

    async deleteNote(id: string): Promise<void> {
        await this.ensureInitialized();
        await this.relationDelete('notes', { id });
        this.scheduleSnapshot();
    }

    async listNotes(folderId?: string): Promise<StoreNote[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('notes', {
            is_current: true,
            ...(folderId !== undefined ? { folder_id: folderId } : {}),
        });
        return rows
            .map(rowToNote)
            .sort((left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title));
    }

    async upsertEntity(entity: StoreEntity): Promise<void> {
        await this.ensureInitialized();
        await this.relationUpsert('entities', entityToRow(entity));
        this.scheduleSnapshot();
    }

    async getEntity(id: string): Promise<StoreEntity | null> {
        await this.ensureInitialized();
        const row = await this.relationGetFirst<any>('entities', { id });
        return row ? rowToEntity(row) : null;
    }

    async getEntityByLabel(label: string): Promise<StoreEntity | null> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('entities');
        const normalized = label.trim().toLowerCase();
        const row = rows.find((candidate) => String(candidate.label || '').trim().toLowerCase() === normalized);
        return row ? rowToEntity(row) : null;
    }

    async deleteEntity(id: string): Promise<void> {
        await this.ensureInitialized();
        await this.relationDelete('entities', { id });
        this.scheduleSnapshot();
    }

    async listEntities(kind?: string): Promise<StoreEntity[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('entities', kind ? { kind } : undefined);
        return rows
            .map(rowToEntity)
            .sort((left, right) => left.label.localeCompare(right.label));
    }

    async upsertEdge(edge: StoreEdge): Promise<void> {
        await this.ensureInitialized();
        await this.relationUpsert('edges', edgeToRow(edge));
        this.scheduleSnapshot();
    }

    async getEdge(id: string): Promise<StoreEdge | null> {
        await this.ensureInitialized();
        const row = await this.relationGetFirst<any>('edges', { id });
        return row ? rowToEdge(row) : null;
    }

    async deleteEdge(id: string): Promise<void> {
        await this.ensureInitialized();
        await this.relationDelete('edges', { id });
        this.scheduleSnapshot();
    }

    async listEdgesForEntity(entityId: string): Promise<StoreEdge[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('edges');
        return rows
            .filter((row) => row.source_id === entityId || row.target_id === entityId)
            .map(rowToEdge);
    }

    async listAllEdges(): Promise<StoreEdge[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('edges');
        return rows.map(rowToEdge);
    }

    async upsertFolder(folder: StoreFolder): Promise<void> {
        await this.ensureInitialized();
        await this.relationUpsert('folders', folderToRow(folder));
        this.scheduleSnapshot();
    }

    async getFolder(id: string): Promise<StoreFolder | null> {
        await this.ensureInitialized();
        const row = await this.relationGetFirst<any>('folders', { id });
        return row ? rowToFolder(row) : null;
    }

    async deleteFolder(id: string): Promise<void> {
        await this.ensureInitialized();
        await this.relationDelete('folders', { id });
        this.scheduleSnapshot();
    }

    async listFolders(parentId?: string): Promise<StoreFolder[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>(
            'folders',
            parentId !== undefined ? { parent_id: parentId } : undefined,
        );
        return rows
            .map(rowToFolder)
            .sort((left, right) => left.folderOrder - right.folderOrder || left.name.localeCompare(right.name));
    }

    async upsertScopedDocument(document: StoreScopedDocument): Promise<void> {
        await this.ensureInitialized();
        await this.relationUpsert('scoped_documents', scopedDocumentToRow(document));
        this.scheduleSnapshot();
    }

    async getScopedDocument(
        scopeFolderId: string,
        namespace: string,
        documentKey: string,
    ): Promise<StoreScopedDocument | null> {
        await this.ensureInitialized();
        const row = await this.relationGetFirst<any>('scoped_documents', {
            scope_folder_id: scopeFolderId,
            namespace,
            document_key: documentKey,
        });
        return row ? rowToScopedDocument(row) : null;
    }

    async listScopedDocuments(scopeFolderId: string, namespace?: string): Promise<StoreScopedDocument[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('scoped_documents', {
            scope_folder_id: scopeFolderId,
            ...(namespace ? { namespace } : {}),
        });
        return rows
            .map(rowToScopedDocument)
            .sort((left, right) => left.documentKey.localeCompare(right.documentKey));
    }

    async deleteScopedDocument(
        scopeFolderId: string,
        namespace: string,
        documentKey: string,
    ): Promise<void> {
        await this.ensureInitialized();
        await this.relationDelete('scoped_documents', {
            scope_folder_id: scopeFolderId,
            namespace,
            document_key: documentKey,
        });
        this.scheduleSnapshot();
    }

    async upsertScopedEntityField(field: StoreScopedEntityField): Promise<void> {
        await this.ensureInitialized();
        await this.relationUpsert('scoped_entity_fields', scopedEntityFieldToRow(field));
        this.scheduleSnapshot();
    }

    async getScopedEntityField(
        entityId: string,
        scopeFolderId: string,
        fieldKey: string,
    ): Promise<StoreScopedEntityField | null> {
        await this.ensureInitialized();
        const row = await this.relationGetFirst<any>('scoped_entity_fields', {
            entity_id: entityId,
            scope_folder_id: scopeFolderId,
            field_key: fieldKey,
        });
        return row ? rowToScopedEntityField(row) : null;
    }

    async listScopedEntityFields(
        scopeFolderId: string,
        entityId?: string,
    ): Promise<StoreScopedEntityField[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('scoped_entity_fields', {
            scope_folder_id: scopeFolderId,
            ...(entityId ? { entity_id: entityId } : {}),
        });
        return rows
            .map(rowToScopedEntityField)
            .sort((left, right) => left.fieldKey.localeCompare(right.fieldKey));
    }

    async deleteScopedEntityField(
        entityId: string,
        scopeFolderId: string,
        fieldKey: string,
    ): Promise<void> {
        await this.ensureInitialized();
        await this.relationDelete('scoped_entity_fields', {
            entity_id: entityId,
            scope_folder_id: scopeFolderId,
            field_key: fieldKey,
        });
        this.scheduleSnapshot();
    }

    async upsertScopedDefinition(definition: StoreScopedDefinition): Promise<void> {
        await this.ensureInitialized();
        await this.relationUpsert('scoped_definitions', scopedDefinitionToRow(definition));
        this.scheduleSnapshot();
    }

    async getScopedDefinition(
        narrativeId: string,
        namespace: string,
        definitionKey: string,
    ): Promise<StoreScopedDefinition | null> {
        await this.ensureInitialized();
        const row = await this.relationGetFirst<any>('scoped_definitions', {
            narrative_id: narrativeId,
            namespace,
            definition_key: definitionKey,
        });
        return row ? rowToScopedDefinition(row) : null;
    }

    async listScopedDefinitions(narrativeId: string, namespace?: string): Promise<StoreScopedDefinition[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('scoped_definitions', {
            narrative_id: narrativeId,
            ...(namespace ? { namespace } : {}),
        });
        return rows
            .map(rowToScopedDefinition)
            .sort((left, right) => left.definitionKey.localeCompare(right.definitionKey));
    }

    async deleteScopedDefinition(
        narrativeId: string,
        namespace: string,
        definitionKey: string,
    ): Promise<void> {
        await this.ensureInitialized();
        await this.relationDelete('scoped_definitions', {
            narrative_id: narrativeId,
            namespace,
            definition_key: definitionKey,
        });
        this.scheduleSnapshot();
    }

    async storeUpsertDiscoveryCandidate(candidate: StoreDiscoveryCandidate): Promise<{ success: boolean; error?: string }> {
        await this.ensureInitialized();
        await this.relationUpsert('discovery_candidates', {
            token: candidate.token,
            kind: candidate.kind,
            score: candidate.score,
            status: candidate.status,
            last_seen: candidate.lastSeen,
            first_seen: candidate.firstSeen,
            count: candidate.count,
        });
        this.scheduleSnapshot();
        return { success: true };
    }

    async storeListDiscoveryCandidates(): Promise<StoreDiscoveryCandidate[]> {
        await this.ensureInitialized();
        const rows = await this.relationList<any>('discovery_candidates');
        return rows
            .map((row) => ({
                token: String(row.token || ''),
                kind: Number(row.kind || 0),
                score: Number(row.score || 0),
                status: Number(row.status || 0),
                lastSeen: Number(row.last_seen || 0),
                firstSeen: Number(row.first_seen || 0),
                count: Number(row.count || 0),
            }))
            .sort((left, right) => right.score - left.score || left.token.localeCompare(right.token));
    }

    async upsertEntityCards(cards: StoreEntityCard[]): Promise<void> {
        await this.ensureInitialized();
        await this.phoenix.storeCommand('entityCards:upsertBatch', {
            cards: cards.map(entityCardToPhoenix),
        });
        this.scheduleSnapshot();
    }

    async getEntityCards(entityId: string): Promise<StoreEntityCard[]> {
        await this.ensureInitialized();
        const payload = await this.phoenix.storeCommand('entityCards:get', { entityId });
        return Array.isArray(payload) ? payload.map(phoenixEntityCardToStore) : [];
    }

    async storeUpsertEntityCards(cards: StoreEntityCard[]): Promise<{ success: boolean; error?: string }> {
        await this.upsertEntityCards(cards);
        return { success: true };
    }

    async storeGetEntityCards(entityId: string): Promise<StoreEntityCard[]> {
        return this.getEntityCards(entityId);
    }

    async upsertFolderSchema(schema: StoreFolderSchema): Promise<void> {
        await this.ensureInitialized();
        await this.phoenix.storeCommand('folderSchema:upsert', {
            schema: folderSchemaToPhoenix(schema),
        });
        this.scheduleSnapshot();
    }

    async getFolderSchema(id: string): Promise<StoreFolderSchema | null> {
        await this.ensureInitialized();
        const payload = await this.phoenix.storeCommand('folderSchema:get', { id });
        return payload ? phoenixFolderSchemaToStore(payload) : null;
    }

    async storeUpsertFolderSchema(schema: StoreFolderSchema): Promise<{ success: boolean; error?: string }> {
        await this.upsertFolderSchema(schema);
        return { success: true };
    }

    async storeGetFolderSchema(id: string): Promise<StoreFolderSchema | null> {
        return this.getFolderSchema(id);
    }

    async saveNetworkView(view: {
        instance: StoreNetworkInstance;
        members: StoreNetworkMembership[];
        relationships: StoreNetworkRelationship[];
    }): Promise<void> {
        await this.ensureInitialized();
        await this.phoenix.storeCommand('networkView:save', {
            view: networkViewToPhoenix(view),
        });
        this.scheduleSnapshot();
    }

    async getNetworkView(id: string): Promise<{
        instance: StoreNetworkInstance;
        members: StoreNetworkMembership[];
        relationships: StoreNetworkRelationship[];
    } | null> {
        await this.ensureInitialized();
        const payload = await this.phoenix.storeCommand('networkView:get', { id });
        return payload ? phoenixNetworkViewToStore(payload) : null;
    }

    async listNetworkViews(): Promise<StoreNetworkInstance[]> {
        await this.ensureInitialized();
        const payload = await this.phoenix.storeCommand('networkView:list');
        return Array.isArray(payload) ? payload.map(phoenixNetworkInstanceToStore) : [];
    }

    async deleteNetworkView(id: string): Promise<void> {
        await this.ensureInitialized();
        await this.phoenix.storeCommand('networkView:delete', { id });
        this.scheduleSnapshot();
    }

    async storeUpsertNetworkInstance(instance: StoreNetworkInstance): Promise<{ success: boolean; error?: string }> {
        const current = (await this.getNetworkView(instance.id)) || {
            instance,
            members: instance.entityIds.map((entityId) => ({
                networkId: instance.id,
                entityId,
                x: 0,
                y: 0,
                fixed: false,
            })),
            relationships: [],
        };
        current.instance = instance;
        current.members = reconcileMembers(instance.id, current.members, instance.entityIds);
        await this.saveNetworkView(current);
        return { success: true };
    }

    async storeGetNetworkInstance(id: string): Promise<StoreNetworkInstance | null> {
        const view = await this.getNetworkView(id);
        return view?.instance || null;
    }

    async storeListNetworkInstances(): Promise<StoreNetworkInstance[]> {
        return this.listNetworkViews();
    }

    async storeDeleteNetworkInstance(id: string): Promise<{ success: boolean; error?: string }> {
        await this.deleteNetworkView(id);
        return { success: true };
    }

    async storeUpsertNetworkMembership(member: StoreNetworkMembership): Promise<{ success: boolean; error?: string }> {
        const view = (await this.getNetworkView(member.networkId)) || {
            instance: emptyNetworkInstance(member.networkId),
            members: [],
            relationships: [],
        };
        const others = view.members.filter((current) => current.entityId !== member.entityId);
        view.members = [...others, member];
        view.instance.entityIds = Array.from(new Set(view.members.map((current) => current.entityId)));
        await this.saveNetworkView(view);
        return { success: true };
    }

    async storeGetNetworkMembers(networkId: string): Promise<StoreNetworkMembership[]> {
        const view = await this.getNetworkView(networkId);
        return view?.members || [];
    }

    async storeDeleteNetworkMembership(networkId: string, entityId: string): Promise<{ success: boolean; error?: string }> {
        const view = await this.getNetworkView(networkId);
        if (!view) {
            return { success: true };
        }
        view.members = view.members.filter((member) => member.entityId !== entityId);
        view.relationships = view.relationships.filter(
            (relationship) =>
                relationship.sourceEntityId !== entityId && relationship.targetEntityId !== entityId,
        );
        view.instance.entityIds = Array.from(new Set(view.members.map((member) => member.entityId)));
        await this.saveNetworkView(view);
        return { success: true };
    }

    async storeUpsertNetworkRelationship(
        relationship: StoreNetworkRelationship,
    ): Promise<{ success: boolean; error?: string }> {
        const view = (await this.getNetworkView(relationship.networkId)) || {
            instance: emptyNetworkInstance(relationship.networkId),
            members: [],
            relationships: [],
        };
        const others = view.relationships.filter((current) => current.id !== relationship.id);
        view.relationships = [...others, relationship];
        await this.saveNetworkView(view);
        return { success: true };
    }

    async storeGetNetworkRelationships(networkId: string): Promise<StoreNetworkRelationship[]> {
        const view = await this.getNetworkView(networkId);
        return view?.relationships || [];
    }

    async storeDeleteNetworkRelationship(
        networkId: string,
        relationshipId: string,
    ): Promise<{ success: boolean; error?: string }> {
        const view = await this.getNetworkView(networkId);
        if (!view) {
            return { success: true };
        }
        view.relationships = view.relationships.filter((relationship) => relationship.id !== relationshipId);
        await this.saveNetworkView(view);
        return { success: true };
    }

    async exportDatabase(): Promise<Uint8Array> {
        await this.ensureInitialized();
        return this.phoenix.exportSnapshot();
    }

    async importDatabase(data: Uint8Array): Promise<void> {
        await this.ensureInitialized();
        await this.phoenix.importSnapshot(data);
    }

    async countNotes(): Promise<number> {
        const notes = await this.listNotes();
        return notes.length;
    }

    static fromDexieNote(dexieNote: any): StoreNote {
        return {
            id: dexieNote.id,
            worldId: dexieNote.worldId || '',
            title: dexieNote.title || '',
            content: typeof dexieNote.content === 'string' ? dexieNote.content : JSON.stringify(dexieNote.content || ''),
            markdownContent: dexieNote.markdownContent || '',
            folderId: dexieNote.folderId || '',
            entityKind: dexieNote.entityKind || '',
            entitySubtype: dexieNote.entitySubtype || '',
            isEntity: dexieNote.isEntity || false,
            isPinned: dexieNote.isPinned || false,
            favorite: dexieNote.favorite || false,
            ownerId: dexieNote.ownerId || '',
            narrativeId: dexieNote.narrativeId || '',
            order: dexieNote.order || 0,
            createdAt: dexieNote.createdAt || Date.now(),
            updatedAt: dexieNote.updatedAt || Date.now(),
            version: dexieNote.version,
        };
    }

    static fromDexieEntity(dexieEntity: any): StoreEntity {
        return {
            id: dexieEntity.id,
            label: dexieEntity.label || '',
            kind: dexieEntity.kind || 'UNKNOWN',
            subtype: dexieEntity.subtype,
            aliases: dexieEntity.aliases || [],
            firstNote: dexieEntity.firstNote || '',
            totalMentions: dexieEntity.totalMentions || 0,
            narrativeId: dexieEntity.narrativeId,
            createdBy: dexieEntity.createdBy || 'user',
            createdAt: dexieEntity.createdAt || Date.now(),
            updatedAt: dexieEntity.updatedAt || Date.now(),
        };
    }

    static fromDexieEdge(dexieEdge: any): StoreEdge {
        return {
            id: dexieEdge.id,
            sourceId: dexieEdge.sourceId,
            targetId: dexieEdge.targetId,
            relType: dexieEdge.relType || 'RELATED_TO',
            confidence: dexieEdge.confidence ?? 1.0,
            bidirectional: dexieEdge.bidirectional || false,
            sourceNote: dexieEdge.sourceNote,
            createdAt: dexieEdge.createdAt || Date.now(),
        };
    }

    static fromDexieFolder(dexieFolder: any): StoreFolder {
        return {
            id: dexieFolder.id,
            name: dexieFolder.name || '',
            parentId: dexieFolder.parentId,
            worldId: dexieFolder.worldId || '',
            narrativeId: dexieFolder.narrativeId,
            folderOrder: dexieFolder.folderOrder ?? dexieFolder.order ?? 0,
            entityKind: dexieFolder.entityKind || '',
            entitySubtype: dexieFolder.entitySubtype || '',
            entityLabel: dexieFolder.entityLabel || '',
            color: dexieFolder.color || '',
            isTypedRoot: dexieFolder.isTypedRoot || false,
            isSubtypeRoot: dexieFolder.isSubtypeRoot || false,
            collapsed: dexieFolder.collapsed || false,
            ownerId: dexieFolder.ownerId || '',
            isNarrativeRoot: dexieFolder.isNarrativeRoot || false,
            attributes: dexieFolder.attributes
                ? typeof dexieFolder.attributes === 'string'
                    ? dexieFolder.attributes
                    : JSON.stringify(dexieFolder.attributes)
                : undefined,
            createdAt: dexieFolder.createdAt || Date.now(),
            updatedAt: dexieFolder.updatedAt || Date.now(),
        };
    }

    private async initializeInternal(): Promise<void> {
        const startedAt = Date.now();
        console.log('[PhoenixStoreService] initialize:start');
        console.log('[PhoenixStoreService] initialize:wasm.load:start');
        await this.phoenix.loadWasm();
        console.log(`[PhoenixStoreService] initialize:wasm.load:complete (${Date.now() - startedAt}ms)`);
        console.log('[PhoenixStoreService] initialize:initRuntime:start');
        await this.phoenix.initRuntime(false);
        console.log(`[PhoenixStoreService] initialize:initRuntime:complete (${Date.now() - startedAt}ms)`);

        console.log('[PhoenixStoreService] initialize:persistence.load:start');
        const { snapshot } = await this.persistence.load();
        console.log(
            `[PhoenixStoreService] initialize:persistence.load:complete (${Date.now() - startedAt}ms, snapshot=${snapshot?.byteLength || 0} bytes)`,
        );
        if (snapshot && snapshot.byteLength > 0) {
            try {
                console.log('[PhoenixStoreService] initialize:snapshot.import:start');
                await this.phoenix.importSnapshot(snapshot);
                console.log(`[PhoenixStoreService] initialize:snapshot.import:complete (${Date.now() - startedAt}ms)`);
            } catch (error) {
                console.error('[PhoenixStoreService] Snapshot import failed, resetting Phoenix runtime.', error);
                await this.phoenix.initRuntime(true);
                await this.persistence.clear();
            }
        }

        this.initialized = true;
        console.log(`[PhoenixStoreService] initialize:complete (${Date.now() - startedAt}ms)`);
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    private scheduleSnapshot(): void {
        if (this.snapshotsPaused) return;

        if (this.snapshotTimeout) {
            clearTimeout(this.snapshotTimeout);
        }

        this.snapshotTimeout = setTimeout(() => {
            void this.triggerSnapshot().catch((error) => {
                console.error('[PhoenixStoreService] Failed to persist Phoenix snapshot:', error);
            });
        }, 1500);
    }

    private async relationUpsert(relation: string, row: Record<string, unknown>): Promise<void> {
        await this.phoenix.storeCommand('relation:upsert', { relation, row });
    }

    private async relationGetFirst<T>(relation: string, filter: Record<string, unknown>): Promise<T | null> {
        const payload = await this.phoenix.storeCommand('relation:getFirst', { relation, filter });
        return (payload as T | null) || null;
    }

    private async relationList<T>(relation: string, filter?: Record<string, unknown>): Promise<T[]> {
        const payload = await this.phoenix.storeCommand('relation:list', {
            relation,
            ...(filter ? { filter } : {}),
        });
        return Array.isArray(payload) ? (payload as T[]) : [];
    }

    private async relationDelete(relation: string, filter: Record<string, unknown>): Promise<void> {
        await this.phoenix.storeCommand('relation:delete', { relation, filter });
    }
}

function noteToRow(note: StoreNote): Record<string, unknown> {
    const version = note.version ?? note.updatedAt ?? Date.now();
    const validFrom = note.createdAt || note.updatedAt || Date.now();
    return {
        id: note.id,
        version,
        world_id: note.worldId || '',
        title: note.title || '',
        content: note.content || '',
        markdown_content: note.markdownContent || '',
        folder_id: note.folderId || null,
        entity_kind: note.entityKind || null,
        entity_subtype: note.entitySubtype || null,
        is_entity: note.isEntity || false,
        is_pinned: note.isPinned || false,
        favorite: note.favorite || false,
        owner_id: note.ownerId || null,
        narrative_id: note.narrativeId || null,
        order: Number(note.order || 0),
        created_at: note.createdAt || Date.now(),
        updated_at: note.updatedAt || Date.now(),
        valid_from: validFrom,
        valid_to: null,
        is_current: true,
        change_reason: null,
    };
}

function rowToNote(row: any): StoreNote {
    return {
        id: String(row.id || ''),
        worldId: String(row.world_id || ''),
        title: String(row.title || ''),
        content: String(row.content || ''),
        markdownContent: String(row.markdown_content || ''),
        folderId: String(row.folder_id || ''),
        entityKind: String(row.entity_kind || ''),
        entitySubtype: String(row.entity_subtype || ''),
        isEntity: !!row.is_entity,
        isPinned: !!row.is_pinned,
        favorite: !!row.favorite,
        ownerId: String(row.owner_id || ''),
        narrativeId: String(row.narrative_id || ''),
        order: Number(row.order || 0),
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
        version: Number(row.version || 0),
    };
}

function entityToRow(entity: StoreEntity): Record<string, unknown> {
    return {
        id: entity.id,
        label: entity.label,
        kind: entity.kind,
        subtype: entity.subtype || null,
        aliases: entity.aliases || [],
        first_note: entity.firstNote || null,
        total_mentions: entity.totalMentions || 0,
        narrative_id: entity.narrativeId || null,
        created_by: entity.createdBy || 'user',
        created_at: entity.createdAt || Date.now(),
        updated_at: entity.updatedAt || Date.now(),
    };
}

function rowToEntity(row: any): StoreEntity {
    return {
        id: String(row.id || ''),
        label: String(row.label || ''),
        kind: String(row.kind || 'UNKNOWN'),
        subtype: row.subtype ? String(row.subtype) : undefined,
        aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
        firstNote: String(row.first_note || ''),
        totalMentions: Number(row.total_mentions || 0),
        narrativeId: row.narrative_id ? String(row.narrative_id) : undefined,
        createdBy: (row.created_by || 'user') as 'user' | 'extraction' | 'auto',
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
    };
}

function edgeToRow(edge: StoreEdge): Record<string, unknown> {
    return {
        id: edge.id,
        source_id: edge.sourceId,
        target_id: edge.targetId,
        rel_type: edge.relType,
        confidence: edge.confidence ?? 1,
        bidirectional: edge.bidirectional || false,
        source_note: edge.sourceNote || null,
        created_at: edge.createdAt || Date.now(),
    };
}

function rowToEdge(row: any): StoreEdge {
    return {
        id: String(row.id || ''),
        sourceId: String(row.source_id || ''),
        targetId: String(row.target_id || ''),
        relType: String(row.rel_type || ''),
        confidence: Number(row.confidence || 0),
        bidirectional: !!row.bidirectional,
        sourceNote: row.source_note ? String(row.source_note) : undefined,
        createdAt: Number(row.created_at || 0),
    };
}

function folderToRow(folder: StoreFolder): Record<string, unknown> {
    return {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parentId || null,
        world_id: folder.worldId || '',
        narrative_id: folder.narrativeId || null,
        folder_order: Number(folder.folderOrder || 0),
        entity_kind: folder.entityKind || null,
        entity_subtype: folder.entitySubtype || null,
        entity_label: folder.entityLabel || null,
        color: folder.color || null,
        is_typed_root: folder.isTypedRoot || false,
        is_subtype_root: folder.isSubtypeRoot || false,
        collapsed: folder.collapsed || false,
        owner_id: folder.ownerId || null,
        is_narrative_root: folder.isNarrativeRoot || false,
        attributes: parseJsonString(folder.attributes),
        created_at: folder.createdAt || Date.now(),
        updated_at: folder.updatedAt || Date.now(),
    };
}

function rowToFolder(row: any): StoreFolder {
    return {
        id: String(row.id || ''),
        name: String(row.name || ''),
        parentId: row.parent_id ? String(row.parent_id) : undefined,
        worldId: String(row.world_id || ''),
        narrativeId: row.narrative_id ? String(row.narrative_id) : undefined,
        folderOrder: Number(row.folder_order || 0),
        entityKind: String(row.entity_kind || ''),
        entitySubtype: String(row.entity_subtype || ''),
        entityLabel: String(row.entity_label || ''),
        color: String(row.color || ''),
        isTypedRoot: !!row.is_typed_root,
        isSubtypeRoot: !!row.is_subtype_root,
        collapsed: !!row.collapsed,
        ownerId: String(row.owner_id || ''),
        isNarrativeRoot: !!row.is_narrative_root,
        attributes: serializeJsonField(row.attributes),
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
    };
}

function scopedDocumentToRow(document: StoreScopedDocument): Record<string, unknown> {
    return {
        id: document.id,
        scope_folder_id: document.scopeFolderId,
        narrative_id: document.narrativeId,
        namespace: document.namespace,
        document_key: document.documentKey,
        payload: parseJsonString(document.payload),
        seeded_from_scope_folder_id: document.seededFromScopeFolderId || null,
        created_at: document.createdAt,
        updated_at: document.updatedAt,
    };
}

function rowToScopedDocument(row: any): StoreScopedDocument {
    return {
        id: String(row.id || ''),
        scopeFolderId: String(row.scope_folder_id || ''),
        narrativeId: String(row.narrative_id || ''),
        namespace: String(row.namespace || ''),
        documentKey: String(row.document_key || ''),
        payload: serializeJsonField(row.payload),
        seededFromScopeFolderId: row.seeded_from_scope_folder_id
            ? String(row.seeded_from_scope_folder_id)
            : undefined,
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
    };
}

function scopedEntityFieldToRow(field: StoreScopedEntityField): Record<string, unknown> {
    return {
        id: field.id,
        entity_id: field.entityId,
        scope_folder_id: field.scopeFolderId,
        narrative_id: field.narrativeId,
        field_key: field.fieldKey,
        value_json: parseJsonString(field.valueJson),
        seeded_from_scope_folder_id: field.seededFromScopeFolderId || null,
        created_at: field.createdAt,
        updated_at: field.updatedAt,
    };
}

function rowToScopedEntityField(row: any): StoreScopedEntityField {
    return {
        id: String(row.id || ''),
        entityId: String(row.entity_id || ''),
        scopeFolderId: String(row.scope_folder_id || ''),
        narrativeId: String(row.narrative_id || ''),
        fieldKey: String(row.field_key || ''),
        valueJson: serializeJsonField(row.value_json),
        seededFromScopeFolderId: row.seeded_from_scope_folder_id
            ? String(row.seeded_from_scope_folder_id)
            : undefined,
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
    };
}

function scopedDefinitionToRow(definition: StoreScopedDefinition): Record<string, unknown> {
    return {
        id: definition.id,
        narrative_id: definition.narrativeId,
        namespace: definition.namespace,
        definition_key: definition.definitionKey,
        payload: parseJsonString(definition.payload),
        created_at: definition.createdAt,
        updated_at: definition.updatedAt,
    };
}

function rowToScopedDefinition(row: any): StoreScopedDefinition {
    return {
        id: String(row.id || ''),
        narrativeId: String(row.narrative_id || ''),
        namespace: String(row.namespace || ''),
        definitionKey: String(row.definition_key || ''),
        payload: serializeJsonField(row.payload),
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
    };
}

function parseJsonString(value?: string): unknown {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function serializeJsonField(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (value === null || value === undefined) {
        return '';
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function entityCardToPhoenix(card: StoreEntityCard): Record<string, unknown> {
    return {
        entityId: card.entityId,
        cardId: card.cardId,
        name: card.name,
        color: card.color,
        icon: card.icon,
        displayOrder: card.displayOrder,
        isCollapsed: card.isCollapsed,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
    };
}

function phoenixEntityCardToStore(card: any): StoreEntityCard {
    return {
        entityId: String(card?.entityId || ''),
        cardId: String(card?.cardId || ''),
        name: String(card?.name || ''),
        color: String(card?.color || ''),
        icon: String(card?.icon || ''),
        displayOrder: Number(card?.displayOrder || 0),
        isCollapsed: !!card?.isCollapsed,
        createdAt: Number(card?.createdAt || 0),
        updatedAt: Number(card?.updatedAt || 0),
    };
}

function folderSchemaToPhoenix(schema: StoreFolderSchema): Record<string, unknown> {
    return {
        id: schema.id,
        entityKind: schema.entityKind,
        subtype: schema.subtype || '',
        name: schema.name,
        description: schema.description || '',
        allowedSubfolders: JSON.stringify(schema.allowedSubfolders || []),
        allowedNoteTypes: JSON.stringify(schema.allowedNoteTypes || []),
        isVaultRoot: schema.isVaultRoot,
        containerOnly: schema.containerOnly,
        propagateKindToChildren: schema.propagateKindToChildren,
        icon: schema.icon || '',
        isSystem: schema.isSystem,
        createdAt: schema.createdAt,
        updatedAt: schema.updatedAt,
    };
}

function phoenixFolderSchemaToStore(schema: any): StoreFolderSchema {
    return {
        id: String(schema?.id || ''),
        entityKind: String(schema?.entityKind || ''),
        subtype: schema?.subtype ? String(schema.subtype) : undefined,
        name: String(schema?.name || ''),
        description: schema?.description ? String(schema.description) : undefined,
        allowedSubfolders: parseJsonString(String(schema?.allowedSubfolders || '[]')) as unknown[],
        allowedNoteTypes: parseJsonString(String(schema?.allowedNoteTypes || '[]')) as unknown[],
        isVaultRoot: !!schema?.isVaultRoot,
        containerOnly: !!schema?.containerOnly,
        propagateKindToChildren: !!schema?.propagateKindToChildren,
        icon: schema?.icon ? String(schema.icon) : undefined,
        isSystem: !!schema?.isSystem,
        createdAt: Number(schema?.createdAt || 0),
        updatedAt: Number(schema?.updatedAt || 0),
    };
}

function networkViewToPhoenix(view: {
    instance: StoreNetworkInstance;
    members: StoreNetworkMembership[];
    relationships: StoreNetworkRelationship[];
}): Record<string, unknown> {
    const memberCount = view.members.length || view.instance.entityIds.length;
    return {
        instance: {
            id: view.instance.id,
            name: view.instance.name,
            schemaId: view.instance.schemaId,
            networkKind: 'saved_view',
            networkSubtype: '',
            rootFolderId: view.instance.rootFolderId,
            rootEntityId: view.instance.rootEntityId || '',
            namespace: 'ui.network',
            description: view.instance.description || '',
            tags: [],
            memberCount,
            relationshipCount: view.relationships.length,
            maxDepth: 0,
            createdAt: view.instance.createdAt,
            updatedAt: view.instance.updatedAt,
            groupId: '',
            scopeType: 'folder',
            narrativeId: view.instance.narrativeId,
        },
        members: view.members.map((member) => ({
            networkId: member.networkId,
            entityId: member.entityId,
            x: member.x,
            y: member.y,
            fixed: member.fixed,
        })),
        relationships: view.relationships.map((relationship) => ({
            networkId: relationship.networkId,
            sourceEntityId: relationship.sourceEntityId,
            targetEntityId: relationship.targetEntityId,
            relationshipId: relationship.id,
        })),
    };
}

function phoenixNetworkViewToStore(view: any): {
    instance: StoreNetworkInstance;
    members: StoreNetworkMembership[];
    relationships: StoreNetworkRelationship[];
} {
    return {
        instance: phoenixNetworkInstanceToStore(view?.instance),
        members: Array.isArray(view?.members) ? view.members.map(phoenixNetworkMembershipToStore) : [],
        relationships: Array.isArray(view?.relationships)
            ? view.relationships.map(phoenixNetworkRelationshipToStore)
            : [],
    };
}

function phoenixNetworkInstanceToStore(instance: any): StoreNetworkInstance {
    return {
        id: String(instance?.id || ''),
        schemaId: String(instance?.schemaId || ''),
        name: String(instance?.name || ''),
        rootFolderId: String(instance?.rootFolderId || ''),
        rootEntityId: instance?.rootEntityId ? String(instance.rootEntityId) : undefined,
        entityIds: [],
        narrativeId: String(instance?.narrativeId || ''),
        description: instance?.description ? String(instance.description) : undefined,
        createdAt: Number(instance?.createdAt || 0),
        updatedAt: Number(instance?.updatedAt || 0),
    };
}

function phoenixNetworkMembershipToStore(member: any): StoreNetworkMembership {
    return {
        networkId: String(member?.networkId || ''),
        entityId: String(member?.entityId || ''),
        x: Number(member?.x || 0),
        y: Number(member?.y || 0),
        fixed: !!member?.fixed,
    };
}

function phoenixNetworkRelationshipToStore(relationship: any): StoreNetworkRelationship {
    return {
        id: String(relationship?.relationshipId || relationship?.id || ''),
        networkId: String(relationship?.networkId || ''),
        sourceEntityId: String(relationship?.sourceEntityId || ''),
        targetEntityId: String(relationship?.targetEntityId || ''),
        relationshipCode: String(relationship?.relationshipCode || relationship?.relationshipId || ''),
        strength: undefined,
        startDate: undefined,
        endDate: undefined,
        notes: undefined,
        createdAt: 0,
        updatedAt: 0,
    };
}

function emptyNetworkInstance(networkId: string): StoreNetworkInstance {
    const now = Date.now();
    return {
        id: networkId,
        schemaId: '',
        name: networkId,
        rootFolderId: '',
        rootEntityId: undefined,
        entityIds: [],
        narrativeId: '',
        description: '',
        createdAt: now,
        updatedAt: now,
    };
}

function reconcileMembers(
    networkId: string,
    currentMembers: StoreNetworkMembership[],
    entityIds: string[],
): StoreNetworkMembership[] {
    const existing = new Map(currentMembers.map((member) => [member.entityId, member]));
    return entityIds.map((entityId) => {
        const member = existing.get(entityId);
        if (member) {
            return member;
        }
        return {
            networkId,
            entityId,
            x: 0,
            y: 0,
            fixed: false,
        };
    });
}
