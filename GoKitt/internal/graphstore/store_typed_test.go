package graphstore

import (
	"testing"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestTypedProperties(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	id := uuid.New()

	// Create with string property that looks like an int
	props := graph.VertexProperties{
		Attributes: map[string]string{
			"age":    "42",
			"score":  "123.45",
			"active": "true",
			"name":   "Alice",
		},
	}

	err := store.AddVertex(id, TestItem{Name: "Alice"}, props)
	assert.NoError(t, err)

	// Verify direct DB values
	var valType string
	err = db.QueryRow("SELECT value_type FROM properties WHERE owner_id = ? AND key = 'age'", id.String()).Scan(&valType)
	assert.NoError(t, err)
	assert.Equal(t, "int", valType)

	err = db.QueryRow("SELECT value_type FROM properties WHERE owner_id = ? AND key = 'score'", id.String()).Scan(&valType)
	assert.NoError(t, err)
	assert.Equal(t, "float", valType)

	err = db.QueryRow("SELECT value_type FROM properties WHERE owner_id = ? AND key = 'active'", id.String()).Scan(&valType)
	assert.NoError(t, err)
	assert.Equal(t, "bool", valType)

	err = db.QueryRow("SELECT value_type FROM properties WHERE owner_id = ? AND key = 'name'", id.String()).Scan(&valType)
	assert.NoError(t, err)
	assert.Equal(t, "string", valType)

	// Verify Round Trip via Vertex()
	// Note: Vertex() currently converts back to string for compatibility
	_, vProps, err := store.Vertex(id)
	assert.NoError(t, err)
	assert.Equal(t, "42", vProps.Attributes["age"])
	assert.Equal(t, "123.45", vProps.Attributes["score"])
}
