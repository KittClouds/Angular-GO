//go:build js && wasm

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/agent"
	"github.com/kittclouds/gokitt/pkg/analytics"
	"github.com/kittclouds/gokitt/pkg/batch"
	"github.com/kittclouds/gokitt/pkg/chat"
	"github.com/kittclouds/gokitt/pkg/docstore"
	"github.com/kittclouds/gokitt/pkg/extraction"
	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/hierarchy"
	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/qgram"
	"github.com/kittclouds/gokitt/pkg/reality/builder"
	"github.com/kittclouds/gokitt/pkg/reality/merger"
	"github.com/kittclouds/gokitt/pkg/reality/pcst"
	"github.com/kittclouds/gokitt/pkg/reality/projection"
	"github.com/kittclouds/gokitt/pkg/reality/validator"
	"github.com/kittclouds/gokitt/pkg/sab"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
	"github.com/kittclouds/gokitt/pkg/scanner/syntax"
)

// Version info
const Version = "0.9.2" // Added raptorChunk + raptorIngestSAB (SAB zero-copy)

// Global state
var pipeline *conductor.Conductor
var searcher *qgram.QGramIndex        // Changed from ResoRank to Q-Gram Hybrid
var docs *docstore.Store              // In-memory document store
var sqlStore *store.SQLiteStore       // SQLite persistent store
var graphMerger *merger.Merger        // Phase 3: Graph merger instance
var sharedBuffer *sab.SharedBuffer    // Phase 5: SharedArrayBuffer for zero-copy
var batchSvc *batch.Service           // Phase 6: LLM Batch Service
var extractionSvc *extraction.Service // Phase 6: Unified Extraction
var agentSvc *agent.Service           // Phase 6: Agent (tool-calling)
var chatSvc *chat.ChatService         // Phase 7: Chat Service

// WAL Handler (JS Callback)
var walHandler js.Value

func main() {
	var err error
	pipeline, err = conductor.New()
	if err != nil {
		fmt.Println("[GoKitt] FATAL: Failed to initialize conductor:", err.Error())
	}

	// Initialize Searcher (Q=3 for trigrams)
	searcher = qgram.NewQGramIndex(3)

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
		// DocStore API
		"hydrateNotes":      js.FuncOf(hydrateNotes),      // Bulk load notes on startup
		"upsertNote":        js.FuncOf(upsertNote),        // Update single note
		"removeNote":        js.FuncOf(removeNote),        // Delete note
		"scanNote":          js.FuncOf(scanNote),          // Scan from DocStore (not JS)
		"docCount":          js.FuncOf(docCount),          // Get document count
		"validateRelations": js.FuncOf(validateRelations), // Phase 2: CST validation
		"analyzeText":       js.FuncOf(analyzeText),       // Text analytics
		// SQLite Store API (Persistent Data Layer)
		"storeInit":       js.FuncOf(storeInit),
		"storeGetVersion": js.FuncOf(storeGetVersion),
		"storeUpsertNote": js.FuncOf(storeUpsertNote),

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
		// Store Export/Import (OPFS sync)
		"storeExport": js.FuncOf(storeExport),
		"storeImport": js.FuncOf(storeImport),
		// "setWalHandler" REMOVED - Snapshot Native
		// Store Folder CRUD
		"storeUpsertFolder": js.FuncOf(storeUpsertFolder),

		"storeGetFolder":    js.FuncOf(storeGetFolder),
		"storeDeleteFolder": js.FuncOf(storeDeleteFolder),
		"storeListFolders":  js.FuncOf(storeListFolders),
		// Store Spans & Links
		"storeUpsertSpan":       js.FuncOf(storeUpsertSpan),
		"storeGetSpan":          js.FuncOf(storeGetSpan),
		"storeListSpansForNote": js.FuncOf(storeListSpansForNote),
		"storeDeleteSpan":       js.FuncOf(storeDeleteSpan),

		// Batch Operations
		// "storeReplayWal": js.FuncOf(storeReplayWal), // REMOVED - Snapshot Native
		// Store Network View
		"storeUpsertNetworkInstance":     js.FuncOf(storeUpsertNetworkInstance),
		"storeGetNetworkInstance":        js.FuncOf(storeGetNetworkInstance),
		"storeListNetworkInstances":      js.FuncOf(storeListNetworkInstances),
		"storeDeleteNetworkInstance":     js.FuncOf(storeDeleteNetworkInstance),
		"storeUpsertNetworkMembership":   js.FuncOf(storeUpsertNetworkMembership),
		"storeGetNetworkMembers":         js.FuncOf(storeGetNetworkMembers),
		"storeDeleteNetworkMembership":   js.FuncOf(storeDeleteNetworkMembership),
		"storeUpsertNetworkRelationship": js.FuncOf(storeUpsertNetworkRelationship),
		"storeGetNetworkRelationships":   js.FuncOf(storeGetNetworkRelationships),
		"storeDeleteNetworkRelationship": js.FuncOf(storeDeleteNetworkRelationship),
		// Store Discovery
		"storeUpsertDiscoveryCandidate": js.FuncOf(storeUpsertDiscoveryCandidate),
		"storeListDiscoveryCandidates":  js.FuncOf(storeListDiscoveryCandidates),
		// Store Fact Sheets
		"storeUpsertEntityCard":   js.FuncOf(storeUpsertEntityCard),
		"storeUpsertEntityCards":  js.FuncOf(storeUpsertEntityCards),
		"storeGetEntityCards":     js.FuncOf(storeGetEntityCards),
		"storeUpsertFolderSchema": js.FuncOf(storeUpsertFolderSchema),
		"storeGetFolderSchema":    js.FuncOf(storeGetFolderSchema),
		// Phase 3: Graph Merger API
		"mergerInit":       js.FuncOf(mergerInit),
		"mergerAddScanner": js.FuncOf(mergerAddScanner),
		"mergerAddLLM":     js.FuncOf(mergerAddLLM),
		"mergerAddManual":  js.FuncOf(mergerAddManual),
		"mergerGetGraph":   js.FuncOf(mergerGetGraph),
		"mergerGetStats":   js.FuncOf(mergerGetStats),
		// Phase 4: PCST Coherence Filter
		"mergerRunPCST": js.FuncOf(mergerRunPCST),
		// Phase 5: SharedArrayBuffer Zero-Copy
		"sabInit":            js.FuncOf(sabInit),
		"sabScanToBuffer":    js.FuncOf(sabScanToBuffer),
		"sabGetBufferStatus": js.FuncOf(sabGetBufferStatus),
		// Phase 6: LLM Batch + Extraction + Agent
		"batchInit":          js.FuncOf(jsBatchInit),
		"extractFromNote":    js.FuncOf(jsExtractFromNote),
		"extractEntities":    js.FuncOf(jsExtractEntities),
		"extractRelations":   js.FuncOf(jsExtractRelations),
		"agentChatWithTools": js.FuncOf(jsAgentChatWithTools),
		"goStreamChat":       js.FuncOf(jsGoStreamChat),
		// Phase 7: Observational Memory + Chat Service
		"chatInit":                 js.FuncOf(jsChatInit),
		"chatCreateThread":         js.FuncOf(jsChatCreateThread),
		"chatGetThread":            js.FuncOf(jsChatGetThread),
		"chatListThreads":          js.FuncOf(jsChatListThreads),
		"chatDeleteThread":         js.FuncOf(jsChatDeleteThread),
		"chatAddMessage":           js.FuncOf(jsChatAddMessage),
		"chatGetMessages":          js.FuncOf(jsChatGetMessages),
		"chatUpdateMessage":        js.FuncOf(jsChatUpdateMessage),
		"chatAppendMessage":        js.FuncOf(jsChatAppendMessage),
		"chatStartStreaming":       js.FuncOf(jsChatStartStreaming),
		"chatGetMemories":          js.FuncOf(jsChatGetMemories),
		"chatGetContext":           js.FuncOf(jsChatGetContext),
		"chatClearThread":          js.FuncOf(jsChatClearThread),
		"chatExportThread":         js.FuncOf(jsChatExportThread),
		"chatProcessWithWorkspace": js.FuncOf(jsChatProcessWithWorkspace),
		// RAPTOR: Hierarchical Document Retrieval
		"raptorInit":             js.FuncOf(raptorInit),
		"raptorBuildTree":        js.FuncOf(raptorBuildTree),
		"raptorSearch":           js.FuncOf(raptorSearch),
		"raptorSearchAggregated": js.FuncOf(raptorSearchAggregated),
		"raptorSearchLeafOnly":   js.FuncOf(raptorSearchLeafOnly),
		"raptorGetStats":         js.FuncOf(raptorGetStats),
		"raptorClear":            js.FuncOf(raptorClear),
		// RAPTOR SAB Zero-Copy
		"raptorChunk":     js.FuncOf(raptorChunk),
		"raptorIngestSAB": js.FuncOf(raptorIngestSAB),
		// Knowledge Graph (Phase 4: Unification)
		"knowledgeInit":            js.FuncOf(knowledgeInit),
		"knowledgeLoad":            js.FuncOf(knowledgeLoad),
		"knowledgeSave":            js.FuncOf(knowledgeSave),
		"knowledgeAddNode":         js.FuncOf(knowledgeAddNode),
		"knowledgeAddEdge":         js.FuncOf(knowledgeAddEdge),
		"knowledgeGetNode":         js.FuncOf(knowledgeGetNode),
		"knowledgeGetChildren":     js.FuncOf(knowledgeGetChildren),
		"knowledgeGetParents":      js.FuncOf(knowledgeGetParents),
		"knowledgeGetAncestors":    js.FuncOf(knowledgeGetAncestors),
		"knowledgeGetDescendants":  js.FuncOf(knowledgeGetDescendants),
		"knowledgeGetNeighborhood": js.FuncOf(knowledgeGetNeighborhood),
		"knowledgeGetGraph":        js.FuncOf(knowledgeGetGraph),
	}))

	select {}
}

// ... existing helpers ...

// indexDocument is deprecated/legacy. Use indexNote instead.
func indexDocument(this js.Value, args []js.Value) interface{} {
	return ErrorResult("deprecated: use indexNote for q-gram indexing")
}

// indexNote: [id string, text string, scopeJSON string (optional)]
// Scans text with Conductor and indexes it in ResoRank with optional scope metadata
func indexNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("requires 2+ args: id, text, [scopeJSON]")
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

	if searcher == nil {
		return ErrorResult("searcher not initialized")
	}

	// Index raw text into Q-Gram Index with metadata
	searcher.IndexDocumentScoped(id, map[string]string{"body": text}, narrativeID, folderPath)

	return SuccessResult("indexed " + id)
}

// search: [queryJSON string, limit int, vectorJSON string (optional), scopeJSON string (optional)]
func search(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("requires 2+ args: queryJSON, limit, [vectorJSON], [scopeJSON]")
	}

	var queryInput interface{}
	if err := json.Unmarshal([]byte(args[0].String()), &queryInput); err != nil {
		return ErrorResult("query json: " + err.Error())
	}

	var input string
	matchAny := false

	switch v := queryInput.(type) {
	case string:
		input = v
	case []interface{}:
		// Join array of strings
		parts := make([]string, len(v))
		for i, p := range v {
			if s, ok := p.(string); ok {
				parts[i] = s
			}
		}
		input = strings.Join(parts, " ")
	case map[string]interface{}:
		// Support object with options
		if q, ok := v["query"].(string); ok {
			input = q
		}
		if anyMatch, ok := v["matchAny"].(bool); ok {
			matchAny = anyMatch
		}
	default:
		return ErrorResult("query must be string, array, or object {query, matchAny}")
	}

	limit := args[1].Int()

	// Vector support TODO (Q-Gram is currently text-only)
	// var vector []float32
	// if len(args) > 2 && ...

	// Scope filter
	var scope *qgram.SearchScope
	if len(args) > 3 && args[3].String() != "" && args[3].String() != "null" {
		scope = &qgram.SearchScope{}
		if err := json.Unmarshal([]byte(args[3].String()), scope); err != nil {
			return ErrorResult("scope json: " + err.Error())
		}
	}

	// Defaults: Î»=3 (soft-AND), PhraseHard=true, Proximity=0.5
	config := qgram.DefaultSearchConfig()
	config.Scope = scope
	config.FieldWeights["body"] = 1.0

	// Apply matchAny override
	if matchAny {
		config.CoverageLambda = 0.0
		// Should we disable PhraseHard? User request implies "Match Any Term".
		// If query has quotes, usually users expect quotes to be respected even in OR mode.
		// e.g. "big apple" OR orange.
		// Leaving PhraseHard=true (default) means phrases are units.
	}

	results := searcher.Search(input, config, limit)

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
		return ErrorResult(err.Error())
	}

	// Build Aho-Corasick dictionary from entities if provided
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "[]" {
		// Use pointers to ensure custom UnmarshalJSON is called
		var entityPtrs []*implicitmatcher.RegisteredEntity
		if err := json.Unmarshal([]byte(args[0].String()), &entityPtrs); err != nil {
			return ErrorResult("invalid entities json: " + err.Error())
		}

		if len(entityPtrs) > 0 {
			// Convert back to value numbers for Compile
			entities := make([]implicitmatcher.RegisteredEntity, len(entityPtrs))
			for i, e := range entityPtrs {
				entities[i] = *e
			}

			dict, err := implicitmatcher.Compile(entities)
			if err != nil {
				return ErrorResult("aho-corasick compile: " + err.Error())
			}
			pipeline.SetDictionary(dict)
			pipeline.SeedDiscovery(entities)
			fmt.Println("[GoKitt] âœ… Dictionary compiled:", len(entities), "entities")
			fmt.Println("[GoKitt] âœ… Discovery seeded:", len(entities), "entities")
		}
	}

	return SuccessResult("initialized")
}

// byteToRuneOffset converts a byte offset in a string to a rune (character) offset.
// JavaScript uses character indices (UTF-16 code units, same as runes for BMP),
// but Go's string indexing is byte-based. This conversion is critical for correct
// position mapping when text contains multi-byte UTF-8 characters (smart quotes,
// em-dashes, accented characters, etc.)
func byteToRuneOffset(s string, byteOff int) int {
	return utf8.RuneCountInString(s[:byteOff])
}

// isWordRune checks if a rune is a word character (letter, digit, or underscore)
func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
}

// scanImplicit finds known entities in text using Aho-Corasick
// Args: [text string]
// Returns: JSON array of decoration spans with RUNE offsets (not byte offsets)
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
		// Check Word Boundaries using rune-aware decoding
		// 1. Previous rune must be non-alphanumeric (or start of string)
		if m.Start > 0 {
			prevRune, _ := utf8.DecodeLastRuneInString(text[:m.Start])
			if prevRune != utf8.RuneError && isWordRune(prevRune) {
				continue
			}
		}

		// 2. Next rune must be non-alphanumeric (or end of string)
		if m.End < len(text) {
			nextRune, _ := utf8.DecodeRuneInString(text[m.End:])
			if nextRune != utf8.RuneError && isWordRune(nextRune) {
				continue
			}
		}

		if len(m.Entities) > 0 {
			best := dict.SelectBest(getEntityIDs(m.Entities))
			if best != nil {
				// Convert byte offsets â†’ rune offsets for JavaScript
				runeFrom := byteToRuneOffset(text, m.Start)
				runeTo := byteToRuneOffset(text, m.End)

				spans = append(spans, map[string]interface{}{
					"type":     "entity_implicit",
					"from":     runeFrom,
					"to":       runeTo,
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
		return ErrorResult("rebuildDictionary requires 1 argument: entitiesJSON")
	}
	if pipeline == nil {
		return ErrorResult("pipeline not initialized")
	}

	entitiesJSON := args[0].String()
	if entitiesJSON == "" || entitiesJSON == "[]" {
		// No entities - clear dictionary
		pipeline.SetDictionary(nil)
		fmt.Println("[GoKitt] Dictionary cleared (no entities)")
		return SuccessResult("cleared")
	}

	// Parse entities (use pointers for custom UnmarshalJSON)
	var entityPtrs []*implicitmatcher.RegisteredEntity
	if err := json.Unmarshal([]byte(entitiesJSON), &entityPtrs); err != nil {
		return ErrorResult("invalid entities json: " + err.Error())
	}

	if len(entityPtrs) == 0 {
		pipeline.SetDictionary(nil)
		fmt.Println("[GoKitt] Dictionary cleared (empty array)")
		return SuccessResult("cleared")
	}

	// Convert to value slice for Compile
	entities := make([]implicitmatcher.RegisteredEntity, len(entityPtrs))
	for i, e := range entityPtrs {
		entities[i] = *e
	}

	// Compile new dictionary
	dict, err := implicitmatcher.Compile(entities)
	if err != nil {
		return ErrorResult("aho-corasick compile: " + err.Error())
	}

	pipeline.SetDictionary(dict)
	pipeline.SeedDiscovery(entities)
	fmt.Printf("[GoKitt] âœ… Dictionary rebuilt: %d entities\n", len(entities))

	return SuccessResult(fmt.Sprintf("rebuilt with %d entities", len(entities)))
}

// scan processes text and returns result
// Args: [text string, provenanceJSON string (optional)]
// Returns: SLIM response with only graph data (nodes/edges) + timing
func scan(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("scan requires at least 1 argument: text")
	}
	if pipeline == nil {
		return ErrorResult("pipeline not initialized")
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
	// Build entity map from EVERYTHING found in the scan (Explicit + Implicit + Discovery)
	// This ensures the projector sees all NEs, not just resolved pronouns.
	entityMap := make(projection.EntityMap)
	for _, m := range result.Syntax {
		if m.Kind == syntax.KindEntity {
			// Use ID if available (Implicit matches), otherwise Label (Discovery/Explicit)
			id := m.ID
			if id == "" {
				id = m.Label
			}
			entityMap[m.Start] = id
		}
	}
	// Also add resolved pronouns (they might not be in Syntax if they are just pronouns)
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
		return ErrorResult(err.Error())
	}

	return string(jsonBytes)
}

// scanDiscovery performs unsupervised NER ("The Virus")
// Args: [text string]
func scanDiscovery(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("scanDiscovery requires 1 argument: text")
	}
	if pipeline == nil {
		return ErrorResult("pipeline not initialized")
	}

	text := args[0].String()
	// Scan the text with Discovery Engine (heuristic)
	pipeline.ScanDiscovery(text)

	candidates := pipeline.GetCandidates()
	jsonBytes, _ := json.Marshal(candidates)
	return string(jsonBytes)
}

// Helper: Create error result
func ErrorResult(msg string) interface{} {
	result := map[string]interface{}{
		"error": msg,
	}
	jsonBytes, _ := json.Marshal(result)
	return string(jsonBytes)
}

// Helper: Create success result
func SuccessResult(msg string) interface{} {
	result := map[string]interface{}{
		"success": true,
		"message": msg,
	}
	jsonBytes, _ := json.Marshal(result)
	return string(jsonBytes)
}

// analyzeText calculates word counts, reading level, etc.
func analyzeText(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("analyzeText requires 1 arg: text")
	}
	text := args[0].String()
	res := analytics.AnalyzeText(text)
	jsonBytes, _ := json.Marshal(res)
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
		return ErrorResult("hydrateNotes requires 1 arg: notesJSON")
	}

	var input []struct {
		ID          string `json:"id"`
		Text        string `json:"text"`
		Version     int64  `json:"version"`
		NarrativeID string `json:"narrativeId"`
		FolderPath  string `json:"folderPath"`
	}

	if err := json.Unmarshal([]byte(args[0].String()), &input); err != nil {
		return ErrorResult("invalid notes json: " + err.Error())
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

	// Also index into Q-Gram Searcher
	if searcher != nil {
		for i, n := range input {
			if i == 0 {
				fmt.Printf("[GoKitt] 🔍 Hydrating Note[0]: ID=%s Len=%d TextPreview=%q\n", n.ID, len(n.Text), n.Text[:min(50, len(n.Text))])
			}
			searcher.IndexDocumentScoped(n.ID, map[string]string{"body": n.Text}, n.NarrativeID, n.FolderPath)
		}
		fmt.Printf("[GoKitt] 🔎 Search Index hydrated: %d notes\n", len(input))
		stats := searcher.GetCorpusStats()
		fmt.Printf("[GoKitt] 📊 Index Stats: %d docs, AvgLen=%.2f\n", stats.TotalDocuments, stats.AverageDocLength)
	}

	fmt.Printf("[GoKitt] ✅ DocStore hydrated: %d notes\n", count)
	return SuccessResult(fmt.Sprintf("hydrated %d notes", count))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// upsertNote adds or updates a single note in DocStore.
// Called when user saves a note.
// Args: [id string, text string, version int64 (optional)]
func upsertNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("upsertNote requires 2+ args: id, text, [version]")
	}

	id := args[0].String()
	text := args[1].String()
	var version int64 = 0
	if len(args) > 2 {
		version = int64(args[2].Int())
	}

	docs.Upsert(id, text, version)
	return SuccessResult("upserted " + id)
}

// removeNote deletes a note from DocStore.
// Args: [id string]
func removeNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("removeNote requires 1 arg: id")
	}

	id := args[0].String()
	docs.Remove(id)
	return SuccessResult("removed " + id)
}

// scanNote scans a note from DocStore (not from JS).
// This eliminates the JSâ†’Go text transfer on each scan.
// Args: [id string, provenanceJSON string (optional)]
func scanNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("scanNote requires 1 arg: noteId")
	}
	if pipeline == nil {
		return ErrorResult("pipeline not initialized")
	}

	noteId := args[0].String()

	// Get text from DocStore (not from JS!)
	text := docs.GetText(noteId)
	if text == "" {
		return ErrorResult("note not found in DocStore: " + noteId)
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
	for _, m := range result.Syntax {
		if m.Kind == syntax.KindEntity {
			id := m.ID
			if id == "" {
				id = m.Label
			}
			entityMap[m.Start] = id
		}
	}
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
		return ErrorResult(err.Error())
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
		return ErrorResult("validateRelations requires [noteId, relationsJSON]")
	}

	noteID := args[0].String()
	relationsJSON := args[1].String()

	// Get the note text from DocStore
	note := docs.Get(noteID)
	if note == nil {
		return ErrorResult("Note not found in DocStore: " + noteID)
	}

	// Parse the LLM relations
	var llmRelations []validator.LLMRelation
	if err := json.Unmarshal([]byte(relationsJSON), &llmRelations); err != nil {
		return ErrorResult("Failed to parse relations JSON: " + err.Error())
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
		return ErrorResult(err.Error())
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
	// Snapshot Native: Always use in-memory DB for runtime speed.
	// Persistence is handled by Export/Import snapshots.
	sqlStore, err = store.NewSQLiteStore()
	if err != nil {
		return ErrorResult("failed to initialize SQLite store: " + err.Error())
	}

	// [BUG FIX] If ChatService or AgentService already initialized with an old pointer, rebind them!
	if chatSvc != nil {
		fmt.Println("[GoKitt] 🔄 Re-wiring ChatService to new SQLite store instance")
		chatSvc = chat.NewChatService(sqlStore, agentSvc)
	}

	fmt.Println("[GoKitt] ✅ SQLite Store initialized")
	return SuccessResult("store initialized")
}

// storeGetVersion returns the SQLite library version.
// Args: []
// Returns: Version string or error
func storeGetVersion(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	version, err := sqlStore.GetVersion()
	if err != nil {
		return ErrorResult("version check failed: " + err.Error())
	}

	return SuccessResult(version)
}

// storeUpsertNote inserts or updates a note.
// Args: [noteJSON string]
func storeUpsertNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertNote requires 1 arg: noteJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var note store.Note
	if err := json.Unmarshal([]byte(args[0].String()), &note); err != nil {
		return ErrorResult("invalid note json: " + err.Error())
	}

	if err := sqlStore.UpsertNote(&note); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	// [WAL] Emit Upsert Event
	// emitWal("upsertNote", note) // REMOVED - Snapshot Native

	return SuccessResult("upserted " + note.ID)
}

// storeGetNote retrieves a note by ID.
// Args: [id string]
// Returns: Note JSON or null
func storeGetNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetNote requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	note, err := sqlStore.GetNote(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
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
		return ErrorResult("storeDeleteNote requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	id := args[0].String()
	if err := sqlStore.DeleteNote(id); err != nil {
		return ErrorResult("delete failed: " + err.Error())
	}

	// [WAL] Emit Delete Event
	// emitWal("deleteNote", map[string]string{"id": id}) // REMOVED - Snapshot Native

	return SuccessResult("deleted")
}

// storeListNotes returns all notes, optionally filtered by folder.
// Args: [folderID string (optional)]
// Returns: JSON array of notes
func storeListNotes(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var folderID string
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		folderID = args[0].String()
	}

	notes, err := sqlStore.ListNotes(folderID)
	if err != nil {
		return ErrorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(notes)
	return string(bytes)
}

// storeUpsertEntity inserts or updates an entity.
// Args: [entityJSON string]
func storeUpsertEntity(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertEntity requires 1 arg: entityJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var entity store.Entity
	if err := json.Unmarshal([]byte(args[0].String()), &entity); err != nil {
		return ErrorResult("invalid entity json: " + err.Error())
	}

	if err := sqlStore.UpsertEntity(&entity); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	// [WAL] Emit Upsert Event
	// emitWal("upsertEntity", entity) // REMOVED - Snapshot Native

	return SuccessResult("upserted " + entity.ID)
}

// storeGetEntity retrieves an entity by ID.
// Args: [id string]
// Returns: Entity JSON or null
func storeGetEntity(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetEntity requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	entity, err := sqlStore.GetEntity(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
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
		return ErrorResult("storeGetEntityByLabel requires 1 arg: label")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	entity, err := sqlStore.GetEntityByLabel(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
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
		return ErrorResult("storeDeleteEntity requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	id := args[0].String()
	if err := sqlStore.DeleteEntity(id); err != nil {
		return ErrorResult("delete failed: " + err.Error())
	}

	// [WAL] Emit Delete Event
	// emitWal("deleteEntity", map[string]string{"id": id}) // REMOVED - Snapshot Native

	return SuccessResult("deleted")
}

// storeListEntities returns all entities, optionally filtered by kind.
// Args: [kind string (optional)]
// Returns: JSON array of entities
func storeListEntities(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var kind string
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		kind = args[0].String()
	}

	entities, err := sqlStore.ListEntities(kind)
	if err != nil {
		return ErrorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(entities)
	return string(bytes)
}

// storeUpsertEdge inserts or updates an edge.
// Args: [edgeJSON string]
func storeUpsertEdge(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertEdge requires 1 arg: edgeJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var edge store.Edge
	if err := json.Unmarshal([]byte(args[0].String()), &edge); err != nil {
		return ErrorResult("invalid edge json: " + err.Error())
	}

	if err := sqlStore.UpsertEdge(&edge); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	// [WAL] Emit Upsert Event
	// emitWal("upsertEdge", edge) // REMOVED - Snapshot Native

	return SuccessResult("upserted " + edge.ID)
}

// storeGetEdge retrieves an edge by ID.
// Args: [id string]
// Returns: Edge JSON or null
func storeGetEdge(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetEdge requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	edge, err := sqlStore.GetEdge(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
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
		return ErrorResult("storeDeleteEdge requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	id := args[0].String()
	if err := sqlStore.DeleteEdge(id); err != nil {
		return ErrorResult("delete failed: " + err.Error())
	}

	// [WAL] Emit Delete Event
	// emitWal("deleteEdge", map[string]string{"id": id}) // REMOVED - Snapshot Native

	return SuccessResult("deleted")
}

// storeListEdges returns all edges for an entity.
// Args: [entityID string]
// Returns: JSON array of edges
func storeListEdges(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeListEdges requires 1 arg: entityID")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	edges, err := sqlStore.ListEdgesForEntity(args[0].String())
	if err != nil {
		return ErrorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(edges)
	return string(bytes)
}

// =============================================================================
// CozoDB Parity: Spans & Links
// =============================================================================

// storeUpsertSpan inserts or updates a span.
// Args: [spanJSON string]
func storeUpsertSpan(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertSpan requires 1 arg: spanJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var span store.Span
	if err := json.Unmarshal([]byte(args[0].String()), &span); err != nil {
		return ErrorResult("invalid span json: " + err.Error())
	}

	if err := sqlStore.UpsertSpan(&span); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	// emitWal("upsertSpan", span) // REMOVED - Snapshot Native
	return SuccessResult("upserted " + span.ID)
}

// storeGetSpan retrieves a span by ID.
// Args: [id string]
func storeGetSpan(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetSpan requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	span, err := sqlStore.GetSpan(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
	}
	if span == nil {
		return "null"
	}

	bytes, _ := json.Marshal(span)
	return string(bytes)
}

// storeListSpansForNote retrieves all spans for a note.
// Args: [noteID string]
func storeListSpansForNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeListSpansForNote requires 1 arg: noteID")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	spans, err := sqlStore.ListSpansForNote(args[0].String())
	if err != nil {
		return ErrorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(spans)
	return string(bytes)
}

// storeDeleteSpan deletes a span by ID.
// Args: [id string]
func storeDeleteSpan(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeDeleteSpan requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	id := args[0].String()
	if err := sqlStore.DeleteSpan(id); err != nil {
		return ErrorResult("delete failed: " + err.Error())
	}

	// emitWal("deleteSpan", map[string]string{"id": id}) // REMOVED - Snapshot Native
	return SuccessResult("deleted")
}

// =============================================================================
// CozoDB Parity: Network View
// =============================================================================

// storeUpsertNetworkInstance inserts or updates a network view.
// Args: [networkJSON string]
func storeUpsertNetworkInstance(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertNetworkInstance requires 1 arg: networkJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var net store.NetworkInstance
	if err := json.Unmarshal([]byte(args[0].String()), &net); err != nil {
		return ErrorResult("invalid network json: " + err.Error())
	}

	if err := sqlStore.UpsertNetworkInstance(&net); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	// emitWal("upsertNetworkInstance", net) // REMOVED - Snapshot Native
	return SuccessResult("upserted " + net.ID)
}

// storeGetNetworkInstance retrieves a network view by ID.
// Args: [id string]
func storeGetNetworkInstance(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetNetworkInstance requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	net, err := sqlStore.GetNetworkInstance(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
	}
	if net == nil {
		return "null"
	}

	bytes, _ := json.Marshal(net)
	return string(bytes)
}

// storeListNetworkInstances retrieves all network views.
// Args: []
func storeListNetworkInstances(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	nets, err := sqlStore.ListNetworkInstances()
	if err != nil {
		return ErrorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(nets)
	return string(bytes)
}

// storeDeleteNetworkInstance deletes a network view by ID.
// Args: [id string]
func storeDeleteNetworkInstance(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeDeleteNetworkInstance requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	id := args[0].String()
	if err := sqlStore.DeleteNetworkInstance(id); err != nil {
		return ErrorResult("delete failed: " + err.Error())
	}

	// emitWal("deleteNetworkInstance", map[string]string{"id": id}) // REMOVED - Snapshot Native
	return SuccessResult("deleted")
}

// storeUpsertNetworkMembership inserts or updates a network membership.
// Args: [memberJSON string]
func storeUpsertNetworkMembership(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertNetworkMembership requires 1 arg: memberJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var member store.NetworkMembership
	if err := json.Unmarshal([]byte(args[0].String()), &member); err != nil {
		return ErrorResult("invalid member json: " + err.Error())
	}

	if err := sqlStore.UpsertNetworkMembership(&member); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	return SuccessResult("upserted membership")
}

// storeGetNetworkMembers retrieves members for a network.
// Args: [networkID string]
func storeGetNetworkMembers(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetNetworkMembers requires 1 arg: networkID")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	members, err := sqlStore.GetNetworkMembers(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
	}

	bytes, _ := json.Marshal(members)
	return string(bytes)
}

// storeUpsertNetworkRelationship inserts or updates a network relationship visibility.
// Args: [relJSON string]
func storeUpsertNetworkRelationship(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertNetworkRelationship requires 1 arg: relJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var rel store.NetworkRelationship
	if err := json.Unmarshal([]byte(args[0].String()), &rel); err != nil {
		return ErrorResult("invalid rel json: " + err.Error())
	}

	if err := sqlStore.UpsertNetworkRelationship(&rel); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	return SuccessResult("upserted relationship")
}

// storeGetNetworkRelationships retrieves relationships for a network.
// Args: [networkID string]
func storeGetNetworkRelationships(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetNetworkRelationships requires 1 arg: networkID")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	rels, err := sqlStore.GetNetworkRelationships(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
	}

	bytes, _ := json.Marshal(rels)
	return string(bytes)
}

// storeDeleteNetworkMembership removes an entity from a network.
// Args: [networkID string, entityID string]
func storeDeleteNetworkMembership(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("storeDeleteNetworkMembership requires 2 args: networkID, entityID")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	if err := sqlStore.DeleteNetworkMembership(args[0].String(), args[1].String()); err != nil {
		return ErrorResult("delete failed: " + err.Error())
	}

	return SuccessResult("deleted membership")
}

// storeDeleteNetworkRelationship removes a relationship from a network view.
// Args: [networkID string, relationshipID string]
func storeDeleteNetworkRelationship(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("storeDeleteNetworkRelationship requires 2 args: networkID, relationshipID")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	if err := sqlStore.DeleteNetworkRelationship(args[0].String(), args[1].String()); err != nil {
		return ErrorResult("delete failed: " + err.Error())
	}

	return SuccessResult("deleted relationship")
}

// =============================================================================
// CozoDB Parity: Discovery (Inbox)
// =============================================================================

// storeUpsertDiscoveryCandidate inserts or updates a discovery candidate.
// Args: [candidateJSON string]
func storeUpsertDiscoveryCandidate(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertDiscoveryCandidate requires 1 arg: candidateJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var candidate store.DiscoveryCandidate
	if err := json.Unmarshal([]byte(args[0].String()), &candidate); err != nil {
		return ErrorResult("invalid candidate json: " + err.Error())
	}

	if err := sqlStore.UpsertDiscoveryCandidate(&candidate); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	return SuccessResult("upserted " + candidate.Token)
}

// storeListDiscoveryCandidates retrieves all discovery candidates.
// Args: []
func storeListDiscoveryCandidates(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	candidates, err := sqlStore.ListDiscoveryCandidates()
	if err != nil {
		return ErrorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(candidates)
	return string(bytes)
}

// =============================================================================
// CozoDB Parity: Fact Sheets & Folders
// =============================================================================

// storeUpsertEntityCard inserts or updates an entity card.
// Args: [cardJSON string]
func storeUpsertEntityCard(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertEntityCard requires 1 arg: cardJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var card store.EntityCard
	if err := json.Unmarshal([]byte(args[0].String()), &card); err != nil {
		return ErrorResult("invalid card json: " + err.Error())
	}

	if err := sqlStore.UpsertEntityCard(&card); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	return SuccessResult("upserted card")
}

// storeUpsertEntityCards inserts or updates multiple entity cards.
// Args: [cardsJSON string]
func storeUpsertEntityCards(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertEntityCards requires 1 arg: cardsJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var cards []*store.EntityCard
	if err := json.Unmarshal([]byte(args[0].String()), &cards); err != nil {
		return ErrorResult("invalid cards json: " + err.Error())
	}

	if err := sqlStore.UpsertEntityCardsBatch(cards); err != nil {
		return ErrorResult("batch upsert failed: " + err.Error())
	}

	return SuccessResult(fmt.Sprintf("upserted %d cards", len(cards)))
}

// storeGetEntityCards retrieves cards for an entity.
// Args: [entityID string]
func storeGetEntityCards(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetEntityCards requires 1 arg: entityID")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	cards, err := sqlStore.GetEntityCards(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
	}

	bytes, _ := json.Marshal(cards)
	return string(bytes)
}

// storeUpsertFolderSchema inserts or updates a folder schema.
// Args: [schemaJSON string]
func storeUpsertFolderSchema(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertFolderSchema requires 1 arg: schemaJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var schema store.FolderSchema
	if err := json.Unmarshal([]byte(args[0].String()), &schema); err != nil {
		return ErrorResult("invalid schema json: " + err.Error())
	}

	if err := sqlStore.UpsertFolderSchema(&schema); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	return SuccessResult("upserted " + schema.ID)
}

// storeGetFolderSchema retrieves a folder schema by ID.
// Args: [id string]
func storeGetFolderSchema(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetFolderSchema requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	schema, err := sqlStore.GetFolderSchema(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
	}
	if schema == nil {
		return "null"
	}

	bytes, _ := json.Marshal(schema)
	return string(bytes)
}

// =============================================================================
// Store Export/Import (OPFS Sync)
// =============================================================================

// storeExport serializes the SQLite database to a Uint8Array.
// Args: []
// Returns: Uint8Array of database bytes (for OPFS persistence)
func storeExport(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	data, err := sqlStore.Export()
	if err != nil {
		return ErrorResult("export failed: " + err.Error())
	}

	// Create a Uint8Array in JS and copy bytes over
	jsArray := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(jsArray, data)

	fmt.Printf("[GoKitt] âœ… Exported %d bytes\n", len(data))
	return jsArray
}

// storeImport restores the SQLite database from a Uint8Array.
// Args: [data Uint8Array]
func storeImport(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeImport requires 1 arg: data (Uint8Array)")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	jsArray := args[0]
	length := jsArray.Get("length").Int()
	data := make([]byte, length)
	js.CopyBytesToGo(data, jsArray)

	if err := sqlStore.Import(data); err != nil {
		return ErrorResult("import failed: " + err.Error())
	}

	fmt.Printf("[GoKitt] âœ… Imported %d bytes\n", length)
	return SuccessResult(fmt.Sprintf("imported %d bytes", length))
}

// =============================================================================
// WAL Event Emission
// =============================================================================

// setWalHandler registers a JS callback to receive WAL events
// Args: [callback function]
func setWalHandler(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("setWalHandler requires 1 arg: callback")
	}
	walHandler = args[0]
	fmt.Println("[GoKitt] WAL handler registered")
	return SuccessResult("handler registered")
}

// emitWal sends a WAL event to JS
func emitWal(op string, data interface{}) {
	if walHandler.IsUndefined() || walHandler.IsNull() {
		return
	}

	// serialize data to JSON
	bytes, err := json.Marshal(data)
	if err != nil {
		fmt.Println("[GoKitt] WAL serialization failed:", err)
		return
	}

	// Call JS handler in a goroutine to avoid blocking
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Println("Recovered from WAL emit panic:", r)
			}
		}()
		walHandler.Invoke(op, string(bytes))
	}()
}

// =============================================================================
// Store Folder CRUD
// =============================================================================

// storeUpsertFolder inserts or updates a folder.
// Args: [folderJSON string]
func storeUpsertFolder(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeUpsertFolder requires 1 arg: folderJSON")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var folder store.Folder
	if err := json.Unmarshal([]byte(args[0].String()), &folder); err != nil {
		return ErrorResult("invalid folder json: " + err.Error())
	}

	if err := sqlStore.UpsertFolder(&folder); err != nil {
		return ErrorResult("upsert failed: " + err.Error())
	}

	// [WAL] Emit Upsert Event
	// emitWal("upsertFolder", folder) // REMOVED - Snapshot Native

	return SuccessResult("upserted " + folder.ID)
}

// storeGetFolder retrieves a folder by ID.
// Args: [id string]
// Returns: Folder JSON or null
func storeGetFolder(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeGetFolder requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	folder, err := sqlStore.GetFolder(args[0].String())
	if err != nil {
		return ErrorResult("get failed: " + err.Error())
	}
	if folder == nil {
		return "null"
	}

	bytes, _ := json.Marshal(folder)
	return string(bytes)
}

// storeDeleteFolder deletes a folder by ID.
// Args: [id string]
func storeDeleteFolder(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeDeleteFolder requires 1 arg: id")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	id := args[0].String()
	if err := sqlStore.DeleteFolder(id); err != nil {
		return ErrorResult("delete failed: " + err.Error())
	}

	// [WAL] Emit Delete Event
	// emitWal("deleteFolder", map[string]string{"id": id}) // REMOVED - Snapshot Native

	return SuccessResult("deleted")
}

// storeListFolders returns all folders, optionally filtered by parent.
// Args: [parentID string (optional)]
// Returns: JSON array of folders
func storeListFolders(this js.Value, args []js.Value) interface{} {
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	var parentID string
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		parentID = args[0].String()
	}

	folders, err := sqlStore.ListFolders(parentID)
	if err != nil {
		return ErrorResult("list failed: " + err.Error())
	}

	bytes, _ := json.Marshal(folders)
	return string(bytes)
}

// =============================================================================
// Phase 3: Graph Merger API
// =============================================================================

// mergerInit creates a new merger instance
// Args: []
func mergerInit(this js.Value, args []js.Value) interface{} {
	graphMerger = merger.New()
	return SuccessResult("Merger initialized")
}

// mergerAddScanner adds edges from a scanner graph result
// Args: [noteId string, graphJSON string]
func mergerAddScanner(this js.Value, args []js.Value) interface{} {
	if graphMerger == nil {
		return ErrorResult("Merger not initialized - call mergerInit first")
	}
	if len(args) < 2 {
		return ErrorResult("mergerAddScanner requires [noteId, graphJSON]")
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
		return ErrorResult("Failed to parse graph JSON: " + err.Error())
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
		return ErrorResult("Merger not initialized - call mergerInit first")
	}
	if len(args) < 1 {
		return ErrorResult("mergerAddLLM requires [edgesJSON]")
	}

	var edges []merger.LLMEdgeInput
	if err := json.Unmarshal([]byte(args[0].String()), &edges); err != nil {
		return ErrorResult("Failed to parse edges JSON: " + err.Error())
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
		return ErrorResult("Merger not initialized - call mergerInit first")
	}
	if len(args) < 1 {
		return ErrorResult("mergerAddManual requires [edgesJSON]")
	}

	var edges []merger.ManualEdgeInput
	if err := json.Unmarshal([]byte(args[0].String()), &edges); err != nil {
		return ErrorResult("Failed to parse edges JSON: " + err.Error())
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
		return ErrorResult("Merger not initialized - call mergerInit first")
	}

	graph := graphMerger.GetMergedGraph()
	bytes, err := json.Marshal(graph)
	if err != nil {
		return ErrorResult("Failed to serialize graph: " + err.Error())
	}

	return string(bytes)
}

// mergerGetStats returns merge statistics
// Args: []
func mergerGetStats(this js.Value, args []js.Value) interface{} {
	if graphMerger == nil {
		return ErrorResult("Merger not initialized - call mergerInit first")
	}

	stats := graphMerger.GetStats()
	bytes, err := json.Marshal(stats)
	if err != nil {
		return ErrorResult("Failed to serialize stats: " + err.Error())
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
		return ErrorResult("Merger not initialized - call mergerInit first")
	}
	if len(args) < 1 {
		return ErrorResult("mergerRunPCST requires [prizesJSON, rootID?]")
	}

	var prizes map[string]float64
	if err := json.Unmarshal([]byte(args[0].String()), &prizes); err != nil {
		return ErrorResult("Failed to parse prizes JSON: " + err.Error())
	}

	rootID := ""
	if len(args) > 1 && args[1].String() != "" {
		rootID = args[1].String()
	}

	filtered, err := graphMerger.RunPCST(prizes, rootID)
	if err != nil {
		return ErrorResult("PCST failed: " + err.Error())
	}

	bytes, err := json.Marshal(map[string]interface{}{
		"success":   true,
		"graph":     filtered,
		"nodeCount": len(filtered.Nodes),
		"edgeCount": len(filtered.Edges),
	})
	if err != nil {
		return ErrorResult("Failed to serialize result: " + err.Error())
	}

	return string(bytes)
}

// =============================================================================
// Phase 5: SharedArrayBuffer Zero-Copy API
// =============================================================================

// sabInit initializes the SharedArrayBuffer for zero-copy communication
// Args: [SharedArrayBuffer]
func sabInit(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("sabInit requires SharedArrayBuffer argument")
	}

	sabValue := args[0]
	if sabValue.IsUndefined() || sabValue.IsNull() {
		return ErrorResult("SharedArrayBuffer is undefined or null")
	}

	sharedBuffer = sab.New(sabValue)
	if sharedBuffer == nil {
		return ErrorResult("Failed to wrap SharedArrayBuffer")
	}

	result, _ := json.Marshal(map[string]interface{}{
		"success":     true,
		"initialized": true,
		"bufferSize":  sharedBuffer.Length(),
	})
	return string(result)
}

// sabScanToBuffer performs a scan and writes results directly to SharedArrayBuffer
// Args: [text string]
// This bypasses JSON serialization for hot-path performance
func sabScanToBuffer(this js.Value, args []js.Value) interface{} {
	if sharedBuffer == nil {
		return ErrorResult("SharedArrayBuffer not initialized - call sabInit first")
	}

	if len(args) < 1 {
		return ErrorResult("sabScanToBuffer requires text argument")
	}

	text := args[0].String()

	// Run the scan
	if pipeline == nil {
		return ErrorResult("Pipeline not initialized")
	}

	scanResult := pipeline.Scan(text)

	// Build the CST
	root := builder.Zip(text, scanResult)
	if root == nil {
		// Write empty result
		sharedBuffer.WriteMessage(sab.MsgTypeEntitySpans, []byte{0, 0, 0, 0})
		result, _ := json.Marshal(map[string]interface{}{
			"success": true,
			"spans":   0,
		})
		return string(result)
	}

	// Collect entity spans for binary encoding (skip projection for now)
	var spans []sab.EntitySpan
	for _, m := range scanResult.Syntax {
		spans = append(spans, sab.EntitySpan{
			Start:   uint32(m.Start),
			End:     uint32(m.End),
			Kind:    uint16(m.Kind),
			LabelID: 0, // Could map labels to IDs for further optimization
		})
	}

	// Encode and write to SharedArrayBuffer
	payload := sab.EncodeSpans(spans)
	sharedBuffer.WriteMessage(sab.MsgTypeEntitySpans, payload)

	// Return count (JS can read details from SAB)
	result, _ := json.Marshal(map[string]interface{}{
		"success":     true,
		"spans":       len(spans),
		"payloadSize": len(payload),
	})
	return string(result)
}

// sabGetBufferStatus returns the current state of the SharedArrayBuffer
func sabGetBufferStatus(this js.Value, args []js.Value) interface{} {
	if sharedBuffer == nil {
		return ErrorResult("SharedArrayBuffer not initialized")
	}

	result, _ := json.Marshal(map[string]interface{}{
		"success":     true,
		"initialized": true,
		"bufferSize":  sharedBuffer.Length(),
	})
	return string(result)
}

// =============================================================================
// Phase 6: LLM Batch + Extraction + Agent WASM Bridge
// =============================================================================

// makePromise creates a JS Promise and returns it along with resolve/reject functions.
func makePromise() (promise js.Value, resolve js.Value, reject js.Value) {
	var resolveFn, rejectFn js.Value
	handler := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		resolveFn = args[0]
		rejectFn = args[1]
		return nil
	})
	defer handler.Release()

	promise = js.Global().Get("Promise").New(handler)
	return promise, resolveFn, rejectFn
}

// jsBatchInit initializes the batch service with provider config.
// Args: configJSON (string) - JSON with provider, apiKey, model fields
// Returns: JSON result
func jsBatchInit(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("batchInit: config JSON required")
	}

	configJSON := args[0].String()
	var config batch.Config
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		return ErrorResult(fmt.Sprintf("batchInit: invalid config: %v", err))
	}

	if batchSvc == nil {
		batchSvc = batch.NewService(config)
	} else {
		batchSvc.UpdateConfig(config)
	}

	// Initialize extraction and agent services
	extractionSvc = extraction.NewService(batchSvc)
	agentSvc = agent.NewService(batchSvc)

	result, _ := json.Marshal(map[string]interface{}{
		"success":  true,
		"provider": string(config.Provider),
		"model":    batchSvc.GetCurrentModel(),
	})
	return string(result)
}

// jsExtractFromNote performs unified entity + relation extraction via LLM.
// Args: text (string), knownEntitiesJSON (string, optional)
// Returns: Promise<JSON> with {entities: [...], relations: [...]}
func jsExtractFromNote(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("extractFromNote: text required")
	}

	text := args[0].String()
	var knownEntities []string
	if len(args) > 1 && !args[1].IsUndefined() && !args[1].IsNull() {
		json.Unmarshal([]byte(args[1].String()), &knownEntities)
	}

	promise, resolve, reject := makePromise()

	go func() {
		if extractionSvc == nil {
			reject.Invoke(js.Global().Get("Error").New("extractFromNote: service not initialized (call batchInit first)"))
			return
		}

		result, err := extractionSvc.ExtractFromNote(context.Background(), text, knownEntities)
		if err != nil {
			reject.Invoke(js.Global().Get("Error").New(fmt.Sprintf("extractFromNote: %v", err)))
			return
		}

		jsonBytes, _ := json.Marshal(result)
		resolve.Invoke(string(jsonBytes))
	}()

	return promise
}

// jsExtractEntities extracts entities only from text.
// Args: text (string)
// Returns: Promise<JSON> with entity array
func jsExtractEntities(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("extractEntities: text required")
	}

	text := args[0].String()

	promise, resolve, reject := makePromise()

	go func() {
		if extractionSvc == nil {
			reject.Invoke(js.Global().Get("Error").New("extractEntities: service not initialized"))
			return
		}

		entities, err := extractionSvc.ExtractEntitiesFromNote(context.Background(), text)
		if err != nil {
			reject.Invoke(js.Global().Get("Error").New(fmt.Sprintf("extractEntities: %v", err)))
			return
		}

		jsonBytes, _ := json.Marshal(entities)
		resolve.Invoke(string(jsonBytes))
	}()

	return promise
}

// jsExtractRelations extracts relations only from text.
// Args: text (string), knownEntitiesJSON (string, optional)
// Returns: Promise<JSON> with relation array
func jsExtractRelations(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("extractRelations: text required")
	}

	text := args[0].String()
	var knownEntities []string
	if len(args) > 1 && !args[1].IsUndefined() && !args[1].IsNull() {
		json.Unmarshal([]byte(args[1].String()), &knownEntities)
	}

	promise, resolve, reject := makePromise()

	go func() {
		if extractionSvc == nil {
			reject.Invoke(js.Global().Get("Error").New("extractRelations: service not initialized"))
			return
		}

		relations, err := extractionSvc.ExtractRelationsFromNote(context.Background(), text, knownEntities)
		if err != nil {
			reject.Invoke(js.Global().Get("Error").New(fmt.Sprintf("extractRelations: %v", err)))
			return
		}

		jsonBytes, _ := json.Marshal(relations)
		resolve.Invoke(string(jsonBytes))
	}()

	return promise
}

// jsAgentChatWithTools performs a non-streaming LLM call with tool schemas.
// Args: messagesJSON (string), toolsJSON (string), systemPrompt (string)
// Returns: Promise<JSON> with {content, tool_calls}
func jsAgentChatWithTools(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("agentChatWithTools: messagesJSON and toolsJSON required")
	}

	messagesJSON := args[0].String()
	toolsJSON := args[1].String()
	systemPrompt := ""
	if len(args) > 2 && !args[2].IsUndefined() && !args[2].IsNull() {
		systemPrompt = args[2].String()
	}

	promise, resolve, reject := makePromise()

	go func() {
		if agentSvc == nil {
			reject.Invoke(js.Global().Get("Error").New("agentChatWithTools: service not initialized (call batchInit first)"))
			return
		}

		// Parse messages
		var messages []agent.Message
		if err := json.Unmarshal([]byte(messagesJSON), &messages); err != nil {
			reject.Invoke(js.Global().Get("Error").New(fmt.Sprintf("agentChatWithTools: invalid messages: %v", err)))
			return
		}

		// Parse tool definitions
		var tools []agent.ToolDefinition
		if err := json.Unmarshal([]byte(toolsJSON), &tools); err != nil {
			reject.Invoke(js.Global().Get("Error").New(fmt.Sprintf("agentChatWithTools: invalid tools: %v", err)))
			return
		}

		result, err := agentSvc.ChatWithTools(context.Background(), messages, tools, systemPrompt)
		if err != nil {
			reject.Invoke(js.Global().Get("Error").New(fmt.Sprintf("agentChatWithTools: %v", err)))
			return
		}

		jsonBytes, _ := json.Marshal(result)
		resolve.Invoke(string(jsonBytes))
	}()

	return promise
}

// jsGoStreamChat performs a streaming OpenRouter chat call.
// Args: messagesJSON (string), systemPrompt (string), onChunk (JS callback function)
// Returns: Promise<string> with the full accumulated response
func jsGoStreamChat(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return ErrorResult("goStreamChat: messagesJSON, systemPrompt, and onChunk callback required")
	}

	messagesJSON := args[0].String()
	systemPrompt := ""
	if !args[1].IsUndefined() && !args[1].IsNull() {
		systemPrompt = args[1].String()
	}
	onChunkJS := args[2]
	onReasoningJS := js.Undefined()
	if len(args) > 3 && args[3].Type() == js.TypeFunction {
		onReasoningJS = args[3]
	}

	promise, resolve, reject := makePromise()

	go func() {
		if batchSvc == nil {
			reject.Invoke(js.Global().Get("Error").New("goStreamChat: batch service not initialized (call batchInit first)"))
			return
		}

		fullResponse, err := batchSvc.StreamChat(messagesJSON, systemPrompt, func(chunk string) {
			// Call the JS onChunk callback with each delta
			onChunkJS.Invoke(chunk)
		}, func(reasoning string) {
			if onReasoningJS.Truthy() {
				onReasoningJS.Invoke(reasoning)
			}
		})

		if err != nil {
			reject.Invoke(js.Global().Get("Error").New(fmt.Sprintf("goStreamChat: %v", err)))
			return
		}

		resolve.Invoke(fullResponse)
	}()

	return promise
}

// =============================================================================
// Phase 7: Observational Memory + Chat Service Bridge
// =============================================================================

// jsChatInit initializes the chat service.
// Args: configJSON (string) - JSON with apiKey, model (optional, for future use)
func jsChatInit(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("missing arguments")
	}

	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	// Initialize Chat Service
	// We need agentSvc for the Observational Memory
	if agentSvc == nil {
		fmt.Println("[GoKitt] Warning: Agent service not initialized before Chat service. OM disabled.")
	}
	chatSvc = chat.NewChatService(sqlStore, agentSvc)

	return SuccessResult("Chat service initialized")
}

// jsChatCreateThread creates a new chat thread.
// Args: worldID, narrativeID (strings)
func jsChatCreateThread(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 2 {
		return ErrorResult("missing arguments")
	}

	thread, err := chatSvc.CreateThread(args[0].String(), args[1].String())
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(thread)
	return string(jsonBytes)
}

// jsChatGetThread retrieves a thread by ID.
// Args: id (string)
func jsChatGetThread(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments")
	}

	thread, err := chatSvc.GetThread(args[0].String())
	if err != nil {
		return ErrorResult(err.Error())
	}
	if thread == nil {
		return js.Null()
	}

	jsonBytes, _ := json.Marshal(thread)
	return string(jsonBytes)
}

// jsChatListThreads lists threads, optionally filtered by worldID.
// Args: worldID (string, optional)
func jsChatListThreads(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}

	worldID := ""
	if len(args) > 0 {
		worldID = args[0].String()
	}

	threads, err := chatSvc.ListThreads(worldID)
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(threads)
	return string(jsonBytes)
}

// jsChatDeleteThread deletes a thread.
// Args: id (string)
func jsChatDeleteThread(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments")
	}

	if err := chatSvc.DeleteThread(args[0].String()); err != nil {
		return ErrorResult(err.Error())
	}

	return SuccessResult("Thread deleted")
}

// jsChatAddMessage adds a message to a thread.
// Args: threadID, role, content, narrativeID (strings)
func jsChatAddMessage(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 4 {
		return ErrorResult("missing arguments")
	}

	msg, err := chatSvc.AddMessage(
		args[0].String(), // threadID
		args[1].String(), // role
		args[2].String(), // content
		args[3].String(), // narrativeID
	)
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(msg)
	return string(jsonBytes)
}

// jsChatGetMessages retrieves messages for a thread.
// Args: threadID (string)
func jsChatGetMessages(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments")
	}

	msgs, err := chatSvc.GetMessages(args[0].String())
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(msgs)
	return string(jsonBytes)
}

// jsChatUpdateMessage updates message content.
// Args: messageID, content (strings)
func jsChatUpdateMessage(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 2 {
		return ErrorResult("missing arguments")
	}

	if err := chatSvc.UpdateMessage(args[0].String(), args[1].String()); err != nil {
		return ErrorResult(err.Error())
	}

	return SuccessResult("Message updated")
}

// jsChatAppendMessage appends content to a message.
// Args: messageID, chunk (strings)
func jsChatAppendMessage(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 2 {
		return ErrorResult("missing arguments")
	}

	if err := chatSvc.AppendMessageContent(args[0].String(), args[1].String()); err != nil {
		return ErrorResult(err.Error())
	}

	return SuccessResult("Message appended")
}

// jsChatStartStreaming creates a new streaming assistant message.
// Args: threadID, narrativeID (strings)
func jsChatStartStreaming(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 2 {
		return ErrorResult("missing arguments")
	}

	msg, err := chatSvc.StartStreamingMessage(args[0].String(), args[1].String())
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(msg)
	return string(jsonBytes)
}

// jsChatGetMemories retrieves memories for a thread.
// Args: threadID (string)
func jsChatGetMemories(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments")
	}

	memories, err := chatSvc.GetMemories(args[0].String())
	if err != nil {
		return ErrorResult(err.Error())
	}

	jsonBytes, _ := json.Marshal(memories)
	return string(jsonBytes)
}

// jsChatGetContext retrieves context string (with memories and observations) for a thread.
// Args: threadID (string)
func jsChatGetContext(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments")
	}

	threadID := args[0].String()

	// Get memories context
	memories, err := chatSvc.GetMemories(threadID)
	if err != nil {
		return ErrorResult(err.Error())
	}

	// Get Observational Memory context
	omRecord, err := chatSvc.GetOMRecord(threadID)
	if err != nil {
		fmt.Printf("[WASM] Error getting OM Record: %v\n", err)
		// Don't fail the whole request, just omit OM data
	}

	response := map[string]interface{}{
		"memories": memories,
		"om":       omRecord,
	}

	jsonBytes, _ := json.Marshal(response)
	return string(jsonBytes)
}

// jsChatClearThread clears all messages in a thread.
// Args: threadID (string)
func jsChatClearThread(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments")
	}

	if err := chatSvc.ClearThread(args[0].String()); err != nil {
		return ErrorResult(err.Error())
	}

	return SuccessResult("Thread cleared")
}

// jsChatExportThread exports thread messages as JSON.
// Args: threadID (string)
func jsChatExportThread(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("missing arguments")
	}

	jsonStr, err := chatSvc.ExportThread(args[0].String())
	if err != nil {
		return ErrorResult(err.Error())
	}

	return jsonStr
}

// jsChatProcessWithWorkspace runs the OM loop and, if a miss signal fires,
// activates the workspace to resurface lost context from notes/episodes.
// Args: threadID (string), scopeID (string), userPrompt (string)
// Returns: JSON-encoded ActivationResult
func jsChatProcessWithWorkspace(this js.Value, args []js.Value) interface{} {
	if chatSvc == nil {
		return ErrorResult("chat service not initialized")
	}
	if len(args) < 3 {
		return ErrorResult("missing arguments: threadID, scopeID, userPrompt")
	}

	threadID := args[0].String()
	scopeID := args[1].String()
	userPrompt := args[2].String()

	result, err := chatSvc.ProcessWithWorkspace(context.Background(), threadID, scopeID, userPrompt)
	if err != nil {
		fmt.Printf("[WASM] ProcessWithWorkspace error: %v\n", err)
		return ErrorResult(err.Error())
	}

	jsonBytes, err := json.Marshal(result)
	if err != nil {
		return ErrorResult("json marshal: " + err.Error())
	}
	return string(jsonBytes)
}
