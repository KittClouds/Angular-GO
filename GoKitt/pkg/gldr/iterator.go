package gldr

// ForEachChunk iterates over chunks without allocating a slice.
// ZERO-COPY: The callback receives each entry directly from the internal map.
// Return false from the callback to stop iteration early.
func (idx *GLDRIndex) ForEachChunk(fn func(chunkID uint32, mentions []EntityMention) bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	for chunkID, mentions := range idx.ChunkEntities {
		if mentions == nil {
			continue // Skip deleted chunks
		}
		if !fn(chunkID, mentions) {
			break
		}
	}
}

// GetEntityCount returns the number of unique entities in the index (O(1), no allocation).
func (idx *GLDRIndex) GetEntityCount() int {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	return len(idx.EntityChunks)
}

// GetEdgeCount returns the total number of edges in the graph via GraphStore.
func (idx *GLDRIndex) GetEdgeCount() int {
	count, err := idx.Store.EdgeCount()
	if err != nil {
		return 0
	}
	return count
}

// GetVertexCount returns the total number of vertices in the graph via GraphStore.
func (idx *GLDRIndex) GetVertexCount() int {
	count, err := idx.Store.VertexCount()
	if err != nil {
		return 0
	}
	return count
}
