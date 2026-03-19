import { Injectable, inject } from '@angular/core';
import { GoKittStoreService } from '../../services/gokitt-store.service';

@Injectable({
    providedIn: 'root'
})
export class ScopedDocumentService {
    private store = inject(GoKittStoreService);

    async getPayload<T>(
        scopeFolderId: string,
        narrativeId: string,
        namespace: string,
        documentKey: string,
        defaultValue: T,
        fallback?: () => Promise<T | undefined>
    ): Promise<T> {
        if (!scopeFolderId || !narrativeId || scopeFolderId === 'vault:global') {
            return this.clone(defaultValue);
        }

        const existing = await this.safeGetScopedDocument(scopeFolderId, namespace, documentKey);
        if (existing?.payload) {
            return this.parsePayload(existing.payload, defaultValue);
        }

        const migrated = fallback ? await fallback() : undefined;
        if (migrated !== undefined) {
            await this.savePayload(scopeFolderId, narrativeId, namespace, documentKey, migrated);
            return this.clone(migrated);
        }

        return this.clone(defaultValue);
    }

    async findPayload<T>(
        scopeFolderId: string,
        namespace: string,
        documentKey: string,
        defaultValue: T
    ): Promise<T | null> {
        if (!scopeFolderId || scopeFolderId === 'vault:global') {
            return null;
        }

        const existing = await this.safeGetScopedDocument(scopeFolderId, namespace, documentKey);
        if (!existing?.payload) {
            return null;
        }

        return this.parsePayload(existing.payload, defaultValue);
    }

    async savePayload<T>(
        scopeFolderId: string,
        narrativeId: string,
        namespace: string,
        documentKey: string,
        payload: T,
        seededFromScopeFolderId?: string
    ): Promise<void> {
        if (!scopeFolderId || !narrativeId || scopeFolderId === 'vault:global') {
            return;
        }

        if (!(await this.ensureStoreReady())) {
            return;
        }

        const now = Date.now();
        const existing = await this.store.getScopedDocument(scopeFolderId, namespace, documentKey);

        await this.store.upsertScopedDocument({
            id: existing?.id || crypto.randomUUID(),
            scopeFolderId,
            narrativeId,
            namespace,
            documentKey,
            payload: JSON.stringify(payload),
            seededFromScopeFolderId: seededFromScopeFolderId || existing?.seededFromScopeFolderId,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        });
    }

    async deleteDocument(scopeFolderId: string, namespace: string, documentKey: string): Promise<void> {
        if (!scopeFolderId || scopeFolderId === 'vault:global') {
            return;
        }
        if (!(await this.ensureStoreReady())) {
            return;
        }
        await this.store.deleteScopedDocument(scopeFolderId, namespace, documentKey);
    }

    async listPayloads<T>(scopeFolderId: string, namespace?: string, defaultValue?: T): Promise<Array<{ documentKey: string; payload: T }>> {
        if (!scopeFolderId || scopeFolderId === 'vault:global') {
            return [];
        }

        if (!(await this.ensureStoreReady())) {
            return [];
        }

        const rows = await this.store.listScopedDocuments(scopeFolderId, namespace);
        return rows.map(row => ({
            documentKey: row.documentKey,
            payload: this.parsePayload(row.payload, defaultValue as T),
        }));
    }

    async cloneScopeDocuments(
        sourceScopeFolderId: string,
        targetScopeFolderId: string,
        narrativeId: string,
        seededFromScopeFolderId: string,
        namespaces?: string[]
    ): Promise<void> {
        if (!sourceScopeFolderId || !targetScopeFolderId || sourceScopeFolderId === targetScopeFolderId) {
            return;
        }

        if (!(await this.ensureStoreReady())) {
            return;
        }

        const rows = await this.store.listScopedDocuments(sourceScopeFolderId);
        for (const row of rows) {
            if (namespaces?.length && !namespaces.includes(row.namespace)) {
                continue;
            }

            await this.store.upsertScopedDocument({
                id: crypto.randomUUID(),
                scopeFolderId: targetScopeFolderId,
                narrativeId,
                namespace: row.namespace,
                documentKey: row.documentKey,
                payload: row.payload,
                seededFromScopeFolderId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
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

    private async safeGetScopedDocument(scopeFolderId: string, namespace: string, documentKey: string) {
        if (!(await this.ensureStoreReady())) {
            return null;
        }

        return this.store.getScopedDocument(scopeFolderId, namespace, documentKey);
    }
}
