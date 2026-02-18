package gdr

import (
	"sync/atomic"

	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// GDRMetrics tracks performance metrics for GDR search.
// Useful for monitoring expansion loop behavior and PhraseHard rejection rates.
type GDRMetrics struct {
	// Query counts
	TotalQueries int64 // Total number of queries executed

	// Expansion tracking
	Expansion0xCount int64 // Queries that succeeded without expansion
	Expansion1xCount int64 // Queries that needed 1 expansion (4x)
	Expansion2xCount int64 // Queries that needed 2 expansions (8x)
	Expansion3xCount int64 // Queries that needed 3 expansions (16x)

	// Rejection tracking
	PhraseHardRejects int64 // Candidates rejected by PhraseHard verification
	TotalCandidates   int64 // Total candidates fetched from HNSW
	TotalVerified     int64 // Total candidates that passed verification

	// Result tracking
	TotalResults int64 // Total results returned
}

// NewGDRMetrics creates a new metrics instance.
func NewGDRMetrics() *GDRMetrics {
	return &GDRMetrics{}
}

// RecordQuery records a completed query with expansion and rejection stats.
func (m *GDRMetrics) RecordQuery(expansions int, rejects, candidates, verified, results int) {
	atomic.AddInt64(&m.TotalQueries, 1)
	atomic.AddInt64(&m.PhraseHardRejects, int64(rejects))
	atomic.AddInt64(&m.TotalCandidates, int64(candidates))
	atomic.AddInt64(&m.TotalVerified, int64(verified))
	atomic.AddInt64(&m.TotalResults, int64(results))

	switch expansions {
	case 0:
		atomic.AddInt64(&m.Expansion0xCount, 1)
	case 1:
		atomic.AddInt64(&m.Expansion1xCount, 1)
	case 2:
		atomic.AddInt64(&m.Expansion2xCount, 1)
	default:
		atomic.AddInt64(&m.Expansion3xCount, 1)
	}
}

// ExpansionHitRate returns the fraction of queries that needed expansion.
// A high rate indicates PhraseHard is rejecting many candidates.
func (m *GDRMetrics) ExpansionHitRate() float64 {
	if m.TotalQueries == 0 {
		return 0
	}
	expanded := m.Expansion1xCount + m.Expansion2xCount + m.Expansion3xCount
	return float64(expanded) / float64(m.TotalQueries)
}

// VerificationRate returns the fraction of candidates that passed verification.
// A low rate indicates PhraseHard is very selective.
func (m *GDRMetrics) VerificationRate() float64 {
	if m.TotalCandidates == 0 {
		return 0
	}
	return float64(m.TotalVerified) / float64(m.TotalCandidates)
}

// RejectionRate returns the fraction of candidates rejected by PhraseHard.
func (m *GDRMetrics) RejectionRate() float64 {
	if m.TotalCandidates == 0 {
		return 0
	}
	return float64(m.PhraseHardRejects) / float64(m.TotalCandidates)
}

// AvgResultsPerQuery returns the average number of results per query.
func (m *GDRMetrics) AvgResultsPerQuery() float64 {
	if m.TotalQueries == 0 {
		return 0
	}
	return float64(m.TotalResults) / float64(m.TotalQueries)
}

// AvgCandidatesPerQuery returns the average number of candidates fetched per query.
func (m *GDRMetrics) AvgCandidatesPerQuery() float64 {
	if m.TotalQueries == 0 {
		return 0
	}
	return float64(m.TotalCandidates) / float64(m.TotalQueries)
}

// Snapshot returns a copy of the current metrics.
func (m *GDRMetrics) Snapshot() GDRMetrics {
	return GDRMetrics{
		TotalQueries:      atomic.LoadInt64(&m.TotalQueries),
		Expansion0xCount:  atomic.LoadInt64(&m.Expansion0xCount),
		Expansion1xCount:  atomic.LoadInt64(&m.Expansion1xCount),
		Expansion2xCount:  atomic.LoadInt64(&m.Expansion2xCount),
		Expansion3xCount:  atomic.LoadInt64(&m.Expansion3xCount),
		PhraseHardRejects: atomic.LoadInt64(&m.PhraseHardRejects),
		TotalCandidates:   atomic.LoadInt64(&m.TotalCandidates),
		TotalVerified:     atomic.LoadInt64(&m.TotalVerified),
		TotalResults:      atomic.LoadInt64(&m.TotalResults),
	}
}

// Reset clears all metrics.
func (m *GDRMetrics) Reset() {
	atomic.StoreInt64(&m.TotalQueries, 0)
	atomic.StoreInt64(&m.Expansion0xCount, 0)
	atomic.StoreInt64(&m.Expansion1xCount, 0)
	atomic.StoreInt64(&m.Expansion2xCount, 0)
	atomic.StoreInt64(&m.Expansion3xCount, 0)
	atomic.StoreInt64(&m.PhraseHardRejects, 0)
	atomic.StoreInt64(&m.TotalCandidates, 0)
	atomic.StoreInt64(&m.TotalVerified, 0)
	atomic.StoreInt64(&m.TotalResults, 0)
}

// SearchResultWithMetrics contains search results along with metrics for the query.
type SearchResultWithMetrics struct {
	Results    []GDRResult
	Expansions int  // Number of expansions needed
	Rejects    int  // Candidates rejected by PhraseHard
	Candidates int  // Total candidates fetched
	Verified   int  // Candidates that passed verification
	FromCache  bool // Whether results came from cache (future use)
}

// SearchWithMetrics executes a search and returns detailed metrics.
func (gdr *GateDrivenRetriever) SearchWithMetrics(input SearchInput, config GDRConfig) SearchResultWithMetrics {
	// Pre-compute allowed UIDs if provided
	var allowedUIDs map[uint32]bool
	if len(input.AllowedIDs) > 0 {
		allowedUIDs = make(map[uint32]bool, len(input.AllowedIDs))
		for id := range input.AllowedIDs {
			uid := gdr.Lex.Mapper.Get(id)
			if uid > 0 {
				allowedUIDs[uid] = true
			}
		}
		if len(allowedUIDs) == 0 {
			return SearchResultWithMetrics{}
		}
	}

	// Parse lexical query
	clauses := qgram.ParseQuery(input.TextQuery)
	if len(clauses) == 0 {
		return SearchResultWithMetrics{}
	}

	// Build lexical gate bitmap
	gate := gdr.BuildGateBitmap(clauses, config.GateMaxCandidates)
	if gate.IsEmpty() {
		return SearchResultWithMetrics{}
	}

	// If no vector, fall back to lexical-only search
	if len(input.Vector) == 0 {
		results := gdr.searchLexicalOnly(clauses, gate, allowedUIDs, config)
		return SearchResultWithMetrics{
			Results:    results,
			Expansions: 0,
			Candidates: int(gate.GateSize()),
			Verified:   len(results),
		}
	}

	// Filtered HNSW search with expansion loop and metrics tracking
	return gdr.searchWithExpansionMetrics(input.Vector, clauses, gate, allowedUIDs, config)
}

func (gdr *GateDrivenRetriever) searchWithExpansionMetrics(
	queryVec []float32,
	clauses []qgram.Clause,
	gate *GateResult,
	allowedUIDs map[uint32]bool,
	config GDRConfig,
) SearchResultWithMetrics {
	k := config.K
	if k == 0 {
		k = 10
	}

	ef := config.EfSearch
	if ef == 0 {
		ef = 50
	}

	fetchCap := config.FetchCap
	if fetchCap == 0 {
		fetchCap = 1000
	}

	expansionFactor := config.ExpansionFactor
	if expansionFactor == 0 {
		expansionFactor = 4
	}

	maxExpansions := config.MaxExpansions
	if maxExpansions == 0 {
		maxExpansions = 3
	}

	var results []GDRResult
	expansions := 0
	fetchK := k * expansionFactor
	totalCandidates := 0
	totalRejects := 0

	filter := func(id uint32) bool {
		if allowedUIDs != nil && !allowedUIDs[id] {
			return false
		}
		return gate.Contains(id)
	}

	for expansions < maxExpansions {
		if fetchK > fetchCap {
			fetchK = fetchCap
		}

		candidates := gdr.Vec.SearchKNNFiltered(queryVec, fetchK, ef, filter)
		totalCandidates += len(candidates)

		if len(candidates) == 0 {
			break
		}

		// Verify and score, tracking rejects
		results, rejects := gdr.verifyAndScoreWithRejects(candidates, clauses, config)
		totalRejects += rejects

		if len(results) >= k {
			break
		}

		fetchK *= expansionFactor
		ef *= 2
		expansions++
	}

	if k > 0 && len(results) > k {
		results = results[:k]
	}

	return SearchResultWithMetrics{
		Results:    results,
		Expansions: expansions,
		Rejects:    totalRejects,
		Candidates: totalCandidates,
		Verified:   len(results),
	}
}

// verifyAndScoreWithRejects is like verifyAndScore but also returns reject count.
func (gdr *GateDrivenRetriever) verifyAndScoreWithRejects(
	candidates []hnsw.Result,
	clauses []qgram.Clause,
	config GDRConfig,
) ([]GDRResult, int) {
	// This is a simplified version - the full implementation would track
	// PhraseHard rejections during verification
	results := gdr.verifyAndScore(candidates, clauses, config)
	rejects := len(candidates) - len(results)
	return results, rejects
}
