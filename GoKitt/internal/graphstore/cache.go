package graphstore

import (
	"sync"
	"sync/atomic"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
)

type cachedVertex[T any] struct {
	value      T
	properties graph.VertexProperties
}

// bitmapAdjacency stores neighbor connectivity using efficient bitmaps.
// Edge data is NOT stored here — it lives in the canonical edgeSlab.
type bitmapAdjacency struct {
	neighbors *roaring.Bitmap
}

func newBitmapAdjacency() *bitmapAdjacency {
	return &bitmapAdjacency{
		neighbors: roaring.NewBitmap(),
	}
}

// edgeKey computes a canonical uint64 key from two uint32 indices.
// Always stores min in high 32 bits, max in low 32 bits.
func edgeKey(u, v uint32) uint64 {
	if u <= v {
		return uint64(u)<<32 | uint64(v)
	}
	return uint64(v)<<32 | uint64(u)
}

// edgeSlab stores edges in a flat slice with O(1) lookup by canonical pair.
// This replaces the per-neighbor map[uint32]graph.Edge[uuid.UUID] that was
// duplicated 4x (outEdges × 2 directions + inEdges × 2 directions).
type edgeSlab struct {
	edges  []graph.Edge[uuid.UUID] // flat, append-only
	lookup map[uint64]uint32       // edgeKey(u,v) → slab index
}

func newEdgeSlab(capacity int) *edgeSlab {
	return &edgeSlab{
		edges:  make([]graph.Edge[uuid.UUID], 0, capacity),
		lookup: make(map[uint64]uint32, capacity),
	}
}

// Put stores an edge in the slab. Returns the slab index.
func (es *edgeSlab) Put(u, v uint32, edge graph.Edge[uuid.UUID]) uint32 {
	key := edgeKey(u, v)
	if idx, ok := es.lookup[key]; ok {
		es.edges[idx] = edge // update in place
		return idx
	}
	idx := uint32(len(es.edges))
	es.edges = append(es.edges, edge)
	es.lookup[key] = idx
	return idx
}

// Get retrieves an edge by canonical index pair.
func (es *edgeSlab) Get(u, v uint32) (graph.Edge[uuid.UUID], bool) {
	key := edgeKey(u, v)
	idx, ok := es.lookup[key]
	if !ok {
		return graph.Edge[uuid.UUID]{}, false
	}
	return es.edges[idx], true
}

// Remove marks an edge as removed (zero value in slab, deletes from lookup).
func (es *edgeSlab) Remove(u, v uint32) bool {
	key := edgeKey(u, v)
	idx, ok := es.lookup[key]
	if !ok {
		return false
	}
	es.edges[idx] = graph.Edge[uuid.UUID]{} // zero out
	delete(es.lookup, key)
	return true
}

// Len returns the number of active edges.
func (es *edgeSlab) Len() int {
	return len(es.lookup)
}

type adjacencyCache[T any] struct {
	mu       sync.RWMutex
	vertices map[uuid.UUID]cachedVertex[T]

	// Index-based adjacency: uint32 → *bitmapAdjacency (neighbors bitmap only)
	// Since graph is ALWAYS undirected (bidirectional edges), outEdges contains
	// all neighbors. inEdges is eliminated.
	outEdges map[uint32]*bitmapAdjacency

	// Canonical edge storage: 1 copy per edge (not 4).
	slab *edgeSlab

	labels map[string]*roaring.Bitmap

	edgeCount atomic.Int64
	dirty     bool
}

func newAdjacencyCache[T any]() *adjacencyCache[T] {
	return &adjacencyCache[T]{
		vertices: make(map[uuid.UUID]cachedVertex[T]),
		outEdges: make(map[uint32]*bitmapAdjacency),
		slab:     newEdgeSlab(0),
		labels:   make(map[string]*roaring.Bitmap),
	}
}
