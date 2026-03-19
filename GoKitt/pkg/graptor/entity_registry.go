// Package graptor implements embedding-free cross-chapter entity linking.
// It provides a global entity registry that tracks entities across all chapters
// of a document, enabling cross-chapter pronoun resolution and alias propagation.
package graptor

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// Gender represents the grammatical gender of an entity.
type Gender int

const (
	GenderUnknown Gender = iota
	GenderMale
	GenderFemale
	GenderNeutral
	GenderPlural
)

func (g Gender) String() string {
	switch g {
	case GenderMale:
		return "male"
	case GenderFemale:
		return "female"
	case GenderNeutral:
		return "neutral"
	case GenderPlural:
		return "plural"
	default:
		return "unknown"
	}
}

// ParseGender parses a string into a Gender.
func ParseGender(s string) Gender {
	switch strings.ToLower(s) {
	case "male", "m", "he", "him", "his":
		return GenderMale
	case "female", "f", "she", "her", "hers":
		return GenderFemale
	case "neutral", "n", "it", "its":
		return GenderNeutral
	case "plural", "p", "they", "them", "their":
		return GenderPlural
	default:
		return GenderUnknown
	}
}

// EntityKind represents the type/kind of an entity.
type EntityKind string

const (
	KindPerson       EntityKind = "Person"
	KindLocation     EntityKind = "Location"
	KindOrganization EntityKind = "Organization"
	KindObject       EntityKind = "Object"
	KindConcept      EntityKind = "Concept"
	KindEvent        EntityKind = "Event"
	KindUnknown      EntityKind = "Unknown"
)

// Entity represents a canonical entity in the registry.
type Entity struct {
	ID            string     `json:"id"`
	CanonicalName string     `json:"canonicalName"`
	Kind          EntityKind `json:"kind"`
	Gender        Gender     `json:"gender"`
	Aliases       []string   `json:"aliases,omitempty"`
	FirstChapter  uint32     `json:"firstChapter"`
	FirstChunk    uint32     `json:"firstChunk"`
	TotalMentions int        `json:"totalMentions"`
	Chapters      []uint32   `json:"chapters,omitempty"`
	CreatedAt     int64      `json:"createdAt"`
	UpdatedAt     int64      `json:"updatedAt"`
}

// EntityMention represents a single mention of an entity.
type EntityMention struct {
	EntityID  string `json:"entityId"`
	Text      string `json:"text"`
	ChapterID uint32 `json:"chapterId"`
	ChunkID   uint32 `json:"chunkId"`
	Start     int    `json:"start"`
	End       int    `json:"end"`
}

// ChapterStats tracks entity statistics within a chapter.
type ChapterStats struct {
	ChapterID     uint32
	EntityCount   int
	MentionCount  int
	LastMentioned []string // Entity IDs ordered by recency
	CarryOver     []string // Entity IDs to propagate to next chapter
}

// GlobalEntityRegistry maintains all entities across the entire document.
// It is the central source of truth for cross-chapter entity linking.
type GlobalEntityRegistry struct {
	mu sync.RWMutex

	// Core storage
	entities map[string]*Entity // canonical ID → Entity

	// Lookup indices
	aliases        map[string]string   // alias → canonical ID (lowercase)
	variants       map[string]string   // lowercase variant → canonical ID
	chapterIndex   map[uint32][]string // chapter ID → entity IDs
	entityChapters map[string][]uint32 // entity ID → chapter IDs

	// Mention tracking
	mentions   []*EntityMention
	mentionIdx map[string][]int // entity ID → mention indices

	// Chapter context
	chapterStats map[uint32]*ChapterStats

	// Co-occurrence tracking
	cooccurrences map[string]int // "entity1|entity2" → count

	// String interning for memory efficiency
	interner *StringInterner

	// Configuration
	maxHistory    int
	carryOverSize int
	maxMentions   int // Maximum mentions to store (0 = unlimited)
	normalizer    func(string) string
}

// RegistryConfig holds configuration for GlobalEntityRegistry.
type RegistryConfig struct {
	MaxHistory    int
	CarryOverSize int
	Normalizer    func(string) string

	// Pre-allocation hints for memory optimization
	ExpectedEntities int // Expected number of unique entities
	ExpectedChapters int // Expected number of chapters
	ExpectedMentions int // Expected number of mentions

	// Memory limits
	MaxMentions int // Maximum mentions to store (0 = unlimited)
}

// DefaultRegistryConfig returns default configuration.
func DefaultRegistryConfig() *RegistryConfig {
	return &RegistryConfig{
		MaxHistory:       100,
		CarryOverSize:    10,
		Normalizer:       CanonicalizeForMatch,
		ExpectedEntities: 256,  // Pre-allocate for 256 entities
		ExpectedChapters: 32,   // Pre-allocate for 32 chapters
		ExpectedMentions: 1024, // Pre-allocate for 1024 mentions
		MaxMentions:      0,    // 0 = unlimited (backward compatible)
	}
}

// NewGlobalEntityRegistry creates a new empty registry.
func NewGlobalEntityRegistry(config *RegistryConfig) *GlobalEntityRegistry {
	if config == nil {
		config = DefaultRegistryConfig()
	}

	return &GlobalEntityRegistry{
		entities:       make(map[string]*Entity, config.ExpectedEntities),
		aliases:        make(map[string]string, config.ExpectedEntities*2), // Aliases ~2x entities
		variants:       make(map[string]string, config.ExpectedEntities),
		chapterIndex:   make(map[uint32][]string, config.ExpectedChapters),
		entityChapters: make(map[string][]uint32, config.ExpectedEntities),
		mentions:       make([]*EntityMention, 0, config.ExpectedMentions),
		mentionIdx:     make(map[string][]int, config.ExpectedEntities),
		chapterStats:   make(map[uint32]*ChapterStats, config.ExpectedChapters),
		cooccurrences:  make(map[string]int, config.ExpectedEntities*4), // ~4 pairs per entity
		interner:       NewStringInterner(config.ExpectedEntities * 3),  // Intern IDs, aliases, names
		maxHistory:     config.MaxHistory,
		carryOverSize:  config.CarryOverSize,
		maxMentions:    config.MaxMentions,
		normalizer:     config.Normalizer,
	}
}

// CanonicalizeForMatch normalizes text for matching.
// This is the shared canonicalizer used for both patterns and input.
func CanonicalizeForMatch(s string) string {
	// Lowercase
	s = strings.ToLower(s)
	// Trim whitespace
	s = strings.TrimSpace(s)
	// Remove common articles
	s = strings.TrimPrefix(s, "the ")
	s = strings.TrimPrefix(s, "a ")
	s = strings.TrimPrefix(s, "an ")
	return s
}

// GenerateEntityID creates a unique ID for an entity.
func GenerateEntityID(name string, kind EntityKind) string {
	h := sha256.New()
	h.Write([]byte(name))
	h.Write([]byte(kind))
	hash := hex.EncodeToString(h.Sum(nil))[:16]
	return fmt.Sprintf("entity_%s_%s", kind, hash)
}

// --- Core Operations ---

// Register adds a new entity to the registry.
// Returns the entity ID (existing or new).
func (r *GlobalEntityRegistry) Register(name string, kind EntityKind, gender Gender, chapterID, chunkID uint32) string {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Normalize for lookup
	normalizedName := r.normalizer(name)

	// Check if already exists (by alias)
	if existingID, ok := r.aliases[normalizedName]; ok {
		// Update existing entity
		r.updateExistingEntity(existingID, chapterID, chunkID)
		return existingID
	}

	// Check variants (case-insensitive)
	if existingID, ok := r.variants[normalizedName]; ok {
		r.updateExistingEntity(existingID, chapterID, chunkID)
		return existingID
	}

	// Create new entity
	id := r.interner.Intern(GenerateEntityID(name, kind))
	now := time.Now().Unix()

	entity := &Entity{
		ID:            id,
		CanonicalName: name,
		Kind:          kind,
		Gender:        gender,
		Aliases:       []string{name},
		FirstChapter:  chapterID,
		FirstChunk:    chunkID,
		TotalMentions: 1,
		Chapters:      []uint32{chapterID},
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	r.entities[id] = entity
	r.aliases[normalizedName] = id
	r.variants[strings.ToLower(name)] = id
	r.chapterIndex[chapterID] = append(r.chapterIndex[chapterID], id)
	r.entityChapters[id] = []uint32{chapterID}

	// Initialize chapter stats if needed
	r.ensureChapterStats(chapterID)
	r.chapterStats[chapterID].EntityCount++
	r.chapterStats[chapterID].MentionCount++
	r.updateLastMentioned(chapterID, id)

	return id
}

// RegisterWithID adds a new entity with a specified ID to the registry.
// This is used for seeding entities from a dictionary with known IDs.
// Returns the entity ID (existing or the specified ID).
func (r *GlobalEntityRegistry) RegisterWithID(name, specifiedID string, kind EntityKind, gender Gender, chapterID, chunkID uint32) string {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Normalize for lookup
	normalizedName := r.normalizer(name)

	// Check if already exists (by alias)
	if existingID, ok := r.aliases[normalizedName]; ok {
		// Update existing entity
		r.updateExistingEntity(existingID, chapterID, chunkID)
		return existingID
	}

	// Check variants (case-insensitive)
	if existingID, ok := r.variants[normalizedName]; ok {
		r.updateExistingEntity(existingID, chapterID, chunkID)
		return existingID
	}

	// Use the specified ID
	id := specifiedID
	if id == "" {
		id = GenerateEntityID(name, kind)
	}
	// Intern the ID for memory efficiency
	id = r.interner.Intern(id)
	now := time.Now().Unix()

	entity := &Entity{
		ID:            id,
		CanonicalName: name,
		Kind:          kind,
		Gender:        gender,
		Aliases:       []string{name},
		FirstChapter:  chapterID,
		FirstChunk:    chunkID,
		TotalMentions: 1,
		Chapters:      []uint32{chapterID},
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	r.entities[id] = entity
	r.aliases[normalizedName] = id
	r.variants[strings.ToLower(name)] = id
	r.chapterIndex[chapterID] = append(r.chapterIndex[chapterID], id)
	r.entityChapters[id] = []uint32{chapterID}

	// Initialize chapter stats if needed
	r.ensureChapterStats(chapterID)
	r.chapterStats[chapterID].EntityCount++
	r.chapterStats[chapterID].MentionCount++
	r.updateLastMentioned(chapterID, id)

	return id
}

// RegisterMention records a mention of an entity.
// If the entity doesn't exist, it will be created with KindUnknown.
func (r *GlobalEntityRegistry) RegisterMention(text string, kind EntityKind, chapterID, chunkID uint32, start, end int) string {
	return r.registerMentionWithSpecifiedID(text, "", kind, chapterID, chunkID, start, end)
}

// RegisterMentionWithID records a mention and preserves a caller-supplied entity ID
// when the entity needs to be created from a seeded dictionary or external source.
func (r *GlobalEntityRegistry) RegisterMentionWithID(text, specifiedID string, kind EntityKind, chapterID, chunkID uint32, start, end int) string {
	return r.registerMentionWithSpecifiedID(text, specifiedID, kind, chapterID, chunkID, start, end)
}

func (r *GlobalEntityRegistry) registerMentionWithSpecifiedID(text, specifiedID string, kind EntityKind, chapterID, chunkID uint32, start, end int) string {
	r.mu.Lock()
	defer r.mu.Unlock()

	normalizedName := r.normalizer(text)

	// Check if entity exists
	var entityID string
	if existingID, ok := r.aliases[normalizedName]; ok {
		entityID = existingID
	} else if existingID, ok := r.variants[normalizedName]; ok {
		entityID = existingID
	}

	if entityID == "" {
		// Create new entity
		if kind == "" {
			kind = KindUnknown
		}
		entityID = specifiedID
		if entityID == "" {
			entityID = GenerateEntityID(text, kind)
		}
		entityID = r.interner.Intern(entityID)
		now := time.Now().Unix()

		entity := &Entity{
			ID:            entityID,
			CanonicalName: text,
			Kind:          kind,
			Gender:        GenderUnknown,
			Aliases:       []string{text},
			FirstChapter:  chapterID,
			FirstChunk:    chunkID,
			TotalMentions: 1,
			Chapters:      []uint32{chapterID},
			CreatedAt:     now,
			UpdatedAt:     now,
		}

		r.entities[entityID] = entity
		r.aliases[normalizedName] = entityID
		r.variants[strings.ToLower(text)] = entityID
		r.chapterIndex[chapterID] = append(r.chapterIndex[chapterID], entityID)
		r.entityChapters[entityID] = []uint32{chapterID}
	} else {
		// Update existing entity
		r.updateExistingEntity(entityID, chapterID, chunkID)
	}

	// Record mention
	mention := &EntityMention{
		EntityID:  entityID,
		Text:      strings.Clone(text), // Copy string to avoid reference to source
		ChapterID: chapterID,
		ChunkID:   chunkID,
		Start:     start,
		End:       end,
	}
	r.mentions = append(r.mentions, mention)
	r.mentionIdx[entityID] = append(r.mentionIdx[entityID], len(r.mentions)-1)

	// Enforce max mentions limit (if configured)
	if r.maxMentions > 0 && len(r.mentions) > r.maxMentions {
		r.trimMentions()
	}

	// Update chapter stats
	r.ensureChapterStats(chapterID)
	r.chapterStats[chapterID].MentionCount++
	r.updateLastMentioned(chapterID, entityID)

	return entityID
}

// updateExistingEntity updates an existing entity with a new mention.
// Must be called with lock held.
func (r *GlobalEntityRegistry) updateExistingEntity(entityID string, chapterID, _ uint32) {
	entity, ok := r.entities[entityID]
	if !ok {
		return
	}

	entity.TotalMentions++
	entity.UpdatedAt = time.Now().Unix()

	// Add chapter if not already present
	chapterExists := false
	for _, c := range entity.Chapters {
		if c == chapterID {
			chapterExists = true
			break
		}
	}
	if !chapterExists {
		entity.Chapters = append(entity.Chapters, chapterID)
		r.entityChapters[entityID] = append(r.entityChapters[entityID], chapterID)
	}

	// Update chapter index
	entityInChapter := false
	for _, id := range r.chapterIndex[chapterID] {
		if id == entityID {
			entityInChapter = true
			break
		}
	}
	if !entityInChapter {
		r.chapterIndex[chapterID] = append(r.chapterIndex[chapterID], entityID)
		r.ensureChapterStats(chapterID)
		r.chapterStats[chapterID].EntityCount++
	}
}

// ensureChapterStats ensures chapter stats exist for the given chapter.
// Must be called with lock held.
func (r *GlobalEntityRegistry) ensureChapterStats(chapterID uint32) {
	if _, ok := r.chapterStats[chapterID]; !ok {
		r.chapterStats[chapterID] = &ChapterStats{
			ChapterID:     chapterID,
			LastMentioned: make([]string, 0),
			CarryOver:     make([]string, 0),
		}
	}
}

// updateLastMentioned updates the last mentioned list for a chapter.
// Must be called with lock held.
func (r *GlobalEntityRegistry) updateLastMentioned(chapterID uint32, entityID string) {
	stats := r.chapterStats[chapterID]

	// Remove existing occurrence
	for i, id := range stats.LastMentioned {
		if id == entityID {
			stats.LastMentioned = append(stats.LastMentioned[:i], stats.LastMentioned[i+1:]...)
			break
		}
	}

	// Push to front
	stats.LastMentioned = append([]string{entityID}, stats.LastMentioned...)

	// Trim if too long
	if len(stats.LastMentioned) > r.maxHistory {
		stats.LastMentioned = stats.LastMentioned[:r.maxHistory]
	}
}

// trimMentions removes oldest mentions when max limit is reached.
// Must be called with lock held.
func (r *GlobalEntityRegistry) trimMentions() {
	if r.maxMentions <= 0 || len(r.mentions) <= r.maxMentions {
		return
	}

	// Calculate how many to remove
	removeCount := len(r.mentions) - r.maxMentions

	// Remove oldest mentions and update indices
	for i := 0; i < removeCount; i++ {
		mention := r.mentions[i]
		// Update mentionIdx for this entity
		indices := r.mentionIdx[mention.EntityID]
		if len(indices) > 0 {
			// Decrement all indices by removeCount
			newIndices := make([]int, 0, len(indices))
			for _, idx := range indices {
				if idx >= removeCount {
					newIndices = append(newIndices, idx-removeCount)
				}
			}
			if len(newIndices) == 0 {
				delete(r.mentionIdx, mention.EntityID)
			} else {
				r.mentionIdx[mention.EntityID] = newIndices
			}
		}
	}

	// Slice off oldest mentions
	r.mentions = r.mentions[removeCount:]
}

// Clear releases all stored data, allowing garbage collection.
// Use this when the registry is no longer needed or before reusing it.
func (r *GlobalEntityRegistry) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Clear all maps
	r.entities = make(map[string]*Entity)
	r.aliases = make(map[string]string)
	r.variants = make(map[string]string)
	r.chapterIndex = make(map[uint32][]string)
	r.entityChapters = make(map[string][]uint32)
	r.mentions = nil // Release for GC
	r.mentionIdx = make(map[string][]int)
	r.chapterStats = make(map[uint32]*ChapterStats)
	r.cooccurrences = make(map[string]int)

	// Clear the string interner
	r.interner = NewStringInterner(256)
}

// GetMentionCount returns the current number of stored mentions.
func (r *GlobalEntityRegistry) GetMentionCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.mentions)
}

// --- Lookup Operations ---

// Lookup finds an entity by name or alias.
func (r *GlobalEntityRegistry) Lookup(name string) *Entity {
	r.mu.RLock()
	defer r.mu.RUnlock()

	normalizedName := r.normalizer(name)

	if id, ok := r.aliases[normalizedName]; ok {
		return r.entities[id]
	}

	if id, ok := r.variants[strings.ToLower(name)]; ok {
		return r.entities[id]
	}

	return nil
}

// LookupByID finds an entity by its ID.
func (r *GlobalEntityRegistry) LookupByID(id string) *Entity {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.entities[id]
}

// Resolve finds the best matching entity for a given text.
// Returns the entity ID and confidence score.
func (r *GlobalEntityRegistry) Resolve(text string, context *ResolveContext) (string, float64) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	normalizedName := r.normalizer(text)

	// 1. Exact match (confidence 1.0)
	if id, ok := r.aliases[normalizedName]; ok {
		return id, 1.0
	}

	// 2. Case-insensitive match (confidence 0.9)
	lowerText := strings.ToLower(text)
	if id, ok := r.variants[lowerText]; ok {
		return id, 0.9
	}

	// 3. Partial match (confidence 0.6-0.8)
	results := r.partialMatch(text)
	if len(results) > 0 {
		// Sort by confidence
		sort.Slice(results, func(i, j int) bool {
			return results[i].Confidence > results[j].Confidence
		})
		return results[0].EntityID, results[0].Confidence
	}

	// 4. Contextual match (if context provided)
	if context != nil {
		if id, conf := r.contextualMatch(text, context); id != "" {
			return id, conf
		}
	}

	return "", 0
}

// ResolveContext provides context for entity resolution.
type ResolveContext struct {
	ChapterID      uint32
	ChunkID        uint32
	RecentEntities []string // Recently mentioned entity IDs
	Gender         Gender   // For pronoun resolution
}

// MatchResult represents a potential entity match.
type MatchResult struct {
	EntityID   string  `json:"entityId"`
	Confidence float64 `json:"confidence"`
	MatchType  string  `json:"matchType"` // "exact", "alias", "partial", "contextual"
}

// partialMatch finds entities where the text is a substring of the entity name.
// Must be called with lock held.
func (r *GlobalEntityRegistry) partialMatch(text string) []MatchResult {
	var results []MatchResult
	lowerText := strings.ToLower(text)

	for id, entity := range r.entities {
		lowerName := strings.ToLower(entity.CanonicalName)

		// Text is substring of entity name
		if strings.Contains(lowerName, lowerText) && len(text) >= 3 {
			confidence := 0.6 + (float64(len(text))/float64(len(lowerName)))*0.2
			results = append(results, MatchResult{
				EntityID:   id,
				Confidence: confidence,
				MatchType:  "partial",
			})
		}

		// Entity name is substring of text
		if strings.Contains(lowerText, lowerName) && len(lowerName) >= 3 {
			confidence := 0.5 + (float64(len(lowerName))/float64(len(text)))*0.2
			results = append(results, MatchResult{
				EntityID:   id,
				Confidence: confidence,
				MatchType:  "partial",
			})
		}
	}

	return results
}

// contextualMatch finds entities based on context (chapter, recent mentions).
// Must be called with lock held.
func (r *GlobalEntityRegistry) contextualMatch(text string, context *ResolveContext) (string, float64) {
	// Check recent entities first
	for _, entityID := range context.RecentEntities {
		entity, ok := r.entities[entityID]
		if !ok {
			continue
		}

		// Check if text matches any alias
		for _, alias := range entity.Aliases {
			if r.normalizer(alias) == r.normalizer(text) {
				return entityID, 0.8
			}
		}
	}

	// Check chapter-specific entities
	chapterEntities := r.chapterIndex[context.ChapterID]
	for _, entityID := range chapterEntities {
		entity, ok := r.entities[entityID]
		if !ok {
			continue
		}

		// Gender matching for pronouns
		if context.Gender != GenderUnknown && entity.Gender == context.Gender {
			// Check if this could be a pronoun reference
			if r.isPronounMatch(text, context.Gender) {
				return entityID, 0.7
			}
		}
	}

	return "", 0
}

// isPronounMatch checks if text is a pronoun matching the given gender.
func (r *GlobalEntityRegistry) isPronounMatch(text string, gender Gender) bool {
	lower := strings.ToLower(text)
	switch gender {
	case GenderMale:
		return lower == "he" || lower == "him" || lower == "his"
	case GenderFemale:
		return lower == "she" || lower == "her" || lower == "hers"
	case GenderNeutral:
		return lower == "it" || lower == "its"
	case GenderPlural:
		return lower == "they" || lower == "them" || lower == "their"
	}
	return false
}

// --- Alias Operations ---

// AddAlias adds an alias for an existing entity.
func (r *GlobalEntityRegistry) AddAlias(entityID, alias string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	entity, ok := r.entities[entityID]
	if !ok {
		return false
	}

	normalizedAlias := r.normalizer(alias)

	// Check if alias already exists for another entity
	if existingID, ok := r.aliases[normalizedAlias]; ok && existingID != entityID {
		// Conflict - don't add
		return false
	}

	// Add alias
	entity.Aliases = append(entity.Aliases, alias)
	r.aliases[normalizedAlias] = entityID
	r.variants[strings.ToLower(alias)] = entityID
	entity.UpdatedAt = time.Now().Unix()

	return true
}

// MergeEntities merges two entities, keeping target as canonical.
// All aliases and mentions from source are transferred to target.
func (r *GlobalEntityRegistry) MergeEntities(targetID, sourceID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	target, ok := r.entities[targetID]
	if !ok {
		return false
	}

	source, ok := r.entities[sourceID]
	if !ok {
		return false
	}

	// Transfer aliases
	for _, alias := range source.Aliases {
		normalized := r.normalizer(alias)
		r.aliases[normalized] = targetID
		r.variants[strings.ToLower(alias)] = targetID
		target.Aliases = append(target.Aliases, alias)
	}

	// Transfer chapters
	for _, chapterID := range source.Chapters {
		chapterExists := false
		for _, c := range target.Chapters {
			if c == chapterID {
				chapterExists = true
				break
			}
		}
		if !chapterExists {
			target.Chapters = append(target.Chapters, chapterID)
		}
	}

	// Transfer mentions
	for _, mentionIdx := range r.mentionIdx[sourceID] {
		r.mentions[mentionIdx].EntityID = targetID
	}
	r.mentionIdx[targetID] = append(r.mentionIdx[targetID], r.mentionIdx[sourceID]...)
	delete(r.mentionIdx, sourceID)

	// Update counts
	target.TotalMentions += source.TotalMentions
	target.UpdatedAt = time.Now().Unix()

	// Remove source entity
	delete(r.entities, sourceID)
	delete(r.entityChapters, sourceID)

	return true
}

// --- Chapter Operations ---

// GetChapterEntities returns all entities mentioned in a chapter.
func (r *GlobalEntityRegistry) GetChapterEntities(chapterID uint32) []*Entity {
	r.mu.RLock()
	defer r.mu.RUnlock()

	ids := r.chapterIndex[chapterID]
	entities := make([]*Entity, 0, len(ids))
	for _, id := range ids {
		if entity, ok := r.entities[id]; ok {
			entities = append(entities, entity)
		}
	}
	return entities
}

// GetEntityChapters returns all chapters where an entity appears.
func (r *GlobalEntityRegistry) GetEntityChapters(entityID string) []uint32 {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.entityChapters[entityID]
}

// GetCarryOverEntities returns entities to carry over to the next chapter.
func (r *GlobalEntityRegistry) GetCarryOverEntities(chapterID uint32) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	stats := r.chapterStats[chapterID]
	if stats == nil {
		return nil
	}

	// Update carry-over based on last mentioned
	carryOver := make([]string, 0, r.carryOverSize)
	for _, entityID := range stats.LastMentioned {
		if len(carryOver) >= r.carryOverSize {
			break
		}
		entity, ok := r.entities[entityID]
		if !ok {
			continue
		}
		// Prefer entities with known gender (for pronoun resolution)
		if entity.Gender != GenderUnknown {
			carryOver = append(carryOver, entityID)
		}
	}

	// Fill remaining slots with any entities
	for _, entityID := range stats.LastMentioned {
		if len(carryOver) >= r.carryOverSize {
			break
		}
		for _, id := range carryOver {
			if id == entityID {
				continue
			}
		}
		carryOver = append(carryOver, entityID)
	}

	return carryOver
}

// ResolvePronounAtChapterBoundary resolves a pronoun at the start of a chapter
// using carry-over from the previous chapter.
func (r *GlobalEntityRegistry) ResolvePronounAtChapterBoundary(pronoun string, prevChapterID uint32) string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	gender := ParseGender(pronoun)
	if gender == GenderUnknown {
		return ""
	}

	carryOver := r.GetCarryOverEntities(prevChapterID)
	for _, entityID := range carryOver {
		entity, ok := r.entities[entityID]
		if !ok {
			continue
		}
		if entity.Gender == gender {
			return entityID
		}
	}

	return ""
}

// --- Co-occurrence Operations ---

// RecordCooccurrence records that two entities appeared together.
func (r *GlobalEntityRegistry) RecordCooccurrence(entity1ID, entity2ID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Normalize order (smaller ID first)
	if entity1ID > entity2ID {
		entity1ID, entity2ID = entity2ID, entity1ID
	}

	key := fmt.Sprintf("%s|%s", entity1ID, entity2ID)
	r.cooccurrences[key]++
}

// GetCooccurrences returns entities that frequently appear with the given entity.
func (r *GlobalEntityRegistry) GetCooccurrences(entityID string, threshold int) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	related := make([]string, 0)
	for key, count := range r.cooccurrences {
		if count < threshold {
			continue
		}
		parts := strings.Split(key, "|")
		if len(parts) != 2 {
			continue
		}
		if parts[0] == entityID {
			related = append(related, parts[1])
		} else if parts[1] == entityID {
			related = append(related, parts[0])
		}
	}
	return related
}

// --- Statistics ---

// Stats returns registry statistics.
func (r *GlobalEntityRegistry) Stats() RegistryStats {
	r.mu.RLock()
	defer r.mu.RUnlock()

	totalMentions := 0
	for _, entity := range r.entities {
		totalMentions += entity.TotalMentions
	}

	return RegistryStats{
		TotalEntities: len(r.entities),
		TotalAliases:  len(r.aliases),
		TotalChapters: len(r.chapterIndex),
		TotalMentions: totalMentions,
		TotalCooccur:  len(r.cooccurrences),
	}
}

// RegistryStats holds registry statistics.
type RegistryStats struct {
	TotalEntities int `json:"totalEntities"`
	TotalAliases  int `json:"totalAliases"`
	TotalChapters int `json:"totalChapters"`
	TotalMentions int `json:"totalMentions"`
	TotalCooccur  int `json:"totalCooccur"`
}

// --- Export Operations ---

// GetAllEntities returns all entities in the registry.
func (r *GlobalEntityRegistry) GetAllEntities() []*Entity {
	r.mu.RLock()
	defer r.mu.RUnlock()

	entities := make([]*Entity, 0, len(r.entities))
	for _, entity := range r.entities {
		entities = append(entities, entity)
	}
	return entities
}

// GetMentions returns all mentions for an entity.
func (r *GlobalEntityRegistry) GetMentions(entityID string) []*EntityMention {
	r.mu.RLock()
	defer r.mu.RUnlock()

	indices := r.mentionIdx[entityID]
	mentions := make([]*EntityMention, 0, len(indices))
	for _, idx := range indices {
		if idx < len(r.mentions) {
			mentions = append(mentions, r.mentions[idx])
		}
	}
	return mentions
}

// Export exports the registry to a serializable format.
func (r *GlobalEntityRegistry) Export() *ExportedRegistry {
	r.mu.RLock()
	defer r.mu.RUnlock()

	export := &ExportedRegistry{
		Entities:      make([]*Entity, 0, len(r.entities)),
		Mentions:      r.mentions,
		Cooccurrences: make(map[string]int),
		ChapterStats:  make(map[uint32]*ChapterStats),
	}

	for _, entity := range r.entities {
		export.Entities = append(export.Entities, entity)
	}

	for k, v := range r.cooccurrences {
		export.Cooccurrences[k] = v
	}

	for k, v := range r.chapterStats {
		export.ChapterStats[k] = v
	}

	return export
}

// ExportedRegistry is a serializable version of the registry.
type ExportedRegistry struct {
	Entities      []*Entity                `json:"entities"`
	Mentions      []*EntityMention         `json:"mentions"`
	Cooccurrences map[string]int           `json:"cooccurrences"`
	ChapterStats  map[uint32]*ChapterStats `json:"chapterStats"`
}

// Import loads data from an exported registry.
func (r *GlobalEntityRegistry) Import(export *ExportedRegistry) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Clear existing data
	r.entities = make(map[string]*Entity)
	r.aliases = make(map[string]string)
	r.variants = make(map[string]string)
	r.chapterIndex = make(map[uint32][]string)
	r.entityChapters = make(map[string][]uint32)
	r.mentions = make([]*EntityMention, 0)
	r.mentionIdx = make(map[string][]int)
	r.chapterStats = make(map[uint32]*ChapterStats)
	r.cooccurrences = make(map[string]int)

	// Import entities
	for _, entity := range export.Entities {
		r.entities[entity.ID] = entity
		for _, alias := range entity.Aliases {
			r.aliases[r.normalizer(alias)] = entity.ID
			r.variants[strings.ToLower(alias)] = entity.ID
		}
		for _, chapterID := range entity.Chapters {
			r.chapterIndex[chapterID] = append(r.chapterIndex[chapterID], entity.ID)
		}
		r.entityChapters[entity.ID] = entity.Chapters
	}

	// Import mentions
	r.mentions = export.Mentions
	for i, mention := range r.mentions {
		r.mentionIdx[mention.EntityID] = append(r.mentionIdx[mention.EntityID], i)
	}

	// Import co-occurrences
	for k, v := range export.Cooccurrences {
		r.cooccurrences[k] = v
	}

	// Import chapter stats
	for k, v := range export.ChapterStats {
		r.chapterStats[k] = v
	}
}
