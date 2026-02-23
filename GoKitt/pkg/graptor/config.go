package graptor

import (
	"math"
)

// DocumentSizeEstimate provides estimates for pre-allocation based on document size.
// These estimates are based on empirical analysis of typical documents.
type DocumentSizeEstimate struct {
	DocumentLength   int
	ExpectedEntities int
	ExpectedChapters int
	ExpectedMentions int
	ExpectedPairs    int
}

// EstimateFromDocumentSize calculates pre-allocation hints based on document length.
// This helps reduce map rehashing and slice growth during processing.
func EstimateFromDocumentSize(docLength int) *DocumentSizeEstimate {
	// Baseline: 100K character document
	// Typical: ~100 entities, ~10 chapters, ~1000 mentions, ~400 pairs
	const baselineLength = 100000
	const baselineEntities = 100
	const baselineChapters = 10
	const baselineMentions = 1000
	const baselinePairs = 400

	// Calculate scale factor (logarithmic to avoid over-allocation for huge docs)
	scaleFactor := math.Log(float64(docLength)/float64(baselineLength) + 1)

	// Apply scaling with caps
	est := &DocumentSizeEstimate{
		DocumentLength:   docLength,
		ExpectedEntities: min(int(float64(baselineEntities)*scaleFactor*1.5), 10000),
		ExpectedChapters: min(int(float64(baselineChapters)*scaleFactor*1.2), 500),
		ExpectedMentions: min(int(float64(baselineMentions)*scaleFactor*2), 100000),
		ExpectedPairs:    min(int(float64(baselinePairs)*scaleFactor*2), 50000),
	}

	// Ensure minimum values
	if est.ExpectedEntities < 16 {
		est.ExpectedEntities = 16
	}
	if est.ExpectedChapters < 4 {
		est.ExpectedChapters = 4
	}
	if est.ExpectedMentions < 64 {
		est.ExpectedMentions = 64
	}
	if est.ExpectedPairs < 32 {
		est.ExpectedPairs = 32
	}

	return est
}

// RegistryConfigFromEstimate creates a RegistryConfig from a DocumentSizeEstimate.
func RegistryConfigFromEstimate(est *DocumentSizeEstimate) *RegistryConfig {
	return &RegistryConfig{
		MaxHistory:       100,
		CarryOverSize:    10,
		Normalizer:       CanonicalizeForMatch,
		ExpectedEntities: est.ExpectedEntities,
		ExpectedChapters: est.ExpectedChapters,
		ExpectedMentions: est.ExpectedMentions,
		MaxMentions:      0, // unlimited by default
	}
}

// CooccurrenceConfigFromEstimate creates a CooccurrenceConfig from a DocumentSizeEstimate.
func CooccurrenceConfigFromEstimate(est *DocumentSizeEstimate) *CooccurrenceConfig {
	return &CooccurrenceConfig{
		WindowSize:        3,
		ExpectedPairs:     est.ExpectedPairs,
		MinThreshold:      1,  // Track all pairs by default
		MaxPairsPerEntity: 50, // Limit pairs per entity
	}
}

// CooccurrenceConfig holds configuration for co-occurrence tracking.
type CooccurrenceConfig struct {
	WindowSize        int
	ExpectedPairs     int
	MinThreshold      int // Only track pairs with count >= threshold
	MaxPairsPerEntity int // Maximum pairs to track per entity
}

// DefaultCooccurrenceConfig returns default configuration.
func DefaultCooccurrenceConfig() *CooccurrenceConfig {
	return &CooccurrenceConfig{
		WindowSize:        3,
		ExpectedPairs:     256,
		MinThreshold:      1,
		MaxPairsPerEntity: 50,
	}
}

// min returns the minimum of two integers.
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// NewGlobalEntityRegistryWithEstimate creates a new registry with pre-allocation based on document size.
// This is a convenience function that combines EstimateFromDocumentSize and NewGlobalEntityRegistry.
func NewGlobalEntityRegistryWithEstimate(documentLength int) *GlobalEntityRegistry {
	est := EstimateFromDocumentSize(documentLength)
	config := RegistryConfigFromEstimate(est)
	return NewGlobalEntityRegistry(config)
}

// NewCooccurrenceStatsWithEstimate creates a new co-occurrence tracker with pre-allocation based on document size.
// This is a convenience function that combines EstimateFromDocumentSize and NewCooccurrenceStatsWithConfig.
func NewCooccurrenceStatsWithEstimate(documentLength int) *CooccurrenceStats {
	est := EstimateFromDocumentSize(documentLength)
	config := CooccurrenceConfigFromEstimate(est)
	return NewCooccurrenceStatsWithConfig(config)
}
