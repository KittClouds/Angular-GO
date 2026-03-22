//go:build js && wasm

package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/graptor"
)

func wireChatSearchers() {
	if chatSvc == nil {
		return
	}

	chatSvc.SetBlockSearcher(func(ctx context.Context, _ *store.ChatRun, query string, limit int) ([]store.EvidenceItem, error) {
		return searchGLDR(ctx, query, limit)
	})
	chatSvc.SetGraptorSearcher(searchCommittedScopeGraptor)
}

func searchGLDR(_ context.Context, query string, limit int) ([]store.EvidenceItem, error) {
	if gldrIndex == nil || strings.TrimSpace(query) == "" {
		return nil, nil
	}

	cfg := gldrIndex.Config
	if limit > 0 {
		cfg.TopChunks = limit
	}

	results := gldrIndex.Search(query, cfg)
	items := make([]store.EvidenceItem, 0, len(results))
	for _, result := range results {
		items = append(items, store.EvidenceItem{
			ID:      result.ChunkID,
			Source:  "search_blocks_gdr",
			Title:   result.ChunkID,
			Content: fmt.Sprintf("Chunk %s scored %.3f (lex %.3f, graph %.3f, semantic %.3f)", result.ChunkID, result.ChunkScore, result.LexScore, result.GraphScore, result.SemanticScore),
			Score:   result.ChunkScore,
			Metadata: map[string]interface{}{
				"chunkId":       result.ChunkID,
				"chunkScore":    result.ChunkScore,
				"lexScore":      result.LexScore,
				"graphScore":    result.GraphScore,
				"semanticScore": result.SemanticScore,
			},
		})
	}
	return items, nil
}

func searchCommittedScopeGraptor(_ context.Context, run *store.ChatRun, query string, limit int) ([]store.EvidenceItem, error) {
	if run == nil || strings.TrimSpace(query) == "" {
		return nil, nil
	}

	manager := ensureFullSystemManager()

	cfg := graptor.DefaultFullSystemConfig()
	enableQGram := false
	enableGLDR := true
	enableRaptor := false
	cfg.Features.QGram = &enableQGram
	cfg.Features.GLDR = &enableGLDR
	cfg.Features.Raptor = &enableRaptor

	sessionID, err := manager.CreateSession(&cfg)
	if err != nil {
		return nil, err
	}
	defer func() { _ = manager.CloseSession(sessionID) }()

	scope := graptor.FullSystemScope{
		NarrativeID: strings.TrimSpace(run.Options.NarrativeID),
		FolderID:    strings.TrimSpace(run.Options.FolderID),
	}
	if scope.NarrativeID == "" {
		scope.NarrativeID = strings.TrimSpace(run.Options.ScopeID)
	}
	if scope.FolderID == "" {
		scope.FolderID = scope.NarrativeID
	}

	if err := manager.LoadCommittedScope(sessionID, scope); err != nil {
		return nil, err
	}

	result, err := manager.Search(sessionID, graptor.SearchRequest{
		Query:   query,
		Limit:   limit,
		Targets: []string{graptor.SearchTargetGLDRChunks, graptor.SearchTargetGLDRNodes},
		Scope:   &scope,
	})
	if err != nil {
		return nil, err
	}

	items := make([]store.EvidenceItem, 0, len(result.GLDRChunks)+len(result.GLDRNodes))
	for _, hit := range result.GLDRChunks {
		content := strings.TrimSpace(hit.Text)
		if content == "" {
			content = fmt.Sprintf("Chunk %s scored %.3f (lex %.3f, graph %.3f, semantic %.3f)", hit.ChunkID, hit.ChunkScore, hit.LexScore, hit.GraphScore, hit.SemanticScore)
		}
		title := strings.TrimSpace(hit.NoteID)
		if title == "" {
			title = strings.TrimSpace(hit.ChunkID)
		}
		items = append(items, store.EvidenceItem{
			ID:      hit.ChunkID,
			Source:  "search_blocks_graptor",
			Title:   title,
			Content: content,
			Score:   hit.ChunkScore,
			Metadata: map[string]interface{}{
				"chunkId":       hit.ChunkID,
				"documentId":    hit.DocumentID,
				"noteId":        hit.NoteID,
				"chunkScore":    hit.ChunkScore,
				"lexScore":      hit.LexScore,
				"graphScore":    hit.GraphScore,
				"semanticScore": hit.SemanticScore,
				"matched":       hit.MatchedEntities,
				"scopeFolderId": scope.FolderID,
				"narrativeId":   scope.NarrativeID,
			},
		})
	}

	for _, node := range result.GLDRNodes {
		content := fmt.Sprintf("Entity %s scored %.3f. Top chunks: %s", node.EntityID, node.NodeScore, strings.Join(node.TopChunks, ", "))
		items = append(items, store.EvidenceItem{
			ID:      node.EntityID,
			Source:  "search_blocks_graptor",
			Title:   node.EntityID,
			Content: content,
			Score:   node.NodeScore,
			Metadata: map[string]interface{}{
				"entityId":           node.EntityID,
				"nodeScore":          node.NodeScore,
				"topChunks":          node.TopChunks,
				"proximityFromQuery": node.ProximityFromQuery,
				"scopeFolderId":      scope.FolderID,
				"narrativeId":        scope.NarrativeID,
				"kind":               "node",
			},
		})
	}

	return items, nil
}
