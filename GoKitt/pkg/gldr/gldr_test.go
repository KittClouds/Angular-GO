package gldr

import (
	"testing"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"

	"github.com/kittclouds/gokitt/pkg/graptor"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- P0: Config defaults ---

func TestGLDRConfigDefaults(t *testing.T) {
	cfg := DefaultGLDRConfig()

	assert.Equal(t, 0.6, cfg.Alpha)
	assert.Equal(t, 0.4, cfg.Beta)
	assert.Equal(t, 3, cfg.MaxGraphHops)
	assert.Equal(t, 10, cfg.SoftAnchorChunks)
	assert.Equal(t, 0.3, cfg.Lambda)
	assert.Equal(t, 20, cfg.TopChunks)
	assert.Equal(t, 10, cfg.TopNodes)
	assert.Equal(t, 16, cfg.SemanticTopK)
	assert.Equal(t, 0.7, cfg.SemanticAlpha)
	assert.Equal(t, 0.25, cfg.SemanticGamma)
	assert.False(t, cfg.SemanticConfig.Hard)
	assert.Equal(t, 16, cfg.SemanticConfig.K)

	// PPR config
	assert.Equal(t, 0.85, cfg.PPRDamping)
	assert.Equal(t, 20, cfg.PPRIterations)
}

// --- P0: Index chunk / entity mapping ---

func TestIndexChunk(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	mentions := []EntityMention{
		{EntityID: "entity-fiora", Confidence: 1.0, Start: 0, End: 5},
		{EntityID: "entity-castle", Confidence: 0.8, Start: 20, End: 26},
	}

	idx.IndexChunk("chunk-1", map[string]string{"content": "Fiora walked to the castle gates"}, mentions)

	// EntityChunks: each entity should map to the chunk
	assert.True(t, idx.EntityChunks["entity-fiora"].Contains(idx.QGram.Mapper.Get("chunk-1")))
	assert.True(t, idx.EntityChunks["entity-castle"].Contains(idx.QGram.Mapper.Get("chunk-1")))

	// ChunkEntities: chunk should map back to both entities
	uid := idx.QGram.Mapper.Get("chunk-1")
	require.Len(t, idx.ChunkEntities[uid], 2)
	assert.Equal(t, "entity-fiora", idx.ChunkEntities[uid][0].EntityID)
	assert.Equal(t, "entity-castle", idx.ChunkEntities[uid][1].EntityID)
}

// --- P0: Graph edges (via GraphStore) ---

func TestAddGraphEdge(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.AddGraphEdge("entity-fiora", GraphEdge{
		TargetID:   "entity-castle",
		RelType:    "located_at",
		Confidence: 0.9,
		Source:     "explicit",
	})

	// Verify vertices exist in store
	val, _, err := idx.Store.Vertex(EntityUUID("entity-fiora"))
	require.NoError(t, err)
	assert.Equal(t, "entity-fiora", val)

	val, _, err = idx.Store.Vertex(EntityUUID("entity-castle"))
	require.NoError(t, err)
	assert.Equal(t, "entity-castle", val)

	// Verify edge count
	assert.Equal(t, 1, idx.GetEdgeCount())
}

func TestAddGraphEdgeBidirectional(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.AddGraphEdgeBidirectional("entity-fiora", "entity-castle", "located_at", 0.9, "explicit")

	// Both vertices should exist
	_, _, err := idx.Store.Vertex(EntityUUID("entity-fiora"))
	require.NoError(t, err)
	_, _, err = idx.Store.Vertex(EntityUUID("entity-castle"))
	require.NoError(t, err)

	// Edge count: GraphStore stores undirected as single edge
	assert.GreaterOrEqual(t, idx.GetEdgeCount(), 1)
}

// --- P0: Load from Graptor CooccurrenceStats ---

func TestLoadCooccurrences(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	cooc := graptor.NewCooccurrenceStats(3)
	cooc.RecordCooccurrence([]string{"entity-fiora", "entity-castle"}, 1)
	cooc.RecordCooccurrence([]string{"entity-fiora", "entity-castle"}, 1)
	cooc.RecordCooccurrence([]string{"entity-fiora", "entity-castle"}, 1)
	cooc.RecordCooccurrence([]string{"entity-fiora", "entity-sword"}, 1)

	// Load with minCount=2 → only fiora↔castle should appear
	idx.LoadCooccurrences(cooc, 2)

	// MaxEdgeWeight should track the raw max
	assert.Equal(t, 3.0, idx.MaxEdgeWeight)

	// Vertices should exist
	_, _, err := idx.Store.Vertex(EntityUUID("entity-fiora"))
	require.NoError(t, err)
	_, _, err = idx.Store.Vertex(EntityUUID("entity-castle"))
	require.NoError(t, err)

	// Edges should exist
	assert.GreaterOrEqual(t, idx.GetEdgeCount(), 1, "Should have at least 1 edge")
}

func TestLoadCooccurrencesNormalization(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	cooc := graptor.NewCooccurrenceStats(3)
	// fiora ↔ castle: 6 times
	for i := 0; i < 6; i++ {
		cooc.RecordCooccurrence([]string{"entity-fiora", "entity-castle"}, 1)
	}
	// fiora ↔ sword: 3 times
	for i := 0; i < 3; i++ {
		cooc.RecordCooccurrence([]string{"entity-fiora", "entity-sword"}, 1)
	}
	// castle ↔ sword: 2 times
	for i := 0; i < 2; i++ {
		cooc.RecordCooccurrence([]string{"entity-castle", "entity-sword"}, 1)
	}

	idx.LoadCooccurrences(cooc, 2)

	// Max count is 6 (fiora↔castle)
	assert.Equal(t, 6.0, idx.MaxEdgeWeight)

	// All three entity pairs should have edges
	assert.GreaterOrEqual(t, idx.GetEdgeCount(), 3, "Should have edges for all pairs")
	assert.Equal(t, 3, idx.GetVertexCount(), "Should have 3 vertices")
}

// --- P1: Graph proximity (PersonalizedPageRank via GraphStore) ---

func TestProximityBasicChain(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Chain: A → B → C → D
	idx.AddGraphEdgeBidirectional("A", "B", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("B", "C", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("C", "D", "related", 1.0, "explicit")

	anchors := []EntityAnchor{{EntityID: "A", Confidence: 1.0, Source: "direct"}}
	prox := idx.resolveProximity(anchors)

	require.NotNil(t, prox)
	// Anchor should have highest proximity
	assert.Greater(t, prox["A"], prox["B"], "Anchor A should have highest score")
	assert.Greater(t, prox["B"], prox["C"], "B (1 hop) should score higher than C (2 hops)")
	assert.Greater(t, prox["C"], prox["D"], "C (2 hops) should score higher than D (3 hops)")

	// All values should be in [0, 1]
	for id, p := range prox {
		assert.GreaterOrEqual(t, p, 0.0, "%s proximity should be >= 0", id)
		assert.LessOrEqual(t, p, 1.0, "%s proximity should be <= 1", id)
	}
}

func TestProximityHubRobustness(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Star graph: Ryan connects to 5 entities
	idx.AddGraphEdgeBidirectional("A", "Ryan", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("B", "Ryan", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("C", "Ryan", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("Ryan", "Ghoul", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("Ryan", "Len", "related", 1.0, "explicit")

	// Search from Ghoul
	anchors := []EntityAnchor{{EntityID: "Ghoul", Confidence: 1.0, Source: "direct"}}
	prox := idx.resolveProximity(anchors)

	// Ryan (direct neighbor) should be much higher than A, B, C (2 hops through hub)
	assert.Greater(t, prox["Ryan"], prox["A"],
		"Direct neighbor Ryan should have much higher proximity than 2-hop A")
	assert.Greater(t, prox["Ryan"], prox["B"])
	assert.Greater(t, prox["Ryan"], prox["C"])

	// Anchor should beat direct neighbor
	assert.Greater(t, prox["Ghoul"], prox["Ryan"], "Anchor should beat direct neighbor")
}

func TestProximityEmptyAnchors(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())
	idx.AddGraphEdgeBidirectional("A", "B", "related", 1.0, "explicit")

	prox := idx.resolveProximity(nil)
	assert.Nil(t, prox, "Empty anchors should return nil")
}

func TestProximityMaxHops(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())
	// Override max hops to 2
	idx.Config.MaxGraphHops = 2

	// Build chain: A → B → C → D
	idx.AddGraphEdgeBidirectional("A", "B", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("B", "C", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("C", "D", "related", 1.0, "explicit")

	anchors := []EntityAnchor{{EntityID: "A", Confidence: 1.0, Source: "direct"}}
	prox := idx.resolveProximity(anchors)

	// A, B, C should be reachable within 2 hops
	assert.Contains(t, prox, "A")
	assert.Contains(t, prox, "B")
	assert.Contains(t, prox, "C")
	// D at 3 hops should NOT be reachable (bounded to 2)
	_, hasD := prox["D"]
	assert.False(t, hasD, "D at 3 hops should not be reachable with maxHops=2")
}

func TestSearchDispatch(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Simple graph
	idx.AddGraphEdgeBidirectional("entity-fiora", "entity-castle", "related", 1.0, "explicit")
	idx.RegisterEntity("fiora", "entity-fiora")

	idx.IndexChunk("chunk-1", map[string]string{"content": "Fiora walked through the castle"},
		[]EntityMention{
			{EntityID: "entity-fiora", Confidence: 1.0, Start: 0, End: 5},
			{EntityID: "entity-castle", Confidence: 1.0, Start: 28, End: 34},
		})

	// Search should work (no panic, returns results)
	results := idx.Search("Fiora castle", idx.Config)
	require.NotEmpty(t, results, "Search should return results")
	assert.Greater(t, results[0].ChunkScore, 0.0, "Score should be positive")
}

// --- P1: Fused scoring ---

func TestFusedScoring(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Index two chunks with different entity profiles
	idx.IndexChunk("chunk-1", map[string]string{"content": "Fiora drew her sword at the castle"},
		[]EntityMention{
			{EntityID: "entity-fiora", Confidence: 1.0, Start: 0, End: 5},
			{EntityID: "entity-castle", Confidence: 1.0, Start: 27, End: 33},
		})
	idx.IndexChunk("chunk-2", map[string]string{"content": "The merchant sold potions in the market"},
		[]EntityMention{
			{EntityID: "entity-merchant", Confidence: 1.0, Start: 4, End: 12},
		})

	uid1 := idx.QGram.Mapper.Get("chunk-1")
	uid2 := idx.QGram.Mapper.Get("chunk-2")

	// Proximity: fiora and castle are near the query
	proximity := map[string]float64{
		"entity-fiora":  1.0,
		"entity-castle": 0.5,
	}

	// Lex scores: both chunks match somewhat
	lexScores := map[uint32]float64{
		uid1: 5.0,
		uid2: 4.0,
	}

	candidates := []uint32{uid1, uid2}
	results := idx.ScoreChunks(candidates, proximity, lexScores)

	require.Len(t, results, 2)
	// chunk-1 should rank higher (has both entity matches and good lex score)
	assert.Equal(t, "chunk-1", results[0].ChunkID)
	assert.Greater(t, results[0].ChunkScore, results[1].ChunkScore)
	assert.Greater(t, results[0].GraphScore, 0.0)
}

// --- P2: Node ranking ---

func TestRankNodes(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	chunkResults := []GLDRResult{
		{ChunkID: "chunk-1", ChunkScore: 0.9, MatchedEntities: []EntityMatch{
			{EntityID: "entity-fiora", Proximity: 1.0, MentionCount: 1},
			{EntityID: "entity-castle", Proximity: 0.5, MentionCount: 1},
		}},
		{ChunkID: "chunk-2", ChunkScore: 0.7, MatchedEntities: []EntityMatch{
			{EntityID: "entity-fiora", Proximity: 1.0, MentionCount: 1},
		}},
		{ChunkID: "chunk-3", ChunkScore: 0.5, MatchedEntities: []EntityMatch{
			{EntityID: "entity-castle", Proximity: 0.5, MentionCount: 1},
		}},
	}

	proximity := map[string]float64{
		"entity-fiora":  1.0,
		"entity-castle": 0.5,
	}

	nodes := idx.RankNodes(chunkResults, proximity)

	require.GreaterOrEqual(t, len(nodes), 2)
	// Fiora should rank highest (max chunk score 0.9 + proximity boost 1.0*0.3)
	assert.Equal(t, "entity-fiora", nodes[0].EntityID)
	assert.Greater(t, nodes[0].NodeScore, nodes[1].NodeScore)
	assert.GreaterOrEqual(t, len(nodes[0].TopChunks), 1)
}

// --- End-to-end search ---

func TestSearchEndToEnd(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Index chunks with entity mentions
	idx.IndexChunk("chunk-1", map[string]string{"content": "Fiora walked to the castle gates at dawn"},
		[]EntityMention{
			{EntityID: "entity-fiora", Confidence: 1.0, Start: 0, End: 5},
			{EntityID: "entity-castle", Confidence: 1.0, Start: 20, End: 26},
		})
	idx.IndexChunk("chunk-2", map[string]string{"content": "The merchant sold potions in the market square"},
		[]EntityMention{
			{EntityID: "entity-merchant", Confidence: 1.0, Start: 4, End: 12},
		})
	idx.IndexChunk("chunk-3", map[string]string{"content": "Fiora purchased a sword from the blacksmith"},
		[]EntityMention{
			{EntityID: "entity-fiora", Confidence: 1.0, Start: 0, End: 5},
			{EntityID: "entity-blacksmith", Confidence: 1.0, Start: 31, End: 41},
		})

	// Add graph edges
	idx.AddGraphEdgeBidirectional("entity-fiora", "entity-castle", "located_at", 0.9, "explicit")
	idx.AddGraphEdgeBidirectional("entity-fiora", "entity-blacksmith", "interacts", 0.8, "explicit")

	// Register known entities for anchor resolution
	idx.RegisterEntity("fiora", "entity-fiora")
	idx.RegisterEntity("castle", "entity-castle")

	// Search for "Fiora" — should find chunks 1 and 3 (both mention Fiora)
	results := idx.Search("Fiora", idx.Config)
	require.GreaterOrEqual(t, len(results), 2)

	// Both Fiora chunks should appear
	chunkIDs := make(map[string]bool)
	for _, r := range results {
		chunkIDs[r.ChunkID] = true
	}
	assert.True(t, chunkIDs["chunk-1"], "chunk-1 should be in results")
	assert.True(t, chunkIDs["chunk-3"], "chunk-3 should be in results")
}

func TestSearchNodesEndToEnd(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.IndexChunk("chunk-1", map[string]string{"content": "Fiora walked to the castle gates at dawn"},
		[]EntityMention{
			{EntityID: "entity-fiora", Confidence: 1.0, Start: 0, End: 5},
			{EntityID: "entity-castle", Confidence: 1.0, Start: 20, End: 26},
		})
	idx.IndexChunk("chunk-2", map[string]string{"content": "Fiora purchased a sword from the blacksmith"},
		[]EntityMention{
			{EntityID: "entity-fiora", Confidence: 1.0, Start: 0, End: 5},
			{EntityID: "entity-blacksmith", Confidence: 1.0, Start: 31, End: 41},
		})

	idx.AddGraphEdgeBidirectional("entity-fiora", "entity-castle", "located_at", 0.9, "explicit")
	idx.AddGraphEdgeBidirectional("entity-fiora", "entity-blacksmith", "interacts", 0.8, "explicit")

	idx.RegisterEntity("fiora", "entity-fiora")

	nodes := idx.SearchNodes("Fiora", idx.Config)
	require.GreaterOrEqual(t, len(nodes), 1)

	// Fiora should be the top node
	assert.Equal(t, "entity-fiora", nodes[0].EntityID)
	assert.Greater(t, nodes[0].NodeScore, 0.0)
}

// --- Delete ---

func TestDelete(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.IndexChunk("chunk-1", map[string]string{"content": "Fiora walked to the castle"},
		[]EntityMention{
			{EntityID: "entity-fiora", Confidence: 1.0, Start: 0, End: 5},
		})

	// Verify indexed
	results := idx.QGram.Search("Fiora", idx.Config.LexicalConfig, 10)
	require.Len(t, results, 1)

	// Delete
	idx.Delete("chunk-1")

	// Verify deleted from lexical
	results = idx.QGram.Search("Fiora", idx.Config.LexicalConfig, 10)
	assert.Len(t, results, 0)

	// Verify deleted from entity mappings
	uid := idx.QGram.Mapper.Get("chunk-1")
	assert.Empty(t, idx.ChunkEntities[uid])
}

// --- Edge cases ---

func TestEmptyQuery(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.IndexChunk("chunk-1", map[string]string{"content": "hello world"}, nil)

	results := idx.Search("", idx.Config)
	assert.Empty(t, results)
}

func TestSearchNoResults(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.IndexChunk("chunk-1", map[string]string{"content": "hello world"}, nil)

	results := idx.Search("nonexistent", idx.Config)
	assert.Empty(t, results)
}

// --- Zero-copy iteration ---

func TestForEachChunk(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.IndexChunk("chunk-1", map[string]string{"content": "Fiora"},
		[]EntityMention{{EntityID: "entity-fiora", Confidence: 1.0}})
	idx.IndexChunk("chunk-2", map[string]string{"content": "Castle"},
		[]EntityMention{{EntityID: "entity-castle", Confidence: 1.0}})

	count := 0
	idx.ForEachChunk(func(chunkID uint32, mentions []EntityMention) bool {
		count++
		return true
	})
	assert.Equal(t, 2, count)

	// Early termination
	earlyCount := 0
	idx.ForEachChunk(func(chunkID uint32, mentions []EntityMention) bool {
		earlyCount++
		return false // stop after first
	})
	assert.Equal(t, 1, earlyCount)
}

func TestGetEntityCount(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.IndexChunk("chunk-1", map[string]string{"content": "Fiora at castle"},
		[]EntityMention{
			{EntityID: "entity-fiora", Confidence: 1.0},
			{EntityID: "entity-castle", Confidence: 1.0},
		})

	assert.Equal(t, 2, idx.GetEntityCount())
}

// --- GraphStore-backed counters ---

func TestGetEdgeCount(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.AddGraphEdgeBidirectional("A", "B", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("B", "C", "related", 1.0, "explicit")

	assert.GreaterOrEqual(t, idx.GetEdgeCount(), 2, "Should have at least 2 edges")
}

func TestGetVertexCount(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.AddGraphEdgeBidirectional("A", "B", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("B", "C", "related", 1.0, "explicit")

	assert.Equal(t, 3, idx.GetVertexCount(), "Should have 3 vertices (A, B, C)")
}

// --- Temporal Edge Tests ---

func TestAddGraphEdgeWithTemporal(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Add edge with chapter-based temporal marker
	chapter := uint32(5)
	idx.AddGraphEdgeWithTemporal("entity-ryan", GraphEdge{
		TargetID:   "entity-len",
		RelType:    "meets",
		Confidence: 0.9,
		Source:     "explicit",
	}, NewChapterMarker(chapter), nil)

	// Retrieve edges
	edges := idx.GetGraphEdges("entity-ryan")
	require.Len(t, edges, 1)

	// Verify temporal marker was serialized/deserialized
	assert.NotNil(t, edges[0].ValidFrom)
	assert.Equal(t, TemporalSourceChapter, edges[0].ValidFrom.Source)
	assert.Equal(t, chapter, *edges[0].ValidFrom.Chapter)
	assert.Nil(t, edges[0].ValidUntil)
}

func TestGetGraphEdgesAt(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Add edges with different temporal ranges
	ch1 := uint32(1)
	ch3 := uint32(3)
	ch5 := uint32(5)

	// Edge valid from chapter 1 to chapter 5
	idx.AddGraphEdgeWithTemporal("A", GraphEdge{
		TargetID:   "B",
		RelType:    "ally",
		Confidence: 0.9,
		Source:     "explicit",
	}, NewChapterMarker(ch1), NewChapterMarker(ch5))

	// Edge valid from chapter 3 onwards
	idx.AddGraphEdgeWithTemporal("A", GraphEdge{
		TargetID:   "C",
		RelType:    "enemy",
		Confidence: 0.8,
		Source:     "explicit",
	}, NewChapterMarker(ch3), nil)

	// Timeless edge (no temporal markers)
	idx.AddGraphEdge("A", GraphEdge{
		TargetID:   "D",
		RelType:    "neutral",
		Confidence: 0.5,
		Source:     "inferred",
	})

	// Query at chapter 2: should get B (valid 1-5) and D (timeless)
	edges2 := idx.GetGraphEdgesAt("A", NewChapterMarker(2))
	assert.Len(t, edges2, 2)
	targets2 := make(map[string]bool)
	for _, e := range edges2 {
		targets2[e.TargetID] = true
	}
	assert.True(t, targets2["B"])
	assert.True(t, targets2["D"])

	// Query at chapter 4: should get B (valid 1-5), C (valid 3+), and D (timeless)
	edges4 := idx.GetGraphEdgesAt("A", NewChapterMarker(4))
	assert.Len(t, edges4, 3)

	// Query at chapter 10: should get C (valid 3+) and D (timeless)
	edges10 := idx.GetGraphEdgesAt("A", NewChapterMarker(10))
	assert.Len(t, edges10, 2)
	targets10 := make(map[string]bool)
	for _, e := range edges10 {
		targets10[e.TargetID] = true
	}
	assert.True(t, targets10["C"])
	assert.True(t, targets10["D"])
}

func TestFilterEdgesByTime(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Add edges with temporal markers
	ch1 := uint32(1)
	ch5 := uint32(5)

	idx.AddGraphEdgeWithTemporal("A", GraphEdge{
		TargetID:   "B",
		RelType:    "ally",
		Confidence: 0.9,
		Source:     "explicit",
	}, NewChapterMarker(ch1), NewChapterMarker(ch5))

	idx.AddGraphEdge("A", GraphEdge{
		TargetID:   "C",
		RelType:    "neutral",
		Confidence: 0.5,
		Source:     "inferred",
	})

	edges := idx.GetGraphEdges("A")

	// Filter with AsOf snapshot at chapter 3
	filtered := idx.FilterEdgesByTime(edges, AsOfSnapshot(NewChapterMarker(3)))
	assert.Len(t, filtered, 2) // Both B and C (timeless)

	// Filter with strict mode (no timeless)
	filteredStrict := idx.FilterEdgesByTime(edges, &TemporalQueryOptions{
		AsOf:            NewChapterMarker(3),
		IncludeTimeless: false,
		TemporalMode:    "strict",
	})
	assert.Len(t, filteredStrict, 1) // Only B
	assert.Equal(t, "B", filteredStrict[0].TargetID)

	// Filter with full mode (ignore temporal)
	filteredFull := idx.FilterEdgesByTime(edges, &TemporalQueryOptions{
		TemporalMode: "full",
	})
	assert.Len(t, filteredFull, 2)
}

func TestTemporalEdgeRoundTrip(t *testing.T) {
	// Test all temporal source types
	tests := []struct {
		name   string
		marker *TemporalMarker
	}{
		{"chapter", NewChapterMarker(42)},
		{"calendar", NewCalendarMarker(1704067200000)}, // 2024-01-01
		{"story", NewStoryMarker("Day 15")},
		{"ordinal", NewOrdinalMarker(100)},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Create a fresh index for each test case
			idx := NewGLDR(DefaultGLDRConfig())

			targetID := "entity-" + tc.name
			idx.AddGraphEdgeWithTemporal("source", GraphEdge{
				TargetID:   targetID,
				RelType:    "test",
				Confidence: 1.0,
				Source:     "test",
			}, tc.marker, nil)

			edges := idx.GetGraphEdges("source")
			require.Len(t, edges, 1)

			assert.NotNil(t, edges[0].ValidFrom)
			assert.Equal(t, tc.marker.Source, edges[0].ValidFrom.Source)
			assert.True(t, edges[0].ValidFrom.Equal(tc.marker))
		})
	}
}

func TestSearchWithVectorSemanticExpansion(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	vecA := make([]float32, 256)
	vecB := make([]float32, 256)
	queryVec := make([]float32, 256)
	for i := range vecA {
		if i < 128 {
			vecA[i] = 1.0
			vecB[i] = 0.0
			queryVec[i] = 1.0
		} else {
			vecA[i] = 0.0
			vecB[i] = 1.0
			queryVec[i] = 0.0
		}
	}

	idx.IndexChunkWithVector("chunk-semantic", map[string]string{"content": "azure falcon glides nightly"}, nil, vecA)
	idx.IndexChunkWithVector("chunk-unrelated", map[string]string{"content": "iron merchant counts coins"}, nil, vecB)

	results := idx.SearchWithVector("storm prophecy", queryVec, idx.Config)
	require.NotEmpty(t, results)
	assert.Equal(t, "chunk-semantic", results[0].ChunkID)
	assert.Greater(t, results[0].SemanticScore, 0.0)
	assert.Zero(t, results[0].LexScore)
}
