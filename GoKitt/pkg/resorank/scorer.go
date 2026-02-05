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
	TokenIndex    map[string]map[string]TokenMetadata `json:"tokenIndex"` // term -> docID -> meta (mutable overlay)
	FrozenIndex   *FSTIndex                           `json:"-"`          // Immutable FST-backed base layer

	// Caches
	IDFCache     map[int]float64
	EntropyCache *EntropyCache

	// Pre-computed BMX parameters
	CachedAlpha *float64
	CachedBeta  *float64
	CachedGamma *float64
}

// NewScorer creates a new scorer
func NewScorer(config ResoRankConfig) *Scorer {
	s := &Scorer{
		Config:        config,
		CorpusStats:   CorpusStatistics{AverageFieldLengths: make(map[string]float64)},
		DocumentIndex: make(map[string]DocumentMetadata),
		TokenIndex:    make(map[string]map[string]TokenMetadata),
		IDFCache:      make(map[int]float64),
		EntropyCache:  NewEntropyCache(1000),
	}
	return s
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

	// Update basic stats
	s.CorpusStats.TotalDocuments++
}

// Search executes a query (Hybrid)
func (s *Scorer) Search(query []string, queryVector []float32, limit int) []SearchResult {
	candidates := make(map[string]bool)

	// 1. Text-based Candidates (from both frozen and mutable indexes)
	for _, term := range query {
		for docID := range s.getTermPostings(term) {
			candidates[docID] = true
		}
	}

	// 2. Vector Candidates (Brute force for now)
	if len(queryVector) > 0 {
		for docID := range s.DocumentIndex {
			candidates[docID] = true
		}
	}

	var results []SearchResult
	for docID := range candidates {
		score := s.Score(query, queryVector, docID)
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

// Score calculates relevance for a doc (Hybrid: BM25 + Vector)
func (s *Scorer) Score(query []string, queryVector []float32, docID string) float64 {
	docMeta, ok := s.DocumentIndex[docID]
	if !ok {
		return 0.0
	}

	// 0. Pre-calc BMX parameters
	alpha := s.Config.K1
	if s.Config.UseAdaptiveAlpha {
		alpha = CalculateAdaptiveAlpha(s.CorpusStats.AverageDocLength)
	}

	// 1. Entropy Stats (if needed)
	var entropyStats QueryEntropyStats
	hasEntropy := s.Config.EnableBMXEntropy || s.Config.EnableBMXSimilarity
	if hasEntropy {
		entropyStats = CalculateQueryEntropyStats(query, s.EntropyCache, s.TokenIndex)
	}

	gamma := 0.0
	if s.Config.EnableBMXEntropy {
		if s.Config.EntropyDenomWeight != nil {
			gamma = *s.Config.EntropyDenomWeight
		} else {
			gamma = alpha / 2.0
		}
	}

	totalScore := 0.0
	var termMasks []uint32
	var termIDFs []float64
	docTermMasks := make(map[string]uint32)

	// 2. Score Terms
	for _, term := range query {
		postings := s.getTermPostings(term)
		tMeta, ok := postings[docID]
		if !ok {
			continue
		}

		idf := s.getIDF(tMeta.CorpusDocFreq)
		termScore := s.scoreTermBMX(tMeta, idf, alpha, gamma, entropyStats.AvgEntropy)

		// Per-Term Proximity (applied immediately)
		if s.Config.ProximityStrategy == "per-term" && termScore > 0 {
			prox := PerTermProximityMultiplier(tMeta.SegmentMask, termMasks, s.Config.ProximityAlpha, s.Config.MaxSegments)
			totalScore += termScore * prox
		} else {
			totalScore += termScore
		}

		termMasks = append(termMasks, tMeta.SegmentMask)
		termIDFs = append(termIDFs, idf)
		docTermMasks[term] = tMeta.SegmentMask
	}

	// 3. Proximity Multipliers (Global / Pairwise / IdfWeighted)
	// Only apply if NOT per-term (already applied)
	if len(termMasks) > 0 && s.Config.ProximityStrategy != "per-term" {
		proxMult := 1.0
		switch s.Config.ProximityStrategy {
		case "global":
			proxMult = GlobalProximityMultiplier(termMasks, s.Config.ProximityAlpha, s.Config.MaxSegments, docMeta.TotalTokenCount, s.CorpusStats.AverageDocLength, s.Config.ProximityDecay)
		case "pairwise":
			bonus := PairwiseProximityBonus(termMasks, s.Config.ProximityAlpha, s.Config.MaxSegments)
			proxMult = 1.0 + bonus
		case "idf-weighted":
			fallthrough
		default:
			scale := s.Config.IDFProximityScale
			if scale == 0 {
				scale = 5.0
			}

			termData := make([]TermWithIDF, len(termMasks))
			for i := range termMasks {
				termData[i] = TermWithIDF{Mask: termMasks[i], IDF: termIDFs[i]}
			}
			proxMult = IDFWeightedProximityMultiplier(termData, s.Config.ProximityAlpha, s.Config.MaxSegments, docMeta.TotalTokenCount, s.CorpusStats.AverageDocLength, s.Config.ProximityDecay, scale)
		}
		totalScore *= proxMult
	}

	// 4. Phrase Boost
	if s.Config.EnablePhraseBoost && len(query) > 1 && DetectPhraseMatch(query, docTermMasks) {
		totalScore *= s.Config.PhraseBoostMultiplier
	}

	// 5. Similarity Boost (BMX)
	if s.Config.EnableBMXSimilarity && hasEntropy {
		beta := CalculateBeta(s.CorpusStats.TotalDocuments)
		commonCount := 0
		for _, t := range query {
			if _, ok := docTermMasks[t]; ok {
				commonCount++
			}
		}
		sim := 0.0
		if len(query) > 0 {
			sim = float64(commonCount) / float64(len(query))
		}
		boost := beta * sim * entropyStats.SumNormalizedEntropies
		totalScore += boost
	}

	// 6. Vector Scoring
	vectorScore := 0.0
	if len(queryVector) > 0 && len(docMeta.Embedding) > 0 {
		vectorScore = CosineSimilarity(queryVector, docMeta.Embedding)
		if vectorScore < 0 {
			vectorScore = 0
		}
	}

	// 7. Hybrid Mix
	alphaVec := s.Config.VectorAlpha
	finalScore := ((1.0 - alphaVec) * totalScore) + (alphaVec * vectorScore * 20.0)

	return finalScore
}

func (s *Scorer) scoreTermBMX(meta TokenMetadata, idf float64, alpha float64, gamma float64, avgEntropy float64) float64 {
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
		}

		ntf := NormalizedTermFrequencyBMX(data.TF, data.FieldLength, avgLen, b, avgEntropy, gamma)
		weightedFreq += weight * ntf
	}

	// Use alpha as k1 (adaptive or static)
	return idf * Saturate(weightedFreq, alpha)
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

// getTermPostings returns postings for a term, merging frozen and mutable indexes
// Mutable overlay takes precedence (for updates)
func (s *Scorer) getTermPostings(term string) map[string]TokenMetadata {
	result := make(map[string]TokenMetadata)

	// First, load from frozen index if available
	if s.FrozenIndex != nil {
		if frozen, ok := s.FrozenIndex.Get(term); ok {
			for docID, meta := range frozen {
				result[docID] = meta
			}
		}
	}

	// Then overlay mutable index (overwrites frozen entries)
	if mutable, ok := s.TokenIndex[term]; ok {
		for docID, meta := range mutable {
			result[docID] = meta
		}
	}

	return result
}

// Compact freezes the current mutable TokenIndex into the FrozenIndex
// This significantly reduces memory usage for large indexes
func (s *Scorer) Compact() error {
	if len(s.TokenIndex) == 0 {
		return nil // Nothing to compact
	}

	// Build new FST index from mutable data
	newFrozen, err := BuildFSTIndex(s.TokenIndex)
	if err != nil {
		return err
	}

	// Close old frozen index if exists
	if s.FrozenIndex != nil {
		s.FrozenIndex.Close()
	}

	// Swap
	s.FrozenIndex = newFrozen
	s.TokenIndex = make(map[string]map[string]TokenMetadata) // Clear mutable

	return nil
}
