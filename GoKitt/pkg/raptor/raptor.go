// Package raptor implements RAPTOR-style hierarchical document retrieval.
// RAPTOR-lite hard: internal nodes are for semantic routing, but only leaf chunks
// can become results (hard gating stays intact).
package raptor

import (
	"github.com/kittclouds/gokitt/pkg/chunker"
	"github.com/kittclouds/gokitt/pkg/gdr"
	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// NodeType distinguishes leaf chunks from internal routing nodes.
type NodeType uint8

const (
	NodeTypeLeaf     NodeType = 0 // Leaf chunk (retrieval unit)
	NodeTypeInternal NodeType = 1 // Internal node (routing/context only)
	NodeTypeRoot     NodeType = 2 // Document root (routing only)
)

// RaptorNode represents a node in the RAPTOR tree.
type RaptorNode struct {
	ID       uint32    // Node ID (from shared ID authority)
	DocID    string    // Source document ID
	Type     NodeType  // Leaf, Internal, or Root
	Level    int       // Tree level (0 = leaf, higher = closer to root)
	Start    int       // Byte offset in original doc (leaves only)
	End      int       // End offset (leaves only)
	Text     string    // Chunk text (leaf) or summary (internal)
	Vector   []float32 // Embedding vector
	ParentID uint32    // Parent node ID (0 if root)
	ChildIDs []uint32  // Child node IDs
}

// RaptorTree holds the hierarchical RAPTOR structure for a document.
type RaptorTree struct {
	DocID      string
	RootID     uint32
	Nodes      map[uint32]*RaptorNode // All nodes by ID
	Leaves     []uint32               // Leaf node IDs (retrieval units)
	Internal   []uint32               // Internal node IDs (routing)
	Dimensions []int                  // Embedding dimensions present
}

// RaptorConfig holds configuration for RAPTOR indexing.
type RaptorConfig struct {
	// Chunking
	ChunkSize int // Approx bytes per leaf chunk (default: 512)
	Overlap   int // Overlap between chunks (default: 128)

	// Semantic Chunking
	SemanticChunking bool // Use semantic chunker instead of regex

	// Tree building
	MaxLevel      int    // Max tree depth (default: 3)
	ClusterMin    int    // Min nodes per cluster (default: 3)
	SummaryMethod string // "extractive" or "llm" (default: "extractive")

	// Hybrid integration
	GDRConfig gdr.GDRConfig

	// Retrieval
	MinRouterK int // Minimum number of parent nodes to route to (default: 50)
}

// DefaultRaptorConfig returns sane defaults.
func DefaultRaptorConfig() RaptorConfig {
	return RaptorConfig{
		ChunkSize:        512,
		Overlap:          128,
		SemanticChunking: false,
		MaxLevel:         3,
		ClusterMin:       3,
		SummaryMethod:    "extractive",
		GDRConfig:        gdr.DefaultGDRConfig(),
		MinRouterK:       50,
	}
}

// StagedChunk holds a chunk awaiting embedding from JS.
type StagedChunk struct {
	ID    uint32
	DocID string
	Start int
	End   int
	Text  string
}

// RaptorIndex manages hierarchical document retrieval.
// It integrates with the hybrid index for leaf-level hard search.
type RaptorIndex struct {
	config RaptorConfig

	// Shared ID authority (same as hybrid index)
	mapper *qgram.DocIDMapper

	// Trees per document
	trees map[string]*RaptorTree // docID -> tree

	// Hybrid index for leaf search
	gdr *gdr.GateDrivenRetriever

	// Chunker for leaf splitting
	chunker chunker.DocumentChunker

	// Node storage (all nodes across all docs)
	nodes map[uint32]*RaptorNode

	// Dimension router for internal nodes
	internalVec *gdr.DimensionRouter

	// Embedding provider for semantic chunking
	embedder chunker.Embedder

	// SAB staging area: chunks waiting for embeddings
	stagedChunks map[string][]StagedChunk // docID -> staged chunks
}

// NewRaptorIndex creates a new RAPTOR index.
func NewRaptorIndex(config RaptorConfig) *RaptorIndex {
	var c chunker.DocumentChunker

	// Default to regex chunker. Semantic needs an embedder injected via SetEmbedder
	c = chunker.NewChunker(config.ChunkSize, config.Overlap, nil, true, false)

	return &RaptorIndex{
		config:       config,
		mapper:       qgram.NewDocIDMapper(),
		trees:        make(map[string]*RaptorTree),
		chunker:      c,
		nodes:        make(map[uint32]*RaptorNode),
		internalVec:  gdr.NewDimensionRouter(config.GDRConfig.M, config.GDRConfig.EfConstruction, hnsw.Cosine),
		stagedChunks: make(map[string][]StagedChunk),
	}
}

// SetEmbedder sets the embedder for semantic operations.
// If SemanticChunking is enabled, it re-initializes the chunker.
func (ri *RaptorIndex) SetEmbedder(emb chunker.Embedder) {
	ri.embedder = emb
	if ri.config.SemanticChunking && emb != nil {
		ri.chunker = chunker.NewSemanticChunker(emb, 100, ri.config.ChunkSize, ri.config.Overlap)
	}
}

// NewRaptorIndexWithGDR creates a RAPTOR index that shares the hybrid index's ID space.
func NewRaptorIndexWithGDR(config RaptorConfig, retriever *gdr.GateDrivenRetriever) *RaptorIndex {
	ri := NewRaptorIndex(config)
	ri.gdr = retriever
	ri.mapper = retriever.Mapper
	return ri
}

// UpsertLeaf re-indexes a leaf node in the hybrid index.
func (ri *RaptorIndex) UpsertLeaf(node *RaptorNode) {
	if ri.gdr != nil && node.Type == NodeTypeLeaf {
		fields := map[string]string{"content": node.Text}
		chunkKey := ri.chunkKey(node.DocID, node.Start, node.End)
		ri.gdr.Upsert(chunkKey, fields, node.Vector)
	}
}

// IngestDocument chunks a document and indexes the leaves.
// This is R1: leaf-only indexing with hard hybrid search.
// Tree building (R2) is a separate step.
func (ri *RaptorIndex) IngestDocument(docID string, text string, vecFn func(text string) []float32) (*RaptorTree, error) {
	// 1. Chunk document into leaves
	tree := ri.chunkDocument(docID, text)

	// 2. Index each leaf in hybrid index
	for _, leafID := range tree.Leaves {
		node := tree.Nodes[leafID]
		if node == nil {
			continue
		}

		// Get embedding
		if vecFn != nil {
			node.Vector = vecFn(node.Text)
		}

		// Index in hybrid (lexical + vector)
		if ri.gdr != nil {
			fields := map[string]string{"content": node.Text}
			// Use chunk key as docID for hybrid index
			chunkKey := ri.chunkKey(docID, node.Start, node.End)
			ri.gdr.Upsert(chunkKey, fields, node.Vector)
		}
	}

	// 3. Store tree
	ri.trees[docID] = tree

	return tree, nil
}

// IngestChunks manually ingests pre-chunked text as leaf nodes for a document.
// This bypasses the internal chunker, useful for client-side semantic chunking.
func (ri *RaptorIndex) IngestChunks(docID string, chunks []string, embeddings [][]float32) (*RaptorTree, error) {
	tree := &RaptorTree{
		DocID:  docID,
		Nodes:  make(map[uint32]*RaptorNode),
		Leaves: make([]uint32, 0, len(chunks)),
	}

	for i, text := range chunks {
		// Create leaf node
		// Generate ID using shared mapper (use chunk key as abstract docID)
		// We use a synthetic range since we don't have exact offsets from client
		// But we need unique keys. Let's use idx * 10.
		start := i * 10
		end := start + 10
		chunkKey := ri.chunkKey(docID, start, end)
		id := ri.mapper.GetOrAssign(chunkKey)

		var vec []float32
		if i < len(embeddings) {
			vec = embeddings[i]
		}

		node := &RaptorNode{
			ID:       id,
			DocID:    docID,
			Type:     NodeTypeLeaf,
			Level:    0,
			Start:    start,
			End:      end,
			Text:     text,
			Vector:   vec,
			ParentID: 0,
		}

		tree.Nodes[id] = node
		tree.Leaves = append(tree.Leaves, id)
		ri.nodes[id] = node

		// Index in hybrid (lexical + vector)
		if ri.gdr != nil {
			fields := map[string]string{"content": text}
			ri.gdr.Upsert(chunkKey, fields, vec)
		}
	}

	// Track dimensions from first chunk
	if len(tree.Leaves) > 0 {
		firstNode := tree.Nodes[tree.Leaves[0]]
		if firstNode != nil && len(firstNode.Vector) > 0 {
			tree.Dimensions = append(tree.Dimensions, len(firstNode.Vector))
		}
	}

	// Store tree
	ri.trees[docID] = tree

	return tree, nil
}

// SegmentSpan represents a text segment with offsets.
type SegmentSpan struct {
	Text  string
	Start int
	End   int
}

// GetEmbeddableSpans returns text segments with offsets if using semantic chunker.
func (ri *RaptorIndex) GetEmbeddableSpans(text string) ([]SegmentSpan, error) {
	if sc, ok := ri.chunker.(*chunker.SemanticChunker); ok {
		// Convert chunker.SegmentSpan (internal) to local type?
		// No, we need to import or alias.
		// Raptor imports chunker.
		// But chunker.SegmentSpan is not exported? Wait, I exported it.
		// "type SegmentSpan struct" in chunker/semantic_chunker.go

		spans, err := sc.GetEmbeddableSpans(text)
		if err != nil {
			return nil, err
		}

		out := make([]SegmentSpan, len(spans))
		for i, s := range spans {
			out[i] = SegmentSpan{
				Text:  s.Text,
				Start: s.Start,
				End:   s.End,
			}
		}
		return out, nil
	}
	return nil, nil // Not using semantic chunker
}

// GetEmbeddableSegments returns text segments if using semantic chunker.
func (ri *RaptorIndex) GetEmbeddableSegments(text string) ([]string, error) {
	if sc, ok := ri.chunker.(*chunker.SemanticChunker); ok {
		return sc.GetEmbeddableSegments(text)
	}
	return nil, nil // Not using semantic chunker
}

// chunkDocument splits a document into leaf chunks.
func (ri *RaptorIndex) chunkDocument(docID, text string) *RaptorTree {
	// Use chunker to split
	chunkTree, err := ri.chunker.ChunkDocument(docID, text)
	if err != nil {
		// Fallback to regex chunker or empty?
		// For now, return empty tree
		return &RaptorTree{
			DocID:  docID,
			Nodes:  make(map[uint32]*RaptorNode),
			Leaves: nil,
		}
	}

	tree := &RaptorTree{
		DocID:  docID,
		Nodes:  make(map[uint32]*RaptorNode),
		Leaves: make([]uint32, 0, len(chunkTree.Leaves)),
	}

	// Convert chunker.Chunk to RaptorNode
	for _, ch := range chunkTree.Leaves {
		node := &RaptorNode{
			ID:       ch.ID,
			DocID:    ch.DocID,
			Type:     NodeTypeLeaf,
			Level:    0,
			Start:    ch.Start,
			End:      ch.End,
			Text:     ch.Text,
			ParentID: ch.ParentID,
		}
		tree.Nodes[ch.ID] = node
		tree.Leaves = append(tree.Leaves, ch.ID)
		ri.nodes[ch.ID] = node
	}

	// Track dimensions
	if len(tree.Leaves) > 0 {
		firstNode := tree.Nodes[tree.Leaves[0]]
		if firstNode != nil && len(firstNode.Vector) > 0 {
			tree.Dimensions = append(tree.Dimensions, len(firstNode.Vector))
		}
	}

	return tree
}

// chunkKey generates a unique key for a chunk in the hybrid index.
func (ri *RaptorIndex) chunkKey(docID string, start, end int) string {
	// Format: "chunk:docID:start:end"
	return "chunk:" + docID + ":" + intToStr(start) + ":" + intToStr(end)
}

// Search performs RAPTOR collapsed-tree retrieval.
// R3: Router pass (internal nodes) → Hard leaf pass (filtered HNSW) → Context expansion.
func (ri *RaptorIndex) Search(query string, queryVec []float32, k int) []RaptorResult {
	if ri.gdr == nil {
		return nil
	}

	// For R1 (leaf-only), just do hybrid search on leaves
	// R3 (collapsed-tree) will add internal node routing
	results := ri.gdr.Search(gdr.SearchInput{
		TextQuery: query,
		Vector:    queryVec,
	}, ri.config.GDRConfig)

	// Convert to RaptorResult
	out := make([]RaptorResult, 0, len(results))
	for _, hr := range results {
		// Parse chunk key to get docID and offsets
		docID, start, end := parseChunkKey(hr.DocID)
		out = append(out, RaptorResult{
			DocID:    docID,
			ChunkID:  hr.DocID,
			Start:    start,
			End:      end,
			Score:    hr.Score,
			LexScore: hr.LexScore,
			VecScore: hr.VecScore,
		})
	}

	return out
}

// RaptorResult represents a search result from RAPTOR retrieval.
type RaptorResult struct {
	DocID    string  // Source document ID
	ChunkID  string  // Chunk key in hybrid index
	Start    int     // Byte offset in original doc
	End      int     // End offset
	Score    float64 // Combined score
	LexScore float64 // Lexical score
	VecScore float32 // Vector similarity
}

// GetTree returns the RAPTOR tree for a document.
func (ri *RaptorIndex) GetTree(docID string) *RaptorTree {
	return ri.trees[docID]
}

// GetAllTrees returns all RAPTOR trees.
func (ri *RaptorIndex) GetAllTrees() map[string]*RaptorTree {
	return ri.trees
}

// GetNode returns a node by ID.
func (ri *RaptorIndex) GetNode(id uint32) *RaptorNode {
	return ri.nodes[id]
}

// LeafCount returns the total number of leaf chunks across all documents.
func (ri *RaptorIndex) LeafCount() int {
	count := 0
	for _, tree := range ri.trees {
		count += len(tree.Leaves)
	}
	return count
}

// DocCount returns the number of indexed documents.
func (ri *RaptorIndex) DocCount() int {
	return len(ri.trees)
}

// StageChunks chunks a document using the Go chunker and parks the results.
// Returns the staged chunks (with text for JS to embed).
// This is phase 1 of the SAB ping-pong flow.
func (ri *RaptorIndex) StageChunks(docID, text string) []StagedChunk {
	// Use internal chunker to split
	chunkTree, err := ri.chunker.ChunkDocument(docID, text)
	if err != nil || len(chunkTree.Leaves) == 0 {
		return nil
	}

	staged := make([]StagedChunk, 0, len(chunkTree.Leaves))
	for _, ch := range chunkTree.Leaves {
		staged = append(staged, StagedChunk{
			ID:    ch.ID,
			DocID: docID,
			Start: ch.Start,
			End:   ch.End,
			Text:  ch.Text,
		})
	}

	// Park in staging area
	ri.stagedChunks[docID] = staged
	return staged
}

// IngestSAB completes ingestion using pre-staged chunks and embedding vectors.
// This is phase 2 of the SAB ping-pong flow.
// `embeddings` should have exactly len(stagedChunks[docID]) vectors.
func (ri *RaptorIndex) IngestSAB(docID string, embeddings [][]float32) (*RaptorTree, error) {
	staged, ok := ri.stagedChunks[docID]
	if !ok || len(staged) == 0 {
		return nil, nil
	}

	// Validate count
	if len(embeddings) != len(staged) {
		// Mismatch - still ingest what we can
		if len(embeddings) > len(staged) {
			embeddings = embeddings[:len(staged)]
		}
	}

	tree := &RaptorTree{
		DocID:  docID,
		Nodes:  make(map[uint32]*RaptorNode),
		Leaves: make([]uint32, 0, len(staged)),
	}

	for i, sc := range staged {
		var vec []float32
		if i < len(embeddings) {
			vec = embeddings[i]
		}

		chunkKey := ri.chunkKey(docID, sc.Start, sc.End)
		id := ri.mapper.GetOrAssign(chunkKey)

		node := &RaptorNode{
			ID:       id,
			DocID:    docID,
			Type:     NodeTypeLeaf,
			Level:    0,
			Start:    sc.Start,
			End:      sc.End,
			Text:     sc.Text,
			Vector:   vec,
			ParentID: 0,
		}

		tree.Nodes[id] = node
		tree.Leaves = append(tree.Leaves, id)
		ri.nodes[id] = node

		// Index in hybrid (lexical + vector)
		if ri.gdr != nil {
			fields := map[string]string{"content": sc.Text}
			ri.gdr.Upsert(chunkKey, fields, vec)
		}
	}

	// Track dimensions
	if len(tree.Leaves) > 0 {
		firstNode := tree.Nodes[tree.Leaves[0]]
		if firstNode != nil && len(firstNode.Vector) > 0 {
			tree.Dimensions = append(tree.Dimensions, len(firstNode.Vector))
		}
	}

	// Store tree
	ri.trees[docID] = tree

	// Clean up staging
	delete(ri.stagedChunks, docID)

	return tree, nil
}

// Helper functions

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [12]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// parseChunkKey extracts docID, start, end from a chunk key.
// Format: "chunk:docID:start:end"
func parseChunkKey(key string) (docID string, start, end int) {
	// Simple parsing - in production would be more robust
	parts := splitChunkKey(key)
	if len(parts) != 4 || parts[0] != "chunk" {
		return "", 0, 0
	}
	return parts[1], parseUint(parts[2]), parseUint(parts[3])
}

func splitChunkKey(key string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(key); i++ {
		if key[i] == ':' {
			parts = append(parts, key[start:i])
			start = i + 1
		}
	}
	parts = append(parts, key[start:])
	return parts
}

func parseUint(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}
