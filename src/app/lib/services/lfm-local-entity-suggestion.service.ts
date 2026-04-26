import { Injectable, NgZone, signal } from '@angular/core';
import type {
    EntitySuggestionProviderApi,
    EntitySuggestionProviderStatus,
    EntitySuggestionScanRequest,
    LocalEntitySuggestion,
} from '../entity-suggestions/entity-suggestion.types';
import { createNoopNgZone, createWorkerOutsideAngular } from '../core/worker-zone';

type WorkerResponse =
    | { type: 'INIT_COMPLETE'; payload: { device: 'webgpu' | 'wasm' }; _id: number }
    | { type: 'SCAN_COMPLETE'; payload: { suggestions: LocalEntitySuggestion[]; device: 'webgpu' | 'wasm' }; _id: number }
    | { type: 'STATUS'; payload: EntitySuggestionProviderStatus; _id: number }
    | { type: 'DISPOSED'; _id: number }
    | { type: 'ERROR'; payload: { message: string }; _id: number };

const IDLE_DISPOSE_DELAY_MS = 120_000;

@Injectable({ providedIn: 'root' })
export class LfmLocalEntitySuggestionProvider implements EntitySuggestionProviderApi {
    readonly id = 'lfm_local_experiment' as const;

    private worker: Worker | null = null;
    private pendingCallbacks = new Map<number, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
    }>();
    private callbackId = 0;
    private initPromise: Promise<void> | null = null;
    private idleDisposeTimer: ReturnType<typeof setTimeout> | null = null;

    readonly status = signal<EntitySuggestionProviderStatus>({
        ready: false,
        loading: false,
        device: null,
    });

    constructor(private readonly ngZone: NgZone = createNoopNgZone()) {}

    async scan(request: EntitySuggestionScanRequest): Promise<LocalEntitySuggestion[]> {
        this.cancelIdleDispose();
        await this.initialize();

        this.status.update((current) => ({
            ...current,
            loading: true,
            error: undefined,
        }));

        try {
            const payload = await this.sendMessage<{
                suggestions: LocalEntitySuggestion[];
                device: 'webgpu' | 'wasm';
            }>({
                type: 'SCAN',
                payload: {
                    noteTitle: request.noteTitle,
                    plainText: request.plainText,
                },
            });

            this.status.set({
                ready: true,
                loading: false,
                device: payload.device,
            });

            return payload.suggestions;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Local entity scan failed';
            this.status.update((current) => ({
                ...current,
                loading: false,
                error: message,
            }));
            throw error;
        } finally {
            this.scheduleIdleDispose();
        }
    }

    async getStatus(): Promise<EntitySuggestionProviderStatus> {
        if (!this.worker) {
            return this.status();
        }

        try {
            const payload = await this.sendMessage<EntitySuggestionProviderStatus>({
                type: 'GET_STATUS',
            });
            this.status.set(payload);
            return payload;
        } catch {
            return this.status();
        }
    }

    async dispose(): Promise<void> {
        this.cancelIdleDispose();
        if (!this.worker) {
            this.status.set({
                ready: false,
                loading: false,
                device: null,
            });
            return;
        }

        try {
            await this.sendMessage({ type: 'DISPOSE' });
        } finally {
            this.worker.terminate();
            this.worker = null;
            this.initPromise = null;
            this.pendingCallbacks.clear();
            this.status.set({
                ready: false,
                loading: false,
                device: null,
            });
        }
    }

    private async initialize(): Promise<void> {
        if (this.status().ready && this.worker) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.ensureWorker();
        this.status.update((current) => ({
            ...current,
            loading: true,
            error: undefined,
        }));

        this.initPromise = this.sendMessage<{ device: 'webgpu' | 'wasm' }>({
            type: 'INIT',
        }).then((payload) => {
            this.status.set({
                ready: true,
                loading: false,
                device: payload.device,
            });
        }).catch((error) => {
            const message = error instanceof Error ? error.message : 'Local entity model failed to initialize';
            this.status.set({
                ready: false,
                loading: false,
                device: null,
                error: message,
            });
            throw error;
        }).finally(() => {
            this.initPromise = null;
        });

        return this.initPromise;
    }

    private ensureWorker(): void {
        if (this.worker) {
            return;
        }

        this.worker = createWorkerOutsideAngular(
            this.ngZone,
            () =>
                new Worker(new URL('../../workers/lfm-entity-suggestion.worker', import.meta.url), {
                    type: 'module',
                }),
            (worker) => {
                worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                    this.handleWorkerMessage(event.data);
                };

                worker.onerror = (event) => {
                    const message = event.message || 'Local entity worker crashed';
                    this.ngZone.run(() => {
                        this.status.update((current) => ({
                            ...current,
                            loading: false,
                            error: message,
                        }));
                    });
                };
            },
        );
    }

    private nextId(): number {
        return ++this.callbackId;
    }

    private sendMessage<T>(message: { type: string; payload?: unknown }): Promise<T> {
        if (!this.worker) {
            throw new Error('Local entity worker is not initialized');
        }

        return new Promise<T>((resolve, reject) => {
            const id = this.nextId();
            this.pendingCallbacks.set(id, { resolve, reject });
            this.worker!.postMessage({
                ...message,
                _id: id,
            });
        });
    }

    private handleWorkerMessage(message: WorkerResponse): void {
        const pending = this.pendingCallbacks.get(message._id);
        if (!pending) {
            return;
        }

        this.pendingCallbacks.delete(message._id);

        if (message.type === 'ERROR') {
            this.ngZone.run(() => {
                pending.reject(new Error(message.payload.message));
            });
            return;
        }

        if (message.type === 'INIT_COMPLETE') {
            this.ngZone.run(() => {
                pending.resolve(message.payload);
            });
            return;
        }

        if (message.type === 'SCAN_COMPLETE') {
            this.ngZone.run(() => {
                pending.resolve(message.payload);
            });
            return;
        }

        if (message.type === 'STATUS') {
            this.ngZone.run(() => {
                pending.resolve(message.payload);
            });
            return;
        }

        this.ngZone.run(() => {
            pending.resolve(undefined);
        });
    }

    private cancelIdleDispose(): void {
        if (this.idleDisposeTimer) {
            clearTimeout(this.idleDisposeTimer);
            this.idleDisposeTimer = null;
        }
    }

    private scheduleIdleDispose(): void {
        this.cancelIdleDispose();
        this.idleDisposeTimer = setTimeout(() => {
            void this.dispose();
        }, IDLE_DISPOSE_DELAY_MS);
    }
}
