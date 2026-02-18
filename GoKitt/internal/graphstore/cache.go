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

// bitmapAdjacency stores edges for a single vertex using efficient bitmaps for set ops.
type bitmapAdjacency struct {
	neighbors *roaring.Bitmap
	edges     map[uint32]graph.Edge[uuid.UUID]
}

func newBitmapAdjacency() *bitmapAdjacency {
	return &bitmapAdjacency{
		neighbors: roaring.NewBitmap(),
		edges:     make(map[uint32]graph.Edge[uuid.UUID]),
	}
}

type adjacencyCache[T any] struct {
	mu       sync.RWMutex
	vertices map[uuid.UUID]cachedVertex[T]

	// Index-based adjacency: uint32 -> *bitmapAdjacency
	outEdges map[uint32]*bitmapAdjacency
	inEdges  map[uint32]*bitmapAdjacency

	labels map[string]*roaring.Bitmap

	edgeCount atomic.Int64
	dirty     bool
}

func newAdjacencyCache[T any]() *adjacencyCache[T] {
	return &adjacencyCache[T]{
		vertices: make(map[uuid.UUID]cachedVertex[T]),
		outEdges: make(map[uint32]*bitmapAdjacency),
		inEdges:  make(map[uint32]*bitmapAdjacency),
		labels:   make(map[string]*roaring.Bitmap),
	}
}
