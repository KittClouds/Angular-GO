import { Injectable, signal } from '@angular/core';
import { smartGraphRegistry } from '../lib/registry';
import type { DecorationSpan } from '../lib/Scanner';
import { db } from '../lib/dexie/db';
import type { EntityKind } from '../lib/types';

// =============================================================================
// Types for Worker Communication
// =============================================================================

/** GoKitt graph data directly from scan result */
export interface GoKittGraphData {
    nodes: Record<string, { Label?: string; label?: string; Kind?: string; kind?: string; Aliases?: string[] }>;
    edges: Array<{
        Source?: string; source?: string;
        Target?: string; target?: string;
        Type?: string; type?: string; relation?: string;
        Confidence?: number; confidence?: number; weight?: number;
    }>;
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
    // Store: Spans & Links
    | { type: 'STORE_UPSERT_SPAN'; payload: { spanJSON: string }; id: number }
    | { type: 'STORE_GET_SPAN'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_SPANS_FOR_NOTE'; payload: { noteId: string }; id: number }
    | { type: 'STORE_DELETE_SPAN'; payload: { id: string }; id: number }
    // Store: Network View
    | { type: 'STORE_UPSERT_NETWORK_INSTANCE'; payload: { networkJSON: string }; id: number }
    | { type: 'STORE_GET_NETWORK_INSTANCE'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_NETWORK_INSTANCES'; id: number }
    | { type: 'STORE_DELETE_NETWORK_INSTANCE'; payload: { id: string }; id: number }
    | { type: 'STORE_UPSERT_NETWORK_MEMBERSHIP'; payload: { memberJSON: string }; id: number }
    | { type: 'STORE_GET_NETWORK_MEMBERS'; payload: { networkId: string }; id: number }
    | { type: 'STORE_UPSERT_NETWORK_RELATIONSHIP'; payload: { relJSON: string }; id: number }
    | { type: 'STORE_GET_NETWORK_RELATIONSHIPS'; payload: { networkId: string }; id: number }
    // Store: Discovery
    | { type: 'STORE_UPSERT_DISCOVERY_CANDIDATE'; payload: { candidateJSON: string }; id: number }
    | { type: 'STORE_LIST_DISCOVERY_CANDIDATES'; id: number }
    // Store: Fact Sheets
    | { type: 'STORE_UPSERT_ENTITY_CARD'; payload: { cardJSON: string }; id: number }
    | { type: 'STORE_GET_ENTITY_CARDS'; payload: { entityId: string }; id: number }
    | { type: 'STORE_UPSERT_FOLDER_SCHEMA'; payload: { schemaJSON: string }; id: number }
    | { type: 'STORE_GET_FOLDER_SCHEMA'; payload: { id: string }; id: number }
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
    | { type: 'CHAT_EXPORT_THREAD'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_PROCESS_WITH_WORKSPACE'; payload: { threadId: string; scopeId: string; userPrompt: string }; id: number }
    // RAPTOR requests
    | { type: 'RAPTOR_INIT'; payload: { configJSON?: string }; id: number }
    | { type: 'RAPTOR_BUILD_TREE'; payload: { embeddingsJSON?: string }; id: number }
    | { type: 'RAPTOR_SEARCH'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_SEARCH_AGGREGATED'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_SEARCH_LEAF_ONLY'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_GET_STATS'; id: number }
    | { type: 'RAPTOR_CLEAR'; id: number }
    | { type: 'RAPTOR_CHUNK'; payload: { docID: string; text: string }; id: number }
    | { type: 'RAPTOR_INGEST_SAB'; payload: { docID: string; count: number; dim: number }; id: number }
    // Knowledge Graph requests
    | { type: 'KNOWLEDGE_INIT'; id: number }
    | { type: 'KNOWLEDGE_LOAD'; id: number }
    | { type: 'KNOWLEDGE_SAVE'; id: number }
    | { type: 'KNOWLEDGE_ADD_NODE'; payload: { nodeJSON: string }; id: number }
    | { type: 'KNOWLEDGE_ADD_EDGE'; payload: { edgeJSON: string }; id: number }
    | { type: 'KNOWLEDGE_GET_NODE'; payload: { id: string }; id: number }
    | { type: 'KNOWLEDGE_GET_CHILDREN'; payload: { id: string; relation?: string }; id: number }
    | { type: 'KNOWLEDGE_GET_PARENTS'; payload: { id: string; relation?: string }; id: number }
    | { type: 'KNOWLEDGE_GET_ANCESTORS'; payload: { id: string; relation?: string; maxDepth?: number }; id: number }
    | { type: 'KNOWLEDGE_GET_DESCENDANTS'; payload: { id: string; relation?: string; maxDepth?: number }; id: number }
    | { type: 'KNOWLEDGE_GET_NEIGHBORHOOD'; payload: { id: string }; id: number }
    | { type: 'KNOWLEDGE_GET_GRAPH'; id: number }
    // GLDR requests
    | { type: 'GLDR_INIT'; id: number }
    | { type: 'GLDR_INDEX_CHUNK'; payload: { chunkId: string; fieldsJSON: string; mentionsJSON: string }; id: number }
    | { type: 'GLDR_LOAD_COOCCURRENCES'; payload: { minCount: number }; id: number }
    | { type: 'GLDR_SEARCH'; payload: { query: string; configJSON: string }; id: number }
    | { type: 'GLDR_SEARCH_NODES'; payload: { query: string; configJSON: string }; id: number }
    | { type: 'GLDR_STATS'; id: number }
    | { type: 'GO_STREAM_CHAT'; payload: { messagesJSON: string; systemPrompt?: string }; id: number };

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
    // Store Results
    | { type: 'STORE_UPSERT_SPAN_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_SPAN_RESULT'; id: number; payload: any | null }
    | { type: 'STORE_LIST_SPANS_FOR_NOTE_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_DELETE_SPAN_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_UPSERT_NETWORK_INSTANCE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_NETWORK_INSTANCE_RESULT'; id: number; payload: any | null }
    | { type: 'STORE_LIST_NETWORK_INSTANCES_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_DELETE_NETWORK_INSTANCE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_UPSERT_NETWORK_MEMBERSHIP_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_NETWORK_MEMBERS_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_UPSERT_NETWORK_RELATIONSHIP_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_NETWORK_RELATIONSHIPS_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_UPSERT_DISCOVERY_CANDIDATE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_LIST_DISCOVERY_CANDIDATES_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_UPSERT_ENTITY_CARD_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_UPSERT_ENTITY_CARDS_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_ENTITY_CARDS_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_UPSERT_FOLDER_SCHEMA_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_FOLDER_SCHEMA_RESULT'; id: number; payload: any | null }
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
    | { type: 'CHAT_PROCESS_WITH_WORKSPACE_RESULT'; id: number; payload: string }
    // RAPTOR responses
    | { type: 'RAPTOR_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'RAPTOR_BUILD_TREE_RESULT'; id: number; payload: any }
    | { type: 'RAPTOR_SEARCH_RESULT'; id: number; payload: any }
    | { type: 'RAPTOR_SEARCH_AGGREGATED_RESULT'; id: number; payload: any }
    | { type: 'RAPTOR_SEARCH_LEAF_ONLY_RESULT'; id: number; payload: any }
    | { type: 'RAPTOR_GET_STATS_RESULT'; id: number; payload: any }
    | { type: 'RAPTOR_CLEAR_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'RAPTOR_CHUNK_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'RAPTOR_INGEST_SAB_RESULT'; id: number; payload: { success: boolean; error?: string } }
    // Knowledge Graph responses
    | { type: 'KNOWLEDGE_INIT_RESULT'; id: number; payload: { success: boolean; message?: string; error?: string } }
    | { type: 'KNOWLEDGE_LOAD_RESULT'; id: number; payload: { success: boolean; message?: string; error?: string } }
    | { type: 'KNOWLEDGE_SAVE_RESULT'; id: number; payload: { success: boolean; message?: string; error?: string } }
    | { type: 'KNOWLEDGE_ADD_NODE_RESULT'; id: number; payload: { success: boolean; message?: string; error?: string } }
    | { type: 'KNOWLEDGE_ADD_EDGE_RESULT'; id: number; payload: { success: boolean; message?: string; error?: string } }
    | { type: 'KNOWLEDGE_GET_NODE_RESULT'; id: number; payload: any }
    | { type: 'KNOWLEDGE_GET_CHILDREN_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_PARENTS_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_ANCESTORS_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_DESCENDANTS_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_NEIGHBORHOOD_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_GRAPH_RESULT'; id: number; payload: any }
    // Phase 8: Observational Memory responses
    | { type: 'OM_PROCESS_RESULT'; id: number; payload: { observed: boolean; reflected: boolean } }
    | { type: 'OM_GET_RECORD_RESULT'; id: number; payload: any | null }
    // GLDR Responses
    | { type: 'GLDR_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'GLDR_INDEX_CHUNK_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'GLDR_LOAD_COOCCURRENCES_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'GLDR_SEARCH_RESULT'; id: number; payload: any[] }
    | { type: 'GLDR_SEARCH_NODES_RESULT'; id: number; payload: any[] }
    | { type: 'GLDR_STATS_RESULT'; id: number; payload: any }
    | { type: 'GO_STREAM_CHAT_CHUNK'; id: number; payload: { chunk: string } }
    | { type: 'GO_STREAM_CHAT_RESULT'; id: number; payload: { response: string; error?: string } }
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
        // Search index is now populated via hydrateNotes() for performance.
        console.log('[GoKittService] 🔎 Search Index init deferred to hydration.');
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
     * Persist graph scan results to SQLite via GoKitt
     * Maps GoKitt nodes → entities, edges → entity_edge
     * 
     * @param scanResult - Result from scan() containing graph.Nodes and graph.Edges
     * @param noteId - The note ID for provenance tracking
     * @param narrativeId - Optional narrative scope for the entities
     * @returns Stats on persisted nodes/edges
     */
    async persistGraph(
        scanResult: any,
        noteId: string,
        narrativeId?: string
    ): Promise<{ nodesCreated: number; nodesUpdated: number; edgesCreated: number; edgesUpdated: number }> {
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

        const knowledgePromises: Promise<any>[] = [];

        // ─────────────────────────────────────────────────────────────
        // Persist Nodes → entities table AND Knowledge Graph (GoKitt)
        // ─────────────────────────────────────────────────────────────
        if (nodes && typeof nodes === 'object') {
            const nodeIdMap = new Map<string, string>(); // GoKitt ID → Entity ID

            for (const [goKittId, node] of Object.entries(nodes) as [string, any][]) {
                const label = node.Label || node.label || goKittId;
                const kind = (node.Kind || node.kind || 'UNKNOWN').toUpperCase() as EntityKind;

                // Sync to Knowledge Graph (Phase 4)
                knowledgePromises.push(this.knowledgeAddNode({
                    id: goKittId,
                    kind: kind,
                    label: label,
                    props: { narrativeId }
                }));

                // Check if entity already exists (via smartGraphRegistry)
                const existing = smartGraphRegistry.findEntityByLabel(label);

                if (existing) {
                    // Entity exists - increment mention count
                    const currentCount = existing.mentionsByNote?.get(noteId) ?? 0;
                    existing.mentionsByNote?.set(noteId, currentCount + 1);
                    nodeIdMap.set(goKittId, existing.id);
                    stats.nodesUpdated++;
                } else {
                    // Create new entity
                    const result = smartGraphRegistry.registerEntity(label, kind, noteId, {
                        aliases: node.Aliases || node.aliases || []
                    });
                    nodeIdMap.set(goKittId, result.entity.id);
                    stats.nodesCreated++;
                }
            }

            // ─────────────────────────────────────────────────────────────
            // Persist Edges → relationships table AND Knowledge Graph (GoKitt)
            // ─────────────────────────────────────────────────────────────
            if (edges && Array.isArray(edges)) {
                for (const edge of edges) {
                    const sourceIdx = edge.Source || edge.source;
                    const targetIdx = edge.Target || edge.target;
                    const relation = (edge.Type || edge.type || 'RELATED_TO').toUpperCase();
                    const confidence = edge.Confidence ?? edge.confidence ?? 1;

                    // Sync to Knowledge Graph (Phase 4)
                    knowledgePromises.push(this.knowledgeAddEdge({
                        source: sourceIdx,
                        target: targetIdx,
                        relation: relation,
                        weight: confidence,
                        props: { noteId }
                    }));

                    // Legacy GraphRegistry Logic requires resolved IDs
                    const sourceId = nodeIdMap.get(sourceIdx);
                    const targetId = nodeIdMap.get(targetIdx);

                    if (sourceId && targetId) {
                        const existingRel = smartGraphRegistry.findEdge(sourceId, targetId, relation);

                        // We register/update via smartGraphRegistry
                        const rel = smartGraphRegistry.createEdge(
                            sourceId,
                            targetId,
                            relation,
                            {
                                sourceNote: noteId,
                                weight: confidence,
                                provenance: 'scanner'
                            }
                        );

                        if (existingRel) {
                            stats.edgesUpdated++;
                            console.log(`[GoKittService.persistGraph] Updated edge: ${relation}`);
                        } else if (rel) {
                            stats.edgesCreated++;
                            console.log(`[GoKittService.persistGraph] Created edge: ${relation} (${sourceId} → ${targetId})`);
                        }
                    } else {
                        // IDs might be missing if nodes weren't created successfully or mapped
                    }
                }
            }
        }

        // Wait for all Knowledge Graph updates
        if (this.wasmLoaded) {
            await Promise.all(knowledgePromises);
            await this.knowledgeSave(); // Persist to disk
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
                        // Store Results
                        case 'STORE_UPSERT_SPAN_RESULT':
                        case 'STORE_GET_SPAN_RESULT':
                        case 'STORE_LIST_SPANS_FOR_NOTE_RESULT':
                        case 'STORE_DELETE_SPAN_RESULT':
                        case 'STORE_UPSERT_NETWORK_INSTANCE_RESULT':
                        case 'STORE_GET_NETWORK_INSTANCE_RESULT':
                        case 'STORE_LIST_NETWORK_INSTANCES_RESULT':
                        case 'STORE_DELETE_NETWORK_INSTANCE_RESULT':
                        case 'STORE_UPSERT_NETWORK_MEMBERSHIP_RESULT':
                        case 'STORE_GET_NETWORK_MEMBERS_RESULT':
                        case 'STORE_UPSERT_NETWORK_RELATIONSHIP_RESULT':
                        case 'STORE_GET_NETWORK_RELATIONSHIPS_RESULT':
                        case 'STORE_UPSERT_DISCOVERY_CANDIDATE_RESULT':
                        case 'STORE_LIST_DISCOVERY_CANDIDATES_RESULT':
                        case 'STORE_UPSERT_ENTITY_CARD_RESULT':
                        case 'STORE_UPSERT_ENTITY_CARDS_RESULT':
                        case 'STORE_GET_ENTITY_CARDS_RESULT':
                        case 'STORE_UPSERT_FOLDER_SCHEMA_RESULT':
                        case 'STORE_GET_FOLDER_SCHEMA_RESULT':
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
                        case 'CHAT_PROCESS_WITH_WORKSPACE_RESULT':
                        // RAPTOR responses
                        case 'RAPTOR_INIT_RESULT':
                        case 'RAPTOR_CHUNK_RESULT':
                        case 'RAPTOR_INGEST_SAB_RESULT':
                        case 'RAPTOR_BUILD_TREE_RESULT':
                        case 'RAPTOR_SEARCH_RESULT':
                        case 'RAPTOR_SEARCH_AGGREGATED_RESULT':
                        case 'RAPTOR_SEARCH_LEAF_ONLY_RESULT':
                        case 'RAPTOR_GET_STATS_RESULT':
                        case 'RAPTOR_CLEAR_RESULT':
                        // Knowledge Graph Responses
                        case 'KNOWLEDGE_INIT_RESULT':
                        case 'KNOWLEDGE_LOAD_RESULT':
                        case 'KNOWLEDGE_SAVE_RESULT':
                        case 'KNOWLEDGE_ADD_NODE_RESULT':
                        case 'KNOWLEDGE_ADD_EDGE_RESULT':
                        case 'KNOWLEDGE_GET_NODE_RESULT':
                        case 'KNOWLEDGE_GET_CHILDREN_RESULT':
                        case 'KNOWLEDGE_GET_PARENTS_RESULT':
                        case 'KNOWLEDGE_GET_ANCESTORS_RESULT':
                        case 'KNOWLEDGE_GET_DESCENDANTS_RESULT':
                        case 'KNOWLEDGE_GET_NEIGHBORHOOD_RESULT':
                        case 'KNOWLEDGE_GET_GRAPH_RESULT':
                        // GLDR responses
                        case 'GLDR_INIT_RESULT':
                        case 'GLDR_INDEX_CHUNK_RESULT':
                        case 'GLDR_LOAD_COOCCURRENCES_RESULT':
                        case 'GLDR_SEARCH_RESULT':
                        case 'GLDR_SEARCH_NODES_RESULT':
                        case 'GLDR_STATS_RESULT':
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
    async hydrateNotes(notes: Array<{ id: string; text: string; version?: number; narrativeId?: string; folderPath?: string }>): Promise<{ success: boolean; error?: string }> {
        console.log(`[GoKittService.hydrateNotes] Hydrating ${notes.length} notes...`);

        // DEBUG: Log first note content to verify text is present
        if (notes.length > 0) {
            const first = notes[0];
            console.log(`[GoKittService.hydrateNotes] Sample Note [${first.id}]: text len=${first.text?.length}, preview="${first.text?.substring(0, 50)}..."`);
        }

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

    /**
     * Start a streaming chat response via OpenRouter (Go WASM)
     * @param messagesJSON JSON string of the message history
     * @param systemPrompt Optional system override
     * @param onChunk Callback for each generated chunk
     */
    async goStreamChat(messagesJSON: string, systemPrompt: string, onChunk: (chunk: string) => void): Promise<{ response: string; error?: string }> {
        if (!this.wasmLoaded) return { response: '', error: 'WASM not loaded' };

        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;

            // Set up a custom long-lived pending request handler in pendingRequests map.
            // When we receive chunks, we want to call onChunk but NOT resolve the promise yet.
            const chunkHandler = (e: MessageEvent<GoKittWorkerResponse>) => {
                const msg = e.data;
                if ('id' in msg && msg.id === id) {
                    if (msg.type === 'GO_STREAM_CHAT_CHUNK') {
                        onChunk(msg.payload.chunk);
                        return; // do not remove listener
                    } else if (msg.type === 'GO_STREAM_CHAT_RESULT') {
                        this._worker?.removeEventListener('message', chunkHandler);
                        resolve(msg.payload);
                    } else if (msg.type === 'ERROR') {
                        this._worker?.removeEventListener('message', chunkHandler);
                        reject(new Error(msg.payload.message));
                    }
                }
            };

            this._worker?.addEventListener('message', chunkHandler);

            this._worker?.postMessage({
                type: 'GO_STREAM_CHAT',
                payload: { messagesJSON, systemPrompt },
                id
            } as GoKittWorkerMessage);
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

    /**
     * Run the OM loop + workspace miss-signal check.
     * If a miss fires, the workspace activates: searches notes/episodes,
     * then injects resurfaced context back into the OM observations.
     *
     * @param threadId   Chat thread ID (source of OM record)
     * @param scopeId    Narrative/world scope for episode search
     * @param userPrompt The user's latest message (miss-signal query)
     * @returns JSON-encoded ActivationResult from Go
     */
    async chatProcessWithWorkspace(threadId: string, scopeId: string, userPrompt: string): Promise<string> {
        if (!this.wasmLoaded) {
            return JSON.stringify({ triggered: false, error: 'WASM not loaded' });
        }
        return this.sendRequest('CHAT_PROCESS_WITH_WORKSPACE', { threadId, scopeId, userPrompt });
    }

    // =========================================================================
    // Store API
    // =========================================================================

    async storeUpsertSpan(span: any): Promise<{ success: boolean; error?: string }> {
        const spanJSON = JSON.stringify(span);
        return this.sendRequest('STORE_UPSERT_SPAN', { spanJSON });
    }

    async storeGetSpan(id: string): Promise<any | null> {
        return this.sendRequest('STORE_GET_SPAN', { id });
    }

    async storeListSpansForNote(noteId: string): Promise<any[]> {
        return this.sendRequest('STORE_LIST_SPANS_FOR_NOTE', { noteId });
    }

    async storeDeleteSpan(id: string): Promise<{ success: boolean; error?: string }> {
        return this.sendRequest('STORE_DELETE_SPAN', { id });
    }

    async storeUpsertNetworkInstance(network: any): Promise<{ success: boolean; error?: string }> {
        const networkJSON = JSON.stringify(network);
        return this.sendRequest('STORE_UPSERT_NETWORK_INSTANCE', { networkJSON });
    }

    async storeGetNetworkInstance(id: string): Promise<any | null> {
        return this.sendRequest('STORE_GET_NETWORK_INSTANCE', { id });
    }

    async storeListNetworkInstances(): Promise<any[]> {
        return this.sendRequest('STORE_LIST_NETWORK_INSTANCES', {});
    }

    async storeDeleteNetworkInstance(id: string): Promise<{ success: boolean; error?: string }> {
        return this.sendRequest('STORE_DELETE_NETWORK_INSTANCE', { id });
    }

    async storeUpsertNetworkMembership(member: any): Promise<{ success: boolean; error?: string }> {
        const memberJSON = JSON.stringify(member);
        return this.sendRequest('STORE_UPSERT_NETWORK_MEMBERSHIP', { memberJSON });
    }

    async storeGetNetworkMembers(networkId: string): Promise<any[]> {
        return this.sendRequest('STORE_GET_NETWORK_MEMBERS', { networkId });
    }

    async storeDeleteNetworkMembership(networkId: string, entityId: string): Promise<{ success: boolean; error?: string }> {
        return this.sendRequest('STORE_DELETE_NETWORK_MEMBERSHIP', { networkId, entityId });
    }

    async storeUpsertNetworkRelationship(rel: any): Promise<{ success: boolean; error?: string }> {
        const relJSON = JSON.stringify(rel);
        return this.sendRequest('STORE_UPSERT_NETWORK_RELATIONSHIP', { relJSON });
    }

    async storeGetNetworkRelationships(networkId: string): Promise<any[]> {
        return this.sendRequest('STORE_GET_NETWORK_RELATIONSHIPS', { networkId });
    }

    async storeDeleteNetworkRelationship(networkId: string, relationshipId: string): Promise<{ success: boolean; error?: string }> {
        return this.sendRequest('STORE_DELETE_NETWORK_RELATIONSHIP', { networkId, relationshipId });
    }

    async storeUpsertDiscoveryCandidate(candidate: any): Promise<{ success: boolean; error?: string }> {
        const candidateJSON = JSON.stringify(candidate);
        return this.sendRequest('STORE_UPSERT_DISCOVERY_CANDIDATE', { candidateJSON });
    }

    async storeListDiscoveryCandidates(): Promise<any[]> {
        return this.sendRequest('STORE_LIST_DISCOVERY_CANDIDATES', {});
    }

    async storeUpsertEntityCard(card: any): Promise<{ success: boolean; error?: string }> {
        const cardJSON = JSON.stringify(card);
        return this.sendRequest('STORE_UPSERT_ENTITY_CARD', { cardJSON });
    }

    async storeUpsertEntityCards(cards: any[]): Promise<{ success: boolean; error?: string }> {
        const cardsJSON = JSON.stringify(cards);
        return this.sendRequest('STORE_UPSERT_ENTITY_CARDS', { cardsJSON });
    }

    async storeGetEntityCards(entityId: string): Promise<any[]> {
        return this.sendRequest('STORE_GET_ENTITY_CARDS', { entityId });
    }

    async storeUpsertFolderSchema(schema: any): Promise<{ success: boolean; error?: string }> {
        const schemaJSON = JSON.stringify(schema);
        return this.sendRequest('STORE_UPSERT_FOLDER_SCHEMA', { schemaJSON });
    }

    async storeGetFolderSchema(id: string): Promise<any | null> {
        return this.sendRequest('STORE_GET_FOLDER_SCHEMA', { id });
    }

    // =========================================================================
    // Knowledge Graph API (Phase 4: Unification)
    // =========================================================================

    /** Initialize the in-memory knowledge graph */
    async knowledgeInit(): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this.wasmLoaded) return { success: false, error: 'WASM not loaded' };
        return this.sendRequest('KNOWLEDGE_INIT', {});
    }

    /** Load graph from SQLite persistent store */
    async knowledgeLoad(): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this.wasmLoaded) return { success: false, error: 'WASM not loaded' };
        return this.sendRequest('KNOWLEDGE_LOAD', {});
    }

    /** Save in-memory graph to SQLite persistent store */
    async knowledgeSave(): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this.wasmLoaded) return { success: false, error: 'WASM not loaded' };
        return this.sendRequest('KNOWLEDGE_SAVE', {});
    }

    /** Add or update a node in the knowledge graph */
    async knowledgeAddNode(node: { id: string; kind: string; label?: string; props?: Record<string, any> }): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this.wasmLoaded) return { success: false, error: 'WASM not loaded' };
        const nodeJSON = JSON.stringify(node);
        return this.sendRequest('KNOWLEDGE_ADD_NODE', { nodeJSON });
    }

    /** Add a directed edge to the knowledge graph */
    async knowledgeAddEdge(edge: { source: string; target: string; relation: string; weight?: number; props?: Record<string, any> }): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this.wasmLoaded) return { success: false, error: 'WASM not loaded' };
        const edgeJSON = JSON.stringify(edge);
        return this.sendRequest('KNOWLEDGE_ADD_EDGE', { edgeJSON });
    }

    /** Get a node by ID */
    async knowledgeGetNode(id: string): Promise<any> {
        if (!this.wasmLoaded) return null;
        return this.sendRequest('KNOWLEDGE_GET_NODE', { id });
    }

    /** Get children of a node (outbound edges) */
    async knowledgeGetChildren(id: string, relation?: string): Promise<any[]> {
        if (!this.wasmLoaded) return [];
        return this.sendRequest('KNOWLEDGE_GET_CHILDREN', { id, relation });
    }

    /** Get parents of a node (inbound edges) */
    async knowledgeGetParents(id: string, relation?: string): Promise<any[]> {
        if (!this.wasmLoaded) return [];
        return this.sendRequest('KNOWLEDGE_GET_PARENTS', { id, relation });
    }

    /** Get ancestors (recursive parents) */
    async knowledgeGetAncestors(id: string, relation?: string, maxDepth = -1): Promise<any[]> {
        if (!this.wasmLoaded) return [];
        return this.sendRequest('KNOWLEDGE_GET_ANCESTORS', { id, relation, maxDepth });
    }

    /** Get descendants (recursive children) */
    async knowledgeGetDescendants(id: string, relation?: string, maxDepth = -1): Promise<any[]> {
        if (!this.wasmLoaded) return [];
        return this.sendRequest('KNOWLEDGE_GET_DESCENDANTS', { id, relation, maxDepth });
    }

    /** Get immediate neighborhood (both in and out) */
    async knowledgeGetNeighborhood(id: string): Promise<any[]> {
        if (!this.wasmLoaded) return [];
        return this.sendRequest('KNOWLEDGE_GET_NEIGHBORHOOD', { id });
    }

    /** Get the full knowledge graph (for visualization) */
    async knowledgeGetGraph(): Promise<{ nodes: any; edges: any[] }> {
        if (!this.wasmLoaded) return { nodes: {}, edges: [] };
        return this.sendRequest('KNOWLEDGE_GET_GRAPH', {});
    }

    // =========================================================================
    // GLDR API — Graph-Based Lexical Document Retrieval (Graptor's retriever)
    // These methods become active once the WASM bridge exports are wired.
    // =========================================================================

    /** Initialize the GLDR in-memory index. */
    async gldrInit(): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) return { success: false, error: 'WASM not loaded' };
        return this.sendRequest('GLDR_INIT', {});
    }

    /**
     * Index a single chunk into GLDR.
     * @param chunkId  Stable chunk identifier (e.g. chapter-3)
     * @param fields   Field map { content: string, title?: string }
     * @param mentions Entity mentions in this chunk (from Graptor conductor)
     */
    async gldrIndexChunk(
        chunkId: string,
        fields: Record<string, string>,
        mentions: Array<{ entityId: string; count: number }>
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.wasmLoaded) return { success: false, error: 'WASM not loaded' };
        const fieldsJSON = JSON.stringify(fields);
        const mentionsJSON = JSON.stringify(mentions);
        return this.sendRequest('GLDR_INDEX_CHUNK', { chunkId, fieldsJSON, mentionsJSON });
    }

    /**
     * Bulk-load entity co-occurrence graph from Graptor's CooccurrenceStats.
     * @param minCount Minimum co-occurrence count to include as an edge
     */
    async gldrLoadCooccurrences(minCount = 2): Promise<{ success: boolean; edgesLoaded?: number; error?: string }> {
        if (!this.wasmLoaded) return { success: false, error: 'WASM not loaded' };
        return this.sendRequest('GLDR_LOAD_COOCCURRENCES', { minCount });
    }

    /**
     * Run fused lexical + graph proximity search.
     * @param query      Natural language query string
     * @param config     Optional GLDRConfig overrides
     * @returns JSON-encoded GraptorSearchResult[]
     */
    async gldrSearch(query: string, config: Record<string, unknown> = {}): Promise<string> {
        if (!this.wasmLoaded) return '[]';
        const configJSON = JSON.stringify(config);
        return this.sendRequest('GLDR_SEARCH', { query, configJSON });
    }

    /**
     * Run entity node ranking search.
     * @param query  Natural language query string
     * @param config Optional GLDRConfig overrides
     * @returns JSON-encoded GraptorNodeResult[]
     */
    async gldrSearchNodes(query: string, config: Record<string, unknown> = {}): Promise<string> {
        if (!this.wasmLoaded) return '[]';
        const configJSON = JSON.stringify(config);
        return this.sendRequest('GLDR_SEARCH_NODES', { query, configJSON });
    }

    /**
     * Get GLDR index statistics.
     * @returns JSON-encoded { entities: number, chunks: number, edges: number }
     */
    async gldrStats(): Promise<string> {
        if (!this.wasmLoaded) return '{"entities":0,"chunks":0,"edges":0}';
        return this.sendRequest('GLDR_STATS', {});
    }
}
