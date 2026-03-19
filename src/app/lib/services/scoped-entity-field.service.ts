import { Injectable, inject } from '@angular/core';
import { GoKittStoreService } from '../../services/gokitt-store.service';

@Injectable({
    providedIn: 'root'
})
export class ScopedEntityFieldService {
    private store = inject(GoKittStoreService);

    async getMergedFields(entityId: string, scopeFolderIds: string[]): Promise<Record<string, any>> {
        const result: Record<string, any> = {};

        if (!(await this.ensureStoreReady())) {
            return result;
        }

        for (const scopeFolderId of [...new Set(scopeFolderIds.filter(Boolean))]) {
            if (scopeFolderId === 'vault:global') continue;
            const rows = await this.store.listScopedEntityFields(scopeFolderId, entityId);
            for (const row of rows) {
                result[row.fieldKey] = this.parseValue(row.valueJson);
            }
        }

        return result;
    }

    async setField(
        entityId: string,
        scopeFolderId: string,
        narrativeId: string,
        fieldKey: string,
        value: any,
        seededFromScopeFolderId?: string
    ): Promise<void> {
        if (!entityId || !scopeFolderId || !narrativeId || scopeFolderId === 'vault:global') {
            return;
        }

        if (!(await this.ensureStoreReady())) {
            return;
        }

        const now = Date.now();
        const existing = await this.store.getScopedEntityField(entityId, scopeFolderId, fieldKey);

        await this.store.upsertScopedEntityField({
            id: existing?.id || crypto.randomUUID(),
            entityId,
            scopeFolderId,
            narrativeId,
            fieldKey,
            valueJson: JSON.stringify(value),
            seededFromScopeFolderId: seededFromScopeFolderId || existing?.seededFromScopeFolderId,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        });
    }

    async cloneScopeFields(
        sourceScopeFolderId: string,
        targetScopeFolderId: string,
        narrativeId: string,
        seededFromScopeFolderId: string,
        entityIds?: string[]
    ): Promise<void> {
        if (!sourceScopeFolderId || !targetScopeFolderId || sourceScopeFolderId === targetScopeFolderId) {
            return;
        }

        if (!(await this.ensureStoreReady())) {
            return;
        }

        const rows = await this.store.listScopedEntityFields(sourceScopeFolderId);
        for (const row of rows) {
            if (entityIds?.length && !entityIds.includes(row.entityId)) {
                continue;
            }

            await this.store.upsertScopedEntityField({
                id: crypto.randomUUID(),
                entityId: row.entityId,
                scopeFolderId: targetScopeFolderId,
                narrativeId,
                fieldKey: row.fieldKey,
                valueJson: row.valueJson,
                seededFromScopeFolderId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }
    }

    async getDefinitionPayload<T>(
        narrativeId: string,
        namespace: string,
        definitionKey: string,
        defaultValue: T,
        fallback?: () => Promise<T | undefined>
    ): Promise<T> {
        if (!narrativeId) {
            return this.clone(defaultValue);
        }

        if (!(await this.ensureStoreReady())) {
            return fallback ? this.clone((await fallback()) ?? defaultValue) : this.clone(defaultValue);
        }

        const existing = await this.store.getScopedDefinition(narrativeId, namespace, definitionKey);
        if (existing?.payload) {
            return this.parsePayload(existing.payload, defaultValue);
        }

        const migrated = fallback ? await fallback() : undefined;
        if (migrated !== undefined) {
            await this.saveDefinitionPayload(narrativeId, namespace, definitionKey, migrated);
            return this.clone(migrated);
        }

        return this.clone(defaultValue);
    }

    async listDefinitionPayloads<T>(narrativeId: string, namespace: string, defaultValue: T): Promise<Array<{ definitionKey: string; payload: T }>> {
        if (!narrativeId) {
            return [];
        }

        if (!(await this.ensureStoreReady())) {
            return [];
        }

        const rows = await this.store.listScopedDefinitions(narrativeId, namespace);
        return rows.map(row => ({
            definitionKey: row.definitionKey,
            payload: this.parsePayload(row.payload, defaultValue),
        }));
    }

    async saveDefinitionPayload<T>(narrativeId: string, namespace: string, definitionKey: string, payload: T): Promise<void> {
        if (!narrativeId) {
            return;
        }

        if (!(await this.ensureStoreReady())) {
            return;
        }

        const now = Date.now();
        const existing = await this.store.getScopedDefinition(narrativeId, namespace, definitionKey);

        await this.store.upsertScopedDefinition({
            id: existing?.id || crypto.randomUUID(),
            narrativeId,
            namespace,
            definitionKey,
            payload: JSON.stringify(payload),
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        });
    }

    private parseValue(value: string): any {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    private parsePayload<T>(payload: string, defaultValue: T): T {
        try {
            return JSON.parse(payload) as T;
        } catch {
            return this.clone(defaultValue);
        }
    }

    private clone<T>(value: T): T {
        return JSON.parse(JSON.stringify(value));
    }

    private async ensureStoreReady(): Promise<boolean> {
        if (this.store.isReady) return true;
        return this.store.tryInitialize();
    }
}
