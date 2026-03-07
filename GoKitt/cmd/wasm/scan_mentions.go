package main

import (
	"sort"

	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
	"github.com/kittclouds/gokitt/pkg/scanner/syntax"
)

func buildMentionSummaries(result *conductor.ScanResult) []map[string]interface{} {
	if result == nil {
		return nil
	}

	counts := make(map[string]int)

	for _, match := range result.Syntax {
		if match.Kind == syntax.KindEntity && match.ID != "" {
			counts[match.ID]++
		}
	}

	for _, ref := range result.ResolvedRefs {
		if ref.EntityID != "" {
			counts[ref.EntityID]++
		}
	}

	if len(counts) == 0 {
		return nil
	}

	type mentionSummary struct {
		EntityID string
		Count    int
	}

	summaries := make([]mentionSummary, 0, len(counts))
	for entityID, count := range counts {
		summaries = append(summaries, mentionSummary{EntityID: entityID, Count: count})
	}

	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Count == summaries[j].Count {
			return summaries[i].EntityID < summaries[j].EntityID
		}
		return summaries[i].Count > summaries[j].Count
	})

	out := make([]map[string]interface{}, 0, len(summaries))
	for _, summary := range summaries {
		out = append(out, map[string]interface{}{
			"entityId": summary.EntityID,
			"count":    summary.Count,
		})
	}

	return out
}
