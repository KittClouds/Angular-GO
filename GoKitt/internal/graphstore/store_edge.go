package graphstore

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
)

func (s *SQLiteStore[T]) AddEdge(sourceHash, targetHash uuid.UUID, edge graph.Edge[uuid.UUID]) error {
	if err := s.warmCache(); err != nil {
		return err
	}

	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()

	// 1. Check vertices exist
	if _, ok := s.cache.vertices[sourceHash]; !ok {
		return graph.ErrVertexNotFound
	}
	if _, ok := s.cache.vertices[targetHash]; !ok {
		return graph.ErrVertexNotFound
	}

	// 2. Get Indices
	ctx := context.Background()
	uIdx, err := s.registry.GetOrAssign(ctx, sourceHash)
	if err != nil {
		return err
	}
	vIdx, err := s.registry.GetOrAssign(ctx, targetHash)
	if err != nil {
		return err
	}

	// 3. Canonical keys for DB
	u, v := canonical(sourceHash, targetHash)

	var dataBlob []byte
	if edge.Properties.Data != nil {
		dataBlob, err = json.Marshal(edge.Properties.Data)
		if err != nil {
			return fmt.Errorf("marshal data: %w", err)
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Extract edge type
	edgeType := "default"
	if t, ok := edge.Properties.Attributes["type"]; ok {
		edgeType = t
	}

	// 5. DB Insert (Attributes JSON is empty struct '{}')
	// We add explicit edge_type
	_, err = tx.Exec(`
		INSERT INTO graph_edges (source_id, target_id, weight, attributes, data, edge_type)
		VALUES (?, ?, ?, '{}', ?, ?)
	`, u.String(), v.String(), edge.Properties.Weight, dataBlob, edgeType)

	if err != nil {
		return mapSQLiteErr(err, nil, graph.ErrEdgeAlreadyExists)
	}

	// 6. Insert Properties
	if len(edge.Properties.Attributes) > 0 {
		stmt, err := tx.Prepare(`INSERT INTO graph_properties (owner_id, owner_type, key, value_type, value_blob, valid_from, valid_until, txn_id) VALUES (?, 'edge', ?, ?, ?, ?, NULL, ?)`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		// Canonical edge ID for properties: "src:tgt"
		edgeID := u.String() + ":" + v.String()
		now := time.Now().UnixMilli()

		for k, v := range edge.Properties.Attributes {
			pVal := ParseFromString(v)
			_, err := stmt.Exec(edgeID, k, string(pVal.Type), pVal.Raw, now, 0)
			if err != nil {
				return fmt.Errorf("insert property %s: %w", k, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// 7. Update Cache (Bidirectional)
	fwd := edge
	fwd.Source = sourceHash
	fwd.Target = targetHash

	rev := edge
	rev.Source = targetHash
	rev.Target = sourceHash

	addToCache := func(maps map[uint32]*bitmapAdjacency, fromIdx, toIdx uint32, e graph.Edge[uuid.UUID]) {
		adj, ok := maps[fromIdx]
		if !ok {
			adj = newBitmapAdjacency()
			maps[fromIdx] = adj
		}
		adj.neighbors.Add(toIdx)
		adj.edges[toIdx] = e
	}

	addToCache(s.cache.outEdges, uIdx, vIdx, fwd)
	addToCache(s.cache.inEdges, vIdx, uIdx, fwd)

	addToCache(s.cache.outEdges, vIdx, uIdx, rev)
	addToCache(s.cache.inEdges, uIdx, vIdx, rev)

	// Update edge count (new edge)
	s.cache.edgeCount.Add(1)

	return nil
}

func (s *SQLiteStore[T]) UpdateEdge(sourceHash, targetHash uuid.UUID, edge graph.Edge[uuid.UUID]) error {
	if err := s.warmCache(); err != nil {
		return err
	}

	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()

	uIdx, ok := s.registry.Get(sourceHash)
	if !ok {
		return graph.ErrVertexNotFound
	}
	vIdx, ok := s.registry.Get(targetHash)
	if !ok {
		return graph.ErrVertexNotFound
	}

	// Check existence via cache
	if adj, ok := s.cache.outEdges[uIdx]; !ok || !adj.neighbors.Contains(vIdx) {
		return graph.ErrEdgeNotFound
	}

	u, v := canonical(sourceHash, targetHash)

	var dataBlob []byte
	var err error // FIX: Declare err here
	if edge.Properties.Data != nil {
		dataBlob, err = json.Marshal(edge.Properties.Data)
		if err != nil {
			return fmt.Errorf("marshal data: %w", err)
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Extract edge type
	edgeType := "default"
	if t, ok := edge.Properties.Attributes["type"]; ok {
		edgeType = t
	}

	// DB Update
	res, err := tx.Exec(`
		UPDATE graph_edges 
		SET weight=?, data=?, edge_type=?
		WHERE source_id=? AND target_id=?
	`, edge.Properties.Weight, dataBlob, edgeType, u.String(), v.String())

	if err != nil {
		return err
	}

	if n, _ := res.RowsAffected(); n == 0 {
		return graph.ErrEdgeNotFound
	}

	// Update Properties - Close old and Insert New
	edgeID := u.String() + ":" + v.String()
	now := time.Now().UnixMilli()

	// Close old
	_, err = tx.Exec("UPDATE graph_properties SET valid_until = ? WHERE owner_id = ? AND owner_type = 'edge' AND valid_until IS NULL", now, edgeID)
	if err != nil {
		return err
	}

	if len(edge.Properties.Attributes) > 0 {
		stmt, err := tx.Prepare(`INSERT INTO graph_properties (owner_id, owner_type, key, value_type, value_blob, valid_from, valid_until, txn_id) VALUES (?, 'edge', ?, ?, ?, ?, NULL, ?)`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for k, v := range edge.Properties.Attributes {
			pVal := ParseFromString(v)
			_, err := stmt.Exec(edgeID, k, string(pVal.Type), pVal.Raw, now, 0)
			if err != nil {
				return fmt.Errorf("insert property %s: %w", k, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Update Cache (Bidirectional)
	fwd := edge
	fwd.Source = sourceHash
	fwd.Target = targetHash

	rev := edge
	rev.Source = targetHash
	rev.Target = sourceHash

	if s.Rules != nil {
		s.Rules.InvalidateByLabel("")
	}

	s.cache.outEdges[uIdx].edges[vIdx] = fwd
	s.cache.inEdges[vIdx].edges[uIdx] = fwd
	s.cache.outEdges[vIdx].edges[uIdx] = rev
	s.cache.inEdges[uIdx].edges[vIdx] = rev

	return nil
}

func (s *SQLiteStore[T]) RemoveEdge(sourceHash, targetHash uuid.UUID) error {
	if err := s.warmCache(); err != nil {
		return err
	}

	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()

	uIdx, ok := s.registry.Get(sourceHash)
	if !ok {
		return graph.ErrEdgeNotFound
	}
	vIdx, ok := s.registry.Get(targetHash)
	if !ok {
		return graph.ErrEdgeNotFound
	}

	if adj, ok := s.cache.outEdges[uIdx]; !ok || !adj.neighbors.Contains(vIdx) {
		return graph.ErrEdgeNotFound
	}

	u, v := canonical(sourceHash, targetHash)

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Delete properties
	edgeID := u.String() + ":" + v.String()
	_, err = tx.Exec("DELETE FROM graph_properties WHERE owner_id = ? AND owner_type = 'edge'", edgeID)
	if err != nil {
		return err
	}

	res, err := tx.Exec(`DELETE FROM graph_edges WHERE source_id=? AND target_id=?`, u.String(), v.String())
	if err != nil {
		return err
	}

	if n, _ := res.RowsAffected(); n == 0 {
		return graph.ErrEdgeNotFound
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Remove from Cache
	removeFromCache := func(maps map[uint32]*bitmapAdjacency, from, to uint32) {
		if adj, ok := maps[from]; ok {
			adj.neighbors.Remove(to)
			delete(adj.edges, to)
		}
	}

	removeFromCache(s.cache.outEdges, uIdx, vIdx)
	removeFromCache(s.cache.inEdges, vIdx, uIdx)
	removeFromCache(s.cache.outEdges, vIdx, uIdx)
	removeFromCache(s.cache.inEdges, uIdx, vIdx)

	// Update edge count (removed edge)
	s.cache.edgeCount.Add(-1)

	return nil
}

func (s *SQLiteStore[T]) Edge(sourceHash, targetHash uuid.UUID) (graph.Edge[uuid.UUID], error) {
	if err := s.warmCache(); err != nil {
		return graph.Edge[uuid.UUID]{}, err
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	uIdx, ok := s.registry.Get(sourceHash)
	if !ok {
		return graph.Edge[uuid.UUID]{}, graph.ErrEdgeNotFound
	}
	vIdx, ok := s.registry.Get(targetHash)
	if !ok {
		return graph.Edge[uuid.UUID]{}, graph.ErrEdgeNotFound
	}

	adj, ok := s.cache.outEdges[uIdx]
	if !ok {
		return graph.Edge[uuid.UUID]{}, graph.ErrEdgeNotFound
	}

	edge, ok := adj.edges[vIdx]
	if !ok {
		return graph.Edge[uuid.UUID]{}, graph.ErrEdgeNotFound
	}

	return edge, nil
}

func (s *SQLiteStore[T]) ListEdges() ([]graph.Edge[uuid.UUID], error) {
	if err := s.warmCache(); err != nil {
		return nil, err
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	var edges []graph.Edge[uuid.UUID]

	// Iterate sorted by index for deterministic output
	var sources []uint32
	for uIdx := range s.cache.outEdges {
		sources = append(sources, uIdx)
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i] < sources[j] })

	for _, uIdx := range sources {
		adj := s.cache.outEdges[uIdx]
		it := adj.neighbors.Iterator()
		for it.HasNext() {
			vIdx := it.Next()
			// Undirected store: only return canonical direction (e.g. u <= v) to avoid duplicates
			if uIdx > vIdx {
				continue
			}
			if e, ok := adj.edges[vIdx]; ok {
				edges = append(edges, e)
			}
		}
	}

	return edges, nil
}

func (s *SQLiteStore[T]) EdgeCount() (int, error) {
	if err := s.warmCache(); err != nil {
		return 0, err
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	return int(s.cache.edgeCount.Load()), nil
}
