package graphstore

import (
	"context"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/google/uuid"
)

// AddLabel adds a label to a vertex.
func (s *SQLiteStore[T]) AddLabel(id uuid.UUID, label string) error {
	// 1. Ensure Index
	if err := s.ensureInit(); err != nil {
		return err
	}
	idx, err := s.registry.GetOrAssign(context.Background(), id)
	if err != nil {
		return err
	}

	// 2. DB Insert
	_, err = s.db.Exec(`INSERT INTO graph_vertex_labels (vertex_id, label) VALUES (?, ?) ON CONFLICT DO NOTHING`, id.String(), label)
	if err != nil {
		return err
	}

	// 3. Cache Update
	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()

	bmp, ok := s.cache.labels[label]
	if !ok {
		bmp = roaring.New()
		s.cache.labels[label] = bmp
	}
	bmp.Add(idx)

	return nil
}

// RemoveLabel removes a label from a vertex.
func (s *SQLiteStore[T]) RemoveLabel(id uuid.UUID, label string) error {
	if err := s.warmCache(); err != nil {
		return err
	}

	idx, ok := s.registry.Get(id)
	if !ok {
		return nil
	} // Node doesn't exist, so label doesn't either (effectively)

	// DB Delete
	res, err := s.db.Exec(`DELETE FROM graph_vertex_labels WHERE vertex_id=? AND label=?`, id.String(), label)
	if err != nil {
		return err
	}

	if n, _ := res.RowsAffected(); n == 0 {
		return nil // Already gone
	}

	// Cache Update
	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()

	if bmp, ok := s.cache.labels[label]; ok {
		bmp.Remove(idx)
	}
	return nil
}

// GetNodesByLabel returns all UUIDs for a given label (slow convenience method).
// Internal engine uses Bitmaps directly.
func (s *SQLiteStore[T]) GetNodesByLabel(label string) ([]uuid.UUID, error) {
	if err := s.warmCache(); err != nil {
		return nil, err
	}

	s.cache.mu.RLock()
	defer s.cache.mu.RUnlock()

	bmp, ok := s.cache.labels[label]
	if !ok || bmp.IsEmpty() {
		return nil, nil
	}

	var ids []uuid.UUID
	it := bmp.Iterator()
	for it.HasNext() {
		idx := it.Next()
		if id, found := s.registry.ReverseLookup(idx); found {
			ids = append(ids, id)
		}
	}
	return ids, nil
}
