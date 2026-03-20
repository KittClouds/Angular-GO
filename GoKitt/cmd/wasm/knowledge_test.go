//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"testing"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/graptor"
	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/knowledge"
)

type knowledgeGraphDump struct {
	Nodes map[string]knowledge.KnowledgeNode `json:"nodes"`
	Edges []knowledge.KnowledgeEdge          `json:"edges"`
}

func TestKnowledgeSync_DumpsNodesAndEdgesWithStringIDs(t *testing.T) {
	setupKnowledgeBridgeTest(t)

	if err := sqlStore.UpsertEntity(&store.Entity{
		ID:          "char-ryan",
		Label:       "Ryan",
		Kind:        "CHARACTER",
		NarrativeID: "narr-1",
		Aliases:     []string{"Riri"},
		CreatedBy:   "test",
		CreatedAt:   1,
		UpdatedAt:   1,
	}); err != nil {
		t.Fatalf("upsert Ryan: %v", err)
	}
	if err := sqlStore.UpsertEntity(&store.Entity{
		ID:          "char-len",
		Label:       "Len",
		Kind:        "CHARACTER",
		NarrativeID: "narr-1",
		CreatedBy:   "test",
		CreatedAt:   1,
		UpdatedAt:   1,
	}); err != nil {
		t.Fatalf("upsert Len: %v", err)
	}
	if err := sqlStore.UpsertEdge(&store.Edge{
		ID:         "edge-ryan-len",
		SourceID:   "char-ryan",
		TargetID:   "char-len",
		RelType:    "KNOWS",
		Confidence: 0.8,
		SourceNote: "note-1",
		CreatedAt:  1,
	}); err != nil {
		t.Fatalf("upsert edge: %v", err)
	}

	assertSuccessResult(t, knowledgeSync(js.Null(), nil))
	dump := decodeKnowledgeGraphDump(t, knowledgeGetGraph(js.Null(), nil))

	if len(dump.Nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(dump.Nodes))
	}
	if len(dump.Edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(dump.Edges))
	}
	if dump.Nodes["char-ryan"].Label != "Ryan" {
		t.Fatalf("expected string-keyed Ryan node in dump")
	}
	edge := dump.Edges[0]
	if edge.SourceID != "char-ryan" || edge.TargetID != "char-len" {
		t.Fatalf("expected string IDs in graph dump, got %s -> %s", edge.SourceID, edge.TargetID)
	}
	if edge.Relation != "KNOWS" {
		t.Fatalf("expected KNOWS relation, got %s", edge.Relation)
	}
	if edge.Weight != 0.8 {
		t.Fatalf("expected confidence weight 0.8, got %v", edge.Weight)
	}
}

func TestKnowledgeSync_AfterFullSystemRunOnce(t *testing.T) {
	setupKnowledgeBridgeTest(t)

	manager := graptor.NewFullSystemManager(sqlStore)
	docText := `# Prelude
New Rome hummed before the first chapter.

## Chapter 1: Arrival
Ryan stepped into New Rome. Len watched Ryan closely.

## Chapter 2: Deal
Meta-Gang scouts followed Ryan and Len through New Rome.`

	result, err := manager.RunOnce(graptor.RunOnceRequest{
		Ingest: graptor.IngestRequest{
			Documents: []graptor.IngestDocumentInput{{
				DocumentID: "story-1",
				NoteID:     "story-1",
				Title:      "Story 1",
				Text:       docText,
				Scope: &graptor.FullSystemScope{
					WorldID:     "world-1",
					NarrativeID: "narr-1",
					FolderID:    "folder-1",
					FolderPath:  "Narrative / Act 1",
				},
			}},
			SeedEntities: []graptor.SeedEntity{
				{ID: "char-ryan", Label: "Ryan", Kind: implicitmatcher.KindCharacter},
				{ID: "char-len", Label: "Len", Kind: implicitmatcher.KindCharacter},
				{ID: "loc-new-rome", Label: "New Rome", Kind: implicitmatcher.KindPlace},
				{ID: "org-meta-gang", Label: "Meta-Gang", Kind: implicitmatcher.KindFaction},
			},
		},
		Commit: &graptor.CommitRequest{},
	})
	if err != nil {
		t.Fatalf("run full system once: %v", err)
	}
	if result.Ingest == nil || result.Ingest.ChunkStats.Strategy != graptor.ChunkingStrategyChunkerX2 {
		t.Fatalf("expected chunker_x2 ingest strategy, got %#v", result.Ingest)
	}
	if result.Commit == nil || result.Commit.Entities == 0 || result.Commit.Edges == 0 {
		t.Fatalf("expected committed entities and edges, got %#v", result.Commit)
	}

	assertSuccessResult(t, knowledgeSync(js.Null(), nil))
	dump := decodeKnowledgeGraphDump(t, knowledgeGetGraph(js.Null(), nil))

	if len(dump.Nodes) == 0 {
		t.Fatalf("expected synced graph nodes after full-system run")
	}
	if len(dump.Edges) == 0 {
		t.Fatalf("expected synced graph edges after full-system run")
	}
	if _, ok := dump.Nodes["char-ryan"]; !ok {
		t.Fatalf("expected Ryan node in synced graph dump")
	}
}

func setupKnowledgeBridgeTest(t *testing.T) {
	t.Helper()

	var err error
	sqlStore, err = store.NewSQLiteStore()
	if err != nil {
		t.Fatalf("new sqlite store: %v", err)
	}
	knowledgeGraph = nil
	assertSuccessResult(t, knowledgeInit(js.Null(), nil))
}

func assertSuccessResult(t *testing.T, result interface{}) {
	t.Helper()

	raw, ok := result.(string)
	if !ok {
		t.Fatalf("expected string result, got %T", result)
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if errValue, ok := payload["error"].(string); ok && errValue != "" {
		t.Fatalf("unexpected error result: %s", errValue)
	}
	success, ok := payload["success"].(bool)
	if !ok || !success {
		t.Fatalf("expected success result, got %#v", payload)
	}
}

func decodeKnowledgeGraphDump(t *testing.T, result interface{}) knowledgeGraphDump {
	t.Helper()

	raw, ok := result.(string)
	if !ok {
		t.Fatalf("expected string graph dump, got %T", result)
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err == nil {
		if errValue, ok := payload["error"].(string); ok && errValue != "" {
			t.Fatalf("unexpected graph error result: %s", errValue)
		}
	}

	var dump knowledgeGraphDump
	if err := json.Unmarshal([]byte(raw), &dump); err != nil {
		t.Fatalf("unmarshal graph dump: %v", err)
	}
	return dump
}
