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

/** Outgoing messages to main thread */
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
