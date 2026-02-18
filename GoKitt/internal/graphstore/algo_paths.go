package graphstore

import (
	"fmt"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
)

// KHopBitmap returns all node indices within k hops of the given vertex.
// Does NOT include the root node itself.
// Used internally by Search scoping, EgoNetwork, and Traverse.
func (s *SQLiteStore[T]) KHopBitmap(id uuid.UUID, k int) (*roaring.Bitmap, error) {
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	idx, ok := s.registry.Get(id)
	if !ok {
		return nil, graph.ErrVertexNotFound
	}

	visited := roaring.New()
	visited.Add(idx) // exclude root from result
	frontier := roaring.New()
	frontier.Add(idx)
	result := roaring.New()

	for hop := 0; hop < k && !frontier.IsEmpty(); hop++ {
		next := roaring.New()
		it := frontier.Iterator()
		for it.HasNext() {
			f := it.Next()
			if adj, ok := s.cache.outEdges[f]; ok {
				next.Or(roaring.AndNot(adj.neighbors, visited))
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
	neighborhood, err := s.KHopBitmap(id, depth)
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
