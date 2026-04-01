import { Injectable, isDevMode } from '@angular/core';

import type {
    PhoenixPersistenceClearResult,
    PhoenixPersistenceDebugState,
    LoadedPhoenixManifestState,
    PersistenceManifest,
    PhoenixPersistenceSizeSummary,
    PhoenixCheckpointPartition,
    PhoenixCheckpointWriteResult,
    PhoenixWalAppendResult,
    PhoenixWalBatch,
} from './phoenix-wal';

interface PendingRequest {
    resolve: (value?: any) => void;
    reject: (error: any) => void;
}

@Injectable({ providedIn: 'root' })
export class SqlitePersistenceService {
    private worker: Worker | null = null;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();

    constructor() {
        if (typeof window !== 'undefined') {
            (window as any).kittClearOPFS = async () => {
                const result = await this.clear();
                console.log(
                    '%c[DEV] OPFS cleared. Hard refresh now.',
                    'color: red; font-size: 16px; font-weight: bold;',
                );
                console.dir(result);
                return result;
            };

            (window as any).kittFactoryReset = async () => {
                console.warn(
                    '%c[DEV] Factory Reset...',
                    'color: red; font-size: 18px; font-weight: bold;',
                );
                try {
                    const result = await this.clear();
                    console.log(
                        '%c[DEV] Factory Reset complete. Reloading...',
                        'color: lime; font-size: 16px; font-weight: bold;',
                    );
                    console.dir(result);
                    setTimeout(() => window.location.reload(), 500);
                    return result;
                } catch (error) {
                    console.error('[DEV] Factory Reset failed:', error);
                    throw error;
                }
            };

            (window as any).kittPhoenixPersistenceSizes = async () => {
                const sizes = await this.inspectPhoenixPersistence();
                console.table(sizes);
                return sizes;
            };

            (window as any).kittPhoenixPersistenceDebug = async () => {
                const state = await this.inspectPhoenixPersistenceDebug();
                console.dir(state);
                return state;
            };

            if (isDevMode()) {
                console.info(
                    '[DEV] Phoenix OPFS tools: window.kittPhoenixPersistenceDebug(), window.kittPhoenixPersistenceSizes(), window.kittClearOPFS(), window.kittFactoryReset()',
                );
            }
        }
    }

    async init(): Promise<void> {
        if (this.worker) {
            return;
        }

        this.worker = new Worker(new URL('./sqlite-opfs.worker.ts', import.meta.url), {
            type: 'module',
            name: 'phoenix-opfs',
        });
        this.worker.onmessage = (event) => this.handleMessage(event.data);
        this.worker.onerror = (event) => console.error('[SqlitePersistence] Worker error:', event);
    }

    async load(): Promise<{ snapshot: Uint8Array | null }> {
        await this.init();
        const result = await this.send<{ snapshot: Uint8Array | null }>('LOAD');
        return { snapshot: result.snapshot };
    }

    async saveSnapshot(data: Uint8Array): Promise<void> {
        await this.init();
        await this.send('SAVE_SNAPSHOT', data, [data.buffer]);
    }

    async loadManifest(): Promise<LoadedPhoenixManifestState> {
        await this.init();
        return this.send<LoadedPhoenixManifestState>('LOAD_PHOENIX_MANIFEST');
    }

    async loadManifestMeta(): Promise<LoadedPhoenixManifestState> {
        return this.loadManifest();
    }

    async readCheckpointFile(file: string): Promise<Uint8Array | null> {
        await this.init();
        return this.send<Uint8Array | null>('READ_PHOENIX_FILE', { file });
    }

    async readWalSegment(file: string): Promise<Uint8Array | null> {
        await this.init();
        return this.send<Uint8Array | null>('READ_PHOENIX_FILE', { file });
    }

    async inspectPhoenixPersistence(): Promise<PhoenixPersistenceSizeSummary> {
        await this.init();
        return this.send<PhoenixPersistenceSizeSummary>('INSPECT_PHOENIX_PERSISTENCE');
    }

    async inspectPhoenixPersistenceDebug(): Promise<PhoenixPersistenceDebugState> {
        await this.init();
        return this.send<PhoenixPersistenceDebugState>('INSPECT_PHOENIX_PERSISTENCE_DEBUG');
    }

    async appendWalBatch(batch: PhoenixWalBatch): Promise<PhoenixWalAppendResult> {
        await this.init();
        return this.send<PhoenixWalAppendResult>('APPEND_PHOENIX_WAL_BATCH', batch);
    }

    async commitManifest(nextManifest: PersistenceManifest): Promise<void> {
        await this.init();
        await this.send('COMMIT_PHOENIX_MANIFEST', nextManifest);
    }

    async writeCheckpoint(
        partition: PhoenixCheckpointPartition,
        generation: number,
        bytes: Uint8Array,
    ): Promise<PhoenixCheckpointWriteResult> {
        await this.init();
        return this.send<PhoenixCheckpointWriteResult>(
            'WRITE_PHOENIX_CHECKPOINT',
            {
                partition,
                generation,
                bytes,
            },
            [bytes.buffer],
        );
    }

    async pruneFiles(files: string[]): Promise<void> {
        await this.init();
        await this.send('PRUNE_PHOENIX_FILES', { files });
    }

    async clear(): Promise<PhoenixPersistenceClearResult> {
        await this.init();
        return this.send<PhoenixPersistenceClearResult>('CLEAR_ALL');
    }

    private handleMessage(data: any): void {
        const { id, success, error, data: payload } = data;
        const request = this.pending.get(id);
        if (!request) {
            return;
        }

        this.pending.delete(id);
        if (success) {
            request.resolve(payload);
            return;
        }
        request.reject(new Error(error || 'Unknown worker error'));
    }

    private send<T>(type: string, payload?: any, transfer: Transferable[] = []): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('[SqlitePersistence] Worker not initialized'));
                return;
            }
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, payload }, transfer);
        });
    }
}
