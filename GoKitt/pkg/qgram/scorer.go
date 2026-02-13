package qgram

import (
	"math"
	"math/bits"
	"sort"
	"strings"

	"github.com/kittclouds/gokitt/pkg/resorank"
)

// SearchConfig holds tuning knobs for the scoring formula.
type SearchConfig struct {
	// BM25 knobs
	K1           float64            // saturation parameter (default 1.2)
	B            float64            // length normalization (default 0.75)
	FieldWeights map[string]float64 // w_f per field (default all 1.0)

	// Coverage (soft-AND)
	CoverageLambda  float64 // λ: 0=OR, ~3=almost-AND (default 3.0)
	CoverageEpsilon float64 // ε: prevents score=0 for partial (default 0.1)

	// Phrase handling
	PhraseHard bool // true = reject doc if any phrase clause misses

	// Proximity
	ProximityAlpha float64 // α: strength of overlap boost (default 0.5)
	ProximityDecay float64 // λ_d: decay by doc length ratio (default 0.1)
	MaxSegments    uint32  // segment count for masks (default 32)
	Scope          *SearchScope
}

type SearchScope struct {
	NarrativeID string
	FolderPath  string
}

// DefaultSearchConfig returns sane defaults.
// Field weights are "effectively off" (all 1.0).
func DefaultSearchConfig() SearchConfig {
	return SearchConfig{
		K1:              1.2,
		B:               0.75,
		FieldWeights:    make(map[string]float64),
		CoverageLambda:  3.0,
		CoverageEpsilon: 0.1,
		PhraseHard:      true,
		ProximityAlpha:  0.5,
		ProximityDecay:  0.1,
		MaxSegments:     32,
	}
}

// SearchResult holds a scored document.
type SearchResult struct {
	DocID    string
	Score    float64
	Coverage float64 // fraction of clauses matched (0..1)
}

// Search executes the full pipeline: Parse → Candidates → Verify → Score → Rank
func (idx *QGramIndex) Search(input string, config SearchConfig, limit int) []SearchResult {
	// 1. Parse
	clauses := ParseQuery(input)
	if len(clauses) == 0 {
		return nil
	}

	// 2. Candidates (union across clauses) with WAND UpperBounds
	candidates := idx.GeneratePrunedCandidates(clauses, config, limit)
	if len(candidates) == 0 {
		return nil
	}

	// 3. Sort, Verify, Score, Prune via helper
	return idx.refinedSearchWithPruning(candidates, clauses, config, limit)
}

func (idx *QGramIndex) refinedSearchWithPruning(candidates []Candidate, clauses []Clause, config SearchConfig, limit int) []SearchResult {
	type docVerification struct {
		matches      []*PatternMatch
		matchedCount int
		score        float64
	}

	verified := make(map[string]*docVerification)

	// Pre-calculate IDFs based on Candidate Counts (Stable estimate)
	// This avoids score instability due to pruning.
	corpusStats := idx.GetCorpusStats()
	N := float64(corpusStats.TotalDocuments)
	if N == 0 {
		N = 1
	}

	idfs := make([]float64, len(clauses))
	for i, clause := range clauses {
		// Use candidate count as DF estimate
		// Safe lower bound on IDF (Upper bound on DF)
		// We re-query candidates count? No, we have it from `getCandidatesForPattern`.
		// But passing it here is hard.
		// Let's just re-extract? No, expensive.
		// Let's assume idx.GramIDF(rarest) is available or just use GramIDF.
		// Actually, clauses[i].Pattern -> we can get rarest gram IDF easily?
		// idx.GramIDF() exists.
		grams := ExtractGrams(clause.Pattern, idx.Q)
		maxIDF := 0.0
		for _, g := range grams {
			idf := idx.GramIDF(g)
			if idf > maxIDF {
				maxIDF = idf
			}
		}
		if maxIDF == 0 {
			maxIDF = 1.0
		} // fallback
		idfs[i] = maxIDF
	}

	// Build QueryVerifier once for all candidates (Aho-Corasick one-pass verification)
	qv := NewQueryVerifier(clauses)

	// Track pattern document frequencies for potential future use
	patternDF := make([]int, len(clauses))

	var topScores []float64
	threshold := 0.0
	var results []SearchResult

	for _, cand := range candidates {
		if limit > 0 && len(topScores) >= limit {
			if cand.UpperBound <= threshold {
				break
			}
		}

		docID := cand.DocID
		doc, ok := idx.Documents[docID]
		if !ok {
			continue
		}

		// Scope Check
		if config.Scope != nil {
			if config.Scope.NarrativeID != "" && doc.NarrativeID != config.Scope.NarrativeID {
				continue
			}
			if config.Scope.FolderPath != "" && !strings.HasPrefix(doc.FolderPath, config.Scope.FolderPath) {
				continue
			}
		}

		// Verify all clauses in one pass using Aho-Corasick
		matches, matchedCount := idx.VerifyCandidateAll(docID, &qv)
		if matchedCount == 0 {
			continue
		}

		// PhraseHard behavior preserved
		reject := false
		if config.PhraseHard {
			for i, clause := range clauses {
				if clause.Type == PhraseClause && matches[i] == nil {
					reject = true
					break
				}
			}
		}
		if reject {
			continue
		}

		// Score
		score := idx.computeDocScore(docID, matches, matchedCount, idfs, config, corpusStats)
		dv := &docVerification{
			matches:      matches,
			matchedCount: matchedCount,
			score:        score,
		}
		verified[docID] = dv

		// Update pattern document frequencies
		for i, m := range matches {
			if m != nil {
				patternDF[i]++
			}
		}

		// Update Threshold
		if limit > 0 {
			topScores = insertSorted(topScores, score, limit)
			if len(topScores) == limit {
				threshold = topScores[0]
			}
		}

		results = append(results, SearchResult{
			DocID:    docID,
			Score:    score,
			Coverage: float64(matchedCount) / float64(len(clauses)),
		})
	}

	// Final Sort
	sort.Slice(results, func(i, j int) bool {
		if math.Abs(results[i].Score-results[j].Score) < 1e-9 {
			return results[i].DocID < results[j].DocID
		}
		return results[i].Score > results[j].Score
	})

	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}

	return results
}

func (idx *QGramIndex) computeDocScore(
	docID string,
	matches []*PatternMatch,
	matchedCount int,
	idfs []float64,
	config SearchConfig,
	stats CorpusStats,
) float64 {
	baseSum := 0.0
	var patternMasks []uint32

	for i, m := range matches {
		if m == nil {
			continue
		}

		// Field-weighted normalized TF
		tfStar := 0.0
		for field, detail := range m.FieldMatches {
			wf := 1.0
			if w, ok := config.FieldWeights[field]; ok {
				wf = w
			}

			avgLen := stats.AverageFieldLengths[field]
			if avgLen == 0 {
				avgLen = 100.0
			}

			ntf := resorank.NormalizedTermFrequency(
				detail.Count, detail.FieldLength, avgLen, config.B,
			)
			tfStar += wf * ntf
		}

		sat := resorank.Saturate(tfStar, config.K1)
		baseSum += idfs[i] * sat

		patternMasks = append(patternMasks, m.SegmentMask)
	}

	coverage := float64(matchedCount) / float64(len(matches))
	coverageMult := math.Pow(config.CoverageEpsilon+coverage, config.CoverageLambda)

	score := baseSum * coverageMult

	if len(patternMasks) > 1 {
		score *= patternProximity(
			patternMasks, config.ProximityAlpha, config.MaxSegments,
			idx, docID, stats.AverageDocLength, config.ProximityDecay,
		)
	}

	return score
}

func insertSorted(slice []float64, val float64, limit int) []float64 {
	i := sort.SearchFloat64s(slice, val)
	// Insert at i
	if len(slice) < limit {
		slice = append(slice, 0)
		copy(slice[i+1:], slice[i:])
		slice[i] = val
	} else if i > 0 {
		// If val is greater than smallest (slice[0]), we drop slice[0]
		// Actually slice is sorted ascending. slice[0] is smallest.
		// If val > slice[0], we insert.
		// Shift down
		copy(slice[0:i-1], slice[1:i]) // Shift left? No.
		// We want to remove index 0 and insert at index i (which is relative to original slice).
		// Wait, if slice is [1, 2, 4], val is 3. i=2.
		// Result: [2, 3, 4].
		// Shift 1..i to 0..i-1
		copy(slice[0:], slice[1:i])
		slice[i-1] = val
	}
	return slice
}

// patternProximity computes the simplified global-overlap multiplier:
// M_prox(d) = 1 + α · PopCount(⋀_j mask(p_j, d)) / min(m, maxSegs) · e^(-λ_d · lenRatio)
func patternProximity(masks []uint32, alpha float64, maxSegs uint32, idx *QGramIndex, docID string, avgDocLen float64, decayLambda float64) float64 {
	if len(masks) < 2 || maxSegs == 0 {
		return 1.0
	}

	// AND all masks
	common := masks[0]
	for i := 1; i < len(masks); i++ {
		common &= masks[i]
	}

	overlapCount := bits.OnesCount32(common)
	denom := uint32(len(masks))
	if denom > maxSegs {
		denom = maxSegs
	}

	baseMult := float64(overlapCount) / float64(denom)

	// Length decay
	docLen := 0
	if doc, ok := idx.Documents[docID]; ok {
		for _, content := range doc.Fields {
			docLen += len(NormalizeText(content))
		}
	}
	lenRatio := 1.0
	if avgDocLen > 0 {
		lenRatio = float64(docLen) / avgDocLen
	}
	decay := math.Exp(-decayLambda * lenRatio)

	return 1.0 + alpha*baseMult*decay
}
