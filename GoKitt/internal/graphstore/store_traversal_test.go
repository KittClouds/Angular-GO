package graphstore

import (
	"context"
	"testing"
	"time"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestTraversalBFS(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	// Create Graph: A -> B -> C -> D
	//               A -> E
	idA, idB, idC, idD, idE := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	store.AddVertex(idA, TestItem{Name: "A"}, graph.VertexProperties{})
	store.AddVertex(idB, TestItem{Name: "B"}, graph.VertexProperties{})
	store.AddVertex(idC, TestItem{Name: "C"}, graph.VertexProperties{})
	store.AddVertex(idD, TestItem{Name: "D"}, graph.VertexProperties{})
	store.AddVertex(idE, TestItem{Name: "E"}, graph.VertexProperties{})

	store.AddEdge(idA, idB, graph.Edge[uuid.UUID]{})
	store.AddEdge(idB, idC, graph.Edge[uuid.UUID]{})
	store.AddEdge(idC, idD, graph.Edge[uuid.UUID]{})
	store.AddEdge(idA, idE, graph.Edge[uuid.UUID]{})

	// BFS from A
	opts := TraversalOptions{
		Root:      idA,
		Direction: DirectionOutbound,
		MinDepth:  0,
		MaxDepth:  -1, // Unbounded
		Strategy:  StrategyBFS,
	}

	results := make([]TraversalResult, 0)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	for res := range store.Traverse(ctx, opts) {
		results = append(results, res)
	}

	// Expected:
	// Depth 0: A
	// Depth 1: B, E
	// Depth 2: C
	// Depth 3: D

	// Total 5 nodes
	assert.Len(t, results, 5)

	// Verify Depths
	byDepth := make(map[int][]uuid.UUID)
	for _, r := range results {
		byDepth[r.Depth] = append(byDepth[r.Depth], r.Path[len(r.Path)-1])
	}

	assert.ElementsMatch(t, []uuid.UUID{idA}, byDepth[0])
	assert.ElementsMatch(t, []uuid.UUID{idB, idE}, byDepth[1])
	assert.ElementsMatch(t, []uuid.UUID{idC}, byDepth[2])
	assert.ElementsMatch(t, []uuid.UUID{idD}, byDepth[3])

	// Verify Path for D: A->B->C->D
	var pathD []uuid.UUID
	for _, r := range results {
		if r.Path[len(r.Path)-1] == idD {
			pathD = r.Path
			break
		}
	}
	assert.Equal(t, []uuid.UUID{idA, idB, idC, idD}, pathD)
}

func TestTraversalMaxDepth(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	idA, idB, idC := uuid.New(), uuid.New(), uuid.New()
	store.AddVertex(idA, TestItem{Name: "A"}, graph.VertexProperties{})
	store.AddVertex(idB, TestItem{Name: "B"}, graph.VertexProperties{})
	store.AddVertex(idC, TestItem{Name: "C"}, graph.VertexProperties{})

	store.AddEdge(idA, idB, graph.Edge[uuid.UUID]{})
	store.AddEdge(idB, idC, graph.Edge[uuid.UUID]{})

	opts := TraversalOptions{
		Root:      idA,
		Direction: DirectionOutbound,
		MinDepth:  0,
		MaxDepth:  1, // Only up to B
		Strategy:  StrategyBFS,
	}

	count := 0
	ctx := context.Background()
	for range store.Traverse(ctx, opts) {
		count++
	}

	// A (0), B (1) -> 2 results
	assert.Equal(t, 2, count)
}
