package store

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/kittclouds/gokitt/pkg/qgram"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHNSW_SaveAndLoad(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create and populate an HNSW index
	idx := hnsw.NewIndex(16, 200, hnsw.Cosine)
	vec := []float32{1.0, 0.0, 0.0, 0.0}
	err = idx.AddPoint(1, vec)
	require.NoError(t, err)
	err = idx.AddPoint(2, []float32{0.0, 1.0, 0.0, 0.0})
	require.NoError(t, err)

	// Serialize and save
	data := idx.Serialize()
	err = s.SaveHNSW(4, data) // dimension 4
	require.NoError(t, err)

	// Load back
	loaded, err := s.LoadHNSW(4)
	require.NoError(t, err)
	require.NotNil(t, loaded)

	// Deserialize and verify
	idx2, err := hnsw.Deserialize(loaded)
	require.NoError(t, err)
	assert.Equal(t, 2, idx2.Len())
	assert.Equal(t, 4, idx2.Dimension())
}

func TestHNSW_ListDims(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Save multiple dimensions
	idx := hnsw.NewIndexDefault()
	_ = idx.AddPoint(1, []float32{1.0, 0.0})
	s.SaveHNSW(2, idx.Serialize())

	_ = idx.AddPoint(2, []float32{1.0, 0.0, 0.0})
	s.SaveHNSW(3, idx.Serialize())

	// List dimensions
	dims, err := s.ListHNSWDims()
	require.NoError(t, err)
	assert.Contains(t, dims, 2)
	assert.Contains(t, dims, 3)
}

func TestHNSW_Delete(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Save
	idx := hnsw.NewIndexDefault()
	_ = idx.AddPoint(1, []float32{1.0, 0.0})
	s.SaveHNSW(2, idx.Serialize())

	// Delete
	err = s.DeleteHNSW(2)
	require.NoError(t, err)

	// Verify gone
	loaded, err := s.LoadHNSW(2)
	require.NoError(t, err)
	assert.Nil(t, loaded)
}

func TestDocIDMapper_SaveAndLoad(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create and populate mapper
	mapper := qgram.NewDocIDMapper()
	id1 := mapper.GetOrAssign("doc1")
	id2 := mapper.GetOrAssign("doc2")
	id3 := mapper.GetOrAssign("doc3")

	// Save
	err = s.SaveDocIDMapper(mapper)
	require.NoError(t, err)

	// Load into new mapper
	loaded, err := s.LoadDocIDMapper()
	require.NoError(t, err)

	// Verify mappings preserved
	assert.Equal(t, id1, loaded.Get("doc1"))
	assert.Equal(t, id2, loaded.Get("doc2"))
	assert.Equal(t, id3, loaded.Get("doc3"))
	assert.Equal(t, "doc1", loaded.GetString(id1))
	assert.Equal(t, "doc2", loaded.GetString(id2))
	assert.Equal(t, "doc3", loaded.GetString(id3))
}

func TestChunkIDMapper_SaveAndLoad(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create mappings manually
	mappings := []ChunkMapping{
		{ID: 1, Key: "doc1:L0:0:100", DocID: "doc1"},
		{ID: 2, Key: "doc1:L0:100:200", DocID: "doc1"},
		{ID: 3, Key: "doc2:L0:0:150", DocID: "doc2"},
	}

	// Save using function parameters
	getAll := func() map[uint32]string {
		result := make(map[uint32]string)
		for _, m := range mappings {
			result[m.ID] = m.Key
		}
		return result
	}
	getDocID := func(id uint32) string {
		for _, m := range mappings {
			if m.ID == id {
				return m.DocID
			}
		}
		return ""
	}

	err = s.SaveChunkIDMapper(getAll, getDocID)
	require.NoError(t, err)

	// Load
	loaded, err := s.LoadChunkIDMappings()
	require.NoError(t, err)
	assert.Len(t, loaded, 3)

	// Verify
	assert.Equal(t, uint32(1), loaded[0].ID)
	assert.Equal(t, "doc1:L0:0:100", loaded[0].Key)
	assert.Equal(t, "doc1", loaded[0].DocID)
}

func TestChunks_SaveAndLoad(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create chunk records
	chunks := []ChunkRecord{
		{
			ChunkID:        1,
			DocID:          "doc1",
			Level:          0,
			Start:          0,
			End:            100,
			Text:           "First chunk",
			ParentID:       0,
			ScopeNarrative: "narrative1",
			ScopeFolder:    "/folder1",
		},
		{
			ChunkID:        2,
			DocID:          "doc1",
			Level:          0,
			Start:          100,
			End:            200,
			Text:           "Second chunk",
			ParentID:       0,
			ScopeNarrative: "narrative1",
			ScopeFolder:    "/folder1",
		},
		{
			ChunkID:        3,
			DocID:          "doc2",
			Level:          1,
			Start:          0,
			End:            200,
			Text:           "Parent chunk",
			ParentID:       0,
			ScopeNarrative: "narrative2",
			ScopeFolder:    "/folder2",
		},
	}

	// Save
	err = s.SaveChunks(chunks)
	require.NoError(t, err)

	// Load all
	loaded, err := s.LoadChunks()
	require.NoError(t, err)
	assert.Len(t, loaded, 3)
}

func TestChunks_GetByDoc(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create chunk records
	chunks := []ChunkRecord{
		{ChunkID: 1, DocID: "doc1", Level: 0, Start: 0, End: 100, Text: "Chunk 1"},
		{ChunkID: 2, DocID: "doc1", Level: 0, Start: 100, End: 200, Text: "Chunk 2"},
		{ChunkID: 3, DocID: "doc2", Level: 0, Start: 0, End: 100, Text: "Chunk 3"},
	}
	err = s.SaveChunks(chunks)
	require.NoError(t, err)

	// Get by doc
	doc1Chunks, err := s.GetChunksByDoc("doc1")
	require.NoError(t, err)
	assert.Len(t, doc1Chunks, 2)

	doc2Chunks, err := s.GetChunksByDoc("doc2")
	require.NoError(t, err)
	assert.Len(t, doc2Chunks, 1)
}

func TestChunks_GetByScope(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create chunk records with scopes
	chunks := []ChunkRecord{
		{ChunkID: 1, DocID: "doc1", Level: 0, Start: 0, End: 100, Text: "Chunk 1", ScopeNarrative: "narr1", ScopeFolder: "/folder1"},
		{ChunkID: 2, DocID: "doc2", Level: 0, Start: 0, End: 100, Text: "Chunk 2", ScopeNarrative: "narr1", ScopeFolder: "/folder2"},
		{ChunkID: 3, DocID: "doc3", Level: 0, Start: 0, End: 100, Text: "Chunk 3", ScopeNarrative: "narr2", ScopeFolder: "/folder1"},
	}
	err = s.SaveChunks(chunks)
	require.NoError(t, err)

	// Get by narrative scope
	narr1Chunks, err := s.GetChunksByScope("narr1", "")
	require.NoError(t, err)
	assert.Len(t, narr1Chunks, 2)

	// Get by folder scope
	folder1Chunks, err := s.GetChunksByScope("", "/folder1")
	require.NoError(t, err)
	assert.Len(t, folder1Chunks, 2)

	// Get by both
	narr1Folder1Chunks, err := s.GetChunksByScope("narr1", "/folder1")
	require.NoError(t, err)
	assert.Len(t, narr1Folder1Chunks, 1)
}

func TestChunks_DeleteByDoc(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create chunk records
	chunks := []ChunkRecord{
		{ChunkID: 1, DocID: "doc1", Level: 0, Start: 0, End: 100, Text: "Chunk 1"},
		{ChunkID: 2, DocID: "doc2", Level: 0, Start: 0, End: 100, Text: "Chunk 2"},
	}
	err = s.SaveChunks(chunks)
	require.NoError(t, err)

	// Delete doc1 chunks
	err = s.DeleteChunksByDoc("doc1")
	require.NoError(t, err)

	// Verify
	loaded, err := s.LoadChunks()
	require.NoError(t, err)
	assert.Len(t, loaded, 1)
	assert.Equal(t, "doc2", loaded[0].DocID)
}
