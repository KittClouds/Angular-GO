package resorank

import (
	"math"
)

// TermWithIDF helper for proximity
type TermWithIDF struct {
	Mask uint32
	IDF  float64
}

// GlobalProximityMultiplier computes overlap boost ignoring IDF
func GlobalProximityMultiplier(masks []uint32, alpha float64, maxSegs uint32, docLen int, avgDocLen float64, decayLambda float64) float64 {
	if len(masks) < 2 || maxSegs == 0 {
		return 1.0
	}

	// AND all masks
	common := masks[0]
	for i := 1; i < len(masks); i++ {
		common &= masks[i]
	}

	overlapCount := PopCount(common)
	maxPossible := uint32(len(masks))
	if maxPossible > maxSegs {
		maxPossible = maxSegs
	}

	baseMult := float64(overlapCount) / float64(maxPossible)

	lenRatio := 1.0
	if avgDocLen > 0 {
		lenRatio = float64(docLen) / avgDocLen
	}
	decay := math.Exp(-decayLambda * lenRatio)

	return 1.0 + alpha*baseMult*decay
}

// IDFWeightedProximityMultiplier computes overlap boost weighted by IDF (rarer terms matter more)
func IDFWeightedProximityMultiplier(termData []TermWithIDF, alpha float64, maxSegs uint32, docLen int, avgDocLen float64, decayLambda float64, idfScale float64) float64 {
	if len(termData) < 2 || maxSegs == 0 {
		return 1.0
	}

	// Average IDF
	totalIDF := 0.0
	common := termData[0].Mask
	for _, t := range termData {
		totalIDF += t.IDF
		common &= t.Mask
	}
	avgIDF := totalIDF / float64(len(termData))

	overlapCount := PopCount(common)
	maxPossible := uint32(len(termData))
	if maxPossible > maxSegs {
		maxPossible = maxSegs
	}

	baseMult := float64(overlapCount) / float64(maxPossible)
	idfBoost := 1.0 + avgIDF/idfScale

	lenRatio := 1.0
	if avgDocLen > 0 {
		lenRatio = float64(docLen) / avgDocLen
	}
	decay := math.Exp(-decayLambda * lenRatio)

	return 1.0 + alpha*baseMult*idfBoost*decay
}

// DetectPhraseMatch checks if terms appear in adjacent segments in strict order
func DetectPhraseMatch(queryTerms []string, docMasks map[string]uint32) bool {
	if len(queryTerms) < 2 {
		return false
	}

	for i := 0; i < len(queryTerms)-1; i++ {
		m1, ok1 := docMasks[queryTerms[i]]
		m2, ok2 := docMasks[queryTerms[i+1]]

		if !ok1 || !ok2 {
			return false
		}

		// Shift m1 left (0001 -> 0010). If m2 has bit at 0010, they are adjacent.
		// Note: Segment 0 is LSB. Segment 1 is bit 1.
		// If term1 is at Seg 0, mask=1.
		// If term2 is at Seg 1, mask=2.
		// (1 << 1) & 2 = 2 & 2 = 2 != 0. Match.
		adjacent := (m1 << 1) & m2
		if adjacent == 0 {
			return false
		}
	}
	return true
}
