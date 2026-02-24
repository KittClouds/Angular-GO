package gldr

import (
	"testing"

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
	assert.Equal(t, 0.5, cfg.ProximityDecay)
	assert.Equal(t, 0.1, cfg.MinProximity)
	assert.Equal(t, 10, cfg.SoftAnchorChunks)
	assert.Equal(t, 0.3, cfg.Lambda)
	assert.Equal(t, 20, cfg.TopChunks)
	assert.Equal(t, 10, cfg.TopNodes)
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

	// Lexical: qgram should find the chunk by content
	results := idx.QGram.Search("Fiora", idx.Config.LexicalConfig, 10)
	assert.GreaterOrEqual(t, len(results), 1)
	assert.Equal(t, "chunk-1", results[0].DocID)
}

// --- P0: Graph edges ---

func TestAddGraphEdge(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.AddGraphEdge("entity-fiora", GraphEdge{
		TargetID:   "entity-castle",
		RelType:    "located_at",
		Confidence: 0.9,
		Source:     "explicit",
	})

	edges := idx.GraphAdj["entity-fiora"]
	require.Len(t, edges, 1)
	assert.Equal(t, "entity-castle", edges[0].TargetID)
	assert.Equal(t, "located_at", edges[0].RelType)
	assert.Equal(t, 0.9, edges[0].Confidence)
}

func TestAddGraphEdgeBidirectional(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	idx.AddGraphEdgeBidirectional("entity-fiora", "entity-castle", "located_at", 0.9, "explicit")

	// Both directions should exist
	assert.Len(t, idx.GraphAdj["entity-fiora"], 1)
	assert.Len(t, idx.GraphAdj["entity-castle"], 1)
	assert.Equal(t, "entity-castle", idx.GraphAdj["entity-fiora"][0].TargetID)
	assert.Equal(t, "entity-fiora", idx.GraphAdj["entity-castle"][0].TargetID)
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

	assert.Len(t, idx.GraphAdj["entity-fiora"], 1)
	assert.Equal(t, "entity-castle", idx.GraphAdj["entity-fiora"][0].TargetID)
	assert.Equal(t, "cooccurs", idx.GraphAdj["entity-fiora"][0].RelType)
	assert.Equal(t, 3.0, idx.GraphAdj["entity-fiora"][0].Confidence) // count as confidence

	// Bidirectional
	assert.Len(t, idx.GraphAdj["entity-castle"], 1)
	assert.Equal(t, "entity-fiora", idx.GraphAdj["entity-castle"][0].TargetID)
}

// --- P1: Graph proximity BFS ---

func TestComputeProximity(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Build a chain: A → B → C → D
	idx.AddGraphEdgeBidirectional("A", "B", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("B", "C", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("C", "D", "related", 1.0, "explicit")

	// BFS from A
	anchors := []EntityAnchor{{EntityID: "A", Confidence: 1.0, Source: "direct"}}
	prox := idx.ComputeProximity(anchors)

	// A = 1.0, B = 1.0 * 0.5 * 1.0 = 0.5, C = 0.5 * 0.5 * 1.0 = 0.25, D = 0.25 * 0.5 = 0.125
	assert.Equal(t, 1.0, prox["A"])
	assert.InDelta(t, 0.5, prox["B"], 0.001)
	assert.InDelta(t, 0.25, prox["C"], 0.001)
	assert.InDelta(t, 0.125, prox["D"], 0.001)
}

func TestComputeProximityMaxHops(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())
	// Override max hops to 2
	idx.Config.MaxGraphHops = 2

	// Build chain: A → B → C → D
	idx.AddGraphEdgeBidirectional("A", "B", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("B", "C", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("C", "D", "related", 1.0, "explicit")

	anchors := []EntityAnchor{{EntityID: "A", Confidence: 1.0, Source: "direct"}}
	prox := idx.ComputeProximity(anchors)

	// D should NOT be reachable (3 hops > max 2)
	assert.Contains(t, prox, "A")
	assert.Contains(t, prox, "B")
	assert.Contains(t, prox, "C")
	assert.NotContains(t, prox, "D")
}

func TestComputeProximityMinThreshold(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())
	idx.Config.MinProximity = 0.3

	// Build chain: A → B → C (decay 0.5 each hop)
	idx.AddGraphEdgeBidirectional("A", "B", "related", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("B", "C", "related", 1.0, "explicit")

	anchors := []EntityAnchor{{EntityID: "A", Confidence: 1.0, Source: "direct"}}
	prox := idx.ComputeProximity(anchors)

	// A=1.0 ✓, B=0.5 ✓, C=0.25 < 0.3 ✗
	assert.Contains(t, prox, "A")
	assert.Contains(t, prox, "B")
	assert.NotContains(t, prox, "C")
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
