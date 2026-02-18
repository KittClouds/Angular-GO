package hnsw

import (
	"math"
	"testing"
)

// === Constructor Tests ===

func TestNewIndex(t *testing.T) {
	index := NewIndex(16, 200, Cosine)
	if index == nil {
		t.Fatal("expected non-nil index")
	}
	if index.M != 16 {
		t.Errorf("expected M=16, got %d", index.M)
	}
	if index.EfConstruction != 200 {
		t.Errorf("expected EfConstruction=200, got %d", index.EfConstruction)
	}
	if index.Metric != Cosine {
		t.Errorf("expected Cosine metric, got %v", index.Metric)
	}
}

func TestNewIndexDefault(t *testing.T) {
	index := NewIndexDefault()
	if index.M != 16 {
		t.Errorf("expected default M=16, got %d", index.M)
	}
	if index.EfConstruction != 200 {
		t.Errorf("expected default EfConstruction=200, got %d", index.EfConstruction)
	}
}

func TestNewIndexEuclidean(t *testing.T) {
	index := NewIndex(32, 400, Euclidean)
	if index.Metric != Euclidean {
		t.Errorf("expected Euclidean metric, got %v", index.Metric)
	}
	if index.M != 32 {
		t.Errorf("expected M=32, got %d", index.M)
	}
}

// === AddPoint Tests ===

func TestAddPointBasic(t *testing.T) {
	index := NewIndexDefault()
	err := index.AddPoint(1, []float32{1.0, 0.0, 0.0})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if index.Len() != 1 {
		t.Errorf("expected 1 node, got %d", index.Len())
	}
}

func TestAddPointMultiple(t *testing.T) {
	index := NewIndexDefault()

	vectors := [][]float32{
		{1.0, 0.0, 0.0},
		{0.0, 1.0, 0.0},
		{0.0, 0.0, 1.0},
	}

	for i, v := range vectors {
		err := index.AddPoint(uint32(i+1), v)
		if err != nil {
			t.Errorf("unexpected error adding point %d: %v", i, err)
		}
	}

	if index.Len() != 3 {
		t.Errorf("expected 3 nodes, got %d", index.Len())
	}
}

func TestAddPointEmptyVector(t *testing.T) {
	index := NewIndexDefault()
	err := index.AddPoint(1, []float32{})
	if err == nil {
		t.Error("expected error for empty vector")
	}
	if err != ErrEmptyVector {
		t.Errorf("expected ErrEmptyVector, got %v", err)
	}
}

func TestAddPointDuplicateID(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0})
	err := index.AddPoint(1, []float32{0.0, 1.0})
	if err == nil {
		t.Error("expected error for duplicate ID")
	}
	if err != ErrDuplicateID {
		t.Errorf("expected ErrDuplicateID, got %v", err)
	}
}

func TestAddPointDimensionMismatch(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0, 0.0})
	err := index.AddPoint(2, []float32{1.0, 0.0})
	if err == nil {
		t.Error("expected error for dimension mismatch")
	}
	if err != ErrDimensionMismatch {
		t.Errorf("expected ErrDimensionMismatch, got %v", err)
	}
}

func TestAddPointDimensionSet(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0, 0.0, 0.0})

	if index.Dimension() != 4 {
		t.Errorf("expected dimension 4, got %d", index.Dimension())
	}
}

// === SearchKNN Tests ===

func TestSearchKNNEmpty(t *testing.T) {
	index := NewIndexDefault()
	results := index.SearchKNN([]float32{1.0, 0.0}, 5)
	if len(results) != 0 {
		t.Errorf("expected empty results, got %d", len(results))
	}
}

func TestSearchKNNSinglePoint(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0, 0.0})

	results := index.SearchKNN([]float32{1.0, 0.0, 0.0}, 5)
	if len(results) != 1 {
		t.Errorf("expected 1 result, got %d", len(results))
	}
	if results[0].ID != 1 {
		t.Errorf("expected ID 1, got %d", results[0].ID)
	}
}

func TestSearchKNNExactMatch(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0, 0.0})
	_ = index.AddPoint(2, []float32{0.0, 1.0, 0.0})
	_ = index.AddPoint(3, []float32{0.0, 0.0, 1.0})

	results := index.SearchKNN([]float32{1.0, 0.0, 0.0}, 1)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].ID != 1 {
		t.Errorf("expected ID 1 (exact match), got %d", results[0].ID)
	}
}

func TestSearchKNNReturnsK(t *testing.T) {
	index := NewIndexDefault()
	for i := 0; i < 100; i++ {
		v := make([]float32, 64)
		v[i%64] = float32(i) / 100.0
		_ = index.AddPoint(uint32(i+1), v)
	}

	results := index.SearchKNN(make([]float32, 64), 10)
	if len(results) != 10 {
		t.Errorf("expected 10 results, got %d", len(results))
	}
}

func TestSearchKNNOrdering(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0, 0.0}) // Most similar to query
	_ = index.AddPoint(2, []float32{0.8, 0.6, 0.0}) // Less similar
	_ = index.AddPoint(3, []float32{0.0, 0.0, 1.0}) // Orthogonal

	results := index.SearchKNN([]float32{1.0, 0.0, 0.0}, 3)

	// Results should be ordered by similarity (descending)
	for i := 1; i < len(results); i++ {
		if results[i].Score > results[i-1].Score {
			t.Errorf("results not properly ordered: [%d]=%f > [%d]=%f",
				i, results[i].Score, i-1, results[i-1].Score)
		}
	}
}

func TestSearchKNNWithEuclidean(t *testing.T) {
	index := NewIndex(16, 200, Euclidean)
	_ = index.AddPoint(1, []float32{0.0, 0.0})
	_ = index.AddPoint(2, []float32{1.0, 0.0})
	_ = index.AddPoint(3, []float32{0.0, 1.0})

	results := index.SearchKNN([]float32{0.0, 0.0}, 1)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	// Closest to origin should be ID 1
	if results[0].ID != 1 {
		t.Errorf("expected ID 1 (closest to origin), got %d", results[0].ID)
	}
}

// === DeletePoint Tests ===

func TestDeletePoint(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0})
	_ = index.AddPoint(2, []float32{0.0, 1.0})

	index.DeletePoint(1)

	// Node should still exist but be marked deleted
	if index.Len() != 2 {
		t.Errorf("expected 2 nodes (soft delete), got %d", index.Len())
	}

	// Deleted node should not appear in search
	results := index.SearchKNN([]float32{1.0, 0.0}, 5)
	for _, r := range results {
		if r.ID == 1 {
			t.Error("deleted node should not appear in search results")
		}
	}
}

func TestDeletePointNonExistent(t *testing.T) {
	index := NewIndexDefault()
	// Should not panic
	index.DeletePoint(999)
}

// === GetVector Tests ===

func TestGetVector(t *testing.T) {
	index := NewIndexDefault()
	v := []float32{1.0, 2.0, 3.0}
	_ = index.AddPoint(1, v)

	retrieved, ok := index.GetVector(1)
	if !ok {
		t.Fatal("expected to find vector")
	}
	if len(retrieved) != len(v) {
		t.Errorf("expected length %d, got %d", len(v), len(retrieved))
	}
}

func TestGetVectorNotFound(t *testing.T) {
	index := NewIndexDefault()
	_, ok := index.GetVector(999)
	if ok {
		t.Error("expected not to find vector")
	}
}

// === Len/IsEmpty Tests ===

func TestLen(t *testing.T) {
	index := NewIndexDefault()
	if index.Len() != 0 {
		t.Errorf("expected 0 nodes, got %d", index.Len())
	}

	_ = index.AddPoint(1, []float32{1.0})
	if index.Len() != 1 {
		t.Errorf("expected 1 node, got %d", index.Len())
	}

	_ = index.AddPoint(2, []float32{2.0})
	if index.Len() != 2 {
		t.Errorf("expected 2 nodes, got %d", index.Len())
	}
}

func TestIsEmpty(t *testing.T) {
	index := NewIndexDefault()
	if !index.IsEmpty() {
		t.Error("expected empty index")
	}

	_ = index.AddPoint(1, []float32{1.0})
	if index.IsEmpty() {
		t.Error("expected non-empty index")
	}
}

// === SearchKNNFiltered Tests ===

func TestSearchKNNFiltered(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0})
	_ = index.AddPoint(2, []float32{0.9, 0.1})
	_ = index.AddPoint(3, []float32{0.0, 1.0})

	// Filter that only allows odd IDs
	filter := func(id uint32) bool {
		return id%2 == 1
	}

	results := index.SearchKNNFiltered([]float32{1.0, 0.0}, 5, filter)
	for _, r := range results {
		if r.ID%2 == 0 {
			t.Errorf("even ID %d should be filtered out", r.ID)
		}
	}
}

func TestSearchKNNFilteredAllFiltered(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0})
	_ = index.AddPoint(2, []float32{0.0, 1.0})

	// Filter that rejects all
	filter := func(id uint32) bool {
		return false
	}

	results := index.SearchKNNFiltered([]float32{1.0, 0.0}, 5, filter)
	if len(results) != 0 {
		t.Errorf("expected 0 results when all filtered, got %d", len(results))
	}
}

// === Large Scale Tests ===

func TestAddPointLargeScale(t *testing.T) {
	index := NewIndexDefault()
	dim := 128
	count := 1000

	for i := 0; i < count; i++ {
		v := make([]float32, dim)
		for j := 0; j < dim; j++ {
			v[j] = float32(i+j) / float32(count*dim)
		}
		err := index.AddPoint(uint32(i+1), v)
		if err != nil {
			t.Errorf("error adding point %d: %v", i, err)
		}
	}

	if index.Len() != count {
		t.Errorf("expected %d nodes, got %d", count, index.Len())
	}
}

func TestSearchKNNLargeScale(t *testing.T) {
	index := NewIndexDefault()
	dim := 64
	count := 500

	// Create vectors with known structure
	for i := 0; i < count; i++ {
		v := make([]float32, dim)
		v[i%dim] = 1.0 // Each vector is a unit vector
		_ = index.AddPoint(uint32(i+1), v)
	}

	// Search for a specific vector
	query := make([]float32, dim)
	query[0] = 1.0

	results := index.SearchKNN(query, 10)
	if len(results) != 10 {
		t.Errorf("expected 10 results, got %d", len(results))
	}

	// For ANN, we just verify we get results with high similarity
	// The exact match should be in top results (not necessarily first due to ANN approximation)
	if results[0].Score < 0.9 {
		t.Errorf("expected high similarity score, got %f", results[0].Score)
	}
}

// === Dimension Support Tests ===

func TestDimension768(t *testing.T) {
	index := NewIndexDefault()
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i) / 768.0
	}

	err := index.AddPoint(1, v)
	if err != nil {
		t.Errorf("error adding 768D vector: %v", err)
	}
	if index.Dimension() != 768 {
		t.Errorf("expected dimension 768, got %d", index.Dimension())
	}
}

func TestDimension1536(t *testing.T) {
	index := NewIndexDefault()
	v := make([]float32, 1536)
	for i := range v {
		v[i] = float32(i) / 1536.0
	}

	err := index.AddPoint(1, v)
	if err != nil {
		t.Errorf("error adding 1536D vector: %v", err)
	}
	if index.Dimension() != 1536 {
		t.Errorf("expected dimension 1536, got %d", index.Dimension())
	}
}

// === Score Validation Tests ===

func TestSearchKNNScoreRange(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0, 0.0})
	_ = index.AddPoint(2, []float32{0.0, 1.0, 0.0})
	_ = index.AddPoint(3, []float32{0.0, 0.0, 1.0})

	results := index.SearchKNN([]float32{1.0, 0.0, 0.0}, 3)

	for _, r := range results {
		if r.Score < -1.0 || r.Score > 1.0 {
			t.Errorf("cosine similarity %f out of range [-1, 1]", r.Score)
		}
	}
}

func TestSearchKNNScoreExactMatch(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(1, []float32{1.0, 0.0, 0.0})

	results := index.SearchKNN([]float32{1.0, 0.0, 0.0}, 1)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	// Exact match should have similarity close to 1.0
	if math.Abs(float64(results[0].Score-1.0)) > 0.001 {
		t.Errorf("expected score ~1.0 for exact match, got %f", results[0].Score)
	}
}

// === Result Type Tests ===

func TestResultFields(t *testing.T) {
	index := NewIndexDefault()
	_ = index.AddPoint(42, []float32{1.0, 0.0})

	results := index.SearchKNN([]float32{1.0, 0.0}, 1)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	if results[0].ID != 42 {
		t.Errorf("expected ID 42, got %d", results[0].ID)
	}
	if results[0].Score == 0 {
		t.Error("expected non-zero score")
	}
}
