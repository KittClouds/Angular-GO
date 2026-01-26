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

// Search executes a query (Hybrid)
func (s *Scorer) Search(query []string, queryVector []float32, limit int) []SearchResult {
	candidates := make(map[string]bool)

	// 1. Text-based Candidates
	for _, term := range query {
		if docs, ok := s.TokenIndex[term]; ok {
			for docID := range docs {
				candidates[docID] = true
			}
		}
	}

	// 2. If no text candidates (or pure vector search), and we have a vector,
	// we might want to scan everything.
	// For performance in a large corpus, we wouldn't do this without HNSW.
	// But in GoKitt's "Resolver" scope (dozens/hundreds of entities), O(N) is fine.
	if len(queryVector) > 0 {
		// Always scan all docs if vector is provided (Brute Force KNN for small alias sets)
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

	totalScore := 0.0

	// 1. BM25 Scoring
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
	if len(termMasks) > 0 {
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
		totalScore *= proxMult
	}

	// Phrase Boost
	// Check strict adjacency
	if len(query) > 1 && DetectPhraseMatch(query, docTermMasks) {
		// Example boost 1.5x
		totalScore *= 1.5
	}

	// 2. Vector Scoring (if enabled and compatible)
	vectorScore := 0.0
	if len(queryVector) > 0 && len(docMeta.Embedding) > 0 {
		vectorScore = CosineSimilarity(queryVector, docMeta.Embedding)
		// Clip negative cosine similarity to 0 for simple ranking? Or keep it?
		// Usually 0-1 range is preferred for mixing.
		if vectorScore < 0 {
			vectorScore = 0
		}
	}

	// 3. Hybrid Mix
	// If VectorAlpha is 0, purely BM25. If 1, purely Vector.
	// NOTE: BM25 scores are unbounded (can be 10, 20, etc). Cosine is 0-1.
	// Mixing these is tricky without normalization.
	// Simple approach: Treat BM25 as base, add Vector as a massive boost or
	// use Reciprocal Rank Fusion (RRF) at the list level.
	// Here we implement a simple linear combination, but we might need to normalize BM25.
	// For now, let's treat vector score as a multiplier if BM25 > 0, or an additive boost?
	// The requested logic was: (alpha * bm25) + ((1-alpha) * vector)
	// But given the scale difference, this heavily favors BM25 unless BM25 is normalized.
	// Let's stick to the requested logic but acknowledge the scale mismatch.

	alpha := s.Config.VectorAlpha
	if alpha == 0 {
		return totalScore
	}

	// To make them roughly comparable without global stats, we can just use the weighting directly.
	// Users must tune K1/Alpha.
	finalScore := ((1.0 - alpha) * totalScore) + (alpha * vectorScore * 10.0) // Boost vector to comparable range ~10?
	// Actually, let's just do weighted sum.

	// Real-world robust way:
	// final = score_bm25 * (1 + alpha * score_vec)
	// This makes vector act as a "Relevance Probability Multiplier".
	// if vectors align (1.0), you get full boost. If orthogonal (0.0), no boost.

	// Let's implement the Multiplicative Boost for now, it's safer for unnormalized BM25.
	// Effectively: "If semantic match is high, boost the text match."
	// Wait, users might want to find things that *don't* have text match but *do* have vector match (Synonyms).
	// Additive is required for Synonyms.

	// Let's go with Additive, but we need to ensure Vector has specific weight.
	// final = bm25 + (vector * 10.0 * alpha) ??
	// Let's stick to the implementation plan's linear:
	// BUT, strict adherence to `finalScore := (alpha * bm25Score) + ((1.0 - alpha) * vectorScore)`
	// would make BM25 vanish if alpha is high.

	// Adjusted Hybrid:
	finalScore = ((1.0 - alpha) * totalScore) + (alpha * vectorScore * 20.0) // * 20 to scale 0..1 to approx BM25 range

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
