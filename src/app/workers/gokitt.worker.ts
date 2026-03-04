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
    | { type: 'ANALYZE_TEXT'; payload: { text: string }; id: number }
    | { type: 'DOC_COUNT'; id: number }
    // SQLite Store API
    | { type: 'STORE_INIT'; id: number }
    | { type: 'STORE_GET_VERSION'; id: number }
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
    // Batch Operations
    | { type: 'STORE_REPLAY_WAL'; payload: { walJSON: string }; id: number }
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
    | { type: 'GO_STREAM_CHAT'; payload: { messagesJSON: string; systemPrompt?: string }; id: number }
    | { type: 'CHAT_GET_MEMORIES'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_GET_CONTEXT'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_CLEAR_THREAD'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_EXPORT_THREAD'; payload: { threadId: string }; id: number }
    | { type: 'CHAT_PROCESS_WITH_WORKSPACE'; payload: { threadId: string; scopeId: string; userPrompt: string }; id: number }
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
    | { type: 'STORE_DELETE_NETWORK_MEMBERSHIP'; payload: { networkId: string; entityId: string }; id: number }
    | { type: 'STORE_UPSERT_NETWORK_RELATIONSHIP'; payload: { relJSON: string }; id: number }
    | { type: 'STORE_GET_NETWORK_RELATIONSHIPS'; payload: { networkId: string }; id: number }
    | { type: 'STORE_DELETE_NETWORK_RELATIONSHIP'; payload: { networkId: string; relationshipId: string }; id: number }
    // Store: Discovery
    | { type: 'STORE_UPSERT_DISCOVERY_CANDIDATE'; payload: { candidateJSON: string }; id: number }
    | { type: 'STORE_LIST_DISCOVERY_CANDIDATES'; id: number }
    // Store: Fact Sheets
    | { type: 'STORE_UPSERT_ENTITY_CARD'; payload: { cardJSON: string }; id: number }
    | { type: 'STORE_UPSERT_ENTITY_CARDS'; payload: { cardsJSON: string }; id: number }
    | { type: 'STORE_GET_ENTITY_CARDS'; payload: { entityId: string }; id: number }
    | { type: 'STORE_UPSERT_FOLDER_SCHEMA'; payload: { schemaJSON: string }; id: number }
    | { type: 'STORE_GET_FOLDER_SCHEMA'; payload: { id: string }; id: number }
    // RAPTOR API
    | { type: 'RAPTOR_INIT'; payload: { configJSON?: string }; id: number }
    | { type: 'RAPTOR_CHUNK'; payload: { docID: string; text: string }; id: number }
    | { type: 'RAPTOR_INGEST_SAB'; payload: { docID: string; count: number; dim: number; embeddings: Float32Array }; id: number }
    | { type: 'RAPTOR_BUILD_TREE'; payload: { embeddingsJSON?: string }; id: number }
    | { type: 'RAPTOR_SEARCH'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_SEARCH_AGGREGATED'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_SEARCH_LEAF_ONLY'; payload: { query: string; queryEmbeddingJSON: string; k: number }; id: number }
    | { type: 'RAPTOR_GET_STATS'; id: number }
    | { type: 'RAPTOR_CLEAR'; id: number }
    // Knowledge Graph API
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
    | { type: 'KNOWLEDGE_GET_GRAPH'; id: number };

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
    | { type: 'VALIDATE_RELATIONS_RESULT'; id: number; payload: any }
    | { type: 'ANALYZE_TEXT_RESULT'; id: number; payload: any }
    | { type: 'ANALYTICS_UPDATE'; payload: any }
    | { type: 'DOC_COUNT_RESULT'; id: number; payload: number }
    // SQLite Store responses
    | { type: 'STORE_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_VERSION_RESULT'; id: number; payload: { version?: string; error?: string } }
    | { type: 'STORE_UPSERT_NOTE_RESULT'; id: number; payload: { success: boolean; error?: string } }

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
    // Batch Operations Response
    | { type: 'STORE_REPLAY_WAL_RESULT'; id: number; payload: { success: boolean; error?: string; message?: string } }
    // Store Export/Import responses
    | { type: 'STORE_EXPORT_RESULT'; id: number; payload: { data: ArrayBuffer; size: number } | { success: false; error: string } }
    | { type: 'STORE_IMPORT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    // Store Folder responses
    | { type: 'STORE_UPSERT_FOLDER_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_FOLDER_RESULT'; id: number; payload: any | null }
    | { type: 'STORE_DELETE_FOLDER_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_LIST_FOLDERS_RESULT'; id: number; payload: any[] }
    // WAL Event (Push)
    | { type: 'WAL_EVENT'; op: string; data: any }
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
    | { type: 'GO_STREAM_CHAT_CHUNK'; id: number; payload: { chunk: string } }
    | { type: 'GO_STREAM_CHAT_RESULT'; id: number; payload: { response: string; error?: string } }
    | { type: 'CHAT_GET_MEMORIES_RESULT'; id: number; payload: any }
    | { type: 'CHAT_GET_CONTEXT_RESULT'; id: number; payload: string }
    | { type: 'CHAT_CLEAR_THREAD_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'CHAT_EXPORT_THREAD_RESULT'; id: number; payload: string }
    | { type: 'CHAT_PROCESS_WITH_WORKSPACE_RESULT'; id: number; payload: string }
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
    | { type: 'STORE_DELETE_NETWORK_MEMBERSHIP_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_UPSERT_NETWORK_RELATIONSHIP_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_NETWORK_RELATIONSHIPS_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_DELETE_NETWORK_RELATIONSHIP_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_UPSERT_DISCOVERY_CANDIDATE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_LIST_DISCOVERY_CANDIDATES_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_UPSERT_ENTITY_CARD_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_UPSERT_ENTITY_CARDS_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_ENTITY_CARDS_RESULT'; id: number; payload: any[] }
    | { type: 'STORE_UPSERT_FOLDER_SCHEMA_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'STORE_GET_FOLDER_SCHEMA_RESULT'; id: number; payload: any | null }
    // RAPTOR responses
    | { type: 'RAPTOR_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'RAPTOR_CHUNK_RESULT'; id: number; payload: { success: boolean; chunks?: Array<{ text: string; start: number; end: number }>; count?: number; error?: string } }
    | { type: 'RAPTOR_INGEST_SAB_RESULT'; id: number; payload: { success: boolean; error?: string; ingestedCount: number; dim?: number } }
    | { type: 'RAPTOR_BUILD_TREE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'RAPTOR_SEARCH_RESULT'; id: number; payload: any[] }
    | { type: 'RAPTOR_SEARCH_AGGREGATED_RESULT'; id: number; payload: any[] }
    | { type: 'RAPTOR_SEARCH_LEAF_ONLY_RESULT'; id: number; payload: any[] }
    | { type: 'RAPTOR_GET_STATS_RESULT'; id: number; payload: any }
    | { type: 'RAPTOR_CLEAR_RESULT'; id: number; payload: { success: boolean } }
    | { type: 'RAPTOR_CLEAR_RESULT'; id: number; payload: { success: boolean } }
    // Knowledge Graph Responses
    | { type: 'KNOWLEDGE_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'KNOWLEDGE_LOAD_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'KNOWLEDGE_SAVE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'KNOWLEDGE_ADD_NODE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'KNOWLEDGE_ADD_EDGE_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'KNOWLEDGE_GET_NODE_RESULT'; id: number; payload: any }
    | { type: 'KNOWLEDGE_GET_CHILDREN_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_PARENTS_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_ANCESTORS_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_DESCENDANTS_RESULT'; id: number; payload: any[] }
    | { type: 'KNOWLEDGE_GET_NEIGHBORHOOD_RESULT'; id: number; payload: any[] }
    // GLDR Responses
    | { type: 'GLDR_INIT_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'GLDR_INDEX_CHUNK_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'GLDR_LOAD_COOCCURRENCES_RESULT'; id: number; payload: { success: boolean; error?: string } }
    | { type: 'GLDR_SEARCH_RESULT'; id: number; payload: any[] }
    | { type: 'GLDR_SEARCH_NODES_RESULT'; id: number; payload: any[] }
    | { type: 'GLDR_STATS_RESULT'; id: number; payload: any }
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
    analyzeText: (text: string) => string;
    // SQLite Store API
    storeInit: () => string;
    storeGetVersion: () => string;
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
    // Batch Operations
    storeReplayWal: (walJSON: string) => string;
    // Store Export/Import (OPFS Sync)
    storeExport: () => any; // Returns Uint8Array
    storeImport: (data: any) => string; // Accepts Uint8Array
    // Store Folder CRUD
    storeUpsertFolder: (folderJSON: string) => string;
    storeGetFolder: (id: string) => string;
    storeDeleteFolder: (id: string) => string;
    storeListFolders: (parentId?: string) => string;
    // WAL Handler Registration
    setWalHandler: (callback: (op: string, dataJSON: string) => void) => string;
    // Store API
    storeUpsertSpan: (spanJSON: string) => string;
    storeGetSpan: (id: string) => string;
    storeListSpansForNote: (noteId: string) => string;
    storeDeleteSpan: (id: string) => string;
    storeUpsertNetworkInstance: (networkJSON: string) => string;
    storeGetNetworkInstance: (id: string) => string;
    storeListNetworkInstances: () => string;
    storeDeleteNetworkInstance: (id: string) => string;
    storeUpsertNetworkMembership: (memberJSON: string) => string;
    storeGetNetworkMembers: (networkId: string) => string;
    storeDeleteNetworkMembership: (networkId: string, entityId: string) => string;
    storeUpsertNetworkRelationship: (relJSON: string) => string;
    storeGetNetworkRelationships: (networkId: string) => string;
    storeDeleteNetworkRelationship: (networkId: string, relationshipId: string) => string;
    storeUpsertDiscoveryCandidate: (candidateJSON: string) => string;
    storeListDiscoveryCandidates: () => string;
    storeUpsertEntityCard: (cardJSON: string) => string;
    storeUpsertEntityCards: (cardsJSON: string) => string;
    storeGetEntityCards: (entityId: string) => string;
    storeUpsertFolderSchema: (schemaJSON: string) => string;
    storeGetFolderSchema: (id: string) => string;
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
    goStreamChat: (messagesJSON: string, systemPrompt: string, onChunk: (chunk: string) => void) => Promise<string>;
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
    chatProcessWithWorkspace: (threadId: string, scopeId: string, userPrompt: string) => string;
    // RAPTOR API
    raptorInit: (configJSON?: string) => string;
    raptorBuildTree: (embeddingsJSON?: string) => string;
    raptorSearch: (query: string, queryEmbeddingJSON: string, k: number) => string;
    raptorSearchAggregated: (query: string, queryEmbeddingJSON: string, k: number) => string;
    raptorSearchLeafOnly: (query: string, queryEmbeddingJSON: string, k: number) => string;
    raptorGetStats: () => string;
    raptorClear: () => string;
    // RAPTOR SAB Zero-Copy
    raptorChunk: (docID: string, text: string) => string;
    raptorIngestSAB: (docID: string, count: number, dim: number) => string;
    // Knowledge Graph API
    knowledgeInit: () => string;
    knowledgeLoad: () => string;
    knowledgeSave: () => string;
    knowledgeAddNode: (nodeJSON: string) => string;
    knowledgeAddEdge: (edgeJSON: string) => string;
    knowledgeGetNode: (id: string) => string;
    knowledgeGetChildren: (id: string, relation?: string) => string;
    knowledgeGetParents: (id: string, relation?: string) => string;
    knowledgeGetAncestors: (id: string, relation?: string, maxDepth?: number) => string;
    knowledgeGetDescendants: (id: string, relation?: string, maxDepth?: number) => string;
    knowledgeGetNeighborhood: (id: string) => string;
    knowledgeGetGraph: () => string;
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

                // Option C -> Option B Pipeline: Piggyback text analytics on the implicit scan!
                // Zero additional boundary crossing, text is already in the worker.
                try {
                    const analyticsJson = GoKitt.analyzeText(msg.payload.text);
                    self.postMessage({
                        type: 'ANALYTICS_UPDATE',
                        payload: JSON.parse(analyticsJson)
                    });
                } catch (e) {
                    console.error('[GoKittWorker] Background analytics failed:', e);
                }

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

            case 'ANALYZE_TEXT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'ANALYZE_TEXT_RESULT',
                        id: msg.id,
                        payload: null
                    } as GoKittWorkerResponse);
                    return;
                }

                const json = GoKitt.analyzeText(msg.payload.text);
                const result = JSON.parse(json);

                self.postMessage({
                    type: 'ANALYZE_TEXT_RESULT',
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


                // WAL Handler REMOVED - Snapshot Native


                const res = GoKitt.storeInit();
                const parsed = JSON.parse(res);


                self.postMessage({
                    type: 'STORE_INIT_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_GET_VERSION': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_GET_VERSION_RESULT',
                        id: msg.id,
                        payload: { error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.storeGetVersion();
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'STORE_GET_VERSION_RESULT',
                    id: msg.id,
                    payload: { version: parsed.result, error: parsed.error }
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
                        type: 'ERROR',
                        id: msg.id,
                        payload: { message: parsed.error }
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

            case 'STORE_UPSERT_ENTITY_CARD': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_UPSERT_ENTITY_CARD_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }
                const res = GoKitt.storeUpsertEntityCard(msg.payload.cardJSON);
                const parsed = JSON.parse(res);
                self.postMessage({
                    type: 'STORE_UPSERT_ENTITY_CARD_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'STORE_UPSERT_ENTITY_CARDS': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_UPSERT_ENTITY_CARDS_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }
                const res = GoKitt.storeUpsertEntityCards(msg.payload.cardsJSON);
                const parsed = JSON.parse(res);
                self.postMessage({
                    type: 'STORE_UPSERT_ENTITY_CARDS_RESULT',
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
            // Batch Operations
            // =================================================================

            case 'STORE_REPLAY_WAL': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'STORE_REPLAY_WAL_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                try {
                    const res = GoKitt.storeReplayWal(msg.payload.walJSON);
                    const parsed = JSON.parse(res);
                    self.postMessage({
                        type: 'STORE_REPLAY_WAL_RESULT',
                        id: msg.id,
                        payload: { success: parsed.success, error: parsed.error, message: parsed.message }
                    } as GoKittWorkerResponse);
                } catch (e: any) {
                    self.postMessage({
                        type: 'STORE_REPLAY_WAL_RESULT',
                        id: msg.id,
                        payload: { success: false, error: e.toString() }
                    } as GoKittWorkerResponse);
                }
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
            // Store: Spans & Links
            // =================================================================

            case 'STORE_UPSERT_SPAN': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_UPSERT_SPAN_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeUpsertSpan(msg.payload.spanJSON);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_UPSERT_SPAN_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'STORE_GET_SPAN': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_GET_SPAN_RESULT', id: msg.id, payload: null });
                    return;
                }
                const res = GoKitt.storeGetSpan(msg.payload.id);
                try {
                    const parsed = JSON.parse(res);
                    self.postMessage({ type: 'STORE_GET_SPAN_RESULT', id: msg.id, payload: parsed });
                } catch {
                    self.postMessage({ type: 'STORE_GET_SPAN_RESULT', id: msg.id, payload: null });
                }
                break;
            }

            case 'STORE_LIST_SPANS_FOR_NOTE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_LIST_SPANS_FOR_NOTE_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.storeListSpansForNote(msg.payload.noteId);
                let parsed = [];
                try { parsed = JSON.parse(res); } catch { }
                self.postMessage({ type: 'STORE_LIST_SPANS_FOR_NOTE_RESULT', id: msg.id, payload: Array.isArray(parsed) ? parsed : [] });
                break;
            }

            case 'STORE_DELETE_SPAN': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_DELETE_SPAN_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeDeleteSpan(msg.payload.id);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_DELETE_SPAN_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            // =================================================================
            // Store: Network View
            // =================================================================

            case 'STORE_UPSERT_NETWORK_INSTANCE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_UPSERT_NETWORK_INSTANCE_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeUpsertNetworkInstance(msg.payload.networkJSON);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_UPSERT_NETWORK_INSTANCE_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'STORE_GET_NETWORK_INSTANCE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_GET_NETWORK_INSTANCE_RESULT', id: msg.id, payload: null });
                    return;
                }
                const res = GoKitt.storeGetNetworkInstance(msg.payload.id);
                try {
                    const parsed = JSON.parse(res);
                    self.postMessage({ type: 'STORE_GET_NETWORK_INSTANCE_RESULT', id: msg.id, payload: parsed });
                } catch {
                    self.postMessage({ type: 'STORE_GET_NETWORK_INSTANCE_RESULT', id: msg.id, payload: null });
                }
                break;
            }

            case 'STORE_LIST_NETWORK_INSTANCES': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_LIST_NETWORK_INSTANCES_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.storeListNetworkInstances();
                let parsed = [];
                try { parsed = JSON.parse(res); } catch { }
                self.postMessage({ type: 'STORE_LIST_NETWORK_INSTANCES_RESULT', id: msg.id, payload: Array.isArray(parsed) ? parsed : [] });
                break;
            }

            case 'STORE_DELETE_NETWORK_INSTANCE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_DELETE_NETWORK_INSTANCE_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeDeleteNetworkInstance(msg.payload.id);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_DELETE_NETWORK_INSTANCE_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'STORE_UPSERT_NETWORK_MEMBERSHIP': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_UPSERT_NETWORK_MEMBERSHIP_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeUpsertNetworkMembership(msg.payload.memberJSON);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_UPSERT_NETWORK_MEMBERSHIP_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'STORE_GET_NETWORK_MEMBERS': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_GET_NETWORK_MEMBERS_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.storeGetNetworkMembers(msg.payload.networkId);
                let parsed = [];
                try { parsed = JSON.parse(res); } catch { }
                self.postMessage({ type: 'STORE_GET_NETWORK_MEMBERS_RESULT', id: msg.id, payload: Array.isArray(parsed) ? parsed : [] });
                break;
            }

            case 'STORE_UPSERT_NETWORK_RELATIONSHIP': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_UPSERT_NETWORK_RELATIONSHIP_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeUpsertNetworkRelationship(msg.payload.relJSON);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_UPSERT_NETWORK_RELATIONSHIP_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'STORE_GET_NETWORK_RELATIONSHIPS': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_GET_NETWORK_RELATIONSHIPS_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.storeGetNetworkRelationships(msg.payload.networkId);
                let parsed = [];
                try { parsed = JSON.parse(res); } catch { }
                self.postMessage({ type: 'STORE_GET_NETWORK_RELATIONSHIPS_RESULT', id: msg.id, payload: Array.isArray(parsed) ? parsed : [] });
                break;
            }

            case 'STORE_DELETE_NETWORK_MEMBERSHIP': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_DELETE_NETWORK_MEMBERSHIP_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeDeleteNetworkMembership(msg.payload.networkId, msg.payload.entityId);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_DELETE_NETWORK_MEMBERSHIP_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'STORE_DELETE_NETWORK_RELATIONSHIP': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_DELETE_NETWORK_RELATIONSHIP_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeDeleteNetworkRelationship(msg.payload.networkId, msg.payload.relationshipId);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_DELETE_NETWORK_RELATIONSHIP_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            // =================================================================
            // Store: Discovery
            // =================================================================

            case 'STORE_UPSERT_DISCOVERY_CANDIDATE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_UPSERT_DISCOVERY_CANDIDATE_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeUpsertDiscoveryCandidate(msg.payload.candidateJSON);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_UPSERT_DISCOVERY_CANDIDATE_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'STORE_LIST_DISCOVERY_CANDIDATES': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_LIST_DISCOVERY_CANDIDATES_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.storeListDiscoveryCandidates();
                let parsed = [];
                try { parsed = JSON.parse(res); } catch { }
                self.postMessage({ type: 'STORE_LIST_DISCOVERY_CANDIDATES_RESULT', id: msg.id, payload: Array.isArray(parsed) ? parsed : [] });
                break;
            }

            // =================================================================
            // Store: Fact Sheets
            // =================================================================


            case 'STORE_GET_ENTITY_CARDS': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_GET_ENTITY_CARDS_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.storeGetEntityCards(msg.payload.entityId);
                let parsed = [];
                try { parsed = JSON.parse(res); } catch { }
                self.postMessage({ type: 'STORE_GET_ENTITY_CARDS_RESULT', id: msg.id, payload: Array.isArray(parsed) ? parsed : [] });
                break;
            }

            case 'STORE_UPSERT_FOLDER_SCHEMA': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_UPSERT_FOLDER_SCHEMA_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } });
                    return;
                }
                const res = GoKitt.storeUpsertFolderSchema(msg.payload.schemaJSON);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'STORE_UPSERT_FOLDER_SCHEMA_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'STORE_GET_FOLDER_SCHEMA': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'STORE_GET_FOLDER_SCHEMA_RESULT', id: msg.id, payload: null });
                    return;
                }
                const res = GoKitt.storeGetFolderSchema(msg.payload.id);
                try {
                    const parsed = JSON.parse(res);
                    self.postMessage({ type: 'STORE_GET_FOLDER_SCHEMA_RESULT', id: msg.id, payload: parsed });
                } catch {
                    self.postMessage({ type: 'STORE_GET_FOLDER_SCHEMA_RESULT', id: msg.id, payload: null });
                }
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

            case 'CHAT_PROCESS_WITH_WORKSPACE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'CHAT_PROCESS_WITH_WORKSPACE_RESULT',
                        id: msg.id,
                        payload: JSON.stringify({ triggered: false, error: 'WASM not loaded' })
                    } as GoKittWorkerResponse);
                    return;
                }

                const { threadId, scopeId, userPrompt } = msg.payload;
                const res = GoKitt.chatProcessWithWorkspace(threadId, scopeId, userPrompt);

                self.postMessage({
                    type: 'CHAT_PROCESS_WITH_WORKSPACE_RESULT',
                    id: msg.id,
                    payload: res
                } as GoKittWorkerResponse);
                break;
            }

            // ===== RAPTOR API =====

            case 'RAPTOR_INIT': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RAPTOR_INIT_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const configJSON = msg.payload?.configJSON;
                const res = GoKitt.raptorInit(configJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'RAPTOR_INIT_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }


            case 'RAPTOR_CHUNK': {
                // Phase 1 of SAB ping-pong: chunk text in Go, return chunk texts for JS embedding
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RAPTOR_CHUNK_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded', count: 0 }
                    } as GoKittWorkerResponse);
                    return;
                }

                const chunkRes = GoKitt.raptorChunk(msg.payload.docID, msg.payload.text);
                const chunkParsed = JSON.parse(chunkRes);

                if (chunkParsed.error) {
                    self.postMessage({
                        type: 'RAPTOR_CHUNK_RESULT',
                        id: msg.id,
                        payload: { success: false, error: chunkParsed.error, count: 0 }
                    } as GoKittWorkerResponse);
                } else {
                    // chunkParsed is an array of {text, start, end}
                    self.postMessage({
                        type: 'RAPTOR_CHUNK_RESULT',
                        id: msg.id,
                        payload: { success: true, chunks: chunkParsed, count: chunkParsed.length }
                    } as GoKittWorkerResponse);
                }
                break;
            }

            case 'RAPTOR_INGEST_SAB': {
                // Phase 2 of SAB ping-pong: write embeddings to SAB, then tell Go to read them
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RAPTOR_INGEST_SAB_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded', ingestedCount: 0 }
                    } as GoKittWorkerResponse);
                    return;
                }

                const { docID: sabDocID, count: sabCount, dim: sabDim, embeddings: sabEmbeddings } = msg.payload;

                // Calculate required SAB size: header(16) + embHeader(8) + floats(count*dim*4)
                const requiredSize = 16 + 8 + (sabCount * sabDim * 4);

                // Lazy-init SAB: create the buffer if needed, or resize if too small
                if (!(self as any).__sabBuffer || (self as any).__sabBuffer.byteLength < requiredSize) {
                    // Allocate with 2x headroom for future batches
                    const allocSize = Math.max(requiredSize * 2, 65536);
                    try {
                        (self as any).__sabBuffer = new SharedArrayBuffer(allocSize);
                        // Initialize with Go
                        const initRes = GoKitt.sabInit((self as any).__sabBuffer);
                        const initParsed = JSON.parse(initRes);
                        if (!initParsed.success) {
                            self.postMessage({
                                type: 'RAPTOR_INGEST_SAB_RESULT',
                                id: msg.id,
                                payload: { success: false, error: 'sabInit failed: ' + initParsed.error, ingestedCount: 0 }
                            } as GoKittWorkerResponse);
                            return;
                        }
                        console.log(`[GoKittWorker] SAB initialized: ${allocSize} bytes`);
                    } catch (e) {
                        // SharedArrayBuffer not available (COOP/COEP headers missing?)
                        // Fallback to JSON path
                        console.warn('[GoKittWorker] SharedArrayBuffer not available, falling back to JSON');
                        const fallbackEmbs: number[][] = [];
                        for (let i = 0; i < sabCount; i++) {
                            fallbackEmbs.push(Array.from(sabEmbeddings.subarray(i * sabDim, (i + 1) * sabDim)));
                        }
                        // SAB not available — error out cleanly.
                        self.postMessage({
                            type: 'RAPTOR_INGEST_SAB_RESULT',
                            id: msg.id,
                            payload: { success: false, error: 'SharedArrayBuffer not available (check COOP/COEP headers)', ingestedCount: 0 }
                        } as GoKittWorkerResponse);
                        return;
                    }
                }

                // Write embeddings to SAB in the expected binary layout:
                // At OffsetPayload (16): [count:u32][dim:u32][...flat float32s...]
                const sab = (self as any).__sabBuffer as SharedArrayBuffer;
                const headerView = new DataView(sab);
                const payloadOffset = 16; // OffsetPayload

                // Write embedding header
                headerView.setUint32(payloadOffset, sabCount, true);     // count (LE)
                headerView.setUint32(payloadOffset + 4, sabDim, true);   // dim (LE)

                // Write flat float32s directly into SAB
                const float32View = new Float32Array(sab, payloadOffset + 8, sabCount * sabDim);
                float32View.set(sabEmbeddings);

                // Tell Go to read from SAB
                const sabRes = GoKitt.raptorIngestSAB(sabDocID, sabCount, sabDim);
                const sabParsed = JSON.parse(sabRes);

                self.postMessage({
                    type: 'RAPTOR_INGEST_SAB_RESULT',
                    id: msg.id,
                    payload: {
                        success: !sabParsed.error,
                        error: sabParsed.error,
                        ingestedCount: sabParsed.ingestedCount || 0,
                        dim: sabParsed.dim
                    }
                } as GoKittWorkerResponse);
                break;
            }

            case 'RAPTOR_BUILD_TREE': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RAPTOR_BUILD_TREE_RESULT',
                        id: msg.id,
                        payload: { success: false, error: 'WASM not loaded' }
                    } as GoKittWorkerResponse);
                    return;
                }

                const embeddingsJSON = msg.payload?.embeddingsJSON;
                const res = GoKitt.raptorBuildTree(embeddingsJSON);
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'RAPTOR_BUILD_TREE_RESULT',
                    id: msg.id,
                    payload: { success: !parsed.error, error: parsed.error }
                } as GoKittWorkerResponse);
                break;
            }

            case 'RAPTOR_SEARCH': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RAPTOR_SEARCH_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.raptorSearch(
                    msg.payload.query,
                    msg.payload.queryEmbeddingJSON,
                    msg.payload.k
                );
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'RAPTOR_SEARCH_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'RAPTOR_SEARCH_AGGREGATED': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RAPTOR_SEARCH_AGGREGATED_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.raptorSearchAggregated(
                    msg.payload.query,
                    msg.payload.queryEmbeddingJSON,
                    msg.payload.k
                );
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'RAPTOR_SEARCH_AGGREGATED_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'RAPTOR_SEARCH_LEAF_ONLY': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RAPTOR_SEARCH_LEAF_ONLY_RESULT',
                        id: msg.id,
                        payload: []
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.raptorSearchLeafOnly(
                    msg.payload.query,
                    msg.payload.queryEmbeddingJSON,
                    msg.payload.k
                );
                const parsed = JSON.parse(res);

                self.postMessage({
                    type: 'RAPTOR_SEARCH_LEAF_ONLY_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'RAPTOR_GET_STATS': {
                if (!wasmLoaded) {
                    console.log('[GoKittWorker] RAPTOR_GET_STATS: WASM not loaded');
                    self.postMessage({
                        type: 'RAPTOR_GET_STATS_RESULT',
                        id: msg.id,
                        payload: { docCount: 0, leafCount: 0, treeCount: 0 }
                    } as GoKittWorkerResponse);
                    return;
                }

                const res = GoKitt.raptorGetStats();
                console.log('[GoKittWorker] RAPTOR_GET_STATS raw result:', res);
                const parsed = JSON.parse(res);
                console.log('[GoKittWorker] RAPTOR_GET_STATS parsed:', parsed);

                self.postMessage({
                    type: 'RAPTOR_GET_STATS_RESULT',
                    id: msg.id,
                    payload: parsed
                } as GoKittWorkerResponse);
                break;
            }

            case 'RAPTOR_CLEAR': {
                if (!wasmLoaded) {
                    self.postMessage({
                        type: 'RAPTOR_CLEAR_RESULT',
                        id: msg.id,
                        payload: { success: true }
                    } as GoKittWorkerResponse);
                    return;
                }

                GoKitt.raptorClear();

                self.postMessage({
                    type: 'RAPTOR_CLEAR_RESULT',
                    id: msg.id,
                    payload: { success: true }
                } as GoKittWorkerResponse);
                break;
            }

            // =================================================================
            // Knowledge Graph API Handlers
            // =================================================================

            case 'KNOWLEDGE_INIT': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_INIT_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } as any });
                    return;
                }
                const res = GoKitt.knowledgeInit();
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_INIT_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'KNOWLEDGE_LOAD': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_LOAD_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } as any });
                    return;
                }
                const res = GoKitt.knowledgeLoad();
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_LOAD_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'KNOWLEDGE_SAVE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_SAVE_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } as any });
                    return;
                }
                const res = GoKitt.knowledgeSave();
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_SAVE_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'KNOWLEDGE_ADD_NODE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_ADD_NODE_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } as any });
                    return;
                }
                const res = GoKitt.knowledgeAddNode(msg.payload.nodeJSON);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_ADD_NODE_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }
            case 'GO_STREAM_CHAT': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'GO_STREAM_CHAT_RESULT', id: msg.id, payload: { response: '', error: 'WASM not loaded' } });
                    return;
                }
                try {
                    const response = await GoKitt.goStreamChat(
                        msg.payload.messagesJSON,
                        msg.payload.systemPrompt || '',
                        (chunk) => {
                            self.postMessage({ type: 'GO_STREAM_CHAT_CHUNK', id: msg.id, payload: { chunk } });
                        }
                    );
                    self.postMessage({ type: 'GO_STREAM_CHAT_RESULT', id: msg.id, payload: { response } });
                } catch (e: any) {
                    self.postMessage({ type: 'GO_STREAM_CHAT_RESULT', id: msg.id, payload: { response: '', error: e.toString() } });
                }
                break;
            }

            case 'KNOWLEDGE_ADD_EDGE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_ADD_EDGE_RESULT', id: msg.id, payload: { success: false, error: 'WASM not loaded' } as any });
                    return;
                }
                const res = GoKitt.knowledgeAddEdge(msg.payload.edgeJSON);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_ADD_EDGE_RESULT', id: msg.id, payload: { success: !parsed.error, error: parsed.error } });
                break;
            }

            case 'KNOWLEDGE_GET_NODE': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_GET_NODE_RESULT', id: msg.id, payload: null });
                    return;
                }
                const res = GoKitt.knowledgeGetNode(msg.payload.id);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_GET_NODE_RESULT', id: msg.id, payload: parsed.error ? null : parsed });
                break;
            }

            case 'KNOWLEDGE_GET_CHILDREN': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_GET_CHILDREN_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.knowledgeGetChildren(msg.payload.id, msg.payload.relation);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_GET_CHILDREN_RESULT', id: msg.id, payload: parsed });
                break;
            }

            case 'KNOWLEDGE_GET_PARENTS': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_GET_PARENTS_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.knowledgeGetParents(msg.payload.id, msg.payload.relation);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_GET_PARENTS_RESULT', id: msg.id, payload: parsed });
                break;
            }

            case 'KNOWLEDGE_GET_ANCESTORS': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_GET_ANCESTORS_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.knowledgeGetAncestors(msg.payload.id, msg.payload.relation, msg.payload.maxDepth);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_GET_ANCESTORS_RESULT', id: msg.id, payload: parsed });
                break;
            }

            case 'KNOWLEDGE_GET_DESCENDANTS': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_GET_DESCENDANTS_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.knowledgeGetDescendants(msg.payload.id, msg.payload.relation, msg.payload.maxDepth);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_GET_DESCENDANTS_RESULT', id: msg.id, payload: parsed });
                break;
            }

            case 'KNOWLEDGE_GET_NEIGHBORHOOD': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_GET_NEIGHBORHOOD_RESULT', id: msg.id, payload: [] });
                    return;
                }
                const res = GoKitt.knowledgeGetNeighborhood(msg.payload.id);
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_GET_NEIGHBORHOOD_RESULT', id: msg.id, payload: parsed });
                break;
            }

            case 'KNOWLEDGE_GET_GRAPH': {
                if (!wasmLoaded) {
                    self.postMessage({ type: 'KNOWLEDGE_GET_GRAPH_RESULT', id: msg.id, payload: { nodes: {}, edges: [] } });
                    return;
                }
                const res = GoKitt.knowledgeGetGraph();
                const parsed = JSON.parse(res);
                self.postMessage({ type: 'KNOWLEDGE_GET_GRAPH_RESULT', id: msg.id, payload: parsed });
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
