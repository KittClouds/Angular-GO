import { Injectable } from '@angular/core';
import { smartGraphRegistry } from '../lib/registry';
import type { DecorationSpan } from '../lib/Scanner';
import { db } from '../lib/dexie/db';

// =============================================================================
// Types for Worker Communication
// =============================================================================

/** Provenance context for folder-aware graph projection */
export interface ProvenanceContext {
    vaultId?: string;
    worldId: string;
    parentPath?: string;
    folderType?: string;
}

type GoKittWorkerMessage =
    | { type: 'INIT' }
    | { type: 'HYDRATE'; payload: { entitiesJSON: string } }
    | { type: 'SCAN'; payload: { text: string; provenance?: ProvenanceContext }; id: number }
    | { type: 'SCAN_IMPLICIT'; payload: { text: string }; id: number }
    | { type: 'SCAN_DISCOVERY'; payload: { text: string }; id: number }
    | { type: 'INDEX_NOTE'; payload: { id: string; text: string }; id: number }
    | { type: 'SEARCH'; payload: { query: string[]; limit?: number; vector?: number[] }; id: number }
    | { type: 'ADD_VECTOR'; payload: { id: string; vectorJSON: string }; id: number }
    | { type: 'SEARCH_VECTORS'; payload: { vectorJSON: string; k: number }; id: number };

type GoKittWorkerResponse =
    | { type: 'INIT_COMPLETE' }
    | { type: 'HYDRATE_COMPLETE'; payload: { success: boolean; error?: string } }
    | { type: 'SCAN_RESULT'; id: number; payload: any }
    | { type: 'SCAN_IMPLICIT_RESULT'; id: number; payload: any[] }
    | { type: 'SCAN_DISCOVERY_RESULT'; id: number; payload: any[] }
    | { type: 'INDEX_NOTE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'SEARCH_RESULT'; id: number; payload: any[] }
    | { type: 'ADD_VECTOR_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'SEARCH_VECTORS_RESULT'; id: number; payload: string[] }
    | { type: 'ERROR'; id?: number; payload: { message: string } };

@Injectable({
    providedIn: 'root'
})
export class GoKittService {
    private worker: Worker | null = null;
    private wasmLoaded = false;
    private wasmHydrated = false;
    private loadPromise: Promise<void> | null = null;
    private readyCallbacks: Array<() => void> = [];

    // Promise resolvers for pending requests
    private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private nextRequestId = 1;

    constructor() {
        console.log('[GoKittService] Service ready (worker-based)');
    }

    /**
     * Register a callback to be called when WASM is fully ready
     */
    onReady(callback: () => void): void {
        if (this.isReady) {
            callback();
        } else {
            this.readyCallbacks.push(callback);
        }
    }

    /**
     * Fire all ready callbacks and dispatch global event
     */
    private notifyReady(): void {
        console.log('[GoKittService] 🚀 WASM ready - notifying listeners');

        for (const cb of this.readyCallbacks) {
            try { cb(); } catch (e) { console.error('[GoKittService] Callback error:', e); }
        }
        this.readyCallbacks = [];

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gokitt-ready'));

            // Debug helper
            (window as any).testGraphScan = (text?: string) => {
                const testText = text || "Gandalf said to Frodo that the ring is dangerous. The hobbit looked at the wizard with fear.";
                console.log('🧪 [DEBUG] Testing Reality Layer with:', testText);
                return this.scan(testText);
            };
            console.log('[GoKittService] 💡 Debug: Call window.testGraphScan() in console');
        }
    }

    /**
     * Initialize the worker and load WASM
     */
    async loadWasm(): Promise<void> {
        if (this.loadPromise) return this.loadPromise;
        if (this.wasmLoaded) return;

        this.loadPromise = this._loadWasmInternal();
        return this.loadPromise;
    }

    private async _loadWasmInternal(): Promise<void> {
        // Create worker
        this.worker = new Worker(new URL('../workers/gokitt.worker', import.meta.url), { type: 'module' });

        // Setup message handler
        this.worker.onmessage = (e: MessageEvent<GoKittWorkerResponse>) => {
            this.handleWorkerMessage(e.data);
        };

        this.worker.onerror = (e) => {
            console.error('[GoKittService] Worker error:', e);
        };

        // Send INIT and wait for response
        await this.sendAndWait<void>({ type: 'INIT' });

        this.wasmLoaded = true;
        console.log('[GoKittService] WASM module loaded (via worker)');
    }

    /**
     * Hydrate WASM with entities from registry
     */
    async hydrateWithEntities(): Promise<void> {
        if (!this.wasmLoaded) {
            throw new Error('[GoKittService] Cannot hydrate - WASM not loaded');
        }
        if (this.wasmHydrated) {
            console.log('[GoKittService.hydrateWithEntities] Already hydrated, skipping');
            return;
        }

        const allEntities = smartGraphRegistry.getAll();
        const entities = allEntities.map(e => ({
            ID: e.id,
            Label: e.label,
            Kind: e.kind,
            Aliases: e.aliases || [],
            NarrativeID: e.noteId || ''
        }));

        const entitiesJSON = JSON.stringify(entities);
        const result = await this.sendAndWait<{ success: boolean; error?: string }>({
            type: 'HYDRATE',
            payload: { entitiesJSON }
        });

        if (!result.success) {
            console.error('[GoKittService] Hydration failed:', result.error);
            return;
        }

        this.wasmHydrated = true;
        console.log(`[GoKittService] ✅ Hydrated with ${entities.length} entities`);

        // After hydration, init search index
        this.initSearchIndex().catch(err => console.error('[GoKittService] Search Init Error:', err));

        this.notifyReady();
    }

    /**
     * initialize Full Text Search index (ResoRank)
     */
    async initSearchIndex(): Promise<void> {
        if (!this.wasmLoaded) return;

        console.log('[GoKittService] 🔎 Initializing Search Index...');
        const notes = await db.notes.toArray();

        let indexed = 0;
        for (const note of notes) {
            if (note.content) {
                await this.indexNote(note.id, note.content);
                indexed++;
            }
        }
        console.log(`[GoKittService] ✅ Search Index Ready (${indexed} docs)`);
    }

    async indexNote(id: string, text: string): Promise<void> {
        // Can be called before ready (queued) if wasmLoaded is true
        if (!this.wasmLoaded) return;
        const result = await this.sendRequest<{ success: boolean; error?: string }>('INDEX_NOTE', { id, text });
        if (!result.success) console.warn('[GoKittService] Indexing failed for', id, result.error);
    }

    async search(query: string, limit = 20): Promise<any[]> {
        if (!this.isReady) return [];
        // Basic tokenization (lowercase to match index)
        const terms = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
        if (terms.length === 0) return [];

        return this.sendRequest<any[]>('SEARCH', { query: terms, limit });
    }

    /**
     * Refresh dictionary when registry changes
     */
    async refreshDictionary(): Promise<void> {
        if (!this.wasmLoaded) return;

        const allEntities = smartGraphRegistry.getAll();
        const entities = allEntities.map(e => ({
            ID: e.id,
            Label: e.label,
            Kind: e.kind,
            Aliases: e.aliases || [],
            NarrativeID: e.noteId || ''
        }));

        const entitiesJSON = JSON.stringify(entities);
        await this.sendAndWait<{ success: boolean }>({
            type: 'HYDRATE',
            payload: { entitiesJSON }
        });

        console.log(`[GoKittService] Dictionary refreshed: ${entities.length} entities`);
    }

    // ============ Public API ============

    get isReady(): boolean {
        return this.wasmLoaded && this.wasmHydrated;
    }

    /**
     * Full scan with Reality Layer (CST, Graph, PCST)
     * @param text - The text to scan
     * @param provenance - Optional folder/vault context for graph projection
     */
    async scan(text: string, provenance?: ProvenanceContext): Promise<any> {
        if (!this.wasmLoaded) return { error: 'Wasm not ready' };

        try {
            console.log('[GoKittService.scan] 🧠 REALITY LAYER: Starting full scan...');
            if (provenance) {
                console.log('[GoKittService.scan] 📂 With provenance:', provenance.worldId);
            }
            const result = await this.sendRequest<any>('SCAN', { text, provenance });

            console.log('[GoKittService.scan] ✅ Result:', result);
            console.log('[GoKittService.scan] Graph Nodes:', result.graph?.Nodes ? Object.keys(result.graph.Nodes).length : 0);
            console.log('[GoKittService.scan] Graph Edges:', result.graph?.Edges?.length ?? 0);

            return result;
        } catch (e) {
            console.error('[GoKittService] Scan error:', e);
            return { error: String(e) };
        }
    }

    /**
     * Discovery scan (unsupervised NER)
     */
    async scanDiscovery(text: string): Promise<any[]> {
        if (!this.wasmLoaded) {
            // WASM not loaded yet - silently return empty (expected during boot)
            return [];
        }

        try {
            console.log(`[GoKittService.scanDiscovery] Scanning ${text.length} chars`);
            const result = await this.sendRequest<any[]>('SCAN_DISCOVERY', { text });
            console.log('[GoKittService.scanDiscovery] Result:', result);
            return result;
        } catch (e) {
            console.error('[GoKittService] Discovery error:', e);
            return [];
        }
    }

    /**
     * Scan for implicit entity mentions (Aho-Corasick)
     * Returns SYNCHRONOUSLY for editor performance (uses cached data)
     *
     * Note: This is a hybrid approach - we keep a sync version for the editor
     * that doesn't block, but heavy scans go through the worker.
     */
    scanImplicit(text: string): DecorationSpan[] {
        // For implicit scanning, we still want it fast and sync
        // So we queue an async request and return empty for now
        // This is a trade-off: first render may not have highlights
        if (!this.isReady) return [];

        // Fire async request (results handled by callback)
        this.scanImplicitAsync(text).catch(() => { });

        // Return empty for now - decorations will update on next tick
        return [];
    }

    /**
     * Async version of scanImplicit for when caller can wait
     */
    async scanImplicitAsync(text: string): Promise<DecorationSpan[]> {
        if (!this.isReady) return [];

        try {
            const spans = await this.sendRequest<DecorationSpan[]>('SCAN_IMPLICIT', { text });

            // Post-process: verify kinds with registry
            for (const span of spans) {
                if (span.type === 'entity_implicit') {
                    const entity = smartGraphRegistry.findEntityByLabel(span.label);
                    if (entity) {
                        span.kind = entity.kind;
                    } else if (span.kind) {
                        span.kind = span.kind.toUpperCase() as any;
                    } else {
                        span.kind = 'UNKNOWN';
                    }
                }
            }

            return spans;
        } catch (e) {
            console.error('[GoKittService.scanImplicitAsync] Error:', e);
            return [];
        }
    }

    async addVector(id: string, vector: number[]): Promise<void> {
        if (!this.wasmLoaded) return;
        const vectorJSON = JSON.stringify(vector);
        const result = await this.sendRequest<{ success: boolean; error?: string }>('ADD_VECTOR', { id, vectorJSON });
        if (!result.success) throw new Error(result.error);
    }

    async searchVectors(vector: number[], k: number): Promise<string[]> {
        if (!this.wasmLoaded) return [];
        const vectorJSON = JSON.stringify(vector);
        return this.sendRequest<string[]>('SEARCH_VECTORS', { vectorJSON, k });
    }

    // ============ Worker Communication ============

    private handleWorkerMessage(msg: GoKittWorkerResponse): void {
        // Handle responses with IDs
        if ('id' in msg && msg.id !== undefined) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                this.pendingRequests.delete(msg.id);

                if (msg.type === 'ERROR') {
                    pending.reject(new Error(msg.payload.message));
                } else {
                    // Extract payload based on message type
                    switch (msg.type) {
                        case 'SCAN_RESULT':
                        case 'SCAN_IMPLICIT_RESULT':
                        case 'SCAN_DISCOVERY_RESULT':
                        case 'INDEX_NOTE_RESULT':
                        case 'SEARCH_RESULT':
                        case 'ADD_VECTOR_RESULT':
                        case 'SEARCH_VECTORS_RESULT':
                            pending.resolve(msg.payload);
                            break;
                        default:
                            pending.resolve(undefined);
                    }
                }
            }
            return;
        }

        // Handle non-ID messages (INIT_COMPLETE, HYDRATE_COMPLETE)
        // These are handled by sendAndWait
    }

    private sendRequest<T>(type: string, payload: any): Promise<T> {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;
            this.pendingRequests.set(id, { resolve, reject });

            this.worker?.postMessage({ type, payload, id } as GoKittWorkerMessage);

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${type} timed out`));
                }
            }, 30000);
        });
    }

    private sendAndWait<T>(msg: GoKittWorkerMessage): Promise<T> {
        return new Promise((resolve, reject) => {
            const handler = (e: MessageEvent<GoKittWorkerResponse>) => {
                const response = e.data;

                // Match response type to request type
                if (msg.type === 'INIT' && response.type === 'INIT_COMPLETE') {
                    this.worker?.removeEventListener('message', handler);
                    resolve(undefined as T);
                } else if (msg.type === 'HYDRATE' && response.type === 'HYDRATE_COMPLETE') {
                    this.worker?.removeEventListener('message', handler);
                    resolve(response.payload as T);
                } else if (response.type === 'ERROR' && !('id' in response)) {
                    this.worker?.removeEventListener('message', handler);
                    reject(new Error(response.payload.message));
                }
            };

            this.worker?.addEventListener('message', handler);
            this.worker?.postMessage(msg);

            // Timeout
            setTimeout(() => {
                this.worker?.removeEventListener('message', handler);
                reject(new Error(`${msg.type} timed out`));
            }, 30000);
        });
    }
}
