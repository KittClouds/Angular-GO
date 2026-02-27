package graphstore

import (
	"github.com/RoaringBitmap/roaring/v2"
	"github.com/google/uuid"
)

// ConnectedComponents returns all weakly connected components as UUID slices.
// O(V + E) — single BFS sweep over the entire bitmap adjacency.
func (s *SQLiteStore[T]) ConnectedComponents() ([][]uuid.UUID, error) {
	if err := s.warmCache(); err != nil {
		return nil, err
	}
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	// Build full node bitmap from registry
	allNodes := roaring.New()
	s.registry.mu.RLock()
	for _, idx := range s.registry.uuidToIdx {
		allNodes.Add(idx)
	}
	s.registry.mu.RUnlock()

	globalVisited := roaring.New()
	var components [][]uuid.UUID

	it := allNodes.Iterator()
	for it.HasNext() {
		seed := it.Next()
		if globalVisited.Contains(seed) {
			continue
		}

		// BFS from seed to find component
		// Don't use pool for frontier - it's reassigned in loop
		component := roaring.New()
		frontier := roaring.New()
		frontier.Add(seed)
		component.Add(seed)
		globalVisited.Add(seed)

		for !frontier.IsEmpty() {
			next := roaring.New()
			fit := frontier.Iterator()
			for fit.HasNext() {
				f := fit.Next()
				if adj, ok := s.cache.outEdges[f]; ok {
					newNodes := roaring.AndNot(adj.neighbors, globalVisited)
					next.Or(newNodes)
				}
			}
			globalVisited.Or(next)
			component.Or(next)
			frontier = next
		}

		// Convert component bitmap to UUIDs
		uuids := make([]uuid.UUID, 0, component.GetCardinality())
		cit := component.Iterator()
		for cit.HasNext() {
			if uid, ok := s.registry.ReverseLookup(cit.Next()); ok {
				uuids = append(uuids, uid)
			}
		}
		components = append(components, uuids)
	}
	return components, nil
}

// IsConnected returns true if the graph has a single connected component.
func (s *SQLiteStore[T]) IsConnected() (bool, error) {
	comps, err := s.ConnectedComponents()
	if err != nil {
		return false, err
	}
	return len(comps) <= 1, nil
}

// LargestComponent returns the biggest connected component by node count.
func (s *SQLiteStore[T]) LargestComponent() ([]uuid.UUID, error) {
	comps, err := s.ConnectedComponents()
	if err != nil {
		return nil, err
	}
	if len(comps) == 0 {
		return nil, nil
	}

	largest := comps[0]
	for _, c := range comps[1:] {
		if len(c) > len(largest) {
			largest = c
		}
	}
	return largest, nil
}
