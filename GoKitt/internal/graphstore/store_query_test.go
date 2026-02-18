package graphstore

import (
	"testing"
	"time"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestLabelOperations(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	id := uuid.New()
	store.AddVertex(id, TestItem{Name: "Tagged"}, graph.VertexProperties{})

	// Add Label
	err := store.AddLabel(id, "person")
	assert.NoError(t, err)

	// Verify Cache
	ids, err := store.GetNodesByLabel("person")
	assert.NoError(t, err)
	assert.Len(t, ids, 1)
	assert.Equal(t, id, ids[0])

	// Remove Label
	err = store.RemoveLabel(id, "person")
	assert.NoError(t, err)

	ids, err = store.GetNodesByLabel("person")
	assert.NoError(t, err)
	assert.Len(t, ids, 0)
}

func TestPatternMatching(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	// Create Graph: A(Person) -> B(Person) -> C(Dog)
	// Query: Find Person A connected to Person B connected to Dog C

	idA, idB, idC := uuid.New(), uuid.New(), uuid.New()

	store.AddVertex(idA, TestItem{Name: "Alice"}, graph.VertexProperties{})
	store.AddVertex(idB, TestItem{Name: "Bob"}, graph.VertexProperties{})
	store.AddVertex(idC, TestItem{Name: "Fido"}, graph.VertexProperties{})

	store.AddLabel(idA, "Person")
	store.AddLabel(idB, "Person")
	store.AddLabel(idC, "Dog")

	store.AddEdge(idA, idB, graph.Edge[uuid.UUID]{})
	store.AddEdge(idB, idC, graph.Edge[uuid.UUID]{})

	// Define Query
	// A --knows--> B --owns--> C
	q := Query{
		Patterns: []NodePattern{
			{Var: "a", LabelFilter: []string{"Person"}},
			{Var: "b", LabelFilter: []string{"Person"}},
			{Var: "c", LabelFilter: []string{"Dog"}},
		},
		Edges: []EdgePattern{
			{SourceVar: "a", TargetVar: "b"},
			{SourceVar: "b", TargetVar: "c"},
		},
	}

	// Execute
	rs, err := store.Execute(q)
	assert.NoError(t, err)
	assert.NotNil(t, rs)

	// Should find exactly one match: {a:Alice, b:Bob, c:Fido}
	assert.Len(t, rs.Bindings, 1)

	row := rs.Bindings[0]
	assert.Equal(t, idA, row["a"])
	assert.Equal(t, idB, row["b"])
	assert.Equal(t, idC, row["c"])
}

func TestQueryPruning(t *testing.T) {
	// Test pruning: A -> B, but B is not matching label filter
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	idA, idB := uuid.New(), uuid.New()

	store.AddVertex(idA, TestItem{Name: "Alice"}, graph.VertexProperties{})
	store.AddVertex(idB, TestItem{Name: "Bob"}, graph.VertexProperties{}) // Bob is NOT labeled "Dog"

	store.AddLabel(idA, "Person")
	store.AddEdge(idA, idB, graph.Edge[uuid.UUID]{})

	q := Query{
		Patterns: []NodePattern{
			{Var: "a", LabelFilter: []string{"Person"}},
			{Var: "b", LabelFilter: []string{"Dog"}}, // Constraint
		},
		Edges: []EdgePattern{
			{SourceVar: "a", TargetVar: "b"},
		},
	}

	rs, err := store.Execute(q)
	assert.NoError(t, err)
	assert.Len(t, rs.Bindings, 0) // Should find nothing
}

func TestEdgeType(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	u, v := uuid.New(), uuid.New()
	store.AddVertex(u, TestItem{Name: "u"}, graph.VertexProperties{})
	store.AddVertex(v, TestItem{Name: "v"}, graph.VertexProperties{})

	// Add Edge with Type
	err := store.AddEdge(u, v, graph.Edge[uuid.UUID]{
		Properties: graph.EdgeProperties{
			Attributes: map[string]string{"type": "follows"},
		},
	})
	assert.NoError(t, err)

	// Verify directly in DB
	var edgeType string
	// Order agnostic check
	uStr, vStr := u.String(), v.String()
	if uStr > vStr {
		uStr, vStr = vStr, uStr
	}

	err = db.QueryRow("SELECT edge_type FROM edges WHERE source_id=? AND target_id=?", uStr, vStr).Scan(&edgeType)
	assert.NoError(t, err)
	assert.Equal(t, "follows", edgeType)

	time.Sleep(10 * time.Millisecond)

	// Update Edge Type
	err = store.UpdateEdge(u, v, graph.Edge[uuid.UUID]{
		Properties: graph.EdgeProperties{
			Attributes: map[string]string{"type": "blocks"},
		},
	})
	assert.NoError(t, err)

	err = db.QueryRow("SELECT edge_type FROM edges WHERE source_id=? AND target_id=?", uStr, vStr).Scan(&edgeType)
	assert.NoError(t, err)
	assert.Equal(t, "blocks", edgeType)
}
