//go:build js && wasm

package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/kittclouds/gokitt/internal/store"
)

func wireChatSearchers() {
	if chatSvc == nil {
		return
	}

	searcher := func(ctx context.Context, query string, limit int) ([]store.EvidenceItem, error) {
		_ = ctx
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
				Source:  "gldr",
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

	chatSvc.SetBlockSearcher(searcher)
	chatSvc.SetGraptorSearcher(searcher)
}
