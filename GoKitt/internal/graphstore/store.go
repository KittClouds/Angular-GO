package graphstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/ncruces/go-sqlite3"
)

// SQLiteStore implements graph.Store backed by SQLite.
type SQLiteStore[T any] struct {
	db       *sql.DB
	registry *IndexRegistry
	cache    *adjacencyCache[T]
	enc      EncodeFunc[T]
	dec      DecodeFunc[T]

	Rules *RuleEngine[T] // Public access for rule definitions

	initOnce sync.Once
	initErr  error
}

// New creates a new SQLiteStore.
func New[T any](db *sql.DB, enc EncodeFunc[T], dec DecodeFunc[T]) *SQLiteStore[T] {
	// We'll initialize the registry lazily or panic if critical.
	// Since New doesn't return error, we panic on failure to create registry structure, which is rare (just allocation).
	// But actual loading happens in warmCache or explicit init.
	reg, err := NewIndexRegistry(db)
	if err != nil {
		panic(fmt.Errorf("failed to create index registry: %w", err))
	}

	s := &SQLiteStore[T]{
		db:       db,
		registry: reg,
		cache:    newAdjacencyCache[T](),
		enc:      enc,
		dec:      dec,
	}
	s.Rules = NewRuleEngine(s)
	return s
}

// NewJSON creates a new SQLiteStore using JSON encoding.
func NewJSON[T any](db *sql.DB) *SQLiteStore[T] {
	return New(db, JSONEncode[T], JSONDecode[T])
}

// canonical returns the two UUIDs in a deterministic order.
func canonical(a, b uuid.UUID) (uuid.UUID, uuid.UUID) {
	if a.String() < b.String() {
		return a, b
	}
	return b, a
}

// ensureInit ensures the registry is loaded.
func (s *SQLiteStore[T]) ensureInit() error {
	s.initOnce.Do(func() {
		s.initErr = s.registry.load()
	})
	return s.initErr
}

// warmCache loads the entire graph from SQLite into memory.
// It is called lazily on the first read operation.
func (s *SQLiteStore[T]) warmCache() error {
	if err := s.ensureInit(); err != nil {
		return err
	}

	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()

	if len(s.cache.vertices) > 0 && !s.cache.dirty {
		return nil
	}

	// Reset cache maps
	s.cache.vertices = make(map[uuid.UUID]cachedVertex[T])
	s.cache.outEdges = make(map[uint32]*bitmapAdjacency)
	s.cache.inEdges = make(map[uint32]*bitmapAdjacency)

	// Load vertices
	rows, err := s.db.Query("SELECT id, value, weight, attributes FROM graph_vertices")
	if err != nil {
		return fmt.Errorf("query vertices: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var idStr string
		var valueBlob []byte
		var weight int
		var attributesJSON string

		if err := rows.Scan(&idStr, &valueBlob, &weight, &attributesJSON); err != nil {
			return fmt.Errorf("scan vertex: %w", err)
		}

		id, err := uuid.Parse(idStr)
		if err != nil {
			return fmt.Errorf("parse vertex id: %w", err)
		}

		val, err := s.dec(valueBlob)
		if err != nil {
			return fmt.Errorf("decode vertex value: %w", err)
		}

		var attrs map[string]string
		if err := json.Unmarshal([]byte(attributesJSON), &attrs); err != nil {
			return fmt.Errorf("unmarshal vertex attributes: %w", err)
		}

		s.cache.vertices[id] = cachedVertex[T]{
			value: val,
			properties: graph.VertexProperties{
				Weight:     weight,
				Attributes: attrs,
			},
		}
	}

	// Load edges
	eRows, err := s.db.Query("SELECT source_id, target_id, weight, attributes, data FROM graph_edges")
	if err != nil {
		return fmt.Errorf("query edges: %w", err)
	}
	defer eRows.Close()

	ctx := context.Background()

	for eRows.Next() {
		var srcStr, tgtStr string
		var weight int
		var attributesJSON string
		var dataBlob []byte

		if err := eRows.Scan(&srcStr, &tgtStr, &weight, &attributesJSON, &dataBlob); err != nil {
			return fmt.Errorf("scan edge: %w", err)
		}

		src, err := uuid.Parse(srcStr)
		if err != nil {
			return fmt.Errorf("parse source id: %w", err)
		}
		tgt, err := uuid.Parse(tgtStr)
		if err != nil {
			return fmt.Errorf("parse target id: %w", err)
		}

		// Map to indices
		uIdx, err := s.registry.GetOrAssign(ctx, src)
		if err != nil {
			return fmt.Errorf("assign src index: %w", err)
		}
		vIdx, err := s.registry.GetOrAssign(ctx, tgt)
		if err != nil {
			return fmt.Errorf("assign tgt index: %w", err)
		}

		var attrs map[string]string
		if err := json.Unmarshal([]byte(attributesJSON), &attrs); err != nil {
			return fmt.Errorf("unmarshal edge attributes: %w", err)
		}

		var data any
		if len(dataBlob) > 0 {
			if err := json.Unmarshal(dataBlob, &data); err != nil {
				return fmt.Errorf("unmarshal edge data: %w", err)
			}
		}

		edge := graph.Edge[uuid.UUID]{
			Source: src,
			Target: tgt,
			Properties: graph.EdgeProperties{
				Weight:     weight,
				Attributes: attrs,
				Data:       data,
			},
		}

		// Helper to safely add to bitmap adjacency
		addToCache := func(maps map[uint32]*bitmapAdjacency, fromIdx, toIdx uint32, e graph.Edge[uuid.UUID]) {
			adj, ok := maps[fromIdx]
			if !ok {
				adj = newBitmapAdjacency()
				maps[fromIdx] = adj
			}
			adj.neighbors.Add(toIdx)
			adj.edges[toIdx] = e
		}

		// 1. Forward direction (Source -> Target)
		addToCache(s.cache.outEdges, uIdx, vIdx, edge)
		addToCache(s.cache.inEdges, vIdx, uIdx, edge)

		// 2. Reverse direction (Target -> Source) - same edge object
		reverseEdge := edge
		reverseEdge.Source = tgt
		reverseEdge.Target = src

		addToCache(s.cache.outEdges, vIdx, uIdx, reverseEdge)
		addToCache(s.cache.inEdges, uIdx, vIdx, reverseEdge)
	}

	// Load Labels
	lRows, err := s.db.Query("SELECT vertex_id, label FROM graph_vertex_labels")
	if err != nil {
		// Fallback for migration safety? No, strict schema update.
		return fmt.Errorf("query labels: %w", err)
	}
	defer lRows.Close()

	for lRows.Next() {
		var idStr, label string
		if err := lRows.Scan(&idStr, &label); err != nil {
			return fmt.Errorf("scan label: %w", err)
		}

		id, err := uuid.Parse(idStr)
		if err != nil {
			continue
		}

		idx, ok := s.registry.Get(id)
		if !ok {
			continue
		}

		bmp, ok := s.cache.labels[label]
		if !ok {
			bmp = roaring.New()
			s.cache.labels[label] = bmp
		}
		bmp.Add(idx)
	}

	s.cache.dirty = false
	return nil
}

func mapSQLiteErr(err error, notFoundErr, conflictErr error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return notFoundErr
	}
	var sqlErr *sqlite3.Error
	if errors.As(err, &sqlErr) {
		if sqlErr.ExtendedCode() == sqlite3.CONSTRAINT_PRIMARYKEY {
			return conflictErr
		}
	}
	return err
}
