/// <reference lib="webworker" />
/**
 * GoKitt WASM Worker
 *
 * Runs the Go WASM module in a dedicated Web Worker to prevent UI blocking
 * during heavy operations (Reality Layer, PCST, Discovery).
 */

// =============================================================================
// Types
// =============================================================================

/** Provenance context for folder-aware graph projection */
interface ProvenanceContext {
    vaultId?: string;
    worldId: string;
    parentPath?: string;
    folderType?: string;
}

/** Scope filter for search */
interface SearchScope {
    narrativeId?: string;
    folderPath?: string;
}

/** Incoming messages from main thread */
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
    | { type: 'HYDRATE_NOTES'; payload: { notesJSON: string }; id: number }
    | { type: 'UPSERT_NOTE'; payload: { id: string; text: string; version?: number }; id: number }
    | { type: 'REMOVE_NOTE'; payload: { id: string }; id: number }
    | { type: 'SCAN_NOTE'; payload: { noteId: string; provenance?: ProvenanceContext }; id: number }
    | { type: 'VALIDATE_RELATIONS'; payload: { noteId: string; relationsJSON: string }; id: number }
    | { type: 'DOC_COUNT'; id: number }
    // SQLite Store API
    | { type: 'STORE_INIT'; id: number }
    | { type: 'STORE_UPSERT_NOTE'; payload: { noteJSON: string }; id: number }
    | { type: 'STORE_GET_NOTE'; payload: { id: string }; id: number }
    | { type: 'STORE_DELETE_NOTE'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_NOTES'; payload: { folderId?: string }; id: number }
    | { type: 'STORE_UPSERT_ENTITY'; payload: { entityJSON: string }; id: number }
    | { type: 'STORE_GET_ENTITY'; payload: { id: string }; id: number }
    | { type: 'STORE_GET_ENTITY_BY_LABEL'; payload: { label: string }; id: number }
    | { type: 'STORE_DELETE_ENTITY'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_ENTITIES'; payload: { kind?: string }; id: number }
    | { type: 'STORE_UPSERT_EDGE'; payload: { edgeJSON: string }; id: number }
    | { type: 'STORE_GET_EDGE'; payload: { id: string }; id: number }
    | { type: 'STORE_DELETE_EDGE'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_EDGES'; payload: { entityId: string }; id: number }
    // Store Export/Import (OPFS Sync)
    | { type: 'STORE_EXPORT'; id: number }
    | { type: 'STORE_IMPORT'; payload: { data: ArrayBuffer }; id: number }
    // Store Folder CRUD
    | { type: 'STORE_UPSERT_FOLDER'; payload: { folderJSON: string }; id: number }
    | { type: 'STORE_GET_FOLDER'; payload: { id: string }; id: number }
    | { type: 'STORE_DELETE_FOLDER'; payload: { id: string }; id: number }
    | { type: 'STORE_LIST_FOLDERS'; payload: { parentId?: string }; id: number }
    // Phase 3: Graph Merger API
    | { type: 'MERGER_INIT'; id: number }
    | { type: 'MERGER_ADD_SCANNER'; payload: { noteId: string; graphJSON: string }; id: number }
    | { type: 'MERGER_ADD_LLM'; payload: { edgesJSON: string }; id: number }
    | { type: 'MERGER_ADD_MANUAL'; payload: { edgesJSON: string }; id: number }
    | { type: 'MERGER_GET_GRAPH'; id: number }
    | { type: 'MERGER_GET_STATS'; id: number }
    // Phase 4: PCST Coherence Filter
    | { type: 'MERGER_RUN_PCST'; payload: { prizesJSON: string; rootID?: string }; id: number }
    // Phase 5: SharedArrayBuffer Zero-Copy
    | { type: 'SAB_INIT'; payload: { sab: SharedArrayBuffer }; id: number }
    | { type: 'SAB_SCAN_TO_BUFFER'; payload: { text: string }; id: number }
    | { type: 'SAB_GET_STATUS'; id: number }
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
    | { type: 'CHAT_EXPORT_THREAD'; payload: { threadId: string }; id: number }
    // Phase 8: Observational Memory
    | { type: 'OM_PROCESS'; payload: { threadId: string }; id: number }
    | { type: 'OM_GET_RECORD'; payload: { threadId: string }; id: number }
    | { type: 'OM_OBSERVE'; payload: { threadId: string }; id: number }
    | { type: 'OM_REFLECT'; payload: { threadId: string }; id: number }
    | { type: 'OM_CLEAR'; payload: { threadId: string }; id: number }
    | { type: 'OM_SET_CONFIG'; payload: { enabled: boolean; observeThreshold: number; reflectThreshold: number }; id: number }
    // Phase 9: RLM Engine
    | { type: 'RLM_EXECUTE'; payload: { requestJSON: string }; id: number };

/** Outgoing messages to main thread */
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
    // Store Export/Import responses
    | { type: 'STORE_EXPORT_RESULT'; id: number; payload: { data: ArrayBuffer; size: number } | { success: false; error: string } }
    | { type: 'STORE_IMPORT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    // Store Folder responses
    | { type: 'STORE_UPSERT_FOLDER_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_FOLDER_RESULT'; id: number; payload: any | null }
    | { type: 'STORE_DELETE_FOLDER_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_LIST_FOLDERS_RESULT'; id: number; payload: any[] }
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
    // Phase 8: Observational Memory responses
    | { type: 'OM_PROCESS_RESULT'; id: number; payload: { observed: boolean; reflected: boolean } }
    | { type: 'OM_GET_RECORD_RESULT'; id: number; payload: any | null }
    | { type: 'OM_OBSERVE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'OM_REFLECT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'OM_CLEAR_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'OM_SET_CONFIG_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'RLM_EXECUTE_RESULT'; id: number; payload: string }
    | { type: 'ERROR'; id?: number; payload: { message: string } };

// =============================================================================
// Global State & Polyfills
// =============================================================================

// Polyfill 'global' for Go WASM
(self as any).global = self;

// Polyfill 'fs' for Go WASM
(self as any).fs = {
    constants: {
        O_WRONLY: 1,
        O_RDWR: 2,
        O_CREAT: 0,
        O_TRUNC: 0,
        O_APPEND: 0,
        O_EXCL: 0,
        O_SYNC: 0,
        O_RDONLY: 0,
        O_DIRECTORY: -1
    },
    writeSync(fd: number, buf: Uint8Array) {
        const output = new TextDecoder('utf-8').decode(buf);
        if (fd === 1) console.log(output);
        else console.error(output);
        return buf.length;
    },
    write(
        fd: number,
        buf: Uint8Array,
        offset: number,
        length: number,
        position: number | null,
        callback: (err: Error | null, n: number) => void
    ) {
        if (offset !== 0 || length !== buf.length || position !== null) {
            callback(new Error('not implemented'), 0);
            return;
        }
        const n = this.writeSync(fd, buf);
        callback(null, n);
    },
    open(path: string, flags: any, mode: any, callback: (err: Error | null, fd: number) => void) {
        const err = new Error('not implemented');
        (err as any).code = 'ENOSYS';
        callback(err, 0);
    },
    fsync(fd: number, callback: (err: Error | null) => void) {
        callback(null);
    }
};

// =============================================================================
// Go Runtime Loading
// =============================================================================

let wasmLoaded = false;
let goInstance: any = null;

// Declare GoKitt global (created by Go WASM)
declare const GoKitt: {
    initialize: (entitiesJSON?: string) => string;
    scan: (text: string, provenanceJSON?: string) => string;
    scanImplicit: (text: string) => string;
    scanDiscovery: (text: string) => string;
    rebuildDictionary: (entitiesJSON: string) => string;
    indexNote: (id: string, text: string, scopeJSON?: string) => string;
    search: (queryJSON: string, limit: number, vectorJSON?: string, scopeJSON?: string) => string;
    initVectors: () => string;
    addVector: (id: string, vectorJSON: string) => string;
    searchVectors: (vectorJSON: string, k: number) => string;
    saveVectors: () => string;
    // DocStore API
    hydrateNotes: (notesJSON: string) => string;
    upsertNote: (id: string, text: string, version?: number) => string;
    removeNote: (id: string) => string;
    scanNote: (noteId: string, provenanceJSON?: string) => string;
    docCount: () => number;
    // Phase 2: CST Validation
    validateRelations: (noteId: string, relationsJSON: string) => string;
    // SQLite Store API
    storeInit: () => string;
    storeUpsertNote: (noteJSON: string) => string;
    storeGetNote: (id: string) => string;
    storeDeleteNote: (id: string) => string;
    storeListNotes: (folderId?: string) => string;
    storeUpsertEntity: (entityJSON: string) => string;
    storeGetEntity: (id: string) => string;
    storeGetEntityByLabel: (label: string) => string;
    storeDeleteEntity: (id: string) => string;
    storeListEntities: (kind?: string) => string;
    storeUpsertEdge: (edgeJSON: string) => string;
    storeGetEdge: (id: string) => string;
    storeDeleteEdge: (id: string) => string;
    storeListEdges: (entityId: string) => string;
    // Store Export/Import (OPFS Sync)
    storeExport: () => any; // Returns Uint8Array
    storeImport: (data: any) => string; // Accepts Uint8Array
    // Store Folder CRUD
    storeUpsertFolder: (folderJSON: string) => string;
    storeGetFolder: (id: string) => string;
    storeDeleteFolder: (id: string) => string;
    storeListFolders: (parentId?: string) => string;
    // Phase 3: Graph Merger API
    mergerInit: () => string;
    mergerAddScanner: (noteId: string, graphJSON: string) => string;
    mergerAddLLM: (edgesJSON: string) => string;
    mergerAddManual: (edgesJSON: string) => string;
    mergerGetGraph: () => string;
    mergerGetStats: () => string;
    // Phase 4: PCST Coherence Filter
    mergerRunPCST: (prizesJSON: string, rootID?: string) => string;
    // Phase 5: SharedArrayBuffer Zero-Copy
    sabInit: (sab: SharedArrayBuffer) => string;
    sabScanToBuffer: (text: string) => string;
    sabGetBufferStatus: () => string;
    // Phase 6: LLM Batch + Extraction + Agent (async - returns Promise)
    batchInit: (configJSON: string) => string;
    extractFromNote: (text: string, knownEntitiesJSON?: string) => Promise<string>;
    extractEntities: (text: string) => Promise<string>;
    extractRelations: (text: string, knownEntitiesJSON?: string) => Promise<string>;
    agentChatWithTools: (messagesJSON: string, toolsJSON: string, systemPrompt?: string) => Promise<string>;
    // Phase 7: Observational Memory + Chat Service
    chatInit: (configJSON: string) => string;
    chatCreateThread: (worldId: string, narrativeId: string) => string;
    chatGetThread: (id: string) => string;
    chatListThreads: (worldId: string) => string;
    chatDeleteThread: (id: string) => string;
    chatAddMessage: (threadId: string, role: string, content: string, narrativeId: string) => string;
    chatGetMessages: (threadId: string) => string;
    chatUpdateMessage: (messageId: string, content: string) => string;
    chatAppendMessage: (messageId: string, chunk: string) => string;
    chatStartStreaming: (threadId: string, narrativeId: string) => string;
    chatGetMemories: (threadId: string) => string;
    chatGetContext: (threadId: string) => string;
    chatClearThread: (threadId: string) => string;
    chatExportThread: (threadId: string) => string;
    // Phase 8: Observational Memory
    omProcess: (threadId: string) => string;
    omGetRecord: (threadId: string) => string;
    omObserve: (threadId: string) => string;
    omReflect: (threadId: string) => string;
    omClear: (threadId: string) => string;
    omSetConfig: (configJSON: string) => string;
    // Phase 9: RLM Engine
    rlmExecute: (requestJSON: string) => string;
};

/**
 * Load wasm_exec.js and instantiate the Go WASM module
 */
async function loadWasm(): Promise<void> {
    if (wasmLoaded) return;

    console.log('[GoKittWorker] Loading wasm_exec.js...');

    // Load wasm_exec.js manually since importScripts is not available in module workers
    const execResponse = await fetch('/assets/wasm_exec.js');
    const execScript = await execResponse.text();
    // Execute global script
    const globalEval = eval;
    globalEval(execScript);

    // Now Go class should be available
    const Go = (self as any).Go;
    if (!Go) {
        throw new Error('[GoKittWorker] Go class not found after loading wasm_exec.js');
    }

    goInstance = new Go();

    console.log('[GoKittWorker] Loading gokitt.wasm...');

    const wasmUrl = `/assets/gokitt.wasm?v=${Date.now()}`;
    const result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), goInstance.importObject);

    // Run Go main (non-blocking - runs event loop in background)
    goInstance.run(result.instance);

    // Wait for exports to be registered
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // Verify GoKitt is available
    if (typeof GoKitt === 'undefined') {
        throw new Error('[GoKittWorker] GoKitt global not found after WASM init');
    }

    wasmLoaded = true;
    console.log('[GoKittWorker] ✅ WASM loaded and ready');
}

// =============================================================================
// Message Handler
// =============================================================================

self.onmessage = async (e: MessageEvent<GoKittWorkerMessage>) => {
    const msg = e.data;
    console.log('[GoKittWorker] Received:', msg.type);

    try {
        switch (msg.type) {
            case 'RLM_EXECUTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RLM_EXECUTE_RESULT',
                        id: msg.id,
                        payload: JSON.stringify({ error: 'WASM not loaded' })
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.rlmExecute(msg.payload.requestJSON);

                self.postMessage({
                    type: 'RLM_EXECUTE_RESULT',
                    id: msg.id,
                    payload: res // Already JSON string
                } as GoKittWorkerResponse);
                break;
            }

            case 'INIT': {
                await loadWasm();
                self.postMessage({ type: 'INIT_COMPLETE' } as GoKittWorkerResponse);
                break;
            }

            case 'HYDRATE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'HYDRATE_COMPLETE',
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.initialize(msg.payload.entitiesJSON);
                let success = true;
                let error: string | undefined;

                try {
                    const parsed = JSON.parse(res);
                    if (parsed.error) {
                        success = false;
                        error = parsed.error;
                    }
                } catch {
                    // Ignore parse error for simple success string
                }

                self.postMessage({
                    type: 'HYDRATE_COMPLETE',
                    payload: { success, error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'SCAN': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const provJSON = msg.payload.provenance
                    ? JSON.stringify(msg.payload.provenance)
                    : '';
                const json = GoKitt.scan(msg.payload.text, provJSON);
                const result = JSON.parse(json);

                self.postMessage({
                    type: 'SCAN_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }

            case 'SCAN_IMPLICIT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'SCAN_IMPLICIT_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const json = GoKitt.scanImplicit(msg.payload.text);
                const spans = JSON.parse(json);

                self.postMessage({
                    type: 'SCAN_IMPLICIT_RESULT',
                    id: msg.id,
                    payload: spans
                } as GoKittWorkerResponse);
                break;
            }

            case 'SCAN_DISCOVERY': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'SCAN_DISCOVERY_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const json = GoKitt.scanDiscovery(msg.payload.text);
                const candidates = JSON.parse(json);

                self.postMessage({
                    type: 'SCAN_DISCOVERY_RESULT',
                    id: msg.id,
                    payload: candidates
                } as GoKittWorkerResponse);
                break;
            }

            case 'REBUILD_DICTIONARY': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'REBUILD_DICTIONARY_RESULT',
                        id: msg.id,
                        payload: { success: false as boolean, error: 'WASM not loaded' }
                    });
                    return;
                }

                try {
                    const result = GoKitt.rebuildDictionary(msg.payload.entitiesJSON);
                    const parsed = JSON.parse(result);
                    self.postMessage({
                        type: 'REBUILD_DICTIONARY_RESULT',
                        id: msg.id,
                        payload: { success: !parsed.error as boolean, error: parsed.error }
                    });
                } catch (e) {
                    self.postMessage({
                        type: 'REBUILD_DICTIONARY_RESULT',
                        id: msg.id,
                        payload: { success: false as boolean, error: String(e) }
                    });
                }
                break;
            }

            case 'INDEX_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'INDEX_NOTE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const scopeJSON = msg.payload.scope
                    ? JSON.stringify(msg.payload.scope)
                    : '';
                const res = GoKitt.indexNote(msg.payload.id, msg.payload.text, scopeJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'INDEX_NOTE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'SEARCH': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'SEARCH_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const queryJSON = JSON.stringify(msg.payload.query);
                const limit = msg.payload.limit || 50;
                let vectorJSON = "";
                if (msg.payload.vector) {
                    vectorJSON = JSON.stringify(msg.payload.vector);
                }
                const scopeJSON = msg.payload.scope
                    ? JSON.stringify(msg.payload.scope)
                    : '';

                const res = GoKitt.search(queryJSON, limit, vectorJSON, scopeJSON);
                const results = JSON.parse(res);

                self.postMessage({
                    type: 'SEARCH_RESULT',
                    id: msg.id,
                    payload: results
                } as GoKittWorkerResponse);
                break;
            }

            case 'ADD_VECTOR': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'ADD_VECTOR_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.addVector(msg.payload.id, msg.payload.vectorJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'ADD_VECTOR_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'SEARCH_VECTORS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'SEARCH_VECTORS_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.searchVectors(msg.payload.vectorJSON, msg.payload.k);
                const ids = JSON.parse(res);

                self.postMessage({
                    type: 'SEARCH_VECTORS_RESULT',
                    id: msg.id,
                    payload: ids
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // DocStore API Handlers
            // =================================================================

            case 'HYDRATE_NOTES': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'HYDRATE_NOTES_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.hydrateNotes(msg.payload.notesJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'HYDRATE_NOTES_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'UPSERT_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'UPSERT_NOTE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.upsertNote(
                    msg.payload.id,
                    msg.payload.text,
                    msg.payload.version ?? 0
                );
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'UPSERT_NOTE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'REMOVE_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'REMOVE_NOTE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.removeNote(msg.payload.id);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'REMOVE_NOTE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'SCAN_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const provJSON = msg.payload.provenance
                    ? JSON.stringify(msg.payload.provenance)
                    : '';
                const json = GoKitt.scanNote(msg.payload.noteId, provJSON);
                const result = JSON.parse(json);

                self.postMessage({
                    type: 'SCAN_NOTE_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }

            case 'DOC_COUNT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'DOC_COUNT_RESULT',
                        id: msg.id,
                        payload: 0
                    } as GoKittWorkerResponse);
                    return;
                }

                const count = GoKitt.docCount();

                self.postMessage({
                    type: 'DOC_COUNT_RESULT',
                    id: msg.id,
                    payload: count
                } as GoKittWorkerResponse);
                break;
            }

            case 'VALIDATE_RELATIONS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'VALIDATE_RELATIONS_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded', relations: [], validCount: 0, totalInput: 0 }
                    } as GoKittWorkerResponse);
                    return;
                }

                const json = GoKitt.validateRelations(msg.payload.noteId, msg.payload.relationsJSON);
                const result = JSON.parse(json);

                self.postMessage({
                    type: 'VALIDATE_RELATIONS_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // SQLite Store API Handlers
            // =================================================================

            case 'STORE_INIT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_INIT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeInit();
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_INIT_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_UPSERT_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_UPSERT_NOTE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeUpsertNote(msg.payload.noteJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_UPSERT_NOTE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_GET_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_GET_NOTE_RESULT',
                        id: msg.id,
                        payload: null
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeGetNote(msg.payload.id);
                const note = res === 'null' ? null : JSON.parse(res);

                self.postMessage({
                    type: 'STORE_GET_NOTE_RESULT',
                    id: msg.id,
                    payload: note
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_DELETE_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_DELETE_NOTE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeDeleteNote(msg.payload.id);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_DELETE_NOTE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_LIST_NOTES': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_LIST_NOTES_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeListNotes(msg.payload.folderId || '');
                const parsed = JSON.parse(res);

                // Check for error response from Go
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
                    console.error('[Worker] STORE_LIST_NOTES error:', parsed.error);
                    self.postMessage({
                        type: 'STORE_LIST_NOTES_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                self.postMessage({
                    type: 'STORE_LIST_NOTES_RESULT',
                    id: msg.id,
                    payload: Array.isArray(parsed) ? parsed : []
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_UPSERT_ENTITY': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_UPSERT_ENTITY_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeUpsertEntity(msg.payload.entityJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_UPSERT_ENTITY_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_GET_ENTITY': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_GET_ENTITY_RESULT',
                        id: msg.id,
                        payload: null
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeGetEntity(msg.payload.id);
                const entity = res === 'null' ? null : JSON.parse(res);

                self.postMessage({
                    type: 'STORE_GET_ENTITY_RESULT',
                    id: msg.id,
                    payload: entity
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_GET_ENTITY_BY_LABEL': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_GET_ENTITY_RESULT',
                        id: msg.id,
                        payload: null
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeGetEntityByLabel(msg.payload.label);
                const entity = res === 'null' ? null : JSON.parse(res);

                self.postMessage({
                    type: 'STORE_GET_ENTITY_RESULT',
                    id: msg.id,
                    payload: entity
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_DELETE_ENTITY': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_DELETE_ENTITY_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeDeleteEntity(msg.payload.id);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_DELETE_ENTITY_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_LIST_ENTITIES': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_LIST_ENTITIES_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeListEntities(msg.payload.kind || '');
                const parsed = JSON.parse(res);

                // Check for error response from Go
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
                    console.error('[Worker] STORE_LIST_ENTITIES error:', parsed.error);
                    self.postMessage({
                        type: 'STORE_LIST_ENTITIES_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                self.postMessage({
                    type: 'STORE_LIST_ENTITIES_RESULT',
                    id: msg.id,
                    payload: Array.isArray(parsed) ? parsed : []
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_UPSERT_EDGE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_UPSERT_EDGE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeUpsertEdge(msg.payload.edgeJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_UPSERT_EDGE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_GET_EDGE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_GET_EDGE_RESULT',
                        id: msg.id,
                        payload: null
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeGetEdge(msg.payload.id);
                const edge = res === 'null' ? null : JSON.parse(res);

                self.postMessage({
                    type: 'STORE_GET_EDGE_RESULT',
                    id: msg.id,
                    payload: edge
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_DELETE_EDGE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_DELETE_EDGE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeDeleteEdge(msg.payload.id);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_DELETE_EDGE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_LIST_EDGES': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_LIST_EDGES_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeListEdges(msg.payload.entityId);
                const parsed = JSON.parse(res);

                // Check for error response from Go
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
                    console.error('[Worker] STORE_LIST_EDGES error:', parsed.error);
                    self.postMessage({
                        type: 'STORE_LIST_EDGES_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                self.postMessage({
                    type: 'STORE_LIST_EDGES_RESULT',
                    id: msg.id,
                    payload: Array.isArray(parsed) ? parsed : []
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // Store Export/Import (OPFS Sync)
            // =================================================================

            case 'STORE_EXPORT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_EXPORT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const result = GoKitt.storeExport();
                // storeExport returns a Uint8Array directly (not JSON)
                if (result instanceof Uint8Array) {
                    // Transfer the buffer for zero-copy
                    const buffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                    self.postMessage({
                        type: 'STORE_EXPORT_RESULT',
                        id: msg.id,
                        payload: { data: buffer, size: result.byteLength }
                    } as GoKittWorkerResponse, [buffer]);
                } else {
                    // Probably an error string
                    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
                    self.postMessage({
                        type: 'STORE_EXPORT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: parsed.error || 'Unknown export error' }
                    } as GoKittWorkerResponse);
                }
                break;
            }

            case 'STORE_IMPORT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_IMPORT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const uint8 = new Uint8Array(msg.payload.data);
                const res = GoKitt.storeImport(uint8);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_IMPORT_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // Store Folder CRUD Handlers
            // =================================================================

            case 'STORE_UPSERT_FOLDER': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_UPSERT_FOLDER_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeUpsertFolder(msg.payload.folderJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_UPSERT_FOLDER_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_GET_FOLDER': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_GET_FOLDER_RESULT',
                        id: msg.id,
                        payload: null
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeGetFolder(msg.payload.id);
                const folder = res === 'null' ? null : JSON.parse(res);

                self.postMessage({
                    type: 'STORE_GET_FOLDER_RESULT',
                    id: msg.id,
                    payload: folder
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_DELETE_FOLDER': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_DELETE_FOLDER_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeDeleteFolder(msg.payload.id);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_DELETE_FOLDER_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_LIST_FOLDERS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_LIST_FOLDERS_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeListFolders(msg.payload.parentId || '');
                const parsed = JSON.parse(res);

                // Check for error response from Go
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
                    console.error('[Worker] STORE_LIST_FOLDERS error:', parsed.error);
                    self.postMessage({
                        type: 'STORE_LIST_FOLDERS_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                self.postMessage({
                    type: 'STORE_LIST_FOLDERS_RESULT',
                    id: msg.id,
                    payload: Array.isArray(parsed) ? parsed : []
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // Phase 3: Graph Merger Handlers
            // =================================================================

            case 'MERGER_INIT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'MERGER_INIT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.mergerInit();
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'MERGER_INIT_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'MERGER_ADD_SCANNER': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'MERGER_ADD_SCANNER_RESULT',
                        id: msg.id,
                        payload: { success: false, added: 0, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.mergerAddScanner(msg.payload.noteId, msg.payload.graphJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'MERGER_ADD_SCANNER_RESULT',
                    id: msg.id,
                    payload: { success: parsed.success, added: parsed.added || 0, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'MERGER_ADD_LLM': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'MERGER_ADD_LLM_RESULT',
                        id: msg.id,
                        payload: { success: false, added: 0, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.mergerAddLLM(msg.payload.edgesJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'MERGER_ADD_LLM_RESULT',
                    id: msg.id,
                    payload: { success: parsed.success, added: parsed.added || 0, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'MERGER_ADD_MANUAL': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'MERGER_ADD_MANUAL_RESULT',
                        id: msg.id,
                        payload: { success: false, added: 0, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.mergerAddManual(msg.payload.edgesJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'MERGER_ADD_MANUAL_RESULT',
                    id: msg.id,
                    payload: { success: parsed.success, added: parsed.added || 0, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'MERGER_GET_GRAPH': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'MERGER_GET_GRAPH_RESULT',
                        id: msg.id,
                        payload: { nodes: {}, edges: {} }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.mergerGetGraph();
                const graph = JSON.parse(res);

                self.postMessage({
                    type: 'MERGER_GET_GRAPH_RESULT',
                    id: msg.id,
                    payload: graph
                } as GoKittWorkerResponse);
                break;
            }

            case 'MERGER_GET_STATS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'MERGER_GET_STATS_RESULT',
                        id: msg.id,
                        payload: { totalEdges: 0 }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.mergerGetStats();
                const stats = JSON.parse(res);

                self.postMessage({
                    type: 'MERGER_GET_STATS_RESULT',
                    id: msg.id,
                    payload: stats
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // Phase 4: PCST Coherence Filter Handler
            // =================================================================

            case 'MERGER_RUN_PCST': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'MERGER_RUN_PCST_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.mergerRunPCST(msg.payload.prizesJSON, msg.payload.rootID || '');
                const result = JSON.parse(res);

                self.postMessage({
                    type: 'MERGER_RUN_PCST_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // Phase 5: SharedArrayBuffer Zero-Copy Handlers
            // =================================================================

            case 'SAB_INIT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'SAB_INIT_RESULT',
                        id: msg.id,
                        payload: { success: false, initialized: false, bufferSize: 0, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.sabInit(msg.payload.sab);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'SAB_INIT_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'SAB_SCAN_TO_BUFFER': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'SAB_SCAN_TO_BUFFER_RESULT',
                        id: msg.id,
                        payload: { success: false, spans: 0, payloadSize: 0, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.sabScanToBuffer(msg.payload.text);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'SAB_SCAN_TO_BUFFER_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'SAB_GET_STATUS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'SAB_GET_STATUS_RESULT',
                        id: msg.id,
                        payload: { success: false, initialized: false, bufferSize: 0, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.sabGetBufferStatus();
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'SAB_GET_STATUS_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // Phase 6: LLM Batch + Extraction + Agent Handlers
            // =================================================================

            case 'BATCH_INIT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'BATCH_INIT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.batchInit(msg.payload.configJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'BATCH_INIT_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'EXTRACT_FROM_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                try {
                    // extractFromNote returns a Promise from Go
                    const resultJSON = await GoKitt.extractFromNote(
                        msg.payload.text,
                        msg.payload.knownEntitiesJSON
                    );
                    const parsed = JSON.parse(resultJSON);

                    self.postMessage({
                        type: 'EXTRACT_FROM_NOTE_RESULT',
                        id: msg.id,
                        payload: parsed
                    } as GoKittWorkerResponse);
                } catch (e) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: e instanceof Error ? e.message : String(e) }
                    } as GoKittWorkerResponse);
                }
                break;
            }

            case 'EXTRACT_ENTITIES': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                try {
                    const resultJSON = await GoKitt.extractEntities(msg.payload.text);
                    const parsed = JSON.parse(resultJSON);

                    self.postMessage({
                        type: 'EXTRACT_ENTITIES_RESULT',
                        id: msg.id,
                        payload: parsed
                    } as GoKittWorkerResponse);
                } catch (e) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: e instanceof Error ? e.message : String(e) }
                    } as GoKittWorkerResponse);
                }
                break;
            }

            case 'EXTRACT_RELATIONS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                try {
                    const resultJSON = await GoKitt.extractRelations(
                        msg.payload.text,
                        msg.payload.knownEntitiesJSON
                    );
                    const parsed = JSON.parse(resultJSON);

                    self.postMessage({
                        type: 'EXTRACT_RELATIONS_RESULT',
                        id: msg.id,
                        payload: parsed
                    } as GoKittWorkerResponse);
                } catch (e) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: e instanceof Error ? e.message : String(e) }
                    } as GoKittWorkerResponse);
                }
                break;
            }

            case 'AGENT_CHAT_WITH_TOOLS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                try {
                    const resultJSON = await GoKitt.agentChatWithTools(
                        msg.payload.messagesJSON,
                        msg.payload.toolsJSON,
                        msg.payload.systemPrompt
                    );
                    const parsed = JSON.parse(resultJSON);

                    self.postMessage({
                        type: 'AGENT_CHAT_WITH_TOOLS_RESULT',
                        id: msg.id,
                        payload: parsed
                    } as GoKittWorkerResponse);
                } catch (e) {
                    self.postMessage({
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: e instanceof Error ? e.message : String(e) }
                    } as GoKittWorkerResponse);
                }
                break;
            }

            // =================================================================
            // Phase 7: Observational Memory + Chat Service Handlers
            // =================================================================

            case 'CHAT_INIT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_INIT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatInit(msg.payload.configJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_INIT_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_CREATE_THREAD': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_CREATE_THREAD_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatCreateThread(msg.payload.worldId, msg.payload.narrativeId);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_CREATE_THREAD_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_GET_THREAD': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_GET_THREAD_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatGetThread(msg.payload.id);
                const thread = res === 'null' ? null : JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_GET_THREAD_RESULT',
                    id: msg.id,
                    payload: thread
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_LIST_THREADS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_LIST_THREADS_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatListThreads(msg.payload.worldId);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_LIST_THREADS_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_DELETE_THREAD': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_DELETE_THREAD_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatDeleteThread(msg.payload.id);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_DELETE_THREAD_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_ADD_MESSAGE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_ADD_MESSAGE_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatAddMessage(
                    msg.payload.threadId,
                    msg.payload.role,
                    msg.payload.content,
                    msg.payload.narrativeId
                );
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_ADD_MESSAGE_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_GET_MESSAGES': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_GET_MESSAGES_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatGetMessages(msg.payload.threadId);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_GET_MESSAGES_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_UPDATE_MESSAGE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_UPDATE_MESSAGE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatUpdateMessage(msg.payload.messageId, msg.payload.content);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_UPDATE_MESSAGE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_APPEND_MESSAGE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_APPEND_MESSAGE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatAppendMessage(msg.payload.messageId, msg.payload.chunk);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_APPEND_MESSAGE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_START_STREAMING': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_START_STREAMING_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatStartStreaming(msg.payload.threadId, msg.payload.narrativeId);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_START_STREAMING_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_GET_MEMORIES': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_GET_MEMORIES_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatGetMemories(msg.payload.threadId);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_GET_MEMORIES_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_GET_CONTEXT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_GET_CONTEXT_RESULT',
                        id: msg.id,
                        payload: ''
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatGetContext(msg.payload.threadId);

                self.postMessage({
                    type: 'CHAT_GET_CONTEXT_RESULT',
                    id: msg.id,
                    payload: res
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_CLEAR_THREAD': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_CLEAR_THREAD_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatClearThread(msg.payload.threadId);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'CHAT_CLEAR_THREAD_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'CHAT_EXPORT_THREAD': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_EXPORT_THREAD_RESULT',
                        id: msg.id,
                        payload: '{}'
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.chatExportThread(msg.payload.threadId);

                self.postMessage({
                    type: 'CHAT_EXPORT_THREAD_RESULT',
                    id: msg.id,
                    payload: res
                } as GoKittWorkerResponse);
                break;
            }

            // =============================================================================
            // Phase 8: Observational Memory
            // =============================================================================

            case 'OM_PROCESS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'OM_PROCESS_RESULT',
                        id: msg.id,
                        payload: { observed: false, reflected: false }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.omProcess(msg.payload.threadId);
                const result = JSON.parse(res);

                self.postMessage({
                    type: 'OM_PROCESS_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }

            case 'OM_GET_RECORD': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'OM_GET_RECORD_RESULT',
                        id: msg.id,
                        payload: null
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.omGetRecord(msg.payload.threadId);
                const record = res === 'null' ? null : JSON.parse(res);

                self.postMessage({
                    type: 'OM_GET_RECORD_RESULT',
                    id: msg.id,
                    payload: record
                } as GoKittWorkerResponse);
                break;
            }

            case 'OM_OBSERVE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'OM_OBSERVE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.omObserve(msg.payload.threadId);
                const result = JSON.parse(res);

                self.postMessage({
                    type: 'OM_OBSERVE_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }

            case 'OM_REFLECT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'OM_REFLECT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.omReflect(msg.payload.threadId);
                const result = JSON.parse(res);

                self.postMessage({
                    type: 'OM_REFLECT_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }

            case 'OM_CLEAR': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'OM_CLEAR_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.omClear(msg.payload.threadId);
                const result = JSON.parse(res);

                self.postMessage({
                    type: 'OM_CLEAR_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }

            case 'OM_SET_CONFIG': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'OM_SET_CONFIG_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const configJSON = JSON.stringify({
                    enabled: msg.payload.enabled,
                    observeThreshold: msg.payload.observeThreshold,
                    reflectThreshold: msg.payload.reflectThreshold
                });
                const res = (GoKitt as any).omSetConfig(configJSON);
                const result = JSON.parse(res);

                self.postMessage({
                    type: 'OM_SET_CONFIG_RESULT',
                    id: msg.id,
                    payload: result
                } as GoKittWorkerResponse);
                break;
            }
        }
    } catch (err) {
        console.error('[GoKittWorker] Error:', err);
        self.postMessage({
            type: 'ERROR',
            id: (msg as any).id,
            payload: { message: err instanceof Error ? err.message : String(err) }
        } as GoKittWorkerResponse);
    }
};

console.log('[GoKittWorker] Worker loaded - waiting for INIT');
