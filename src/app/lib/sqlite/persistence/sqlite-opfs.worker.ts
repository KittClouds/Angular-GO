/// <reference lib="webworker" />

import { SqliteOpfsAdapter } from './sqlite-opfs-core';

class OpMutex {
    private queue: Array<() => void> = [];
    private locked = false;

    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise<void>((resolve) => this.queue.push(resolve));
    }

    release(): void {
        const next = this.queue.shift();
        if (next) {
            next();
            return;
        }
        this.locked = false;
    }

    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

const adapter = new SqliteOpfsAdapter();
const mutex = new OpMutex();

self.onmessage = async (event: MessageEvent) => {
    const { id, type, payload } = event.data;

    try {
        switch (type) {
            case 'LOAD': {
                await respond(id, type, async () => ({ snapshot: await adapter.load() }));
                break;
            }
            case 'SAVE_SNAPSHOT': {
                await respond(id, type, async () => {
                    await adapter.saveSnapshot(payload);
                    return null;
                });
                break;
            }
            case 'LOAD_PHOENIX_MANIFEST': {
                await respond(id, type, async () => adapter.loadPhoenixManifest());
                break;
            }
            case 'READ_PHOENIX_FILE': {
                await respond(id, type, async () => {
                    const bytes = await adapter.readPhoenixFile(String(payload?.file || ''));
                    return {
                        __transferEnvelope: true,
                        data: bytes,
                        transfer: bytes ? [bytes.buffer] : [],
                    };
                });
                break;
            }
            case 'INSPECT_PHOENIX_PERSISTENCE': {
                await respond(id, type, async () => adapter.inspectPhoenixPersistence());
                break;
            }
            case 'INSPECT_PHOENIX_PERSISTENCE_DEBUG': {
                await respond(id, type, async () => adapter.inspectPhoenixPersistenceDebug());
                break;
            }
            case 'APPEND_PHOENIX_WAL_BATCH': {
                await respond(id, type, async () => adapter.appendPhoenixWalBatch(payload));
                break;
            }
            case 'COMMIT_PHOENIX_MANIFEST': {
                await respond(id, type, async () => {
                    await adapter.commitPhoenixManifest(payload);
                    return null;
                });
                break;
            }
            case 'WRITE_PHOENIX_CHECKPOINT': {
                await respond(id, type, async () =>
                    adapter.writePhoenixCheckpoint(payload.partition, payload.generation, payload.bytes),
                );
                break;
            }
            case 'PRUNE_PHOENIX_FILES': {
                await respond(id, type, async () => {
                    await adapter.prunePhoenixFiles(Array.isArray(payload?.files) ? payload.files : []);
                    return null;
                });
                break;
            }
            case 'CLEAR_ALL': {
                await respond(id, type, async () => adapter.clearAll());
                break;
            }
            default: {
                self.postMessage({ id, type, success: false, error: `Unknown worker message: ${type}` });
            }
        }
    } catch (error: any) {
        console.error('[SqliteOpfsWorker] Fatal:', error);
        self.postMessage({ id, type, success: false, error: error?.message || String(error) });
    }
};

async function respond(
    id: number,
    type: string,
    fn: () => Promise<any | { data: any; transfer?: Transferable[] }>,
): Promise<void> {
    await mutex.withLock(async () => {
        try {
            const result = await fn();
            const isTransferEnvelope =
                !!result &&
                typeof result === 'object' &&
                '__transferEnvelope' in result &&
                'data' in result;
            const data = isTransferEnvelope ? result.data : result;
            const transfer =
                isTransferEnvelope && Array.isArray((result as { transfer?: Transferable[] }).transfer)
                    ? (result as { transfer?: Transferable[] }).transfer!
                    : [];
            self.postMessage({ id, type, success: true, data }, transfer);
        } catch (error: any) {
            console.error(`[SqliteOpfsWorker] ${type} failed:`, error);
            self.postMessage({
                id,
                type,
                success: false,
                error: error?.message || String(error),
            });
        }
    });
}
