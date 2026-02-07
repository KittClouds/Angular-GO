import { Injectable, signal } from '@angular/core';
import { smartGraphRegistry } from '../lib/registry';
import type { DecorationSpan } from '../lib/Scanner';
import { db } from '../lib/dexie/db';
import { graphRegistry, type RelationshipProvenance } from '../lib/cozo/graph';
import type { EntityKind } from '../lib/cozo/utils';

// =============================================================================
// Types for Worker Communication
// =============================================================================

/** GoKitt graph data directly from scan result */
export interface GoKittGraphData {
    nodes: Record<string, { Label?: string; label?: string; Kind?: string; kind?: string; Aliases?: string[] }>;
    edges: Array<{ Source?: string; source?: string; Target?: string; target?: string; Type?: string; type?: string; Confidence?: number; confidence?: number }>;
}

/** Provenance context for folder-aware graph projection */
export interface ProvenanceContext {
    vaultId?: string;
    worldId: string;
    parentPath?: string;
    folderType?: string;
}

/** Scope filter for search */
export interface SearchScope {
    narrativeId?: string;
    folderPath?: string;
}

type GoKittWorkerMessage =
    | { type: 'INIT' }
    | { type: 'HYDRATE'; payload: { entitiesJSON: string } }
    | { type: 'SCAN'; payload: { text: string; provenance?: ProvenanceContext }; id: number }
    | { type: 'SCAN_IMPLICIT'; payload: { text: string }; id: number }
    | { type: 'SCAN_DISCOVERY'; payload: { text: string }; id: number }
    | { type: 'INDEX_NOTE'; payload: { id: string; text: string; scope?: SearchScope }; id: number }
    | { type: 'SEARCH'; payload: { query: string[]; limit?: number; vector?: number[]; scope?: SearchScope }; id: number }
    | { type: 'ADD_VECTOR'; payload: { id: string; vectorJSON: string }; id: number }
    | { type: 'SEARCH_VECTORS'; payload: { vectorJSON: string; k: number }; id: number }
    // DocStore API
    | { type: 'HYDRATE_NOTES'; payload: { notesJSON: string }; id: number }
    | { type: 'UPSERT_NOTE'; payload: { id: string; text: string; version?: number }; id: number }
    | { type: 'REMOVE_NOTE'; payload: { id: string }; id: number }
    | { type: 'SCAN_NOTE'; payload: { noteId: string; provenance?: ProvenanceContext }; id: number }
    | { type: 'DOC_COUNT'; id: number };

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
    // DocStore responses
    | { type: 'HYDRATE_NOTES_RESULT'; id: number; payload: { success: boolean; count?: number; error?: string } }
    | { type: 'UPSERT_NOTE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'REMOVE_NOTE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'SCAN_NOTE_RESULT'; id: number; payload: any }
    | { type: 'DOC_COUNT_RESULT'; id: number; payload: number }
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

    // Last graph data from GoKitt scan - PRIMARY source for graph visualization
    private _lastGraphData = signal<GoKittGraphData | null>(null);
    readonly lastGraphData = this._lastGraphData.asReadonly();

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

    async indexNote(id: string, text: string, scope?: SearchScope): Promise<void> {
        // Can be called before ready (queued) if wasmLoaded is true
        if (!this.wasmLoaded) return;
        const result = await this.sendRequest<{ success: boolean; error?: string }>('INDEX_NOTE', { id, text, scope });
        if (!result.success) console.warn('[GoKittService] Indexing failed for', id, result.error);
    }

    async search(query: string, limit = 20): Promise<any[]> {
        return this.searchScoped(query, limit);
    }

    /**
     * Scoped search - filter results by narrative or folder
     * @param query Search query string
     * @param limit Max results
     * @param scope Optional narrative/folder filter
     */
    async searchScoped(query: string, limit = 20, scope?: SearchScope): Promise<any[]> {
        if (!this.isReady) return [];
        // Basic tokenization (lowercase to match index)
        const terms = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
        if (terms.length === 0) return [];

        return this.sendRequest<any[]>('SEARCH', { query: terms, limit, scope });
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

            // Store graph data for direct consumption by graph visualization
            if (result.graph) {
                this._lastGraphData.set({
                    nodes: result.graph.Nodes || result.graph.nodes || {},
                    edges: result.graph.Edges || result.graph.edges || []
                });
            }

            return result;
        } catch (e) {
            console.error('[GoKittService] Scan error:', e);
            return { error: String(e) };
        }
    }

    /**
     * Persist graph scan results to CozoDB
     * Maps GoKitt nodes → entities, edges → entity_edge
     * 
     * @param scanResult - Result from scan() containing graph.Nodes and graph.Edges
     * @param noteId - The note ID for provenance tracking
     * @param narrativeId - Optional narrative scope for the entities
     * @returns Stats on persisted nodes/edges
     */
    persistGraph(
        scanResult: any,
        noteId: string,
        narrativeId?: string
    ): { nodesCreated: number; nodesUpdated: number; edgesCreated: number; edgesUpdated: number } {
        const stats = { nodesCreated: 0, nodesUpdated: 0, edgesCreated: 0, edgesUpdated: 0 };

        if (!scanResult?.graph) {
            console.warn('[GoKittService.persistGraph] No graph in scan result');
            return stats;
        }

        // GoKitt returns lowercase keys: { nodes: {...}, edges: [...] }
        const nodes = scanResult.graph.nodes || scanResult.graph.Nodes;
        const edges = scanResult.graph.edges || scanResult.graph.Edges;

        console.log('[GoKittService.persistGraph] Nodes:', nodes ? Object.keys(nodes).length : 0);
        console.log('[GoKittService.persistGraph] Edges:', edges?.length ?? 0);

        // ─────────────────────────────────────────────────────────────
        // Persist Nodes → entities table
        // ─────────────────────────────────────────────────────────────
        if (nodes && typeof nodes === 'object') {
            const nodeIdMap = new Map<string, string>(); // GoKitt ID → CozoDB ID

            for (const [goKittId, node] of Object.entries(nodes) as [string, any][]) {
                const label = node.Label || node.label || goKittId;
                const kind = (node.Kind || node.kind || 'UNKNOWN').toUpperCase() as EntityKind;

                // Check if entity already exists
                const existing = graphRegistry.findEntityByLabel(label);

                if (existing) {
                    // Entity exists - increment mention count
                    const currentCount = existing.mentionsByNote?.get(noteId) ?? 0;
                    graphRegistry.updateNoteMentions(existing.id, noteId, currentCount + 1);
                    nodeIdMap.set(goKittId, existing.id);
                    stats.nodesUpdated++;
                    console.log(`[GoKittService.persistGraph] Updated existing entity: ${label}`);
                } else {
                    // Create new entity
                    const entity = graphRegistry.registerEntity(label, kind, noteId, {
                        narrativeId,
                        aliases: node.Aliases || node.aliases || []
                    });
                    nodeIdMap.set(goKittId, entity.id);
                    stats.nodesCreated++;
                    console.log(`[GoKittService.persistGraph] Created entity: ${label} (${kind})`);
                }
            }

            // ─────────────────────────────────────────────────────────────
            // Persist Edges → entity_edge table  
            // ─────────────────────────────────────────────────────────────
            if (edges && Array.isArray(edges)) {
                for (const edge of edges) {
                    const sourceGoKittId = edge.Source || edge.source;
                    const targetGoKittId = edge.Target || edge.target;
                    const edgeType = (edge.Type || edge.type || 'RELATED_TO').toUpperCase();
                    const confidence = edge.Confidence ?? edge.confidence ?? 0.8;

                    // Map GoKitt IDs to CozoDB IDs
                    const sourceId = nodeIdMap.get(sourceGoKittId);
                    const targetId = nodeIdMap.get(targetGoKittId);

                    if (!sourceId || !targetId) {
                        console.warn(`[GoKittService.persistGraph] Skipping edge - missing node mapping: ${sourceGoKittId} -> ${targetGoKittId}`);
                        continue;
                    }

                    // Build provenance
                    const provenance: RelationshipProvenance = {
                        source: 'gokitt_scan',
                        originId: noteId,
                        confidence,
                        timestamp: new Date(),
                        context: `Extracted from note via Reality Layer scan`
                    };

                    // Check if relationship already exists (addRelationship handles dedup)
                    const existingRel = graphRegistry.findRelationship(sourceId, targetId, edgeType);

                    graphRegistry.addRelationship(sourceId, targetId, edgeType, provenance, {
                        narrativeId
                    });

                    if (existingRel) {
                        stats.edgesUpdated++;
                        console.log(`[GoKittService.persistGraph] Updated edge: ${edgeType}`);
                    } else {
                        stats.edgesCreated++;
                        console.log(`[GoKittService.persistGraph] Created edge: ${edgeType} (${sourceId} → ${targetId})`);
                    }
                }
            }
        }

        console.log(`[GoKittService.persistGraph] ✅ Complete:`, stats);
        return stats;
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
                        // DocStore responses
                        case 'HYDRATE_NOTES_RESULT':
                        case 'UPSERT_NOTE_RESULT':
                        case 'REMOVE_NOTE_RESULT':
                        case 'SCAN_NOTE_RESULT':
                        case 'DOC_COUNT_RESULT':
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

    // =========================================================================
    // DocStore API - In-memory document storage in Go WASM
    // =========================================================================

    /**
     * Hydrate DocStore with all notes at startup.
     * Notes are stored in Go memory for fast scanning without JS roundtrips.
     * @param notes Array of { id, text, version? }
     */
    async hydrateNotes(notes: Array<{ id: string; text: string; version?: number }>): Promise<{ success: boolean; error?: string }> {
        console.log(`[GoKittService.hydrateNotes] Hydrating ${notes.length} notes...`);
        const notesJSON = JSON.stringify(notes);
        return this.sendRequest<{ success: boolean; error?: string }>('HYDRATE_NOTES', { notesJSON });
    }

    /**
     * Update a single note in DocStore.
     * Called when user saves a note.
     */
    async upsertNote(id: string, text: string, version?: number): Promise<{ success: boolean; error?: string }> {
        return this.sendRequest<{ success: boolean; error?: string }>('UPSERT_NOTE', { id, text, version });
    }

    /**
     * Remove a note from DocStore.
     */
    async removeNote(id: string): Promise<{ success: boolean; error?: string }> {
        return this.sendRequest<{ success: boolean; error?: string }>('REMOVE_NOTE', { id });
    }

    /**
     * Scan a note from DocStore (reads from Go memory, not JS).
     * This eliminates the JS→Go text transfer on each scan.
     * @param noteId The note ID (must have been hydrated first)
     * @param provenance Optional folder/vault context
     */
    async scanNote(noteId: string, provenance?: ProvenanceContext): Promise<any> {
        console.log(`[GoKittService.scanNote] Scanning note from DocStore: ${noteId}`);
        const result = await this.sendRequest<any>('SCAN_NOTE', { noteId, provenance });

        // Store graph data for visualization
        if (result.graph) {
            this._lastGraphData.set({
                nodes: result.graph.nodes || {},
                edges: result.graph.edges || []
            });
        }

        return result;
    }

    /**
     * Get the number of documents in DocStore.
     */
    async getDocCount(): Promise<number> {
        return this.sendRequest<number>('DOC_COUNT', {});
    }
}
