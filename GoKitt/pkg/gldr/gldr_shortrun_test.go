package gldr_test

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"

	"github.com/kittclouds/gokitt/pkg/gldr"
	"github.com/kittclouds/gokitt/pkg/graptor"
	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// chapterInput mirrors graptor.ChapterInput but we parse it ourselves since
// parseChapters is unexported in graptor (it lives in _test.go over there).
type chapterInput struct {
	id   uint32
	text string
}

func loadShortrun(t *testing.T) (string, []chapterInput) {
	t.Helper()

	docPath := "../../../docs/shortrun.md"
	content, err := os.ReadFile(docPath)
	if err != nil {
		t.Skipf("Skipping: could not read %s: %v", docPath, err)
	}

	text := string(content)
	chapters := parseChapters(text)
	if len(chapters) == 0 {
		t.Fatal("No chapters found in shortrun.md")
	}

	return text, chapters
}

func parseChapters(text string) []chapterInput {
	var chapters []chapterInput
	chapterRegex := regexp.MustCompile(`(?i)^##\s*Chapter\s*(\d+)[:.]?\s*(.*)$`)
	lines := strings.Split(text, "\n")

	var currentID uint32
	var buf strings.Builder
	var found bool

	for _, line := range lines {
		matches := chapterRegex.FindStringSubmatch(line)
		if matches != nil {
			if found && buf.Len() > 0 {
				chapters = append(chapters, chapterInput{id: currentID, text: strings.TrimSpace(buf.String())})
			}
			fmt.Sscanf(matches[1], "%d", &currentID)
			buf.Reset()
			found = true
			continue
		}
		if found {
			buf.WriteString(line)
			buf.WriteString("\n")
		}
	}
	if found && buf.Len() > 0 {
		chapters = append(chapters, chapterInput{id: currentID, text: strings.TrimSpace(buf.String())})
	}
	return chapters
}

// seedEntities returns the canonical entity list for "The Perfect Run".
func seedEntities() []implicitmatcher.RegisteredEntity {
	return []implicitmatcher.RegisteredEntity{
		{ID: "char-ryan", Label: "Ryan", Aliases: []string{"Quicksave", "Riri"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-len", Label: "Len", Aliases: []string{"Underdiver"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-wyvern", Label: "Wyvern", Kind: implicitmatcher.KindCharacter},
		{ID: "char-ghoul", Label: "Ghoul", Kind: implicitmatcher.KindCharacter},
		{ID: "char-zanbato", Label: "Zanbato", Aliases: []string{"Jamie", "Zan"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-sarin", Label: "Sarin", Kind: implicitmatcher.KindCharacter},
		{ID: "char-vulcan", Label: "Vulcan", Kind: implicitmatcher.KindCharacter},
		{ID: "char-renesco", Label: "Renesco", Kind: implicitmatcher.KindCharacter},
		{ID: "char-luigi", Label: "Luigi", Aliases: []string{"Crypto"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-ki-jung", Label: "Ki-jung", Aliases: []string{"Chitter"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-lanka", Label: "Lanka", Aliases: []string{"Sphere"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-pluto", Label: "Pluto", Kind: implicitmatcher.KindCharacter},
		{ID: "char-augustus", Label: "Augustus", Kind: implicitmatcher.KindCharacter},
		{ID: "char-paulie", Label: "Paulie", Kind: implicitmatcher.KindCharacter},
		{ID: "char-bloodstream", Label: "Bloodstream", Kind: implicitmatcher.KindCharacter},
		{ID: "loc-new-rome", Label: "New Rome", Kind: implicitmatcher.KindPlace},
		{ID: "loc-rust-town", Label: "Rust Town", Kind: implicitmatcher.KindPlace},
		{ID: "loc-bakuto", Label: "Bakuto", Kind: implicitmatcher.KindPlace},
		{ID: "loc-dynamis", Label: "Dynamis", Kind: implicitmatcher.KindPlace},
		{ID: "org-augusti", Label: "Augusti", Kind: implicitmatcher.KindFaction},
		{ID: "org-meta-gang", Label: "Meta-Gang", Aliases: []string{"Meta"}, Kind: implicitmatcher.KindFaction},
		{ID: "org-migliore", Label: "Il Migliore", Kind: implicitmatcher.KindOrganization},
	}
}

// runGraptorPipeline ingests shortrun.md through Graptor and returns the
// DocumentGraph so we can feed its output into GLDR.
func runGraptorPipeline(t *testing.T, text string, chapters []chapterInput) *graptor.DocumentGraph {
	t.Helper()

	config := graptor.DefaultConductorConfig()
	config.MaxHistory = 200
	config.CarryOverSize = 20

	conductor, err := graptor.NewGraptorConductor(config)
	require.NoError(t, err, "Failed to create GraptorConductor")

	seeds := seedEntities()
	dict, err := implicitmatcher.Compile(seeds)
	require.NoError(t, err, "Failed to compile seed entities")

	conductor.SetDictionary(dict)
	conductor.SeedRegistry(seeds)
	conductor.SeedDiscovery(seeds)

	// Convert our chapterInput → graptor.ChapterInput
	graptorChapters := make([]graptor.ChapterInput, len(chapters))
	for i, ch := range chapters {
		graptorChapters[i] = graptor.ChapterInput{
			ChapterID: ch.id,
			Text:      ch.text,
		}
	}

	docGraph, err := conductor.IngestDocument("shortrun-gldr-test", text, graptorChapters)
	require.NoError(t, err, "Failed to ingest document")

	return docGraph
}

// buildGLDR creates and populates a GLDRIndex from a Graptor DocumentGraph.
func buildGLDR(t *testing.T, docGraph *graptor.DocumentGraph, chapters []chapterInput) *gldr.GLDRIndex {
	t.Helper()

	idx := gldr.NewGLDR(gldr.DefaultGLDRConfig())
	registry := docGraph.Registry

	// 1. Index each chapter as a GLDR chunk, with entity mentions extracted by Graptor.
	for _, ch := range chapters {
		chunkID := fmt.Sprintf("chapter-%d", ch.id)

		// Get entities that Graptor found in this chapter
		entities := registry.GetChapterEntities(ch.id)
		mentions := make([]gldr.EntityMention, 0, len(entities))
		for _, entity := range entities {
			// Get all mentions of this entity in this specific chapter
			allMentions := registry.GetMentions(entity.ID)
			for _, m := range allMentions {
				if m.ChapterID == ch.id {
					mentions = append(mentions, gldr.EntityMention{
						EntityID:   entity.ID,
						Confidence: 1.0,
						Start:      m.Start,
						End:        m.End,
					})
				}
			}
		}

		idx.IndexChunk(chunkID, map[string]string{"content": ch.text}, mentions)
	}

	// 2. Load co-occurrence edges from Graptor.
	idx.LoadCooccurrences(docGraph.Cooccurrence, 2)

	// 2.5 Load structural / event semantic edges from Graptor.
	idx.LoadGraphEdges(docGraph)

	// 3. Register entity names for anchor resolution.
	allEntities := registry.GetAllEntities()
	for _, entity := range allEntities {
		idx.RegisterEntity(entity.CanonicalName, entity.ID)
		for _, alias := range entity.Aliases {
			idx.RegisterEntity(alias, entity.ID)
		}
	}

	return idx
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestGLDRShortrunIntegration is the full pipeline test:
//
//	shortrun.md → Graptor → GLDR → Search → assertions
func TestGLDRShortrunIntegration(t *testing.T) {
	text, chapters := loadShortrun(t)
	t.Logf("📄 Loaded %d chapters (%d chars)", len(chapters), len(text))

	docGraph := runGraptorPipeline(t, text, chapters)
	defer docGraph.Dispose()
	t.Logf("🔬 Graptor processed: %d entities, %d mentions, %d co-occurrence edges",
		docGraph.Stats.TotalEntities, docGraph.Stats.TotalMentions, docGraph.Stats.CrossChapterLinks)

	idx := buildGLDR(t, docGraph, chapters)

	// --- Stats checks ---
	t.Logf("📊 GLDR index: %d chunks, %d entities, %d graph edges",
		idx.Len(), idx.GetEntityCount(), idx.GetEdgeCount())

	assert.Equal(t, len(chapters), idx.Len(), "Chunk count should match chapter count")
	assert.GreaterOrEqual(t, idx.GetEntityCount(), 5, "Should have at least 5 entities")
	assert.Greater(t, idx.GetEdgeCount(), 0, "Graph should have edges after LoadCooccurrences")

	// --- Search: "Ryan" should hit chapters mentioning Ryan ---
	t.Run("Search_Ryan", func(t *testing.T) {
		results := idx.Search("Ryan", idx.Config)
		require.NotEmpty(t, results, "Search for 'Ryan' should return results")
		t.Logf("  ➡ %d results for 'Ryan'", len(results))

		for i, r := range results {
			t.Logf("    [%d] %s score=%.4f (lex=%.4f graph=%.4f entities=%d)",
				i, r.ChunkID, r.ChunkScore, r.LexScore, r.GraphScore, len(r.MatchedEntities))
		}

		// Ryan appears in almost every chapter, so top result should be a chapter chunk
		assert.Contains(t, results[0].ChunkID, "chapter-", "Top result should be a chapter chunk")
		assert.Greater(t, results[0].ChunkScore, 0.0, "Top score should be positive")
	})

	// --- Search: "Ghoul" should find combat chapters ---
	t.Run("Search_Ghoul", func(t *testing.T) {
		results := idx.Search("Ghoul", idx.Config)
		require.NotEmpty(t, results, "Search for 'Ghoul' should return results")
		t.Logf("  ➡ %d results for 'Ghoul'", len(results))

		for i, r := range results {
			if i >= 5 {
				break
			}
			t.Logf("    [%d] %s score=%.4f (lex=%.4f graph=%.4f entities=%d)",
				i, r.ChunkID, r.ChunkScore, r.LexScore, r.GraphScore, len(r.MatchedEntities))
		}

		// Should have entity matches (graph signal)
		hasEntityMatch := false
		for _, r := range results {
			if len(r.MatchedEntities) > 0 {
				hasEntityMatch = true
				break
			}
		}
		assert.True(t, hasEntityMatch, "At least one Ghoul result should have entity attribution")
	})

	// --- Search: "Len" should hit Ch8 (backstory) and other references ---
	t.Run("Search_Len", func(t *testing.T) {
		results := idx.Search("Len", idx.Config)
		require.NotEmpty(t, results, "Search for 'Len' should return results")
		t.Logf("  ➡ %d results for 'Len'", len(results))

		for i, r := range results {
			if i >= 5 {
				break
			}
			t.Logf("    [%d] %s score=%.4f (lex=%.4f graph=%.4f entities=%d)",
				i, r.ChunkID, r.ChunkScore, r.LexScore, r.GraphScore, len(r.MatchedEntities))
		}
	})

	// --- Search: "Bakuto casino" (location + context) ---
	t.Run("Search_Bakuto", func(t *testing.T) {
		results := idx.Search("Bakuto casino", idx.Config)
		require.NotEmpty(t, results, "Search for 'Bakuto casino' should return results")
		t.Logf("  ➡ %d results for 'Bakuto casino'", len(results))

		for i, r := range results {
			if i >= 3 {
				break
			}
			t.Logf("    [%d] %s score=%.4f", i, r.ChunkID, r.ChunkScore)
		}
	})

	// --- Search: nonsense query → should return empty ---
	t.Run("Search_Nonsense", func(t *testing.T) {
		results := idx.Search("xyzzy42plugh", idx.Config)
		assert.Empty(t, results, "Nonsense query should return no results")
	})

	// --- Write full report to .txt ---
	writeReport(t, idx, chapters)
}

// TestGLDRShortrunSearchNodes validates entity-level ranking.
func TestGLDRShortrunSearchNodes(t *testing.T) {
	text, chapters := loadShortrun(t)
	docGraph := runGraptorPipeline(t, text, chapters)
	defer docGraph.Dispose()
	idx := buildGLDR(t, docGraph, chapters)

	t.Run("SearchNodes_Ryan", func(t *testing.T) {
		nodes := idx.SearchNodes("Ryan", idx.Config)
		require.NotEmpty(t, nodes, "SearchNodes for 'Ryan' should return results")
		t.Logf("  ➡ %d nodes for 'Ryan'", len(nodes))

		for i, n := range nodes {
			if i >= 5 {
				break
			}
			t.Logf("    [%d] %s score=%.4f prox=%.4f chunks=%v",
				i, n.EntityID, n.NodeScore, n.ProximityFromQuery, n.TopChunks)
		}

		// Ryan is the *anchor*, so RankNodes surfaces entities that co-occur with Ryan.
		// We validate: results are non-empty, top score is positive, and well-known
		// co-occurring characters surface (Zanbato, Len, Ghoul, etc.).
		assert.Greater(t, nodes[0].NodeScore, 0.0, "Top node score should be positive")

		// At least one major co-occurring character should appear
		coreChars := map[string]bool{"char-zanbato": true, "char-len": true, "char-ghoul": true, "char-renesco": true}
		foundCoOccur := false
		for _, n := range nodes {
			if coreChars[n.EntityID] {
				foundCoOccur = true
				break
			}
		}
		assert.True(t, foundCoOccur, "At least one core co-occurring character should appear in Ryan's node results")
	})

	t.Run("SearchNodes_Ghoul", func(t *testing.T) {
		nodes := idx.SearchNodes("Ghoul", idx.Config)
		require.NotEmpty(t, nodes, "SearchNodes for 'Ghoul' should return results")
		t.Logf("  ➡ %d nodes for 'Ghoul'", len(nodes))

		for i, n := range nodes {
			if i >= 5 {
				break
			}
			t.Logf("    [%d] %s score=%.4f prox=%.4f",
				i, n.EntityID, n.NodeScore, n.ProximityFromQuery)
		}

		// Ghoul is the anchor → RankNodes surfaces co-occurring entities.
		// Ryan should almost always co-occur with Ghoul in combat chapters.
		assert.Greater(t, nodes[0].NodeScore, 0.0, "Top node score should be positive")

		// Ryan frequently co-occurs with Ghoul
		foundRyan := false
		for _, n := range nodes {
			if n.EntityID == "char-ryan" {
				foundRyan = true
				break
			}
		}
		assert.True(t, foundRyan, "char-ryan should appear in Ghoul's SearchNodes (frequent co-occurrence)")
	})

	t.Run("SearchNodes_Zanbato", func(t *testing.T) {
		nodes := idx.SearchNodes("Zanbato", idx.Config)
		require.NotEmpty(t, nodes, "SearchNodes for 'Zanbato' should return results")
		t.Logf("  ➡ %d nodes for 'Zanbato'", len(nodes))

		for i, n := range nodes {
			if i >= 5 {
				break
			}
			t.Logf("    [%d] %s score=%.4f prox=%.4f",
				i, n.EntityID, n.NodeScore, n.ProximityFromQuery)
		}
	})

	t.Run("SearchNodes_Meta-Gang", func(t *testing.T) {
		nodes := idx.SearchNodes("Meta-Gang", idx.Config)
		require.NotEmpty(t, nodes, "SearchNodes for 'Meta-Gang' should return results")
		t.Logf("  ➡ %d nodes for 'Meta-Gang'", len(nodes))

		for i, n := range nodes {
			if i >= 5 {
				break
			}
			t.Logf("    [%d] %s score=%.4f prox=%.4f",
				i, n.EntityID, n.NodeScore, n.ProximityFromQuery)
		}
	})
}

// TestGLDRShortrunStats validates the index statistics after full ingestion.
func TestGLDRShortrunStats(t *testing.T) {
	text, chapters := loadShortrun(t)
	docGraph := runGraptorPipeline(t, text, chapters)
	defer docGraph.Dispose()
	idx := buildGLDR(t, docGraph, chapters)

	t.Logf("📊 Index Statistics:")
	t.Logf("  Chunks indexed:    %d", idx.Len())
	t.Logf("  Unique entities:   %d", idx.GetEntityCount())
	t.Logf("  Graph edges:       %d", idx.GetEdgeCount())

	// Chunk count should exactly match chapter count
	assert.Equal(t, len(chapters), idx.Len(), "Chunk count == chapter count")

	// Entity count should be at least the seed count minus entities not found
	assert.GreaterOrEqual(t, idx.GetEntityCount(), 8,
		"At least 8 entities should be represented in the chunks")

	// Graph should have edges (co-occurrences loaded with minCount=2)
	assert.Greater(t, idx.GetEdgeCount(), 0,
		"Graph should have edges after loading co-occurrences")

	// ForEachChunk should iterate all chunks
	chunkCount := 0
	idx.ForEachChunk(func(chunkID uint32, mentions []gldr.EntityMention) bool {
		chunkCount++
		return true
	})
	assert.Equal(t, len(chapters), chunkCount, "ForEachChunk should iterate exactly chapter-count chunks")
}

// ---------------------------------------------------------------------------
// Report writer (outputs to .txt per TDD protocol)
// ---------------------------------------------------------------------------

func writeReport(t *testing.T, idx *gldr.GLDRIndex, chapters []chapterInput) {
	t.Helper()

	var out strings.Builder
	out.WriteString("GLDR SHORTRUN INTEGRATION TEST RESULTS\n")
	out.WriteString(strings.Repeat("=", 80) + "\n\n")

	// Index stats
	out.WriteString("INDEX STATISTICS:\n")
	out.WriteString(fmt.Sprintf("  Chunks:          %d\n", idx.Len()))
	out.WriteString(fmt.Sprintf("  Unique Entities: %d\n", idx.GetEntityCount()))
	out.WriteString(fmt.Sprintf("  Graph Edges:     %d\n", idx.GetEdgeCount()))
	out.WriteString(fmt.Sprintf("  Graph Vertices:  %d\n", idx.GetVertexCount()))
	out.WriteString("\n")

	// Per-chunk entity summary
	out.WriteString("CHUNK → ENTITY MAPPING:\n")
	out.WriteString(strings.Repeat("-", 40) + "\n")
	idx.ForEachChunk(func(chunkID uint32, mentions []gldr.EntityMention) bool {
		chunkName := idx.QGram.Mapper.GetString(chunkID)
		out.WriteString(fmt.Sprintf("  %s: %d mentions\n", chunkName, len(mentions)))

		// Deduplicate entity IDs for display
		seen := map[string]int{}
		for _, m := range mentions {
			seen[m.EntityID]++
		}
		for eid, count := range seen {
			out.WriteString(fmt.Sprintf("    - %s ×%d\n", eid, count))
		}
		return true
	})
	out.WriteString("\n")

	// Search results for key queries
	queries := []string{"Ryan", "Ghoul", "Len", "Bakuto casino", "Sarin", "Meta-Gang", "Plymouth Fury", "Bloodstream"}
	for _, q := range queries {
		out.WriteString(fmt.Sprintf("SEARCH: %q\n", q))
		out.WriteString(strings.Repeat("-", 40) + "\n")

		results := idx.Search(q, idx.Config)
		if len(results) == 0 {
			out.WriteString("  (no results)\n\n")
			continue
		}

		for i, r := range results {
			if i >= 10 {
				out.WriteString(fmt.Sprintf("  ... and %d more\n", len(results)-10))
				break
			}
			entities := make([]string, len(r.MatchedEntities))
			for j, e := range r.MatchedEntities {
				entities[j] = fmt.Sprintf("%s(%.2f)", e.EntityID, e.Proximity)
			}
			out.WriteString(fmt.Sprintf("  [%d] %s  score=%.4f lex=%.4f graph=%.4f  entities=[%s]\n",
				i, r.ChunkID, r.ChunkScore, r.LexScore, r.GraphScore, strings.Join(entities, ", ")))
		}

		// Also show node-level results
		nodes := idx.SearchNodes(q, idx.Config)
		if len(nodes) > 0 {
			out.WriteString("  NODES:\n")
			for i, n := range nodes {
				if i >= 5 {
					break
				}
				out.WriteString(fmt.Sprintf("    [%d] %s  score=%.4f prox=%.4f chunks=%v\n",
					i, n.EntityID, n.NodeScore, n.ProximityFromQuery, n.TopChunks))
			}
		}
		out.WriteString("\n")
	}

	// Write to file
	outputPath := "../../../docs/gldr-shortrun-results.txt"
	err := os.WriteFile(outputPath, []byte(out.String()), 0644)
	if err != nil {
		t.Logf("⚠ Could not write report file: %v", err)
	} else {
		t.Logf("📝 Report written to %s", outputPath)
	}

	// Also log to test output
	t.Log("\n" + out.String())
}
