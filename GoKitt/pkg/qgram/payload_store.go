package qgram

// GramPayload stores scoring metadata for a gram in a document.
// This is the "cold" data separated from the "hot" posting list.
// Keyed by doc ordinal for O(1) lookup during scoring.
type GramPayload struct {
	SegMask uint32 // 32-bit segment mask for proximity scoring

	// Per-field term frequencies (packed as uint16 to save memory)
	// Using fixed fields for common use cases; extend with map if needed
	TFTitle uint16
	TFBody  uint16
	TFTags  uint16
	// Future: positions []uint16 if needed for phrase scoring
}

// PayloadStore manages cold storage for gram payloads.
// Provides O(1) lookup by docID ordinal.
type PayloadStore struct {
	// Dense array indexed by docID ordinal
	// For sparse data, could use map[uint32]GramPayload instead
	payloads []GramPayload

	// For sparse storage when docIDs are not dense
	sparse map[uint32]GramPayload

	// Flag indicating storage mode
	isSparse bool
}

// NewPayloadStore creates a new payload store.
func NewPayloadStore() *PayloadStore {
	return &PayloadStore{
		payloads: make([]GramPayload, 0),
		sparse:   make(map[uint32]GramPayload),
		isSparse: true, // Start sparse, can densify later
	}
}

// NewDensePayloadStore creates a dense payload store with pre-allocated capacity.
func NewDensePayloadStore(maxDocID uint32) *PayloadStore {
	return &PayloadStore{
		payloads: make([]GramPayload, maxDocID+1),
		sparse:   nil,
		isSparse: false,
	}
}

// Set stores a payload for a docID.
func (s *PayloadStore) Set(docID uint32, payload GramPayload) {
	if s.isSparse {
		s.sparse[docID] = payload
	} else {
		// Grow dense array if needed
		if int(docID) >= len(s.payloads) {
			newPayloads := make([]GramPayload, docID+1)
			copy(newPayloads, s.payloads)
			s.payloads = newPayloads
		}
		s.payloads[docID] = payload
	}
}

// Get retrieves a payload for a docID.
// Returns the payload and true if found, zero value and false otherwise.
func (s *PayloadStore) Get(docID uint32) (GramPayload, bool) {
	if s.isSparse {
		p, ok := s.sparse[docID]
		return p, ok
	}
	if int(docID) < len(s.payloads) {
		return s.payloads[docID], true
	}
	return GramPayload{}, false
}

// GetSegMask returns just the segment mask for a docID.
// This is the most common access pattern during scoring.
func (s *PayloadStore) GetSegMask(docID uint32) uint32 {
	if s.isSparse {
		if p, ok := s.sparse[docID]; ok {
			return p.SegMask
		}
		return 0
	}
	if int(docID) < len(s.payloads) {
		return s.payloads[docID].SegMask
	}
	return 0
}

// GetTF returns the term frequency for a specific field.
func (s *PayloadStore) GetTF(docID uint32, field string) uint16 {
	var p GramPayload
	var ok bool

	if s.isSparse {
		p, ok = s.sparse[docID]
	} else if int(docID) < len(s.payloads) {
		p = s.payloads[docID]
		ok = true
	}

	if !ok {
		return 0
	}

	switch field {
	case "title":
		return p.TFTitle
	case "body":
		return p.TFBody
	case "tags":
		return p.TFTags
	default:
		return 0
	}
}

// UpdateSegMask ORs a segment mask into the existing payload.
func (s *PayloadStore) UpdateSegMask(docID uint32, mask uint32) {
	if s.isSparse {
		p := s.sparse[docID]
		p.SegMask |= mask
		s.sparse[docID] = p
	} else {
		if int(docID) < len(s.payloads) {
			s.payloads[docID].SegMask |= mask
		}
	}
}

// IncrementTF increments the term frequency for a field.
func (s *PayloadStore) IncrementTF(docID uint32, field string) {
	if s.isSparse {
		p := s.sparse[docID]
		switch field {
		case "title":
			p.TFTitle++
		case "body":
			p.TFBody++
		case "tags":
			p.TFTags++
		}
		s.sparse[docID] = p
	} else {
		if int(docID) < len(s.payloads) {
			switch field {
			case "title":
				s.payloads[docID].TFTitle++
			case "body":
				s.payloads[docID].TFBody++
			case "tags":
				s.payloads[docID].TFTags++
			}
		}
	}
}

// Delete removes a payload for a docID.
func (s *PayloadStore) Delete(docID uint32) {
	if s.isSparse {
		delete(s.sparse, docID)
	} else if int(docID) < len(s.payloads) {
		s.payloads[docID] = GramPayload{}
	}
}

// Len returns the number of stored payloads.
func (s *PayloadStore) Len() int {
	if s.isSparse {
		return len(s.sparse)
	}
	// Count non-zero entries in dense array
	count := 0
	for _, p := range s.payloads {
		if p.SegMask != 0 || p.TFTitle != 0 || p.TFBody != 0 || p.TFTags != 0 {
			count++
		}
	}
	return count
}

// Densify converts from sparse to dense storage.
// Call this after indexing is complete if docIDs are dense.
func (s *PayloadStore) Densify(maxDocID uint32) {
	if !s.isSparse {
		return
	}

	newPayloads := make([]GramPayload, maxDocID+1)
	for docID, p := range s.sparse {
		if int(docID) < len(newPayloads) {
			newPayloads[docID] = p
		}
	}

	s.payloads = newPayloads
	s.sparse = nil
	s.isSparse = false
}

// MemoryUsage returns approximate memory usage in bytes.
func (s *PayloadStore) MemoryUsage() int {
	if s.isSparse {
		// Map overhead: ~48 bytes per entry + payload size
		return len(s.sparse) * (48 + 12) // 12 bytes for GramPayload
	}
	return len(s.payloads) * 12
}

// ============================================================================
// GramPayloadStore - Per-gram payload storage
// ============================================================================

// GramPayloadStore maps grams to their payload stores.
// This is the main structure used by the index.
type GramPayloadStore struct {
	// gram -> docID -> payload
	stores map[string]*PayloadStore
}

// NewGramPayloadStore creates a new gram payload store.
func NewGramPayloadStore() *GramPayloadStore {
	return &GramPayloadStore{
		stores: make(map[string]*PayloadStore),
	}
}

// GetOrCreate returns the payload store for a gram, creating if needed.
func (s *GramPayloadStore) GetOrCreate(gram string) *PayloadStore {
	if store, ok := s.stores[gram]; ok {
		return store
	}
	store := NewPayloadStore()
	s.stores[gram] = store
	return store
}

// Get returns the payload store for a gram, or nil if not found.
func (s *GramPayloadStore) Get(gram string) *PayloadStore {
	return s.stores[gram]
}

// GetPayload returns a specific payload for a gram and docID.
func (s *GramPayloadStore) GetPayload(gram string, docID uint32) (GramPayload, bool) {
	store, ok := s.stores[gram]
	if !ok {
		return GramPayload{}, false
	}
	return store.Get(docID)
}

// SetPayload sets a payload for a gram and docID.
func (s *GramPayloadStore) SetPayload(gram string, docID uint32, payload GramPayload) {
	store := s.GetOrCreate(gram)
	store.Set(docID, payload)
}

// DeleteGram removes all payloads for a gram.
func (s *GramPayloadStore) DeleteGram(gram string) {
	delete(s.stores, gram)
}

// DeleteDoc removes a docID from all gram payload stores.
func (s *GramPayloadStore) DeleteDoc(docID uint32) {
	for _, store := range s.stores {
		store.Delete(docID)
	}
}

// GramCount returns the number of grams stored.
func (s *GramPayloadStore) GramCount() int {
	return len(s.stores)
}

// MemoryUsage returns approximate total memory usage.
func (s *GramPayloadStore) MemoryUsage() int {
	total := 0
	for gram, store := range s.stores {
		total += len(gram) + store.MemoryUsage()
	}
	return total
}
