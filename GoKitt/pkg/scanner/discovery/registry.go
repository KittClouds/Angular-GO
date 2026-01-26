package discovery

import (
	"strings"

	"github.com/kittclouds/gokitt/pkg/dafsa"
)

// CandidateStatus tracks the lifecycle of a discovery candidate
type CandidateStatus int

const (
	StatusWatching CandidateStatus = iota
	StatusPromoted
	StatusIgnored
)

// CandidateStats tracks info about a potential entity
type CandidateStats struct {
	Count        int
	Status       CandidateStatus
	InferredKind *dafsa.EntityKind // Pointer to allow nil (unknown)
	Display      string            // Best display form seen
}

// CandidateRegistry tracks potential new entities
type CandidateRegistry struct {
	Stats              map[CanonicalToken]*CandidateStats
	PromotionThreshold int
	StopWords          map[string]bool

	// Simplify graph for now: just track co-occurrence counts?
	// Or just ignore for MVP.
}

// NewRegistry creates a new registry
func NewRegistry(threshold int) *CandidateRegistry {
	r := &CandidateRegistry{
		Stats:              make(map[CanonicalToken]*CandidateStats),
		PromotionThreshold: threshold,
		StopWords:          make(map[string]bool),
	}

	// Load base stopwords
	for w := range dafsa.StopWords {
		r.StopWords[w] = true
	}

	return r
}

// AddStopWord adds a custom ignored word
func (r *CandidateRegistry) AddStopWord(word string) {
	r.StopWords[strings.ToLower(word)] = true
}

// AddToken processes a token. Returns true if promoted this time.
func (r *CandidateRegistry) AddToken(raw string) bool {
	key, display, valid := Canonicalize(raw)
	if !valid {
		return false
	}

	// 1. Check stopwords
	if r.StopWords[string(key)] {
		return false
	}

	// 2. Get/Create stats
	stats, exists := r.Stats[key]
	if !exists {
		stats = &CandidateStats{
			Count:   0,
			Status:  StatusWatching,
			Display: display,
		}
		r.Stats[key] = stats
	}

	// If already ignored/promoted, just increment
	if stats.Status != StatusWatching {
		stats.Count++
		return false
	}

	stats.Count++

	// 3. Check threshold
	if stats.Count >= r.PromotionThreshold {
		stats.Status = StatusPromoted
		return true
	}

	return false
}

// GetStatus returns the status of a token
func (r *CandidateRegistry) GetStatus(raw string) CandidateStatus {
	key, _, valid := Canonicalize(raw)
	if !valid {
		return StatusIgnored
	}
	if s, ok := r.Stats[key]; ok {
		return s.Status
	}
	return StatusWatching // Default (conceptually unknown)
}

// ProposeInference updates the inferred kind
func (r *CandidateRegistry) ProposeInference(raw string, kind dafsa.EntityKind) {
	key, _, valid := Canonicalize(raw)
	if !valid {
		return
	}

	if stats, ok := r.Stats[key]; ok {
		// Only set if currently unknown (nil)
		if stats.InferredKind == nil {
			k := kind // copy value to heap
			stats.InferredKind = &k
		}
	}
}

// GetStats helper
func (r *CandidateRegistry) GetStats(raw string) *CandidateStats {
	key, _, _ := Canonicalize(raw)
	return r.Stats[key]
}
