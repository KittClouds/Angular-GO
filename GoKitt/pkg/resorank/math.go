package resorank

import (
	"math"
	"math/bits"
)

// CalculateIDF computes Inverse Document Frequency
// Formula: ln(1 + (N - df + 0.5) / (df + 0.5))
func CalculateIDF(totalDocs float64, docFreq int) float64 {
	if docFreq == 0 {
		return 0.0
	}
	df := float64(docFreq)
	ratio := (totalDocs - df + 0.5) / (df + 0.5)
	if ratio < 0 {
		ratio = 0
	}
	return math.Log(1.0 + ratio)
}

// NormalizedTermFrequency computes TF with standard BM25 length normalization
func NormalizedTermFrequency(tf int, fieldLen int, avgFieldLen float64, b float64) float64 {
	return NormalizedTermFrequencyBMX(tf, fieldLen, avgFieldLen, b, 0.0, 0.0)
}

// NormalizedTermFrequencyBMX computes TF with length normalization and entropy
func NormalizedTermFrequencyBMX(tf int, fieldLen int, avgFieldLen float64, b float64, avgEntropy float64, gamma float64) float64 {
	if avgFieldLen <= 0 || tf == 0 {
		return 0.0
	}
	fTF := float64(tf)
	fLen := float64(fieldLen)

	denom := 1.0 - b + b*(fLen/avgFieldLen) + gamma*avgEntropy
	if denom <= 0 {
		return 0 // avoid div by zero or negative logic
	}
	return fTF / denom
}

// Saturate applies BM25 saturation
// Formula: ((k1 + 1) * score) / (k1 + score)
func Saturate(score float64, k1 float64) float64 {
	if score <= 0 {
		return 0.0
	}
	if k1 <= 0 {
		return score
	}
	return ((k1 + 1.0) * score) / (k1 + score)
}

// PopCount counts set bits in a 32-bit integer
func PopCount(n uint32) int {
	return bits.OnesCount32(n)
}

// AdaptiveSegmentCount clamps segments between 8 and 32 based on document length
func AdaptiveSegmentCount(docLen int, tokensPerSeg int) uint32 {
	if tokensPerSeg <= 0 {
		tokensPerSeg = 50 // default
	}
	raw := math.Ceil(float64(docLen) / float64(tokensPerSeg))
	k := int(raw)
	if k < 8 {
		return 8
	}
	if k > 32 {
		return 32
	}
	return uint32(k)
}

// Sigmoid function
func Sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x))
}
