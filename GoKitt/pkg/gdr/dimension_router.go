// Package gdr provides the Gate-Driven Retriever (GDR) combining lexical (qgram) and vector (HNSW) indexes.
package gdr

import (
	"fmt"

	"github.com/kittclouds/gokitt/pkg/hnsw"
)

// Dimension constants
const (
	MinDimension = 64
	MaxDimension = 1536
)

// DimensionRouter manages per-dimension HNSW indexes.
// This allows the GDR to handle embeddings of different sizes (256D, 384D, 768D, etc.)
// without requiring all documents to have the same embedding dimension.
type DimensionRouter struct {
	Indexes map[int]*hnsw.Index // dimension -> HNSW index
	M       int                 // Max neighbors per level
	EfCon   int                 // Construction beam width
	Metric  hnsw.Metric         // Distance metric (Cosine or Euclidean)
}

// NewDimensionRouter creates a new dimension router with the given HNSW parameters.
func NewDimensionRouter(m, efCon int, metric hnsw.Metric) *DimensionRouter {
	return &DimensionRouter{
		Indexes: make(map[int]*hnsw.Index),
		M:       m,
		EfCon:   efCon,
		Metric:  metric,
	}
}

// GetOrCreateIndex returns the HNSW index for the given dimension, creating it if necessary.
// Returns an error if the dimension is outside the valid range [64, 1536].
func (dr *DimensionRouter) GetOrCreateIndex(dim int) (*hnsw.Index, error) {
	if dim < MinDimension || dim > MaxDimension {
		return nil, fmt.Errorf("dimension %d out of range [%d, %d]", dim, MinDimension, MaxDimension)
	}

	if idx, ok := dr.Indexes[dim]; ok {
		return idx, nil
	}

	idx := hnsw.NewIndex(dr.M, dr.EfCon, dr.Metric)
	dr.Indexes[dim] = idx
	return idx, nil
}

// GetIndex returns the HNSW index for the given dimension, or nil if not found.
func (dr *DimensionRouter) GetIndex(dim int) *hnsw.Index {
	return dr.Indexes[dim]
}

// DeletePointAll soft-deletes a point from all dimension indexes.
// This is used when a document is deleted - we tombstone it in every HNSW index
// where it might exist, regardless of dimension.
func (dr *DimensionRouter) DeletePointAll(id uint32) {
	for _, idx := range dr.Indexes {
		idx.DeletePoint(id)
	}
}

// AddPoint adds a point to the appropriate dimension index.
// This is a convenience method that routes to the correct index based on vector length.
func (dr *DimensionRouter) AddPoint(id uint32, vec []float32) error {
	dim := len(vec)
	idx, err := dr.GetOrCreateIndex(dim)
	if err != nil {
		return err
	}
	return idx.AddPoint(id, vec)
}

// UpsertPoint adds or updates a point in the appropriate dimension index.
// If the ID exists, the old node is replaced.
func (dr *DimensionRouter) UpsertPoint(id uint32, vec []float32) error {
	dim := len(vec)
	idx, err := dr.GetOrCreateIndex(dim)
	if err != nil {
		return err
	}
	return idx.UpsertPoint(id, vec)
}

// SearchKNN searches for k nearest neighbors in the specified dimension index.
// Returns an empty slice if no index exists for the dimension.
func (dr *DimensionRouter) SearchKNN(query []float32, k, ef int) []hnsw.Result {
	dim := len(query)
	idx := dr.Indexes[dim]
	if idx == nil {
		return []hnsw.Result{}
	}
	return idx.SearchKNN(query, k)
}

// SearchKNNFiltered searches with a filter predicate in the specified dimension index.
// Returns an empty slice if no index exists for the dimension.
func (dr *DimensionRouter) SearchKNNFiltered(query []float32, k, ef int, filter func(uint32) bool) []hnsw.Result {
	dim := len(query)
	idx := dr.Indexes[dim]
	if idx == nil {
		return []hnsw.Result{}
	}
	return idx.SearchKNNFiltered(query, k, filter)
}

// GetVector retrieves a vector from the specified dimension index.
// Returns nil, false if not found.
func (dr *DimensionRouter) GetVector(dim int, id uint32) ([]float32, bool) {
	idx := dr.Indexes[dim]
	if idx == nil {
		return nil, false
	}
	return idx.GetVector(id)
}

// Len returns the number of dimension indexes.
func (dr *DimensionRouter) Len() int {
	return len(dr.Indexes)
}

// Dimensions returns a sorted slice of all dimensions that have indexes.
func (dr *DimensionRouter) Dimensions() []int {
	dims := make([]int, 0, len(dr.Indexes))
	for dim := range dr.Indexes {
		dims = append(dims, dim)
	}
	return dims
}

// TotalPoints returns the total number of points across all dimension indexes.
// Note: This counts all nodes including soft-deleted ones.
func (dr *DimensionRouter) TotalPoints() int {
	total := 0
	for _, idx := range dr.Indexes {
		total += idx.Len()
	}
	return total
}
