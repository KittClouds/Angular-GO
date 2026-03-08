package gdr

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/kittclouds/gokitt/pkg/qgram"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Helper to create a normalized vector
func makeVec(dim int, val float32) []float32 {
	vec := make([]float32, dim)
	for i := range vec {
		vec[i] = val
	}
	return vec
}

// TestIDConsistency verifies that uid assignment is consistent across indexes
func TestIDConsistency(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	// Upsert document
	vec := makeVec(256, 0.5)
	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, vec)
	require.NoError(t, err)

	// Verify uid assignment
	uid := gdr.Lex.Mapper.Get("doc1")
	assert.NotZero(t, uid)

	// Verify vector indexed under same uid
	retrieved, ok := gdr.Vec.GetVector(256, uid)
	assert.True(t, ok)
	assert.NotNil(t, retrieved)
	assert.Equal(t, vec, retrieved)

	// Query returns correct docID string
	results := gdr.SearchLexical("hello", DefaultGDRConfig())
	assert.Len(t, results, 1)
	assert.Equal(t, "doc1", results[0].DocID)
}

// TestHardConstraintPhraseMiss verifies that phrase misses are rejected despite high vector similarity
func TestHardConstraintPhraseMiss(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	// Index two documents with identical vectors
	vec := makeVec(256, 0.5)

	err := gdr.Upsert("doc1", map[string]string{"content": "machine learning algorithms"}, vec)
	require.NoError(t, err)

	err = gdr.Upsert("doc2", map[string]string{"content": "deep neural networks"}, vec)
	require.NoError(t, err)

	// Query with phrase that only matches doc1
	config := DefaultGDRConfig()
	config.LexicalConfig.PhraseHard = true

	results := gdr.Search(SearchInput{
		TextQuery: "\"machine learning\"",
		Vector:    vec,
	}, config)

	// Only doc1 should appear despite identical vectors
	assert.Len(t, results, 1)
	assert.Equal(t, "doc1", results[0].DocID)
}

// TestDeleteExclusion verifies that deleted documents are excluded from both indexes
func TestDeleteExclusion(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	vec := makeVec(256, 0.5)
	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, vec)
	require.NoError(t, err)

	// Verify document exists
	results := gdr.SearchLexical("hello", DefaultGDRConfig())
	assert.Len(t, results, 1)

	// Delete
	gdr.Delete("doc1")

	// Lexical gate should exclude via Deleted bitmap
	results = gdr.SearchLexical("hello", DefaultGDRConfig())
	assert.Len(t, results, 0)

	// HNSW should have tombstone
	uid := gdr.Lex.Mapper.Get("doc1")
	idx := gdr.Vec.GetIndex(256)
	require.NotNil(t, idx)
	node, ok := idx.Nodes[uid]
	assert.True(t, ok)
	assert.True(t, node.Deleted)
}

// TestDimensionRouter verifies separate indexes per dimension
func TestDimensionRouter(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	// 256D document
	vec256 := makeVec(256, 0.5)
	err := gdr.Upsert("doc256", map[string]string{"content": "hello world"}, vec256)
	require.NoError(t, err)

	// 384D document
	vec384 := makeVec(384, 0.5)
	err = gdr.Upsert("doc384", map[string]string{"content": "foo bar"}, vec384)
	require.NoError(t, err)

	// Verify separate indexes
	assert.Len(t, gdr.Vec.Indexes, 2)
	assert.NotNil(t, gdr.Vec.Indexes[256])
	assert.NotNil(t, gdr.Vec.Indexes[384])

	// Query with 256D vector should only search 256D index
	results := gdr.Search(SearchInput{
		TextQuery: "hello",
		Vector:    vec256,
	}, DefaultGDRConfig())
	assert.Len(t, results, 1)
	assert.Equal(t, "doc256", results[0].DocID)

	// Query with 384D vector should only search 384D index
	results = gdr.Search(SearchInput{
		TextQuery: "foo",
		Vector:    vec384,
	}, DefaultGDRConfig())
	assert.Len(t, results, 1)
	assert.Equal(t, "doc384", results[0].DocID)
}

// TestHybridScoring verifies the hybrid scoring blend
func TestHybridScoring(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	// Index documents with different content and vectors
	// Create vectors with orthogonal directions for clear similarity difference
	vec1 := make([]float32, 256)
	vec2 := make([]float32, 256)
	for i := range vec1 {
		if i < 128 {
			vec1[i] = 1.0 // First half high
			vec2[i] = 0.0 // First half low
		} else {
			vec1[i] = 0.0 // Second half low
			vec2[i] = 1.0 // Second half high
		}
	}

	err := gdr.Upsert("doc1", map[string]string{"content": "machine learning"}, vec1)
	require.NoError(t, err)

	err = gdr.Upsert("doc2", map[string]string{"content": "machine learning"}, vec2)
	require.NoError(t, err)

	// Query with vector similar to doc2 (second half high)
	queryVec := make([]float32, 256)
	for i := range queryVec {
		if i < 128 {
			queryVec[i] = 0.0
		} else {
			queryVec[i] = 1.0
		}
	}
	config := DefaultGDRConfig()
	config.ScoreConfig.Alpha = 0.5 // Equal weight

	results := gdr.Search(SearchInput{
		TextQuery: "machine",
		Vector:    queryVec,
	}, config)

	assert.Len(t, results, 2)

	// doc2 should rank higher due to higher vector similarity
	assert.Equal(t, "doc2", results[0].DocID)
	assert.Greater(t, results[0].VecScore, results[1].VecScore)
}

// TestLexicalOnlySearch verifies lexical-only search (no vector)
func TestLexicalOnlySearch(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, nil)
	require.NoError(t, err)

	err = gdr.Upsert("doc2", map[string]string{"content": "foo bar"}, nil)
	require.NoError(t, err)

	// Lexical-only search
	results := gdr.SearchLexical("hello", DefaultGDRConfig())
	assert.Len(t, results, 1)
	assert.Equal(t, "doc1", results[0].DocID)
}

// TestScopeFilter verifies scope filtering
func TestScopeFilter(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	vec := makeVec(256, 0.5)

	err := gdr.UpsertScoped("doc1", map[string]string{"content": "hello world"}, vec, "narrative1", "/folder1")
	require.NoError(t, err)

	err = gdr.UpsertScoped("doc2", map[string]string{"content": "hello world"}, vec, "narrative2", "/folder2")
	require.NoError(t, err)

	// Query with scope
	config := DefaultGDRConfig()
	config.LexicalConfig.Scope = &qgram.SearchScope{
		NarrativeID: "narrative1",
	}

	results := gdr.Search(SearchInput{
		TextQuery: "hello",
		Vector:    vec,
	}, config)

	assert.Len(t, results, 1)
	assert.Equal(t, "doc1", results[0].DocID)
}

// TestExpansionLoop verifies expansion when verification rejects candidates
func TestExpansionLoop(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	// Index many documents with same vector but different content
	vec := makeVec(256, 0.5)
	for i := 0; i < 100; i++ {
		content := "document number " + string(rune('0'+i%10))
		if i < 10 {
			content = "special document " + string(rune('0'+i))
		}
		err := gdr.Upsert(string(rune('a'+i%26))+string(rune('a'+i/26)), map[string]string{"content": content}, vec)
		require.NoError(t, err)
	}

	// Query with phrase that only matches few documents
	config := DefaultGDRConfig()
	config.K = 5
	config.LexicalConfig.PhraseHard = true

	results := gdr.Search(SearchInput{
		TextQuery: "\"special document\"",
		Vector:    vec,
	}, config)

	// Should return results despite many candidates being rejected
	assert.GreaterOrEqual(t, len(results), 1)
}

// TestGateBitmap verifies gate bitmap generation
func TestGateBitmap(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, nil)
	require.NoError(t, err)

	err = gdr.Upsert("doc2", map[string]string{"content": "hello foo"}, nil)
	require.NoError(t, err)

	err = gdr.Upsert("doc3", map[string]string{"content": "bar baz"}, nil)
	require.NoError(t, err)

	// Gate for "hello"
	clauses := qgram.ParseQuery("hello")
	gate := gdr.BuildGateBitmap(clauses, 1000)

	assert.Equal(t, uint64(2), gate.GateSize())
}

// TestMultipleClauses verifies multi-clause queries
func TestMultipleClauses(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	vec := makeVec(256, 0.5)

	err := gdr.Upsert("doc1", map[string]string{"content": "machine learning algorithms"}, vec)
	require.NoError(t, err)

	err = gdr.Upsert("doc2", map[string]string{"content": "deep learning networks"}, vec)
	require.NoError(t, err)

	err = gdr.Upsert("doc3", map[string]string{"content": "machine algorithms"}, vec)
	require.NoError(t, err)

	// Query with OR semantics (multiple terms)
	results := gdr.SearchLexical("machine learning", DefaultGDRConfig())

	// All docs with either term should appear
	assert.GreaterOrEqual(t, len(results), 2)
}

// TestUpsertUpdate verifies that upsert updates existing documents
func TestUpsertUpdate(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	// Initial insert
	vec1 := makeVec(256, 0.1)
	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, vec1)
	require.NoError(t, err)

	// Update with new content and vector
	vec2 := makeVec(256, 0.9)
	err = gdr.Upsert("doc1", map[string]string{"content": "foo bar"}, vec2)
	require.NoError(t, err)

	// Old content should not be found
	results := gdr.SearchLexical("hello", DefaultGDRConfig())
	assert.Len(t, results, 0)

	// New content should be found
	results = gdr.SearchLexical("foo", DefaultGDRConfig())
	assert.Len(t, results, 1)
	assert.Equal(t, "doc1", results[0].DocID)
}

// TestCount verifies count queries
func TestCount(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, nil)
	require.NoError(t, err)

	err = gdr.Upsert("doc2", map[string]string{"content": "hello foo"}, nil)
	require.NoError(t, err)

	err = gdr.Upsert("doc3", map[string]string{"content": "bar baz"}, nil)
	require.NoError(t, err)

	count := gdr.Count("hello")
	assert.Equal(t, 2, count)

	count = gdr.Count("bar")
	assert.Equal(t, 1, count)

	count = gdr.Count("nonexistent")
	assert.Equal(t, 0, count)
}

// TestEmptyQuery verifies handling of empty queries
func TestEmptyQuery(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, nil)
	require.NoError(t, err)

	results := gdr.SearchLexical("", DefaultGDRConfig())
	assert.Empty(t, results)
}

// TestNoResults verifies handling of queries with no matches
func TestNoResults(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, nil)
	require.NoError(t, err)

	results := gdr.SearchLexical("nonexistent", DefaultGDRConfig())
	assert.Empty(t, results)
}

// TestHybridIndexDefault verifies default configuration
func TestHybridIndexDefault(t *testing.T) {
	gdr := NewGDRDefault()

	assert.NotNil(t, gdr.Lex)
	assert.NotNil(t, gdr.Vec)
	assert.NotNil(t, gdr.Mapper)
	assert.Equal(t, gdr.Lex.Mapper, gdr.Mapper)
}

// TestGetDocument verifies document retrieval
func TestGetDocument(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	err := gdr.UpsertScoped("doc1", map[string]string{"content": "hello world"}, nil, "narrative1", "/folder1")
	require.NoError(t, err)

	doc, ok := gdr.GetDocument("doc1")
	assert.True(t, ok)
	assert.Equal(t, "doc1", doc.DocID)
	assert.Equal(t, "narrative1", doc.NarrativeID)
	assert.Equal(t, "/folder1", doc.FolderPath)

	_, ok = gdr.GetDocument("nonexistent")
	assert.False(t, ok)
}

// TestHasVector verifies vector existence check
func TestHasVector(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	vec := makeVec(256, 0.5)
	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, vec)
	require.NoError(t, err)

	err = gdr.Upsert("doc2", map[string]string{"content": "foo bar"}, nil)
	require.NoError(t, err)

	assert.True(t, gdr.HasVector("doc1", 256))
	assert.False(t, gdr.HasVector("doc1", 384))
	assert.False(t, gdr.HasVector("doc2", 256))
	assert.False(t, gdr.HasVector("nonexistent", 256))
}

// TestCompact verifies compact operation
func TestCompact(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	err := gdr.Upsert("doc1", map[string]string{"content": "hello world"}, nil)
	require.NoError(t, err)

	gdr.Delete("doc1")

	// Compact should purge deleted documents
	gdr.Compact()

	// Verify deleted bitmap is cleared
	assert.True(t, gdr.Lex.Deleted.IsEmpty())
}

// TestSearchVectorOnly verifies vector search with minimal lexical gate
func TestSearchVectorOnly(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	// Index documents with very different vectors (orthogonal directions)
	vec1 := make([]float32, 256)
	vec2 := make([]float32, 256)
	for i := range vec1 {
		if i < 128 {
			vec1[i] = 1.0 // First half high
			vec2[i] = 0.0 // First half low
		} else {
			vec1[i] = 0.0 // Second half low
			vec2[i] = 1.0 // Second half high
		}
	}

	err := gdr.Upsert("doc1", map[string]string{"content": "alpha beta"}, vec1)
	require.NoError(t, err)

	err = gdr.Upsert("doc2", map[string]string{"content": "gamma delta"}, vec2)
	require.NoError(t, err)

	// Query with vector similar to doc2 (second half high)
	queryVec := make([]float32, 256)
	for i := range queryVec {
		if i < 128 {
			queryVec[i] = 0.0
		} else {
			queryVec[i] = 1.0
		}
	}
	results := gdr.Search(SearchInput{
		TextQuery: "alpha OR gamma", // OR query to gate both docs
		Vector:    queryVec,
	}, DefaultGDRConfig())

	// Both should be found, but doc2 should rank higher due to vector similarity
	assert.Len(t, results, 2)
	assert.Equal(t, "doc2", results[0].DocID)
}

// TestDimensionValidation verifies dimension validation
func TestDimensionValidation(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	// Valid dimensions
	vec64 := makeVec(64, 0.5)
	err := gdr.Upsert("doc64", map[string]string{"content": "test"}, vec64)
	require.NoError(t, err)

	vec1536 := makeVec(1536, 0.5)
	err = gdr.Upsert("doc1536", map[string]string{"content": "test"}, vec1536)
	require.NoError(t, err)

	// Invalid dimensions should be rejected by HNSW
	// Note: The current implementation creates indexes lazily,
	// so invalid dimensions are caught when trying to add points
}

// TestMultipleVectorDimensions verifies documents with different vector dimensions
func TestMultipleVectorDimensions(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	vec256 := makeVec(256, 0.5)
	vec384 := makeVec(384, 0.5)
	vec768 := makeVec(768, 0.5)

	err := gdr.Upsert("doc256", map[string]string{"content": "hello world"}, vec256)
	require.NoError(t, err)

	err = gdr.Upsert("doc384", map[string]string{"content": "hello world"}, vec384)
	require.NoError(t, err)

	err = gdr.Upsert("doc768", map[string]string{"content": "hello world"}, vec768)
	require.NoError(t, err)

	// Verify all dimensions are indexed
	assert.Len(t, gdr.Vec.Indexes, 3)
	assert.NotNil(t, gdr.Vec.Indexes[256])
	assert.NotNil(t, gdr.Vec.Indexes[384])
	assert.NotNil(t, gdr.Vec.Indexes[768])

	// Verify each document has correct vector
	v, ok := gdr.GetVector("doc256", 256)
	assert.True(t, ok)
	assert.Equal(t, 256, len(v))

	v, ok = gdr.GetVector("doc384", 384)
	assert.True(t, ok)
	assert.Equal(t, 384, len(v))

	v, ok = gdr.GetVector("doc768", 768)
	assert.True(t, ok)
	assert.Equal(t, 768, len(v))
}

// TestSearchConfigDefaults verifies search config defaults
func TestSearchConfigDefaults(t *testing.T) {
	config := DefaultGDRConfig()

	assert.Equal(t, 16, config.M)
	assert.Equal(t, 200, config.EfConstruction)
	assert.Equal(t, 50, config.EfSearch)
	assert.Equal(t, 10, config.K)
	assert.True(t, config.Hard)
	assert.Equal(t, 10000, config.GateMaxCandidates)
	assert.Equal(t, 1000, config.FetchCap)
	assert.Equal(t, 4, config.ExpansionFactor)
	assert.Equal(t, 3, config.MaxExpansions)
	assert.Equal(t, 0.3, config.ScoreConfig.Alpha)
	assert.Equal(t, 10.0, config.ScoreConfig.LexicalCap)
	assert.Equal(t, -1.0, config.ScoreConfig.VecMin)
	assert.Equal(t, 1.0, config.ScoreConfig.VecMax)
	assert.True(t, config.LexicalConfig.PhraseHard)
}

// TestHNSWConfig verifies HNSW configuration is applied
func TestHNSWConfig(t *testing.T) {
	config := DefaultGDRConfig()
	config.M = 32
	config.EfConstruction = 400

	gdr := NewGDR(config)

	assert.Equal(t, 32, gdr.Vec.M)
	assert.Equal(t, 400, gdr.Vec.EfCon)
	assert.Equal(t, hnsw.Cosine, gdr.Vec.Metric)
}

func TestSoftSearchFallsBackToVectorWhenGateEmpty(t *testing.T) {
	gdr := NewGDR(DefaultGDRConfig())

	vecA := make([]float32, 256)
	vecB := make([]float32, 256)
	queryVec := make([]float32, 256)
	for i := range vecA {
		if i < 128 {
			vecA[i] = 1.0
			vecB[i] = 0.0
			queryVec[i] = 0.0
		} else {
			vecA[i] = 0.0
			vecB[i] = 1.0
			queryVec[i] = 1.0
		}
	}

	require.NoError(t, gdr.Upsert("doc-alpha", map[string]string{"content": "crimson forge ember"}, vecA))
	require.NoError(t, gdr.Upsert("doc-beta", map[string]string{"content": "silver harbor moon"}, vecB))

	config := DefaultGDRConfig()
	config.Hard = false
	config.K = 2
	config.ScoreConfig.Alpha = 0.8

	results := gdr.Search(SearchInput{
		TextQuery: "prophecy oracle",
		Vector:    queryVec,
	}, config)

	require.NotEmpty(t, results)
	assert.Equal(t, "doc-beta", results[0].DocID)
	assert.Greater(t, results[0].VecNorm, results[len(results)-1].VecNorm)
	assert.Zero(t, results[0].Coverage)
}
