//go:build js && wasm

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"
	"time"

	"github.com/hack-pad/hackpadfs/indexeddb"
	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/docstore"
	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/hierarchy"
	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/reality/builder"
	"github.com/kittclouds/gokitt/pkg/reality/merger"
	"github.com/kittclouds/gokitt/pkg/reality/pcst"
	"github.com/kittclouds/gokitt/pkg/reality/projection"
	"github.com/kittclouds/gokitt/pkg/reality/validator"
	"github.com/kittclouds/gokitt/pkg/resorank"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
	"github.com/kittclouds/gokitt/pkg/vector"
)

// Version info
const Version = "0.4.0" // SQLite Store

// Global state
var pipeline *conductor.Conductor
var searcher *resorank.Scorer
var vectorStore *vector.Store
var docs *docstore.Store        // In-memory document store
var sqlStore *store.SQLiteStore // SQLite persistent store
var graphMerger *merger.Merger  // Phase 3: Graph merger instance

// ID Mapping for Vector Store (String -> Uint32)
// Since HNSW only supports uint32, we map our string IDs.
// This mapping is transient (rebuilt on indexing) assuming the client re-indexes on load.
// If persistence is needed, we'd need to store this map.
var idMap = make(map[string]uint32)
var revIdMap = make(map[uint32]string)
var nextID uint32 = 1

func main() {
	var err error
	pipeline, err = conductor.New()
	if err != nil {
		fmt.Println("[GoKitt] FATAL: Failed to initialize conductor:", err.Error())
	}

	// Initialize Searcher
	searcher = resorank.NewScorer(resorank.DefaultConfig())

	// Initialize DocStore
	docs = docstore.New()

	fmt.Println("[GoKitt] WASM Ready v" + Version)

	// Register exports
	js.Global().Set("GoKitt", js.ValueOf(map[string]interface{}{
		"version":           js.FuncOf(getVersion),
		"initialize":        js.FuncOf(initialize),
		"scan":              js.FuncOf(scan),
		"scanImplicit":      js.FuncOf(scanImplicit),
		"scanDiscovery":     js.FuncOf(scanDiscovery),
		"rebuildDictionary": js.FuncOf(rebuildDictionary),
		"indexDocument":     js.FuncOf(indexDocument),
		"indexNote":         js.FuncOf(indexNote),
		"search":            js.FuncOf(search),
		// Vector Store API
		"initVectors":   js.FuncOf(initVectors),
		"addVector":     js.FuncOf(addVector),
		"searchVectors": js.FuncOf(searchVectors),
		"saveVectors":   js.FuncOf(saveVectors),
		// DocStore API
		"hydrateNotes":      js.FuncOf(hydrateNotes),      // Bulk load notes on startup
		"upsertNote":        js.FuncOf(upsertNote),        // Update single note
		"removeNote":        js.FuncOf(removeNote),        // Delete note
		"scanNote":          js.FuncOf(scanNote),          // Scan from DocStore (not JS)
		"docCount":          js.FuncOf(docCount),          // Get document count
		"validateRelations": js.FuncOf(validateRelations), // Phase 2: CST validation
		// SQLite Store API (Persistent Data Layer)
		"storeInit":             js.FuncOf(storeInit),
		"storeUpsertNote":       js.FuncOf(storeUpsertNote),
		"storeGetNote":          js.FuncOf(storeGetNote),
		"storeDeleteNote":       js.FuncOf(storeDeleteNote),
		"storeListNotes":        js.FuncOf(storeListNotes),
		"storeUpsertEntity":     js.FuncOf(storeUpsertEntity),
		"storeGetEntity":        js.FuncOf(storeGetEntity),
		"storeGetEntityByLabel": js.FuncOf(storeGetEntityByLabel),
		"storeDeleteEntity":     js.FuncOf(storeDeleteEntity),
		"storeListEntities":     js.FuncOf(storeListEntities),
		"storeUpsertEdge":       js.FuncOf(storeUpsertEdge),
		"storeGetEdge":          js.FuncOf(storeGetEdge),
		"storeDeleteEdge":       js.FuncOf(storeDeleteEdge),
		"storeListEdges":        js.FuncOf(storeListEdges),
		// Phase 3: Graph Merger API
		"mergerInit":       js.FuncOf(mergerInit),
		"mergerAddScanner": js.FuncOf(mergerAddScanner),
		"mergerAddLLM":     js.FuncOf(mergerAddLLM),
		"mergerAddManual":  js.FuncOf(mergerAddManual),
		"mergerGetGraph":   js.FuncOf(mergerGetGraph),
		"mergerGetStats":   js.FuncOf(mergerGetStats),
		// Phase 4: PCST Coherence Filter
		"mergerRunPCST": js.FuncOf(mergerRunPCST),
	}))

	select {}
}

// ... existing helpers ...

// initVectors initialized the IndexedDB-backed HNSW store
// Args: [] (uses default "gokitt" DB and "hnsw.bin" path)
func initVectors(this js.Value, args []js.Value) interface{} {
	fs, err := indexeddb.NewFS(context.Background(), "gokitt", indexeddb.Options{})
	if err != nil {
		return errorResult("failed to create idb fs: " + err.Error())
	}

	vectorStore, err = vector.NewStore(fs, "hnsw.bin")
	if err != nil {
		return errorResult("failed to load vector store: " + err.Error())
	}

	// Reset maps on init
	idMap = make(map[string]uint32)
	revIdMap = make(map[uint32]string)
	nextID = 1

	return successResult("vector store initialized")
}

// getVectorID gets or creates a uint32 ID for a string ID
func getVectorID(id string) uint32 {
	if uid, ok := idMap[id]; ok {
		return uid
	}
	uid := nextID
	nextID++
	idMap[id] = uid
	revIdMap[uid] = id
	return uid
}

// addVector: [id string, vectorJSON string]
func addVector(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return errorResult("requires 2 args: id (string), vectorJSON (string)")
	}
	if vectorStore == nil {
		return errorResult("vector store not initialized")
	}

	idStr := args[0].String()
	uid := getVectorID(idStr)

	var vec []float32
	if err := json.Unmarshal([]byte(args[1].String()), &vec); err != nil {
		return errorResult("invalid vector json: " + err.Error())
	}

	if err := vectorStore.Add(uid, vec); err != nil {
		return errorResult("add failed: " + err.Error())
	}

	return successResult("added")
}

// searchVectors: [vectorJSON string, k int]
// Returns: JSON array of string IDs
func searchVectors(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return errorResult("requires 2 args: vectorJSON (string), k (int)")
	}
	if vectorStore == nil {
		return errorResult("vector store not initialized")
	}

	var vec []float32
	if err := json.Unmarshal([]byte(args[0].String()), &vec); err != nil {
		return errorResult("invalid vector json: " + err.Error())
	}
	k := args[1].Int()

	uids, err := vectorStore.Search(vec, k)
	if err != nil {
		return errorResult("search failed: " + err.Error())
	}

	// Map back to strings
	ids := make([]string, 0, len(uids))
	for _, uid := range uids {
		if idStr, ok := revIdMap[uid]; ok {
			ids = append(ids, idStr)
		} else {
			// Should not happen if map is consistent
			// ids = append(ids, fmt.Sprintf("%d", uid))
		}
	}

	jsonBytes, _ := json.Marshal(ids)
	return string(jsonBytes)
}

// saveVectors persists the index to IndexedDB
func saveVectors(this js.Value, args []js.Value) interface{} {
	if vectorStore == nil {
		return errorResult("vector store not initialized")
	}

	if err := vectorStore.Save(); err != nil {
		return errorResult("save failed: " + err.Error())
	}
	return successResult("saved")
}

// indexDocument: [id string, metaJSON string, tokensJSON string]
// Auto-indexes vector if present in metadata.
func indexDocument(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return errorResult("requires 3 args: id, metaJSON, tokensJSON")
	}

	id := args[0].String()
	var meta resorank.DocumentMetadata
	if err := json.Unmarshal([]byte(args[1].String()), &meta); err != nil {
		return errorResult("meta json: " + err.Error())
	}

	var tokens map[string]resorank.TokenMetadata
	if err := json.Unmarshal([]byte(args[2].String()), &tokens); err != nil {
		return errorResult("tokens json: " + err.Error())
	}

	searcher.IndexDocument(id, meta, tokens)

	// Auto-index vector if available and store is initialized
	if vectorStore != nil && len(meta.Embedding) > 0 {
		uid := getVectorID(id)
		// Ignore error for now (e.g. dim mismatch), just log?
		vectorStore.Add(uid, meta.Embedding)
	}

	return successResult("indexed " + id)
}

// indexNote: [id string, text string, scopeJSON string (optional)]
// Scans text with Conductor and indexes it in ResoRank with optional scope metadata
func indexNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return errorResult("requires 2+ args: id, text, [scopeJSON]")
	}
	id := args[0].String()
	text := args[1].String()

	// Parse optional scope metadata
	var narrativeID, folderPath string
	if len(args) > 2 && args[2].String() != "" && args[2].String() != "null" {
		var scopeInput struct {
			NarrativeID string `json:"narrativeId"`
			FolderPath  string `json:"folderPath"`
		}
		if err := json.Unmarshal([]byte(args[2].String()), &scopeInput); err == nil {
			narrativeID = scopeInput.NarrativeID
			folderPath = scopeInput.FolderPath
		}
	}

	if pipeline == nil || searcher == nil {
		return errorResult("pipeline or searcher not initialized")
	}

	// 1. Scan (Conductor)
	scanRes := pipeline.Scan(text)

	// 2. Transform to ResoRank Metadata
	docLen := len(scanRes.Tokens)
	if docLen == 0 {
		return successResult("indexed empty note " + id)
	}

	docMeta := resorank.DocumentMetadata{
		FieldLengths:    map[string]int{"content": docLen},
		TotalTokenCount: docLen,
		NarrativeID:     narrativeID,
		FolderPath:      folderPath,
	}

	tokens := make(map[string]resorank.TokenMetadata)

	// Use fixed 50 tokens per segment for now (or read from config)
	const tokensPerSeg = 50
	maxSegs := searcher.Config.MaxSegments

	for i, tok := range scanRes.Tokens {
		// Normalized term (lowercase)
		term := strings.ToLower(tok.Text)

		meta, exists := tokens[term]
		if !exists {
			meta = resorank.TokenMetadata{
				FieldOccurrences: make(map[string]resorank.FieldOccurrence),
				SegmentMask:      0,
			}
		}

		// Update stats for "content" field
		occ := meta.FieldOccurrences["content"]
		occ.TF++
		occ.FieldLength = docLen
		meta.FieldOccurrences["content"] = occ

		// Segment Mask
		segIdx := uint32(i / tokensPerSeg)
		if segIdx < maxSegs {
			meta.SegmentMask |= (1 << segIdx)
		}

		tokens[term] = meta
	}

	// 3. Index
	searcher.IndexDocument(id, docMeta, tokens)

	return successResult("indexed " + id)
}

// search: [queryJSON string, limit int, vectorJSON string (optional), scopeJSON string (optional)]
func search(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return errorResult("requires 2+ args: queryJSON, limit, [vectorJSON], [scopeJSON]")
	}

	var query []string
	if err := json.Unmarshal([]byte(args[0].String()), &query); err != nil {
		return errorResult("query json: " + err.Error())
	}

	limit := args[1].Int()

	var vector []float32
	if len(args) > 2 && args[2].String() != "" && args[2].String() != "null" {
		if err := json.Unmarshal([]byte(args[2].String()), &vector); err != nil {
			return errorResult("vector json: " + err.Error())
		}
	}

	// Parse optional scope filter
	var scope *resorank.SearchScope
	if len(args) > 3 && args[3].String() != "" && args[3].String() != "null" {
		scope = &resorank.SearchScope{}
		if err := json.Unmarshal([]byte(args[3].String()), scope); err != nil {
			return errorResult("scope json: " + err.Error())
		}
	}

	results := searcher.SearchScoped(query, vector, limit, scope)

	bytes, _ := json.Marshal(results)
	return string(bytes)
}

// ... existing helpers ...

// getVersion returns the module version
func getVersion(this js.Value, args []js.Value) interface{} {
	return Version
}

// initialize hydrates the scanner with entity data
// Args: [entitiesJSON string] - optional JSON array of entities
func initialize(this js.Value, args []js.Value) interface{} {
	// Re-initialize to ensure clean state
	if pipeline != nil {
		pipeline.Close()
	}
	var err error
	pipeline, err = conductor.New()
	if err != nil {
		return errorResult(err.Error())
	}

	// Build Aho-Corasick dictionary from entities if provided
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "[]" {
		// Use pointers to ensure custom UnmarshalJSON is called
		var entityPtrs []*implicitmatcher.RegisteredEntity
		if err := json.Unmarshal([]byte(args[0].String()), &entityPtrs); err != nil {
			return errorResult("invalid entities json: " + err.Error())
		}

		if len(entityPtrs) > 0 {
			// Convert back to value numbers for Compile
			entities := make([]implicitmatcher.RegisteredEntity, len(entityPtrs))
			for i, e := range entityPtrs {
				entities[i] = *e
			}

			dict, err := implicitmatcher.Compile(entities)
			if err != nil {
				return errorResult("aho-corasick compile: " + err.Error())
			}
			pipeline.SetDictionary(dict)
			pipeline.SeedDiscovery(entities)
			fmt.Println("[GoKitt] ✅ Dictionary compiled:", len(entities), "entities")
			fmt.Println("[GoKitt] ✅ Discovery seeded:", len(entities), "entities")
		}
	}

	return successResult("initialized")
}

// scanImplicit finds known entities in text using Aho-Corasick
// Args: [text string]
// Returns: JSON array of decoration spans
func scanImplicit(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return "[]"
	}
	text := args[0].String()

	if pipeline == nil {
		return "[]"
	}

	dict := pipeline.GetDictionary()
	if dict == nil {
		return "[]"
	}

	matches := dict.ScanWithInfo(text)
	spans := make([]map[string]interface{}, 0, len(matches))

	for _, m := range matches {
		// Check Word Boundaries
		// 1. Previous char must be non-alphanumeric (or start of string)
		if m.Start > 0 {
			prevChar := text[m.Start-1]
			if isWordChar(prevChar) {
				continue // "trigger" matching "ge" -> 'g' is word char, skip
			}
		}

		// 2. Next char must be non-alphanumeric (or end of string)
		if m.End < len(text) {
			nextChar := text[m.End]
			if isWordChar(nextChar) {
				continue // "trigger" matching "ge" -> 'r' is word char, skip
			}
		}

		if len(m.Entities) > 0 {
			best := dict.SelectBest(getEntityIDs(m.Entities))
			if best != nil {
				spans = append(spans, map[string]interface{}{
					"type":     "entity_implicit",
					"from":     m.Start,
					"to":       m.End,
					"label":    best.Label,
					"kind":     best.Kind.String(),
					"resolved": true,
				})
			}
		}
	}

	bytes, _ := json.Marshal(spans)
	return string(bytes)
}

func isWordChar(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_'
}

// getEntityIDs extracts IDs from EntityInfo slice
func getEntityIDs(entities []*implicitmatcher.EntityInfo) []string {
	ids := make([]string, len(entities))
	for i, e := range entities {
		ids[i] = e.ID
	}
	return ids
}

// rebuildDictionary recompiles the Aho-Corasick dictionary with new entities
// Call this when entities are added/removed from the registry
// Args: [entitiesJSON string] - JSON array of RegisteredEntity
// Returns: success/error result
func rebuildDictionary(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("rebuildDictionary requires 1 argument: entitiesJSON")
	}
	if pipeline == nil {
		return errorResult("pipeline not initialized")
	}

	entitiesJSON := args[0].String()
	if entitiesJSON == "" || entitiesJSON == "[]" {
		// No entities - clear dictionary
		pipeline.SetDictionary(nil)
		fmt.Println("[GoKitt] Dictionary cleared (no entities)")
		return successResult("cleared")
	}

	// Parse entities (use pointers for custom UnmarshalJSON)
	var entityPtrs []*implicitmatcher.RegisteredEntity
	if err := json.Unmarshal([]byte(entitiesJSON), &entityPtrs); err != nil {
		return errorResult("invalid entities json: " + err.Error())
	}

	if len(entityPtrs) == 0 {
		pipeline.SetDictionary(nil)
		fmt.Println("[GoKitt] Dictionary cleared (empty array)")
		return successResult("cleared")
	}

	// Convert to value slice for Compile
	entities := make([]implicitmatcher.RegisteredEntity, len(entityPtrs))
	for i, e := range entityPtrs {
		entities[i] = *e
	}

	// Compile new dictionary
	dict, err := implicitmatcher.Compile(entities)
	if err != nil {
		return errorResult("aho-corasick compile: " + err.Error())
	}

	pipeline.SetDictionary(dict)
	pipeline.SeedDiscovery(entities)
	fmt.Printf("[GoKitt] ✅ Dictionary rebuilt: %d entities\n", len(entities))

	return successResult(fmt.Sprintf("rebuilt with %d entities", len(entities)))
}

// scan processes text and returns result
// Args: [text string, provenanceJSON string (optional)]
// Returns: SLIM response with only graph data (nodes/edges) + timing
func scan(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("scan requires at least 1 argument: text")
	}
	if pipeline == nil {
		return errorResult("pipeline not initialized")
	}

	text := args[0].String()
	start := time.Now()

	// Parse optional provenance context
	var prov *hierarchy.ProvenanceContext
	if len(args) > 1 && args[1].String() != "" && args[1].String() != "null" {
		var provInput struct {
			VaultID    string `json:"vaultId"`
			WorldID    string `json:"worldId"`
			ParentPath string `json:"parentPath"`
			FolderType string `json:"folderType"`
		}
		if err := json.Unmarshal([]byte(args[1].String()), &provInput); err == nil {
			prov = &hierarchy.ProvenanceContext{
				VaultID:    provInput.VaultID,
				WorldID:    provInput.WorldID,
				ParentPath: provInput.ParentPath,
				FolderType: provInput.FolderType,
			}
		}
	}

	// 1. Scan (The Senses)
	result := pipeline.Scan(text)

	// 2. Reality (The Brain)
	cstRoot := builder.Zip(text, result)

	// 3. Graph (The World)
	// Build entity map for ID resolution
	entityMap := make(projection.EntityMap)
	for _, ref := range result.ResolvedRefs {
		entityMap[ref.Range.Start] = ref.EntityID
	}

	conceptGraph := projection.Project(cstRoot, pipeline.GetMatcher(), entityMap, text, prov)
	conceptGraph.ToSerializable() // Populate edges for JSON output

	// 4. PCST (The Summary) - Still computed, just not serialized
	prizes := make(map[string]float64)
	for id := range conceptGraph.Nodes {
		prizes[id] = 1.0
	}
	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	_, _ = solver.Solve(conceptGraph, prizes, "") // Run but don't return

	duration := time.Since(start).Microseconds()

	// OPTIMIZATION: Slim response - only fields JS actually uses
	// Removes: scan, cst, pcst (unused by Angular)
	slimNodes := make(map[string]interface{}, len(conceptGraph.Nodes))
	for id, node := range conceptGraph.Nodes {
		slimNodes[id] = map[string]interface{}{
			"label": node.Label,
			"kind":  node.Kind,
		}
	}

	slimEdges := make([]interface{}, 0, len(conceptGraph.Edges))
	for _, edge := range conceptGraph.Edges {
		slimEdges = append(slimEdges, map[string]interface{}{
			"source":     edge.Source,
			"target":     edge.Target,
			"type":       edge.Relation,
			"confidence": edge.Weight,
		})
	}

	response := map[string]interface{}{
		"graph": map[string]interface{}{
			"nodes": slimNodes,
			"edges": slimEdges,
		},
		"timing_us": duration,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return errorResult(err.Error())
	}

	return string(jsonBytes)
}

// scanDiscovery performs unsupervised NER ("The Virus")
// Args: [text string]
func scanDiscovery(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("scanDiscovery requires 1 argument: text")
	}
	if pipeline == nil {
		return errorResult("pipeline not initialized")
	}

	text := args[0].String()
	// Scan the text with Discovery Engine (heuristic)
	pipeline.ScanDiscovery(text)

	candidates := pipeline.GetCandidates()
	jsonBytes, _ := json.Marshal(candidates)
	return string(jsonBytes)
}

// resolve exposes direct pronoun resolution for testing
// Args: [pronoun string]
func resolve(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("resolve requires 1 arg")
	}
	// Access resolver directly via pipeline (bit of a hack for testing, but useful)
	// We'd need to expose the Resolver in Conductor publicly or add a method.
	// For now, let's just return "NotImplemented" or remove this. Only Scan is critical.
	return errorResult("Use scan() for resolution context")
}

// Helper: Create error result
func errorResult(msg string) interface{} {
	result := map[string]interface{}{
		"error": msg,
	}
	jsonBytes, _ := json.Marshal(result)
	return string(jsonBytes)
}

// Helper: Create success result
func successResult(msg string) interface{} {
	result := map[string]interface{}{
		"success": msg,
	}
	jsonBytes, _ := json.Marshal(result)
	return string(jsonBytes)
}

// =============================================================================
// DocStore API - In-memory document storage
// =============================================================================

// hydrateNotes bulk-loads notes into the DocStore.
// Called once at startup. No scanning - just storage.
// Args: [notesJSON string] - Array of {id, text, version?}
func hydrateNotes(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("hydrateNotes requires 1 arg: notesJSON")
	}

	var input []struct {
		ID      string `json:"id"`
		Text    string `json:"text"`
		Version int64  `json:"version"`
	}

	if err := json.Unmarshal([]byte(args[0].String()), &input); err != nil {
		return errorResult("invalid notes json: " + err.Error())
	}

	docsList := make([]docstore.Document, len(input))
	for i, n := range input {
		docsList[i] = docstore.Document{
			ID:      n.ID,
			Text:    n.Text,
			Version: n.Version,
		}
	}

	count := docs.Hydrate(docsList)
	fmt.Printf("[GoKitt] ✅ DocStore hydrated: %d notes\n", count)
	return successResult(fmt.Sprintf("hydrated %d notes", count))
}

// upsertNote adds or updates a single note in DocStore.
// Called when user saves a note.
// Args: [id string, text string, version int64 (optional)]
func upsertNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return errorResult("upsertNote requires 2+ args: id, text, [version]")
	}

	id := args[0].String()
	text := args[1].String()
	var version int64 = 0
	if len(args) > 2 {
		version = int64(args[2].Int())
	}

	docs.Upsert(id, text, version)
	return successResult("upserted " + id)
}

// removeNote deletes a note from DocStore.
// Args: [id string]
func removeNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("removeNote requires 1 arg: id")
	}

	id := args[0].String()
	docs.Remove(id)
	return successResult("removed " + id)
}

// scanNote scans a note from DocStore (not from JS).
// This eliminates the JS→Go text transfer on each scan.
// Args: [id string, provenanceJSON string (optional)]
func scanNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("scanNote requires 1 arg: noteId")
	}
	if pipeline == nil {
		return errorResult("pipeline not initialized")
	}

	noteId := args[0].String()

	// Get text from DocStore (not from JS!)
	text := docs.GetText(noteId)
	if text == "" {
		return errorResult("note not found in DocStore: " + noteId)
	}

	start := time.Now()

	// Parse optional provenance context
	var prov *hierarchy.ProvenanceContext
	if len(args) > 1 && args[1].String() != "" && args[1].String() != "null" {
		var provInput struct {
			VaultID    string `json:"vaultId"`
			WorldID    string `json:"worldId"`
			ParentPath string `json:"parentPath"`
			FolderType string `json:"folderType"`
		}
		if err := json.Unmarshal([]byte(args[1].String()), &provInput); err == nil {
			prov = &hierarchy.ProvenanceContext{
				VaultID:    provInput.VaultID,
				WorldID:    provInput.WorldID,
				ParentPath: provInput.ParentPath,
				FolderType: provInput.FolderType,
			}
		}
	}

	// === SAME PIPELINE AS scan() ===
	// 1. Scan (The Senses)
	result := pipeline.Scan(text)

	// 2. Reality (The Brain)
	cstRoot := builder.Zip(text, result)

	// 3. Graph (The World)
	entityMap := make(projection.EntityMap)
	for _, ref := range result.ResolvedRefs {
		entityMap[ref.Range.Start] = ref.EntityID
	}

	conceptGraph := projection.Project(cstRoot, pipeline.GetMatcher(), entityMap, text, prov)
	conceptGraph.ToSerializable()

	// 4. PCST (The Summary)
	prizes := make(map[string]float64)
	for id := range conceptGraph.Nodes {
		prizes[id] = 1.0
	}
	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	_, _ = solver.Solve(conceptGraph, prizes, "")

	duration := time.Since(start).Microseconds()

	// Slim response
	slimNodes := make(map[string]interface{}, len(conceptGraph.Nodes))
	for id, node := range conceptGraph.Nodes {
		slimNodes[id] = map[string]interface{}{
			"label": node.Label,
			"kind":  node.Kind,
		}
	}

	slimEdges := make([]interface{}, 0, len(conceptGraph.Edges))
	for _, edge := range conceptGraph.Edges {
		slimEdges = append(slimEdges, map[string]interface{}{
			"source":     edge.Source,
			"target":     edge.Target,
			"type":       edge.Relation,
			"confidence": edge.Weight,
		})
	}

	response := map[string]interface{}{
		"noteId": noteId,
		"graph": map[string]interface{}{
			"nodes": slimNodes,
			"edges": slimEdges,
		},
		"timing_us": duration,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return errorResult(err.Error())
	}

	return string(jsonBytes)
}

// docCount returns the number of documents in DocStore.
func docCount(this js.Value, args []js.Value) interface{} {
	return docs.Count()
}

// validateRelations cross-references LLM-extracted relations with the CST.
// Phase 2: Grounds LLM output in the actual document structure.
// Args: [noteId string, relationsJSON string]
// Returns: JSON array of validated relations with confidence adjustments.
func validateRelations(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return errorResult("validateRelations requires [noteId, relationsJSON]")
	}

	noteID := args[0].String()
	relationsJSON := args[1].String()

	// Get the note text from DocStore
	note := docs.Get(noteID)
	if note == nil {
		return errorResult("Note not found in DocStore: " + noteID)
	}

	// Parse the LLM relations
	var llmRelations []validator.LLMRelation
	if err := json.Unmarshal([]byte(relationsJSON), &llmRelations); err != nil {
		return errorResult("Failed to parse relations JSON: " + err.Error())
	}

	// Build CST from the note text
	scanResult := pipeline.Scan(note.Text)
	cstRoot := builder.Zip(note.Text, scanResult)

	// Create validator and validate
	v := validator.New(cstRoot, note.Text)
	validated := v.Validate(llmRelations)

	// Convert to JSON-friendly format
	results := make([]map[string]interface{}, len(validated))
	for i, vr := range validated {
		results[i] = vr.ToJSON(note.Text)
	}

	// Build response
	response := map[string]interface{}{
		"noteId":     noteID,
		"totalInput": len(llmRelations),
		"validCount": validator.ValidCount(validated),
		"relations":  results,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return errorResult(err.Error())
	}

	return string(jsonBytes)
}

// =============================================================================
// SQLite Store API - Persistent Data Layer
// =============================================================================

// storeInit initializes the SQLite store.
// Args: [] (uses in-memory database for WASM)
func storeInit(this js.Value, args []js.Value) interface{} {
	var err error
	sqlStore, err = store.NewSQLiteStore()
	if err != nil {
		return errorResult("failed to initialize SQLite store: " + err.Error())
	}
	fmt.Println("[GoKitt] ✅ SQLite Store initialized")
	return successResult("store initialized")
}

// storeUpsertNote inserts or updates a note.
// Args: [noteJSON string]
func storeUpsertNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeUpsertNote requires 1 arg: noteJSON")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	var note store.Note
	if err := json.Unmarshal([]byte(args[0].String()), &note); err != nil {
		return errorResult("invalid note json: " + err.Error())
	}

	if err := sqlStore.UpsertNote(&note); err != nil {
		return errorResult("upsert failed: " + err.Error())
	}

	return successResult("upserted " + note.ID)
}

// storeGetNote retrieves a note by ID.
// Args: [id string]
// Returns: Note JSON or null
func storeGetNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeGetNote requires 1 arg: id")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	note, err := sqlStore.GetNote(args[0].String())
	if err != nil {
		return errorResult("get failed: " + err.Error())
	}
	if note == nil {
		return "null"
	}

	bytes, _ := json.Marshal(note)
	return string(bytes)
}

// storeDeleteNote deletes a note by ID.
// Args: [id string]
func storeDeleteNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeDeleteNote requires 1 arg: id")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	if err := sqlStore.DeleteNote(args[0].String()); err != nil {
		return errorResult("delete failed: " + err.Error())
	}

	return successResult("deleted")
}

// storeListNotes returns all notes, optionally filtered by folder.
// Args: [folderID string (optional)]
// Returns: JSON array of notes
func storeListNotes(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	var folderID string
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		folderID = args[0].String()
	}

	notes, err := sqlStore.ListNotes(folderID)
	if err != nil {
		return errorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(notes)
	return string(bytes)
}

// storeUpsertEntity inserts or updates an entity.
// Args: [entityJSON string]
func storeUpsertEntity(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeUpsertEntity requires 1 arg: entityJSON")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	var entity store.Entity
	if err := json.Unmarshal([]byte(args[0].String()), &entity); err != nil {
		return errorResult("invalid entity json: " + err.Error())
	}

	if err := sqlStore.UpsertEntity(&entity); err != nil {
		return errorResult("upsert failed: " + err.Error())
	}

	return successResult("upserted " + entity.ID)
}

// storeGetEntity retrieves an entity by ID.
// Args: [id string]
// Returns: Entity JSON or null
func storeGetEntity(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeGetEntity requires 1 arg: id")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	entity, err := sqlStore.GetEntity(args[0].String())
	if err != nil {
		return errorResult("get failed: " + err.Error())
	}
	if entity == nil {
		return "null"
	}

	bytes, _ := json.Marshal(entity)
	return string(bytes)
}

// storeGetEntityByLabel finds an entity by label (case-insensitive).
// Args: [label string]
// Returns: Entity JSON or null
func storeGetEntityByLabel(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeGetEntityByLabel requires 1 arg: label")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	entity, err := sqlStore.GetEntityByLabel(args[0].String())
	if err != nil {
		return errorResult("get failed: " + err.Error())
	}
	if entity == nil {
		return "null"
	}

	bytes, _ := json.Marshal(entity)
	return string(bytes)
}

// storeDeleteEntity deletes an entity by ID.
// Args: [id string]
func storeDeleteEntity(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeDeleteEntity requires 1 arg: id")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	if err := sqlStore.DeleteEntity(args[0].String()); err != nil {
		return errorResult("delete failed: " + err.Error())
	}

	return successResult("deleted")
}

// storeListEntities returns all entities, optionally filtered by kind.
// Args: [kind string (optional)]
// Returns: JSON array of entities
func storeListEntities(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	var kind string
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		kind = args[0].String()
	}

	entities, err := sqlStore.ListEntities(kind)
	if err != nil {
		return errorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(entities)
	return string(bytes)
}

// storeUpsertEdge inserts or updates an edge.
// Args: [edgeJSON string]
func storeUpsertEdge(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeUpsertEdge requires 1 arg: edgeJSON")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	var edge store.Edge
	if err := json.Unmarshal([]byte(args[0].String()), &edge); err != nil {
		return errorResult("invalid edge json: " + err.Error())
	}

	if err := sqlStore.UpsertEdge(&edge); err != nil {
		return errorResult("upsert failed: " + err.Error())
	}

	return successResult("upserted " + edge.ID)
}

// storeGetEdge retrieves an edge by ID.
// Args: [id string]
// Returns: Edge JSON or null
func storeGetEdge(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeGetEdge requires 1 arg: id")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	edge, err := sqlStore.GetEdge(args[0].String())
	if err != nil {
		return errorResult("get failed: " + err.Error())
	}
	if edge == nil {
		return "null"
	}

	bytes, _ := json.Marshal(edge)
	return string(bytes)
}

// storeDeleteEdge deletes an edge by ID.
// Args: [id string]
func storeDeleteEdge(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeDeleteEdge requires 1 arg: id")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	if err := sqlStore.DeleteEdge(args[0].String()); err != nil {
		return errorResult("delete failed: " + err.Error())
	}

	return successResult("deleted")
}

// storeListEdges returns all edges for an entity.
// Args: [entityID string]
// Returns: JSON array of edges
func storeListEdges(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("storeListEdges requires 1 arg: entityID")
	}
	if sqlStore == nil {
		return errorResult("store not initialized")
	}

	edges, err := sqlStore.ListEdgesForEntity(args[0].String())
	if err != nil {
		return errorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(edges)
	return string(bytes)
}

// =============================================================================
// Phase 3: Graph Merger API
// =============================================================================

// mergerInit creates a new merger instance
// Args: []
func mergerInit(this js.Value, args []js.Value) interface{} {
	graphMerger = merger.New()
	return successResult("Merger initialized")
}

// mergerAddScanner adds edges from a scanner graph result
// Args: [noteId string, graphJSON string]
func mergerAddScanner(this js.Value, args []js.Value) interface{} {
	if graphMerger == nil {
		return errorResult("Merger not initialized - call mergerInit first")
	}
	if len(args) < 2 {
		return errorResult("mergerAddScanner requires [noteId, graphJSON]")
	}

	noteID := args[0].String()
	graphJSON := args[1].String()

	// Parse graph from scan result
	var scanResult struct {
		Graph struct {
			Nodes map[string]struct {
				Label string `json:"Label"`
				Kind  string `json:"Kind"`
			} `json:"nodes"`
			Edges []struct {
				Source     string  `json:"Source"`
				Target     string  `json:"Target"`
				Type       string  `json:"Type"`
				Confidence float64 `json:"Confidence"`
			} `json:"edges"`
		} `json:"graph"`
	}

	if err := json.Unmarshal([]byte(graphJSON), &scanResult); err != nil {
		return errorResult("Failed to parse graph JSON: " + err.Error())
	}

	// Build a temporary ConceptGraph
	g := graph.NewGraph()

	// Add nodes
	for id, n := range scanResult.Graph.Nodes {
		g.EnsureNode(id, n.Label, n.Kind)
	}

	// Add edges
	for _, e := range scanResult.Graph.Edges {
		g.AddLabeledEdge(e.Source, e.Target, e.Type, e.Confidence)
	}

	added := graphMerger.AddScannerGraph(g, noteID)

	return map[string]interface{}{
		"success": true,
		"added":   added,
	}
}

// mergerAddLLM adds edges from LLM extraction
// Args: [edgesJSON string]
func mergerAddLLM(this js.Value, args []js.Value) interface{} {
	if graphMerger == nil {
		return errorResult("Merger not initialized - call mergerInit first")
	}
	if len(args) < 1 {
		return errorResult("mergerAddLLM requires [edgesJSON]")
	}

	var edges []merger.LLMEdgeInput
	if err := json.Unmarshal([]byte(args[0].String()), &edges); err != nil {
		return errorResult("Failed to parse edges JSON: " + err.Error())
	}

	added := graphMerger.AddLLMEdges(edges)

	return map[string]interface{}{
		"success": true,
		"added":   added,
	}
}

// mergerAddManual adds manually created edges
// Args: [edgesJSON string]
func mergerAddManual(this js.Value, args []js.Value) interface{} {
	if graphMerger == nil {
		return errorResult("Merger not initialized - call mergerInit first")
	}
	if len(args) < 1 {
		return errorResult("mergerAddManual requires [edgesJSON]")
	}

	var edges []merger.ManualEdgeInput
	if err := json.Unmarshal([]byte(args[0].String()), &edges); err != nil {
		return errorResult("Failed to parse edges JSON: " + err.Error())
	}

	added := graphMerger.AddManualEdges(edges)

	return map[string]interface{}{
		"success": true,
		"added":   added,
	}
}

// mergerGetGraph returns the current merged graph
// Args: []
func mergerGetGraph(this js.Value, args []js.Value) interface{} {
	if graphMerger == nil {
		return errorResult("Merger not initialized - call mergerInit first")
	}

	graph := graphMerger.GetMergedGraph()
	bytes, err := json.Marshal(graph)
	if err != nil {
		return errorResult("Failed to serialize graph: " + err.Error())
	}

	return string(bytes)
}

// mergerGetStats returns merge statistics
// Args: []
func mergerGetStats(this js.Value, args []js.Value) interface{} {
	if graphMerger == nil {
		return errorResult("Merger not initialized - call mergerInit first")
	}

	stats := graphMerger.GetStats()
	bytes, err := json.Marshal(stats)
	if err != nil {
		return errorResult("Failed to serialize stats: " + err.Error())
	}

	return string(bytes)
}

// =============================================================================
// Phase 4: PCST Coherence Filter
// =============================================================================

// mergerRunPCST runs PCST on the merged graph to extract optimal subgraph
// Args: [prizesJSON string, rootID string (optional)]
// prizesJSON: {"nodeId": prizeValue, ...} - higher prize = more important to include
// Returns: filtered graph JSON
func mergerRunPCST(this js.Value, args []js.Value) interface{} {
	if graphMerger == nil {
		return errorResult("Merger not initialized - call mergerInit first")
	}
	if len(args) < 1 {
		return errorResult("mergerRunPCST requires [prizesJSON, rootID?]")
	}

	var prizes map[string]float64
	if err := json.Unmarshal([]byte(args[0].String()), &prizes); err != nil {
		return errorResult("Failed to parse prizes JSON: " + err.Error())
	}

	rootID := ""
	if len(args) > 1 && args[1].String() != "" {
		rootID = args[1].String()
	}

	filtered, err := graphMerger.RunPCST(prizes, rootID)
	if err != nil {
		return errorResult("PCST failed: " + err.Error())
	}

	bytes, err := json.Marshal(map[string]interface{}{
		"success":   true,
		"graph":     filtered,
		"nodeCount": len(filtered.Nodes),
		"edgeCount": len(filtered.Edges),
	})
	if err != nil {
		return errorResult("Failed to serialize result: " + err.Error())
	}

	return string(bytes)
}
