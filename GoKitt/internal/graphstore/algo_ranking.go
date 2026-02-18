package graphstore

import (
	"math"
	"math/rand"

	"github.com/google/uuid"
)

// PageRankOpts configures the PageRank algorithm.
type PageRankOpts struct {
	Damping   float64 // default 0.85
	MaxIter   int     // default 100
	Tolerance float64 // convergence delta, default 1e-6
}

// PageRank runs the standard power-iteration PageRank on the in-memory adjacency.
// Returns normalized scores per UUID. O(iter × E).
func (s *SQLiteStore[T]) PageRank(opts PageRankOpts) (map[uuid.UUID]float64, error) {
	if opts.Damping == 0 {
		opts.Damping = 0.85
	}
	if opts.MaxIter == 0 {
		opts.MaxIter = 100
	}
	if opts.Tolerance == 0 {
		opts.Tolerance = 1e-6
	}

	if err := s.warmCache(); err != nil {
		return nil, err
	}
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	// Collect all node indices
	s.registry.mu.RLock()
	N := len(s.registry.uuidToIdx)
	indices := make([]uint32, 0, N)
	for _, idx := range s.registry.uuidToIdx {
		indices = append(indices, idx)
	}
	s.registry.mu.RUnlock()

	if N == 0 {
		return nil, nil
	}

	// Initialize ranks uniformly
	init := 1.0 / float64(N)
	rank := make(map[uint32]float64, N)
	for _, idx := range indices {
		rank[idx] = init
	}

	teleport := (1.0 - opts.Damping) / float64(N)

	for iter := 0; iter < opts.MaxIter; iter++ {
		next := make(map[uint32]float64, N)
		delta := 0.0

		for _, idx := range indices {
			contrib := 0.0
			// For undirected graphs: inEdges[idx] == outEdges[idx]
			// Sum contributions from all neighbors
			if adj, ok := s.cache.outEdges[idx]; ok {
				it := adj.neighbors.Iterator()
				for it.HasNext() {
					n := it.Next()
					nDeg := uint64(1)
					if nAdj, ok := s.cache.outEdges[n]; ok {
						nDeg = nAdj.neighbors.GetCardinality()
						if nDeg == 0 {
							nDeg = 1
						}
					}
					contrib += rank[n] / float64(nDeg)
				}
			}
			next[idx] = teleport + opts.Damping*contrib
			delta += math.Abs(next[idx] - rank[idx])
		}
		rank = next
		if delta < opts.Tolerance {
			break
		}
	}

	// Convert to UUID map
	result := make(map[uuid.UUID]float64, N)
	for _, idx := range indices {
		if uid, ok := s.registry.ReverseLookup(idx); ok {
			result[uid] = rank[idx]
		}
	}
	return result, nil
}

// LabelPropagation detects communities by iterative neighbor-majority voting.
// Returns a map of UUID → community ID (uint32). Stable after convergence.
func (s *SQLiteStore[T]) LabelPropagation(maxIter int) (map[uuid.UUID]uint32, error) {
	if maxIter == 0 {
		maxIter = 50
	}

	if err := s.warmCache(); err != nil {
		return nil, err
	}
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	s.registry.mu.RLock()
	indices := make([]uint32, 0, len(s.registry.uuidToIdx))
	for _, idx := range s.registry.uuidToIdx {
		indices = append(indices, idx)
	}
	s.registry.mu.RUnlock()

	// Initialize: each node is its own community
	community := make(map[uint32]uint32, len(indices))
	for _, idx := range indices {
		community[idx] = idx
	}

	for iter := 0; iter < maxIter; iter++ {
		changed := false

		// Shuffle for convergence stability (Fisher-Yates)
		for i := len(indices) - 1; i > 0; i-- {
			j := rand.Intn(i + 1)
			indices[i], indices[j] = indices[j], indices[i]
		}

		for _, idx := range indices {
			adj, ok := s.cache.outEdges[idx]
			if !ok || adj.neighbors.IsEmpty() {
				continue
			}

			// Tally community votes from neighbors
			votes := make(map[uint32]int)
			it := adj.neighbors.Iterator()
			for it.HasNext() {
				n := it.Next()
				votes[community[n]]++
			}

			// Pick majority (ties: keep current)
			best := community[idx]
			bestCount := 0
			for comm, count := range votes {
				if count > bestCount {
					bestCount = count
					best = comm
				}
			}

			if best != community[idx] {
				community[idx] = best
				changed = true
			}
		}

		if !changed {
			break
		}
	}

	// Convert to UUID map
	result := make(map[uuid.UUID]uint32, len(indices))
	for _, idx := range indices {
		if uid, ok := s.registry.ReverseLookup(idx); ok {
			result[uid] = community[idx]
		}
	}
	return result, nil
}

// DegreeCentrality returns normalized degree for every node (degree / (N-1)).
func (s *SQLiteStore[T]) DegreeCentrality() (map[uuid.UUID]float64, error) {
	if err := s.warmCache(); err != nil {
		return nil, err
	}
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	N := float64(len(s.cache.vertices))
	if N <= 1 {
		return nil, nil
	}

	result := make(map[uuid.UUID]float64, len(s.cache.vertices))
	for id := range s.cache.vertices {
		idx, ok := s.registry.Get(id)
		deg := 0.0
		if ok {
			if adj, ok := s.cache.outEdges[idx]; ok {
				deg = float64(adj.neighbors.GetCardinality())
			}
		}
		result[id] = deg / (N - 1)
	}
	return result, nil
}
