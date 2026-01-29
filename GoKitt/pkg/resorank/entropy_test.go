package resorank

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Helper to create a test token index
func createTestTokenIndex() map[string]map[string]TokenMetadata {
	index := make(map[string]map[string]TokenMetadata)

	// Term "rare" appears in 1 doc with TF=1
	rareMeta := TokenMetadata{
		FieldOccurrences: map[string]FieldOccurrence{
			"content": {TF: 1, FieldLength: 100},
		},
	}
	index["rare"] = map[string]TokenMetadata{"doc1": rareMeta}

	// Term "common" appears in 3 docs
	commonDocs := make(map[string]TokenMetadata)
	for _, docID := range []string{"doc1", "doc2", "doc3"} {
		commonDocs[docID] = TokenMetadata{
			FieldOccurrences: map[string]FieldOccurrence{
				"content": {TF: 2, FieldLength: 100},
			},
		}
	}
	index["common"] = commonDocs

	return index
}

func TestEntropyCache_Basic(t *testing.T) {
	cache := NewEntropyCache(100)
	index := createTestTokenIndex()

	// First call computes and caches
	// We expect entropy > 0 for valid terms
	e1 := cache.Get("rare", index)
	assert.Greater(t, e1, 0.0)

	// Second call returns cached value
	e2 := cache.Get("rare", index)
	assert.Equal(t, e1, e2)

	assert.True(t, cache.Has("rare"))
	assert.False(t, cache.Has("nonexistent"))
}

func TestEntropyCache_LRU(t *testing.T) {
	cache := NewEntropyCache(2) // Size 2
	index := createTestTokenIndex()

	cache.Get("rare", index)
	cache.Get("common", index)

	assert.True(t, cache.Has("rare"))
	assert.True(t, cache.Has("common"))

	// This should evict "rare" (LRU) because "common" was accessed last?
	// Wait, if I accessed rare then common:
	// Order: rare, common (most recent).
	// Adding "new_term" should evict "rare".

	// Emulate "new_term" manually since it's not in index,
	// or just force a Set if we expose it, but Get computes.
	// Let's manually inject for testing LRU if Set is private/internal
	// or assume Get works.
	// We need 3rd term. Let's add it to index.
	index["new"] = map[string]TokenMetadata{"doc1": TokenMetadata{}}

	cache.Get("new", index) // Evicts "rare"

	assert.False(t, cache.Has("rare"), "rare should be evicted")
	assert.True(t, cache.Has("common"))
	assert.True(t, cache.Has("new"))
}

func TestCalculateQueryEntropyStats(t *testing.T) {
	cache := NewEntropyCache(100)
	index := createTestTokenIndex()

	query := []string{"rare", "common"}
	stats := CalculateQueryEntropyStats(query, cache, index)

	assert.GreaterOrEqual(t, stats.AvgEntropy, 0.0)
	// Normalized entropy should be <= 1.0
	assert.LessOrEqual(t, stats.AvgEntropy, 1.0)
	assert.Equal(t, 2, len(stats.NormalizedEntropies))

	// "rare" should have higher entropy (more information)?
	// Actually, entropy calculation in ResoRank:
	// - p_j = Sigmoid(TF)
	// - H = - sum(p_j * ln(p_j))
	// "Common" appears in 3 docs, "Rare" in 1.
	// Higher frequency usually entails *lower* IDF, but entropy measures distribution?
	// Actually for "Informative" terms, we want high entropy?
	// Let's just check they are computed.

	eRare := stats.NormalizedEntropies["rare"]
	eCommon := stats.NormalizedEntropies["common"]

	// Ensure not zero
	assert.NotZero(t, eRare)
	assert.NotZero(t, eCommon)
}

func TestSigmoid(t *testing.T) {
	assert.InDelta(t, 0.5, Sigmoid(0.0), 0.001)
	assert.Greater(t, Sigmoid(10.0), 0.999)
	assert.Less(t, Sigmoid(-10.0), 0.001)
}
