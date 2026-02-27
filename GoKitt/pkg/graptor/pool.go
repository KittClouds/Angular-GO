package graptor

import (
	"strings"
	"sync"
)

// EntityMentionPool provides pooled allocation for EntityMention structs.
// This reduces GC pressure during high-volume document processing.
var EntityMentionPool = sync.Pool{
	New: func() interface{} {
		return &EntityMention{}
	},
}

// AcquireMention gets an EntityMention from the pool.
func AcquireMention() *EntityMention {
	return EntityMentionPool.Get().(*EntityMention)
}

// ReleaseMention returns an EntityMention to the pool.
// The mention is reset before being returned.
func ReleaseMention(m *EntityMention) {
	// Reset to zero values
	m.EntityID = ""
	m.Text = ""
	m.ChapterID = 0
	m.ChunkID = 0
	m.Start = 0
	m.End = 0
	EntityMentionPool.Put(m)
}

// EntityMatchPool provides pooled allocation for EntityMatch structs.
var EntityMatchPool = sync.Pool{
	New: func() interface{} {
		return &EntityMatch{}
	},
}

// AcquireEntityMatch gets an EntityMatch from the pool.
func AcquireEntityMatch() *EntityMatch {
	return EntityMatchPool.Get().(*EntityMatch)
}

// ReleaseEntityMatch returns an EntityMatch to the pool.
func ReleaseEntityMatch(em *EntityMatch) {
	em.ID = ""
	em.Text = ""
	em.Kind = ""
	em.Start = 0
	em.End = 0
	em.Chapter = 0
	EntityMatchPool.Put(em)
}

// StringBuilderPool provides pooled string builders for efficient string concatenation.
var stringBuilderPool = sync.Pool{
	New: func() interface{} {
		return &strings.Builder{}
	},
}

// AcquireStringBuilder gets a strings.Builder from the pool.
func AcquireStringBuilder() *strings.Builder {
	return stringBuilderPool.Get().(*strings.Builder)
}

// ReleaseStringBuilder returns a strings.Builder to the pool.
func ReleaseStringBuilder(sb *strings.Builder) {
	sb.Reset()
	stringBuilderPool.Put(sb)
}

// NOTE: CooccurrenceKeyBuilder removed - benchmarks showed simple string
// concatenation is 2.6x faster than pooled StringBuilder for small strings.
// See cooccurrence.go:cooccurrenceKey() for the optimized implementation.

// PreAllocatedMaps provides pre-allocated maps for common operations.
// This reduces rehashing during growth.

// NewEntityAliasMap creates a pre-sized alias map.
func NewEntityAliasMap(hint int) map[string]string {
	if hint <= 0 {
		hint = 64 // Default reasonable size
	}
	return make(map[string]string, hint)
}

// NewChapterEntityMap creates a pre-sized chapter entity map.
func NewChapterEntityMap(hint int) map[uint32][]string {
	if hint <= 0 {
		hint = 16 // Default chapters
	}
	return make(map[uint32][]string, hint)
}

// NewCooccurrenceMap creates a pre-sized co-occurrence map.
func NewCooccurrenceMap(hint int) map[string]int {
	if hint <= 0 {
		hint = 256 // Default pairs
	}
	return make(map[string]int, hint)
}

// BatchMentionAccumulator accumulates mentions for batch registration.
// This reduces lock contention by batching updates.
type BatchMentionAccumulator struct {
	mu       sync.Mutex
	mentions []*EntityMention
}

// NewBatchMentionAccumulator creates a new accumulator with pre-allocated capacity.
func NewBatchMentionAccumulator(capacity int) *BatchMentionAccumulator {
	return &BatchMentionAccumulator{
		mentions: make([]*EntityMention, 0, capacity),
	}
}

// Add adds a mention to the batch.
func (b *BatchMentionAccumulator) Add(m *EntityMention) {
	b.mu.Lock()
	b.mentions = append(b.mentions, m)
	b.mu.Unlock()
}

// Flush returns all accumulated mentions and resets the accumulator.
// The caller is responsible for returning mentions to the pool.
func (b *BatchMentionAccumulator) Flush() []*EntityMention {
	b.mu.Lock()
	defer b.mu.Unlock()

	result := b.mentions
	b.mentions = make([]*EntityMention, 0, cap(result))
	return result
}

// Len returns the current number of accumulated mentions.
func (b *BatchMentionAccumulator) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.mentions)
}
