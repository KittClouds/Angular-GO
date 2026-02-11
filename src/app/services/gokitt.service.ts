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
    | { type: 'REBUILD_DICTIONARY'; payload: { entitiesJSON: string }; id: number }
    | { type: 'INDEX_NOTE'; payload: { id: string; text: string; scope?: SearchScope }; id: number }
    | { type: 'SEARCH'; payload: { query: string[]; limit?: number; vector?: number[]; scope?: SearchScope }; id: number }
    | { type: 'ADD_VECTOR'; payload: { id: string; vectorJSON: string }; id: number }
    | { type: 'SEARCH_VECTORS'; payload: { vectorJSON: string; k: number }; id: number }
    // DocStore API
    | { type: 'HYDRATE_NOTES'; payload: { notesJSON: string }; id: number }
    | { type: 'UPSERT_NOTE'; payload: { id: string; text: string; version?: number }; id: number }
    | { type: 'REMOVE_NOTE'; payload: { id: string }; id: number }
    | { type: 'SCAN_NOTE'; payload: { noteId: string; provenance?: ProvenanceContext }; id: number }
    | { type: 'VALIDATE_RELATIONS'; payload: { noteId: string; relationsJSON: string }; id: number }
    | { type: 'DOC_COUNT'; id: number }
    // Phase 6: LLM Batch + Extraction + Agent
    | { type: 'BATCH_INIT'; payload: { configJSON: string }; id: number }
    | { type: 'EXTRACT_FROM_NOTE'; payload: { text: string; knownEntitiesJSON?: string }; id: number }
    | { type: 'EXTRACT_ENTITIES'; payload: { text: string }; id: number }
    | { type: 'EXTRACT_RELATIONS'; payload: { text: string; knownEntitiesJSON?: string }; id: number }
    | { type: 'AGENT_CHAT_WITH_TOOLS'; payload: { messagesJSON: string; toolsJSON: string; systemPrompt?: string }; id: number }
    // Phase 7: Observational Memory + Chat Service
    | { type: 'CHAT_INIT'; payload: { configJSON: string }; id: number }
    | { type: 'CHAT_CREATE_THREAD'; payload: { worldId: string; narrativeId: string }; id: number }
    | { type: 'CHAT_GET_THREAD'; payload: { id: string }; id: number }
    | { type: 'CHAT_LIST_THREADS'; payload: { worldId: string }; id: number }
    | { type: 'CHAT_DELETE_THREAD'; payload: { id: string }; id: number }
    | { type: 'CHAT_ADD_MESSAGE'; payload: { threadId: string; role: string; content: string; narrativeId: string }; id: number }
    | { type: 'CHAT_GET_MESSAGES'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_UPDATE_MESSAGE'; payload: { messageId: string; content: string }; id: number }
    | { type: 'CHAT_APPEND_MESSAGE'; payload: { messageId: string; chunk: string }; id: number }
    | { type: 'CHAT_START_STREAMING'; payload: { threadId: string; narrativeId: string }; id: number }
    | { type: 'CHAT_GET_MEMORIES'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_GET_CONTEXT'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_CLEAR_THREAD'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_EXPORT_THREAD'; payload: { threadId: string }; id: number };

type GoKittWorkerResponse =
    | { type: 'INIT_COMPLETE' }
    | { type: 'HYDRATE_COMPLETE'; payload: { success: boolean; error?: string } }
    | { type: 'SCAN_RESULT'; id: number; payload: any }
    | { type: 'SCAN_IMPLICIT_RESULT'; id: number; payload: any[] }
    | { type: 'SCAN_DISCOVERY_RESULT'; id: number; payload: any[] }
    | { type: 'REBUILD_DICTIONARY_RESULT'; id: number; payload: { success: boolean; error?: string } }
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
    | { type: 'VALIDATE_RELATIONS_RESULT'; id: number; payload: any }
    // SQLite Store responses
    | { type: 'STORE_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_UPSERT_NOTE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_NOTE_RESULT'; id: number; payload: any | null }
    | { type: 'STORE_DELETE_NOTE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_LIST_NOTES_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_UPSERT_ENTITY_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_ENTITY_RESULT'; id: number; payload: any | null }
    | { type: 'STORE_DELETE_ENTITY_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_LIST_ENTITIES_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_UPSERT_EDGE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_EDGE_RESULT'; id: number; payload: any | null }
    | { type: 'STORE_DELETE_EDGE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_LIST_EDGES_RESULT'; id: number; payload: any[] }
    // Phase 3: Graph Merger responses
    | { type: 'MERGER_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'MERGER_ADD_SCANNER_RESULT'; id: number; payload: { success: boolean; added: number; error?: string } }
    | { type: 'MERGER_ADD_LLM_RESULT'; id: number; payload: { success: boolean; added: number; error?: string } }
    | { type: 'MERGER_ADD_MANUAL_RESULT'; id: number; payload: { success: boolean; added: number; error?: string } }
    | { type: 'MERGER_GET_GRAPH_RESULT'; id: number; payload: any }
    | { type: 'MERGER_GET_STATS_RESULT'; id: number; payload: any }
    // Phase 4: PCST response
    | { type: 'MERGER_RUN_PCST_RESULT'; id: number; payload: any }
    // Phase 5: SharedArrayBuffer responses
    | { type: 'SAB_INIT_RESULT'; id: number; payload: { success: boolean; initialized: boolean; bufferSize: number; error?: string } }
    | { type: 'SAB_SCAN_TO_BUFFER_RESULT'; id: number; payload: { success: boolean; spans: number; payloadSize: number; error?: string } }
    | { type: 'SAB_GET_STATUS_RESULT'; id: number; payload: { success: boolean; initialized: boolean; bufferSize: number; error?: string } }
    // Phase 6: LLM responses
    | { type: 'BATCH_INIT_RESULT'; id: number; payload: { success: boolean; provider?: string; model?: string; error?: string } }
    | { type: 'EXTRACT_FROM_NOTE_RESULT'; id: number; payload: any }
    | { type: 'EXTRACT_ENTITIES_RESULT'; id: number; payload: any }
    | { type: 'EXTRACT_RELATIONS_RESULT'; id: number; payload: any }
    | { type: 'AGENT_CHAT_WITH_TOOLS_RESULT'; id: number; payload: any }
    // Phase 7: Chat Service responses
    | { type: 'CHAT_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'CHAT_CREATE_THREAD_RESULT'; id: number; payload: any }
    | { type: 'CHAT_GET_THREAD_RESULT'; id: number; payload: any }
    | { type: 'CHAT_LIST_THREADS_RESULT'; id: number; payload: any }
    | { type: 'CHAT_DELETE_THREAD_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'CHAT_ADD_MESSAGE_RESULT'; id: number; payload: any }
    | { type: 'CHAT_GET_MESSAGES_RESULT'; id: number; payload: any }
    | { type: 'CHAT_UPDATE_MESSAGE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'CHAT_APPEND_MESSAGE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'CHAT_START_STREAMING_RESULT'; id: number; payload: any }
    | { type: 'CHAT_GET_MEMORIES_RESULT'; id: number; payload: any }
    | { type: 'CHAT_GET_CONTEXT_RESULT'; id: number; payload: string }
    | { type: 'CHAT_CLEAR_THREAD_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'CHAT_EXPORT_THREAD_RESULT'; id: number; payload: string }
    | { type: 'ERROR'; id?: number; payload: { message: string } };

@Injectable({
    providedIn: 'root'
})
export class GoKittService {
    // Worker is protected so GoKittStoreService can access it
    protected _worker: Worker | null = null;
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

    /** Get the worker instance for external services (like GoKittStoreService) */
    get worker(): Worker | null {
        return this._worker;
    }

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
        this._worker = new Worker(new URL('../workers/gokitt.worker', import.meta.url), { type: 'module' });

        // Setup message handler
        this._worker.onmessage = (e: MessageEvent<GoKittWorkerResponse>) => {
            this.handleWorkerMessage(e.data);
        };

        this._worker.onerror = (e) => {
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

        // Force dictionary rebuild to ensure Aho-Corasick is ready
        await this.refreshDictionary();

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
        console.log(`[GoKittService] refreshDictionary: Rebuilding with ${entities.length} entities...`);

        // DEBUG: Check for key entities
        const checkEntities = ["Yellow Dragon", "Belys Vorona", "Kai"];
        checkEntities.forEach(name => {
            const found = entities.find(e => e.Label === name);
            if (found) {
                console.log(`[GoKittService] Dictionary Payload contains "${name}":`, found);
            } else {
                console.log(`[GoKittService] Dictionary Payload MISSING "${name}"`);
            }
        });


        const result = await this.sendRequest<{ success: boolean; error?: string }>('REBUILD_DICTIONARY', { entitiesJSON });

        if (!result.success) {
            console.error('[GoKittService] Dictionary rebuild failed:', result.error);
        } else {
            console.log(`[GoKittService] ✅ Dictionary rebuilt successfully`);
        }
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
     * Phase 2: Validate LLM-extracted relations against CST
     * Cross-references relations with document structure to filter hallucinations
     * @param noteId The note ID (must be in DocStore)
     * @param relations Array of LLM-extracted relations
     * @returns Validated relations with confidence adjustments
     */
    async validateRelations(noteId: string, relations: any[]): Promise<{
        noteId: string;
        totalInput: number;
        validCount: number;
        relations: any[];
        error?: string;
    }> {
        if (!this.wasmLoaded) {
            return { noteId, totalInput: 0, validCount: 0, relations: [], error: 'WASM not loaded' };
        }

        try {
            const relationsJSON = JSON.stringify(relations);
            const result = await this.sendRequest<any>('VALIDATE_RELATIONS', { noteId, relationsJSON });
            return result;
        } catch (e) {
            console.error('[GoKittService] Validation error:', e);
            return { noteId, totalInput: relations.length, validCount: 0, relations: [], error: String(e) };
        }
    }

    // ==========================================================================
    // Phase 3: Graph Merger API
    // ==========================================================================

    /**
     * Initialize a new merger instance
     */
    async mergerInit(): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('MERGER_INIT', {});
    }

    /**
     * Add edges from a scanner (CST) scan result
     */
    async mergerAddScanner(noteId: string, graphJSON: string): Promise<{ success: boolean; added: number; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, added: 0, error: 'WASM not loaded' };
        }
        return this.sendRequest('MERGER_ADD_SCANNER', { noteId, graphJSON });
    }

    /**
     * Add edges from LLM extraction
     * @param edges Array of { sourceId, targetId, relType, confidence, attributes, sourceNoteId }
     */
    async mergerAddLLM(edges: any[]): Promise<{ success: boolean; added: number; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, added: 0, error: 'WASM not loaded' };
        }
        const edgesJSON = JSON.stringify(edges);
        return this.sendRequest('MERGER_ADD_LLM', { edgesJSON });
    }

    /**
     * Add manually created edges
     * @param edges Array of { sourceId, targetId, relType, attributes }
     */
    async mergerAddManual(edges: any[]): Promise<{ success: boolean; added: number; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, added: 0, error: 'WASM not loaded' };
        }
        const edgesJSON = JSON.stringify(edges);
        return this.sendRequest('MERGER_ADD_MANUAL', { edgesJSON });
    }

    /**
     * Get the current merged graph
     */
    async mergerGetGraph(): Promise<{ nodes: any; edges: any }> {
        if (!this.wasmLoaded) {
            return { nodes: {}, edges: {} };
        }
        return this.sendRequest('MERGER_GET_GRAPH', {});
    }

    /**
     * Get merge statistics
     */
    async mergerGetStats(): Promise<{
        totalEdges: number;
        scannerEdges: number;
        llmEdges: number;
        manualEdges: number;
        deduplicatedEdges: number;
    }> {
        if (!this.wasmLoaded) {
            return { totalEdges: 0, scannerEdges: 0, llmEdges: 0, manualEdges: 0, deduplicatedEdges: 0 };
        }
        return this.sendRequest('MERGER_GET_STATS', {});
    }

    // ==========================================================================
    // Phase 4: PCST Coherence Filter
    // ==========================================================================

    /**
     * Run PCST on the merged graph to extract the optimal subgraph
     * @param prizes Map of nodeId -> prize value (higher = more important to include)
     * @param rootID Optional root node for the Steiner tree
     */
    async mergerRunPCST(prizes: Record<string, number>, rootID?: string): Promise<{
        success: boolean;
        graph?: { nodes: any; edges: any };
        nodeCount?: number;
        edgeCount?: number;
        error?: string;
    }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        const prizesJSON = JSON.stringify(prizes);
        return this.sendRequest('MERGER_RUN_PCST', { prizesJSON, rootID });
    }

    // ==========================================================================
    // Phase 5: SharedArrayBuffer Zero-Copy API
    // ==========================================================================

    /**
     * Initialize SharedArrayBuffer for zero-copy communication
     * @param sab The SharedArrayBuffer to use for data transfer
     */
    async sabInit(sab: SharedArrayBuffer): Promise<{
        success: boolean;
        initialized: boolean;
        bufferSize: number;
        error?: string;
    }> {
        if (!this.wasmLoaded) {
            return { success: false, initialized: false, bufferSize: 0, error: 'WASM not loaded' };
        }
        return this.sendRequest('SAB_INIT', { sab });
    }

    /**
     * Perform a scan and write results directly to SharedArrayBuffer
     * This bypasses JSON serialization for hot-path performance
     * @param text The text to scan
     */
    async sabScanToBuffer(text: string): Promise<{
        success: boolean;
        spans: number;
        payloadSize: number;
        error?: string;
    }> {
        if (!this.wasmLoaded) {
            return { success: false, spans: 0, payloadSize: 0, error: 'WASM not loaded' };
        }
        return this.sendRequest('SAB_SCAN_TO_BUFFER', { text });
    }

    /**
     * Get the current status of the SharedArrayBuffer
     */
    async sabGetStatus(): Promise<{
        success: boolean;
        initialized: boolean;
        bufferSize: number;
        error?: string;
    }> {
        if (!this.wasmLoaded) {
            return { success: false, initialized: false, bufferSize: 0, error: 'WASM not loaded' };
        }
        return this.sendRequest('SAB_GET_STATUS', {});
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

    /**
     * Rebuild the Aho-Corasick dictionary with new entities from the registry.
     * Call this when entities are added/removed to enable implicit highlighting.
     */
    async rebuildDictionary(entities: Array<{ id: string; label: string; kind: string; aliases?: string[] }>): Promise<void> {
        if (!this.wasmLoaded) {
            console.warn('[GoKittService.rebuildDictionary] WASM not loaded yet');
            return;
        }

        try {
            const entitiesJSON = JSON.stringify(entities);

            // DEBUG: Check for key entities in rebuildDictionary (Public API)
            console.log(`[GoKittService.rebuildDictionary] Checking payload for critical entities...`);
            const checkEntities = ["Yellow Dragon", "Belys Vorona", "Kai"];
            checkEntities.forEach(name => {
                const found = entities.find(e => e.label === name);
                if (found) {
                    console.log(`[GoKittService.rebuildDictionary] Payload contains "${name}":`, JSON.stringify(found));
                } else {
                    console.log(`[GoKittService.rebuildDictionary] Payload MISSING "${name}"`);
                }
            });

            const result = await this.sendRequest<{ success: boolean; error?: string }>('REBUILD_DICTIONARY', { entitiesJSON });
            if (!result.success) {
                console.error('[GoKittService.rebuildDictionary] Failed:', result.error);
            } else {
                console.log(`[GoKittService] Dictionary rebuilt with ${entities.length} entities`);
            }
        } catch (e) {
            console.error('[GoKittService.rebuildDictionary] Error:', e);
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
                        case 'REBUILD_DICTIONARY_RESULT':
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
                        case 'VALIDATE_RELATIONS_RESULT':
                        // SQLite Store responses
                        case 'STORE_INIT_RESULT':
                        case 'STORE_UPSERT_NOTE_RESULT':
                        case 'STORE_GET_NOTE_RESULT':
                        case 'STORE_DELETE_NOTE_RESULT':
                        case 'STORE_LIST_NOTES_RESULT':
                        case 'STORE_UPSERT_ENTITY_RESULT':
                        case 'STORE_GET_ENTITY_RESULT':
                        case 'STORE_DELETE_ENTITY_RESULT':
                        case 'STORE_LIST_ENTITIES_RESULT':
                        case 'STORE_UPSERT_EDGE_RESULT':
                        case 'STORE_GET_EDGE_RESULT':
                        case 'STORE_DELETE_EDGE_RESULT':
                        case 'STORE_LIST_EDGES_RESULT':
                        // Phase 3: Graph Merger responses
                        case 'MERGER_INIT_RESULT':
                        case 'MERGER_ADD_SCANNER_RESULT':
                        case 'MERGER_ADD_LLM_RESULT':
                        case 'MERGER_ADD_MANUAL_RESULT':
                        case 'MERGER_GET_GRAPH_RESULT':
                        case 'MERGER_GET_STATS_RESULT':
                        // Phase 4: PCST response
                        case 'MERGER_RUN_PCST_RESULT':
                        // Phase 5: SharedArrayBuffer responses
                        case 'SAB_INIT_RESULT':
                        case 'SAB_SCAN_TO_BUFFER_RESULT':
                        case 'SAB_GET_STATUS_RESULT':
                        // Phase 6: LLM responses
                        case 'BATCH_INIT_RESULT':
                        case 'EXTRACT_FROM_NOTE_RESULT':
                        case 'EXTRACT_ENTITIES_RESULT':
                        case 'EXTRACT_RELATIONS_RESULT':
                        case 'AGENT_CHAT_WITH_TOOLS_RESULT':
                        // Phase 7: Chat Service responses
                        case 'CHAT_INIT_RESULT':
                        case 'CHAT_CREATE_THREAD_RESULT':
                        case 'CHAT_GET_THREAD_RESULT':
                        case 'CHAT_LIST_THREADS_RESULT':
                        case 'CHAT_DELETE_THREAD_RESULT':
                        case 'CHAT_ADD_MESSAGE_RESULT':
                        case 'CHAT_GET_MESSAGES_RESULT':
                        case 'CHAT_UPDATE_MESSAGE_RESULT':
                        case 'CHAT_APPEND_MESSAGE_RESULT':
                        case 'CHAT_START_STREAMING_RESULT':
                        case 'CHAT_GET_MEMORIES_RESULT':
                        case 'CHAT_GET_CONTEXT_RESULT':
                        case 'CHAT_CLEAR_THREAD_RESULT':
                        case 'CHAT_EXPORT_THREAD_RESULT':
                        // Phase 8: Observational Memory responses
                        case 'OM_PROCESS_RESULT':
                        case 'OM_GET_RECORD_RESULT':
                        case 'OM_OBSERVE_RESULT':
                        case 'OM_REFLECT_RESULT':
                        case 'OM_CLEAR_RESULT':
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

            this._worker?.postMessage({ type, payload, id } as GoKittWorkerMessage);

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
                    this._worker?.removeEventListener('message', handler);
                    resolve(undefined as T);
                } else if (msg.type === 'HYDRATE' && response.type === 'HYDRATE_COMPLETE') {
                    this._worker?.removeEventListener('message', handler);
                    resolve(response.payload as T);
                } else if (response.type === 'ERROR' && !('id' in response)) {
                    this._worker?.removeEventListener('message', handler);
                    reject(new Error(response.payload.message));
                }
            };

            this._worker?.addEventListener('message', handler);
            this._worker?.postMessage(msg);

            // Timeout
            setTimeout(() => {
                this._worker?.removeEventListener('message', handler);
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

    // =========================================================================
    // Phase 6: LLM Batch + Extraction + Agent API
    // =========================================================================

    /**
     * Initialize the Go LLM batch service with provider config.
     * Must be called before any extraction or agent calls.
     * @param config LLM provider configuration
     */
    async batchInit(config: {
        provider: 'google' | 'openrouter';
        googleApiKey?: string;
        googleModel?: string;
        openRouterApiKey?: string;
        openRouterModel?: string;
    }): Promise<{ success: boolean; provider?: string; model?: string; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        const configJSON = JSON.stringify(config);
        return this.sendRequest('BATCH_INIT', { configJSON });
    }

    /**
     * Unified entity + relation extraction via Go LLM service.
     * @param text The note text to extract from
     * @param knownEntities Optional list of known entity labels for context
     * @returns Extraction result with entities and relations arrays
     */
    async extractFromNote(
        text: string,
        knownEntities?: string[]
    ): Promise<{ entities: any[]; relations: any[] }> {
        if (!this.wasmLoaded) {
            throw new Error('WASM not loaded');
        }
        const knownEntitiesJSON = knownEntities ? JSON.stringify(knownEntities) : undefined;
        return this.sendLLMRequest('EXTRACT_FROM_NOTE', { text, knownEntitiesJSON });
    }

    /**
     * Extract entities only from text via Go LLM service.
     */
    async extractEntities(text: string): Promise<any[]> {
        if (!this.wasmLoaded) {
            throw new Error('WASM not loaded');
        }
        return this.sendLLMRequest('EXTRACT_ENTITIES', { text });
    }

    /**
     * Extract relations only from text via Go LLM service.
     */
    async extractRelations(text: string, knownEntities?: string[]): Promise<any[]> {
        if (!this.wasmLoaded) {
            throw new Error('WASM not loaded');
        }
        const knownEntitiesJSON = knownEntities ? JSON.stringify(knownEntities) : undefined;
        return this.sendLLMRequest('EXTRACT_RELATIONS', { text, knownEntitiesJSON });
    }

    /**
     * Non-streaming LLM call with tool schemas via Go.
     * Used by the agentic chat loop for function calling.
     * @param messages Chat messages array
     * @param tools Tool definitions array
     * @param systemPrompt Optional system prompt
     * @returns Content and/or tool_calls from the LLM
     */
    async agentChatWithTools(
        messages: any[],
        tools: any[],
        systemPrompt?: string
    ): Promise<{ content: string | null; tool_calls: any[] | null }> {
        if (!this.wasmLoaded) {
            throw new Error('WASM not loaded');
        }
        const messagesJSON = JSON.stringify(messages);
        const toolsJSON = JSON.stringify(tools);
        return this.sendLLMRequest('AGENT_CHAT_WITH_TOOLS', {
            messagesJSON,
            toolsJSON,
            systemPrompt
        });
    }

    /**
     * Send a request with a longer timeout for LLM calls (120s vs 30s for local ops).
     */
    private sendLLMRequest<T>(type: string, payload: any): Promise<T> {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;
            this.pendingRequests.set(id, { resolve, reject });

            this._worker?.postMessage({ type, payload, id } as GoKittWorkerMessage);

            // LLM calls need longer timeout (120s) since they make external API requests
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`LLM request ${type} timed out after 120s`));
                }
            }, 120000);
        });
    }

    // =========================================================================
    // Phase 7: Observational Memory + Chat Service API
    // =========================================================================

    /**
     * Initialize the Go chat service with OpenRouter config.
     * Must be called before any chat operations.
     * @param configJSON JSON string with apiKey and model
     */
    async chatInit(configJSON: string): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_INIT', { configJSON });
    }

    /**
     * Create a new chat thread.
     * @param worldId World scope for the thread
     * @param narrativeId Narrative scope for the thread
     */
    async chatCreateThread(worldId: string, narrativeId: string): Promise<any> {
        if (!this.wasmLoaded) {
            return { error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_CREATE_THREAD', { worldId, narrativeId });
    }

    /**
     * Get a thread by ID.
     * @param id Thread ID
     */
    async chatGetThread(id: string): Promise<any> {
        if (!this.wasmLoaded) {
            return { error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_GET_THREAD', { id });
    }

    /**
     * List threads, optionally filtered by worldId.
     * @param worldId Optional world scope
     */
    async chatListThreads(worldId?: string): Promise<any> {
        if (!this.wasmLoaded) {
            return { error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_LIST_THREADS', { worldId: worldId || '' });
    }

    /**
     * Delete a thread and all its messages.
     * @param id Thread ID
     */
    async chatDeleteThread(id: string): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_DELETE_THREAD', { id });
    }

    /**
     * Add a message to a thread.
     * @param threadId Thread ID
     * @param role Message role (user/assistant/system)
     * @param content Message content
     * @param narrativeId Narrative scope
     */
    async chatAddMessage(threadId: string, role: string, content: string, narrativeId: string): Promise<any> {
        if (!this.wasmLoaded) {
            return { error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_ADD_MESSAGE', { threadId, role, content, narrativeId });
    }

    /**
     * Get messages for a thread.
     * @param threadId Thread ID
     */
    async chatGetMessages(threadId: string): Promise<any> {
        if (!this.wasmLoaded) {
            return { error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_GET_MESSAGES', { threadId });
    }

    /**
     * Update message content.
     * @param messageId Message ID
     * @param content New content
     */
    async chatUpdateMessage(messageId: string, content: string): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_UPDATE_MESSAGE', { messageId, content });
    }

    /**
     * Append content to a message (for streaming).
     * @param messageId Message ID
     * @param chunk Content chunk to append
     */
    async chatAppendMessage(messageId: string, chunk: string): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_APPEND_MESSAGE', { messageId, chunk });
    }

    /**
     * Start a streaming message (creates placeholder).
     * @param threadId Thread ID
     * @param narrativeId Narrative scope
     */
    async chatStartStreaming(threadId: string, narrativeId: string): Promise<any> {
        if (!this.wasmLoaded) {
            return { error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_START_STREAMING', { threadId, narrativeId });
    }

    /**
     * Get memories for a thread.
     * @param threadId Thread ID
     */
    async chatGetMemories(threadId: string): Promise<any> {
        if (!this.wasmLoaded) {
            return { error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_GET_MEMORIES', { threadId });
    }

    /**
     * Get formatted context string for LLM prompts (with memories).
     * @param threadId Thread ID
     */
    async chatGetContext(threadId: string): Promise<string> {
        if (!this.wasmLoaded) {
            return '';
        }
        return this.sendRequest('CHAT_GET_CONTEXT', { threadId });
    }

    /**
     * Clear all messages in a thread.
     * @param threadId Thread ID
     */
    async chatClearThread(threadId: string): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('CHAT_CLEAR_THREAD', { threadId });
    }

    /**
     * Export thread as JSON.
     * @param threadId Thread ID
     */
    async chatExportThread(threadId: string): Promise<string> {
        if (!this.wasmLoaded) {
            return '{}';
        }
        return this.sendRequest('CHAT_EXPORT_THREAD', { threadId });
    }

    // =========================================================================
    // Phase 8: Observational Memory API
    // =========================================================================

    /**
     * Process a thread through the OM pipeline.
     * @param threadId Thread ID
     */
    async omProcess(threadId: string): Promise<{ observed: boolean; reflected: boolean }> {
        if (!this.wasmLoaded) {
            return { observed: false, reflected: false };
        }
        return this.sendRequest('OM_PROCESS', { threadId });
    }

    /**
     * Get the OM record for a thread.
     * @param threadId Thread ID
     */
    async omGetRecord(threadId: string): Promise<any | null> {
        if (!this.wasmLoaded) {
            return null;
        }
        return this.sendRequest('OM_GET_RECORD', { threadId });
    }

    /**
     * Manually trigger observation for a thread.
     * @param threadId Thread ID
     */
    async omObserve(threadId: string): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('OM_OBSERVE', { threadId });
    }

    /**
     * Manually trigger reflection for a thread.
     * @param threadId Thread ID
     */
    async omReflect(threadId: string): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('OM_REFLECT', { threadId });
    }

    /**
     * Clear OM state for a thread.
     * @param threadId Thread ID
     */
    async omClear(threadId: string): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) {
            return { success: false, error: 'WASM not loaded' };
        }
        return this.sendRequest('OM_CLEAR', { threadId });
    }
}
