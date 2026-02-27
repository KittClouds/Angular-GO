package graphstore

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/google/uuid"
)

// IndexRegistry maps UUIDs to dense uint32 integers for use with Roaring Bitmaps.
type IndexRegistry struct {
	mu        sync.RWMutex
	uuidToIdx map[uuid.UUID]uint32
	idxToUUID []uuid.UUID // slice index == logical index
	nextIdx   atomic.Uint32
	db        *sql.DB
}

// NewIndexRegistry creates a registry backed by the given DB.
// It loads existing indices on startup.
func NewIndexRegistry(db *sql.DB) (*IndexRegistry, error) {
	reg := &IndexRegistry{
		uuidToIdx: make(map[uuid.UUID]uint32),
		idxToUUID: make([]uuid.UUID, 0),
		db:        db,
	}

	if err := reg.load(); err != nil {
		return nil, err
	}

	return reg, nil
}

func (r *IndexRegistry) load() error {
	rows, err := r.db.Query("SELECT id, idx FROM graph_node_index ORDER BY idx")
	if err != nil {
		return fmt.Errorf("query node_index: %w", err)
	}
	defer rows.Close()

	var maxIdx int64 = -1
	for rows.Next() {
		var idStr string
		var idx int64
		if err := rows.Scan(&idStr, &idx); err != nil {
			return err
		}

		id, err := uuid.Parse(idStr)
		if err != nil {
			return err
		}

		r.uuidToIdx[id] = uint32(idx)

		// Grow slice if needed
		if int(idx) >= len(r.idxToUUID) {
			if int(idx) >= cap(r.idxToUUID) {
				newCap := int(idx) + 1
				if newCap < 2*len(r.idxToUUID) {
					newCap = 2 * len(r.idxToUUID)
				}
				newSlice := make([]uuid.UUID, int(idx)+1, newCap)
				copy(newSlice, r.idxToUUID)
				r.idxToUUID = newSlice
			} else {
				r.idxToUUID = r.idxToUUID[:int(idx)+1]
			}
		}
		r.idxToUUID[idx] = id

		if idx > maxIdx {
			maxIdx = idx
		}
	}

	r.nextIdx.Store(uint32(maxIdx + 1))
	return nil
}

// GetOrAssign returns the index for a UUID, creating and persisting it if missing.
func (r *IndexRegistry) GetOrAssign(ctx context.Context, id uuid.UUID) (uint32, error) {
	r.mu.RLock()
	idx, ok := r.uuidToIdx[id]
	r.mu.RUnlock()
	if ok {
		return idx, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Double-check
	if idx, ok := r.uuidToIdx[id]; ok {
		return idx, nil
	}

	newIdx := r.nextIdx.Add(1) - 1

	// Persist first
	_, err := r.db.ExecContext(ctx, "INSERT INTO graph_node_index (id, idx) VALUES (?, ?)", id.String(), newIdx)
	if err != nil {
		return 0, fmt.Errorf("persist index: %w", err)
	}

	r.uuidToIdx[id] = newIdx
	r.idxToUUID = append(r.idxToUUID, id)

	return newIdx, nil
}

// Get returns the index for a UUID if it exists.
func (r *IndexRegistry) Get(id uuid.UUID) (uint32, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	idx, ok := r.uuidToIdx[id]
	return idx, ok
}

// ReverseLookup returns the UUID for a given index.
func (r *IndexRegistry) ReverseLookup(idx uint32) (uuid.UUID, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if int(idx) >= len(r.idxToUUID) {
		return uuid.Nil, false
	}
	return r.idxToUUID[idx], true
}

// MaxIndex returns the next available index (one past the highest assigned).
// Used for sizing dense arrays.
func (r *IndexRegistry) MaxIndex() uint32 {
	return r.nextIdx.Load()
}

// AllIndices returns a copy of all assigned indices. Caller must not modify.
func (r *IndexRegistry) AllIndices() []uint32 {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]uint32, 0, len(r.uuidToIdx))
	for _, idx := range r.uuidToIdx {
		out = append(out, idx)
	}
	return out
}
