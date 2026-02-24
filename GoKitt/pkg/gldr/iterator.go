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

// ForEachEntityEdge iterates over entity edges without allocation.
// Return false from the callback to stop iteration early.
func (idx *GLDRIndex) ForEachEntityEdge(entityID string, fn func(edge GraphEdge) bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	for _, edge := range idx.GraphAdj[entityID] {
		if !fn(edge) {
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

// GetEdgeCount returns the total number of directed edges in the graph.
func (idx *GLDRIndex) GetEdgeCount() int {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	count := 0
	for _, edges := range idx.GraphAdj {
		count += len(edges)
	}
	return count
}
