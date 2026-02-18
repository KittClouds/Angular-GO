// Package node provides the HNSW node structure
// Ported from Rust HNSW implementation
package node

import (
	"github.com/kittclouds/gokitt/pkg/hnsw/distance"
)

// HnswNode represents a single node in the HNSW graph
// Equivalent to Rust: HnswNode struct
type HnswNode struct {
	ID        uint32    // Node identifier
	Level     uint8     // Maximum level this node exists at
	Vector    []float32 // Full-precision vector
	Neighbors [][]int32 // Neighbors per level (signed for sentinel values)
	Deleted   bool      // Soft-delete flag

	// Cached values (lazy computation)
	magnitude  float32   // Cached magnitude
	magCached  bool      // Whether magnitude is cached
	normalized []float32 // Cached normalized vector
}

// NewNode creates a new HnswNode with pre-allocated neighbor lists
// maxLayers specifies the number of layers to pre-allocate neighbor lists for
// Usually maxLayers corresponds to the node's assigned max level + 1
func NewNode(id uint32, level uint8, vector []float32, maxLayers int) *HnswNode {
	neighbors := make([][]int32, maxLayers)
	for i := range neighbors {
		neighbors[i] = make([]int32, 0)
	}

	return &HnswNode{
		ID:         id,
		Level:      level,
		Vector:     vector,
		Neighbors:  neighbors,
		Deleted:    false,
		magnitude:  0,
		magCached:  false,
		normalized: nil,
	}
}

// GetMagnitude returns the L2 norm of the vector, cached for efficiency
func (n *HnswNode) GetMagnitude() float32 {
	if n.magCached {
		return n.magnitude
	}
	n.magnitude = distance.Magnitude(n.Vector)
	n.magCached = true
	return n.magnitude
}

// GetNormalized returns a copy of the normalized vector, cached for efficiency
// Returns nil if the vector has zero magnitude
func (n *HnswNode) GetNormalized() []float32 {
	// Return cached if available
	if n.normalized != nil {
		// Return a copy to avoid mutation
		result := make([]float32, len(n.normalized))
		copy(result, n.normalized)
		return result
	}

	mag := n.GetMagnitude()
	if mag == 0 {
		return nil
	}

	// Compute and cache normalized vector
	n.normalized = make([]float32, len(n.Vector))
	for i, v := range n.Vector {
		n.normalized[i] = v / mag
	}

	// Return a copy
	result := make([]float32, len(n.normalized))
	copy(result, n.normalized)
	return result
}

// AddNeighbor adds a neighbor ID to the specified layer
func (n *HnswNode) AddNeighbor(layer int, neighborID int32) {
	if layer < 0 || layer >= len(n.Neighbors) {
		return // Ignore invalid layer
	}

	// Check for duplicates
	for _, id := range n.Neighbors[layer] {
		if id == neighborID {
			return // Already exists
		}
	}

	n.Neighbors[layer] = append(n.Neighbors[layer], neighborID)
}

// GetNeighbors returns the neighbors at the specified level
// Returns nil if level is out of bounds
func (n *HnswNode) GetNeighbors(level uint8) []int32 {
	if int(level) >= len(n.Neighbors) {
		return nil
	}
	return n.Neighbors[level]
}

// NeighborCount returns the number of neighbors at the specified level
func (n *HnswNode) NeighborCount(level uint8) int {
	if int(level) >= len(n.Neighbors) {
		return 0
	}
	return len(n.Neighbors[level])
}

// ClearCache invalidates cached magnitude and normalized vector
// Call this if the vector is modified
func (n *HnswNode) ClearCache() {
	n.magCached = false
	n.magnitude = 0
	n.normalized = nil
}

// Clone creates a deep copy of the node
func (n *HnswNode) Clone() *HnswNode {
	// Copy vector
	vector := make([]float32, len(n.Vector))
	copy(vector, n.Vector)

	// Copy neighbors
	neighbors := make([][]int32, len(n.Neighbors))
	for i, layer := range n.Neighbors {
		neighbors[i] = make([]int32, len(layer))
		copy(neighbors[i], layer)
	}

	// Copy normalized if cached
	var normalized []float32
	if n.normalized != nil {
		normalized = make([]float32, len(n.normalized))
		copy(normalized, n.normalized)
	}

	return &HnswNode{
		ID:         n.ID,
		Level:      n.Level,
		Vector:     vector,
		Neighbors:  neighbors,
		Deleted:    n.Deleted,
		magnitude:  n.magnitude,
		magCached:  n.magCached,
		normalized: normalized,
	}
}
