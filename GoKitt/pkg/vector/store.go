package vector

import (
	"bytes"
	"encoding/gob"
	"fmt"
	"sync" // hnsw is thread safe but persistence might need locking if we expose it

	"github.com/fogfish/hnsw"
	"github.com/fogfish/hnsw/vector" // fogfish/hnsw/vector alias, imports kshard/vector
	"github.com/hack-pad/hackpadfs"
	kvector "github.com/kshard/vector" // Underlying vector types
)

// Store manages the HNSW index and its persistence.
type Store struct {
	Index *hnsw.HNSW[vector.VF32]
	FS    hackpadfs.FS
	Path  string
	mu    sync.RWMutex
}

// NewStore creates a new Vector Store.
// If valid index exists at path, it loads it.
// Otherwise initializes a new one.
func NewStore(fs hackpadfs.FS, path string) (*Store, error) {
	s := &Store{
		FS:   fs,
		Path: path,
	}

	// Try to load
	if err := s.Load(); err != nil {
		// If does not exist, create new
		// TODO: Checking error type for "Not Exist" would be better, but for now fallback to clean
		// config: standard Cosine
		s.Index = hnsw.New[vector.VF32](vector.SurfaceVF32(kvector.Cosine()))
	}

	return s, nil
}

// Add inserts a vector with an ID.
// Returns error if vector dimension doesn't match existing index.
func (s *Store) Add(id uint32, vec []float32) error {
	if s.Index == nil {
		return fmt.Errorf("index not initialized")
	}

	if s.Index.Size() > 0 {
		dim := len(s.Index.Head().Vec)
		if len(vec) != dim {
			return fmt.Errorf("vector dimension mismatch: expected %d, got %d", dim, len(vec))
		}
	}

	item := vector.VF32{
		Key: id,
		Vec: vec,
	}
	s.Index.Insert(item)
	return nil
}

// Search returns the nearest K IDs.
func (s *Store) Search(vec []float32, k int) ([]uint32, error) {
	if s.Index == nil {
		return nil, fmt.Errorf("index not initialized")
	}

	// efSearch: usually k * 2 or similar. Fogfish default might be used if 0?
	// Search signature: Search(q Vector, K int, efSearch int)
	ef := k * 2
	if ef < 100 {
		ef = 100
	}

	// Validate dimension if index is populated
	if s.Index.Size() > 0 {
		dim := len(s.Index.Head().Vec)
		if len(vec) != dim {
			return nil, fmt.Errorf("vector dimension mismatch: expected %d, got %d", dim, len(vec))
		}
	}

	query := vector.VF32{Vec: vec} // Key ignored in Search distance calc
	results := s.Index.Search(query, k, ef)

	ids := make([]uint32, len(results))
	for i, r := range results {
		ids[i] = r.Key
	}
	return ids, nil
}

// Save persists the index to FS.
func (s *Store) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Index == nil {
		return nil
	}

	nodes := s.Index.Nodes()

	var buf bytes.Buffer
	enc := gob.NewEncoder(&buf)
	if err := enc.Encode(nodes); err != nil {
		return fmt.Errorf("failed to encode index: %w", err)
	}

	// hackpadfs WriteFullFile
	if err := hackpadfs.WriteFullFile(s.FS, s.Path, buf.Bytes(), 0644); err != nil {
		return fmt.Errorf("failed to write index file: %w", err)
	}

	return nil
}

// Load reads the index from FS.
func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	content, err := hackpadfs.ReadFile(s.FS, s.Path)
	if err != nil {
		return err
	}

	var nodes hnsw.Nodes[vector.VF32]
	dec := gob.NewDecoder(bytes.NewReader(content))
	if err := dec.Decode(&nodes); err != nil {
		return fmt.Errorf("failed to decode index: %w", err)
	}

	// Rehydrate
	s.Index = hnsw.FromNodes[vector.VF32](
		vector.SurfaceVF32(kvector.Cosine()),
		nodes,
	)

	return nil
}
