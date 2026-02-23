package graptor

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"

	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
)

// TestIntegrationShortrun processes docs/shortrun.md through the full Graptor pipeline.
// This test validates the production loop before adding backend persistence.
func TestIntegrationShortrun(t *testing.T) {
	// Read the document
	docPath := "../../../docs/shortrun.md"
	content, err := os.ReadFile(docPath)
	if err != nil {
		t.Skipf("Skipping integration test: could not read %s: %v", docPath, err)
	}

	text := string(content)
	t.Logf("Document loaded: %d characters", len(text))

	// Parse chapters
	chapters := parseChapters(text)
	t.Logf("Parsed %d chapters", len(chapters))

	if len(chapters) == 0 {
		t.Fatal("No chapters found in document")
	}

	// Create conductor with default config
	config := DefaultConductorConfig()
	config.MaxHistory = 200 // Larger history for long document
	config.CarryOverSize = 20

	conductor, err := NewGraptorConductor(config)
	if err != nil {
		t.Fatalf("Failed to create GraptorConductor: %v", err)
	}

	// Seed known entities from the story to bootstrap discovery
	seedEntities := []implicitmatcher.RegisteredEntity{
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
		{ID: "loc-new-rome", Label: "New Rome", Kind: implicitmatcher.KindPlace},
		{ID: "loc-rust-town", Label: "Rust Town", Kind: implicitmatcher.KindPlace},
		{ID: "loc-bakuto", Label: "Bakuto", Kind: implicitmatcher.KindPlace},
		{ID: "loc-dynamis", Label: "Dynamis", Kind: implicitmatcher.KindPlace},
		{ID: "org-augusti", Label: "Augusti", Kind: implicitmatcher.KindFaction},
		{ID: "org-meta-gang", Label: "Meta-Gang", Aliases: []string{"Meta"}, Kind: implicitmatcher.KindFaction},
		{ID: "org-migliore", Label: "Il Migliore", Kind: implicitmatcher.KindOrganization},
	}

	// Compile and set dictionary
	dict, err := implicitmatcher.Compile(seedEntities)
	if err != nil {
		t.Fatalf("Failed to compile seed entities: %v", err)
	}
	conductor.SetDictionary(dict)

	// Seed the registry with known entities for cross-chapter tracking
	conductor.SeedRegistry(seedEntities)

	// Also seed the discovery engine
	conductor.SeedDiscovery(seedEntities)

	// Process document
	docGraph, err := conductor.IngestDocument("shortrun-test", text, chapters)
	if err != nil {
		t.Fatalf("Failed to ingest document: %v", err)
	}

	// Output results
	t.Log("\n" + strings.Repeat("=", 80))
	t.Log("GRAPTOR INTEGRATION TEST RESULTS")
	t.Log(strings.Repeat("=", 80))

	// Document stats
	t.Logf("\n📊 DOCUMENT STATISTICS:")
	t.Logf("  Total Chapters:      %d", docGraph.Stats.TotalChapters)
	t.Logf("  Total Leaves:        %d", docGraph.Stats.TotalLeaves)
	t.Logf("  Total Entities:      %d", docGraph.Stats.TotalEntities)
	t.Logf("  Total Mentions:      %d", docGraph.Stats.TotalMentions)
	t.Logf("  Total Edges:         %d", docGraph.Stats.TotalEdges)
	t.Logf("  Cross-Chapter Links: %d", docGraph.Stats.CrossChapterLinks)
	t.Logf("  Processing Time:     %dms", docGraph.Stats.ProcessingTime)

	// Entity breakdown by kind
	registry := docGraph.Registry
	stats := registry.Stats()
	t.Logf("\n📈 REGISTRY STATISTICS:")
	t.Logf("  Total Entities: %d", stats.TotalEntities)
	t.Logf("  Total Aliases:  %d", stats.TotalAliases)
	t.Logf("  Total Chapters: %d", stats.TotalChapters)
	t.Logf("  Total Mentions: %d", stats.TotalMentions)
	t.Logf("  Co-occurrences: %d", stats.TotalCooccur)

	// List all entities
	t.Logf("\n👤 ALL ENTITIES:")
	entities := registry.GetAllEntities()
	for _, entity := range entities {
		chapters := registry.GetEntityChapters(entity.ID)
		mentions := registry.GetMentions(entity.ID)
		// Safe ID slicing
		idDisplay := entity.ID
		if len(idDisplay) > 12 {
			idDisplay = idDisplay[:12]
		}
		t.Logf("  [%s] %s (kind=%s, gender=%s, chapters=%v, mentions=%d)",
			idDisplay, entity.CanonicalName, entity.Kind, entity.Gender, chapters, len(mentions))
	}

	// Cross-chapter edges
	t.Logf("\n🔗 CROSS-CHAPTER EDGES:")
	if len(docGraph.CrossChapterEdges) == 0 {
		t.Log("  (none)")
	} else {
		for i, edge := range docGraph.CrossChapterEdges {
			if i >= 20 {
				t.Logf("  ... and %d more edges", len(docGraph.CrossChapterEdges)-20)
				break
			}
			// Safe ID slicing
			sourceDisplay := edge.SourceID
			if len(sourceDisplay) > 12 {
				sourceDisplay = sourceDisplay[:12]
			}
			targetDisplay := edge.TargetID
			if len(targetDisplay) > 12 {
				targetDisplay = targetDisplay[:12]
			}
			t.Logf("  [%s] --[%s]--> [%s] (ch%d→ch%d, conf=%.2f)",
				sourceDisplay, edge.RelationType, targetDisplay,
				edge.SourceChapter, edge.TargetChapter, edge.Confidence)
		}
	}

	// Per-chapter summary
	t.Logf("\n📖 CHAPTER SUMMARY:")
	for chapterID, cg := range docGraph.Chapters {
		entities := registry.GetChapterEntities(chapterID)
		t.Logf("  Chapter %d: %d leaves, %d entities, %d edges",
			chapterID, cg.LeafCount, len(entities), cg.EdgeCount)
	}

	// Validate basic expectations
	if docGraph.Stats.TotalEntities < 5 {
		t.Errorf("Expected at least 5 entities, got %d", docGraph.Stats.TotalEntities)
	}
	if docGraph.Stats.TotalChapters < 3 {
		t.Errorf("Expected at least 3 chapters, got %d", docGraph.Stats.TotalChapters)
	}

	t.Log("\n" + strings.Repeat("=", 80))
	t.Log("✅ Integration test completed successfully")
	t.Log(strings.Repeat("=", 80))
}

// TestIntegrationShortrunDetailed outputs detailed analysis for manual review.
func TestIntegrationShortrunDetailed(t *testing.T) {
	// Read the document
	docPath := "../../../docs/shortrun.md"
	content, err := os.ReadFile(docPath)
	if err != nil {
		t.Skipf("Skipping integration test: could not read %s: %v", docPath, err)
	}

	text := string(content)
	chapters := parseChapters(text)

	config := DefaultConductorConfig()
	conductor, err := NewGraptorConductor(config)
	if err != nil {
		t.Fatalf("Failed to create GraptorConductor: %v", err)
	}

	// Seed entities
	seedEntities := []implicitmatcher.RegisteredEntity{
		{ID: "char-ryan", Label: "Ryan", Aliases: []string{"Quicksave", "Riri"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-len", Label: "Len", Aliases: []string{"Underdiver"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-wyvern", Label: "Wyvern", Kind: implicitmatcher.KindCharacter},
		{ID: "char-ghoul", Label: "Ghoul", Kind: implicitmatcher.KindCharacter},
		{ID: "char-zanbato", Label: "Zanbato", Aliases: []string{"Jamie", "Zan"}, Kind: implicitmatcher.KindCharacter},
		{ID: "loc-new-rome", Label: "New Rome", Kind: implicitmatcher.KindPlace},
		{ID: "org-augusti", Label: "Augusti", Kind: implicitmatcher.KindFaction},
		{ID: "org-meta-gang", Label: "Meta-Gang", Aliases: []string{"Meta"}, Kind: implicitmatcher.KindFaction},
	}
	dict, _ := implicitmatcher.Compile(seedEntities)
	conductor.SetDictionary(dict)
	conductor.SeedRegistry(seedEntities)
	conductor.SeedDiscovery(seedEntities)

	docGraph, err := conductor.IngestDocument("shortrun-detailed", text, chapters)
	if err != nil {
		t.Fatalf("Failed to ingest document: %v", err)
	}

	// Write detailed output to file for manual review
	var output strings.Builder
	output.WriteString("GRAPTOR DETAILED ANALYSIS\n")
	output.WriteString(strings.Repeat("=", 80) + "\n\n")

	// Entity details
	output.WriteString("ENTITIES BY CHAPTER:\n")
	output.WriteString(strings.Repeat("-", 40) + "\n")
	for chapterID := range docGraph.Chapters {
		entities := docGraph.Registry.GetChapterEntities(chapterID)
		output.WriteString(fmt.Sprintf("\nChapter %d (%d entities):\n", chapterID, len(entities)))
		for _, entity := range entities {
			output.WriteString(fmt.Sprintf("  - %s [%s] (gender: %s)\n",
				entity.CanonicalName, entity.Kind, entity.Gender))
		}
	}

	// All entities with details
	output.WriteString("\n\nALL ENTITIES:\n")
	output.WriteString(strings.Repeat("-", 40) + "\n")
	entities := docGraph.Registry.GetAllEntities()
	for _, entity := range entities {
		chapters := docGraph.Registry.GetEntityChapters(entity.ID)
		mentions := docGraph.Registry.GetMentions(entity.ID)
		output.WriteString(fmt.Sprintf("ID: %s\n", entity.ID))
		output.WriteString(fmt.Sprintf("  Name: %s\n", entity.CanonicalName))
		output.WriteString(fmt.Sprintf("  Kind: %s, Gender: %s\n", entity.Kind, entity.Gender))
		output.WriteString(fmt.Sprintf("  Chapters: %v\n", chapters))
		output.WriteString(fmt.Sprintf("  Mentions: %d\n", len(mentions)))
		if len(entity.Aliases) > 0 {
			output.WriteString(fmt.Sprintf("  Aliases: %v\n", entity.Aliases))
		}
		output.WriteString("\n")
	}

	// Cross-chapter edges
	output.WriteString("\nCROSS-CHAPTER EDGES:\n")
	output.WriteString(strings.Repeat("-", 40) + "\n")
	for _, edge := range docGraph.CrossChapterEdges {
		// Safe ID slicing
		sourceDisplay := edge.SourceID
		if len(sourceDisplay) > 12 {
			sourceDisplay = sourceDisplay[:12]
		}
		targetDisplay := edge.TargetID
		if len(targetDisplay) > 12 {
			targetDisplay = targetDisplay[:12]
		}
		output.WriteString(fmt.Sprintf("  [%s] --[%s]--> [%s] (ch%d→ch%d, conf=%.2f)\n",
			sourceDisplay, edge.RelationType, targetDisplay,
			edge.SourceChapter, edge.TargetChapter, edge.Confidence))
		if edge.Evidence != "" {
			output.WriteString(fmt.Sprintf("    Evidence: %s\n", edge.Evidence))
		}
	}

	// Write to file
	outputPath := "../../../docs/graptor-analysis.txt"
	err = os.WriteFile(outputPath, []byte(output.String()), 0644)
	if err != nil {
		t.Logf("Could not write analysis file: %v", err)
	} else {
		t.Logf("Detailed analysis written to %s", outputPath)
	}

	// Also print key findings
	t.Log("\n" + output.String())
}

// TestIntegrationShortrunEntityTracking tests that entities are tracked across chapters.
func TestIntegrationShortrunEntityTracking(t *testing.T) {
	// Read the document
	docPath := "../../../docs/shortrun.md"
	content, err := os.ReadFile(docPath)
	if err != nil {
		t.Skipf("Skipping integration test: could not read %s: %v", docPath, err)
	}

	text := string(content)
	chapters := parseChapters(text)

	config := DefaultConductorConfig()
	conductor, err := NewGraptorConductor(config)
	if err != nil {
		t.Fatalf("Failed to create GraptorConductor: %v", err)
	}

	// Seed entities
	seedEntities := []implicitmatcher.RegisteredEntity{
		{ID: "char-ryan", Label: "Ryan", Aliases: []string{"Quicksave", "Riri"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-len", Label: "Len", Aliases: []string{"Underdiver"}, Kind: implicitmatcher.KindCharacter},
		{ID: "char-wyvern", Label: "Wyvern", Kind: implicitmatcher.KindCharacter},
		{ID: "char-ghoul", Label: "Ghoul", Kind: implicitmatcher.KindCharacter},
		{ID: "char-zanbato", Label: "Zanbato", Aliases: []string{"Jamie", "Zan"}, Kind: implicitmatcher.KindCharacter},
		{ID: "loc-new-rome", Label: "New Rome", Kind: implicitmatcher.KindPlace},
		{ID: "org-augusti", Label: "Augusti", Kind: implicitmatcher.KindFaction},
		{ID: "org-meta-gang", Label: "Meta-Gang", Aliases: []string{"Meta"}, Kind: implicitmatcher.KindFaction},
	}
	dict, _ := implicitmatcher.Compile(seedEntities)
	conductor.SetDictionary(dict)
	conductor.SeedRegistry(seedEntities)
	conductor.SeedDiscovery(seedEntities)

	docGraph, err := conductor.IngestDocument("shortrun-tracking", text, chapters)
	if err != nil {
		t.Fatalf("Failed to ingest document: %v", err)
	}

	// Find entities that appear in multiple chapters
	registry := docGraph.Registry
	entities := registry.GetAllEntities()

	t.Log("\n📊 MULTI-CHAPTER ENTITIES:")
	multiChapterCount := 0
	for _, entity := range entities {
		chapters := registry.GetEntityChapters(entity.ID)
		if len(chapters) > 1 {
			multiChapterCount++
			t.Logf("  %s: appears in %d chapters %v", entity.CanonicalName, len(chapters), chapters)
		}
	}

	if multiChapterCount == 0 {
		t.Log("  (no entities appear in multiple chapters)")
	} else {
		t.Logf("\n  Total multi-chapter entities: %d", multiChapterCount)
	}

	// Check for expected entities from the story
	expectedEntities := []string{"Ryan", "Len", "Wyvern", "Ghoul", "Zanbato"}
	t.Log("\n🔍 EXPECTED ENTITY CHECK:")
	for _, name := range expectedEntities {
		entity := registry.Lookup(name)
		if entity != nil {
			chapters := registry.GetEntityChapters(entity.ID)
			// Safe ID slicing
			idDisplay := entity.ID
			if len(idDisplay) > 12 {
				idDisplay = idDisplay[:12]
			}
			t.Logf("  ✓ '%s' found (ID: %s, chapters: %v)", name, idDisplay, chapters)
		} else {
			t.Logf("  ✗ '%s' NOT FOUND", name)
		}
	}
}

// parseChapters parses the document into chapters based on markdown headers.
func parseChapters(text string) []ChapterInput {
	var chapters []ChapterInput

	// Match chapter headers like "## Chapter 1:" or "## Chapter 1"
	chapterRegex := regexp.MustCompile(`(?i)^##\s*Chapter\s*(\d+)[:.]?\s*(.*)$`)

	lines := strings.Split(text, "\n")
	var currentChapterID uint32
	var currentChapterText strings.Builder
	var foundFirstChapter bool

	for _, line := range lines {
		matches := chapterRegex.FindStringSubmatch(line)
		if matches != nil {
			// Save previous chapter
			if foundFirstChapter && currentChapterText.Len() > 0 {
				chapters = append(chapters, ChapterInput{
					ChapterID: currentChapterID,
					Text:      strings.TrimSpace(currentChapterText.String()),
				})
			}

			// Parse chapter number
			fmt.Sscanf(matches[1], "%d", &currentChapterID)
			currentChapterText.Reset()
			foundFirstChapter = true
			continue
		}

		if foundFirstChapter {
			currentChapterText.WriteString(line)
			currentChapterText.WriteString("\n")
		}
	}

	// Save last chapter
	if foundFirstChapter && currentChapterText.Len() > 0 {
		chapters = append(chapters, ChapterInput{
			ChapterID: currentChapterID,
			Text:      strings.TrimSpace(currentChapterText.String()),
		})
	}

	return chapters
}
