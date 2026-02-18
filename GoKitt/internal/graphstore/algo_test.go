package graphstore

import (
	"context"
	"database/sql"
	"sort"
	"testing"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test graph fixture:
//
//	0 -- 1 -- 2
//	|    |
//	3 -- 4 -- 5
//	|
//	6 (connected to 3)
//
// Edges: 0-1, 1-2, 0-3, 1-4, 3-4, 4-5, 3-6

func setupAlgoTestGraph(t *testing.T) (*sql.DB, *SQLiteStore[TestItem], map[string]uuid.UUID) {
	db, err := OpenDB("file::memory:?cache=shared")
	require.NoError(t, err, "failed to open db")

	err = Migrate(context.Background(), db)
	require.NoError(t, err, "failed to migrate")

	store := NewJSON[TestItem](db)

	// Create vertices
	vertices := make(map[string]uuid.UUID)
	for _, name := range []string{"v0", "v1", "v2", "v3", "v4", "v5", "v6"} {
		id := uuid.New()
		vertices[name] = id
		err := store.AddVertex(id, TestItem{Name: name}, graph.VertexProperties{})
		require.NoError(t, err, "failed to add vertex %s", name)
	}

	// Create edges (undirected - store handles both directions)
	edges := [][2]string{
		{"v0", "v1"},
		{"v1", "v2"},
		{"v0", "v3"},
		{"v1", "v4"},
		{"v3", "v4"},
		{"v4", "v5"},
		{"v3", "v6"},
	}

	for _, e := range edges {
		err := store.AddEdge(vertices[e[0]], vertices[e[1]], graph.Edge[uuid.UUID]{
			Properties: graph.EdgeProperties{Weight: 1},
		})
		require.NoError(t, err, "failed to add edge %s-%s", e[0], e[1])
	}

	return db, store, vertices
}

func TestDegree(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	tests := []struct {
		name     string
		expected int
	}{
		{"v0", 2}, // connected to v1, v3
		{"v1", 3}, // connected to v0, v2, v4
		{"v2", 1}, // connected to v1
		{"v3", 3}, // connected to v0, v4, v6
		{"v4", 3}, // connected to v1, v3, v5
		{"v5", 1}, // connected to v4
		{"v6", 1}, // connected to v3
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			deg, err := store.Degree(vertices[tc.name])
			assert.NoError(t, err)
			assert.Equal(t, tc.expected, deg, "degree of %s", tc.name)
		})
	}
}

func TestDegreeNotFound(t *testing.T) {
	db, store, _ := setupAlgoTestGraph(t)
	defer db.Close()

	_, err := store.Degree(uuid.New())
	assert.Equal(t, graph.ErrVertexNotFound, err)
}

func TestCommonNeighbors(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	// v0 and v4 share common neighbor v1 and v3
	// v0 neighbors: v1, v3
	// v4 neighbors: v1, v3, v5
	// common: v1, v3
	common, err := store.CommonNeighbors(vertices["v0"], vertices["v4"])
	require.NoError(t, err)

	// Convert to UUID set for assertion
	commonUUIDs := make(map[uuid.UUID]bool)
	it := common.Iterator()
	for it.HasNext() {
		idx := it.Next()
		uid, ok := store.registry.ReverseLookup(idx)
		require.True(t, ok)
		commonUUIDs[uid] = true
	}

	assert.True(t, commonUUIDs[vertices["v1"]], "v1 should be common neighbor")
	assert.True(t, commonUUIDs[vertices["v3"]], "v3 should be common neighbor")
	assert.Equal(t, 2, len(commonUUIDs), "should have exactly 2 common neighbors")
}

func TestCommonNeighborsNoCommon(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	// v2 and v6 have no common neighbors
	// v2 neighbors: v1
	// v6 neighbors: v3
	common, err := store.CommonNeighbors(vertices["v2"], vertices["v6"])
	require.NoError(t, err)
	assert.True(t, common.IsEmpty())
}

func TestJaccard(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	// v0 neighbors: v1, v3 (2)
	// v4 neighbors: v1, v3, v5 (3)
	// common: v1, v3 (2)
	// union: v1, v3, v5 (3)
	// jaccard = 2/3 ≈ 0.667
	jaccard, err := store.Jaccard(vertices["v0"], vertices["v4"])
	require.NoError(t, err)
	assert.InDelta(t, 2.0/3.0, jaccard, 0.001)
}

func TestJaccardNoCommon(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	jaccard, err := store.Jaccard(vertices["v2"], vertices["v6"])
	require.NoError(t, err)
	assert.Equal(t, 0.0, jaccard)
}

func TestAdamicAdar(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	// v0 and v4 share v1 (degree 3) and v3 (degree 3)
	// score = 1/log(3) + 1/log(3)
	score, err := store.AdamicAdar(vertices["v0"], vertices["v4"])
	require.NoError(t, err)

	expected := 2.0 / 1.098628 // 2 * 1/ln(3)
	assert.InDelta(t, expected, score, 0.001)
}

func TestClusteringCoefficient(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	// v0 neighbors: v1, v3
	// edges between v1 and v3? v1-v4-v3 path exists, but no direct v1-v3 edge
	// So clustering coefficient for v0 = 0
	cc, err := store.ClusteringCoefficient(vertices["v0"])
	require.NoError(t, err)
	assert.Equal(t, 0.0, cc)

	// v3 neighbors: v0, v4, v6
	// edges between neighbors: v0-v4 exists (via v0-v1-v4? no, check direct)
	// v0-v4: not directly connected
	// So clustering coefficient for v3 = 0
	cc3, err := store.ClusteringCoefficient(vertices["v3"])
	require.NoError(t, err)
	assert.Equal(t, 0.0, cc3)
}

func TestClusteringCoefficientComplete(t *testing.T) {
	db, err := OpenDB("file::memory:?cache=shared")
	require.NoError(t, err)
	defer db.Close()

	err = Migrate(context.Background(), db)
	require.NoError(t, err)

	store := NewJSON[TestItem](db)

	// Create a triangle: v0-v1, v1-v2, v0-v2
	ids := make([]uuid.UUID, 3)
	for i := range 3 {
		ids[i] = uuid.New()
		err := store.AddVertex(ids[i], TestItem{Name: "v"}, graph.VertexProperties{})
		require.NoError(t, err)
	}

	for i := range 3 {
		for j := i + 1; j < 3; j++ {
			err := store.AddEdge(ids[i], ids[j], graph.Edge[uuid.UUID]{})
			require.NoError(t, err)
		}
	}

	// In a triangle, each node has clustering coefficient = 1.0
	// (all neighbors are connected to each other)
	for i, id := range ids {
		cc, err := store.ClusteringCoefficient(id)
		require.NoError(t, err)
		assert.Equal(t, 1.0, cc, "clustering coefficient for node %d", i)
	}
}

func TestKHopBitmap(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	// 1-hop from v0: v1, v3
	k1, err := store.KHopBitmap(vertices["v0"], 1)
	require.NoError(t, err)
	assert.Equal(t, uint64(2), k1.GetCardinality())

	// 2-hop from v0: v1, v3, v2, v4, v6
	k2, err := store.KHopBitmap(vertices["v0"], 2)
	require.NoError(t, err)
	assert.Equal(t, uint64(5), k2.GetCardinality())

	// 3-hop from v0: adds v5
	k3, err := store.KHopBitmap(vertices["v0"], 3)
	require.NoError(t, err)
	assert.Equal(t, uint64(6), k3.GetCardinality())
}

func TestShortestPathUnweighted(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	// v0 to v5: v0 -> v3 -> v4 -> v5 (3 hops) or v0 -> v1 -> v4 -> v5 (3 hops)
	path, err := store.ShortestPathUnweighted(vertices["v0"], vertices["v5"])
	require.NoError(t, err)
	assert.Equal(t, 4, len(path), "path should have 4 nodes (3 hops)")
	assert.Equal(t, vertices["v0"], path[0])
	assert.Equal(t, vertices["v5"], path[len(path)-1])

	// v2 to v6: v2 -> v1 -> v0 -> v3 -> v6 or v2 -> v1 -> v4 -> v3 -> v6
	path2, err := store.ShortestPathUnweighted(vertices["v2"], vertices["v6"])
	require.NoError(t, err)
	assert.Equal(t, 5, len(path2), "path should have 5 nodes (4 hops)")
}

func TestShortestPathUnweightedSameNode(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	path, err := store.ShortestPathUnweighted(vertices["v0"], vertices["v0"])
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{vertices["v0"]}, path)
}

func TestShortestPathUnweightedNoPath(t *testing.T) {
	db, err := OpenDB("file::memory:?cache=shared")
	require.NoError(t, err)
	defer db.Close()

	err = Migrate(context.Background(), db)
	require.NoError(t, err)

	store := NewJSON[TestItem](db)

	// Create two disconnected components
	id1 := uuid.New()
	id2 := uuid.New()
	_ = store.AddVertex(id1, TestItem{Name: "v1"}, graph.VertexProperties{})
	_ = store.AddVertex(id2, TestItem{Name: "v2"}, graph.VertexProperties{})

	_, err = store.ShortestPathUnweighted(id1, id2)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no path")
}

func TestEgoNetwork(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	// Ego network of v3 with depth 1: v3, v0, v4, v6
	ego, err := store.EgoNetwork(vertices["v3"], 1)
	require.NoError(t, err)

	nodeSet := make(map[uuid.UUID]bool)
	for _, id := range ego.Nodes {
		nodeSet[id] = true
	}
	assert.True(t, nodeSet[vertices["v3"]], "should include root v3")
	assert.True(t, nodeSet[vertices["v0"]], "should include v0")
	assert.True(t, nodeSet[vertices["v4"]], "should include v4")
	assert.True(t, nodeSet[vertices["v6"]], "should include v6")
	assert.Equal(t, 4, len(ego.Nodes))

	// Edges within ego network: v3-v0, v3-v4, v3-v6
	assert.GreaterOrEqual(t, len(ego.Edges), 3)
}

func TestConnectedComponents(t *testing.T) {
	db, store, _ := setupAlgoTestGraph(t)
	defer db.Close()

	comps, err := store.ConnectedComponents()
	require.NoError(t, err)
	assert.Equal(t, 1, len(comps), "should have 1 connected component")
	assert.Equal(t, 7, len(comps[0]), "component should have 7 nodes")
}

func TestConnectedComponentsDisconnected(t *testing.T) {
	db, err := OpenDB("file::memory:?cache=shared")
	require.NoError(t, err)
	defer db.Close()

	err = Migrate(context.Background(), db)
	require.NoError(t, err)

	store := NewJSON[TestItem](db)

	// Create two disconnected components
	ids := make([]uuid.UUID, 4)
	for i := range 4 {
		ids[i] = uuid.New()
		_ = store.AddVertex(ids[i], TestItem{Name: "v"}, graph.VertexProperties{})
	}
	// Component 1: ids[0] -- ids[1]
	_ = store.AddEdge(ids[0], ids[1], graph.Edge[uuid.UUID]{})
	// Component 2: ids[2] -- ids[3]
	_ = store.AddEdge(ids[2], ids[3], graph.Edge[uuid.UUID]{})

	comps, err := store.ConnectedComponents()
	require.NoError(t, err)
	assert.Equal(t, 2, len(comps), "should have 2 connected components")

	// Sort by size for consistent assertion
	sort.Slice(comps, func(i, j int) bool {
		return len(comps[i]) < len(comps[j])
	})
	assert.Equal(t, 2, len(comps[0]))
	assert.Equal(t, 2, len(comps[1]))
}

func TestIsConnected(t *testing.T) {
	db, store, _ := setupAlgoTestGraph(t)
	defer db.Close()

	connected, err := store.IsConnected()
	require.NoError(t, err)
	assert.True(t, connected, "graph should be connected")
}

func TestLargestComponent(t *testing.T) {
	db, store, _ := setupAlgoTestGraph(t)
	defer db.Close()

	largest, err := store.LargestComponent()
	require.NoError(t, err)
	assert.Equal(t, 7, len(largest))
}

func TestPageRank(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	ranks, err := store.PageRank(PageRankOpts{})
	require.NoError(t, err)
	assert.Equal(t, 7, len(ranks))

	// All nodes should have some PageRank
	for name, id := range vertices {
		assert.Greater(t, ranks[id], 0.0, "PageRank for %s should be > 0", name)
	}

	// v1 and v4 should have higher PageRank (more central)
	// v2, v5, v6 are leaf nodes with lower PageRank
	assert.Greater(t, ranks[vertices["v1"]], ranks[vertices["v2"]], "v1 should outrank v2")
	assert.Greater(t, ranks[vertices["v4"]], ranks[vertices["v5"]], "v4 should outrank v5")
}

func TestLabelPropagation(t *testing.T) {
	db, store, _ := setupAlgoTestGraph(t)
	defer db.Close()

	communities, err := store.LabelPropagation(50)
	require.NoError(t, err)
	assert.Equal(t, 7, len(communities))

	// Label propagation is non-deterministic due to random shuffling.
	// For a connected graph, nodes should converge to 1 or 2 communities.
	// The key invariant: all nodes must have a community assignment.
	uniqueCommunities := make(map[uint32]bool)
	for _, comm := range communities {
		uniqueCommunities[comm] = true
	}
	assert.GreaterOrEqual(t, len(uniqueCommunities), 1, "should have at least 1 community")
	assert.LessOrEqual(t, len(uniqueCommunities), 2, "should have at most 2 communities for this graph")
}

func TestDegreeCentrality(t *testing.T) {
	db, store, vertices := setupAlgoTestGraph(t)
	defer db.Close()

	centrality, err := store.DegreeCentrality()
	require.NoError(t, err)
	assert.Equal(t, 7, len(centrality))

	// Max degree is 3, N-1 = 6
	// Normalized centrality for degree 3 = 3/6 = 0.5
	assert.InDelta(t, 0.5, centrality[vertices["v1"]], 0.001)
	assert.InDelta(t, 0.5, centrality[vertices["v3"]], 0.001)
	assert.InDelta(t, 0.5, centrality[vertices["v4"]], 0.001)

	// Leaf nodes have degree 1, normalized = 1/6 ≈ 0.167
	assert.InDelta(t, 1.0/6.0, centrality[vertices["v2"]], 0.001)
	assert.InDelta(t, 1.0/6.0, centrality[vertices["v5"]], 0.001)
	assert.InDelta(t, 1.0/6.0, centrality[vertices["v6"]], 0.001)
}

func TestDegreeCentralitySingleNode(t *testing.T) {
	db, err := OpenDB("file::memory:?cache=shared")
	require.NoError(t, err)
	defer db.Close()

	err = Migrate(context.Background(), db)
	require.NoError(t, err)

	store := NewJSON[TestItem](db)

	id := uuid.New()
	_ = store.AddVertex(id, TestItem{Name: "v"}, graph.VertexProperties{})

	// Single node: N=1, N-1=0, should return nil
	centrality, err := store.DegreeCentrality()
	require.NoError(t, err)
	assert.Nil(t, centrality)
}
