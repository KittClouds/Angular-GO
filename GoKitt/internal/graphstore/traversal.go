package graphstore

import (
	"context"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/google/uuid"
)

type TraversalDirection int

const (
	DirectionOutbound TraversalDirection = iota
	DirectionInbound
	DirectionBoth
)

type TraversalStrategy int

const (
	StrategyBFS TraversalStrategy = iota
	StrategyDFS                   // Placeholder for future implementation
)

type TraversalOptions struct {
	Root       uuid.UUID
	Direction  TraversalDirection
	MinDepth   int
	MaxDepth   int // -1 = unbounded
	EdgeFilter *EdgePattern
	NodeFilter *NodePattern
	Strategy   TraversalStrategy
}

type TraversalResult struct {
	Path   []uuid.UUID
	Depth  int
	Weight float64
}

// Traverse executes a graph traversal using the specified options.
// It returns a channel of results, closed when the traversal completes or context is canceled.
func (s *SQLiteStore[T]) Traverse(ctx context.Context, opts TraversalOptions) <-chan TraversalResult {
	out := make(chan TraversalResult)

	go func() {
		defer close(out)

		if err := s.warmCache(); err != nil {
			return
		}

		s.cache.mu.RLock()
		defer s.cache.mu.RUnlock()

		rootIdx, ok := s.registry.Get(opts.Root)
		if !ok {
			return
		}

		// Pre-compute Label Filter Bitmap if needed
		var labelFilter *roaring.Bitmap
		if opts.NodeFilter != nil && len(opts.NodeFilter.LabelFilter) > 0 {
			// Start with first label's bitmap or empty
			first := true
			for _, lbl := range opts.NodeFilter.LabelFilter {
				if lBmp, ok := s.cache.labels[lbl]; ok {
					if first {
						labelFilter = lBmp.Clone()
						first = false
					} else {
						labelFilter.Or(lBmp) // Union of allowed labels? Or Intersection? usually OR for "has label X or Y"
						// Actually usually LabelFilter list means "has ANY of these labels".
						// Let's assume OR.
					}
				}
			}
			// If no labels matched, filter is empty -> block everything?
			if first {
				labelFilter = roaring.New() // Empty, blocks all
			}
		}

		// Visited set (Bitmap) - don't use pool, reassigned in loop
		visited := roaring.New()
		visited.Add(rootIdx)

		// Frontier (Bitmap) for BFS - don't use pool, reassigned in loop
		frontier := roaring.New()
		frontier.Add(rootIdx)

		// Parent map for path reconstruction: childIdx -> parentIdx
		parents := make(map[uint32]uint32)

		// Initial path for root
		if opts.MinDepth <= 0 {
			select {
			case out <- TraversalResult{
				Path:  []uuid.UUID{opts.Root},
				Depth: 0,
			}:
			case <-ctx.Done():
				return
			}
		}

		depth := 0
		for !frontier.IsEmpty() {
			if opts.MaxDepth >= 0 && depth >= opts.MaxDepth {
				break
			}
			depth++

			nextFrontier := roaring.New()

			// Iterate current frontier
			it := frontier.Iterator()
			for it.HasNext() {
				uIdx := it.Next()

				// Select adjacency based on direction
				var neighbors *roaring.Bitmap

				switch opts.Direction {
				case DirectionOutbound, DirectionBoth:
					// Optimization: Since graph is stored undirected (bidirectional edges),
					// outEdges contains all neighbors.
					if adj, ok := s.cache.outEdges[uIdx]; ok {
						neighbors = adj.neighbors
					}
				case DirectionInbound:
					// Graph is always undirected: outEdges contains all neighbors.
					if adj, ok := s.cache.outEdges[uIdx]; ok {
						neighbors = adj.neighbors
					}
				}

				if neighbors == nil || neighbors.IsEmpty() {
					continue
				}

				// Incremental expansion: New = Neighbors - Visited
				newNeighbors := roaring.AndNot(neighbors, visited)

				// Apply Label Filter immediately
				if labelFilter != nil {
					newNeighbors.And(labelFilter)
				}

				if newNeighbors.IsEmpty() {
					continue
				}

				nIt := newNeighbors.Iterator()
				for nIt.HasNext() {
					vIdx := nIt.Next()

					// Apply Edge Filter (if any)
					if opts.EdgeFilter != nil {
						// Retrieve edge from slab
						if edge, ok := s.cache.slab.Get(uIdx, vIdx); ok {
							// Placeholder for actual filter logic
							// if !opts.EdgeFilter.Match(edge) { continue }
							_ = edge // use it
						}
					}

					// Update parent if not already set for this wave
					// nextFrontier does not contain duplicates due to bitmap property
					// parents map logic: first parent wins
					if !nextFrontier.Contains(vIdx) {
						parents[vIdx] = uIdx
						nextFrontier.Add(vIdx)
					}
				}
			}

			if nextFrontier.IsEmpty() {
				break
			}

			// Emit Results
			fit := nextFrontier.Iterator()
			for fit.HasNext() {
				vIdx := fit.Next()

				// Reconstruct Path
				var path []uuid.UUID
				curr := vIdx
				for {
					id, found := s.registry.ReverseLookup(curr)
					if found {
						path = append([]uuid.UUID{id}, path...) // Prepend
					}
					if p, ok := parents[curr]; ok {
						curr = p
					} else {
						if curr == rootIdx {
							// root already processed
						}
						break
					}
					if curr == rootIdx {
						id, found := s.registry.ReverseLookup(rootIdx)
						if found {
							path = append([]uuid.UUID{id}, path...)
						}
						break
					}
				}

				if depth >= opts.MinDepth {
					val := TraversalResult{
						Path:  path,
						Depth: depth,
					}

					select {
					case out <- val:
					case <-ctx.Done():
						return
					}
				}
			}

			visited.Or(nextFrontier)
			frontier = nextFrontier
		}
	}()

	return out
}
