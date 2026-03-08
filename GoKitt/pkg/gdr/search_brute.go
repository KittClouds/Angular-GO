package gdr

import (
	"sort"

	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/kittclouds/gokitt/pkg/hnsw/distance"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// searchBruteForce performs an exhaustive scan of the allowed UIDs and selects top K.
// This is used as a fallback when the number of allowed documents is small (< 1000),
// avoiding the overhead of graph traversal in HNSW.
func (gdr *GateDrivenRetriever) searchBruteForce(
	queryVec []float32,
	clauses []qgram.Clause,
	gate *GateResult,
	allowedUIDs map[uint32]bool,
	config GDRConfig,
) []GDRResult {
	if len(allowedUIDs) == 0 {
		return []GDRResult{}
	}

	dim := len(queryVec)
	if dim == 0 {
		return []GDRResult{}
	}

	// Pre-compute query magnitude for Cosine Similarity
	qMag := distance.Magnitude(queryVec)

	// Collect candidates
	candidates := make([]hnsw.Result, 0, len(allowedUIDs))
	for uid := range allowedUIDs {
		// Gate check (lexical filter)
		if !gate.Contains(uid) {
			continue
		}

		vec, ok := gdr.Vec.GetVector(dim, uid)
		if !ok {
			continue
		}

		// Calculate similarity (Higher is better)
		score := distance.CosineSimilarity(queryVec, vec, qMag, 0)
		candidates = append(candidates, hnsw.Result{
			ID:    uid,
			Score: score,
		})
	}

	// Sort by score descending
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	// Truncate to FetchCap or K * ExpansionFactor
	limit := config.FetchCap
	if limit == 0 {
		limit = 1000
	}
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}

	// Verify and Score (Lexical + Vector blending)
	return gdr.verifyAndScore(candidates, clauses, config)
}

// searchBruteForceNoGate performs an exhaustive scan without applying the lexical gate.
// This is used for soft semantic fallback when lexical matching is optional.
func (gdr *GateDrivenRetriever) searchBruteForceNoGate(
	queryVec []float32,
	clauses []qgram.Clause,
	allowedUIDs map[uint32]bool,
	config GDRConfig,
) []GDRResult {
	if len(queryVec) == 0 {
		return []GDRResult{}
	}

	dim := len(queryVec)
	qMag := distance.Magnitude(queryVec)

	candidateCap := config.FetchCap
	if candidateCap == 0 {
		candidateCap = 1000
	}

	var uidSource []uint32
	if len(allowedUIDs) > 0 {
		uidSource = make([]uint32, 0, len(allowedUIDs))
		for uid := range allowedUIDs {
			uidSource = append(uidSource, uid)
		}
	} else {
		uidSource = make([]uint32, 0, len(gdr.Lex.Documents))
		for docID := range gdr.Lex.Documents {
			uid := gdr.Lex.Mapper.Get(docID)
			if uid != 0 {
				uidSource = append(uidSource, uid)
			}
		}
	}

	candidates := make([]hnsw.Result, 0, len(uidSource))
	for _, uid := range uidSource {
		vec, ok := gdr.Vec.GetVector(dim, uid)
		if !ok {
			continue
		}

		score := distance.CosineSimilarity(queryVec, vec, qMag, 0)
		candidates = append(candidates, hnsw.Result{
			ID:    uid,
			Score: score,
		})
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	if len(candidates) > candidateCap {
		candidates = candidates[:candidateCap]
	}

	return gdr.verifyAndScore(candidates, clauses, config)
}
