package qgram

import (
	"math"
	"sort"
)

// PatternIterator tracks iteration over a sorted list of docIDs for WAND.
type PatternIterator struct {
	DocIDs   []string
	Index    int
	MaxScore float64 // Upper bound contribution of this pattern
	Current  string  // Current DocID, empty if exhausted
}

func NewPatternIterator(docs []string, maxScore float64) *PatternIterator {
	it := &PatternIterator{
		DocIDs:   docs,
		MaxScore: maxScore,
	}
	if len(docs) > 0 {
		it.Current = docs[0]
	}
	return it
}

func (it *PatternIterator) Next() {
	it.Index++
	if it.Index < len(it.DocIDs) {
		it.Current = it.DocIDs[it.Index]
	} else {
		it.Current = ""
	}
}

// Seek advances to the first docID >= target.
func (it *PatternIterator) Seek(target string) {
	if it.Current == "" || it.Current >= target {
		return
	}

	// Optimization: simple linear scan is efficient for small skips
	// and dense lists. For sparse, exponential search would work better.
	// Given q-gram intersections are usually reasonably filtered, linear is fine.
	for it.Index < len(it.DocIDs) {
		if it.DocIDs[it.Index] >= target {
			it.Current = it.DocIDs[it.Index]
			return
		}
		it.Index++
	}
	it.Current = ""
}

// GeneratePrunedCandidates implements the WAND algorithm to return optimized candidates.
// Returns a map of docIDs that exceed the pruning threshold.
// Candidate represents a potential match with an upper bound score.
type Candidate struct {
	DocID      string
	UpperBound float64
}

// GeneratePrunedCandidates implements the WAND algorithm to return optimized candidates.
// Returns a list of candidates with their upper-bound scores, unsorted.
// The caller (Search) should sort by UpperBound and apply MaxScore pruning (Stop when UB < Threshold).
func (idx *QGramIndex) GeneratePrunedCandidates(clauses []Clause, config SearchConfig, limit int) []Candidate {
	if len(clauses) == 0 {
		return nil
	}

	var iterators []*PatternIterator
	for _, clause := range clauses {
		docs := idx.getCandidatesForPattern(clause.Pattern)
		if len(docs) == 0 {
			continue
		}

		// Estimate MaxScore for this pattern
		maxScore := idx.estimateMaxScore(clause.Pattern, config)
		iterators = append(iterators, NewPatternIterator(docs, maxScore))
	}

	if len(iterators) == 0 {
		return nil
	}

	var results []Candidate

	// Efficient UNION with UpperBound aggregation
	for {
		// Sort iterators by Current docID
		// Optimization: Use a min-heap if N is large, but usually N (clauses) is small (<10).
		sort.Slice(iterators, func(i, j int) bool {
			if iterators[i].Current == "" {
				return false // exhausted go to end
			}
			if iterators[j].Current == "" {
				return true
			}
			return iterators[i].Current < iterators[j].Current
		})

		// Check if all exhausted
		if iterators[0].Current == "" {
			break
		}

		pivotDoc := iterators[0].Current
		upperBound := 0.0

		// Sum MaxScores for all matching iterators
		for _, it := range iterators {
			if it.Current == pivotDoc {
				upperBound += it.MaxScore
				it.Next()
			} else {
				// Since sorted, subsequent iterators either match pivotDoc or are greater.
				// Wait, sort is on Current, which changes.
				// We iterate the slice which was just sorted.
				// If iterators[k].Current > pivotDoc, we stop summing.
				// But we must check the original list? No, the sorted list contains all active.
				// Since we just sorted, any iterator with Current == pivotDoc will be at the front.
				// Once we hit one > pivotDoc, we can break.
				break
			}
		}

		results = append(results, Candidate{
			DocID:      pivotDoc,
			UpperBound: upperBound,
		})
	}

	return results
}

func (idx *QGramIndex) estimateMaxScore(pattern string, config SearchConfig) float64 {
	// 1. IDF Upper Bound
	// Use docCount as conservative estimate for now (assuming worst case for WAND -> low pruning risk)
	// Actually, for MaxScore we need a value that is >= True Score.
	// IDF(df) decreases as df increases.
	// True DF <= docCount.
	// IDF(True DF) >= IDF(docCount).
	// So IDF(docCount) is a LOWER bound on IDF.
	// We need an UPPER bound on IDF.
	// Upper bound on IDF is IDF(1).
	corpusStats := idx.GetCorpusStats()
	N := float64(corpusStats.TotalDocuments)
	if N == 0 {
		N = 1
	}
	idf := math.Log(1.0 + N) // Max possible IDF (df=0.5 approx)

	// 2. BM25 Saturation Upper Bound
	// Term Frequency Saturation: (k1 + 1) * tf / (k1 + tf) -> approaches k1+1
	// Length Norm: 1 - b + b * len/avg
	// Max BM25 component is approx k1 + 1 (when len is small, tf is large).
	// Let's compute tighter bound from GramStats?

	grams := ExtractGrams(pattern, idx.Q)
	maxGramImpact := 0.0

	for _, g := range grams {
		stat, ok := idx.GramStats[g]
		if !ok {
			continue
		}
		// Calculate max possible contribution from this gram
		// Assume avgDocLen from stats
		avgLen := corpusStats.AverageDocLength
		if avgLen == 0 {
			avgLen = 100
		}

		// Max Impact for this gram across all docs
		// impact = (k1+1) * maxTF / (k1*(1-b+b*minLen/avg) + maxTF)
		k1 := config.K1
		b := config.B

		lenNorm := 1.0 - b + b*float64(stat.MinFieldLen)/avgLen
		denom := k1*lenNorm + float64(stat.MaxTF)
		if denom > 0 {
			impact := (k1 + 1) * float64(stat.MaxTF) / denom
			if impact > maxGramImpact {
				maxGramImpact = impact
			}
		}
	}

	if maxGramImpact == 0 {
		maxGramImpact = config.K1 + 1 // Fallback conservative
	}

	return idf * maxGramImpact
}
