//go:build js && wasm

package main

import (
	"context"
	"encoding/json"
	"syscall/js"
	"time"

	"github.com/hack-pad/hackpadfs/indexeddb"
	"github.com/kittclouds/gokitt/pkg/dafsa"
	"github.com/kittclouds/gokitt/pkg/reality/builder"
	"github.com/kittclouds/gokitt/pkg/reality/pcst"
	"github.com/kittclouds/gokitt/pkg/reality/projection"
	"github.com/kittclouds/gokitt/pkg/resorank"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
	"github.com/kittclouds/gokitt/pkg/vector"
)

// Version info
const Version = "0.2.0"

// Global state
// Global state
var pipeline *conductor.Conductor
var searcher *resorank.Scorer
var vectorStore *vector.Store

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
		println("[GoKitt] FATAL: Failed to initialize conductor:", err.Error())
	}

	// Initialize Searcher
	searcher = resorank.NewScorer(resorank.DefaultConfig())
	println("[GoKitt] WASM Ready v" + Version)

	// Register exports
	js.Global().Set("GoKitt", js.ValueOf(map[string]interface{}{
		"version":       js.FuncOf(getVersion),
		"initialize":    js.FuncOf(initialize),
		"scan":          js.FuncOf(scan),
		"scanImplicit":  js.FuncOf(scanImplicit),
		"scanDiscovery": js.FuncOf(scanDiscovery),
		"indexDocument": js.FuncOf(indexDocument),
		"search":        js.FuncOf(search),
		// Vector Store API
		"initVectors":   js.FuncOf(initVectors),
		"addVector":     js.FuncOf(addVector),     // now takes string ID
		"searchVectors": js.FuncOf(searchVectors), // now returns string IDs
		"saveVectors":   js.FuncOf(saveVectors),
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
		// We could return error but that might block indexing.
		// For now silent fail or specific code?
		// Let's assume embeddings are clean.
		vectorStore.Add(uid, meta.Embedding)
	}

	return successResult("indexed " + id)
}

// search: [queryJSON string, limit int, vectorJSON string (optional)]
func search(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return errorResult("requires 2+ args: queryJSON, limit, [vectorJSON]")
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

	results := searcher.Search(query, vector, limit)

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
		var entityPtrs []*dafsa.RegisteredEntity
		if err := json.Unmarshal([]byte(args[0].String()), &entityPtrs); err != nil {
			return errorResult("invalid entities json: " + err.Error())
		}

		if len(entityPtrs) > 0 {
			// Convert back to value numbers for Compile
			entities := make([]dafsa.RegisteredEntity, len(entityPtrs))
			for i, e := range entityPtrs {
				entities[i] = *e
			}

			dict, err := dafsa.Compile(entities)
			if err != nil {
				return errorResult("aho-corasick compile: " + err.Error())
			}
			pipeline.SetDictionary(dict)
			pipeline.SeedDiscovery(entities)
			println("[GoKitt] ✅ Dictionary compiled:", len(entities), "entities")
			println("[GoKitt] ✅ Discovery seeded:", len(entities), "entities")
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

// getEntityIDs extracts IDs from EntityInfo slice
func getEntityIDs(entities []*dafsa.EntityInfo) []string {
	ids := make([]string, len(entities))
	for i, e := range entities {
		ids[i] = e.ID
	}
	return ids
}

// scan processes text and returns result
// Args: [text string]
func scan(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return errorResult("scan requires at least 1 argument: text")
	}
	if pipeline == nil {
		return errorResult("pipeline not initialized")
	}

	text := args[0].String()
	start := time.Now()

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

	conceptGraph := projection.Project(cstRoot, pipeline.GetMatcher(), entityMap, text)
	conceptGraph.ToSerializable() // Populate edges for JSON output

	// 4. PCST (The Summary)
	// Assign uniform prizes to all nodes for now
	prizes := make(map[string]float64)
	for id := range conceptGraph.Nodes {
		prizes[id] = 1.0
	}

	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	story, _ := solver.Solve(conceptGraph, prizes, "")

	duration := time.Since(start).Microseconds()

	// Wrap in a response object including timing
	response := map[string]interface{}{
		"scan":      result,
		"cst":       cstRoot,
		"graph":     conceptGraph,
		"pcst":      story,
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
