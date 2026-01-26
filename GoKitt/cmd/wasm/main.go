//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"time"

	"github.com/kittclouds/gokitt/pkg/reality/builder"
	"github.com/kittclouds/gokitt/pkg/reality/projection"
	"github.com/kittclouds/gokitt/pkg/resorank"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
)

// Version info
const Version = "0.2.0"

// Global state
var pipeline *conductor.Conductor
var searcher *resorank.Scorer

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
		"indexDocument": js.FuncOf(indexDocument),
		"search":        js.FuncOf(search),
	}))

	select {}
}

// ... existing helpers ...

// indexDocument: [id string, metaJSON string, tokensJSON string]
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
	return successResult("indexed " + id)
}

// search: [queryJSON string, limit int]
func search(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return errorResult("requires 2 args: queryJSON, limit")
	}

	var query []string
	if err := json.Unmarshal([]byte(args[0].String()), &query); err != nil {
		return errorResult("query json: " + err.Error())
	}

	limit := args[1].Int()
	results := searcher.Search(query, limit)

	bytes, _ := json.Marshal(results)
	return string(bytes)
}

// ... existing helpers ...

// getVersion returns the module version
func getVersion(this js.Value, args []js.Value) interface{} {
	return Version
}

// initialize hydrates the scanner with entity data
// Args: [entitiesJSON string]
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

	// TODO: If we had entitiesJSON, we'd build the DAFSA here and call pipeline.SetDictionary()

	return successResult("initialized")
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

	duration := time.Since(start).Microseconds()

	// Wrap in a response object including timing
	response := map[string]interface{}{
		"scan":      result,
		"cst":       cstRoot,
		"graph":     conceptGraph,
		"timing_us": duration,
	}

	jsonBytes, err := json.Marshal(response)
	if err != nil {
		return errorResult(err.Error())
	}

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
