package graphstore

import (
	"math"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
)

// Degree returns the out-degree of vertex id.
// O(1) - single bitmap cardinality lookup.
func (s *SQLiteStore[T]) Degree(id uuid.UUID) (int, error) {
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	idx, ok := s.registry.Get(id)
	if !ok {
		return 0, graph.ErrVertexNotFound
	}

	if adj, ok := s.cache.outEdges[idx]; ok {
		return int(adj.neighbors.GetCardinality()), nil
	}
	return 0, nil
}

// CommonNeighbors returns the intersection of neighbor sets for vertices a and b.
// O(n/64) - SIMD-optimized bitmap AND operation.
func (s *SQLiteStore[T]) CommonNeighbors(a, b uuid.UUID) (*roaring.Bitmap, error) {
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	aIdx, ok1 := s.registry.Get(a)
	bIdx, ok2 := s.registry.Get(b)
	if !ok1 || !ok2 {
		return nil, graph.ErrVertexNotFound
	}

	adjA, hasA := s.cache.outEdges[aIdx]
	adjB, hasB := s.cache.outEdges[bIdx]
	if !hasA || !hasB {
		return roaring.New(), nil
	}

	return roaring.And(adjA.neighbors, adjB.neighbors), nil
}

// Jaccard returns the Jaccard similarity coefficient between vertices a and b.
// Computed as |A intersection B| / |A union B|.
func (s *SQLiteStore[T]) Jaccard(a, b uuid.UUID) (float64, error) {
	common, err := s.CommonNeighbors(a, b)
	if err != nil {
		return 0, err
	}
	if common.IsEmpty() {
		return 0, nil
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	aIdx, ok1 := s.registry.Get(a)
	bIdx, ok2 := s.registry.Get(b)
	if !ok1 || !ok2 {
		return 0, graph.ErrVertexNotFound
	}

	adjA, hasA := s.cache.outEdges[aIdx]
	adjB, hasB := s.cache.outEdges[bIdx]
	if !hasA || !hasB {
		return 0, nil
	}

	union := roaring.Or(adjA.neighbors, adjB.neighbors)
	if union.IsEmpty() {
		return 0, nil
	}

	return float64(common.GetCardinality()) / float64(union.GetCardinality()), nil
}

// AdamicAdar returns the Adamic-Adar similarity score between vertices a and b.
// Computed as sum of 1/log(degree(w)) for all common neighbors w.
func (s *SQLiteStore[T]) AdamicAdar(a, b uuid.UUID) (float64, error) {
	common, err := s.CommonNeighbors(a, b)
	if err != nil {
		return 0, err
	}
	if common.IsEmpty() {
		return 0, nil
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	score := 0.0
	it := common.Iterator()
	for it.HasNext() {
		w := it.Next()
		if adj, ok := s.cache.outEdges[w]; ok {
			deg := adj.neighbors.GetCardinality()
			if deg > 1 {
				score += 1.0 / math.Log(float64(deg))
			}
		}
	}
	return score, nil
}

// ClusteringCoefficient returns the local clustering coefficient for vertex id.
// Computed as: (edges between neighbors) / (possible edges between neighbors).
// For a vertex with k neighbors, possible edges = k*(k-1)/2.
func (s *SQLiteStore[T]) ClusteringCoefficient(id uuid.UUID) (float64, error) {
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	idx, ok := s.registry.Get(id)
	if !ok {
		return 0, graph.ErrVertexNotFound
	}

	adj, ok := s.cache.outEdges[idx]
	if !ok {
		return 0, nil
	}

	k := adj.neighbors.GetCardinality()
	if k < 2 {
		return 0, nil
	}

	// Count triangles: for each neighbor u, count edges between u and other neighbors.
	// Each triangle is counted twice (u->v and v->u), so divide by 2.
	var triangles uint64
	it := adj.neighbors.Iterator()
	for it.HasNext() {
		uIdx := it.Next()
		if uAdj, ok := s.cache.outEdges[uIdx]; ok {
			triangles += roaring.And(uAdj.neighbors, adj.neighbors).GetCardinality()
		}
	}
	triangles /= 2

	possible := k * (k - 1) / 2
	return float64(triangles) / float64(possible), nil
}
