package graphstore

import (
	"context"
	"fmt"
	"time"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
)

func (s *SQLiteStore[T]) AddVertex(id uuid.UUID, value T, props graph.VertexProperties) error {
	// 1. Ensure Index Exists (persisted immediately)
	if err := s.ensureInit(); err != nil {
		return err
	}
	_, err := s.registry.GetOrAssign(context.Background(), id)
	if err != nil {
		return fmt.Errorf("assign index: %w", err)
	}

	// 2. Encode value
	valBlob, err := s.enc(value)
	if err != nil {
		return fmt.Errorf("encode value: %w", err)
	}

	// Transaction needed for atomic multi-table write
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 3. Write Vertex Record (attributes JSON is now empty struct '{}')
	_, err = tx.Exec(`
		INSERT INTO graph_vertices (id, value, weight, attributes)
		VALUES (?, ?, ?, '{}')
	`, id.String(), valBlob, props.Weight) // Used 'props.Weight'
	if err != nil {
		return mapSQLiteErr(err, nil, graph.ErrVertexAlreadyExists)
	}

	// 4. Insert Properties (Temporal Append-Only)
	if len(props.Attributes) > 0 {
		stmt, err := tx.Prepare(`
			INSERT INTO graph_properties (owner_id, owner_type, key, value_type, value_blob, valid_from, valid_until, txn_id)
			VALUES (?, 'vertex', ?, ?, ?, ?, NULL, ?)
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		now := time.Now().UnixMilli()

		for k, v := range props.Attributes {
			pVal := ParseFromString(v)
			_, err := stmt.Exec(id.String(), k, string(pVal.Type), pVal.Raw, now, 0)
			if err != nil {
				return fmt.Errorf("insert property %s: %w", k, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// 5. Update Cache
	s.cache.mu.Lock()
	s.cache.vertices[id] = cachedVertex[T]{
		value:      value,
		properties: props,
	}
	s.cache.mu.Unlock()

	// Rule Invalidation (Naive: invalidate all on write)
	// Ideally we check labels, but labels are in separate table/store.
	// If props are changed, rules might be affected.
	if s.Rules != nil {
		s.Rules.InvalidateByLabel("")
	}

	return nil
}

func (s *SQLiteStore[T]) Vertex(id uuid.UUID) (T, graph.VertexProperties, error) {
	if err := s.warmCache(); err != nil {
		var zero T
		return zero, graph.VertexProperties{}, err
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	v, ok := s.cache.vertices[id]
	if !ok {
		var zero T
		return zero, graph.VertexProperties{}, graph.ErrVertexNotFound
	}

	return v.value, v.properties, nil
}

// BatchVertex retrieves values for multiple vertices in a single lock acquisition.
// Missing vertices are silently omitted from the result.
func (s *SQLiteStore[T]) BatchVertex(ids []uuid.UUID) map[uuid.UUID]T {
	if err := s.warmCache(); err != nil {
		return nil
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	result := make(map[uuid.UUID]T, len(ids))
	for _, id := range ids {
		if v, ok := s.cache.vertices[id]; ok {
			result[id] = v.value
		}
	}
	return result
}

func (s *SQLiteStore[T]) RemoveVertex(id uuid.UUID) error {
	if err := s.warmCache(); err != nil {
		return err
	}

	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()

	// Check for existence
	if _, ok := s.cache.vertices[id]; !ok {
		return graph.ErrVertexNotFound
	}

	// Check for edges via Index (outEdges contains all neighbors for undirected graph)
	idx, ok := s.registry.Get(id)
	if ok {
		if adj, hasOut := s.cache.outEdges[idx]; hasOut && !adj.neighbors.IsEmpty() {
			return graph.ErrVertexHasEdges
		}
	}

	// Transaction for atomic delete
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Delete properties
	_, err = tx.Exec("DELETE FROM graph_properties WHERE owner_id = ? AND owner_type = 'vertex'", id.String())
	if err != nil {
		return err
	}

	// Delete vertex
	res, err := tx.Exec("DELETE FROM graph_vertices WHERE id = ?", id.String())
	if err != nil {
		return err
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		return graph.ErrVertexNotFound
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Update Cache
	delete(s.cache.vertices, id)
	return nil
}

func (s *SQLiteStore[T]) ListVertices() ([]uuid.UUID, error) {
	if err := s.warmCache(); err != nil {
		return nil, err
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	ids := make([]uuid.UUID, 0, len(s.cache.vertices))
	for id := range s.cache.vertices {
		ids = append(ids, id)
	}
	return ids, nil
}

func (s *SQLiteStore[T]) VertexCount() (int, error) {
	if err := s.warmCache(); err != nil {
		return 0, err
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	return len(s.cache.vertices), nil
}

// UpdateVertex updates an existing vertex's value and properties.
func (s *SQLiteStore[T]) UpdateVertex(id uuid.UUID, value T, props graph.VertexProperties) error {
	if err := s.warmCache(); err != nil {
		return err
	}

	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()

	// Check existence
	if _, ok := s.cache.vertices[id]; !ok {
		return graph.ErrVertexNotFound
	}

	// Encode value
	valBlob, err := s.enc(value)
	if err != nil {
		return fmt.Errorf("encode value: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Update Core Vertex Record
	// Attributes JSON stores empty struct '{}' as properties are separated
	_, err = tx.Exec(`
		UPDATE graph_vertices 
		SET value = ?, weight = ?, attributes = '{}'
		WHERE id = ?
	`, valBlob, props.Weight, id.String())
	if err != nil {
		return err
	}

	now := time.Now().UnixMilli()

	// 2. Close Old Properties (Temporal)
	_, err = tx.Exec("UPDATE graph_properties SET valid_until = ? WHERE owner_id = ? AND owner_type = 'vertex' AND valid_until IS NULL", now, id.String())
	if err != nil {
		return err
	}

	// 3. Insert New Properties
	if len(props.Attributes) > 0 {
		stmt, err := tx.Prepare(`
			INSERT INTO graph_properties (owner_id, owner_type, key, value_type, value_blob, valid_from, valid_until, txn_id)
			VALUES (?, 'vertex', ?, ?, ?, ?, NULL, ?)
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for k, v := range props.Attributes {
			pVal := ParseFromString(v)
			_, err := stmt.Exec(id.String(), k, string(pVal.Type), pVal.Raw, now, 0)
			if err != nil {
				return fmt.Errorf("insert property %s: %w", k, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// 4. Update Cache
	s.cache.vertices[id] = cachedVertex[T]{
		value:      value,
		properties: props,
	}

	if s.Rules != nil {
		s.Rules.InvalidateByLabel("")
	}

	return nil
}
