package resorank

import (
	"math"
)

// EntropyCache implements LRU cache for term entropy
type EntropyCache struct {
	cache       map[string]float64
	accessOrder []string
	maxSize     int
}

// NewEntropyCache creates a new cache
func NewEntropyCache(maxSize int) *EntropyCache {
	return &EntropyCache{
		cache:       make(map[string]float64, maxSize),
		accessOrder: make([]string, 0, maxSize),
		maxSize:     maxSize,
	}
}

// Get retrieves or computes probability-based entropy for a term
// TokenIndex signature matches Scorer.TokenIndex: map[term]map[docID]TokenMetadata
func (c *EntropyCache) Get(term string, tokenIndex map[string]map[string]TokenMetadata) float64 {
	// Cache Hit
	if val, ok := c.cache[term]; ok {
		c.markAccessed(term)
		return val
	}

	// Cache Miss
	entropy := c.computeEntropy(term, tokenIndex)
	c.set(term, entropy)
	return entropy
}

// Has checks existence
func (c *EntropyCache) Has(term string) bool {
	_, ok := c.cache[term]
	return ok
}

// Clear wipes the cache
func (c *EntropyCache) Clear() {
	c.cache = make(map[string]float64, c.maxSize)
	c.accessOrder = c.accessOrder[:0]
}

// Internal: Set with LRU eviction
func (c *EntropyCache) set(term string, val float64) {
	if len(c.cache) >= c.maxSize {
		// Evict LRU (first in list)
		if len(c.accessOrder) > 0 {
			evict := c.accessOrder[0]
			delete(c.cache, evict)
			c.accessOrder = c.accessOrder[1:]
		}
	}
	c.cache[term] = val
	c.accessOrder = append(c.accessOrder, term)
}

// Internal: Move to back
func (c *EntropyCache) markAccessed(term string) {
	for i, t := range c.accessOrder {
		if t == term {
			// Remove
			c.accessOrder = append(c.accessOrder[:i], c.accessOrder[i+1:]...)
			break
		}
	}
	c.accessOrder = append(c.accessOrder, term)
}

// Internal: Compute entropy (BMX Eq 5)
func (c *EntropyCache) computeEntropy(term string, tokenIndex map[string]map[string]TokenMetadata) float64 {
	docs, ok := tokenIndex[term]
	if !ok {
		return 0.0
	}

	rawEntropy := 0.0

	for _, meta := range docs {
		// Sum TF across all fields
		totalTF := 0
		for _, occ := range meta.FieldOccurrences {
			totalTF += occ.TF
		}

		// Cap TF (optimization matching TS/Rust)
		cappedTF := float64(totalTF)
		if cappedTF > 10.0 {
			cappedTF = 10.0
		}

		// Compute probability pj using sigmoid
		pj := Sigmoid(cappedTF)

		// Accumulate entropy: - sum (pj * ln(pj))
		// Guards for boundary conditions
		if pj > 1e-6 && pj < 0.999999 {
			rawEntropy -= pj * math.Log(pj)
		}
	}

	return rawEntropy
}

// QueryEntropyStats holds aggregate stats for a query
type QueryEntropyStats struct {
	NormalizedEntropies    map[string]float64
	AvgEntropy             float64
	SumNormalizedEntropies float64
	MaxRawEntropy          float64
}

// CalculateQueryEntropyStats computes stats for BMX scoring
func CalculateQueryEntropyStats(query []string, cache *EntropyCache, tokenIndex map[string]map[string]TokenMetadata) QueryEntropyStats {
	stats := QueryEntropyStats{
		NormalizedEntropies: make(map[string]float64),
	}

	// 1. Find Max Raw Entropy
	maxRaw := 0.0
	for _, term := range query {
		val := cache.Get(term, tokenIndex)
		if val > maxRaw {
			maxRaw = val
		}
	}
	stats.MaxRawEntropy = maxRaw

	// Avoid div by zero
	normFactor := maxRaw
	if normFactor < 1e-9 {
		normFactor = 1e-9
	}

	// 2. Normalize
	sumNorm := 0.0
	for _, term := range query {
		raw := cache.Get(term, tokenIndex) // cached
		norm := raw / normFactor
		stats.NormalizedEntropies[term] = norm
		sumNorm += norm
	}
	stats.SumNormalizedEntropies = sumNorm

	// 3. Average
	if len(query) > 0 {
		stats.AvgEntropy = sumNorm / float64(len(query))
	}

	return stats
}
