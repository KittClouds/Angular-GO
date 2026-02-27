package graphstore

import (
	"fmt"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
)

// EdgeFilterFunc returns true if an edge should be traversed.
// Parameters: sourceIdx, targetIdx (uint32 indices), edge (graph.Edge)
type EdgeFilterFunc func(uint32, uint32, graph.Edge[uuid.UUID]) bool

// KHopBitmap returns all node indices within k hops of the given vertex.
// Does NOT include the root node itself.
// Used internally by Search scoping, EgoNetwork, and Traverse.
func (s *SQLiteStore[T]) KHopBitmap(id uuid.UUID, k int) (*roaring.Bitmap, error) {
	return s.KHopBitmapFiltered(id, k, nil)
}

// KHopBitmapFiltered returns all node indices within k hops, with optional edge filtering.
// If filter is nil, behaves identically to KHopBitmap.
func (s *SQLiteStore[T]) KHopBitmapFiltered(id uuid.UUID, k int, filter EdgeFilterFunc) (*roaring.Bitmap, error) {
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	idx, ok := s.registry.Get(id)
	if !ok {
		return nil, graph.ErrVertexNotFound
	}

	// Don't use pool for visited/frontier - they're reassigned in loop
	visited := roaring.New()
	visited.Add(idx) // exclude root from result
	frontier := roaring.New()
	frontier.Add(idx)
	result := roaring.New() // returned to caller

	for hop := 0; hop < k && !frontier.IsEmpty(); hop++ {
		next := roaring.New()
		it := frontier.Iterator()
		for it.HasNext() {
			f := it.Next()
			if adj, ok := s.cache.outEdges[f]; ok {
				// If no filter, use fast path
				if filter == nil {
					next.Or(roaring.AndNot(adj.neighbors, visited))
				} else {
					// Filter each neighbor by edge validity
					nit := adj.neighbors.Iterator()
					for nit.HasNext() {
						n := nit.Next()
						if visited.Contains(n) {
							continue
						}
						// Check edge filter
						edge, edgeOK := s.cache.slab.Get(f, n)
						if edgeOK && filter(f, n, edge) {
							next.Add(n)
						}
					}
				}
			}
		}
		visited.Or(next)
		result.Or(next)
		frontier = next
	}
	return result, nil
}

// ShortestPathUnweighted returns the hop path between src and tgt using BFS.
// For weighted shortest path, use dominikbraun/graph's Dijkstra implementation.
func (s *SQLiteStore[T]) ShortestPathUnweighted(src, tgt uuid.UUID) ([]uuid.UUID, error) {
	return s.ShortestPathUnweightedFiltered(src, tgt, nil)
}

// ShortestPathUnweightedFiltered returns the hop path with optional edge filtering.
// If filter is nil, behaves identically to ShortestPathUnweighted.
func (s *SQLiteStore[T]) ShortestPathUnweightedFiltered(src, tgt uuid.UUID, filter EdgeFilterFunc) ([]uuid.UUID, error) {
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	srcIdx, ok1 := s.registry.Get(src)
	tgtIdx, ok2 := s.registry.Get(tgt)
	if !ok1 || !ok2 {
		return nil, graph.ErrVertexNotFound
	}
	if srcIdx == tgtIdx {
		return []uuid.UUID{src}, nil
	}

	// BFS with parent tracking for path reconstruction
	parent := map[uint32]uint32{srcIdx: srcIdx}
	// Don't use pool for visited/frontier - they're reassigned in loop
	visited := roaring.New()
	visited.Add(srcIdx)
	frontier := roaring.New()
	frontier.Add(srcIdx)
	found := false

	for !frontier.IsEmpty() && !found {
		next := roaring.New()
		it := frontier.Iterator()
		for it.HasNext() {
			f := it.Next()
			adj, ok := s.cache.outEdges[f]
			if !ok {
				continue
			}
			// If no filter, use fast path
			if filter == nil {
				newNeighbors := roaring.AndNot(adj.neighbors, visited)
				nit := newNeighbors.Iterator()
				for nit.HasNext() {
					n := nit.Next()
					parent[n] = f
					if n == tgtIdx {
						found = true
						break
					}
					next.Add(n)
				}
			} else {
				// Filter each neighbor by edge validity
				nit := adj.neighbors.Iterator()
				for nit.HasNext() {
					n := nit.Next()
					if visited.Contains(n) {
						continue
					}
					// Check edge filter
					edge, edgeOK := s.cache.slab.Get(f, n)
					if edgeOK && filter(f, n, edge) {
						parent[n] = f
						if n == tgtIdx {
							found = true
							break
						}
						next.Add(n)
					}
				}
			}
			if found {
				break
			}
		}
		visited.Or(next)
		frontier = next
	}

	if !found {
		return nil, fmt.Errorf("no path between vertices")
	}

	// Reconstruct path (reverse walk via parent map)
	path := []uint32{tgtIdx}
	cur := tgtIdx
	for cur != srcIdx {
		cur = parent[cur]
		path = append(path, cur)
	}
	// Reverse path
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}

	// Convert indices to UUIDs
	uuids := make([]uuid.UUID, 0, len(path))
	for _, idx := range path {
		if id, ok := s.registry.ReverseLookup(idx); ok {
			uuids = append(uuids, id)
		}
	}
	return uuids, nil
}

// SubGraph is a lightweight extracted subgraph for visualization and analysis.
type SubGraph struct {
	Nodes []uuid.UUID
	Edges [][2]uuid.UUID
}

// EgoNetwork extracts the subgraph of all nodes within depth hops of id,
// including all edges between those nodes.
func (s *SQLiteStore[T]) EgoNetwork(id uuid.UUID, depth int) (*SubGraph, error) {
	return s.EgoNetworkFiltered(id, depth, nil)
}

// EgoNetworkFiltered extracts the subgraph with optional edge filtering.
// If filter is nil, behaves identically to EgoNetwork.
func (s *SQLiteStore[T]) EgoNetworkFiltered(id uuid.UUID, depth int, filter EdgeFilterFunc) (*SubGraph, error) {
	neighborhood, err := s.KHopBitmapFiltered(id, depth, filter)
	if err != nil {
		return nil, err
	}

	// Include root in neighborhood
	rootIdx, _ := s.registry.Get(id)
	neighborhood.Add(rootIdx)

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	sg := &SubGraph{}
	it := neighborhood.Iterator()
	for it.HasNext() {
		idx := it.Next()
		uid, ok := s.registry.ReverseLookup(idx)
		if !ok {
			continue
		}
		sg.Nodes = append(sg.Nodes, uid)

		// Only emit edges where BOTH endpoints are in neighborhood
		// Use canonical ordering (src < tgt) to emit each edge once
		if adj, ok := s.cache.outEdges[idx]; ok {
			members := roaring.And(adj.neighbors, neighborhood)
			mit := members.Iterator()
			for mit.HasNext() {
				nIdx := mit.Next()
				if nIdx > idx { // canonical: only emit once per pair
					// If filter provided, check edge validity
					if filter != nil {
						edge, edgeOK := s.cache.slab.Get(idx, nIdx)
						if !edgeOK || !filter(idx, nIdx, edge) {
							continue
						}
					}
					nUID, ok := s.registry.ReverseLookup(nIdx)
					if ok {
						sg.Edges = append(sg.Edges, [2]uuid.UUID{uid, nUID})
					}
				}
			}
		}
	}
	return sg, nil
}
