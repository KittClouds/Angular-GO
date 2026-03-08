package gdr

import (
	"math"
	"sort"
	"strings"

	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// computeIDFs pre-computes IDF values for each clause using the lexical index.
func (gdr *GateDrivenRetriever) computeIDFs(clauses []qgram.Clause) []float64 {
	idfs := make([]float64, len(clauses))
	for i, clause := range clauses {
		grams := qgram.ExtractGrams(clause.Pattern, gdr.Lex.Q)
		maxIDF := 0.0
		for _, g := range grams {
			idf := gdr.Lex.GramIDF(g)
			if idf > maxIDF {
				maxIDF = idf
			}
		}
		if maxIDF == 0 {
			maxIDF = 1.0 // fallback
		}
		idfs[i] = maxIDF
	}
	return idfs
}

// verifyAndScore verifies candidates and computes hybrid scores.
// This is the core scoring function that combines lexical and vector scores.
//
// The lexical score is the FULL score from qgram (BM25 + coverage + proximity).
// Both scores are normalized before blending:
// - Lexical: cap and normalize to [0, 1]
// - Vector: normalize cosine from [VecMin, VecMax] to [0, 1]
func (gdr *GateDrivenRetriever) verifyAndScore(
	candidates []hnsw.Result,
	clauses []qgram.Clause,
	config GDRConfig,
) []GDRResult {
	if len(candidates) == 0 {
		return []GDRResult{}
	}

	hasLexical := len(clauses) > 0
	var qv qgram.QueryVerifier
	var idfs []float64
	if hasLexical {
		qv = qgram.NewQueryVerifier(clauses)
		idfs = gdr.computeIDFs(clauses)
	}
	corpusStats := gdr.Lex.GetCorpusStats()

	var results []GDRResult

	for _, cand := range candidates {
		docID := gdr.Lex.Mapper.GetString(cand.ID)
		if docID == "" {
			continue
		}

		// Get document for scope check
		doc, ok := gdr.Lex.Documents[docID]
		if !ok {
			continue
		}

		// Scope check (before verification for efficiency)
		if config.LexicalConfig.Scope != nil {
			if config.LexicalConfig.Scope.NarrativeID != "" && doc.NarrativeID != config.LexicalConfig.Scope.NarrativeID {
				continue
			}
			if config.LexicalConfig.Scope.FolderPath != "" && !strings.HasPrefix(doc.FolderPath, config.LexicalConfig.Scope.FolderPath) {
				continue
			}
		}

		lexScore := 0.0
		lexNorm := 0.0
		coverage := 0.0

		if hasLexical {
			// Verify all clauses (Aho-Corasick one-pass)
			matches, matchedCount := gdr.Lex.VerifyCandidateAll(docID, &qv)
			if matchedCount == 0 {
				if config.Hard {
					continue
				}
			} else {
				// PhraseHard rejection
				if config.LexicalConfig.PhraseHard {
					reject := false
					for i, clause := range clauses {
						if clause.Type == qgram.PhraseClause && matches[i] == nil {
							reject = true
							break
						}
					}
					if reject {
						continue
					}
				}

				// Compute FULL lexical score (BM25 + coverage + proximity)
				lexScore = gdr.computeDocScore(docID, matches, matchedCount, idfs, config.LexicalConfig, corpusStats)

				// Normalize scores before blending
				// Lexical: cap and normalize to [0, 1]
				lexNorm = math.Min(lexScore, config.ScoreConfig.LexicalCap) / config.ScoreConfig.LexicalCap
				if lexNorm < 0 {
					lexNorm = 0
				}

				coverage = float64(matchedCount) / float64(len(clauses))
			}
		}

		// Vector: normalize cosine from [VecMin, VecMax] to [0, 1]
		vecScore := float64(cand.Score)
		vecNorm := (vecScore - config.ScoreConfig.VecMin) / (config.ScoreConfig.VecMax - config.ScoreConfig.VecMin)
		if vecNorm < 0 {
			vecNorm = 0
		}
		if vecNorm > 1 {
			vecNorm = 1
		}

		// Convex blend
		combinedNorm := vecNorm
		if hasLexical {
			alpha := config.ScoreConfig.Alpha
			combinedNorm = lexNorm*(1.0-alpha) + vecNorm*alpha
		}

		results = append(results, GDRResult{
			DocID:    docID,
			Score:    combinedNorm,
			LexScore: lexScore,
			VecScore: cand.Score,
			LexNorm:  lexNorm,
			VecNorm:  vecNorm,
			Coverage: coverage,
		})
	}

	// Sort by combined normalized score (descending)
	sort.Slice(results, func(i, j int) bool {
		if math.Abs(results[i].Score-results[j].Score) < 1e-9 {
			return results[i].DocID < results[j].DocID
		}
		return results[i].Score > results[j].Score
	})

	return results
}

// computeDocScore computes the full lexical score for a document.
// This mirrors the qgram scorer but is exposed here for hybrid use.
func (gdr *GateDrivenRetriever) computeDocScore(
	docID string,
	matches []*qgram.PatternMatch,
	matchedCount int,
	idfs []float64,
	config qgram.SearchConfig,
	stats qgram.CorpusStats,
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

			// Normalized TF: (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (fieldLen / avgLen)))
			ntf := float64(detail.Count) * (1.2 + 1.0)
			denom := float64(detail.Count) + 1.2*(1.0-0.75+0.75*(float64(detail.FieldLength)/avgLen))
			if denom > 0 {
				ntf = ntf / denom
			}

			tfStar += wf * ntf
		}

		// Saturation (k1 parameter)
		sat := tfStar
		if tfStar > 0 {
			sat = tfStar / (1.0 + tfStar/1.2) // simplified saturation
		}

		baseSum += idfs[i] * sat

		patternMasks = append(patternMasks, m.SegmentMask)
	}

	// Coverage multiplier
	coverage := float64(matchedCount) / float64(len(matches))
	coverageMult := math.Pow(config.CoverageEpsilon+coverage, config.CoverageLambda)

	score := baseSum * coverageMult

	// Proximity multiplier (if multiple patterns)
	if len(patternMasks) > 1 {
		score *= gdr.patternProximity(patternMasks, config.ProximityAlpha, config.MaxSegments, docID, stats.AverageDocLength, config.ProximityDecay)
	}

	return score
}

// patternProximity computes the simplified global-overlap multiplier.
func (gdr *GateDrivenRetriever) patternProximity(
	masks []uint32,
	alpha float64,
	maxSegs uint32,
	docID string,
	avgDocLen float64,
	decayLambda float64,
) float64 {
	if len(masks) < 2 || maxSegs == 0 {
		return 1.0
	}

	// AND all masks
	common := masks[0]
	for i := 1; i < len(masks); i++ {
		common &= masks[i]
	}

	overlapCount := uint32(0)
	for common != 0 {
		common &= (common - 1) // clear lowest set bit
		overlapCount++
	}

	denom := uint32(len(masks))
	if denom > maxSegs {
		denom = maxSegs
	}

	baseMult := float64(overlapCount) / float64(denom)

	// Length decay
	docLen := 0
	if doc, ok := gdr.Lex.Documents[docID]; ok {
		for _, content := range doc.Fields {
			docLen += len(qgram.NormalizeText(content))
		}
	}
	lenRatio := 1.0
	if avgDocLen > 0 {
		lenRatio = float64(docLen) / avgDocLen
	}
	decay := math.Exp(-decayLambda * lenRatio)

	return 1.0 + alpha*baseMult*decay
}
