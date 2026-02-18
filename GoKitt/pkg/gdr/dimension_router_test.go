package gdr

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewDimensionRouter(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	assert.NotNil(t, dr)
	assert.NotNil(t, dr.Indexes)
	assert.Equal(t, 16, dr.M)
	assert.Equal(t, 200, dr.EfCon)
	assert.Equal(t, hnsw.Cosine, dr.Metric)
}

func TestGetOrCreateIndex_ValidDimensions(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Test minimum dimension (64)
	idx64, err := dr.GetOrCreateIndex(64)
	require.NoError(t, err)
	assert.NotNil(t, idx64)
	// Dimension is 0 until first point is added
	assert.Equal(t, 0, idx64.Dimension())

	// Add a point to set dimension
	vec64 := make([]float32, 64)
	err = idx64.AddPoint(1, vec64)
	require.NoError(t, err)
	assert.Equal(t, 64, idx64.Dimension())

	// Test common embedding dimensions
	idx256, err := dr.GetOrCreateIndex(256)
	require.NoError(t, err)
	assert.NotNil(t, idx256)

	idx384, err := dr.GetOrCreateIndex(384)
	require.NoError(t, err)
	assert.NotNil(t, idx384)

	idx768, err := dr.GetOrCreateIndex(768)
	require.NoError(t, err)
	assert.NotNil(t, idx768)

	// Test maximum dimension (1536)
	idx1536, err := dr.GetOrCreateIndex(1536)
	require.NoError(t, err)
	assert.NotNil(t, idx1536)

	// Verify all indexes are stored
	assert.Len(t, dr.Indexes, 5)
}

func TestGetOrCreateIndex_InvalidDimensions(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Below minimum
	_, err := dr.GetOrCreateIndex(63)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "out of range")

	// Zero
	_, err = dr.GetOrCreateIndex(0)
	assert.Error(t, err)

	// Above maximum
	_, err = dr.GetOrCreateIndex(1537)
	assert.Error(t, err)
}

func TestGetOrCreateIndex_Idempotent(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Create index
	idx1, err := dr.GetOrCreateIndex(256)
	require.NoError(t, err)

	// Get same index again
	idx2, err := dr.GetOrCreateIndex(256)
	require.NoError(t, err)

	// Should be the same instance
	assert.Same(t, idx1, idx2)
	assert.Len(t, dr.Indexes, 1)
}

func TestGetIndex(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Non-existent index
	assert.Nil(t, dr.GetIndex(256))

	// Create and retrieve
	_, err := dr.GetOrCreateIndex(256)
	require.NoError(t, err)

	idx := dr.GetIndex(256)
	assert.NotNil(t, idx)
}

func TestDeletePointAll(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Create indexes for different dimensions
	idx256, _ := dr.GetOrCreateIndex(256)
	idx384, _ := dr.GetOrCreateIndex(384)

	// Add points to both
	vec256 := make([]float32, 256)
	vec384 := make([]float32, 384)

	err := idx256.AddPoint(1, vec256)
	require.NoError(t, err)
	err = idx384.AddPoint(1, vec384)
	require.NoError(t, err)

	// Verify points exist
	_, ok := idx256.GetVector(1)
	assert.True(t, ok)
	_, ok = idx384.GetVector(1)
	assert.True(t, ok)

	// Delete from all
	dr.DeletePointAll(1)

	// Verify soft delete (node still exists but marked deleted)
	node256, ok := idx256.Nodes[1]
	assert.True(t, ok)
	assert.True(t, node256.Deleted)

	node384, ok := idx384.Nodes[1]
	assert.True(t, ok)
	assert.True(t, node384.Deleted)
}

func TestDeletePointAll_NonExistent(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Should not panic for non-existent ID
	assert.NotPanics(t, func() {
		dr.DeletePointAll(999)
	})
}

func TestDimensionRouter_AddPoint(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	vec := make([]float32, 256)
	for i := range vec {
		vec[i] = float32(i) / 256.0
	}

	err := dr.AddPoint(1, vec)
	require.NoError(t, err)

	// Verify index was created
	assert.NotNil(t, dr.Indexes[256])

	// Verify point was added
	idx := dr.GetIndex(256)
	require.NotNil(t, idx)
	assert.Equal(t, 1, idx.Len())
}

func TestDimensionRouter_AddPoint_DimensionMismatch(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Add first point with 256D
	vec256 := make([]float32, 256)
	err := dr.AddPoint(1, vec256)
	require.NoError(t, err)

	// Try to add second point with different dimension to same index
	// This should create a new index, not error
	vec384 := make([]float32, 384)
	err = dr.AddPoint(2, vec384)
	require.NoError(t, err)

	// Both indexes should exist
	assert.NotNil(t, dr.Indexes[256])
	assert.NotNil(t, dr.Indexes[384])
}

func TestDimensionRouter_SearchKNN(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Add some points
	vec := make([]float32, 256)
	for i := 0; i < 10; i++ {
		for j := range vec {
			vec[j] = float32(i*10+j) / 2560.0
		}
		err := dr.AddPoint(uint32(i), vec)
		require.NoError(t, err)
	}

	// Search
	query := make([]float32, 256)
	results := dr.SearchKNN(query, 5, 50)

	// Should return results from 256D index
	assert.Len(t, results, 5)
}

func TestDimensionRouter_SearchKNN_NoIndex(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Search without creating index
	query := make([]float32, 256)
	results := dr.SearchKNN(query, 5, 50)

	// Should return empty results
	assert.Empty(t, results)
}

func TestDimensionRouter_SearchKNNFiltered(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// Add points
	vec := make([]float32, 256)
	for i := 0; i < 10; i++ {
		for j := range vec {
			vec[j] = float32(i*10+j) / 2560.0
		}
		err := dr.AddPoint(uint32(i), vec)
		require.NoError(t, err)
	}

	// Filter: only allow even IDs
	filter := func(id uint32) bool {
		return id%2 == 0
	}

	query := make([]float32, 256)
	results := dr.SearchKNNFiltered(query, 5, 50, filter)

	// All results should be even IDs
	for _, r := range results {
		assert.Equal(t, uint32(0), r.ID%2)
	}
}

func TestDimensionRouter_GetVector(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	vec := make([]float32, 256)
	for i := range vec {
		vec[i] = float32(i) / 256.0
	}

	err := dr.AddPoint(42, vec)
	require.NoError(t, err)

	// Retrieve vector
	retrieved, ok := dr.GetVector(256, 42)
	assert.True(t, ok)
	assert.Equal(t, vec, retrieved)

	// Non-existent dimension
	_, ok = dr.GetVector(384, 42)
	assert.False(t, ok)

	// Non-existent ID
	_, ok = dr.GetVector(256, 999)
	assert.False(t, ok)
}

func TestDimensionRouter_Len(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// No indexes
	assert.Equal(t, 0, dr.Len())

	// Add one index
	dr.GetOrCreateIndex(256)
	assert.Equal(t, 1, dr.Len())

	// Add another
	dr.GetOrCreateIndex(384)
	assert.Equal(t, 2, dr.Len())
}

func TestDimensionRouter_Dimensions(t *testing.T) {
	dr := NewDimensionRouter(16, 200, hnsw.Cosine)

	// No indexes
	dims := dr.Dimensions()
	assert.Empty(t, dims)

	// Add indexes
	dr.GetOrCreateIndex(256)
	dr.GetOrCreateIndex(384)
	dr.GetOrCreateIndex(768)

	dims = dr.Dimensions()
	assert.Len(t, dims, 3)
	assert.Contains(t, dims, 256)
	assert.Contains(t, dims, 384)
	assert.Contains(t, dims, 768)
}
