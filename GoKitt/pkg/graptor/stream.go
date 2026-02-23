package graptor

import (
	"context"
)

// MentionCallback is called for each mention processed.
// Return error to stop processing, or nil to continue.
type MentionCallback func(mention *EntityMention) error

// EntityCallback is called for each new entity discovered.
// Return error to stop processing, or nil to continue.
type EntityCallback func(entity *Entity) error

// StreamProcessor processes mentions in a streaming fashion for memory efficiency.
// Instead of collecting all mentions in memory, it processes them via callbacks.
type StreamProcessor struct {
	registry     *GlobalEntityRegistry
	cooccurrence *CooccurrenceStats
	chapterMgr   *ChapterManager

	// Callbacks
	onMention MentionCallback
	onEntity  EntityCallback

	// Current chapter context
	currentChapterID uint32
}

// StreamConfig holds configuration for streaming processing.
type StreamConfig struct {
	RegistryConfig     *RegistryConfig
	CooccurrenceConfig *CooccurrenceConfig
	ChapterConfig      *ChapterContextConfig
}

// DefaultStreamConfig returns default streaming configuration.
func DefaultStreamConfig() *StreamConfig {
	return &StreamConfig{
		RegistryConfig:     DefaultRegistryConfig(),
		CooccurrenceConfig: DefaultCooccurrenceConfig(),
		ChapterConfig:      DefaultChapterContextConfig(),
	}
}

// NewStreamProcessor creates a new streaming processor.
func NewStreamProcessor(config *StreamConfig) *StreamProcessor {
	if config == nil {
		config = DefaultStreamConfig()
	}

	registry := NewGlobalEntityRegistry(config.RegistryConfig)
	cooccurrence := NewCooccurrenceStatsWithConfig(config.CooccurrenceConfig)
	chapterMgr := NewChapterManager(registry, config.ChapterConfig)

	return &StreamProcessor{
		registry:     registry,
		cooccurrence: cooccurrence,
		chapterMgr:   chapterMgr,
	}
}

// OnMention registers a callback for mention processing.
func (sp *StreamProcessor) OnMention(cb MentionCallback) *StreamProcessor {
	sp.onMention = cb
	return sp
}

// OnEntity registers a callback for entity discovery.
func (sp *StreamProcessor) OnEntity(cb EntityCallback) *StreamProcessor {
	sp.onEntity = cb
	return sp
}

// StartChapter begins a new chapter for streaming processing.
func (sp *StreamProcessor) StartChapter(chapterID uint32) {
	sp.currentChapterID = chapterID
	sp.chapterMgr.StartChapter(chapterID)
}

// ProcessMention processes a single mention in streaming fashion.
// This is memory-efficient as it doesn't accumulate mentions unless needed.
func (sp *StreamProcessor) ProcessMention(ctx context.Context, text string, kind EntityKind, gender Gender, chunkID uint32, start, end int) error {
	// Check for cancellation
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	// Register/update entity
	entityID := sp.registry.Register(text, kind, gender, sp.currentChapterID, chunkID)

	// Create mention (but don't necessarily store it)
	mention := &EntityMention{
		EntityID:  entityID,
		Text:      stringsClone(text), // Clone to avoid reference
		ChapterID: sp.currentChapterID,
		ChunkID:   chunkID,
		Start:     start,
		End:       end,
	}

	// Track in chapter context
	sp.chapterMgr.ObserveMention(entityID, mention)

	// Call mention callback if registered
	if sp.onMention != nil {
		if err := sp.onMention(mention); err != nil {
			return err
		}
	}

	return nil
}

// ProcessEntity processes an entity discovery in streaming fashion.
func (sp *StreamProcessor) ProcessEntity(ctx context.Context, name string, kind EntityKind, gender Gender, chunkID uint32) (string, error) {
	// Check for cancellation
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}

	// Register entity
	entityID := sp.registry.Register(name, kind, gender, sp.currentChapterID, chunkID)

	// Call entity callback if registered (only for new entities)
	if sp.onEntity != nil {
		entity := sp.registry.LookupByID(entityID)
		if entity != nil {
			if err := sp.onEntity(entity); err != nil {
				return entityID, err
			}
		}
	}

	return entityID, nil
}

// RecordCooccurrence records co-occurrence for relationship inference.
func (sp *StreamProcessor) RecordCooccurrence(entityIDs []string) {
	sp.cooccurrence.RecordCooccurrence(entityIDs, sp.currentChapterID)
}

// FinishChapter finalizes the current chapter.
func (sp *StreamProcessor) FinishChapter() {
	sp.chapterMgr.FinishDocument()
}

// GetRegistry returns the underlying registry.
func (sp *StreamProcessor) GetRegistry() *GlobalEntityRegistry {
	return sp.registry
}

// GetCooccurrence returns the underlying co-occurrence tracker.
func (sp *StreamProcessor) GetCooccurrence() *CooccurrenceStats {
	return sp.cooccurrence
}

// GetChapterManager returns the underlying chapter manager.
func (sp *StreamProcessor) GetChapterManager() *ChapterManager {
	return sp.chapterMgr
}

// Dispose releases all resources.
func (sp *StreamProcessor) Dispose() {
	sp.registry.Clear()
	sp.cooccurrence.Clear()
}

// --- Batch Processing with Streaming ---

// BatchToStream processes a batch of mentions using streaming for memory efficiency.
// This is useful when you have a large batch but want to process it incrementally.
func BatchToStream(ctx context.Context, mentions []*EntityMention, processor *StreamProcessor) error {
	for _, mention := range mentions {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Look up entity to get kind and gender
		entity := processor.registry.LookupByID(mention.EntityID)
		if entity == nil {
			continue // Skip orphaned mentions
		}

		// Process through stream
		if err := processor.ProcessMention(ctx, mention.Text, entity.Kind, entity.Gender, mention.ChunkID, mention.Start, mention.End); err != nil {
			return err
		}
	}
	return nil
}

// stringsClone is a helper to avoid importing strings package just for Clone.
func stringsClone(s string) string {
	if s == "" {
		return ""
	}
	b := make([]byte, len(s))
	copy(b, s)
	return string(b)
}
