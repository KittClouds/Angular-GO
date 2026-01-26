package resorank

import (
	"sort"
)

// Scorer is the main engine
type Scorer struct {
	Config      ResoRankConfig
	CorpusStats CorpusStatistics

	// Indexes
	DocumentIndex map[string]DocumentMetadata         `json:"documentIndex"`
	TokenIndex    map[string]map[string]TokenMetadata `json:"tokenIndex"` // term -> docID -> meta

	// Caches
	IDFCache map[int]float64
}

// NewScorer creates a new scorer
func NewScorer(config ResoRankConfig) *Scorer {
	return &Scorer{
		Config:        config,
		CorpusStats:   CorpusStatistics{AverageFieldLengths: make(map[string]float64)},
		DocumentIndex: make(map[string]DocumentMetadata),
		TokenIndex:    make(map[string]map[string]TokenMetadata),
		IDFCache:      make(map[int]float64),
	}
}

// IndexDocument adds a document
func (s *Scorer) IndexDocument(docID string, meta DocumentMetadata, tokens map[string]TokenMetadata) {
	// Add Doc
	s.DocumentIndex[docID] = meta

	// Add Tokens
	for term, tMeta := range tokens {
		if s.TokenIndex[term] == nil {
			s.TokenIndex[term] = make(map[string]TokenMetadata)
		}

		// Remap segments if adaptive
		if s.Config.UseAdaptiveSegments {
			effective := AdaptiveSegmentCount(meta.TotalTokenCount, 50)
			tMeta.SegmentMask = remapSegmentMask(tMeta.SegmentMask, s.Config.MaxSegments, effective)
		}

		s.TokenIndex[term][docID] = tMeta
	}

	// Invalidate caches? Or update stats incrementally?
	// For MVP batch update is assumed or manual 'UpdateStats'.
	// Rust updated CorpusStats externally/passed them in.
	// We'll update simple count:
	s.CorpusStats.TotalDocuments++
	// Avg length update omitted for brevity, should be recalculated globally
}

// Search executes a query
func (s *Scorer) Search(query []string, limit int) []SearchResult {
	// Find candidates (docs containing at least one term)
	candidates := make(map[string]bool)
	for _, term := range query {
		if docs, ok := s.TokenIndex[term]; ok {
			for docID := range docs {
				candidates[docID] = true
			}
		}
	}

	var results []SearchResult
	for docID := range candidates {
		score := s.Score(query, docID)
		if score > 0 {
			results = append(results, SearchResult{DocID: docID, Score: score})
		}
	}

	// Sort DESC
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}
	return results
}

// Score calculates relevance for a doc
func (s *Scorer) Score(query []string, docID string) float64 {
	docMeta, ok := s.DocumentIndex[docID]
	if !ok {
		return 0.0
	}

	totalScore := 0.0

	// Accumulators for Proximity
	var termMasks []uint32
	var termIDFs []float64
	docTermMasks := make(map[string]uint32)

	for _, term := range query {
		tMeta, ok := s.TokenIndex[term][docID]
		if !ok {
			// Term not in doc, minimal contribution or skip
			continue
		}

		// Calculate IDF
		idf := s.getIDF(tMeta.CorpusDocFreq)

		// Calculate BM25F for this term
		termScore := s.scoreTermBM25F(tMeta, idf)

		totalScore += termScore

		// Proximity data
		termMasks = append(termMasks, tMeta.SegmentMask)
		termIDFs = append(termIDFs, idf)
		docTermMasks[term] = tMeta.SegmentMask
	}

	// Apply Proximity Boost
	// Using IDF Weighted Strategy default
	termData := make([]TermWithIDF, len(termMasks))
	for i := range termMasks {
		termData[i] = TermWithIDF{termMasks[i], termIDFs[i]}
	}

	proxMult := IDFWeightedProximityMultiplier(
		termData,
		s.Config.ProximityAlpha,
		s.Config.MaxSegments,
		docMeta.TotalTokenCount,
		s.CorpusStats.AverageDocLength,
		s.Config.ProximityDecay,
		5.0, // IDF scale default
	)

	finalScore := totalScore * proxMult

	// Phrase Boost
	// Check strict adjacency
	if DetectPhraseMatch(query, docTermMasks) {
		// Example boost 1.5x
		finalScore *= 1.5
	}

	return finalScore
}

func (s *Scorer) scoreTermBM25F(meta TokenMetadata, idf float64) float64 {
	weightedFreq := 0.0

	for field, data := range meta.FieldOccurrences {
		// Get field params (b, weight)
		weight := 1.0
		b := s.Config.B
		if p, ok := s.Config.FieldParams[field]; ok {
			weight = p.Weight
			b = p.B
		} else if w, ok := s.Config.FieldWeights[field]; ok {
			weight = w // fallback if only weights provided
		}

		avgLen := s.CorpusStats.AverageFieldLengths[field]
		if avgLen == 0 {
			avgLen = 100.0
		} // default?

		// Calculate normalized TF
		// BMX Entropy omitted (0.0)
		ntf := NormalizedTermFrequency(data.TF, data.FieldLength, avgLen, b)

		weightedFreq += weight * ntf
	}

	// Saturation
	return idf * Saturate(weightedFreq, s.Config.K1)
}

func (s *Scorer) getIDF(freq int) float64 {
	if v, ok := s.IDFCache[freq]; ok {
		return v
	}
	val := CalculateIDF(float64(s.CorpusStats.TotalDocuments), freq)
	s.IDFCache[freq] = val
	return val
}

// remapSegmentMask maps bits from one granularity to another
func remapSegmentMask(mask uint32, fromSegs uint32, toSegs uint32) uint32 {
	if fromSegs == toSegs || fromSegs == 0 {
		return mask
	}
	newMask := uint32(0)
	for i := uint32(0); i < fromSegs; i++ {
		if (mask & (1 << i)) != 0 {
			// Project bit i to new scale
			ratio := float64(i) / float64(fromSegs)
			mappedBit := uint32(ratio * float64(toSegs))
			if mappedBit < 32 {
				newMask |= (1 << mappedBit)
			}
		}
	}
	return newMask
}
