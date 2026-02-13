package qgram

import (
	"math"
	"sort"
)

// GenerateCandidates returns docIDs that *potentially* match the query.
// Uses UNION across clauses (soft-AND lives in the scorer via Coverage multiplier).
// Within each clause, q-gram postings are still intersected for pruning.
func (idx *QGramIndex) GenerateCandidates(clauses []Clause) map[string]bool {
	if len(clauses) == 0 {
		return nil
	}

	result := make(map[string]bool)

	for _, clause := range clauses {
		clauseDocs := idx.getCandidatesForPattern(clause.Pattern)
		for _, docID := range clauseDocs {
			result[docID] = true
		}
	}

	if len(result) == 0 {
		return nil
	}
	return result
}

func (idx *QGramIndex) getCandidatesForPattern(pattern string) []string {
	if len(pattern) < idx.Q {
		// Short pattern: fallback to scanning ALL docs
		all := make([]string, 0, len(idx.Documents))
		for docID := range idx.Documents {
			all = append(all, docID)
		}
		return all
	}

	grams := ExtractGrams(pattern, idx.Q)
	if len(grams) == 0 {
		return nil
	}

	// Sort grams by IDF (estimated by doc freq) to intersect smallest lists first
	type gramStats struct {
		gram string
		df   int
	}
	stats := make([]gramStats, len(grams))
	for i, g := range grams {
		matches := idx.GramPostings[g]
		stats[i] = gramStats{gram: g, df: len(matches)}
	}

	sort.Slice(stats, func(i, j int) bool {
		return stats[i].df < stats[j].df
	})

	// Start with the rarest gram's postings
	rarest := stats[0]
	postings := idx.GramPostings[rarest.gram]
	if len(postings) == 0 {
		return nil
	}

	currentDocs := make([]string, 0, len(postings))
	for docID := range postings {
		currentDocs = append(currentDocs, docID)
	}
	sort.Strings(currentDocs)

	// Intersect with subsequent grams
	for i := 1; i < len(stats); i++ {
		g := stats[i].gram
		nextPostings := idx.GramPostings[g]

		var nextDocs []string
		// Iterate currentDocs (which is expected to be smaller than nextPostings)
		for _, docID := range currentDocs {
			if _, ok := nextPostings[docID]; ok {
				nextDocs = append(nextDocs, docID)
			}
		}
		currentDocs = nextDocs
		if len(currentDocs) == 0 {
			return nil
		}
	}

	return currentDocs
}

// GramIDF computes IDF for a specific gram
func (idx *QGramIndex) GramIDF(gram string) float64 {
	df := len(idx.GramPostings[gram])
	return math.Log(1.0 + (float64(idx.totalDocs)-float64(df)+0.5)/(float64(df)+0.5))
}
