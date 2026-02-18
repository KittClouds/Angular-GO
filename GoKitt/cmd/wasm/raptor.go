//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/kittclouds/gokitt/pkg/gdr"
	"github.com/kittclouds/gokitt/pkg/raptor"
)

// Global RAPTOR index
var raptorIndex *raptor.RaptorIndex
var raptorRetriever *raptor.CollapsedRetriever

// raptorInit initializes the RAPTOR index with configuration.
// Args: [configJSON string (optional)]
func raptorInit(this js.Value, args []js.Value) interface{} {
	config := raptor.DefaultRaptorConfig()

	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		var cfg struct {
			ChunkSize        int  `json:"chunkSize"`
			Overlap          int  `json:"overlap"`
			MaxLevel         int  `json:"maxLevel"`
			MinRouterK       int  `json:"minRouterK"`
			SemanticChunking bool `json:"semanticChunking"`
		}
		if err := json.Unmarshal([]byte(args[0].String()), &cfg); err == nil {
			if cfg.ChunkSize > 0 {
				config.ChunkSize = cfg.ChunkSize
			}
			if cfg.Overlap > 0 {
				config.Overlap = cfg.Overlap
			}
			if cfg.MaxLevel > 0 {
				config.MaxLevel = cfg.MaxLevel
			}
			if cfg.MinRouterK > 0 {
				config.MinRouterK = cfg.MinRouterK
			}
			config.SemanticChunking = cfg.SemanticChunking
		}
	}

	// Create GDR for RAPTOR
	retriever := gdr.NewGDR(config.GDRConfig)
	raptorIndex = raptor.NewRaptorIndexWithGDR(config, retriever)
	raptorRetriever = raptor.NewCollapsedRetriever(raptorIndex)

	return SuccessResult("raptor initialized")
}

// raptorBuildTree builds the RAPTOR tree from ingested documents.
// Args: [embeddingsJSON string (optional, for internal nodes)]
func raptorBuildTree(this js.Value, args []js.Value) interface{} {
	if raptorIndex == nil {
		return ErrorResult("raptor not initialized")
	}

	// Optional embeddings for internal nodes
	var embedFn func(string) []float32
	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		var embeddings [][]float32
		if err := json.Unmarshal([]byte(args[0].String()), &embeddings); err == nil {
			embedIdx := 0
			embedFn = func(text string) []float32 {
				if embedIdx < len(embeddings) {
					vec := embeddings[embedIdx]
					embedIdx++
					return vec
				}
				return nil
			}
		}
	}

	// Build tree for each document
	tb := raptor.NewTreeBuilder(raptor.DefaultTreeBuilderConfig())
	for _, tree := range raptorIndex.GetAllTrees() {
		if tree != nil {
			tb.Build(tree, embedFn)
		}
	}

	return SuccessResult("tree built")
}

// raptorSearch performs collapsed-tree retrieval.
// Args: [query string, queryEmbeddingJSON string, k int]
func raptorSearch(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return ErrorResult("requires 3 args: query, queryEmbeddingJSON, k")
	}

	if raptorRetriever == nil {
		return ErrorResult("raptor not initialized")
	}

	query := args[0].String()

	// Parse query embedding
	var queryVec []float32
	if err := json.Unmarshal([]byte(args[1].String()), &queryVec); err != nil {
		return ErrorResult("query embedding json: " + err.Error())
	}

	k := args[2].Int()

	// Search
	results := raptorRetriever.Search(query, queryVec, k)

	// Convert to JSON
	type Result struct {
		DocID       string  `json:"docId"`
		ChunkID     string  `json:"chunkId"`
		ChunkKey    string  `json:"chunkKey"`
		Start       int     `json:"start"`
		End         int     `json:"end"`
		Score       float64 `json:"score"`
		LexScore    float64 `json:"lexScore"`
		VecScore    float32 `json:"vecScore"`
		RouterScore float64 `json:"routerScore,omitempty"`
		ParentID    uint32  `json:"parentId,omitempty"`
		ParentText  string  `json:"parentText,omitempty"`
	}

	out := make([]Result, len(results))
	for i, r := range results {
		out[i] = Result{
			DocID:       r.DocID,
			ChunkID:     r.ChunkKey,
			ChunkKey:    r.ChunkKey,
			Start:       r.Start,
			End:         r.End,
			Score:       r.Score,
			LexScore:    r.LexScore,
			VecScore:    r.VecScore,
			RouterScore: r.RouterScore,
			ParentID:    r.ParentID,
			ParentText:  r.ParentText,
		}
	}

	jsonBytes, _ := json.Marshal(out)
	return string(jsonBytes)
}

// raptorSearchAggregated performs search with doc-level aggregation.
// Args: [query string, queryEmbeddingJSON string, k int]
func raptorSearchAggregated(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return ErrorResult("requires 3 args: query, queryEmbeddingJSON, k")
	}

	if raptorRetriever == nil {
		return ErrorResult("raptor not initialized")
	}

	query := args[0].String()

	var queryVec []float32
	if err := json.Unmarshal([]byte(args[1].String()), &queryVec); err != nil {
		return ErrorResult("query embedding json: " + err.Error())
	}

	k := args[2].Int()

	// Search with aggregation
	docs := raptorRetriever.SearchWithAggregation(query, queryVec, k)

	// Convert to JSON
	type Chunk struct {
		DocID       string  `json:"docId"`
		ChunkID     string  `json:"chunkId"`
		ChunkKey    string  `json:"chunkKey"`
		Start       int     `json:"start"`
		End         int     `json:"end"`
		Score       float64 `json:"score"`
		LexScore    float64 `json:"lexScore"`
		VecScore    float32 `json:"vecScore"`
		RouterScore float64 `json:"routerScore,omitempty"`
	}

	type DocResult struct {
		DocID    string  `json:"docId"`
		MaxScore float64 `json:"maxScore"`
		Chunks   []Chunk `json:"chunks"`
	}

	out := make([]DocResult, len(docs))
	for i, d := range docs {
		out[i].DocID = d.DocID
		out[i].MaxScore = d.MaxScore
		out[i].Chunks = make([]Chunk, len(d.Chunks))
		for j, c := range d.Chunks {
			out[i].Chunks[j] = Chunk{
				DocID:       c.DocID,
				ChunkID:     c.ChunkKey,
				ChunkKey:    c.ChunkKey,
				Start:       c.Start,
				End:         c.End,
				Score:       c.Score,
				LexScore:    c.LexScore,
				VecScore:    c.VecScore,
				RouterScore: c.RouterScore,
			}
		}
	}

	jsonBytes, _ := json.Marshal(out)
	return string(jsonBytes)
}

// raptorGetStats returns statistics about the RAPTOR index.
func raptorGetStats(this js.Value, args []js.Value) interface{} {
	if raptorIndex == nil {
		return ErrorResult("raptor not initialized")
	}

	stats := map[string]interface{}{
		"docCount":  raptorIndex.DocCount(),
		"leafCount": raptorIndex.LeafCount(),
		"treeCount": len(raptorIndex.GetAllTrees()),
	}

	jsonBytes, _ := json.Marshal(stats)
	return string(jsonBytes)
}

// raptorClear clears the RAPTOR index.
func raptorClear(this js.Value, args []js.Value) interface{} {
	if raptorIndex != nil {
		raptorIndex = nil
		raptorRetriever = nil
	}
	return SuccessResult("raptor cleared")
}

// raptorSearchLeafOnly performs leaf-only search (no tree routing).
// Args: [query string, queryEmbeddingJSON string, k int]
func raptorSearchLeafOnly(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return ErrorResult("requires 3 args: query, queryEmbeddingJSON, k")
	}

	if raptorIndex == nil {
		return ErrorResult("raptor not initialized")
	}

	query := args[0].String()

	var queryVec []float32
	if err := json.Unmarshal([]byte(args[1].String()), &queryVec); err != nil {
		return ErrorResult("query embedding json: " + err.Error())
	}

	k := args[2].Int()

	// Direct search on hybrid index (leaf-only)
	results := raptorIndex.Search(query, queryVec, k)

	// Convert to JSON
	type Result struct {
		DocID    string  `json:"docId"`
		ChunkID  string  `json:"chunkId"`
		Start    int     `json:"start"`
		End      int     `json:"end"`
		Score    float64 `json:"score"`
		LexScore float64 `json:"lexScore"`
		VecScore float32 `json:"vecScore"`
	}

	out := make([]Result, len(results))
	for i, r := range results {
		out[i] = Result{
			DocID:    r.DocID,
			ChunkID:  r.ChunkID,
			Start:    r.Start,
			End:      r.End,
			Score:    r.Score,
			LexScore: r.LexScore,
			VecScore: r.VecScore,
		}
	}

	jsonBytes, _ := json.Marshal(out)
	return string(jsonBytes)
}

// raptorChunk splits text using the Go chunker and stages results for SAB ingest.
// Phase 1 of the SAB ping-pong flow.
// Args: [docID string, text string]
// Returns: JSON [{text, start, end}, ...] - chunk texts for JS to embed.
func raptorChunk(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return ErrorResult("requires 2 args: docID, text")
	}

	if raptorIndex == nil {
		return ErrorResult("raptor not initialized")
	}

	docID := args[0].String()
	text := args[1].String()

	// Stage chunks using Go chunker
	staged := raptorIndex.StageChunks(docID, text)
	if len(staged) == 0 {
		return ErrorResult("chunker produced 0 chunks for " + docID)
	}

	// Return lightweight JSON with chunk texts (for JS embedding)
	type ChunkInfo struct {
		Text  string `json:"text"`
		Start int    `json:"start"`
		End   int    `json:"end"`
	}

	out := make([]ChunkInfo, len(staged))
	for i, sc := range staged {
		out[i] = ChunkInfo{
			Text:  sc.Text,
			Start: sc.Start,
			End:   sc.End,
		}
	}

	jsonBytes, _ := json.Marshal(out)
	fmt.Printf("[GoKitt] raptorChunk: %s -> %d chunks staged\n", docID, len(staged))
	return string(jsonBytes)
}

// raptorIngestSAB completes ingestion by reading embeddings from SharedArrayBuffer.
// Phase 2 of the SAB ping-pong flow.
// Args: [docID string, count int, dim int]
// The SAB must contain the embeddings in the payload area:
// Layout: [count:u32][dim:u32][...flat float32s...]
func raptorIngestSAB(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return ErrorResult("requires 3 args: docID, count, dim")
	}

	if raptorIndex == nil {
		return ErrorResult("raptor not initialized")
	}

	if sharedBuffer == nil {
		return ErrorResult("SharedArrayBuffer not initialized - call sabInit first")
	}

	docID := args[0].String()
	count := args[1].Int()
	dim := args[2].Int()

	// Read embeddings from SAB
	embeddings, readCount, readDim := sharedBuffer.ReadEmbeddings()
	if embeddings == nil {
		return ErrorResult(fmt.Sprintf("failed to read embeddings from SAB (expected %dx%d)", count, dim))
	}

	// Validate
	if readCount != count || readDim != dim {
		fmt.Printf("[GoKitt] raptorIngestSAB: SAB header mismatch: expected %dx%d, got %dx%d\n", count, dim, readCount, readDim)
		// Use what we got
	}

	// Complete ingestion with staged chunks
	tree, err := raptorIndex.IngestSAB(docID, embeddings)
	if err != nil {
		return ErrorResult("ingest SAB: " + err.Error())
	}

	leafCount := 0
	if tree != nil {
		leafCount = len(tree.Leaves)
	}

	result := map[string]interface{}{
		"success":       true,
		"ingestedCount": leafCount,
		"dim":           readDim,
	}
	jsonBytes, _ := json.Marshal(result)
	fmt.Printf("[GoKitt] raptorIngestSAB: %s -> %d leaves ingested (%dd vectors)\n", docID, leafCount, readDim)
	return string(jsonBytes)
}
