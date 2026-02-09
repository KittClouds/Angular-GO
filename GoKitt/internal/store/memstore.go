// Package store provides persistence for GoKitt WASM.
// This file contains the interface and in-memory implementation for testing.
package store

import (
	"encoding/json"
	"sync"
)

// Storer defines the interface for data persistence.
// This allows swapping between MemStore (testing) and SQLiteStore (production).
type Storer interface {
	// Notes
	UpsertNote(note *Note) error
	GetNote(id string) (*Note, error)
	DeleteNote(id string) error
	ListNotes(folderID string) ([]*Note, error)
	CountNotes() (int, error)

	// Entities
	UpsertEntity(entity *Entity) error
	GetEntity(id string) (*Entity, error)
	GetEntityByLabel(label string) (*Entity, error)
	DeleteEntity(id string) error
	ListEntities(kind string) ([]*Entity, error)
	CountEntities() (int, error)

	// Edges
	UpsertEdge(edge *Edge) error
	GetEdge(id string) (*Edge, error)
	DeleteEdge(id string) error
	ListEdgesForEntity(entityID string) ([]*Edge, error)
	CountEdges() (int, error)

	// Lifecycle
	Close() error
}

// MemStore is an in-memory implementation of Storer for testing.
type MemStore struct {
	mu       sync.RWMutex
	notes    map[string]*Note
	entities map[string]*Entity
	edges    map[string]*Edge
}

// NewMemStore creates a new in-memory store.
func NewMemStore() *MemStore {
	return &MemStore{
		notes:    make(map[string]*Note),
		entities: make(map[string]*Entity),
		edges:    make(map[string]*Edge),
	}
}

// Close is a no-op for MemStore.
func (s *MemStore) Close() error {
	return nil
}

// =============================================================================
// Note CRUD
// =============================================================================

func (s *MemStore) UpsertNote(note *Note) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Deep copy to avoid mutation issues
	copy := *note
	s.notes[note.ID] = &copy
	return nil
}

func (s *MemStore) GetNote(id string) (*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if note, ok := s.notes[id]; ok {
		copy := *note
		return &copy, nil
	}
	return nil, nil
}

func (s *MemStore) DeleteNote(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.notes, id)
	return nil
}

func (s *MemStore) ListNotes(folderID string) ([]*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Note
	for _, note := range s.notes {
		if folderID == "" || note.FolderID == folderID {
			copy := *note
			result = append(result, &copy)
		}
	}

	// Sort by order
	for i := 0; i < len(result)-1; i++ {
		for j := i + 1; j < len(result); j++ {
			if result[i].Order > result[j].Order {
				result[i], result[j] = result[j], result[i]
			}
		}
	}

	return result, nil
}

func (s *MemStore) CountNotes() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.notes), nil
}

// =============================================================================
// Entity CRUD
// =============================================================================

func (s *MemStore) UpsertEntity(entity *Entity) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Deep copy including aliases slice
	copy := *entity
	if entity.Aliases != nil {
		copy.Aliases = make([]string, len(entity.Aliases))
		for i, a := range entity.Aliases {
			copy.Aliases[i] = a
		}
	}
	s.entities[entity.ID] = &copy
	return nil
}

func (s *MemStore) GetEntity(id string) (*Entity, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if entity, ok := s.entities[id]; ok {
		copy := *entity
		if entity.Aliases != nil {
			copy.Aliases = make([]string, len(entity.Aliases))
			for i, a := range entity.Aliases {
				copy.Aliases[i] = a
			}
		}
		return &copy, nil
	}
	return nil, nil
}

func (s *MemStore) GetEntityByLabel(label string) (*Entity, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	labelLower := toLower(label)
	for _, entity := range s.entities {
		if toLower(entity.Label) == labelLower {
			copy := *entity
			if entity.Aliases != nil {
				copy.Aliases = make([]string, len(entity.Aliases))
				for i, a := range entity.Aliases {
					copy.Aliases[i] = a
				}
			}
			return &copy, nil
		}
	}
	return nil, nil
}

func (s *MemStore) DeleteEntity(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.entities, id)
	return nil
}

func (s *MemStore) ListEntities(kind string) ([]*Entity, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Entity
	for _, entity := range s.entities {
		if kind == "" || entity.Kind == kind {
			copy := *entity
			if entity.Aliases != nil {
				copy.Aliases = make([]string, len(entity.Aliases))
				for i, a := range entity.Aliases {
					copy.Aliases[i] = a
				}
			}
			result = append(result, &copy)
		}
	}

	// Sort by label
	for i := 0; i < len(result)-1; i++ {
		for j := i + 1; j < len(result); j++ {
			if result[i].Label > result[j].Label {
				result[i], result[j] = result[j], result[i]
			}
		}
	}

	return result, nil
}

func (s *MemStore) CountEntities() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.entities), nil
}

// =============================================================================
// Edge CRUD
// =============================================================================

func (s *MemStore) UpsertEdge(edge *Edge) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	copy := *edge
	s.edges[edge.ID] = &copy
	return nil
}

func (s *MemStore) GetEdge(id string) (*Edge, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if edge, ok := s.edges[id]; ok {
		copy := *edge
		return &copy, nil
	}
	return nil, nil
}

func (s *MemStore) DeleteEdge(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.edges, id)
	return nil
}

func (s *MemStore) ListEdgesForEntity(entityID string) ([]*Edge, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Edge
	for _, edge := range s.edges {
		if edge.SourceID == entityID || edge.TargetID == entityID {
			copy := *edge
			result = append(result, &copy)
		}
	}
	return result, nil
}

func (s *MemStore) CountEdges() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.edges), nil
}

// =============================================================================
// Helpers
// =============================================================================

func toLower(s string) string {
	b := []byte(s)
	for i := 0; i < len(b); i++ {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 'a' - 'A'
		}
	}
	return string(b)
}

// ToJSON converts a store model to JSON bytes.
func ToJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}

// FromJSON parses JSON bytes into a store model.
func FromJSON[T any](data []byte) (*T, error) {
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

// Compile-time interface check
var _ Storer = (*MemStore)(nil)
