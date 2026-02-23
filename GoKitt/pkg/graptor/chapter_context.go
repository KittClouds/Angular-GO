package graptor

import (
	"sort"
	"sync"
	"time"
)

// ChapterContext maintains entity state within a single chapter.
// It tracks which entities are active, their mention order, and provides
// carry-over functionality for chapter transitions.
type ChapterContext struct {
	mu sync.RWMutex

	ChapterID uint32

	// Entities first mentioned in this chapter
	FirstMentions map[string]*EntityMention // entityID → first mention

	// Entities active (mentioned) in this chapter with counts
	ActiveEntities map[string]int // entityID → mention count

	// Last N entities mentioned (ordered by recency) - O(1) ring buffer
	lastMentioned *RingBuffer

	// Carry-over to next chapter (entities with gender for pronoun resolution)
	CarryOver []string

	// Configuration
	maxHistory    int
	carryOverSize int

	// Timestamps
	StartedAt  int64
	FinishedAt int64
}

// ChapterContextConfig holds configuration for ChapterContext.
type ChapterContextConfig struct {
	MaxHistory    int
	CarryOverSize int
}

// DefaultChapterContextConfig returns default configuration.
func DefaultChapterContextConfig() *ChapterContextConfig {
	return &ChapterContextConfig{
		MaxHistory:    50,
		CarryOverSize: 10,
	}
}

// NewChapterContext creates a new chapter context.
func NewChapterContext(chapterID uint32, config *ChapterContextConfig) *ChapterContext {
	if config == nil {
		config = DefaultChapterContextConfig()
	}

	return &ChapterContext{
		ChapterID:      chapterID,
		FirstMentions:  make(map[string]*EntityMention),
		ActiveEntities: make(map[string]int),
		lastMentioned:  NewRingBuffer(config.MaxHistory),
		CarryOver:      make([]string, 0),
		maxHistory:     config.MaxHistory,
		carryOverSize:  config.CarryOverSize,
		StartedAt:      time.Now().Unix(),
	}
}

// ObserveMention records an entity mention in this chapter.
func (cc *ChapterContext) ObserveMention(entityID string, mention *EntityMention) {
	cc.mu.Lock()
	defer cc.mu.Unlock()

	// Track mention count
	cc.ActiveEntities[entityID]++

	// Track first mention
	if _, exists := cc.FirstMentions[entityID]; !exists {
		cc.FirstMentions[entityID] = mention
	}

	// Update last mentioned (move to front if exists, else add)
	cc.updateLastMentioned(entityID)
}

// updateLastMentioned updates the last mentioned list using O(1) ring buffer operations.
// Must be called with lock held.
func (cc *ChapterContext) updateLastMentioned(entityID string) {
	// RingBuffer.Push handles deduplication and capacity automatically - O(1)
	cc.lastMentioned.Push(entityID)
}

// GetRecentEntities returns the N most recently mentioned entities.
func (cc *ChapterContext) GetRecentEntities(n int) []string {
	cc.mu.RLock()
	defer cc.mu.RUnlock()

	// Get all from ring buffer (already ordered by recency)
	all := cc.lastMentioned.ToSlice()
	if n > len(all) {
		n = len(all)
	}
	return append([]string{}, all[:n]...)
}

// GetMostMentioned returns entities sorted by mention count.
func (cc *ChapterContext) GetMostMentioned(n int) []string {
	cc.mu.RLock()
	defer cc.mu.RUnlock()

	// Create sorted list
	type entityCount struct {
		id    string
		count int
	}

	var sorted []entityCount
	for id, count := range cc.ActiveEntities {
		sorted = append(sorted, entityCount{id, count})
	}

	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].count > sorted[j].count
	})

	// Return top N
	result := make([]string, 0, n)
	for i := 0; i < n && i < len(sorted); i++ {
		result = append(result, sorted[i].id)
	}
	return result
}

// Finish finalizes the chapter context and computes carry-over.
func (cc *ChapterContext) Finish(registry *GlobalEntityRegistry) {
	cc.mu.Lock()
	defer cc.mu.Unlock()

	cc.FinishedAt = time.Now().Unix()
	cc.computeCarryOver(registry)
}

// computeCarryOver determines which entities to carry over to the next chapter.
// Must be called with lock held.
func (cc *ChapterContext) computeCarryOver(registry *GlobalEntityRegistry) {
	cc.CarryOver = make([]string, 0, cc.carryOverSize)

	// Get last mentioned from ring buffer (ordered by recency)
	lastMentioned := cc.lastMentioned.ToSlice()

	// First, add entities with known gender (for pronoun resolution)
	for _, entityID := range lastMentioned {
		if len(cc.CarryOver) >= cc.carryOverSize {
			break
		}
		entity := registry.LookupByID(entityID)
		if entity != nil && entity.Gender != GenderUnknown {
			cc.CarryOver = append(cc.CarryOver, entityID)
		}
	}

	// Fill remaining slots with any recently mentioned entities
	for _, entityID := range lastMentioned {
		if len(cc.CarryOver) >= cc.carryOverSize {
			break
		}
		// Check if already in carry-over
		found := false
		for _, id := range cc.CarryOver {
			if id == entityID {
				found = true
				break
			}
		}
		if !found {
			cc.CarryOver = append(cc.CarryOver, entityID)
		}
	}
}

// GetCarryOver returns the carry-over entities.
func (cc *ChapterContext) GetCarryOver() []string {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	return append([]string{}, cc.CarryOver...)
}

// Stats returns chapter statistics.
func (cc *ChapterContext) Stats() ChapterStats {
	cc.mu.RLock()
	defer cc.mu.RUnlock()

	return ChapterStats{
		ChapterID:     cc.ChapterID,
		EntityCount:   len(cc.ActiveEntities),
		MentionCount:  cc.totalMentions(),
		LastMentioned: cc.lastMentioned.ToSlice(),
		CarryOver:     append([]string{}, cc.CarryOver...),
	}
}

// GetLastMentioned returns all entities in the last mentioned list (ordered by recency).
// This is a convenience method for testing and debugging.
func (cc *ChapterContext) GetLastMentioned() []string {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	return cc.lastMentioned.ToSlice()
}

// totalMentions calculates total mentions in this chapter.
func (cc *ChapterContext) totalMentions() int {
	total := 0
	for _, count := range cc.ActiveEntities {
		total += count
	}
	return total
}

// --- Chapter Transition ---

// ChapterTransition handles entity resolution at chapter boundaries.
type ChapterTransition struct {
	prevContext *ChapterContext
	currContext *ChapterContext
	registry    *GlobalEntityRegistry
}

// NewChapterTransition creates a new chapter transition handler.
func NewChapterTransition(prev, curr *ChapterContext, registry *GlobalEntityRegistry) *ChapterTransition {
	return &ChapterTransition{
		prevContext: prev,
		currContext: curr,
		registry:    registry,
	}
}

// ResolvePronoun resolves a pronoun at the start of a new chapter.
// It uses carry-over from the previous chapter for resolution.
func (ct *ChapterTransition) ResolvePronoun(pronoun string) string {
	if ct.prevContext == nil {
		return ""
	}

	gender := ParseGender(pronoun)
	if gender == GenderUnknown {
		return ""
	}

	// Check carry-over from previous chapter
	carryOver := ct.prevContext.GetCarryOver()
	for _, entityID := range carryOver {
		entity := ct.registry.LookupByID(entityID)
		if entity == nil {
			continue
		}
		if entity.Gender == gender {
			return entityID
		}
	}

	return ""
}

// ResolveEntity resolves an entity mention at chapter boundary.
// It first checks the current chapter's recent entities, then falls back
// to carry-over from the previous chapter.
func (ct *ChapterTransition) ResolveEntity(text string) string {
	// Normalize text
	normalized := CanonicalizeForMatch(text)

	// 1. Check current chapter's recent entities
	if ct.currContext != nil {
		recent := ct.currContext.GetRecentEntities(10)
		for _, entityID := range recent {
			entity := ct.registry.LookupByID(entityID)
			if entity == nil {
				continue
			}
			// Check if text matches any alias
			for _, alias := range entity.Aliases {
				if CanonicalizeForMatch(alias) == normalized {
					return entityID
				}
			}
		}
	}

	// 2. Check carry-over from previous chapter
	if ct.prevContext != nil {
		carryOver := ct.prevContext.GetCarryOver()
		for _, entityID := range carryOver {
			entity := ct.registry.LookupByID(entityID)
			if entity == nil {
				continue
			}
			for _, alias := range entity.Aliases {
				if CanonicalizeForMatch(alias) == normalized {
					return entityID
				}
			}
		}
	}

	// 3. Fall back to global registry
	entity := ct.registry.Lookup(text)
	if entity != nil {
		return entity.ID
	}

	return ""
}

// GetContextForResolution returns a ResolveContext for the current position.
func (ct *ChapterTransition) GetContextForResolution(chapterID uint32) *ResolveContext {
	recentEntities := make([]string, 0)

	// Get recent entities from current chapter
	if ct.currContext != nil {
		recentEntities = append(recentEntities, ct.currContext.GetRecentEntities(10)...)
	}

	// Add carry-over from previous chapter
	if ct.prevContext != nil {
		carryOver := ct.prevContext.GetCarryOver()
		for _, id := range carryOver {
			found := false
			for _, existing := range recentEntities {
				if existing == id {
					found = true
					break
				}
			}
			if !found {
				recentEntities = append(recentEntities, id)
			}
		}
	}

	return &ResolveContext{
		ChapterID:      chapterID,
		RecentEntities: recentEntities,
	}
}

// --- Chapter Manager ---

// ChapterManager manages chapter contexts across a document.
type ChapterManager struct {
	mu sync.RWMutex

	registry *GlobalEntityRegistry

	// All chapter contexts
	chapters map[uint32]*ChapterContext

	// Ordered chapter IDs
	chapterOrder []uint32

	// Current chapter being processed
	currentChapter *ChapterContext

	// Configuration
	config *ChapterContextConfig
}

// NewChapterManager creates a new chapter manager.
func NewChapterManager(registry *GlobalEntityRegistry, config *ChapterContextConfig) *ChapterManager {
	if config == nil {
		config = DefaultChapterContextConfig()
	}

	return &ChapterManager{
		registry:     registry,
		chapters:     make(map[uint32]*ChapterContext),
		chapterOrder: make([]uint32, 0),
		config:       config,
	}
}

// StartChapter begins a new chapter context.
func (cm *ChapterManager) StartChapter(chapterID uint32) *ChapterContext {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Finish previous chapter if exists
	if cm.currentChapter != nil {
		cm.currentChapter.Finish(cm.registry)
	}

	// Create new chapter context
	ctx := NewChapterContext(chapterID, cm.config)
	cm.chapters[chapterID] = ctx
	cm.chapterOrder = append(cm.chapterOrder, chapterID)
	cm.currentChapter = ctx

	return ctx
}

// GetCurrentChapter returns the current chapter context.
func (cm *ChapterManager) GetCurrentChapter() *ChapterContext {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.currentChapter
}

// GetChapter returns a chapter context by ID.
func (cm *ChapterManager) GetChapter(chapterID uint32) *ChapterContext {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.chapters[chapterID]
}

// GetPreviousChapter returns the previous chapter context.
func (cm *ChapterManager) GetPreviousChapter(chapterID uint32) *ChapterContext {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	// Find index of current chapter
	idx := -1
	for i, id := range cm.chapterOrder {
		if id == chapterID {
			idx = i
			break
		}
	}

	if idx <= 0 {
		return nil
	}

	return cm.chapters[cm.chapterOrder[idx-1]]
}

// ObserveMention records an entity mention in the current chapter.
func (cm *ChapterManager) ObserveMention(entityID string, mention *EntityMention) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.currentChapter == nil {
		return
	}

	cm.currentChapter.ObserveMention(entityID, mention)
}

// CreateTransition creates a chapter transition handler.
func (cm *ChapterManager) CreateTransition(chapterID uint32) *ChapterTransition {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	curr := cm.chapters[chapterID]
	var prev *ChapterContext

	// Find previous chapter
	idx := -1
	for i, id := range cm.chapterOrder {
		if id == chapterID {
			idx = i
			break
		}
	}

	if idx > 0 {
		prev = cm.chapters[cm.chapterOrder[idx-1]]
	}

	return NewChapterTransition(prev, curr, cm.registry)
}

// FinishDocument finalizes all chapter contexts.
func (cm *ChapterManager) FinishDocument() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.currentChapter != nil {
		cm.currentChapter.Finish(cm.registry)
	}
}

// GetAllChapters returns all chapter contexts in order.
func (cm *ChapterManager) GetAllChapters() []*ChapterContext {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	result := make([]*ChapterContext, 0, len(cm.chapterOrder))
	for _, id := range cm.chapterOrder {
		result = append(result, cm.chapters[id])
	}
	return result
}

// GetDocumentStats returns statistics for the entire document.
func (cm *ChapterManager) GetDocumentStats() DocumentChapterStats {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	stats := DocumentChapterStats{
		TotalChapters:     len(cm.chapterOrder),
		ChapterStats:      make(map[uint32]ChapterStats),
		EntityAppearances: make(map[string][]uint32),
	}

	// Collect chapter stats
	for _, ctx := range cm.chapters {
		chapterStats := ctx.Stats()
		stats.ChapterStats[ctx.ChapterID] = chapterStats
		stats.TotalEntities += chapterStats.EntityCount
		stats.TotalMentions += chapterStats.MentionCount

		// Track entity appearances
		for entityID := range ctx.ActiveEntities {
			stats.EntityAppearances[entityID] = append(stats.EntityAppearances[entityID], ctx.ChapterID)
		}
	}

	return stats
}

// DocumentChapterStats holds statistics for all chapters in a document.
type DocumentChapterStats struct {
	TotalChapters     int                     `json:"totalChapters"`
	TotalEntities     int                     `json:"totalEntities"`
	TotalMentions     int                     `json:"totalMentions"`
	ChapterStats      map[uint32]ChapterStats `json:"chapterStats"`
	EntityAppearances map[string][]uint32     `json:"entityAppearances"` // entityID → chapter IDs
}
