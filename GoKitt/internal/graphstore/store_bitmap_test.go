package graphstore

import (
	"testing"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestIndexPersistence(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	id := uuid.New()
	err := store.AddVertex(id, TestItem{Name: "indexed"}, graph.VertexProperties{})
	assert.NoError(t, err)

	// Check direct DB access for index
	var idx int
	err = db.QueryRow("SELECT idx FROM graph_node_index WHERE id = ?", id.String()).Scan(&idx)
	assert.NoError(t, err)
	assert.GreaterOrEqual(t, idx, 0)
}
