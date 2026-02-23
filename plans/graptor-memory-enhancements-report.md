# Graptor Memory Enhancement Analysis Report

## Executive Summary

This report analyzes the Graptor package for memory optimization opportunities, garbage collection efficiency, and potential memory leaks. The analysis covers the core data structures, allocation patterns, and lifecycle management.

---

## 1. Current Memory Profile

### 1.1 Core Data Structures

| Structure | Size Estimate | Growth Pattern | GC Impact |
|-----------|---------------|----------------|-----------|
| `GlobalEntityRegistry` | ~2-4 KB base + dynamic | Linear with entities | Medium |
| `Entity` | ~200-500 bytes each | Linear | Low |
| `EntityMention` | ~64 bytes each | Linear with mentions | Medium |
| `ChapterContext` | ~1-2 KB each | Linear with chapters | Low |
| `CooccurrenceStats` | ~4-8 KB base | Quadratic potential | High |
| `DocumentGraph` | ~4 KB base + chapter graphs | Linear with chapters | High |

### 1.2 Memory Hotspots Identified

```go
// entity_registry.go - Lines 107-133
type GlobalEntityRegistry struct {
    entities       map[string]*Entity           // Grows unbounded
    aliases        map[string]string            // 2x entity count
    variants       map[string]string            // ~1x entity count
    chapterIndex   map[uint32][]string          // Linear with chapters
    entityChapters map[string][]uint32          // Linear with entities
    mentions       []*EntityMention             // GROWS UNBOUNDED ⚠️
    mentionIdx     map[string][]int             // Linear with entities
    chapterStats   map[uint32]*ChapterStats     // Linear with chapters
    cooccurrences  map[string]int               // Quadratic potential ⚠️
}
```

---

## 2. Critical Issues

### 2.1 Unbounded Growth: `mentions` Slice

**Location:** [`entity_registry.go:120`](GoKitt/pkg/graptor/entity_registry.go:120)

```go
mentions   []*EntityMention  // ⚠️ Grows unbounded - every mention ever recorded
```

**Problem:**
- Every entity mention is appended and never removed
- For a 150K character document with ~1000 entity mentions, this holds ~64KB
- For a 1M character document, this could hold ~400KB+
- Mentions hold string references preventing GC of source text

**Impact:** HIGH - Memory leak for long-running processes processing multiple documents

**Recommendation:**
```go
// Option A: Circular buffer with fixed capacity
mentions    []*EntityMention
maxMentions int  // Cap at configurable limit

// Option B: Streaming approach - don't store at all
// Process mentions immediately, don't accumulate
```

### 2.2 Quadratic Growth: Co-occurrence Map

**Location:** [`entity_registry.go:127`](GoKitt/pkg/graptor/entity_registry.go:127)

```go
cooccurrences map[string]int  // "entity1|entity2" → count
```

**Problem:**
- For N entities, potential N²/2 pairs
- 100 entities → ~5,000 pairs
- 1000 entities → ~500,000 pairs
- Each key is a string allocation

**Impact:** MEDIUM - Scales poorly for entity-dense documents

**Recommendation:**
```go
// Use sparse matrix or limit to top-K pairs per entity
type CooccurrenceStats struct {
    // Only track pairs with count > threshold
    minThreshold int
    
    // Or use sparse representation
    pairMatrix *sparse.Matrix  // Only stores non-zero entries
}
```

### 2.3 String Duplication in Aliases

**Location:** [`entity_registry.go:114-115`](GoKitt/pkg/graptor/entity_registry.go:114)

```go
aliases  map[string]string   // alias → canonical ID
variants map[string]string   // lowercase variant → canonical ID
```

**Problem:**
- Same canonical ID stored multiple times as value
- Same alias stored as key and potentially in Entity.Aliases slice

**Impact:** LOW - Minor duplication overhead

**Recommendation:**
```go
// Use string interning for canonical IDs
var canonicalIDPool = make(map[string]string)

func internID(id string) string {
    if pooled, exists := canonicalIDPool[id]; exists {
        return pooled
    }
    canonicalIDPool[id] = id
    return id
}
```

---

## 3. Slice Growth Patterns

### 3.1 LastMentioned Slice - O(n) Operations

**Location:** [`chapter_context.go:89-99`](GoKitt/pkg/graptor/chapter_context.go:89)

```go
func (cc *ChapterContext) updateLastMentioned(entityID string) {
    // O(n) scan to remove existing
    for i, id := range cc.LastMentioned {
        if id == entityID {
            cc.LastMentioned = append(cc.LastMentioned[:i], cc.LastMentioned[i+1:]...)
            break
        }
    }
    // O(n) prepend - causes reallocation
    cc.LastMentioned = append([]string{entityID}, cc.LastMentioned...)
}
```

**Problems:**
1. O(n) scan for removal
2. Prepend causes full slice reallocation
3. Creates new slice on every update

**Impact:** MEDIUM - CPU and memory churn

**Recommendation:**
```go
// Use ring buffer or doubly-linked list
type lastMentioned struct {
    data  []string
    head  int
    size  int
}

func (lm *lastMentioned) push(id string) {
    // O(1) insertion with fixed allocation
}
```

### 3.2 Entity.Aliases Slice Growth

**Location:** [`entity_registry.go:77`](GoKitt/pkg/graptor/entity_registry.go:77)

```go
Aliases []string `json:"aliases,omitempty"`
```

**Problem:**
- Grows with each alias added
- No deduplication check before append
- JSON omitempty helps but doesn't prevent growth

**Impact:** LOW - Aliases typically limited

---

## 4. Map Allocation Patterns

### 4.1 Pre-allocation Status

**Good:** Pre-allocation hints are implemented:

```go
// entity_registry.go:165-174
entities:       make(map[string]*Entity, config.ExpectedEntities),
aliases:        make(map[string]string, config.ExpectedEntities*2),
variants:       make(map[string]string, config.ExpectedEntities),
chapterIndex:   make(map[uint32][]string, config.ExpectedChapters),
```

**Issue:** Default values may be too small for large documents:

```go
ExpectedEntities: 256,   // Large docs may have 1000+
ExpectedChapters: 32,    // Epic novels may have 100+
ExpectedMentions: 1024,  // Large docs may have 10000+
```

### 4.2 Map Rehashing Overhead

When maps exceed capacity, Go rehashes them:
- O(n) operation where n is current size
- Allocates new underlying array
- Old array becomes GC pressure

**Recommendation:** Add dynamic sizing based on document length:

```go
func EstimateConfig(docLength int) *RegistryConfig {
    cfg := DefaultRegistryConfig()
    
    // Scale based on document size
    scale := float64(docLength) / 100000.0 // 100K chars baseline
    
    cfg.ExpectedEntities = int(float64(cfg.ExpectedEntities) * scale)
    cfg.ExpectedChapters = int(float64(cfg.ExpectedChapters) * scale)
    cfg.ExpectedMentions = int(float64(cfg.ExpectedMentions) * scale)
    
    return cfg
}
```

---

## 5. Garbage Collection Considerations

### 5.1 Pointer vs Value Semantics

**Current:** Entity stored as pointer in map:

```go
entities map[string]*Entity
```

**Pros:**
- Smaller map values (8 bytes vs ~200 bytes)
- Faster map operations
- Easier to modify

**Cons:**
- Extra heap allocation per entity
- More GC work (pointer chasing)
- Cache unfriendly

**Recommendation:** Keep as pointer, but consider:

```go
// For small, immutable data, use values
type EntityID string  // 16 bytes - good for map keys

// For large, mutable data, use pointers
type Entity struct { ... }  // 200+ bytes - pointer is correct
```

### 5.2 String Lifetime Management

**Problem:** Strings in EntityMention hold references to source text:

```go
type EntityMention struct {
    EntityID  string  // OK - short, interned
    Text      string  // ⚠️ May reference large source text
    ChapterID uint32
    ChunkID   uint32
    Start     int
    End       int
}
```

If source text is 1MB and we have 1000 mentions, each holding a substring:
- Go's string slicing shares underlying array
- Source text cannot be GC'd until all mentions are released

**Recommendation:**
```go
// Option A: Copy strings for long-term storage
func (m *EntityMention) SetText(text string) {
    m.Text = strings.Clone(text)  // Go 1.20+
}

// Option B: Use offsets only, don't store text
type EntityMention struct {
    EntityID  string
    Start     int
    End       int  // Text can be reconstructed from source
}
```

### 5.3 Finalizers for Cleanup

**Current:** No explicit cleanup mechanism

**Recommendation:** Add cleanup method:

```go
func (r *GlobalEntityRegistry) Clear() {
    r.mu.Lock()
    defer r.mu.Unlock()
    
    // Clear all maps
    r.entities = make(map[string]*Entity)
    r.aliases = make(map[string]string)
    r.variants = make(map[string]string)
    r.chapterIndex = make(map[uint32][]string)
    r.entityChapters = make(map[string][]uint32)
    r.mentions = nil  // Release for GC
    r.mentionIdx = make(map[string][]int)
    r.chapterStats = make(map[uint32]*ChapterStats)
    r.cooccurrences = make(map[string]int)
}
```

---

## 6. Memory Leak Vectors

### 6.1 DocumentGraph Lifecycle

**Location:** [`graptor_conductor.go:63-74`](GoKitt/pkg/graptor/graptor_conductor.go:63)

```go
type DocumentGraph struct {
    Chapters          map[uint32]*ChapterGraph
    CrossChapterEdges []*CrossChapterEdge
    Registry          *GlobalEntityRegistry  // ⚠️ Holds all entities
    Cooccurrence      *CooccurrenceStats     // ⚠️ Holds all pairs
}
```

**Problem:** DocumentGraph holds references to:
- All chapter graphs (each with ConceptGraph)
- All entities (via Registry)
- All co-occurrence pairs

If DocumentGraph is not released, all associated memory is retained.

**Recommendation:**
```go
// Add explicit disposal
func (dg *DocumentGraph) Dispose() {
    dg.Registry.Clear()
    dg.Cooccurrence.Clear()
    
    for _, cg := range dg.Chapters {
        cg.Graph = nil  // Release graph
    }
    dg.Chapters = nil
    dg.CrossChapterEdges = nil
}
```

### 6.2 Chapter Context Accumulation

**Location:** [`chapter_context.go:18-19`](GoKitt/pkg/graptor/chapter_context.go:18)

```go
FirstMentions  map[string]*EntityMention // entityID → first mention
ActiveEntities map[string]int            // entityID → mention count
```

**Problem:** FirstMentions holds EntityMention pointers indefinitely.

**Recommendation:**
```go
// After chapter is processed, clear FirstMentions
func (cc *ChapterContext) Finish() {
    cc.FirstMentions = nil  // Release mentions
    cc.FinishedAt = time.Now().Unix()
}
```

---

## 7. Recommendations Summary

### High Priority

| Issue | Location | Fix |
|-------|----------|-----|
| Unbounded mentions slice | entity_registry.go:120 | Add max limit or streaming |
| String references to source | EntityMention.Text | Copy or use offsets only |
| No cleanup mechanism | GlobalEntityRegistry | Add Clear() method |

### Medium Priority

| Issue | Location | Fix |
|-------|----------|-----|
| Quadratic co-occurrence | entity_registry.go:127 | Add threshold or sparse matrix |
| O(n) LastMentioned ops | chapter_context.go:89 | Use ring buffer |
| Pre-allocation defaults | entity_registry.go:153 | Scale with document size |

### Low Priority

| Issue | Location | Fix |
|-------|----------|-----|
| String duplication | aliases map | Intern canonical IDs |
| Map rehashing | all maps | Dynamic sizing |
| Entity.Aliases growth | entity_registry.go:77 | Deduplication check |

---

## 8. Implementation Priority

### Phase 1: Critical Fixes (Immediate)

1. Add `Clear()` method to GlobalEntityRegistry
2. Add `Dispose()` method to DocumentGraph
3. Add max limit to mentions slice

### Phase 2: Optimization (Next Sprint)

1. Implement streaming mention processing
2. Add co-occurrence threshold
3. Optimize LastMentioned with ring buffer

### Phase 3: Fine-tuning (Future)

1. String interning for canonical IDs
2. Dynamic pre-allocation sizing
3. Memory profiling integration

---

## 9. Testing Recommendations

### Memory Leak Tests

```go
func TestMemoryLeak(t *testing.T) {
    var m1, m2 runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&m1)
    
    // Process large document
    for i := 0; i < 100; i++ {
        dg := ProcessDocument(largeText)
        dg.Dispose()
    }
    
    runtime.GC()
    runtime.ReadMemStats(&m2)
    
    // Memory should not grow significantly
    growth := m2.Alloc - m1.Alloc
    if growth > 1*1024*1024 { // 1MB tolerance
        t.Errorf("Memory leak: grew by %d bytes", growth)
    }
}
```

### Benchmark Tests

```go
func BenchmarkEntityRegistry(b *testing.B) {
    for i := 0; i < b.N; i++ {
        registry := NewGlobalEntityRegistry(nil)
        for j := 0; j < 1000; j++ {
            registry.Register(fmt.Sprintf("entity-%d", j), KindPerson, 0, 0)
        }
    }
}
```

---

## 10. Conclusion

The Graptor package has a solid foundation with pre-allocation hints and reasonable defaults. However, there are several memory enhancement opportunities:

1. **Critical:** Unbounded growth in mentions slice needs immediate attention
2. **Important:** String references prevent GC of source text
3. **Optimization:** Co-occurrence tracking scales quadratically

The recommended fixes are straightforward and can be implemented incrementally without breaking the existing API.

---

*Report generated: 2026-02-23*
*Analyzed files: entity_registry.go, chapter_context.go, graptor_conductor.go, cooccurrence.go, pool.go*
