// Package hnsw provides Hierarchical Navigable Small World graph for approximate nearest neighbor search
package hnsw

import (
	"container/heap"
	"math"
	"math/rand"

	"github.com/kittclouds/gokitt/pkg/hnsw/distance"
	"github.com/kittclouds/gokitt/pkg/hnsw/node"
	"github.com/kittclouds/gokitt/pkg/hnsw/pqueue"
)

// Metric defines distance metric
type Metric int

const (
	Cosine Metric = iota
	Euclidean
)

// HnswError defines index errors
type HnswError int

const (
	ErrDuplicateID HnswError = iota
	ErrDimensionMismatch
	ErrEmptyVector
	ErrSerialization
)

func (e HnswError) Error() string {
	switch e {
	case ErrDuplicateID:
		return "duplicate node ID"
	case ErrDimensionMismatch:
		return "dimension mismatch"
	case ErrEmptyVector:
		return "empty vector"
	case ErrSerialization:
		return "serialization error"
	default:
		return "unknown error"
	}
}

// Result is a search result
type Result struct {
	ID    uint32
	Score float32
}

// Index is the main HNSW index
type Index struct {
	// Configuration
	M              int     // Max neighbors per level
	MMax0          int     // Max neighbors at level 0 (usually 2*M)
	EfConstruction int     // Search beam width during construction
	LevelMult      float32 // Level generation multiplier (1/ln(M))
	Metric         Metric

	// State
	Nodes        map[uint32]*node.HnswNode
	EntryPointID *uint32
	LevelMax     uint8
	dimension    *int

	// RNG state
	rng *rand.Rand
}

// NewIndex creates a new HNSW index
func NewIndex(m, efConstruction int, metric Metric) *Index {
	levelMult := 1.0 / float32(math.Log(float64(m)))

	return &Index{
		M:              m,
		MMax0:          m * 2,
		EfConstruction: efConstruction,
		LevelMult:      levelMult,
		Metric:         metric,
		Nodes:          make(map[uint32]*node.HnswNode),
		EntryPointID:   nil,
		LevelMax:       0,
		dimension:      nil,
		rng:            rand.New(rand.NewSource(42)), // Deterministic seed
	}
}

// NewIndexDefault creates a new HNSW index with default parameters
func NewIndexDefault() *Index {
	return NewIndex(16, 200, Cosine)
}

// AddPoint adds a point to the index
func (h *Index) AddPoint(id uint32, vector []float32) error {
	// Validation
	if len(vector) == 0 {
		return ErrEmptyVector
	}

	if _, exists := h.Nodes[id]; exists {
		return ErrDuplicateID
	}

	if h.dimension != nil {
		if len(vector) != *h.dimension {
			return ErrDimensionMismatch
		}
	} else {
		dim := len(vector)
		h.dimension = &dim
	}

	// Select random level for this node
	level := h.selectLevel()

	// Create node with neighbor lists for all levels up to `level`
	n := node.NewNode(id, level, vector, int(level)+1)

	// First node case
	if h.EntryPointID == nil {
		h.EntryPointID = &id
		h.LevelMax = level
		h.Nodes[id] = n
		return nil
	}

	// Get entry point
	epID := *h.EntryPointID

	// Insert the node first so we can reference it
	h.Nodes[id] = n

	// Phase 1: Traverse from top to node's level + 1 (greedy search)
	currentLevel := int(h.LevelMax)
	for currentLevel > int(level) {
		nearestID := h.searchLayerSingle(epID, id, uint8(currentLevel))
		epID = nearestID
		currentLevel--
	}

	// Phase 2: Insert at each level from node's level down to 0
	for lc := int(level); lc >= 0; lc-- {
		// Find efConstruction nearest neighbors at this level
		neighbors := h.searchLayer(epID, id, h.EfConstruction, uint8(lc))

		// Select M best neighbors
		mLimit := h.M
		if lc == 0 {
			mLimit = h.MMax0
		}

		selected := make([]uint32, 0, mLimit)
		for i := 0; i < len(neighbors) && i < mLimit; i++ {
			selected = append(selected, neighbors[i].ID)
		}

		// Add bidirectional connections
		for _, neighborID := range selected {
			// Add neighbor -> new node
			h.addNeighbor(neighborID, id, uint8(lc))
			// Add new node -> neighbor
			h.addNeighbor(id, neighborID, uint8(lc))
		}

		// Prune neighbors if over limit
		for _, neighborID := range selected {
			h.pruneNeighbors(neighborID, uint8(lc), mLimit)
		}

		// Update entry point for next level
		if len(neighbors) > 0 {
			epID = neighbors[0].ID
		}
	}

	// Update global entry point if new node is higher level
	if level > h.LevelMax {
		h.EntryPointID = &id
		h.LevelMax = level
	}

	return nil
}

// SearchKNN searches for k nearest neighbors
func (h *Index) SearchKNN(query []float32, k int) []Result {
	if len(h.Nodes) == 0 || h.EntryPointID == nil {
		return []Result{}
	}

	epID := *h.EntryPointID

	// Phase 1: Traverse from top to level 1 (greedy)
	currentLevel := int(h.LevelMax)
	for currentLevel > 0 {
		nearestID := h.searchLayerSingleQuery(epID, query, uint8(currentLevel))
		epID = nearestID
		currentLevel--
	}

	// Phase 2: Search at level 0 with ef = max(k, ef_construction)
	ef := k
	if ef < h.EfConstruction {
		ef = h.EfConstruction
	}
	candidates := h.searchLayerQuery(epID, query, ef, 0)

	// Return top k, filtered by deleted flag
	// Convert distance to similarity score
	results := make([]Result, 0, k)
	for _, c := range candidates {
		if n, ok := h.Nodes[c.ID]; ok && !n.Deleted {
			// Convert distance to similarity
			score := h.distanceToSimilarity(c.Score)
			results = append(results, Result{ID: c.ID, Score: score})
			if len(results) >= k {
				break
			}
		}
	}

	return results
}

// SearchKNNFiltered searches with a filter predicate
func (h *Index) SearchKNNFiltered(query []float32, k int, filter func(uint32) bool) []Result {
	if len(h.Nodes) == 0 || h.EntryPointID == nil {
		return []Result{}
	}

	epID := *h.EntryPointID

	// Phase 1: Traverse from top to level 1 (greedy)
	currentLevel := int(h.LevelMax)
	for currentLevel > 0 {
		nearestID := h.searchLayerSingleQuery(epID, query, uint8(currentLevel))
		epID = nearestID
		currentLevel--
	}

	// Phase 2: Search at level 0 with expanded ef to account for filtering
	ef := k * 4
	if ef < h.EfConstruction {
		ef = h.EfConstruction
	}
	candidates := h.searchLayerQuery(epID, query, ef, 0)

	// Return top k that pass both deletion check and user filter
	// Convert distance to similarity score
	results := make([]Result, 0, k)
	for _, c := range candidates {
		if n, ok := h.Nodes[c.ID]; ok && !n.Deleted && filter(c.ID) {
			score := h.distanceToSimilarity(c.Score)
			results = append(results, Result{ID: c.ID, Score: score})
			if len(results) >= k {
				break
			}
		}
	}

	return results
}

// DeletePoint soft-deletes a point
func (h *Index) DeletePoint(id uint32) {
	if n, ok := h.Nodes[id]; ok {
		n.Deleted = true
	}
}

// UpsertPoint adds or updates a point. If the ID exists, the old node is replaced.
// This is useful for document updates where the vector may change.
func (h *Index) UpsertPoint(id uint32, vector []float32) error {
	// Validation
	if len(vector) == 0 {
		return ErrEmptyVector
	}

	if h.dimension != nil {
		if len(vector) != *h.dimension {
			return ErrDimensionMismatch
		}
	} else {
		dim := len(vector)
		h.dimension = &dim
	}

	// Remove old node if exists (soft delete won't work for updates, need to replace)
	// delete() is safe to call on non-existent keys
	delete(h.Nodes, id)

	// Add new node using AddPoint logic
	return h.AddPoint(id, vector)
}

// GetVector returns the vector for a specific node by ID
func (h *Index) GetVector(id uint32) ([]float32, bool) {
	if n, ok := h.Nodes[id]; ok {
		return n.Vector, true
	}
	return nil, false
}

// Len returns the number of points
func (h *Index) Len() int {
	return len(h.Nodes)
}

// IsEmpty returns true if the index is empty
func (h *Index) IsEmpty() bool {
	return len(h.Nodes) == 0
}

// Dimension returns the dimension of vectors in the index
func (h *Index) Dimension() int {
	if h.dimension == nil {
		return 0
	}
	return *h.dimension
}

// selectLevel selects a random level for a new node
func (h *Index) selectLevel() uint8 {
	// Use exponential distribution: P(level = l) = (1/M) * (1 - 1/M)^l
	// Simplified: level = floor(-ln(uniform) * levelMult)
	r := h.rng.Float32()
	level := uint8(-math.Log(float64(r)) * float64(h.LevelMult))

	// Cap at reasonable maximum (typically log(N) levels)
	if level > 16 {
		level = 16
	}

	return level
}

// searchLayerSingle finds the single nearest neighbor in a layer (for insertion)
func (h *Index) searchLayerSingle(epID, nodeID uint32, level uint8) uint32 {
	visited := make(map[uint32]bool)
	visited[epID] = true
	visited[nodeID] = true // Don't return to the node being inserted

	current := epID
	currentDist := h.nodeDistance(nodeID, current)

	changed := true
	for changed {
		changed = false
		if n, ok := h.Nodes[current]; ok {
			neighbors := n.GetNeighbors(level)
			for _, neighborID := range neighbors {
				if neighborID < 0 {
					continue // Skip sentinel values
				}
				nid := uint32(neighborID)
				if visited[nid] {
					continue
				}
				visited[nid] = true

				dist := h.nodeDistance(nodeID, nid)
				if dist < currentDist {
					current = nid
					currentDist = dist
					changed = true
				}
			}
		}
	}

	return current
}

// searchLayerSingleQuery finds the single nearest neighbor in a layer (for query)
func (h *Index) searchLayerSingleQuery(epID uint32, query []float32, level uint8) uint32 {
	visited := make(map[uint32]bool)
	visited[epID] = true

	current := epID
	currentDist := h.queryDistance(query, current)

	changed := true
	for changed {
		changed = false
		if n, ok := h.Nodes[current]; ok {
			neighbors := n.GetNeighbors(level)
			for _, neighborID := range neighbors {
				if neighborID < 0 {
					continue
				}
				nid := uint32(neighborID)
				if visited[nid] {
					continue
				}
				visited[nid] = true

				dist := h.queryDistance(query, nid)
				if dist < currentDist {
					current = nid
					currentDist = dist
					changed = true
				}
			}
		}
	}

	return current
}

// searchLayer finds ef nearest neighbors in a layer (for insertion)
func (h *Index) searchLayer(epID, nodeID uint32, ef int, level uint8) []pqueue.ScoredItem {
	visited := make(map[uint32]bool)
	visited[epID] = true
	visited[nodeID] = true

	// Min-heap for candidates (closest first)
	candidates := &pqueue.MinHeap{}
	heap.Init(candidates)
	heap.Push(candidates, pqueue.ScoredItem{ID: epID, Score: h.nodeDistance(nodeID, epID)})

	// Max-heap for results (keep track of worst)
	results := &pqueue.MaxHeap{}
	heap.Init(results)
	heap.Push(results, pqueue.ScoredItem{ID: epID, Score: h.nodeDistance(nodeID, epID)})

	for candidates.Len() > 0 {
		// Get closest candidate
		c := heap.Pop(candidates).(pqueue.ScoredItem)

		// If closest candidate is farther than worst result, stop
		if results.Len() > 0 {
			worst := (*results)[0]
			if c.Score > worst.Score {
				break
			}
		}

		// Explore neighbors
		if n, ok := h.Nodes[c.ID]; ok {
			neighbors := n.GetNeighbors(level)
			for _, neighborID := range neighbors {
				if neighborID < 0 {
					continue
				}
				nid := uint32(neighborID)
				if visited[nid] {
					continue
				}
				visited[nid] = true

				dist := h.nodeDistance(nodeID, nid)

				// Add to candidates if closer than worst result or results not full
				if results.Len() < ef || dist < (*results)[0].Score {
					heap.Push(candidates, pqueue.ScoredItem{ID: nid, Score: dist})
					heap.Push(results, pqueue.ScoredItem{ID: nid, Score: dist})

					// Keep results bounded
					for results.Len() > ef {
						heap.Pop(results)
					}
				}
			}
		}
	}

	// Extract results sorted by distance (ascending)
	sorted := make([]pqueue.ScoredItem, results.Len())
	for i := results.Len() - 1; i >= 0; i-- {
		sorted[i] = heap.Pop(results).(pqueue.ScoredItem)
	}

	return sorted
}

// searchLayerQuery finds ef nearest neighbors in a layer (for query)
func (h *Index) searchLayerQuery(epID uint32, query []float32, ef int, level uint8) []pqueue.ScoredItem {
	visited := make(map[uint32]bool)
	visited[epID] = true

	// Min-heap for candidates (closest first)
	candidates := &pqueue.MinHeap{}
	heap.Init(candidates)
	heap.Push(candidates, pqueue.ScoredItem{ID: epID, Score: h.queryDistance(query, epID)})

	// Max-heap for results (keep track of worst)
	results := &pqueue.MaxHeap{}
	heap.Init(results)
	heap.Push(results, pqueue.ScoredItem{ID: epID, Score: h.queryDistance(query, epID)})

	for candidates.Len() > 0 {
		// Get closest candidate
		c := heap.Pop(candidates).(pqueue.ScoredItem)

		// If closest candidate is farther than worst result, stop
		if results.Len() > 0 {
			worst := (*results)[0]
			if c.Score > worst.Score {
				break
			}
		}

		// Explore neighbors
		if n, ok := h.Nodes[c.ID]; ok {
			neighbors := n.GetNeighbors(level)
			for _, neighborID := range neighbors {
				if neighborID < 0 {
					continue
				}
				nid := uint32(neighborID)
				if visited[nid] {
					continue
				}
				visited[nid] = true

				dist := h.queryDistance(query, nid)

				// Add to candidates if closer than worst result or results not full
				if results.Len() < ef || dist < (*results)[0].Score {
					heap.Push(candidates, pqueue.ScoredItem{ID: nid, Score: dist})
					heap.Push(results, pqueue.ScoredItem{ID: nid, Score: dist})

					// Keep results bounded
					for results.Len() > ef {
						heap.Pop(results)
					}
				}
			}
		}
	}

	// Extract results sorted by distance (ascending)
	sorted := make([]pqueue.ScoredItem, results.Len())
	for i := results.Len() - 1; i >= 0; i-- {
		sorted[i] = heap.Pop(results).(pqueue.ScoredItem)
	}

	return sorted
}

// addNeighbor adds a bidirectional neighbor connection
func (h *Index) addNeighbor(fromID, toID uint32, level uint8) {
	if n, ok := h.Nodes[fromID]; ok {
		n.AddNeighbor(int(level), int32(toID))
	}
}

// pruneNeighbors removes excess neighbors
func (h *Index) pruneNeighbors(nodeID uint32, level uint8, maxNeighbors int) {
	n, ok := h.Nodes[nodeID]
	if !ok {
		return
	}

	neighbors := n.GetNeighbors(level)
	if len(neighbors) <= maxNeighbors {
		return
	}

	// Simple pruning: keep closest neighbors
	type neighborDist struct {
		id   uint32
		dist float32
	}

	dists := make([]neighborDist, 0, len(neighbors))
	for _, nid := range neighbors {
		if nid < 0 {
			continue
		}
		dist := h.nodeDistance(nodeID, uint32(nid))
		dists = append(dists, neighborDist{id: uint32(nid), dist: dist})
	}

	// Sort by distance (ascending)
	for i := 0; i < len(dists); i++ {
		for j := i + 1; j < len(dists); j++ {
			if dists[j].dist < dists[i].dist {
				dists[i], dists[j] = dists[j], dists[i]
			}
		}
	}

	// Keep only maxNeighbors
	if len(dists) > maxNeighbors {
		dists = dists[:maxNeighbors]
	}

	// Update neighbors
	newNeighbors := make([][]int32, len(n.Neighbors))
	for i := range newNeighbors {
		newNeighbors[i] = n.Neighbors[i]
	}
	newNeighbors[level] = make([]int32, len(dists))
	for i, d := range dists {
		newNeighbors[level][i] = int32(d.id)
	}
	n.Neighbors = newNeighbors
}

// nodeDistance computes distance between two nodes
func (h *Index) nodeDistance(id1, id2 uint32) float32 {
	n1, ok1 := h.Nodes[id1]
	n2, ok2 := h.Nodes[id2]
	if !ok1 || !ok2 {
		return float32(math.Inf(1))
	}

	return h.computeDistance(n1.Vector, n2.Vector)
}

// queryDistance computes distance between query and a node
func (h *Index) queryDistance(query []float32, nodeID uint32) float32 {
	n, ok := h.Nodes[nodeID]
	if !ok {
		return float32(math.Inf(1))
	}

	return h.computeDistance(query, n.Vector)
}

// computeDistance computes distance based on metric
func (h *Index) computeDistance(a, b []float32) float32 {
	switch h.Metric {
	case Cosine:
		// Convert cosine similarity to distance: distance = 1 - similarity
		sim := distance.CosineSimilarity(a, b, 0, 0)
		return 1 - sim
	case Euclidean:
		return distance.EuclideanDistanceSquared(a, b)
	default:
		return 1 - distance.CosineSimilarity(a, b, 0, 0)
	}
}

// distanceToSimilarity converts distance back to similarity score
func (h *Index) distanceToSimilarity(dist float32) float32 {
	switch h.Metric {
	case Cosine:
		// Distance was 1 - similarity, so similarity = 1 - distance
		return 1 - dist
	case Euclidean:
		// Convert L2 distance to similarity: 1 / (1 + sqrt(dist))
		return 1.0 / (1.0 + float32(math.Sqrt(float64(dist))))
	default:
		return 1 - dist
	}
}
