package gldr

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTemporalMarker_Chapter(t *testing.T) {
	m1 := NewChapterMarker(5)
	m2 := NewChapterMarker(10)
	m3 := NewChapterMarker(5)

	// Test source
	assert.Equal(t, TemporalSourceChapter, m1.Source)

	// Test comparison
	cmp, err := m1.Compare(m2)
	require.NoError(t, err)
	assert.Equal(t, -1, cmp)

	cmp, err = m2.Compare(m1)
	require.NoError(t, err)
	assert.Equal(t, 1, cmp)

	cmp, err = m1.Compare(m3)
	require.NoError(t, err)
	assert.Equal(t, 0, cmp)

	// Test Equal
	assert.True(t, m1.Equal(m3))
	assert.False(t, m1.Equal(m2))

	// Test Before/After
	before, err := m1.Before(m2)
	require.NoError(t, err)
	assert.True(t, before)

	after, err := m2.After(m1)
	require.NoError(t, err)
	assert.True(t, after)
}

func TestTemporalMarker_Calendar(t *testing.T) {
	m1 := NewCalendarMarker(1000)
	m2 := NewCalendarMarker(2000)

	assert.Equal(t, TemporalSourceCalendar, m1.Source)

	cmp, err := m1.Compare(m2)
	require.NoError(t, err)
	assert.Equal(t, -1, cmp)
}

func TestTemporalMarker_Story(t *testing.T) {
	m1 := NewStoryMarker("Day 01")
	m2 := NewStoryMarker("Day 02")
	m3 := NewStoryMarker("Day 10")

	assert.Equal(t, TemporalSourceStory, m1.Source)

	// Lexicographic comparison
	cmp, err := m1.Compare(m2)
	require.NoError(t, err)
	assert.Equal(t, -1, cmp, "Day 01 < Day 02")

	cmp, err = m2.Compare(m3)
	require.NoError(t, err)
	assert.Equal(t, -1, cmp, "Day 02 < Day 10 (lexicographic)")

	// Note: "Day 2" > "Day 10" lexicographically!
	m4 := NewStoryMarker("Day 2")
	cmp, err = m4.Compare(m3)
	require.NoError(t, err)
	assert.Equal(t, 1, cmp, "Day 2 > Day 10 (lexicographic - use zero-padding!)")
}

func TestTemporalMarker_Ordinal(t *testing.T) {
	m1 := NewOrdinalMarker(100)
	m2 := NewOrdinalMarker(200)

	assert.Equal(t, TemporalSourceOrdinal, m1.Source)

	cmp, err := m1.Compare(m2)
	require.NoError(t, err)
	assert.Equal(t, -1, cmp)
}

func TestTemporalMarker_MixedSources(t *testing.T) {
	m1 := NewChapterMarker(5)
	m2 := NewCalendarMarker(1000)

	_, err := m1.Compare(m2)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "different temporal sources")

	assert.False(t, m1.Equal(m2))
}

func TestTemporalMarker_IsZero(t *testing.T) {
	// Empty marker
	m := &TemporalMarker{}
	assert.True(t, m.IsZero())

	// Marker with source but no value
	m = &TemporalMarker{Source: TemporalSourceChapter}
	assert.True(t, m.IsZero())

	// Marker with value
	m = NewChapterMarker(1)
	assert.False(t, m.IsZero())
}

func TestTemporalRange_Contains(t *testing.T) {
	start := NewChapterMarker(3)
	end := NewChapterMarker(7)
	range_ := NewTemporalRange(start, end)

	// Inside range
	m := NewChapterMarker(5)
	contains, err := range_.Contains(m)
	require.NoError(t, err)
	assert.True(t, contains)

	// At start (inclusive)
	m = NewChapterMarker(3)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.True(t, contains)

	// At end (inclusive)
	m = NewChapterMarker(7)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.True(t, contains)

	// Before range
	m = NewChapterMarker(2)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.False(t, contains)

	// After range
	m = NewChapterMarker(8)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.False(t, contains)
}

func TestTemporalRange_ExclusiveBounds(t *testing.T) {
	start := NewChapterMarker(3)
	end := NewChapterMarker(7)
	range_ := &TemporalRange{
		Start:          start,
		End:            end,
		StartInclusive: false,
		EndInclusive:   false,
	}

	// At start (exclusive)
	m := NewChapterMarker(3)
	contains, err := range_.Contains(m)
	require.NoError(t, err)
	assert.False(t, contains)

	// At end (exclusive)
	m = NewChapterMarker(7)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.False(t, contains)

	// Just inside
	m = NewChapterMarker(4)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.True(t, contains)
}

func TestTemporalRange_OpenEnded(t *testing.T) {
	// Open-ended start
	range_ := &TemporalRange{
		End:          NewChapterMarker(5),
		EndInclusive: true,
	}

	m := NewChapterMarker(100)
	contains, err := range_.Contains(m)
	require.NoError(t, err)
	assert.False(t, contains)

	m = NewChapterMarker(3)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.True(t, contains)

	// Open-ended end
	range_ = &TemporalRange{
		Start:          NewChapterMarker(5),
		StartInclusive: true,
	}

	m = NewChapterMarker(3)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.False(t, contains)

	m = NewChapterMarker(100)
	contains, err = range_.Contains(m)
	require.NoError(t, err)
	assert.True(t, contains)
}

func TestTemporalQueryOptions_Helpers(t *testing.T) {
	// AsOfSnapshot
	opts := AsOfSnapshot(NewChapterMarker(5))
	assert.Equal(t, "snapshot", opts.TemporalMode)
	assert.True(t, opts.IncludeTimeless)
	assert.NotNil(t, opts.AsOf)

	// DuringRange
	opts = DuringRange(NewChapterMarker(3), NewChapterMarker(7))
	assert.Equal(t, "strict", opts.TemporalMode)
	assert.False(t, opts.IncludeTimeless)
	assert.NotNil(t, opts.During)
}

func TestFindPaths_TemporalFilter(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Create a graph with temporal edges:
	// A -> B (valid chapters 1-5)
	// B -> C (valid chapters 3-7)
	// A -> D (valid chapters 6-10)
	// D -> C (valid chapters 6-10)
	//
	// At chapter 4: A -> B -> C is valid (path length 2)
	// At chapter 8: A -> D -> C is valid (path length 2)
	// At chapter 2: only A -> B is valid, no path to C

	idx.AddGraphEdgeWithTemporal("A", GraphEdge{TargetID: "B", RelType: "links"}, NewChapterMarker(1), NewChapterMarker(5))
	idx.AddGraphEdgeWithTemporal("B", GraphEdge{TargetID: "C", RelType: "links"}, NewChapterMarker(3), NewChapterMarker(7))
	idx.AddGraphEdgeWithTemporal("A", GraphEdge{TargetID: "D", RelType: "links"}, NewChapterMarker(6), NewChapterMarker(10))
	idx.AddGraphEdgeWithTemporal("D", GraphEdge{TargetID: "C", RelType: "links"}, NewChapterMarker(6), NewChapterMarker(10))

	// Test path at chapter 4 (should find A -> B -> C)
	path, err := idx.FindPaths("A", "C", AsOfSnapshot(NewChapterMarker(4)))
	require.NoError(t, err)
	require.Len(t, path, 3)
	assert.Equal(t, "A", path[0])
	assert.Equal(t, "B", path[1])
	assert.Equal(t, "C", path[2])

	// Test path at chapter 8 (should find A -> D -> C)
	path, err = idx.FindPaths("A", "C", AsOfSnapshot(NewChapterMarker(8)))
	require.NoError(t, err)
	require.Len(t, path, 3)
	assert.Equal(t, "A", path[0])
	assert.Equal(t, "D", path[1])
	assert.Equal(t, "C", path[2])

	// Test path at chapter 2 (no path to C)
	path, err = idx.FindPaths("A", "C", AsOfSnapshot(NewChapterMarker(2)))
	assert.Error(t, err) // no path exists
	assert.Nil(t, path)

	// Test without temporal filter (should find shortest path)
	path, err = idx.FindPaths("A", "C", nil)
	require.NoError(t, err)
	require.Len(t, path, 3) // A -> B -> C or A -> D -> C
}

func TestExtractSubgraph_TemporalFilter(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Create a graph:
	// Center -> N1 (chapters 1-5)
	// Center -> N2 (chapters 3-7)
	// Center -> N3 (timeless)
	// N1 -> N4 (chapters 1-5)

	idx.AddGraphEdgeWithTemporal("Center", GraphEdge{TargetID: "N1", RelType: "links"}, NewChapterMarker(1), NewChapterMarker(5))
	idx.AddGraphEdgeWithTemporal("Center", GraphEdge{TargetID: "N2", RelType: "links"}, NewChapterMarker(3), NewChapterMarker(7))
	idx.AddGraphEdge("Center", GraphEdge{TargetID: "N3", RelType: "links"}) // timeless
	idx.AddGraphEdgeWithTemporal("N1", GraphEdge{TargetID: "N4", RelType: "links"}, NewChapterMarker(1), NewChapterMarker(5))

	// Extract subgraph at chapter 4, depth 2, including timeless
	sg, err := idx.ExtractSubgraph("Center", 2, &TemporalQueryOptions{
		TemporalMode:    "snapshot",
		AsOf:            NewChapterMarker(4),
		IncludeTimeless: true,
	})
	require.NoError(t, err)
	assert.Equal(t, "Center", sg.RootEntity)

	// Should have nodes: Center, N1, N2, N3, N4
	nodeIDs := make(map[string]bool)
	for _, node := range sg.Nodes {
		nodeIDs[node.EntityID] = true
	}
	assert.True(t, nodeIDs["Center"])
	assert.True(t, nodeIDs["N1"]) // valid at chapter 4
	assert.True(t, nodeIDs["N2"]) // valid at chapter 4
	assert.True(t, nodeIDs["N3"]) // timeless, included
	assert.True(t, nodeIDs["N4"]) // reachable via N1

	// Extract subgraph at chapter 4, excluding timeless
	sg, err = idx.ExtractSubgraph("Center", 2, &TemporalQueryOptions{
		TemporalMode:    "snapshot",
		AsOf:            NewChapterMarker(4),
		IncludeTimeless: false,
	})
	require.NoError(t, err)
	nodeIDs = make(map[string]bool)
	for _, node := range sg.Nodes {
		nodeIDs[node.EntityID] = true
	}
	assert.True(t, nodeIDs["Center"])
	assert.True(t, nodeIDs["N1"])
	assert.True(t, nodeIDs["N2"])
	assert.False(t, nodeIDs["N3"]) // timeless, excluded
	assert.True(t, nodeIDs["N4"])

	// Extract subgraph at chapter 6 (N1 and N4 not valid)
	sg, err = idx.ExtractSubgraph("Center", 2, &TemporalQueryOptions{
		TemporalMode:    "snapshot",
		AsOf:            NewChapterMarker(6),
		IncludeTimeless: true,
	})
	require.NoError(t, err)
	nodeIDs = make(map[string]bool)
	for _, node := range sg.Nodes {
		nodeIDs[node.EntityID] = true
	}
	assert.True(t, nodeIDs["Center"])
	assert.False(t, nodeIDs["N1"]) // not valid at chapter 6
	assert.True(t, nodeIDs["N2"])  // valid at chapter 6
	assert.True(t, nodeIDs["N3"])  // timeless
	assert.False(t, nodeIDs["N4"]) // not reachable (N1 edge not valid)
}

func TestGetNeighbors_TemporalFilter(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Create a star graph:
	// Center -> N1 (chapters 1-5)
	// Center -> N2 (chapters 3-7)
	// Center -> N3 (timeless)

	idx.AddGraphEdgeWithTemporal("Center", GraphEdge{TargetID: "N1", RelType: "links"}, NewChapterMarker(1), NewChapterMarker(5))
	idx.AddGraphEdgeWithTemporal("Center", GraphEdge{TargetID: "N2", RelType: "links"}, NewChapterMarker(3), NewChapterMarker(7))
	idx.AddGraphEdge("Center", GraphEdge{TargetID: "N3", RelType: "links"}) // timeless

	// Get neighbors at chapter 4, including timeless
	neighbors, err := idx.GetNeighbors("Center", 1, &TemporalQueryOptions{
		TemporalMode:    "snapshot",
		AsOf:            NewChapterMarker(4),
		IncludeTimeless: true,
	})
	require.NoError(t, err)
	assert.Len(t, neighbors, 3)

	neighborSet := make(map[string]bool)
	for _, n := range neighbors {
		neighborSet[n] = true
	}
	assert.True(t, neighborSet["N1"])
	assert.True(t, neighborSet["N2"])
	assert.True(t, neighborSet["N3"])

	// Get neighbors at chapter 6, excluding timeless
	neighbors, err = idx.GetNeighbors("Center", 1, &TemporalQueryOptions{
		TemporalMode:    "snapshot",
		AsOf:            NewChapterMarker(6),
		IncludeTimeless: false,
	})
	require.NoError(t, err)
	assert.Len(t, neighbors, 1)
	assert.Equal(t, "N2", neighbors[0]) // only N2 valid at chapter 6

	// Get neighbors without temporal filter
	neighbors, err = idx.GetNeighbors("Center", 1, nil)
	require.NoError(t, err)
	assert.Len(t, neighbors, 3)
}

func TestFindPaths_RelationalFilter(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Create a graph with different edge types:
	// A -(fight)-> B
	// B -(talk)-> C
	// A -(talk)-> D
	// D -(fight)-> C
	// We want to find A -> C using ONLY 'fight' edges.

	idx.AddGraphEdge("A", GraphEdge{TargetID: "B", RelType: "fight"})
	idx.AddGraphEdge("B", GraphEdge{TargetID: "C", RelType: "talk"})
	idx.AddGraphEdge("A", GraphEdge{TargetID: "D", RelType: "talk"})
	idx.AddGraphEdge("D", GraphEdge{TargetID: "C", RelType: "fight"})
	idx.AddGraphEdge("A", GraphEdge{TargetID: "E", RelType: "fight"})
	idx.AddGraphEdge("E", GraphEdge{TargetID: "C", RelType: "fight"})

	opts := &TemporalQueryOptions{
		TemporalMode:     "full", // No time restrictions
		IncludeTimeless:  true,
		AllowedRelations: []string{"fight"},
	}

	// Should route through E (A -(fight)-> E -(fight)-> C)
	path, err := idx.FindPaths("A", "C", opts)
	require.NoError(t, err)
	require.Len(t, path, 3)
	assert.Equal(t, "A", path[0])
	assert.Equal(t, "E", path[1])
	assert.Equal(t, "C", path[2])

	// Try with only "talk" edges
	opts.AllowedRelations = []string{"talk"}
	path, err = idx.FindPaths("A", "C", opts)
	assert.Error(t, err, "no path should exist entirely of 'talk' edges")
	assert.Nil(t, path)

	// Multiple constraints: allow 'fight' and 'talk'
	opts.AllowedRelations = []string{"fight", "talk"}
	path, err = idx.FindPaths("A", "C", opts)
	require.NoError(t, err)
	// Could route through B, D, or E now. But it shouldn't error.
	require.Len(t, path, 3)
}
