db.ts:521 [CozoDB] 🔧 Debug: window.cozoDebug.clearWal() to fix duplicate entities
db.ts:62 [ModelCache] 🗄️ Debug: window.modelCacheDb
main.ts:56 [Main] Starting application boot...
boot-cache.ts:38 [BootCache] Starting pre-Angular data load...
gokitt.service.ts:168 [GoKittService] Service ready (worker-based)
gokitt-store.service.ts:138 [GoKittStoreService] Service created
app-orchestrator.ts:68 [Orchestrator] Boot sequence started
rag-worker.service.ts:23 [RagWorkerService] Initialized
embedding-queue.service.ts:47 [EmbeddingQueue] Initialized with 10s debounce
note-editor.store.ts:85 [NoteEditorStore] Constructor called
note-editor.store.ts:132 [NoteEditorStore] restoreActiveNote: Checking Dexie directly...
theme.service.ts:43 [ThemeService] Using system preference: dark
theme.service.ts:97 [ThemeService] Applying theme. Dark: true
fact-sheet.service.ts:281 [FactSheetService] Initialized with default schemas: (14) ['CHARACTER', 'ITEM', 'LOCATION', 'CONCEPT', 'EVENT', 'FACTION', 'NPC', 'SCENE', 'ARC', 'ACT', 'CHAPTER', 'BEAT', 'TIMELINE', 'NARRATIVE']
note-editor.store.ts:117 [NoteEditorStore] Skipping persistence wipe during restoration
entityColorStore.ts:99 [EntityColorStore] Initialized with 19 pill colors and text colors
app.component.ts:190 [AppComponent] ✓ Navigation API wired up
app.component.ts:62 [AppComponent] Starting orchestrated boot...
_debug_node-chunk.mjs:10541 Angular is running in development mode.
settings.service.ts:45 [Settings] ✓ Hydrated 17 settings from boot cache
boot-cache.ts:65 [BootCache] ✓ Loaded 19 entities, 0 edges, 2 notes, 2 folders, 17 settings in 2839ms
main.ts:70 [Main] Angular bootstrapped, injector exposed
note-editor.store.ts:138 [NoteEditorStore] restoreActiveNote: Found in Dexie: "d2293c4a-8d20-4d18-87be-8da7335a4482"
tab.store.ts:207 [TabStore] Restoring 2 tabs from DB
seed.ts:21 [Seed] Folder schemas already exist (14)
settings.service.ts:63 [Settings] setSetting: "kittclouds-open-tabs" = (2) [{…}, {…}]
app.component.ts:181 [AppComponent] NavigationApi synced with 2 notes
note-editor.store.ts:147 [NoteEditorStore] Loaded editor position: {noteId: 'd2293c4a-8d20-4d18-87be-8da7335a4482', scrollTop: 0, cursorFrom: 6151, cursorTo: 6151}
seed.ts:31 [Seed] Network schemas already exist (6)
app.component.ts:67 [AppComponent] ✓ Seed complete
registry.ts:111 [CentralRegistry] ✓ Initialized: 19 entities, 0 edges (0ms, from cache)
app.component.ts:71 [AppComponent] ✓ SmartGraphRegistry hydrated
db.ts:93 [CozoDB] Initializing...
note-editor.store.ts:154 [NoteEditorStore] Restoring active note: d2293c4a-8d20-4d18-87be-8da7335a4482
note-editor.store.ts:166 [NoteEditorStore] Restoration check complete. isRestoring = false
note-editor.store.ts:120 [NoteEditorStore] Persistence effect triggered. ID: d2293c4a-8d20-4d18-87be-8da7335a4482
note-editor.store.ts:174 [NoteEditorStore] Persisting active note ID: d2293c4a-8d20-4d18-87be-8da7335a4482
settings.service.ts:63 [Settings] setSetting: "kittclouds-active-note" = d2293c4a-8d20-4d18-87be-8da7335a4482
settings.service.ts:63 [Settings] setSetting: "kittclouds-open-tabs" = (2) [{…}, {…}]
file-tree.component.ts:466 [FileTree] Syncing selection to active note: girls
settings.service.ts:63 [Settings] setSetting: "kittclouds_active_scope" = {type: 'narrative', id: '30ba291d-0a68-4b32-aec6-e7b214fe2c67', narrativeId: '30ba291d-0a68-4b32-aec6-e7b214fe2c67'}
gokitt.worker.ts:2169 [GoKittWorker] Worker loaded - waiting for INIT
gokitt.worker.ts:396 [GoKittWorker] Received: INIT
gokitt.worker.ts:353 [GoKittWorker] Loading wasm_exec.js...
gokitt.worker.ts:370 [GoKittWorker] Loading gokitt.wasm...
db.ts:107 [CozoDB] ✅ WASM loaded, DB instance created
GraphSchema.ts:55 [GraphSchema] Creating graph schemas...
GraphSchema.ts:182 [GraphSchema] ✅ 34 schemas ready
GraphSchema.ts:315 [GraphSchema] ✅ Blocks HNSW index created
db.ts:151 [CozoDB] ✅ Schemas ready
CozoPersistenceService.ts:33 [CozoPersistence] Initializing worker...
cozo-opfs.worker.ts:129 [CozoOpfsWorker] Worker initialized (with mutex)
cozo-opfs-core.ts:277 [CozoOpfs] 🔍 No snapshot found - source: none
loadSnapshot @ cozo-opfs-core.ts:277
await in loadSnapshot
self.onmessage @ cozo-opfs.worker.ts:60
CozoPersistenceService.ts:86 [CozoPersistence] Loaded: snapshot=false, wal entries=170, source=none
db.ts:217 [CozoDB] Replaying 170 WAL entries...
db.ts:220 [CozoDB] 🔍 WAL entries preview:
db.ts:222   [0] 
        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload, narrative_id] <- 
            [[$scope_id, $note_id, $ts, $action_type, $target_id, $target_kind, $payload, $narrative_i...
db.ts:222   [1] 
        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload, narrative_id] <- 
            [[$scope_id, $note_id, $ts, $action_type, $target_id, $target_kind, $payload, $narrative_i...
db.ts:222   [2] 
        ?[scope_id, note_id, ts, action_type, target_id, target_kind, payload, narrative_id] <- 
            [[$scope_id, $note_id, $ts, $action_type, $target_id, $target_kind, $payload, $narrative_i...
db.ts:236 [CozoDB] ✅ Replayed 170/170 WAL entries
db.ts:242 [CozoDB] 🔍 Relations after WAL replay: {"headers":["name","arity","access_level","n_keys","n_non_keys","n_put_triggers","n_rm_triggers","n_replace_triggers","description"],"next":null,"ok":true,"rows":[["blocks",8,"normal",1,7,0,0,0,""],["blocks:fts_idx",6,"index",2,4,0,0,0,""],["blocks:semantic_idx_384",10,"index",7,3,0,0,0,""],["cluster_members",5,"normal",2,3,0,0,0,""],["cooccurrence_edges",5,"normal",2,3,0,0,0,""],["discovery_candidates",7,"normal",1,6,0,0,0,""],["entities",10,"normal",1,9,0,0,0,""],["entity_aliases",3,"normal",2,1,0,0,0,""],["entity_cards",9,"normal",2,7,0,0,0,""],["entity_clusters",5,"normal",1,4,0,0,0,""],["entity_edge",14,"normal",1,13,0,0,0,""],["entity_mentions",6,"normal",2,4,0,0,0,""],["entity_metadata",3,"normal",2,1,0,0,0,""],["episode_log",8,"normal",3,5,0,0,0,""],["fact_sheet_card_schemas",10,"normal",1,9,0,0,0,""],["fact_sheet_field_schemas",22,"normal",1,21,0,0,0,""],["folder_hierarchy",15,"normal",15,0,0,0,0,""],["folder_schemas",14,"normal",1,13,0,0,0,""],["network_instance",18,"normal",18,0,0,0,0,""],["network_membership",13,"normal",13,0,0,0,0,""],["network_relationship",18,"normal",18,0,0,0,0,""],["node_vectors",7,"normal",1,6,0,0,0,""],["raptor_config",5,"normal",1,4,0,0,0,""],["raptor_nodes",7,"normal",1,6,0,0,0,""],["raptor_nodes:idx",10,"index",7,3,0,0,0,""],["relationship_attributes",3,"normal",2,1,0,0,0,""],["relationship_provenance",6,"normal",3,3,0,0,0,""],["span_mentions",12,"normal",1,11,0,0,0,""],["spans",13,"normal",1,12,0,0,0,""],["wormholes",10,"normal",1,9,0,0,0,""],["ws_edge",6,"normal",4,2,0,0,0,""],["ws_metric",4,"normal",2,2,0,0,0,""],["ws_node",6,"normal",2,4,0,0,0,""],["ws_session",4,"normal",1,3,0,0,0,""],["ws_view_cache",5,"normal",2,3,0,0,0,""]]}
ContentRepo.ts:563 [ContentRepo] ✅ Initialized (9 schemas)
FtsSchema.ts:345 [FtsSchema] Created blocks_fts index
FtsSchema.ts:359 [FtsSchema] Created notes_fts index
FtsSchema.ts:373 [FtsSchema] Created notes_content_fts index
FtsService.ts:90 [FtsService] FTS indexes initialized: {blocksFts: true, notesFts: true, notesContentFts: true}
db.ts:119 [CozoDB] ✅ Initialized in 984ms
app.component.ts:77 [AppComponent] ✓ CozoDB initialized (background)
gokitt.worker.ts:222 [GoKitt] WASM Ready v0.9.0

gokitt.worker.ts:387 [GoKittWorker] ✅ WASM loaded and ready
gokitt.service.ts:234 [GoKittService] WASM module loaded (via worker)
app.component.ts:84 [AppComponent] ✓ WASM module loaded
app-orchestrator.ts:92 [Orchestrator] ✓ Phase 'wasm_load' complete (1225ms)
gokitt.worker.ts:396 [GoKittWorker] Received: HYDRATE
gokitt.worker.ts:222 [GoKitt] âœ… Dictionary compiled: 19 entities

gokitt.worker.ts:222 [GoKitt] âœ… Discovery seeded: 19 entities

gokitt.service.ts:270 [GoKittService] ✅ Hydrated with 19 entities
gokitt.service.ts:332 [GoKittService] refreshDictionary: Rebuilding with 19 entities...
gokitt.service.ts:341 [GoKittService] Dictionary Payload MISSING "Yellow Dragon"
gokitt.service.ts:339 [GoKittService] Dictionary Payload contains "Belys Vorona": {ID: 'character_belys_vorona', Label: 'Belys Vorona', Kind: 'CHARACTER', Aliases: Array(0), NarrativeID: 'd2293c4a-8d20-4d18-87be-8da7335a4482'}
gokitt.service.ts:339 [GoKittService] Dictionary Payload contains "Kai": {ID: 'character_kai', Label: 'Kai', Kind: 'CHARACTER', Aliases: Array(0), NarrativeID: 'd2293c4a-8d20-4d18-87be-8da7335a4482'}
gokitt.worker.ts:396 [GoKittWorker] Received: REBUILD_DICTIONARY
gokitt.worker.ts:222 [GoKitt] âœ… Dictionary rebuilt: 19 entities

gokitt.service.ts:351 [GoKittService] ✅ Dictionary rebuilt successfully
gokitt.service.ts:287 [GoKittService] 🔎 Search Index init deferred to hydration.
gokitt.service.ts:186 [GoKittService] 🚀 WASM ready - notifying listeners
gokitt.service.ts:202 [GoKittService] 💡 Debug: Call window.testGraphScan() in console
app.component.ts:89 [AppComponent] ✓ WASM hydrated with entities
app-orchestrator.ts:92 [Orchestrator] ✓ Phase 'wasm_hydrate' complete (23ms)
gokitt.worker.ts:396 [GoKittWorker] Received: STORE_INIT
gokitt.worker.ts:222 [GoKitt] âœ… SQLite Store initialized

gokitt-store.service.ts:179 [GoKittStoreService] ✅ SQLite Store initialized
gokitt.worker.ts:396 [GoKittWorker] Received: STORE_LIST_NOTES
GoOpfsSyncService.ts:93 [GoOpfsSync] 📂 Loading from OPFS...
gokitt.worker.ts:396 [GoKittWorker] Received: STORE_IMPORT
gokitt.worker.ts:222 [GoKitt] âœ… Imported 411361 bytes

gokitt.worker.ts:396 [GoKittWorker] Received: STORE_LIST_NOTES
GoOpfsSyncService.ts:98 [GoOpfsSync] ✅ Restored 3 notes from OPFS (411361 bytes)
gokitt.worker.ts:396 [GoKittWorker] Received: STORE_LIST_NOTES
gokitt.worker.ts:396 [GoKittWorker] Received: STORE_LIST_ENTITIES
GoSqliteCozoBridge.ts:128 [GoSqliteBridge] ✅ Bridge initialized {notes: 3, folders: 0, entities: 16, edges: 0, duration: 619, …}
operations.ts:79 [Operations] ✅ GoSqlite Bridge connected
app.component.ts:95 [AppComponent] ✓ GoSQLite-Cozo Bridge initialized
app-orchestrator.ts:92 [Orchestrator] ✓ Phase 'ready' complete (2578ms)
app-orchestrator.ts:113 [Orchestrator] 🚀 App interactive in 6726ms
app-orchestrator.ts:177 [Orchestrator] Boot Timings
app-orchestrator.ts:181   wasm_load: 1225ms
app-orchestrator.ts:181   wasm_hydrate: 23ms
app-orchestrator.ts:181   ready: 2578ms
gokitt.service.ts:948 [GoKittService.hydrateNotes] Hydrating 2 notes...
gokitt.service.ts:953 [GoKittService.hydrateNotes] Sample Note [12da7622-efae-480a-a5df-a5ad133a21da]: text len=72949, preview="The elevator chimed, a soft, polite ding that felt..."
gokitt.worker.ts:396 [GoKittWorker] Received: HYDRATE_NOTES
gokitt.worker.ts:222 [GoKitt] 🔍 Hydrating Note[0]: ID=12da7622-efae-480a-a5df-a5ad133a21da Len=74382 TextPreview="The elevator chimed, a soft, polite ding that felt"

gokitt.worker.ts:222 [GoKitt] 🔎 Search Index hydrated: 2 notes

gokitt.worker.ts:222 [GoKitt] 📊 Index Stats: 2 docs, AvgLen=40138.00

gokitt.worker.ts:222 [GoKitt] ✅ DocStore hydrated: 2 notes

app.component.ts:140 [AppComponent] ✓ DocStore hydrated with 2 notes (background)
app-orchestrator.ts:92 [Orchestrator] ✓ Phase 'background' complete (181ms)
app-orchestrator.ts:118 [Orchestrator] ✅ All background tasks done in 6907ms
raptor-eval.service.ts:96 [RaptorEvalService] Initializing EmbeddingEngine...
LocalEmbeddingProvider.ts:69 [LocalEmbeddingProvider] Loading model: MDBR Leaf (256d)
LocalEmbeddingProvider.ts:82 [LocalEmbeddingProvider] Using device: wasm
installHook.js:1 Unable to determine content-length from response headers. Will expand buffer when needed.
overrideMethod @ installHook.js:1
readResponse @ transformers.web.js:5675
loadResourceFile @ transformers.web.js:5909
await in loadResourceFile
getModelFile @ transformers.web.js:5970
await in getModelFile
getModelText @ transformers.web.js:5973
getModelJSON @ transformers.web.js:5984
loadTokenizer @ transformers.web.js:9349
from_pretrained @ transformers.web.js:10892
loadItems @ transformers.web.js:26168
pipeline3 @ transformers.web.js:26127
initialize @ LocalEmbeddingProvider.ts:85
initialize @ EmbeddingEngine.ts:63
initialize @ raptor-eval.service.ts:97
initialize @ raptor-eval.component.ts:316
RaptorEvalComponent_Template_p_button_onClick_30_listener @ raptor-eval.component.ts:74
executeListenerWithErrorHandling @ _debug_node-chunk.mjs:7959
wrapListenerIn_markDirtyAndPreventDefault @ _debug_node-chunk.mjs:7946
ConsumerObserver2.next @ Subscriber.js:96
Subscriber2._next @ Subscriber.js:63
Subscriber2.next @ Subscriber.js:34
(anonymous) @ Subject.js:41
errorContext @ errorContext.js:19
Subject2.next @ Subject.js:31
emit @ _untracked-chunk.mjs:2256
Button_Template_button_click_0_listener @ primeng-button.mjs:1326
executeListenerWithErrorHandling @ _debug_node-chunk.mjs:7959
wrapListenerIn_markDirtyAndPreventDefault @ _debug_node-chunk.mjs:7946
(anonymous) @ _dom_renderer-chunk.mjs:566
installHook.js:1 Unable to determine content-length from response headers. Will expand buffer when needed.
overrideMethod @ installHook.js:1
readResponse @ transformers.web.js:5675
loadResourceFile @ transformers.web.js:5909
await in loadResourceFile
getModelFile @ transformers.web.js:5970
await in getModelFile
getModelText @ transformers.web.js:5973
getModelJSON @ transformers.web.js:5984
loadTokenizer @ transformers.web.js:9350
from_pretrained @ transformers.web.js:10892
loadItems @ transformers.web.js:26168
pipeline3 @ transformers.web.js:26127
initialize @ LocalEmbeddingProvider.ts:85
initialize @ EmbeddingEngine.ts:63
initialize @ raptor-eval.service.ts:97
initialize @ raptor-eval.component.ts:316
RaptorEvalComponent_Template_p_button_onClick_30_listener @ raptor-eval.component.ts:74
executeListenerWithErrorHandling @ _debug_node-chunk.mjs:7959
wrapListenerIn_markDirtyAndPreventDefault @ _debug_node-chunk.mjs:7946
ConsumerObserver2.next @ Subscriber.js:96
Subscriber2._next @ Subscriber.js:63
Subscriber2.next @ Subscriber.js:34
(anonymous) @ Subject.js:41
errorContext @ errorContext.js:19
Subject2.next @ Subject.js:31
emit @ _untracked-chunk.mjs:2256
Button_Template_button_click_0_listener @ primeng-button.mjs:1326
executeListenerWithErrorHandling @ _debug_node-chunk.mjs:7959
wrapListenerIn_markDirtyAndPreventDefault @ _debug_node-chunk.mjs:7946
(anonymous) @ _dom_renderer-chunk.mjs:566
LocalEmbeddingProvider.ts:113 [LocalEmbeddingProvider] ✓ Model loaded: MDBR Leaf (256d) (wasm)
raptor-eval.service.ts:98 [RaptorEvalService] EmbeddingEngine ready
raptor-eval.service.ts:131 [RaptorEvalService] Sending INIT to load WASM...
gokitt.worker.ts:2169 [GoKittWorker] Worker loaded - waiting for INIT
gokitt.worker.ts:396 [GoKittWorker] Received: INIT
gokitt.worker.ts:353 [GoKittWorker] Loading wasm_exec.js...
gokitt.worker.ts:370 [GoKittWorker] Loading gokitt.wasm...
gokitt.worker.ts:222 [GoKitt] WASM Ready v0.9.0

gokitt.worker.ts:387 [GoKittWorker] ✅ WASM loaded and ready
raptor-eval.service.ts:136 [RaptorEvalService] WASM loaded
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INIT
raptor-eval.service.ts:152 [RaptorEvalService] Initialized
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_GET_STATS
gokitt.worker.ts:2126 [GoKittWorker] RAPTOR_GET_STATS raw result: {"docCount":0,"leafCount":0,"treeCount":0}
gokitt.worker.ts:2128 [GoKittWorker] RAPTOR_GET_STATS parsed: {docCount: 0, leafCount: 0, treeCount: 0}
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-0 (697 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 2 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 2 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-0 textLen= 697 embeddingsLen= 16109
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-0"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-0'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-0
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-1 (26 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-1 textLen= 26 embeddingsLen= 8076
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-1"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-1'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-1
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-2 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-2 textLen= 32 embeddingsLen= 8060
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-2"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-2'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-2
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-3 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-3 textLen= 29 embeddingsLen= 8079
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-3"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-3'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-3
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-4 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-4 textLen= 33 embeddingsLen= 8057
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-4"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-4'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-4
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-5 (37 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-5 textLen= 37 embeddingsLen= 8056
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-5"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-5'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-5
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-6 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-6 textLen= 33 embeddingsLen= 8068
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-6"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-6'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-6
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-7 (26 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-7 textLen= 26 embeddingsLen= 8054
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-7"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-7'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-7
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-8 (35 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-8 textLen= 35 embeddingsLen= 8087
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-8"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-8'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-8
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-9 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-9 textLen= 29 embeddingsLen= 8077
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-9"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-9'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-9
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-10 (35 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-10 textLen= 35 embeddingsLen= 8113
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-10"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-10'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-10
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-11 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-11 textLen= 29 embeddingsLen= 8063
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-11"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-11'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-11
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-12 (34 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-12 textLen= 34 embeddingsLen= 8064
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-12"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-12'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-12
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-13 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-13 textLen= 32 embeddingsLen= 8081
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-13"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-13'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-13
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-14 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-14 textLen= 28 embeddingsLen= 8053
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-14"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-14'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-14
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-15 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-15 textLen= 28 embeddingsLen= 8065
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-15"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-15'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-15
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-16 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-16 textLen= 32 embeddingsLen= 8068
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-16"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-16'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-16
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-17 (34 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-17 textLen= 34 embeddingsLen= 8071
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-17"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-17'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-17
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-18 (27 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-18 textLen= 27 embeddingsLen= 8075
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-18"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-18'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-18
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-19 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-19 textLen= 32 embeddingsLen= 8058
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-19"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-19'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-19
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-20 (46 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-20 textLen= 46 embeddingsLen= 8043
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-20"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-20'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-20
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-21 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-21 textLen= 32 embeddingsLen= 8081
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-21"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-21'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-21
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-22 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-22 textLen= 31 embeddingsLen= 8086
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-22"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-22'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-22
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-23 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-23 textLen= 29 embeddingsLen= 8055
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-23"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-23'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-23
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-24 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-24 textLen= 28 embeddingsLen= 8061
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-24"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-24'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-24
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-25 (35 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-25 textLen= 35 embeddingsLen= 8065
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-25"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-25'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-25
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-26 (21 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-26 textLen= 21 embeddingsLen= 8088
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-26"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-26'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-26
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-27 (55 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-27 textLen= 55 embeddingsLen= 8061
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-27"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-27'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-27
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-28 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-28 textLen= 29 embeddingsLen= 8080
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-28"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-28'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-28
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-29 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-29 textLen= 29 embeddingsLen= 8086
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-29"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-29'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-29
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-30 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-30 textLen= 32 embeddingsLen= 8061
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-30"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-30'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-30
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-31 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-31 textLen= 33 embeddingsLen= 8067
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-31"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-31'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-31
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-32 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-32 textLen= 33 embeddingsLen= 8058
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-32"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-32'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-32
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-33 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-33 textLen= 28 embeddingsLen= 8056
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-33"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-33'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-33
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-34 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-34 textLen= 29 embeddingsLen= 8069
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-34"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-34'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-34
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-35 (27 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-35 textLen= 27 embeddingsLen= 8063
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-35"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-35'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-35
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-36 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-36 textLen= 28 embeddingsLen= 8077
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-36"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-36'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-36
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-37 (37 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-37 textLen= 37 embeddingsLen= 8067
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-37"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-37'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-37
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-38 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-38 textLen= 31 embeddingsLen= 8075
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-38"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-38'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-38
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-39 (45 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-39 textLen= 45 embeddingsLen= 8062
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-39"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-39'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-39
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-40 (53 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-40 textLen= 53 embeddingsLen= 8069
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-40"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-40'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-40
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-41 (52 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-41 textLen= 52 embeddingsLen= 8082
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-41"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-41'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-41
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-42 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-42 textLen= 31 embeddingsLen= 8075
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-42"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-42'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-42
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-43 (42 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-43 textLen= 42 embeddingsLen= 8051
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-43"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-43'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-43
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-44 (37 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-44 textLen= 37 embeddingsLen= 8072
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-44"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-44'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-44
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-45 (36 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-45 textLen= 36 embeddingsLen= 8045
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-45"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-45'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-45
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-46 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-46 textLen= 31 embeddingsLen= 8074
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-46"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-46'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-46
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-47 (34 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-47 textLen= 34 embeddingsLen= 8035
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-47"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-47'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-47
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-48 (25 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-48 textLen= 25 embeddingsLen= 8064
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-48"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-48'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-48
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-49 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-49 textLen= 32 embeddingsLen= 8054
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-49"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-49'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-49
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-50 (57 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-50 textLen= 57 embeddingsLen= 8048
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-50"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-50'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-50
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-51 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-51 textLen= 29 embeddingsLen= 8077
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-51"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-51'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-51
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-52 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-52 textLen= 33 embeddingsLen= 8065
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-52"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-52'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-52
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-53 (34 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-53 textLen= 34 embeddingsLen= 8068
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-53"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-53'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-53
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-54 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-54 textLen= 32 embeddingsLen= 8063
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-54"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-54'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-54
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-55 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-55 textLen= 33 embeddingsLen= 8071
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-55"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-55'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-55
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-56 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-56 textLen= 32 embeddingsLen= 8031
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-56"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-56'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-56
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-57 (42 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-57 textLen= 42 embeddingsLen= 8079
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-57"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-57'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-57
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-58 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-58 textLen= 33 embeddingsLen= 8062
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-58"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-58'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-58
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-59 (30 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-59 textLen= 30 embeddingsLen= 8066
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-59"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-59'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-59
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-60 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-60 textLen= 29 embeddingsLen= 8045
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-60"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-60'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-60
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-61 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-61 textLen= 31 embeddingsLen= 8058
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-61"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-61'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-61
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-62 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-62 textLen= 32 embeddingsLen= 8062
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-62"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-62'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-62
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-63 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-63 textLen= 33 embeddingsLen= 8060
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-63"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-63'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-63
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-64 (50 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-64 textLen= 50 embeddingsLen= 8073
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-64"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-64'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-64
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-65 (36 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-65 textLen= 36 embeddingsLen= 8070
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-65"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-65'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-65
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-66 (25 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-66 textLen= 25 embeddingsLen= 8038
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-66"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-66'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-66
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-67 (30 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-67 textLen= 30 embeddingsLen= 8052
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-67"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-67'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-67
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-68 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-68 textLen= 33 embeddingsLen= 8094
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-68"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-68'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-68
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-69 (30 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-69 textLen= 30 embeddingsLen= 8055
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-69"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-69'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-69
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-70 (24 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-70 textLen= 24 embeddingsLen= 8077
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-70"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-70'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-70
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-71 (34 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-71 textLen= 34 embeddingsLen= 8087
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-71"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-71'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-71
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-72 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-72 textLen= 29 embeddingsLen= 8069
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-72"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-72'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-72
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-73 (27 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-73 textLen= 27 embeddingsLen= 8056
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-73"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-73'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-73
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-74 (36 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-74 textLen= 36 embeddingsLen= 8077
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-74"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-74'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-74
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-75 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-75 textLen= 32 embeddingsLen= 8084
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-75"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-75'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-75
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-76 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-76 textLen= 29 embeddingsLen= 8079
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-76"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-76'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-76
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-77 (24 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-77 textLen= 24 embeddingsLen= 8081
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-77"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-77'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-77
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-78 (36 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-78 textLen= 36 embeddingsLen= 8078
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-78"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-78'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-78
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-79 (49 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-79 textLen= 49 embeddingsLen= 8044
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-79"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-79'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-79
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-80 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-80 textLen= 33 embeddingsLen= 8077
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-80"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-80'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-80
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-81 (39 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-81 textLen= 39 embeddingsLen= 8060
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-81"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-81'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-81
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-82 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-82 textLen= 32 embeddingsLen= 8086
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-82"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-82'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-82
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-83 (21 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-83 textLen= 21 embeddingsLen= 8044
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-83"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-83'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-83
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-84 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-84 textLen= 29 embeddingsLen= 8093
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-84"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-84'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-84
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-85 (34 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-85 textLen= 34 embeddingsLen= 8049
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-85"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-85'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-85
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-86 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-86 textLen= 31 embeddingsLen= 8052
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-86"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-86'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-86
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-87 (30 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-87 textLen= 30 embeddingsLen= 8090
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-87"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-87'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-87
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-88 (30 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-88 textLen= 30 embeddingsLen= 8077
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-88"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-88'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-88
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-89 (57 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-89 textLen= 57 embeddingsLen= 8081
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-89"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-89'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-89
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-90 (46 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-90 textLen= 46 embeddingsLen= 8079
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-90"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-90'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-90
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-91 (34 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-91 textLen= 34 embeddingsLen= 8052
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-91"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-91'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-91
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-92 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-92 textLen= 33 embeddingsLen= 8063
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-92"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-92'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-92
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-93 (40 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-93 textLen= 40 embeddingsLen= 8071
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-93"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-93'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-93
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-94 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-94 textLen= 28 embeddingsLen= 8085
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-94"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-94'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-94
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-95 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-95 textLen= 29 embeddingsLen= 8059
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-95"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-95'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-95
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-96 (35 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-96 textLen= 35 embeddingsLen= 8076
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-96"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-96'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-96
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-97 (39 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-97 textLen= 39 embeddingsLen= 8068
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-97"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-97'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-97
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-98 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-98 textLen= 29 embeddingsLen= 8067
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-98"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-98'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-98
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-99 (41 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-99 textLen= 41 embeddingsLen= 8061
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-99"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-99'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-99
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-100 (55 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-100 textLen= 55 embeddingsLen= 8093
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-100"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-100'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-100
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-101 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-101 textLen= 33 embeddingsLen= 8103
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-101"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-101'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-101
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-102 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-102 textLen= 28 embeddingsLen= 8058
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-102"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-102'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-102
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-103 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-103 textLen= 28 embeddingsLen= 8071
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-103"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-103'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-103
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-104 (41 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-104 textLen= 41 embeddingsLen= 8070
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-104"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-104'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-104
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-105 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-105 textLen= 31 embeddingsLen= 8049
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-105"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-105'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-105
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-106 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-106 textLen= 28 embeddingsLen= 8074
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-106"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-106'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-106
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-107 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-107 textLen= 31 embeddingsLen= 8085
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-107"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-107'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-107
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-108 (30 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-108 textLen= 30 embeddingsLen= 8065
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-108"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-108'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-108
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-109 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-109 textLen= 32 embeddingsLen= 8061
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-109"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-109'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-109
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-110 (44 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-110 textLen= 44 embeddingsLen= 8086
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-110"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-110'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-110
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-111 (56 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-111 textLen= 56 embeddingsLen= 8062
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-111"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-111'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-111
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-112 (28 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-112 textLen= 28 embeddingsLen= 8077
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-112"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-112'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-112
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-113 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-113 textLen= 32 embeddingsLen= 8069
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-113"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-113'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-113
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-114 (36 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-114 textLen= 36 embeddingsLen= 8074
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-114"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-114'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-114
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-115 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-115 textLen= 32 embeddingsLen= 8070
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-115"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-115'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-115
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-116 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-116 textLen= 33 embeddingsLen= 8078
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-116"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-116'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-116
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-117 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-117 textLen= 31 embeddingsLen= 8070
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-117"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-117'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-117
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-118 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-118 textLen= 33 embeddingsLen= 8064
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-118"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-118'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-118
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-119 (32 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-119 textLen= 32 embeddingsLen= 8060
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-119"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-119'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-119
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-120 (31 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-120 textLen= 31 embeddingsLen= 8048
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-120"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-120'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-120
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-121 (38 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-121 textLen= 38 embeddingsLen= 8054
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-121"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-121'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-121
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-122 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-122 textLen= 33 embeddingsLen= 8064
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-122"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-122'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-122
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-123 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-123 textLen= 33 embeddingsLen= 8064
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-123"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-123'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-123
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-124 (30 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-124 textLen= 30 embeddingsLen= 8089
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-124"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-124'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-124
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-125 (35 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-125 textLen= 35 embeddingsLen= 8053
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-125"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-125'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-125
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-126 (34 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-126 textLen= 34 embeddingsLen= 8096
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-126"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-126'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-126
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-127 (29 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-127 textLen= 29 embeddingsLen= 8078
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-127"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-127'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-127
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-128 (33 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-128 textLen= 33 embeddingsLen= 8070
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-128"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-128'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-128
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-129 (37 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-129 textLen= 37 embeddingsLen= 8070
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-129"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-129'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-129
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-130 (46 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 1 chunks
raptor-eval.service.ts:172 [RaptorEvalService] Generated 1 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-130 textLen= 46 embeddingsLen= 8065
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-130"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-130'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-130
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-131 (15507 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 41 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 5/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 6/6
raptor-eval.service.ts:172 [RaptorEvalService] Generated 41 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-131 textLen= 15507 embeddingsLen= 329929
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-131"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-131'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-131
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-132 (10373 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 27 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/4
raptor-eval.service.ts:172 [RaptorEvalService] Generated 27 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-132 textLen= 10373 embeddingsLen= 217337
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-132"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-132'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-132
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-133 (11817 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 31 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/4
raptor-eval.service.ts:172 [RaptorEvalService] Generated 31 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-133 textLen= 11817 embeddingsLen= 249568
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-133"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-133'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-133
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-134 (18644 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 49 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 5/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 6/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 7/7
raptor-eval.service.ts:172 [RaptorEvalService] Generated 49 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-134 textLen= 18644 embeddingsLen= 394601
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-134"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-134'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-134
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-135 (11786 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 31 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/4
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/4
raptor-eval.service.ts:172 [RaptorEvalService] Generated 31 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-135 textLen= 11786 embeddingsLen= 249498
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-135"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-135'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-135
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-136 (13088 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 34 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/5
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/5
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/5
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/5
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 5/5
raptor-eval.service.ts:172 [RaptorEvalService] Generated 34 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-136 textLen= 13088 embeddingsLen= 273647
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-136"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-136'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-136
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-137 (17420 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 46 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 5/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 6/6
raptor-eval.service.ts:172 [RaptorEvalService] Generated 46 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-137 textLen= 17420 embeddingsLen= 370385
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-137"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-137'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-137
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-138 (15857 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 41 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 5/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 6/6
raptor-eval.service.ts:172 [RaptorEvalService] Generated 41 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-138 textLen= 15857 embeddingsLen= 330045
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-138"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-138'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-138
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-139 (18376 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 48 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 5/6
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 6/6
raptor-eval.service.ts:172 [RaptorEvalService] Generated 48 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-139 textLen= 18376 embeddingsLen= 386346
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-139"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-139'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-139
raptor-eval.service.ts:164 [RaptorEvalService] Ingesting document: chapter-140 (20173 chars)
raptor-eval.service.ts:168 [RaptorEvalService] Split into 53 chunks
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 1/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 2/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 3/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 4/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 5/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 6/7
LocalEmbeddingProvider.ts:159 [LocalEmbedding] Processing batch 7/7
raptor-eval.service.ts:172 [RaptorEvalService] Generated 53 embeddings (384D)
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_INGEST
gokitt.worker.ts:1961 [GoKittWorker] RAPTOR_INGEST: docID= chapter-140 textLen= 20173 embeddingsLen= 426528
gokitt.worker.ts:1967 [GoKittWorker] RAPTOR_INGEST result: {"success":"ingested chapter-140"}
gokitt.worker.ts:1969 [GoKittWorker] RAPTOR_INGEST parsed: {success: 'ingested chapter-140'}
raptor-eval.service.ts:185 [RaptorEvalService] Ingested chapter-140
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_GET_STATS
gokitt.worker.ts:2126 [GoKittWorker] RAPTOR_GET_STATS raw result: {"docCount":141,"leafCount":543,"treeCount":141}
gokitt.worker.ts:2128 [GoKittWorker] RAPTOR_GET_STATS parsed: {docCount: 141, leafCount: 543, treeCount: 141}
eval-runner.ts:115 [EvalRunner] Running 20 queries across 3 modes
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Ryan Romano" in 66.1ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Ryan Romano" returned 10 results: (3) ['CHUNK(chunk:chapter-132:2486:2976)', 'CHUNK(chunk:chapter-139:12241:12750)', 'CHUNK(chunk:chapter-0:0:412)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Ryan Romano" in 28.0ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Ryan Romano" returned 10 results: (3) ['DOC(chapter-132)', 'DOC(chapter-139)', 'DOC(chapter-0)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Ryan Romano" in 22.6ms, 7 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Ryan Romano" returned 7 results: (3) ['DOC(chapter-132)', 'DOC(chapter-139)', 'DOC(chapter-0)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Quicksave" in 23.8ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Quicksave" returned 10 results: (3) ['CHUNK(chunk:chapter-1:0:24)', 'CHUNK(chunk:chapter-137:10345:10808)', 'CHUNK(chunk:chapter-132:3944:4385)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Quicksave" in 23.2ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Quicksave" returned 10 results: (3) ['DOC(chapter-1)', 'DOC(chapter-137)', 'DOC(chapter-132)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Quicksave" in 21.5ms, 4 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Quicksave" returned 4 results: (3) ['DOC(chapter-1)', 'DOC(chapter-137)', 'DOC(chapter-132)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "New Rome" in 22.3ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "New Rome" returned 10 results: (3) ['CHUNK(chunk:chapter-132:1439:1897)', 'CHUNK(chunk:chapter-81:0:37)', 'CHUNK(chunk:chapter-130:0:44)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "New Rome" in 22.1ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "New Rome" returned 10 results: (3) ['DOC(chapter-132)', 'DOC(chapter-81)', 'DOC(chapter-130)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "New Rome" in 20.2ms, 6 docs
eval-runner.ts:155 [EvalRunner] aggregated query "New Rome" returned 6 results: (3) ['DOC(chapter-132)', 'DOC(chapter-81)', 'DOC(chapter-130)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Dynamis Tower" in 23.5ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Dynamis Tower" returned 10 results: (3) ['CHUNK(chunk:chapter-131:998:1486)', 'CHUNK(chunk:chapter-137:14802:15274)', 'CHUNK(chunk:chapter-136:2391:2774)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Dynamis Tower" in 21.6ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Dynamis Tower" returned 10 results: (3) ['DOC(chapter-131)', 'DOC(chapter-137)', 'DOC(chapter-136)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Dynamis Tower" in 22.1ms, 4 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Dynamis Tower" returned 4 results: (3) ['DOC(chapter-131)', 'DOC(chapter-137)', 'DOC(chapter-136)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Plymouth Fury" in 25.9ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Plymouth Fury" returned 10 results: (3) ['CHUNK(chunk:chapter-137:16875:17334)', 'CHUNK(chunk:chapter-135:11251:11730)', 'CHUNK(chunk:chapter-131:493:997)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Plymouth Fury" in 30.8ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Plymouth Fury" returned 10 results: (3) ['DOC(chapter-137)', 'DOC(chapter-135)', 'DOC(chapter-131)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Plymouth Fury" in 29.1ms, 6 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Plymouth Fury" returned 6 results: (3) ['DOC(chapter-137)', 'DOC(chapter-135)', 'DOC(chapter-131)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is Ryan's superpower?" in 31.8ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "What is Ryan's superpower?" returned 10 results: (3) ['CHUNK(chunk:chapter-131:2864:3358)', 'CHUNK(chunk:chapter-139:4722:5163)', 'CHUNK(chunk:chapter-131:7659:8164)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is Ryan's superpower?" in 22.3ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "What is Ryan's superpower?" returned 10 results: (3) ['DOC(chapter-131)', 'DOC(chapter-139)', 'DOC(chapter-131)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is Ryan's superpower?" in 28.6ms, 5 docs
eval-runner.ts:155 [EvalRunner] aggregated query "What is Ryan's superpower?" returned 5 results: (3) ['DOC(chapter-131)', 'DOC(chapter-139)', 'DOC(chapter-140)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Who is the ice assassin?" in 17.5ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Who is the ice assassin?" returned 10 results: (3) ['CHUNK(chunk:chapter-132:8883:9377)', 'CHUNK(chunk:chapter-131:10480:10982)', 'CHUNK(chunk:chapter-131:6932:7382)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Who is the ice assassin?" in 89.8ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Who is the ice assassin?" returned 10 results: (3) ['DOC(chapter-132)', 'DOC(chapter-131)', 'DOC(chapter-131)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Who is the ice assassin?" in 23.4ms, 9 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Who is the ice assassin?" returned 9 results: (3) ['DOC(chapter-132)', 'DOC(chapter-131)', 'DOC(chapter-110)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What happened at the bar?" in 18.1ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "What happened at the bar?" returned 10 results: (3) ['CHUNK(chunk:chapter-135:11251:11730)', 'CHUNK(chunk:chapter-66:0:23)', 'CHUNK(chunk:chapter-29:0:27)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What happened at the bar?" in 22.0ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "What happened at the bar?" returned 10 results: (3) ['DOC(chapter-135)', 'DOC(chapter-66)', 'DOC(chapter-29)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What happened at the bar?" in 20.6ms, 10 docs
eval-runner.ts:155 [EvalRunner] aggregated query "What happened at the bar?" returned 10 results: (3) ['DOC(chapter-135)', 'DOC(chapter-66)', 'DOC(chapter-29)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Describe the city setting" in 17.2ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Describe the city setting" returned 10 results: (3) ['CHUNK(chunk:chapter-23:0:27)', 'CHUNK(chunk:chapter-123:0:31)', 'CHUNK(chunk:chapter-19:0:30)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Describe the city setting" in 23.0ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Describe the city setting" returned 10 results: (3) ['DOC(chapter-23)', 'DOC(chapter-123)', 'DOC(chapter-19)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Describe the city setting" in 19.9ms, 10 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Describe the city setting" returned 10 results: (3) ['DOC(chapter-23)', 'DOC(chapter-123)', 'DOC(chapter-19)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What does Quicksave look like?" in 23.1ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "What does Quicksave look like?" returned 10 results: (3) ['CHUNK(chunk:chapter-1:0:24)', 'CHUNK(chunk:chapter-131:12148:12562)', 'CHUNK(chunk:chapter-137:10345:10808)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What does Quicksave look like?" in 25.3ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "What does Quicksave look like?" returned 10 results: (3) ['DOC(chapter-1)', 'DOC(chapter-131)', 'DOC(chapter-137)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What does Quicksave look like?" in 22.8ms, 5 docs
eval-runner.ts:155 [EvalRunner] aggregated query "What does Quicksave look like?" returned 5 results: (3) ['DOC(chapter-1)', 'DOC(chapter-131)', 'DOC(chapter-137)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does Ryan's immortality affect his approach to danger?" in 29.3ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "How does Ryan's immortality affect his approach to danger?" returned 10 results: (3) ['CHUNK(chunk:chapter-138:14234:14733)', 'CHUNK(chunk:chapter-140:8838:9270)', 'CHUNK(chunk:chapter-131:8450:8905)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does Ryan's immortality affect his approach to danger?" in 29.9ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "How does Ryan's immortality affect his approach to danger?" returned 10 results: (3) ['DOC(chapter-138)', 'DOC(chapter-140)', 'DOC(chapter-131)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does Ryan's immortality affect his approach to danger?" in 27.5ms, 6 docs
eval-runner.ts:155 [EvalRunner] aggregated query "How does Ryan's immortality affect his approach to danger?" returned 6 results: (3) ['DOC(chapter-138)', 'DOC(chapter-140)', 'DOC(chapter-131)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What are the major factions in New Rome?" in 26.5ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "What are the major factions in New Rome?" returned 10 results: (3) ['CHUNK(chunk:chapter-132:5279:5759)', 'CHUNK(chunk:chapter-130:0:44)', 'CHUNK(chunk:chapter-140:2127:2596)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What are the major factions in New Rome?" in 26.7ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "What are the major factions in New Rome?" returned 10 results: (3) ['DOC(chapter-132)', 'DOC(chapter-130)', 'DOC(chapter-140)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What are the major factions in New Rome?" in 27.6ms, 8 docs
eval-runner.ts:155 [EvalRunner] aggregated query "What are the major factions in New Rome?" returned 8 results: (3) ['DOC(chapter-132)', 'DOC(chapter-130)', 'DOC(chapter-140)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does corporate power manifest in the city?" in 25.8ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "How does corporate power manifest in the city?" returned 10 results: (3) ['CHUNK(chunk:chapter-82:0:30)', 'CHUNK(chunk:chapter-12:0:32)', 'CHUNK(chunk:chapter-44:0:35)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does corporate power manifest in the city?" in 24.1ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "How does corporate power manifest in the city?" returned 10 results: (3) ['DOC(chapter-82)', 'DOC(chapter-12)', 'DOC(chapter-44)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does corporate power manifest in the city?" in 20.8ms, 10 docs
eval-runner.ts:155 [EvalRunner] aggregated query "How does corporate power manifest in the city?" returned 10 results: (3) ['DOC(chapter-82)', 'DOC(chapter-12)', 'DOC(chapter-44)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the relationship between Genomes and normal humans?" in 25.8ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "What is the relationship between Genomes and normal humans?" returned 10 results: (3) ['CHUNK(chunk:chapter-111:0:54)', 'CHUNK(chunk:chapter-68:0:31)', 'CHUNK(chunk:chapter-86:0:29)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the relationship between Genomes and normal humans?" in 22.5ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "What is the relationship between Genomes and normal humans?" returned 10 results: (3) ['DOC(chapter-111)', 'DOC(chapter-68)', 'DOC(chapter-86)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the relationship between Genomes and normal humans?" in 26.9ms, 10 docs
eval-runner.ts:155 [EvalRunner] aggregated query "What is the relationship between Genomes and normal humans?" returned 10 results: (3) ['DOC(chapter-111)', 'DOC(chapter-68)', 'DOC(chapter-86)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does the time loop mechanic work?" in 25.9ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "How does the time loop mechanic work?" returned 10 results: (3) ['CHUNK(chunk:chapter-0:413:701)', 'CHUNK(chunk:chapter-131:8090:8520)', 'CHUNK(chunk:chapter-49:0:30)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does the time loop mechanic work?" in 21.9ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "How does the time loop mechanic work?" returned 10 results: (3) ['DOC(chapter-0)', 'DOC(chapter-131)', 'DOC(chapter-49)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does the time loop mechanic work?" in 26.3ms, 10 docs
eval-runner.ts:155 [EvalRunner] aggregated query "How does the time loop mechanic work?" returned 10 results: (3) ['DOC(chapter-0)', 'DOC(chapter-131)', 'DOC(chapter-49)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all mentions of the black briefcase" in 22.5ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Find all mentions of the black briefcase" returned 10 results: (3) ['CHUNK(chunk:chapter-33:0:26)', 'CHUNK(chunk:chapter-107:0:29)', 'CHUNK(chunk:chapter-37:0:35)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all mentions of the black briefcase" in 20.8ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Find all mentions of the black briefcase" returned 10 results: (3) ['DOC(chapter-33)', 'DOC(chapter-107)', 'DOC(chapter-37)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all mentions of the black briefcase" in 21.4ms, 10 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Find all mentions of the black briefcase" returned 10 results: (3) ['DOC(chapter-33)', 'DOC(chapter-107)', 'DOC(chapter-37)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track character introductions across chapters" in 24.8ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Track character introductions across chapters" returned 10 results: (3) ['CHUNK(chunk:chapter-132:1439:1897)', 'CHUNK(chunk:chapter-134:4254:4754)', 'CHUNK(chunk:chapter-136:10507:10949)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track character introductions across chapters" in 28.5ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Track character introductions across chapters" returned 10 results: (3) ['DOC(chapter-132)', 'DOC(chapter-134)', 'DOC(chapter-136)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track character introductions across chapters" in 26.7ms, 4 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Track character introductions across chapters" returned 4 results: (3) ['DOC(chapter-132)', 'DOC(chapter-134)', 'DOC(chapter-136)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Locate all fight scenes with Genomes" in 21.1ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Locate all fight scenes with Genomes" returned 10 results: (3) ['CHUNK(chunk:chapter-140:4815:5324)', 'CHUNK(chunk:chapter-138:643:1152)', 'CHUNK(chunk:chapter-132:8065:8491)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Locate all fight scenes with Genomes" in 23.7ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Locate all fight scenes with Genomes" returned 10 results: (3) ['DOC(chapter-140)', 'DOC(chapter-138)', 'DOC(chapter-132)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Locate all fight scenes with Genomes" in 28.4ms, 7 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Locate all fight scenes with Genomes" returned 7 results: (3) ['DOC(chapter-140)', 'DOC(chapter-138)', 'DOC(chapter-132)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all references to Dynamis corporation" in 23.4ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Find all references to Dynamis corporation" returned 10 results: (3) ['CHUNK(chunk:chapter-136:2391:2774)', 'CHUNK(chunk:chapter-137:14802:15274)', 'CHUNK(chunk:chapter-137:14438:14875)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all references to Dynamis corporation" in 30.5ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Find all references to Dynamis corporation" returned 10 results: (3) ['DOC(chapter-136)', 'DOC(chapter-137)', 'DOC(chapter-137)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all references to Dynamis corporation" in 25.0ms, 5 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Find all references to Dynamis corporation" returned 5 results: (3) ['DOC(chapter-136)', 'DOC(chapter-137)', 'DOC(chapter-134)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track Ryan's deaths across the story" in 20.9ms, 10 results
eval-runner.ts:155 [EvalRunner] leaf-only query "Track Ryan's deaths across the story" returned 10 results: (3) ['CHUNK(chunk:chapter-2:0:30)', 'CHUNK(chunk:chapter-66:0:23)', 'CHUNK(chunk:chapter-23:0:27)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track Ryan's deaths across the story" in 20.2ms, 10 results
eval-runner.ts:155 [EvalRunner] collapsed-tree query "Track Ryan's deaths across the story" returned 10 results: (3) ['DOC(chapter-2)', 'DOC(chapter-66)', 'DOC(chapter-23)']
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track Ryan's deaths across the story" in 22.0ms, 10 docs
eval-runner.ts:155 [EvalRunner] aggregated query "Track Ryan's deaths across the story" returned 10 results: (3) ['DOC(chapter-2)', 'DOC(chapter-66)', 'DOC(chapter-23)']
generate-gold-queries.ts:38 [GoldQueryGenerator] Generating gold queries for 100 queries...
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-001 - "Ryan Romano"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Ryan Romano" in 71.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Ryan Romano" in 18.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Ryan Romano" in 16.4ms, 7 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 7 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-002 - "Quicksave"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Quicksave" in 23.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Quicksave" in 19.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Quicksave" in 20.7ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-003 - "New Rome"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "New Rome" in 19.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "New Rome" in 20.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "New Rome" in 22.3ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-004 - "Dynamis Tower"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Dynamis Tower" in 24.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Dynamis Tower" in 19.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Dynamis Tower" in 21.8ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-005 - "Plymouth Fury"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Plymouth Fury" in 29.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Plymouth Fury" in 23.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Plymouth Fury" in 27.1ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-006 - "Renesco Jolie Wrangler"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Renesco Jolie Wrangler" in 20.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Renesco Jolie Wrangler" in 25.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Renesco Jolie Wrangler" in 18.5ms, 3 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 3 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-007 - "ice spear"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "ice spear" in 16.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "ice spear" in 18.3ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "ice spear" in 17.3ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-008 - "Ghoul"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Ghoul" in 36.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Ghoul" in 89.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Ghoul" in 23.2ms, 3 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 3 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-009 - "Meta-Gang"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Meta-Gang" in 25.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Meta-Gang" in 26.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Meta-Gang" in 26.0ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-010 - "Genome"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Genome" in 16.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Genome" in 17.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Genome" in 16.1ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-011 - "Hercules Elixir"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Hercules Elixir" in 18.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Hercules Elixir" in 17.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Hercules Elixir" in 18.1ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-012 - "Wyvern"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Wyvern" in 18.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Wyvern" in 14.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Wyvern" in 17.7ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-013 - "Adam sends his regards"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Adam sends his regards" in 25.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Adam sends his regards" in 17.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Adam sends his regards" in 19.7ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-014 - "time-stop"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "time-stop" in 30.1ms, 4 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "time-stop" in 30.7ms, 4 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "time-stop" in 28.7ms, 3 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 4 chunks, 3 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-015 - "save point"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "save point" in 18.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "save point" in 24.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "save point" in 25.9ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-016 - "black briefcase"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "black briefcase" in 24.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "black briefcase" in 24.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "black briefcase" in 25.6ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-017 - "white rabbit plushie"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "white rabbit plushie" in 26.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "white rabbit plushie" in 26.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "white rabbit plushie" in 19.3ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-018 - "Highway to Hell"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Highway to Hell" in 24.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Highway to Hell" in 23.3ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Highway to Hell" in 26.7ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-019 - "Private Security"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Private Security" in 15.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Private Security" in 19.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Private Security" in 17.9ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: exact-020 - "Psycho"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Psycho" in 16.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Psycho" in 20.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Psycho" in 17.3ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-001 - "What is Ryan's superpower?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is Ryan's superpower?" in 23.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is Ryan's superpower?" in 20.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is Ryan's superpower?" in 23.2ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-002 - "Who is the ice assassin?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Who is the ice assassin?" in 17.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Who is the ice assassin?" in 17.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Who is the ice assassin?" in 25.9ms, 9 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 9 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-003 - "What happened at the bar?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What happened at the bar?" in 22.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What happened at the bar?" in 18.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What happened at the bar?" in 16.2ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-004 - "Describe the city setting"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Describe the city setting" in 20.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Describe the city setting" in 15.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Describe the city setting" in 19.1ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-005 - "What does Quicksave look like?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What does Quicksave look like?" in 23.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What does Quicksave look like?" in 28.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What does Quicksave look like?" in 27.2ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-006 - "How does immortality work?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does immortality work?" in 20.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does immortality work?" in 19.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does immortality work?" in 21.2ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-007 - "What are the superpowers in this world?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What are the superpowers in this world?" in 23.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What are the superpowers in this world?" in 31.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What are the superpowers in this world?" in 26.1ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-008 - "Who sent the assassin?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Who sent the assassin?" in 17.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Who sent the assassin?" in 17.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Who sent the assassin?" in 17.1ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-009 - "What is Dynamis corporation?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is Dynamis corporation?" in 27.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is Dynamis corporation?" in 23.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is Dynamis corporation?" in 24.0ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-010 - "How do save points work?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How do save points work?" in 22.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How do save points work?" in 19.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How do save points work?" in 23.9ms, 7 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 7 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-011 - "What is the Golden Coast?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the Golden Coast?" in 91.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the Golden Coast?" in 24.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the Golden Coast?" in 21.6ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-012 - "What happened on May 8th?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What happened on May 8th?" in 18.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What happened on May 8th?" in 26.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What happened on May 8th?" in 21.2ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-013 - "How many times did Ryan die?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How many times did Ryan die?" in 20.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How many times did Ryan die?" in 24.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How many times did Ryan die?" in 26.3ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-014 - "What is a Genome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is a Genome?" in 21.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is a Genome?" in 22.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is a Genome?" in 22.6ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-015 - "What is the Meta-Gang?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the Meta-Gang?" in 17.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the Meta-Gang?" in 18.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the Meta-Gang?" in 18.4ms, 9 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 9 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-016 - "How did Ryan defeat the assassin?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How did Ryan defeat the assassin?" in 19.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How did Ryan defeat the assassin?" in 21.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How did Ryan defeat the assassin?" in 22.1ms, 7 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 7 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-017 - "What weapons does Ryan have?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What weapons does Ryan have?" in 24.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What weapons does Ryan have?" in 21.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What weapons does Ryan have?" in 18.1ms, 3 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 3 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-018 - "What is the Hercules Elixir?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the Hercules Elixir?" in 28.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the Hercules Elixir?" in 23.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the Hercules Elixir?" in 27.7ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-019 - "Who is Wyvern?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Who is Wyvern?" in 19.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Who is Wyvern?" in 18.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Who is Wyvern?" in 17.4ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-020 - "What is Ryan's costume?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is Ryan's costume?" in 22.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is Ryan's costume?" in 21.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is Ryan's costume?" in 19.0ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-021 - "What car does Ryan drive?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What car does Ryan drive?" in 19.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What car does Ryan drive?" in 19.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What car does Ryan drive?" in 22.9ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-022 - "What is the barman's name?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the barman's name?" in 20.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the barman's name?" in 19.3ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the barman's name?" in 24.2ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-023 - "What powers does Ghoul have?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What powers does Ghoul have?" in 41.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What powers does Ghoul have?" in 50.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What powers does Ghoul have?" in 43.0ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-024 - "How does bribery work in New Rome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does bribery work in New Rome?" in 38.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does bribery work in New Rome?" in 33.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does bribery work in New Rome?" in 27.0ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-025 - "What is the significance of the number 2020?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the significance of the number 2020?" in 26.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the significance of the number 2020?" in 26.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the significance of the number 2020?" in 41.8ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-026 - "What is Ryan's job?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is Ryan's job?" in 26.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is Ryan's job?" in 30.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is Ryan's job?" in 25.8ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-027 - "What is the Colosseum Maximus?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the Colosseum Maximus?" in 28.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the Colosseum Maximus?" in 20.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the Colosseum Maximus?" in 22.9ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-028 - "What happened to Europe?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What happened to Europe?" in 17.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What happened to Europe?" in 20.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What happened to Europe?" in 23.7ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-029 - "What are potions?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What are potions?" in 24.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What are potions?" in 23.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What are potions?" in 23.0ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: para-030 - "Who is Len?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Who is Len?" in 20.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Who is Len?" in 17.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Who is Len?" in 19.2ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-001 - "How does Ryan's immortality affect his approach to danger?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does Ryan's immortality affect his approach to danger?" in 27.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does Ryan's immortality affect his approach to danger?" in 31.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does Ryan's immortality affect his approach to danger?" in 99.8ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-002 - "What are the major factions in New Rome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What are the major factions in New Rome?" in 20.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What are the major factions in New Rome?" in 25.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What are the major factions in New Rome?" in 27.6ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-003 - "How does corporate power manifest in the city?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does corporate power manifest in the city?" in 29.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does corporate power manifest in the city?" in 23.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does corporate power manifest in the city?" in 20.9ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-004 - "What is the relationship between Genomes and normal humans?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the relationship between Genomes and normal humans?" in 25.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the relationship between Genomes and normal humans?" in 23.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the relationship between Genomes and normal humans?" in 26.3ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-005 - "How does the time loop mechanic work?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does the time loop mechanic work?" in 19.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does the time loop mechanic work?" in 20.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does the time loop mechanic work?" in 22.2ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-006 - "What role does money play in New Rome society?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What role does money play in New Rome society?" in 28.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What role does money play in New Rome society?" in 24.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What role does money play in New Rome society?" in 23.1ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-007 - "How do elixirs and potions change people?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How do elixirs and potions change people?" in 26.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How do elixirs and potions change people?" in 29.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How do elixirs and potions change people?" in 24.0ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-008 - "What is the history of the Genome Wars?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the history of the Genome Wars?" in 20.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the history of the Genome Wars?" in 27.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the history of the Genome Wars?" in 23.0ms, 9 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 9 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-009 - "How does Ryan's personality affect his decisions?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does Ryan's personality affect his decisions?" in 24.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does Ryan's personality affect his decisions?" in 26.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does Ryan's personality affect his decisions?" in 26.0ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-010 - "What is the significance of the ouroboros symbol?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the significance of the ouroboros symbol?" in 18.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the significance of the ouroboros symbol?" in 23.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the significance of the ouroboros symbol?" in 26.8ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-011 - "How does the security system work in New Rome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does the security system work in New Rome?" in 25.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does the security system work in New Rome?" in 25.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does the security system work in New Rome?" in 18.8ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-012 - "What is the relationship between heroes and corporations?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the relationship between heroes and corporations?" in 22.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the relationship between heroes and corporations?" in 30.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the relationship between heroes and corporations?" in 24.0ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-013 - "How do Psychos differ from regular Genomes?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How do Psychos differ from regular Genomes?" in 28.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How do Psychos differ from regular Genomes?" in 22.3ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How do Psychos differ from regular Genomes?" in 26.8ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-014 - "What is the economic structure of New Rome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the economic structure of New Rome?" in 21.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the economic structure of New Rome?" in 22.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the economic structure of New Rome?" in 24.1ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-015 - "How does Ryan use his knowledge from previous loops?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does Ryan use his knowledge from previous loops?" in 23.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does Ryan use his knowledge from previous loops?" in 25.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does Ryan use his knowledge from previous loops?" in 27.4ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-016 - "What is the role of tourism in New Rome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the role of tourism in New Rome?" in 21.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the role of tourism in New Rome?" in 18.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the role of tourism in New Rome?" in 22.3ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-017 - "How do mutations affect Genomes physically?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How do mutations affect Genomes physically?" in 29.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How do mutations affect Genomes physically?" in 26.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How do mutations affect Genomes physically?" in 26.5ms, 7 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 7 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-018 - "What is the significance of the Mediterranean Sea?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the significance of the Mediterranean Sea?" in 20.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the significance of the Mediterranean Sea?" in 20.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the significance of the Mediterranean Sea?" in 24.1ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-019 - "How does Ryan's boredom affect his behavior?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does Ryan's boredom affect his behavior?" in 26.3ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does Ryan's boredom affect his behavior?" in 95.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does Ryan's boredom affect his behavior?" in 28.0ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-020 - "What is the justice system in New Rome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the justice system in New Rome?" in 23.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the justice system in New Rome?" in 20.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the justice system in New Rome?" in 25.4ms, 9 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 9 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-021 - "How do knockoff elixirs compare to real ones?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How do knockoff elixirs compare to real ones?" in 39.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How do knockoff elixirs compare to real ones?" in 27.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How do knockoff elixirs compare to real ones?" in 33.3ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-022 - "What is the role of the Campania region?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the role of the Campania region?" in 24.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the role of the Campania region?" in 23.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the role of the Campania region?" in 22.6ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-023 - "How does Ryan's driving reflect his personality?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does Ryan's driving reflect his personality?" in 22.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does Ryan's driving reflect his personality?" in 23.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does Ryan's driving reflect his personality?" in 25.5ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-024 - "What is the relationship between Dynamis and the government?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the relationship between Dynamis and the government?" in 19.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the relationship between Dynamis and the government?" in 26.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the relationship between Dynamis and the government?" in 22.3ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-025 - "How do supers impact daily life in New Rome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How do supers impact daily life in New Rome?" in 29.7ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How do supers impact daily life in New Rome?" in 25.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How do supers impact daily life in New Rome?" in 30.5ms, 7 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 7 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-026 - "What is the significance of Ryan's mask?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the significance of Ryan's mask?" in 28.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the significance of Ryan's mask?" in 20.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the significance of Ryan's mask?" in 22.5ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-027 - "How does the time-stop power work?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does the time-stop power work?" in 24.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does the time-stop power work?" in 22.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does the time-stop power work?" in 19.5ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-028 - "What is the role of drugs in New Rome?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the role of drugs in New Rome?" in 22.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the role of drugs in New Rome?" in 20.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the role of drugs in New Rome?" in 23.1ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-029 - "How does Ryan's reputation affect his interactions?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "How does Ryan's reputation affect his interactions?" in 23.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "How does Ryan's reputation affect his interactions?" in 26.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "How does Ryan's reputation affect his interactions?" in 23.3ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: theme-030 - "What is the significance of the date May 8th?"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "What is the significance of the date May 8th?" in 19.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "What is the significance of the date May 8th?" in 23.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "What is the significance of the date May 8th?" in 31.4ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-001 - "Find all mentions of the black briefcase"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all mentions of the black briefcase" in 19.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all mentions of the black briefcase" in 24.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all mentions of the black briefcase" in 19.0ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-002 - "Track character introductions across chapters"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track character introductions across chapters" in 25.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track character introductions across chapters" in 26.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track character introductions across chapters" in 35.4ms, 4 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 4 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-003 - "Locate all fight scenes with Genomes"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Locate all fight scenes with Genomes" in 17.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Locate all fight scenes with Genomes" in 22.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Locate all fight scenes with Genomes" in 20.1ms, 7 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 7 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-004 - "Find all references to Dynamis corporation"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all references to Dynamis corporation" in 21.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all references to Dynamis corporation" in 22.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all references to Dynamis corporation" in 23.5ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-005 - "Track Ryan's deaths across the story"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track Ryan's deaths across the story" in 18.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track Ryan's deaths across the story" in 21.3ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track Ryan's deaths across the story" in 29.7ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-006 - "Find all mentions of time loops"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all mentions of time loops" in 33.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all mentions of time loops" in 45.0ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all mentions of time loops" in 36.3ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-007 - "Locate all scenes in the Golden Coast district"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Locate all scenes in the Golden Coast district" in 45.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Locate all scenes in the Golden Coast district" in 27.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Locate all scenes in the Golden Coast district" in 32.9ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-008 - "Track the Meta-Gang storyline"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track the Meta-Gang storyline" in 45.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track the Meta-Gang storyline" in 30.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track the Meta-Gang storyline" in 26.0ms, 9 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 9 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-009 - "Find all references to elixirs and potions"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all references to elixirs and potions" in 28.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all references to elixirs and potions" in 28.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all references to elixirs and potions" in 32.2ms, 7 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 7 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-010 - "Track Ryan's relationships with other characters"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track Ryan's relationships with other characters" in 24.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track Ryan's relationships with other characters" in 21.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track Ryan's relationships with other characters" in 24.6ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-011 - "Find all scenes involving Private Security"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all scenes involving Private Security" in 27.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all scenes involving Private Security" in 25.2ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all scenes involving Private Security" in 25.2ms, 5 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 5 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-012 - "Track mentions of the Hercules Elixir"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track mentions of the Hercules Elixir" in 20.9ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track mentions of the Hercules Elixir" in 26.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track mentions of the Hercules Elixir" in 22.9ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-013 - "Find all references to the Genome Wars"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all references to the Genome Wars" in 21.3ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all references to the Genome Wars" in 17.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all references to the Genome Wars" in 21.7ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-014 - "Track the story's setting descriptions"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track the story's setting descriptions" in 91.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track the story's setting descriptions" in 22.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track the story's setting descriptions" in 30.1ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-015 - "Find all scenes with combat or violence"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all scenes with combat or violence" in 26.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all scenes with combat or violence" in 24.6ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all scenes with combat or violence" in 25.4ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-016 - "Track Ryan's use of his powers"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track Ryan's use of his powers" in 19.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track Ryan's use of his powers" in 24.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track Ryan's use of his powers" in 26.8ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-017 - "Find all references to superpowers"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all references to superpowers" in 31.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all references to superpowers" in 26.1ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all references to superpowers" in 30.8ms, 6 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 6 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-018 - "Track the role of money and bribery"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track the role of money and bribery" in 24.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track the role of money and bribery" in 28.8ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track the role of money and bribery" in 26.2ms, 10 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 10 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-019 - "Find all mentions of heroes and villains"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Find all mentions of heroes and villains" in 30.4ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Find all mentions of heroes and villains" in 29.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Find all mentions of heroes and villains" in 27.6ms, 8 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 8 docs
generate-gold-queries.ts:41 [GoldQueryGenerator] Processing: cross-020 - "Track the mystery of who sent the assassin"
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_LEAF_ONLY
raptor-eval.service.ts:374 [RaptorEvalService] SearchLeafOnly "Track the mystery of who sent the assassin" in 28.3ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH
raptor-eval.service.ts:318 [RaptorEvalService] Search "Track the mystery of who sent the assassin" in 39.5ms, 10 results
gokitt.worker.ts:396 [GoKittWorker] Received: RAPTOR_SEARCH_AGGREGATED
raptor-eval.service.ts:346 [RaptorEvalService] SearchAggregated "Track the mystery of who sent the assassin" in 27.9ms, 9 docs
generate-gold-queries.ts:83 [GoldQueryGenerator]   Found 10 chunks, 9 docs
generate-gold-queries.ts:86 [GoldQueryGenerator] Generated 100 gold queries
