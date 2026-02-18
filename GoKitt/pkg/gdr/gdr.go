// Package gdr provides the Gate-Driven Retriever (GDR) combining lexical (qgram) and vector (HNSW) indexes.
package gdr

import (
	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// GDRScoreConfig controls score normalization for blending lexical and vector scores.
type GDRScoreConfig struct {
	Alpha      float64 // Vector weight (0.0-1.0, default: 0.3)
	LexicalCap float64 // Cap for lexical score normalization (default: 10.0)
	VecMin     float64 // Min cosine for normalization (default: -1.0)
	VecMax     float64 // Max cosine for normalization (default: 1.0)
}

// DefaultGDRScoreConfig returns sane defaults for score normalization.
func DefaultGDRScoreConfig() GDRScoreConfig {
	return GDRScoreConfig{
		Alpha:      0.3,
		LexicalCap: 10.0,
		VecMin:     -1.0,
		VecMax:     1.0,
	}
}

// GDRConfig holds configuration for the Gate-Driven Retriever.
type GDRConfig struct {
	// HNSW parameters
	M              int // Max neighbors per level (default: 16)
	EfConstruction int // Construction beam width (default: 200)
	EfSearch       int // Search beam width (default: 50)

	// Retrieval parameters
	K                 int  // Number of results to return
	Hard              bool // Hard mode: lexical gate required (default: true)
	GateMaxCandidates int  // Max candidates before gate becomes selective (default: 10000)

	// Expansion loop
	FetchCap        int // Max candidates to fetch from HNSW (default: 1000)
	ExpansionFactor int // Multiply k by this when re-fetching (default: 4)
	MaxExpansions   int // Max expansion iterations (default: 3)

	// Score normalization
	ScoreConfig GDRScoreConfig

	// Lexical config (passed through)
	LexicalConfig qgram.SearchConfig
}

// DefaultGDRConfig returns sane defaults for GDR search.
func DefaultGDRConfig() GDRConfig {
	return GDRConfig{
		M:                 16,
		EfConstruction:    200,
		EfSearch:          50,
		K:                 10,
		Hard:              true,
		GateMaxCandidates: 10000,
		FetchCap:          1000,
		ExpansionFactor:   4,
		MaxExpansions:     3,
		ScoreConfig:       DefaultGDRScoreConfig(),
		LexicalConfig:     qgram.DefaultSearchConfig(),
	}
}

// GDRResult represents a scored result from GDR search.
type GDRResult struct {
	DocID    string  // Document ID
	Score    float64 // Combined normalized score (for ranking)
	LexScore float64 // Raw lexical: BM25 + coverage + proximity
	VecScore float32 // Raw vector: cosine similarity
	LexNorm  float64 // Normalized lexical [0, 1]
	VecNorm  float64 // Normalized vector [0, 1]
	Coverage float64 // Fraction of clauses matched
}

// GateDrivenRetriever composes lexical (qgram) and vector (HNSW) indexes for hybrid search.
// The lexical index is authoritative for document metadata and verification.
// The HNSW index provides approximate nearest neighbor search for vectors.
// Both share the same DocIDMapper for consistent uint32 ID assignment.
type GateDrivenRetriever struct {
	Lex    *qgram.CompressedQGramIndex // Lexical index (authoritative for metadata)
	Vec    *DimensionRouter            // Multi-dimension HNSW router
	Mapper *qgram.DocIDMapper          // Alias to Lex.Mapper for convenience

	// Configuration
	Config GDRConfig
}

// NewGDR creates a new Gate-Driven Retriever with the given configuration.
func NewGDR(config GDRConfig) *GateDrivenRetriever {
	lex := qgram.NewCompressedQGramIndex(3) // Q=3 for trigrams
	vec := NewDimensionRouter(config.M, config.EfConstruction, hnsw.Cosine)

	return &GateDrivenRetriever{
		Lex:    lex,
		Vec:    vec,
		Mapper: lex.Mapper,
		Config: config,
	}
}

// NewGDRDefault creates a new GDR with default configuration.
func NewGDRDefault() *GateDrivenRetriever {
	return NewGDR(DefaultGDRConfig())
}

// Upsert adds or updates a document with both lexical content and vector embedding.
// The document is assigned a uint32 ID via the shared DocIDMapper, then indexed
// in both the lexical index and the appropriate HNSW dimension index.
func (gdr *GateDrivenRetriever) Upsert(docID string, fields map[string]string, vec []float32) error {
	return gdr.UpsertScoped(docID, fields, vec, "", "")
}

// UpsertScoped adds or updates a document with scope metadata (narrativeID, folderPath).
func (gdr *GateDrivenRetriever) UpsertScoped(docID string, fields map[string]string, vec []float32, narrativeID, folderPath string) error {
	// 1. Get or assign uint32 ID from shared mapper
	uid := gdr.Lex.Mapper.GetOrAssign(docID)

	// 2. Index in lexical (existing API)
	gdr.Lex.IndexDocumentScoped(docID, fields, narrativeID, folderPath)

	// 3. Route to correct dimension HNSW (if vector provided)
	// Use UpsertPoint to handle updates (replaces existing vector)
	if len(vec) > 0 {
		if err := gdr.Vec.UpsertPoint(uid, vec); err != nil {
			return err
		}
	}

	return nil
}

// Delete removes a document from both indexes.
// This is a lazy delete: marks the docID in the lexical Deleted bitmap
// and sets the Deleted flag on the HNSW node (tombstone).
func (gdr *GateDrivenRetriever) Delete(docID string) {
	uid := gdr.Lex.Mapper.Get(docID)
	if uid == 0 {
		return // Not found
	}

	// 1. Lazy delete in lexical (sets Deleted bitmap)
	gdr.Lex.LazyDelete(docID)

	// 2. Soft delete in all HNSW indexes (tombstone)
	gdr.Vec.DeletePointAll(uid)
}

// DeleteHard performs immediate (non-lazy) removal from all indexes.
// Use Delete() for the fast lazy-delete path in production.
func (gdr *GateDrivenRetriever) DeleteHard(docID string) {
	uid := gdr.Lex.Mapper.Get(docID)
	if uid == 0 {
		return
	}

	// Hard delete from lexical
	gdr.Lex.RemoveDocumentHard(docID)

	// Note: HNSW doesn't have hard delete, only soft delete
	// The node will remain but marked as deleted
	gdr.Vec.DeletePointAll(uid)
}

// GetDocument returns the document info for a given docID.
func (gdr *GateDrivenRetriever) GetDocument(docID string) (qgram.DocumentInfo, bool) {
	doc, ok := gdr.Lex.Documents[docID]
	return doc, ok
}

// GetVector returns the vector for a document from the appropriate HNSW index.
// Returns nil, false if the document has no vector or dimension doesn't match.
func (gdr *GateDrivenRetriever) GetVector(docID string, dim int) ([]float32, bool) {
	uid := gdr.Lex.Mapper.Get(docID)
	if uid == 0 {
		return nil, false
	}
	return gdr.Vec.GetVector(dim, uid)
}

// Len returns the number of documents in the lexical index.
func (gdr *GateDrivenRetriever) Len() int {
	return len(gdr.Lex.Documents)
}

// HasVector returns true if the document has a vector in the given dimension.
func (gdr *GateDrivenRetriever) HasVector(docID string, dim int) bool {
	uid := gdr.Lex.Mapper.Get(docID)
	if uid == 0 {
		return false
	}
	_, ok := gdr.Vec.GetVector(dim, uid)
	return ok
}

// GetCorpusStats returns corpus statistics from the lexical index.
func (gdr *GateDrivenRetriever) GetCorpusStats() qgram.CorpusStats {
	return gdr.Lex.GetCorpusStats()
}

// Compact purges all lazy-deleted documents from posting lists.
// Call this periodically to reclaim memory from deleted docs.
func (gdr *GateDrivenRetriever) Compact() {
	gdr.Lex.Compact()
}
