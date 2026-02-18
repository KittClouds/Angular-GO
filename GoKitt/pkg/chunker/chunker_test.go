package chunker

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestChunkIDMapper_GetOrAssign(t *testing.T) {
	m := NewChunkIDMapper()

	// First assignment
	id1 := m.GetOrAssign("doc1:0:100", "doc1")
	assert.Equal(t, uint32(1), id1)

	// Same key returns same ID
	id1Again := m.GetOrAssign("doc1:0:100", "doc1")
	assert.Equal(t, id1, id1Again)

	// Different key gets new ID
	id2 := m.GetOrAssign("doc1:100:200", "doc1")
	assert.Equal(t, uint32(2), id2)

	// Different doc gets new ID
	id3 := m.GetOrAssign("doc2:0:100", "doc2")
	assert.Equal(t, uint32(3), id3)
}

func TestChunkIDMapper_Get(t *testing.T) {
	m := NewChunkIDMapper()
	m.GetOrAssign("key1", "doc1")

	// Existing key
	assert.Equal(t, uint32(1), m.Get("key1"))

	// Non-existent key returns 0
	assert.Equal(t, uint32(0), m.Get("nonexistent"))
}

func TestChunkIDMapper_GetString(t *testing.T) {
	m := NewChunkIDMapper()
	m.GetOrAssign("key1", "doc1")

	// Existing ID
	assert.Equal(t, "key1", m.GetString(1))

	// Non-existent ID returns empty
	assert.Equal(t, "", m.GetString(999))
}

func TestChunkIDMapper_GetDocID(t *testing.T) {
	m := NewChunkIDMapper()
	m.GetOrAssign("key1", "doc1")
	m.GetOrAssign("key2", "doc2")

	assert.Equal(t, "doc1", m.GetDocID(1))
	assert.Equal(t, "doc2", m.GetDocID(2))
	assert.Equal(t, "", m.GetDocID(999))
}

func TestChunkIDMapper_NeverReused(t *testing.T) {
	m := NewChunkIDMapper()

	// Assign some IDs
	ids := make([]uint32, 5)
	for i := 0; i < 5; i++ {
		ids[i] = m.GetOrAssign("key"+string(rune('0'+i)), "doc1")
	}

	// Verify sequential
	for i := 0; i < 5; i++ {
		assert.Equal(t, uint32(i+1), ids[i])
	}

	// Next ID should be 6
	nextID := m.GetOrAssign("newkey", "doc1")
	assert.Equal(t, uint32(6), nextID)
}

func TestChunkDocument_StableIDs(t *testing.T) {
	c := NewChunker(50, 10, nil, true, false)
	docID := "docA"
	data := "Mr. Smith went home. Then he left! Dr. Jones stayed? End."

	a, _ := c.ChunkDocument(docID, data)
	b, _ := c.ChunkDocument(docID, data)

	if len(a.Leaves) != len(b.Leaves) {
		t.Fatalf("leaf count mismatch: %d vs %d", len(a.Leaves), len(b.Leaves))
	}
	for i := range a.Leaves {
		if a.Leaves[i].ID != b.Leaves[i].ID {
			t.Fatalf("leaf[%d] id mismatch: %d vs %d", i, a.Leaves[i].ID, b.Leaves[i].ID)
		}
		if a.Leaves[i].Start != b.Leaves[i].Start || a.Leaves[i].End != b.Leaves[i].End {
			t.Fatalf("leaf[%d] span mismatch", i)
		}
		if a.Leaves[i].Start < 0 || a.Leaves[i].End > len(data) || a.Leaves[i].End <= a.Leaves[i].Start {
			t.Fatalf("leaf[%d] invalid span [%d,%d)", i, a.Leaves[i].Start, a.Leaves[i].End)
		}
	}
}

func TestChunkDocument_HasParents(t *testing.T) {
	c := NewChunker(40, 10, nil, true, false)
	c.ParentChunkSize = 80
	c.ParentOverlap = 20

	tree, _ := c.ChunkDocument("docX", "One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.")
	if len(tree.Leaves) == 0 {
		t.Fatalf("expected leaves")
	}
	if len(tree.Parents) == 0 {
		t.Fatalf("expected parents")
	}

	// Each parent should reference at least one child.
	for i := range tree.Parents {
		if len(tree.Parents[i].ChildIDs) == 0 {
			t.Fatalf("parent[%d] has no children", i)
		}
	}
}

func TestChunkDocument_Uint32IDs(t *testing.T) {
	c := NewChunker(50, 10, nil, true, false)
	tree, _ := c.ChunkDocument("doc1", "First sentence. Second sentence. Third sentence.")

	// All IDs should be non-zero uint32
	for i, leaf := range tree.Leaves {
		if leaf.ID == 0 {
			t.Errorf("leaf[%d] has zero ID", i)
		}
		if leaf.DocID != "doc1" {
			t.Errorf("leaf[%d] DocID mismatch: expected 'doc1', got '%s'", i, leaf.DocID)
		}
	}

	for i, parent := range tree.Parents {
		if parent.ID == 0 {
			t.Errorf("parent[%d] has zero ID", i)
		}
		if parent.DocID != "doc1" {
			t.Errorf("parent[%d] DocID mismatch: expected 'doc1', got '%s'", i, parent.DocID)
		}
	}
}

func TestChunkDocument_ParentChildRelation(t *testing.T) {
	c := NewChunker(30, 10, nil, true, false)
	c.ParentChunkSize = 60
	c.ParentOverlap = 15

	tree, _ := c.ChunkDocument("doc1", "One. Two. Three. Four. Five. Six. Seven. Eight.")

	// Verify parent-child relationships
	for _, parent := range tree.Parents {
		for _, childID := range parent.ChildIDs {
			// Find the child
			found := false
			for _, leaf := range tree.Leaves {
				if leaf.ID == childID {
					found = true
					// Verify child's ParentID points back
					if leaf.ParentID != parent.ID {
						t.Errorf("child %d ParentID %d != parent.ID %d", childID, leaf.ParentID, parent.ID)
					}
					break
				}
			}
			if !found {
				t.Errorf("parent references non-existent child %d", childID)
			}
		}
	}
}

func TestChunkDocument_MapperIntegration(t *testing.T) {
	c := NewChunker(50, 10, nil, true, false)
	tree, _ := c.ChunkDocument("doc1", "First sentence. Second sentence. Third sentence.")

	// Mapper should have entries for all chunks
	if c.Mapper.Len() != len(tree.Leaves)+len(tree.Parents) {
		t.Errorf("mapper len %d != leaves %d + parents %d",
			c.Mapper.Len(), len(tree.Leaves), len(tree.Parents))
	}

	// Each leaf ID should be resolvable via mapper
	for _, leaf := range tree.Leaves {
		key := c.Mapper.GetString(leaf.ID)
		if key == "" {
			t.Errorf("mapper missing key for leaf ID %d", leaf.ID)
		}
		docID := c.Mapper.GetDocID(leaf.ID)
		if docID != "doc1" {
			t.Errorf("mapper docID mismatch for leaf %d: expected 'doc1', got '%s'", leaf.ID, docID)
		}
	}
}

func TestChunker_SharedMapper(t *testing.T) {
	// Create a shared mapper
	sharedMapper := NewChunkIDMapper()

	// Create two chunkers with the same mapper
	c1 := NewChunkerWithMapper(50, 10, nil, true, false, sharedMapper)
	c2 := NewChunkerWithMapper(50, 10, nil, true, false, sharedMapper)

	tree1, _ := c1.ChunkDocument("doc1", "First sentence. Second sentence.")
	tree2, _ := c2.ChunkDocument("doc2", "Another sentence. Yet another.")

	// IDs should be unique across both documents
	allIDs := make(map[uint32]string)
	for _, leaf := range tree1.Leaves {
		if existing, ok := allIDs[leaf.ID]; ok {
			t.Errorf("duplicate ID %d in doc1 (already seen in %s)", leaf.ID, existing)
		}
		allIDs[leaf.ID] = "doc1"
	}
	for _, leaf := range tree2.Leaves {
		if existing, ok := allIDs[leaf.ID]; ok {
			t.Errorf("duplicate ID %d in doc2 (already seen in %s)", leaf.ID, existing)
		}
		allIDs[leaf.ID] = "doc2"
	}

	// Mapper should know about both documents
	docIDs := make(map[string]bool)
	for id := range allIDs {
		docID := sharedMapper.GetDocID(id)
		docIDs[docID] = true
	}
	if !docIDs["doc1"] || !docIDs["doc2"] {
		t.Errorf("mapper should track both doc1 and doc2, got: %v", docIDs)
	}
}

// Basic legacy test (Chunk method) to ensure backward compatibility behavior
func TestChunk_Legacy(t *testing.T) {
	c := NewChunker(45, 25, nil, false, false)
	input := "This is sentence one. This is sentence two. This is sentence three."
	chunks := c.Chunk(input)

	// Expect 2 chunks roughly.
	assert.GreaterOrEqual(t, len(chunks), 2)
	assert.Contains(t, chunks[0], "sentence one")
}

func TestChunkKey(t *testing.T) {
	key := chunkKey("doc1", 0, 100, 200)
	assert.Equal(t, "doc1:L0:100:200", key)

	key2 := chunkKey("my-doc", 1, 0, 50)
	assert.Equal(t, "my-doc:L1:0:50", key2)
}
