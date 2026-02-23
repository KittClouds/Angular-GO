package graptor

import (
	"sort"
	"sync"
)

// CooccurrenceStats tracks how often entities appear together.
// This is used for relationship inference - entities that frequently
// co-occur are likely to be related.
type CooccurrenceStats struct {
	mu sync.RWMutex

	// pairCounts maps "entity1|entity2" -> count
	// Always stored with entity1 < entity2 lexicographically for consistency
	pairCounts map[string]int

	// entityPairs maps entityID -> set of co-occurring entity IDs
	entityPairs map[string]map[string]bool

	// windowSize is the number of sentences to consider as a co-occurrence window
	windowSize int

	// chapterWindows tracks co-occurrences per chapter
	chapterWindows map[uint32][]string // chapterID -> entity IDs in window
}

// NewCooccurrenceStats creates a new co-occurrence tracker.
func NewCooccurrenceStats(windowSize int) *CooccurrenceStats {
	if windowSize <= 0 {
		windowSize = 3 // Default: 3 sentences
	}
	return &CooccurrenceStats{
		pairCounts:     make(map[string]int),
		entityPairs:    make(map[string]map[string]bool),
		windowSize:     windowSize,
		chapterWindows: make(map[uint32][]string),
	}
}

// NewCooccurrenceStatsWithConfig creates a new co-occurrence tracker with configuration.
func NewCooccurrenceStatsWithConfig(config *CooccurrenceConfig) *CooccurrenceStats {
	if config == nil {
		config = DefaultCooccurrenceConfig()
	}
	return &CooccurrenceStats{
		pairCounts:     make(map[string]int, config.ExpectedPairs),
		entityPairs:    make(map[string]map[string]bool, config.ExpectedPairs/4),
		windowSize:     config.WindowSize,
		chapterWindows: make(map[uint32][]string),
	}
}

// RecordCooccurrence records that a set of entities appeared together.
// This should be called per-sentence or per-paragraph.
func (cs *CooccurrenceStats) RecordCooccurrence(entityIDs []string, chapterID uint32) {
	if len(entityIDs) < 2 {
		return
	}

	cs.mu.Lock()
	defer cs.mu.Unlock()

	// Record all pairs
	for i, e1 := range entityIDs {
		for _, e2 := range entityIDs[i+1:] {
			cs.recordPair(e1, e2)
		}

		// Track entity's co-occurring partners
		if cs.entityPairs[e1] == nil {
			cs.entityPairs[e1] = make(map[string]bool)
		}
		for _, e2 := range entityIDs[i+1:] {
			cs.entityPairs[e1][e2] = true
			if cs.entityPairs[e2] == nil {
				cs.entityPairs[e2] = make(map[string]bool)
			}
			cs.entityPairs[e2][e1] = true
		}
	}

	// Track chapter window
	cs.chapterWindows[chapterID] = append(cs.chapterWindows[chapterID], entityIDs...)
}

// recordPair records a single pair (must be called with lock held).
func (cs *CooccurrenceStats) recordPair(e1, e2 string) {
	key := cooccurrenceKey(e1, e2)
	cs.pairCounts[key]++
}

// cooccurrenceKey creates a consistent key for an entity pair.
// Always stores with lexicographically smaller ID first.
// Note: Simple concatenation is faster than pooled StringBuilder for small strings.
func cooccurrenceKey(e1, e2 string) string {
	if e1 > e2 {
		e1, e2 = e2, e1
	}
	return e1 + "|" + e2
}

// parseCooccurrenceKey parses a co-occurrence key back into entity IDs.
func parseCooccurrenceKey(key string) (e1, e2 string) {
	for i := 0; i < len(key); i++ {
		if key[i] == '|' {
			return key[:i], key[i+1:]
		}
	}
	return key, ""
}

// GetCount returns the co-occurrence count for a pair of entities.
func (cs *CooccurrenceStats) GetCount(e1, e2 string) int {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	key := cooccurrenceKey(e1, e2)
	return cs.pairCounts[key]
}

// GetRelated returns entities that co-occur with the given entity,
// sorted by co-occurrence count (descending).
func (cs *CooccurrenceStats) GetRelated(entityID string, minCount int) []RelatedEntity {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	partners := cs.entityPairs[entityID]
	if len(partners) == 0 {
		return nil
	}

	var related []RelatedEntity
	for partner := range partners {
		count := cs.pairCounts[cooccurrenceKey(entityID, partner)]
		if count >= minCount {
			related = append(related, RelatedEntity{
				EntityID: partner,
				Count:    count,
			})
		}
	}

	// Sort by count descending
	sort.Slice(related, func(i, j int) bool {
		return related[i].Count > related[j].Count
	})

	return related
}

// RelatedEntity represents an entity related by co-occurrence.
type RelatedEntity struct {
	EntityID string
	Count    int
}

// GetAllPairs returns all co-occurrence pairs with their counts.
func (cs *CooccurrenceStats) GetAllPairs(minCount int) []CooccurrencePair {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	var pairs []CooccurrencePair
	for key, count := range cs.pairCounts {
		if count >= minCount {
			e1, e2 := parseCooccurrenceKey(key)
			pairs = append(pairs, CooccurrencePair{
				Entity1ID: e1,
				Entity2ID: e2,
				Count:     count,
			})
		}
	}

	// Sort by count descending
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].Count > pairs[j].Count
	})

	return pairs
}

// CooccurrencePair represents a co-occurrence relationship between two entities.
type CooccurrencePair struct {
	Entity1ID string
	Entity2ID string
	Count     int
}

// GetTopPairs returns the top N co-occurring pairs.
func (cs *CooccurrenceStats) GetTopPairs(n int) []CooccurrencePair {
	all := cs.GetAllPairs(1)
	if len(all) <= n {
		return all
	}
	return all[:n]
}

// GetChapterCooccurrences returns all entities that co-occurred in a chapter.
func (cs *CooccurrenceStats) GetChapterCooccurrences(chapterID uint32) []string {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	return cs.chapterWindows[chapterID]
}

// Stats returns summary statistics about co-occurrences.
func (cs *CooccurrenceStats) Stats() CooccurrenceStatsSummary {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	totalPairs := len(cs.pairCounts)
	totalOccurrences := 0
	maxCount := 0

	for _, count := range cs.pairCounts {
		totalOccurrences += count
		if count > maxCount {
			maxCount = count
		}
	}

	return CooccurrenceStatsSummary{
		TotalPairs:       totalPairs,
		TotalOccurrences: totalOccurrences,
		MaxCount:         maxCount,
		TotalEntities:    len(cs.entityPairs),
	}
}

// CooccurrenceStatsSummary contains summary statistics.
type CooccurrenceStatsSummary struct {
	TotalPairs       int
	TotalOccurrences int
	MaxCount         int
	TotalEntities    int
}

// Clear resets all co-occurrence data.
func (cs *CooccurrenceStats) Clear() {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	cs.pairCounts = make(map[string]int)
	cs.entityPairs = make(map[string]map[string]bool)
	cs.chapterWindows = make(map[uint32][]string)
}

// Merge combines another CooccurrenceStats into this one.
func (cs *CooccurrenceStats) Merge(other *CooccurrenceStats) {
	if other == nil {
		return
	}

	other.mu.RLock()
	defer other.mu.RUnlock()

	cs.mu.Lock()
	defer cs.mu.Unlock()

	// Merge pair counts
	for key, count := range other.pairCounts {
		cs.pairCounts[key] += count
	}

	// Merge entity pairs
	for entity, partners := range other.entityPairs {
		if cs.entityPairs[entity] == nil {
			cs.entityPairs[entity] = make(map[string]bool)
		}
		for partner := range partners {
			cs.entityPairs[entity][partner] = true
		}
	}

	// Merge chapter windows
	for chapterID, entities := range other.chapterWindows {
		cs.chapterWindows[chapterID] = append(cs.chapterWindows[chapterID], entities...)
	}
}
