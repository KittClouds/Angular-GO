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

	// 2. Candidates (union across clauses)
	candidateSet := idx.GenerateCandidates(clauses)
	if len(candidateSet) == 0 {
		return nil
	}

	// 2.5 Filters (Scope)
	if config.Scope != nil {
		for docID := range candidateSet {
			doc, ok := idx.Documents[docID]
			if !ok {
				delete(candidateSet, docID)
				continue
			}

			// NarrativeID
			if config.Scope.NarrativeID != "" && doc.NarrativeID != config.Scope.NarrativeID {
				delete(candidateSet, docID)
				continue
			}

			// FolderPath (Prefix match)
			if config.Scope.FolderPath != "" && !strings.HasPrefix(doc.FolderPath, config.Scope.FolderPath) {
				delete(candidateSet, docID)
				continue
			}
		}
		if len(candidateSet) == 0 {
			return nil
		}
	}

	// 3. Verify all candidates against all clauses
	//    matches[docID][clauseIdx] = *PatternMatch or nil
	type docVerification struct {
		matches      []*PatternMatch // index-aligned with clauses, nil if no match
		matchedCount int
	}

	verified := make(map[string]*docVerification)
	patternDF := make([]int, len(clauses)) // df(p) across verified docs

	for docID := range candidateSet {
		dv := &docVerification{
			matches: make([]*PatternMatch, len(clauses)),
		}

		reject := false
		for i, clause := range clauses {
			m := idx.VerifyCandidate(docID, clause)
			dv.matches[i] = m
			if m != nil {
				dv.matchedCount++
			} else if config.PhraseHard && clause.Type == PhraseClause {
				// Hard constraint: phrase miss → reject
				reject = true
				break
			}
		}

		if reject || dv.matchedCount == 0 {
			continue
		}

		verified[docID] = dv
		for i, m := range dv.matches {
			if m != nil {
				patternDF[i]++
			}
		}
	}

	if len(verified) == 0 {
		return nil
	}

	// 4. Score
	corpusStats := idx.GetCorpusStats()
	N := float64(corpusStats.TotalDocuments)

	// Pre-calculate IDFs (per-pattern, post-verify)
	idfs := make([]float64, len(clauses))
	for i := range clauses {
		idfs[i] = resorank.CalculateIDF(N, patternDF[i])
	}

	var results []SearchResult

	for docID, dv := range verified {
		// --- Base score: Σ s(p,d) for matched patterns ---
		baseSum := 0.0
		var patternMasks []uint32

		for i, m := range dv.matches {
			if m == nil {
				continue
			}

			// Field-weighted normalized TF:
			// tf*(p,d) = Σ_f w_f · ntf(tf_{p,d,f}, |d_f|, avg|d_f|, b)
			tfStar := 0.0
			for field, detail := range m.FieldMatches {
				wf := 1.0
				if w, ok := config.FieldWeights[field]; ok {
					wf = w
				}

				avgLen := corpusStats.AverageFieldLengths[field]
				if avgLen == 0 {
					avgLen = 100.0
				}

				ntf := resorank.NormalizedTermFrequency(
					detail.Count, detail.FieldLength, avgLen, config.B,
				)
				tfStar += wf * ntf
			}

			// Saturation + IDF
			// s(p,d) = idf(p) · sat(tf*(p,d))
			sat := resorank.Saturate(tfStar, config.K1)
			baseSum += idfs[i] * sat

			patternMasks = append(patternMasks, m.SegmentMask)
		}

		// --- Coverage multiplier: (ε + C(d))^λ ---
		coverage := float64(dv.matchedCount) / float64(len(clauses))
		coverageMult := math.Pow(config.CoverageEpsilon+coverage, config.CoverageLambda)

		score := baseSum * coverageMult

		// --- Proximity multiplier (global overlap on pattern masks) ---
		if len(patternMasks) > 1 {
			score *= patternProximity(
				patternMasks, config.ProximityAlpha, config.MaxSegments,
				idx, docID, corpusStats.AverageDocLength, config.ProximityDecay,
			)
		}

		results = append(results, SearchResult{
			DocID:    docID,
			Score:    score,
			Coverage: coverage,
		})
	}

	// 5. Sort descending, tie-break by DocID
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
