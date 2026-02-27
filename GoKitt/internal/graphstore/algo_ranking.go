package graphstore

import (
	"math"
	"math/rand"

	"github.com/RoaringBitmap/roaring/v2"
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
// Uses dense []float64 arrays with ping-pong swap (zero per-iteration alloc).
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
	indices := s.registry.AllIndices()
	N := len(indices)
	if N == 0 {
		return nil, nil
	}

	// Dense arrays: index by uint32 node ID, not map key
	maxIdx := s.registry.MaxIndex()
	rank := make([]float64, maxIdx)
	next := make([]float64, maxIdx)

	// Initialize ranks uniformly
	init := 1.0 / float64(N)
	for _, idx := range indices {
		rank[idx] = init
	}

	teleport := (1.0 - opts.Damping) / float64(N)

	for iter := 0; iter < opts.MaxIter; iter++ {
		// Zero the next array (compiles to memset on Go 1.21+)
		clear(next)
		delta := 0.0

		for _, idx := range indices {
			contrib := 0.0
			// Undirected graph: outEdges contains all neighbors
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
		rank, next = next, rank // swap, zero alloc
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
// Reuses a single votes map per iteration (cleared between nodes).
func (s *SQLiteStore[T]) LabelPropagation(maxIter int) (map[uuid.UUID]uint32, error) {
	if maxIter == 0 {
		maxIter = 50
	}

	if err := s.warmCache(); err != nil {
		return nil, err
	}
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	indices := s.registry.AllIndices()

	// Dense community array
	maxIdx := s.registry.MaxIndex()
	community := make([]uint32, maxIdx)
	for _, idx := range indices {
		community[idx] = idx
	}

	// Reusable votes map — allocated once, cleared per node
	votes := make(map[uint32]int, 16)

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

			// Clear and tally community votes from neighbors
			clear(votes)
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

// PersonalizedPageRank runs query-biased PageRank from the given anchor nodes.
// Anchors is a map of UUID → confidence (1.0 = full anchor).
// Uses Roaring bitmaps for BFS and dense float arrays for power iteration.
// Returns normalized scores [0, 1] per UUID. O(iter × |E_sub|).
func (s *SQLiteStore[T]) PersonalizedPageRank(anchors map[uuid.UUID]float64, maxHops int, opts PageRankOpts) (map[uuid.UUID]float64, error) {
	if len(anchors) == 0 {
		return nil, nil
	}
	if opts.Damping == 0 {
		opts.Damping = 0.85
	}
	if opts.MaxIter == 0 {
		opts.MaxIter = 20
	}
	if maxHops == 0 {
		maxHops = 3
	}

	if err := s.warmCache(); err != nil {
		return nil, err
	}
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	maxIdx := s.registry.MaxIndex()
	if maxIdx == 0 {
		return nil, nil
	}

	// Dense personalization vector
	personalization := make([]float64, maxIdx)
	totalConf := 0.0
	for _, c := range anchors {
		totalConf += c
	}
	anchorCount := 0
	for uid, c := range anchors {
		if idx, ok := s.registry.Get(uid); ok {
			personalization[idx] = c / totalConf
			anchorCount++
		}
	}
	if anchorCount == 0 {
		return nil, nil
	}

	// BFS via Roaring bitmaps to collect reachable node set
	// Don't use pool for active/frontier - they're modified across iterations
	active := roaring.New()
	frontier := roaring.New()

	for uid := range anchors {
		if idx, ok := s.registry.Get(uid); ok {
			active.Add(idx)
			frontier.Add(idx)
		}
	}

	for hop := 0; hop < maxHops && !frontier.IsEmpty(); hop++ {
		next := roaring.New()
		it := frontier.Iterator()
		for it.HasNext() {
			node := it.Next()
			if adj, ok := s.cache.outEdges[node]; ok {
				next.Or(roaring.AndNot(adj.neighbors, active))
			}
		}
		if next.IsEmpty() {
			break
		}
		active.Or(next)
		frontier = next
	}

	// Dense power iteration on active subgraph
	scores := make([]float64, maxIdx)
	newScores := make([]float64, maxIdx)

	// Initialize from personalization
	it := active.Iterator()
	for it.HasNext() {
		idx := it.Next()
		scores[idx] = personalization[idx]
	}

	d := opts.Damping

	for iter := 0; iter < opts.MaxIter; iter++ {
		// Zero newScores for active nodes only
		rit := active.Iterator()
		for rit.HasNext() {
			newScores[rit.Next()] = 0
		}

		// Distribute scores to neighbors
		rit = active.Iterator()
		for rit.HasNext() {
			node := rit.Next()
			if adj, ok := s.cache.outEdges[node]; ok {
				degree := adj.neighbors.GetCardinality()
				if degree == 0 {
					continue
				}
				share := scores[node] / float64(degree)
				nit := adj.neighbors.Iterator()
				for nit.HasNext() {
					n := nit.Next()
					if active.Contains(n) {
						newScores[n] += share
					}
				}
			}
		}

		// Apply damping + personalization teleport
		rit = active.Iterator()
		for rit.HasNext() {
			idx := rit.Next()
			newScores[idx] = (1-d)*personalization[idx] + d*newScores[idx]
		}

		scores, newScores = newScores, scores // swap, zero alloc
	}

	// Anchor boost
	for uid, p := range anchors {
		if idx, ok := s.registry.Get(uid); ok {
			scores[idx] += p / totalConf
		}
	}

	// Normalize to [0, 1]
	maxScore := 0.0
	nit := active.Iterator()
	for nit.HasNext() {
		sc := scores[nit.Next()]
		if sc > maxScore {
			maxScore = sc
		}
	}

	result := make(map[uuid.UUID]float64, int(active.GetCardinality()))
	if maxScore > 0 {
		rit := active.Iterator()
		for rit.HasNext() {
			idx := rit.Next()
			sc := scores[idx]
			if sc < 1e-6 {
				continue
			}
			if uid, ok := s.registry.ReverseLookup(idx); ok {
				result[uid] = sc / maxScore
			}
		}
	}

	return result, nil
}
