package graphstore

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

type TestItem struct {
	Name string `json:"name"`
}

func setupTestDB(t *testing.T) *sql.DB {
	// Use file-based memory DB to allow shared cache if needed, but :memory: is fine for single connection
	db, err := OpenDB("file::memory:?cache=shared")
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}

	if err := Migrate(context.Background(), db); err != nil {
		t.Fatalf("failed to migrate: %v", err)
	}
	return db
}

func TestVertexOperations(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	id := uuid.New()
	item := TestItem{Name: "v1"}

	// Add
	err := store.AddVertex(id, item, graph.VertexProperties{Weight: 1})
	assert.NoError(t, err)

	// Add Duplicate
	err = store.AddVertex(id, item, graph.VertexProperties{})
	assert.Equal(t, graph.ErrVertexAlreadyExists, err)

	// Get
	val, props, err := store.Vertex(id)
	assert.NoError(t, err)
	assert.Equal(t, item, val)
	assert.Equal(t, 1, props.Weight)

	// Count
	count, err := store.VertexCount()
	assert.NoError(t, err)
	assert.Equal(t, 1, count)

	// List
	ids, err := store.ListVertices()
	assert.NoError(t, err)
	assert.Contains(t, ids, id)

	// Remove
	err = store.RemoveVertex(id)
	assert.NoError(t, err)

	// Get Not Found
	_, _, err = store.Vertex(id)
	assert.Equal(t, graph.ErrVertexNotFound, err)

	// Remove Not Found
	err = store.RemoveVertex(id)
	assert.Equal(t, graph.ErrVertexNotFound, err)
}

func TestEdgeOperations(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	u := uuid.New()
	v := uuid.New()

	_ = store.AddVertex(u, TestItem{Name: "u"}, graph.VertexProperties{})
	_ = store.AddVertex(v, TestItem{Name: "v"}, graph.VertexProperties{})

	// Add Edge
	err := store.AddEdge(u, v, graph.Edge[uuid.UUID]{
		Properties: graph.EdgeProperties{Weight: 10},
	})
	assert.NoError(t, err)

	// Add Duplicate
	err = store.AddEdge(u, v, graph.Edge[uuid.UUID]{})
	assert.Equal(t, graph.ErrEdgeAlreadyExists, err)

	// Add Duplicate Reverse (should also fail in undirected store)
	err = store.AddEdge(v, u, graph.Edge[uuid.UUID]{})
	assert.Equal(t, graph.ErrEdgeAlreadyExists, err)

	// Get
	edge, err := store.Edge(u, v)
	assert.NoError(t, err)
	assert.Equal(t, 10, edge.Properties.Weight)

	// Get Reverse
	edgeRev, err := store.Edge(v, u)
	assert.NoError(t, err)
	assert.Equal(t, 10, edgeRev.Properties.Weight)
	assert.Equal(t, v, edgeRev.Source) // Should return requested direction
	assert.Equal(t, u, edgeRev.Target)

	// Compute Count
	count, err := store.EdgeCount()
	assert.NoError(t, err)
	assert.Equal(t, 1, count) // Undirected edge is 1

	// List
	edges, err := store.ListEdges()
	assert.NoError(t, err)
	assert.Len(t, edges, 1)

	// Update
	err = store.UpdateEdge(u, v, graph.Edge[uuid.UUID]{
		Properties: graph.EdgeProperties{Weight: 20},
	})
	assert.NoError(t, err)

	edge, _ = store.Edge(u, v)
	assert.Equal(t, 20, edge.Properties.Weight)

	// Remove
	err = store.RemoveEdge(u, v)
	assert.NoError(t, err)

	// Get Not Found
	_, err = store.Edge(u, v)
	assert.Equal(t, graph.ErrEdgeNotFound, err)
}

func TestPersistence(t *testing.T) {
	// Use a temp file for persistence test
	f, err := os.CreateTemp("", "graphstore_test_*.db")
	assert.NoError(t, err)
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	// Open first time
	db1, err := OpenDB(path)
	assert.NoError(t, err)
	err = Migrate(context.Background(), db1)
	assert.NoError(t, err)

	store1 := NewJSON[TestItem](db1)
	id := uuid.New()
	_ = store1.AddVertex(id, TestItem{Name: "persist"}, graph.VertexProperties{})
	db1.Close()

	// Open second time
	db2, err := OpenDB(path)
	assert.NoError(t, err)
	defer db2.Close()

	store2 := NewJSON[TestItem](db2)

	// Should verify cache warm happens on read
	val, _, err := store2.Vertex(id)
	assert.NoError(t, err)
	assert.Equal(t, "persist", val.Name)
}
