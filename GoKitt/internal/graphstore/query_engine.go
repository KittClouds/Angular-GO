package graphstore

import (
	"fmt"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/google/uuid"
)

// StartQuery initializes a query execution plan.
func (s *SQLiteStore[T]) StartQuery() *QueryBuilder[T] {
	return &QueryBuilder[T]{store: s}
}

type QueryBuilder[T any] struct {
	store *SQLiteStore[T]
}

// But wait, the engine logic is generic. Let's make Execute a method on SQLiteStore.

// Execute runs the Mini-Datalog query.
func (s *SQLiteStore[T]) Execute(q Query) (*ResultSet, error) {
	if err := s.warmCache(); err != nil {
		return nil, err
	}
	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	// 0. Initialize Workspace
	// We need to find an initial set of candidates for each variable.
	// "Variables" are defined in Patterns.

	// Strategy:
	// 1. Find "anchor" patterns (those with IDFilter or restrictive LabelFilter).
	// 2. Perform initial fetches.
	// 3. Join.

	// SIMPLIFICATION for V1:
	// Assume strict ordering in q.Patterns/Edges matches execution order?
	// Or just a simple loop:

	// Map: VarName -> Candidate Bitmap (Indices)
	candidates := make(map[string]*roaring.Bitmap)

	// 1. Process Node Patterns (Unary Constraints)
	for _, p := range q.Patterns {
		// Start with universal set or empty?
		// If IDFilter is present -> Single bit.
		// If LabelFilter is present -> Label bitmap intersection.
		// If neither -> All nodes (expensive! avoid if possible).

		var current *roaring.Bitmap

		if p.IDFilter != nil {
			idx, ok := s.registry.Get(*p.IDFilter)
			current = roaring.New()
			if ok {
				current.Add(idx)
			}
		} else {
			// Start with All Nodes? Or Union of Labels?
			// If no labels, we might default to "All Vertices in Cache".
			if len(p.LabelFilter) > 0 {
				// Intersect all labels
				// For first label, copy bitmap. Subsequent, intersect.
				first := true
				for _, lbl := range p.LabelFilter {
					lBmp, ok := s.cache.labels[lbl]
					if !ok {
						// Label empty -> Empty result
						current = roaring.New()
						break
					}
					if first {
						current = lBmp.Clone()
						first = false
					} else {
						current.And(lBmp)
					}
				}
				if current == nil {
					current = roaring.New() // Should handle fallthrough logic properly
				}
			} else {
				// Wildcard node scan (select *) - Use all valid indices
				// We can get all from registry or cache keys.
				// For now, let's discourage this or implement efficient "All" bitmap.
				// We'll iterate vertices map keys.
				current = roaring.New()
				for idx := range s.cache.outEdges {
					current.Add(idx)
				}
				// Also check inEdges or registry.
				// Better: registry reverse map logic or track MaxIndex.
			}
		}

		candidates[p.Var] = current
	}

	// 2. Process Edge Patterns (Binary Constraints / Joins)
	// Output: Refine candidates based on connectivity.
	for _, e := range q.Edges {
		srcBmp, okSrc := candidates[e.SourceVar]
		tgtBmp, okTgt := candidates[e.TargetVar]

		if !okSrc || !okTgt {
			return nil, fmt.Errorf("edge pattern references unknown vars: %s -> %s", e.SourceVar, e.TargetVar)
		}

		// New Bitmaps for refinement
		nextSrc := roaring.New()
		nextTgt := roaring.New()

		// 1-Hop Logic
		// For each Src candidate, check out-neighbors.
		// Intersect neighbors with Tgt candidates.
		// If intersection non-empty, keep Src and keep the intersecting Tgts.

		it := srcBmp.Iterator()
		for it.HasNext() {
			uIdx := it.Next()

			adj, hasAdj := s.cache.outEdges[uIdx]
			if !hasAdj {
				continue
			}

			// Neighbors of U that are arguably in Tgt Logic
			// Intersection: adj.neighbors AND tgtBmp
			// We can use Roaring's And/Intersects

			// Optimization: Check if separate intersection is empty first?
			// Or just compute it.

			common := roaring.And(adj.neighbors, tgtBmp)
			if !common.IsEmpty() {
				nextSrc.Add(uIdx)
				nextTgt.Or(common)
			}
		}

		// Update candidates
		candidates[e.SourceVar] = nextSrc
		candidates[e.TargetVar] = nextTgt
	}

	// 3. Materialize Binding Rows
	// This is the "Unification" step to produce tuples.
	// Since we filtered down to valid sets, we now need to form the combinations.
	// This is effectively a Cartesian Product of remaining candidates filtered by edges?
	// No, checking edges above decoupled the "which source is connected to which target".
	// We lost the link (we just know "u is a valid source" and "v is a valid target").
	// We need to re-verify or build tuples during traversal.

	// REVISED STRATEGY for Tuple Generation:
	// Use a backtracking solver or iterative join.
	// Given we did pruning above (Waltz algorithm style filtering), the search space is small.
	// Let's implement a simple nested loop join over the filtered candidates.

	// Identify Vars order: Just use map iteration or passed order.
	vars := make([]string, 0, len(candidates))
	for v := range candidates {
		vars = append(vars, v)
	}

	results := make([]map[string]uuid.UUID, 0)

	// Recursive helper
	var solve func(idx int, currentBinding map[string]uint32)
	solve = func(idx int, currentBinding map[string]uint32) {
		if idx >= len(vars) {
			// Complete match found (indices), resolve to UUIDs
			row := make(map[string]uuid.UUID)
			for k, vIdx := range currentBinding {
				if id, ok := s.registry.ReverseLookup(vIdx); ok {
					row[k] = id
				}
			}
			results = append(results, row)
			return
		}

		vName := vars[idx]
		candBmp := candidates[vName]

		it := candBmp.Iterator()
		for it.HasNext() {
			val := it.Next()

			// Consistency Check against already bound vars
			// Check all Edge constraints involving vName AND any var in currentBinding
			consistent := true
			for _, e := range q.Edges {
				var other string
				var isSource bool

				if e.SourceVar == vName {
					other = e.TargetVar
					isSource = true
				} else if e.TargetVar == vName {
					other = e.SourceVar
					isSource = false
				} else {
					continue
				}

				if otherVal, bound := currentBinding[other]; bound {
					// Check connectivity
					if isSource {
						// val -> otherVal?
						adj, hasOut := s.cache.outEdges[val]
						if !hasOut || !adj.neighbors.Contains(otherVal) {
							consistent = false
							break
						}
					} else {
						// otherVal -> val?
						adj, hasOut := s.cache.outEdges[otherVal]
						if !hasOut || !adj.neighbors.Contains(val) {
							consistent = false
							break
						}
					}
				}
			}

			if consistent {
				currentBinding[vName] = val
				solve(idx+1, currentBinding)
				delete(currentBinding, vName)
			}
		}
	}

	solve(0, make(map[string]uint32))

	return &ResultSet{Bindings: results}, nil
}
