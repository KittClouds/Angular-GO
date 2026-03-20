package graptor

import (
	"os"
	"testing"

	"github.com/kittclouds/gokitt/internal/store"
	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
)

func TestFullSystemSession_ShortrunDefaultChunkerX2(t *testing.T) {
	text := loadShortrunForFullSystemTest(t)

	manager := NewFullSystemManager(nil)
	sessionID, err := manager.CreateSession(nil)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	defer func() { _ = manager.CloseSession(sessionID) }()

	result, err := manager.IngestDocuments(sessionID, IngestRequest{
		Documents: []IngestDocumentInput{{
			DocumentID: "shortrun",
			Title:      "shortrun",
			Text:       text,
		}},
		SeedEntities: fullSystemTestSeeds(),
	})
	if err != nil {
		t.Fatalf("ingest shortrun: %v", err)
	}

	if result.ChunkStats.Strategy != ChunkingStrategyChunkerX2 {
		t.Fatalf("expected %q strategy, got %q", ChunkingStrategyChunkerX2, result.ChunkStats.Strategy)
	}
	if result.ChunkStats.TotalLeaves <= 10 {
		t.Fatalf("expected full-system chunker to produce more than 10 leaves, got %d", result.ChunkStats.TotalLeaves)
	}
	if len(result.Documents) != 1 {
		t.Fatalf("expected 1 document result, got %d", len(result.Documents))
	}
	if !result.Documents[0].HasFrontMatterChapter {
		t.Fatalf("expected front matter to be retained as chapter 0")
	}
	if result.DocumentGraph.TotalEntities == 0 {
		t.Fatalf("expected graph entity stats to be populated")
	}
	if result.DocumentGraph.TotalEdges == 0 {
		t.Fatalf("expected graph edge stats to be populated")
	}
	if result.DiscoverySummary.CandidateCount == 0 {
		t.Fatalf("expected discovery stats to be populated")
	}
	if result.RetrievalSummary.QGramDocuments == 0 {
		t.Fatalf("expected qgram stats to be populated")
	}
	if result.RetrievalSummary.GLDRChunks == 0 {
		t.Fatalf("expected gldr chunk stats to be populated")
	}
	if result.RetrievalSummary.GLDREdges == 0 {
		t.Fatalf("expected gldr edge stats to be populated")
	}
}

func TestFullSystemSession_ParityAgainstLegacyChunking(t *testing.T) {
	text := loadShortrunForFullSystemTest(t)

	manager := NewFullSystemManager(nil)

	defaultSessionID, err := manager.CreateSession(nil)
	if err != nil {
		t.Fatalf("create default session: %v", err)
	}
	defer func() { _ = manager.CloseSession(defaultSessionID) }()

	defaultResult, err := manager.IngestDocuments(defaultSessionID, IngestRequest{
		Documents: []IngestDocumentInput{{
			DocumentID: "shortrun-default",
			Title:      "shortrun",
			Text:       text,
		}},
		SeedEntities: fullSystemTestSeeds(),
	})
	if err != nil {
		t.Fatalf("ingest default session: %v", err)
	}

	legacyConfig := &FullSystemConfig{
		Chunking: FullSystemChunkingConfig{
			Strategy: ChunkingStrategyChapterParagraphLegacy,
		},
	}
	legacySessionID, err := manager.CreateSession(legacyConfig)
	if err != nil {
		t.Fatalf("create legacy session: %v", err)
	}
	defer func() { _ = manager.CloseSession(legacySessionID) }()

	legacyResult, err := manager.IngestDocuments(legacySessionID, IngestRequest{
		Documents: []IngestDocumentInput{{
			DocumentID: "shortrun-legacy",
			Title:      "shortrun",
			Text:       text,
		}},
		SeedEntities: fullSystemTestSeeds(),
	})
	if err != nil {
		t.Fatalf("ingest legacy session: %v", err)
	}

	if legacyResult.ChunkStats.Strategy != ChunkingStrategyChapterParagraphLegacy {
		t.Fatalf("expected legacy strategy %q, got %q", ChunkingStrategyChapterParagraphLegacy, legacyResult.ChunkStats.Strategy)
	}
	if defaultResult.ChunkStats.TotalLeaves <= legacyResult.ChunkStats.TotalLeaves {
		t.Fatalf("expected chunker_x2 leaves (%d) to exceed legacy leaves (%d)", defaultResult.ChunkStats.TotalLeaves, legacyResult.ChunkStats.TotalLeaves)
	}
	if legacyResult.ChunkStats.TotalLeaves != 10 {
		t.Fatalf("expected legacy shortrun path to yield 10 leaves, got %d", legacyResult.ChunkStats.TotalLeaves)
	}
}

func TestFullSystemSession_CommitAndHydrateScope(t *testing.T) {
	sqlStore, err := store.NewSQLiteStore()
	if err != nil {
		t.Fatalf("new sqlite store: %v", err)
	}

	manager := NewFullSystemManager(sqlStore)
	scope := &FullSystemScope{
		WorldID:     "world-test",
		NarrativeID: "narr-test",
		FolderID:    "scope-test",
		FolderPath:  "/scope-test",
	}

	sessionID, err := manager.CreateSession(nil)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	defer func() { _ = manager.CloseSession(sessionID) }()

	docText := `# Prelude
This is the table of contents for the operation in New Rome.

## Chapter 1: Arrival
Ryan stepped into New Rome. Len watched Ryan closely.
The Meta-Gang watched them both.

## Chapter 2: The Deal
Ryan met Len again in New Rome.
Meta-Gang scouts followed Ryan through the market.`

	_, err = manager.IngestDocuments(sessionID, IngestRequest{
		Documents: []IngestDocumentInput{{
			DocumentID: "mini-story",
			Title:      "mini-story",
			Text:       docText,
			Scope:      scope,
		}},
		SeedEntities: []SeedEntity{
			{ID: "char-ryan", Label: "Ryan", Kind: implicitmatcher.KindCharacter},
			{ID: "char-len", Label: "Len", Kind: implicitmatcher.KindCharacter},
			{ID: "loc-new-rome", Label: "New Rome", Kind: implicitmatcher.KindPlace},
			{ID: "org-meta-gang", Label: "Meta-Gang", Aliases: []string{"Meta"}, Kind: implicitmatcher.KindFaction},
		},
	})
	if err != nil {
		t.Fatalf("ingest mini story: %v", err)
	}

	commitResult, err := manager.Commit(sessionID, CommitRequest{})
	if err != nil {
		t.Fatalf("commit session: %v", err)
	}
	if commitResult.Notes != 1 {
		t.Fatalf("expected 1 note committed, got %d", commitResult.Notes)
	}
	if commitResult.Entities == 0 {
		t.Fatalf("expected committed entities")
	}
	if commitResult.Spans == 0 || commitResult.Mentions == 0 {
		t.Fatalf("expected committed spans and mentions, got spans=%d mentions=%d", commitResult.Spans, commitResult.Mentions)
	}
	if commitResult.Edges == 0 {
		t.Fatalf("expected committed edges")
	}
	if commitResult.ScopedManifestsWritten < 2 {
		t.Fatalf("expected at least 2 scoped manifests, got %d", commitResult.ScopedManifestsWritten)
	}

	entities, err := sqlStore.ListEntities("")
	if err != nil {
		t.Fatalf("list committed entities: %v", err)
	}
	if len(entities) == 0 {
		t.Fatalf("expected committed entities to be readable from store")
	}
	foundScopedEntity := false
	for _, entity := range entities {
		if entity.NarrativeID == scope.NarrativeID {
			foundScopedEntity = true
			break
		}
	}
	if !foundScopedEntity {
		t.Fatalf("expected committed entities to preserve narrative scope %q", scope.NarrativeID)
	}

	repeatCommit, err := manager.Commit(sessionID, CommitRequest{})
	if err != nil {
		t.Fatalf("repeat commit: %v", err)
	}
	if !repeatCommit.AlreadyCommitted {
		t.Fatalf("expected second commit to report already committed")
	}

	hydratedSessionID, err := manager.CreateSession(nil)
	if err != nil {
		t.Fatalf("create hydrated session: %v", err)
	}
	defer func() { _ = manager.CloseSession(hydratedSessionID) }()

	if err := manager.LoadCommittedScope(hydratedSessionID, *scope); err != nil {
		t.Fatalf("hydrate committed scope: %v", err)
	}

	searchResult, err := manager.Search(hydratedSessionID, SearchRequest{
		Query: "Ryan",
		Limit: 5,
	})
	if err != nil {
		t.Fatalf("search hydrated session: %v", err)
	}
	if len(searchResult.QGram) == 0 && len(searchResult.GLDRChunks) == 0 {
		t.Fatalf("expected hydrated session search results")
	}

	stats, err := manager.GetStats(hydratedSessionID)
	if err != nil {
		t.Fatalf("get hydrated stats: %v", err)
	}
	if stats.RetrievalSummary.QGramDocuments == 0 {
		t.Fatalf("expected hydrated qgram documents")
	}
	if stats.RetrievalSummary.GLDRChunks == 0 {
		t.Fatalf("expected hydrated gldr chunks")
	}
}

func loadShortrunForFullSystemTest(t *testing.T) string {
	t.Helper()

	content, err := os.ReadFile("../../../docs/shortrun.md")
	if err != nil {
		t.Skipf("skipping shortrun-dependent test: %v", err)
	}
	return string(content)
}

func fullSystemTestSeeds() []SeedEntity {
	return []SeedEntity{
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
}
