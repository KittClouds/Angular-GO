import { Database, Plugin, Query, UpdateOperation, Document } from '../nebula-db/packages/core/src/angular-exports';

export interface VersioningOptions {
    versionField?: string;
    timestampField?: string;
    historyCollectionSuffix?: string;
    maxVersions?: number;
    collections?: string[];
}

export class VersioningPlugin implements Plugin {
    name = 'versioning';
    private db: Database | null = null;
    private options: Required<VersioningOptions>;

    constructor(options: VersioningOptions = {}) {
        this.options = {
            versionField: options.versionField || '_version',
            timestampField: options.timestampField || '_updatedAt',
            historyCollectionSuffix: options.historyCollectionSuffix || '_history',
            maxVersions: options.maxVersions ?? 10,
            collections: options.collections || []
        };
    }

    onInit(db: Database): void {
        this.db = db;
    }

    private shouldVersion(collection: string): boolean {
        if (collection.endsWith(this.options.historyCollectionSuffix)) return false;
        if (this.options.collections.length > 0 && !this.options.collections.includes(collection)) return false;
        return true;
    }

    async onBeforeInsert(collection: string, doc: Document): Promise<Document> {
        if (!this.shouldVersion(collection)) return doc;

        return {
            ...doc,
            [this.options.versionField]: 1,
            [this.options.timestampField]: Date.now()
        };
    }

    async onBeforeUpdate(collectionName: string, query: Query, update: UpdateOperation): Promise<[Query, UpdateOperation]> {
        if (!this.db || !this.shouldVersion(collectionName)) return [query, update];

        try {
            // 1. Snapshot current state
            const collection = this.db.collection(collectionName);

            // Need to find which documents will be updated
            // WARNING: This doubles the read cost of every update.
            const docsToUpdate = await collection.find(query);

            if (docsToUpdate.length > 0) {
                const historyColName = `${collectionName}${this.options.historyCollectionSuffix}`;
                const historyCol = this.db.collection(historyColName);

                for (const doc of docsToUpdate) {
                    // Create history entry
                    const historyEntry: any = {
                        ...doc,
                        _originalId: doc.id,
                        _archivedAt: Date.now()
                    };

                    // Remove the actual id so the history collection generates a new unique ID
                    delete historyEntry.id;

                    // Insert into history (auto-generates new ID)
                    await historyCol.insert(historyEntry);

                    // Prune old versions asynchronously to not block the main update too much
                    this.pruneHistory(historyCol, doc.id).catch(err => {
                        console.error('[VersioningPlugin] Pruning failed:', err);
                    });
                }
            }

            // 2. Inject version increment into the update operation
            const newUpdate = { ...update };

            if (!newUpdate.$inc) newUpdate.$inc = {};
            newUpdate.$inc[this.options.versionField] = 1;

            if (!newUpdate.$set) newUpdate.$set = {};
            newUpdate.$set[this.options.timestampField] = Date.now();

            return [query, newUpdate];

        } catch (err) {
            console.error('[VersioningPlugin] Error processing update:', err);
            // Configure to fail safe: return original update if versioning logic bumps
            return [query, update];
        }
    }

    private async pruneHistory(historyCol: any, originalId: string) {
        if (this.options.maxVersions <= 0) return;

        const history = await historyCol.find({ _originalId: originalId });
        if (history.length > this.options.maxVersions) {
            // Sort by archivedAt descending (newest first)
            history.sort((a: any, b: any) => b._archivedAt - a._archivedAt);

            // Keep top N, delete the rest
            const toDelete = history.slice(this.options.maxVersions);
            for (const delDoc of toDelete) {
                if (delDoc.id) {
                    await historyCol.delete({ id: delDoc.id });
                }
            }
        }
    }
}

export function createVersioningPlugin(options: VersioningOptions = {}): Plugin {
    return new VersioningPlugin(options);
}
