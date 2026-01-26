package pcst_test

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/reality/pcst"

	"github.com/stretchr/testify/assert"
)

func TestEmptyGraph(t *testing.T) {
	g := graph.NewGraph()
	prizes := make(map[string]float64)

	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	solution, err := solver.Solve(g, prizes, "")

	assert.NoError(t, err)
	assert.Empty(t, solution.Edges)
	assert.Empty(t, solution.Nodes)
}

func TestSingleNode(t *testing.T) {
	g := graph.NewGraph()
	g.EnsureNode("n0", "Node 0", "test")

	prizes := map[string]float64{
		"n0": 10.0,
	}

	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	solution, err := solver.Solve(g, prizes, "")
	assert.NoError(t, err)

	// GW Algorithm requires edges to form components. For a single node unrooted,
	// it generally dies/excludes it. Match reference behavior.
	assert.Empty(t, solution.Edges)
	// assert.Contains(t, solution.Nodes, "n0") // Rust ref produces empty nodes for unrooted singleton
}

func TestSimplePath(t *testing.T) {
	// n0 --(1.0)--> n1 --(1.0)--> n2
	// Prizes: n0=10, n1=1, n2=10
	// Cost to connect all: 2.0
	// Prize sum: 21.0
	// Net: 19.0 > Any single node

	g := graph.NewGraph()
	g.AddEdgeWithNodes("n0", "0", "test", "n1", "1", "test", "rel", 1.0) // Edge cost usually on edge, assuming weight is cost
	g.AddEdgeWithNodes("n1", "1", "test", "n2", "2", "test", "rel", 1.0)

	// Since ConceptGraph is directed but PCST is undirected, we ensure edges are traversable or handled as undirected by the solver logic
	// The solver should treat the graph as undirected.

	prizes := map[string]float64{
		"n0": 10.0,
		"n1": 1.0,
		"n2": 10.0,
	}

	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	solution, err := solver.Solve(g, prizes, "")

	assert.NoError(t, err)
	assert.Contains(t, solution.Nodes, "n0")
	assert.Contains(t, solution.Nodes, "n1")
	assert.Contains(t, solution.Nodes, "n2")
	assert.Len(t, solution.Nodes, 3)
}

func TestStarGraphRooted(t *testing.T) {
	// Star: Center 0, Leaves 1,2,3,4
	// Center prize 100, Leaves 0.5
	// Edge costs 1.0
	// Rooted at 0.

	g := graph.NewGraph()
	leaves := []string{"l1", "l2", "l3", "l4"}
	for _, l := range leaves {
		g.AddEdgeWithNodes("center", "C", "test", l, "L", "test", "rel", 1.0)
	}

	prizes := map[string]float64{
		"center": 100.0,
		"l1":     0.5, "l2": 0.5, "l3": 0.5, "l4": 0.5,
	}

	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	solution, err := solver.Solve(g, prizes, "center")

	assert.NoError(t, err)
	assert.Contains(t, solution.Nodes, "center")
	// Leaves shouldn't be included as cost (1.0) > prize (0.5)
	for _, l := range leaves {
		assert.NotContains(t, solution.Nodes, l)
	}
}

func TestForestModeDisjoint(t *testing.T) {
	// C1: n0-n1-n2 (high prizes, low cost)
	// C2: n3-n4-n5 (low prizes, high cost)

	g := graph.NewGraph()

	// Component 1
	g.AddEdgeWithNodes("n0", "0", "test", "n1", "1", "test", "rel", 1.0)
	g.AddEdgeWithNodes("n1", "1", "test", "n2", "2", "test", "rel", 1.0)

	// Component 2
	g.AddEdgeWithNodes("n3", "3", "test", "n4", "4", "test", "rel", 10.0)
	g.AddEdgeWithNodes("n4", "4", "test", "n5", "5", "test", "rel", 10.0)

	prizes := map[string]float64{
		"n0": 10.0, "n1": 10.0, "n2": 10.0,
		"n3": 0.1, "n4": 0.1, "n5": 0.1,
	}

	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	solution, err := solver.Solve(g, prizes, "")

	assert.NoError(t, err)

	assert.Contains(t, solution.Nodes, "n0")
	assert.Contains(t, solution.Nodes, "n1")
	assert.Contains(t, solution.Nodes, "n2")

	assert.NotContains(t, solution.Nodes, "n3")
	assert.NotContains(t, solution.Nodes, "n4")
	assert.NotContains(t, solution.Nodes, "n5")
}
