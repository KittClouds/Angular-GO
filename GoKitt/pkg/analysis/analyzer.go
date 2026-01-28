// Package analysis provides high-level narrative metrics.
package analysis

import (
	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/scanner/chunker"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
)

// MetricResult holds the computed stats
type MetricResult struct {
	WordCount        int     `json:"wordCount"`
	CharacterCount   int     `json:"charCount"`
	SentenceCount    int     `json:"sentCount"`
	ReadingTimeMin   float64 `json:"readingTimeMin"`
	FlowScore        float64 `json:"flowScore"`        // 0-100
	FlowTrend        []int   `json:"flowTrend"`        // Sparkline data
	SentenceVarScore float64 `json:"sentenceVarScore"` // 0-100
}

// Analyzer computes metrics from a scan result
type Analyzer struct {
	Graph *graph.ConceptGraph
}

// NewAnalyzer creates an analyzer with access to the entity graph
func NewAnalyzer(g *graph.ConceptGraph) *Analyzer {
	return &Analyzer{Graph: g}
}

// Analyze computes the full suite of metrics
func (a *Analyzer) Analyze(scan conductor.ScanResult) MetricResult {
	words := len(scan.Tokens) // Rough approx if tokens include punctuation, but close enough for UI
	chars := len(scan.Text)
	sents := countSentences(scan) // Or use Reality CST if available

	flow, trend := a.computeFlow(scan)

	// Ensure bounds 0-100
	if flow > 100 {
		flow = 100
	}
	if flow < 0 {
		flow = 0
	}

	return MetricResult{
		WordCount:      words,
		CharacterCount: chars,
		SentenceCount:  sents,
		ReadingTimeMin: float64(words) / 250.0, // Avg 250 wpm
		FlowScore:      flow,
		FlowTrend:      trend,
	}
}

func countSentences(scan conductor.ScanResult) int {
	// Simple count from Chunker or scan text
	count := 0
	for _, t := range scan.Tokens {
		if t.Text == "." || t.Text == "?" || t.Text == "!" {
			count++
		}
	}
	if count == 0 && len(scan.Tokens) > 0 {
		return 1
	}
	return count
}

// computeFlow calculates the semantic continuity score avoiding allocations
func (a *Analyzer) computeFlow(scan conductor.ScanResult) (float64, []int) {
	// 1. Identify Sentences
	sentences := a.identifySentenceRanges(scan.Tokens)
	if len(sentences) < 2 {
		return 100.0, []int{100}
	}

	// 2. Map Entities to Sentences
	// map[sentenceIndex] -> Set of EntityIDs
	sentEntities := make([]map[string]bool, len(sentences))
	for i := range sentEntities {
		sentEntities[i] = make(map[string]bool)
	}

	// Populate from ResolvedRefs (includes Pronouns, Names)
	for _, ref := range scan.ResolvedRefs {
		sIdx := a.findSentenceIndex(ref.Range.Start, sentences)
		if sIdx != -1 {
			sentEntities[sIdx][ref.EntityID] = true
		}
	}

	// Populate from Narrative (Subject/Object)
	for _, evt := range scan.Narrative {
		sIdx := a.findSentenceIndex(evt.Range.Start, sentences)
		if sIdx != -1 {
			if evt.Subject != "Unknown" {
				sentEntities[sIdx][evt.Subject] = true
			}
			if evt.Object != "Unknown" {
				sentEntities[sIdx][evt.Object] = true
			}
		}
	}

	// 3. Compute Transition Scores
	var scores []int
	totalScore := 0.0

	// Initial score
	scores = append(scores, 100)
	totalScore += 100

	for i := 1; i < len(sentences); i++ {
		prevSet := sentEntities[i-1]
		currSet := sentEntities[i]

		// Base Friction (Entropy tax)
		score := 70

		// A. Direct Continuity (Shared Entities)
		overlap := 0
		for id := range currSet {
			if prevSet[id] {
				overlap++
			}
		}
		if overlap > 0 {
			score += 30 // Strong link
		}

		// B. Graph Connectivity (Indirect Link)
		// If no direct overlap, check if any current entity is neighbor of any previous entity
		if overlap == 0 {
			connected := false
			for currID := range currSet {
				// Check graph neighbors
				neighbors := a.Graph.Neighbors(currID)
				for _, n := range neighbors {
					if prevSet[n.ID] {
						connected = true
						break
					}
				}
				if connected {
					break
				}
			}

			if connected {
				score += 15 // Weak link
			} else if len(currSet) > 0 && len(prevSet) > 0 {
				// Disconnected jump
				score -= 20
			}
		}

		// Clamp
		if score > 100 {
			score = 100
		}
		if score < 0 {
			score = 0
		}

		// Smoothing (Weighted Moving Average)
		// current = 0.7 * calc + 0.3 * prev_final
		prevFinal := scores[len(scores)-1]
		smoothed := int(0.7*float64(score) + 0.3*float64(prevFinal))

		scores = append(scores, smoothed)
		totalScore += float64(smoothed)
	}

	avg := 0.0
	if len(scores) > 0 {
		avg = totalScore / float64(len(scores))
	}
	return avg, scores
}

type sentRange struct {
	start int
	end   int
}

func (a *Analyzer) identifySentenceRanges(tokens []chunker.Token) []sentRange {
	var ranges []sentRange
	start := 0
	for i, t := range tokens {
		if t.Text == "." || t.Text == "!" || t.Text == "?" {
			ranges = append(ranges, sentRange{
				start: bytesToOffset(tokens, start),
				end:   bytesToOffset(tokens, i) + len(t.Text),
			})
			start = i + 1
		}
	}
	// Tail
	if start < len(tokens) {
		ranges = append(ranges, sentRange{
			start: bytesToOffset(tokens, start),
			end:   bytesToOffset(tokens, len(tokens)-1) + len(tokens[len(tokens)-1].Text),
		})
	}
	return ranges
}

func bytesToOffset(tokens []chunker.Token, idx int) int {
	if idx >= len(tokens) {
		return 0
	}
	return tokens[idx].Range.Start
}

func (a *Analyzer) findSentenceIndex(offset int, sentences []sentRange) int {
	// Binary search or linear (linear fine for <200 sentences)
	for i, s := range sentences {
		if offset >= s.start && offset < s.end {
			return i
		}
	}
	return -1
}
