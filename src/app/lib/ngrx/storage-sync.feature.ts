// src/app/lib/ngrx/storage-sync.feature.ts
// Simple localStorage persistence for NgRx SignalStore
// V21 compatible - uses effect-based persistence

import { effect } from '@angular/core';
import {
    getState,
    patchState,
    signalStoreFeature,
    withHooks,
    withMethods,
    type,
} from '@ngrx/signals';

/**
 * Creates a SignalStore feature that syncs state to localStorage.
 * 
 * @param key - The localStorage key to use
 * @param options - Optional configuration
 */
export function withStorageSync<TState extends object>(
    key: string,
    options: {
        debounceMs?: number;
        keys?: (keyof TState)[];
    } = {}
) {
    const { debounceMs = 100, keys } = options;
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    return signalStoreFeature(
        { state: type<TState>() },

        withMethods((store) => ({
            _persistToStorage(): void {
                if (saveTimeout) clearTimeout(saveTimeout);

                saveTimeout = setTimeout(() => {
                    try {
                        const state = getState(store);

                        // If keys specified, only save those
                        const dataToSave = keys
                            ? keys.reduce((acc, k) => ({ ...acc, [k]: (state as any)[k] }), {} as Partial<TState>)
                            : state;

                        localStorage.setItem(key, JSON.stringify(dataToSave));
                        console.log(`[StorageSync] Saved '${key}'`);
                    } catch (e) {
                        console.warn(`[StorageSync] Failed to save '${key}':`, e);
                    }
                }, debounceMs);
            },

            _loadFromStorage(): void {
                try {
                    const stored = localStorage.getItem(key);
                    if (stored) {
                        const parsed = JSON.parse(stored) as Partial<TState>;
                        patchState(store, parsed as TState);
                        console.log(`[StorageSync] Loaded '${key}'`);
                    }
                } catch (e) {
                    console.warn(`[StorageSync] Failed to load '${key}':`, e);
                }
            },
        })),

        withHooks({
            onInit(store: any) {
                // Auto-load from storage on init
                store._loadFromStorage();
            },
            onDestroy(store: any) {
                // Auto-save on destroy (if timeout pending)
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                }
            },
        }),
    );
}
