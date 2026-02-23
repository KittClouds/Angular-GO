# Graptor: Embedding-Free Cross-Chapter Entity Linking

## Executive Summary

**Goal**: Implement cross-chapter entity linking WITHOUT embeddings, leveraging the new ChunkerX2's 3-level hierarchy (Chapters → Parents → Leaves).

**Key Insight**: We already have the pieces! The integration layer is what's missing.

---

## Existing Infrastructure (We Already Have This!)

| Component | Location | Purpose |
|-----------|----------|---------|
| **RuntimeDictionary** | `pkg/implicit-matcher/dictionary.go` | Aho-Corasick exact matching + alias lookup |
| **SQLiteStore** | `internal/store/sqlite_store.go` | Entity registry with `entities` table |
| **GraphStore** | `internal/graphstore/` | Edge storage for entity relationships |
| **Conductor** | `pkg/scanner/conductor/` | Discovery + SVO + Resolver pipeline |
| **ChunkerX2** | `pkg/chunker/chunkerx.go` | 3-level hierarchy (Chapters → Parents → Leaves) |

### What RuntimeDictionary Already Does

```go
// Lookup finds entities matching a surface form (exact dictionary lookup)
func (d *RuntimeDictionary) Lookup(surface string) []*EntityInfo

// Scan finds all entity mentions in text (O(n) via AC)
func (d *RuntimeDictionary) Scan(text string) []Match

// CanonicalizeForMatch - shared canonicalizer for patterns AND input
func CanonicalizeForMatch(s string) string
```

### What SQLiteStore Already Has

```sql
-- Entities (Registry)
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    aliases TEXT,           -- JSON array of aliases
    first_note TEXT,
    total_mentions INTEGER,
    narrative_id TEXT
);

-- Edges (Graph)
CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    rel_type TEXT NOT NULL,
    confidence REAL
);
```

---

## What's Missing: Integration Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                      DOCUMENT INGESTION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Raw Text ──► ChunkerX2 ──► ChunkTreeExtended                  │
│                                  │                               │
│                    ┌─────────────┼─────────────┐                │
│                    ▼             ▼             ▼                │
│               Chapters      Parents       Leaves                │
│               (Level 2)     (Level 1)     (Level 0)             │
│                    │             │             │                │
│                    │             │             │                │
│                    ▼             ▼             ▼                │
│               Chapter      Parent Scope   Leaf Processing       │
│               Boundary     (Overlap)      ┌──────────────┐      │
│                    │                      │  Conductor    │      │
│                    │                      │  ──────────── │      │
│                    │                      │  Discovery    │      │
│                    │                      │  SVO Chunker  │      │
│                    │                      │  Narrative    │      │
│                    │                      │  Resolver     │      │
│                    │                      └──────────────┘      │
│                    │                              │              │
│                    ▼                              ▼              │
│               CHAPTER-LEVEL              LEAF-LEVEL              │
│               ENTITY INDEX               ENTITY GRAPH            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Cross-Chapter Entity Linking Problem

### Current Resolver Limitations

```go
// Current NarrativeContext - single document scope
type NarrativeContext struct {
    history    []string         // Stack of entity IDs (max 10)
    registry   map[string]EntityMetadata
    maxHistory int              // Default: 10
}
```

**Problem**: History is limited to 10 mentions. In a 131-chapter book, entities from Chapter 1 are forgotten by Chapter 3.

### What We Need

1. **Global Entity Registry** - All entities across all chapters
2. **Chapter-Scoped Context** - Entities active in each chapter
3. **Cross-Chapter Linking** - Connect "Ryan" in Ch.1 to "Quicksave" in Ch.50
4. **No Embeddings** - Use string matching + structural cues only

---

## Proposed Solution: Multi-Level Entity Graph

### Level 0: Leaf Entity Graph (Intra-Leaf)

Already implemented via Conductor:
- Discovery finds entities
- Resolver resolves pronouns within leaf
- SVO extracts relations

### Level 1: Parent Entity Graph (Cross-Leaf via Overlap)

**NEW**: Link entities across leaves that share a parent chunk.

```go
// Parent chunks have overlapping leaves
// Parent A: [Leaf1, Leaf2, Leaf3]
// Parent B: [Leaf3, Leaf4, Leaf5]
// 
// Entity in Leaf3 can link to entities in Leaf1, Leaf2, Leaf4, Leaf5
// via shared parents A and B
```

### Level 2: Chapter Entity Graph (Cross-Chapter)

**NEW**: Link entities across chapters using:

1. **Exact String Match** - "Ryan Romano" = "Ryan Romano"
2. **Alias Registry** - "Ryan" = "Romano" = "Quicksave" (built incrementally)
3. **Title Patterns** - "Mr. Smith" → "Smith"
4. **Co-occurrence Statistics** - Entities appearing together frequently

---

## Implementation Plan

### Phase 1: Global Entity Registry

**File**: `GoKitt/pkg/graptor/entity_registry.go`

```go
// GlobalEntityRegistry maintains all entities across the entire document
type GlobalEntityRegistry struct {
    mu            sync.RWMutex
    
    // Canonical ID → Entity
    entities      map[string]*Entity
    
    // All known aliases → Canonical ID
    aliases       map[string]string
    
    // Text variant → Canonical ID (for fuzzy matching)
    variants      map[string]string
    
    // Chapter → Entities first mentioned in chapter
    chapterIndex  map[uint32][]string  // chapterID → entityIDs
    
    // Entity → Chapters where it appears
    entityChapters map[string][]uint32 // entityID → chapterIDs
}

type Entity struct {
    ID            string
    CanonicalName string
    Aliases       []string
    Kind          string        // Person, Location, Organization
    Gender        Gender
    FirstMention  uint32        // ChunkID of first appearance
    MentionCount  int
    Chapters      []uint32      // Chapter IDs where entity appears
}
```

### Phase 2: String-Based Entity Matching

**File**: `GoKitt/pkg/graptor/entity_matcher.go`

```go
// EntityMatcher performs embedding-free entity matching
type EntityMatcher struct {
    registry *GlobalEntityRegistry
    
    // Configurable thresholds
    exactMatchBonus      float64  // +1.0 for exact match
    aliasMatchBonus      float64  // +0.8 for known alias
    caseInsensitiveBonus float64  // +0.5 for case-insensitive match
    recencyDecay         float64  // Decay factor for recency
}

// MatchResult represents a potential entity match
type MatchResult struct {
    EntityID    string
    Confidence  float64
    MatchType   MatchType  // Exact, Alias, Fuzzy, Contextual
}

// Match finds the best entity for a given text mention
func (em *EntityMatcher) Match(text string, context *MatchContext) []MatchResult {
    // 1. Exact match check
    if id, ok := em.registry.aliases[text]; ok {
        return []MatchResult{{EntityID: id, Confidence: 1.0, MatchType: MatchExact}}
    }
    
    // 2. Case-insensitive match
    lowerText := strings.ToLower(text)
    if id, ok := em.registry.variants[lowerText]; ok {
        return []MatchResult{{EntityID: id, Confidence: 0.9, MatchType: MatchCaseInsensitive}}
    }
    
    // 3. Partial match (substring)
    // "Ryan Romano" matches "Ryan" or "Romano"
    results := em.partialMatch(text)
    
    // 4. Contextual match (using parent/chapter scope)
    results = append(results, em.contextualMatch(text, context)...)
    
    return results
}
```

### Phase 3: Cross-Chapter Linking Strategies

**File**: `GoKitt/pkg/graptor/cross_chapter_linker.go`

```go
// CrossChapterLinker links entities across chapters
type CrossChapterLinker struct {
    registry *GlobalEntityRegistry
    matcher  *EntityMatcher
}

// LinkStrategy defines a linking strategy
type LinkStrategy interface {
    Link(text string, context *LinkContext) []LinkCandidate
}

// Strategies:

// 1. ExactStringStrategy - Exact string matching
type ExactStringStrategy struct{}

// 2. AliasPropagationStrategy - Propagate aliases across chapters
// If "Ryan Romano" and "Quicksave" appear in same sentence in Ch.1,
// they become aliases for all chapters
type AliasPropagationStrategy struct{}

// 3. TitlePatternStrategy - "Mr. X", "Dr. Y", "Captain Z"
type TitlePatternStrategy struct {
    titles []string  // ["Mr.", "Mrs.", "Dr.", "Captain", "Professor"]
}

// 4. CooccurrenceStrategy - Entities appearing together are related
type CooccurrenceStrategy struct {
    windowSize    int     // Number of sentences
    minCooccurred int     // Minimum co-occurrences to link
}

// 5. ChapterTransitionStrategy - Track entities across chapter boundaries
// Last mentioned entities in Ch.N are candidates for pronouns in Ch.N+1
type ChapterTransitionStrategy struct {
    carryOverSize int  // How many entities to carry over
}
```

### Phase 4: Graptor Ingestion Pipeline

**File**: `GoKitt/pkg/graptor/graptor.go`

```go
// Graptor is the main ingestion pipeline
type Graptor struct {
    chunker      *chunker.ChunkerX2
    conductor    *conductor.Conductor
    registry     *GlobalEntityRegistry
    linker       *CrossChapterLinker
    graph        *EntityGraph
}

// Ingest processes a document
func (g *Graptor) Ingest(docID, text string) *IngestResult {
    // 1. Chunk document
    chunkTree := g.chunker.ChunkDocumentExtended(docID, text)
    
    // 2. Process each leaf
    for _, leaf := range chunkTree.Leaves {
        // Run Conductor pipeline on leaf
        result := g.conductor.Scan(leaf.Text)
        
        // Register entities in global registry
        for _, ref := range result.ResolvedRefs {
            g.registerEntity(ref, leaf.ID, leaf.DocID)
        }
        
        // Build leaf-level entity graph
        g.buildLeafGraph(leaf.ID, result)
    }
    
    // 3. Cross-leaf linking via parents
    for _, parent := range chunkTree.Parents {
        g.linkViaParent(parent)
    }
    
    // 4. Cross-chapter linking
    for _, chapter := range chunkTree.Chapters {
        g.linkChapter(chapter)
    }
    
    // 5. Build final entity graph
    return g.buildResult(docID, chunkTree)
}
```

---

## Data Structures

### Entity Graph

```go
// EntityGraph is the final output
type EntityGraph struct {
    Nodes []*EntityNode
    Edges []*EntityEdge
}

type EntityNode struct {
    ID           string
    Name         string
    Kind         string
    Mentions     []*Mention
    Chapters     []uint32
}

type EntityEdge struct {
    Source string
    Target string
    Type   RelationType  // SAME_AS, RELATED_TO, PARENT_OF
    Weight float64
}

type Mention struct {
    ChunkID   uint32
    Text      string
    Start     int
    End       int
    ChapterID uint32
}
```

---

## Algorithm: Cross-Chapter Entity Resolution

```
ALGORITHM: ResolveEntity(mention, context)
INPUT: text mention, resolution context
OUTPUT: entity ID or nil

1. EXACT MATCH:
   IF mention.text IN registry.aliases:
      RETURN registry.aliases[mention.text]

2. CASE-INSENSITIVE MATCH:
   IF lowercase(mention.text) IN registry.variants:
      RETURN registry.variants[lowercase(mention.text)]

3. PARTIAL MATCH:
   candidates = []
   FOR each entity IN registry:
       IF mention.text IS substring OF entity.name:
          candidates.add(entity, score=0.7)
       IF entity.name IS substring OF mention.text:
          candidates.add(entity, score=0.6)

4. CONTEXTUAL MATCH:
   // Use parent chunk overlap
   parentEntities = entitiesInParent(mention.parentID)
   FOR each entity IN parentEntities:
       IF similar(entity.name, mention.text):
          candidates.add(entity, score=0.5)

5. CHAPTER TRANSITION:
   // Carry over from previous chapter
   IF mention IS pronoun:
      prevChapter = getPreviousChapter(mention.chapterID)
      carryOver = chapterCarryOver[prevChapter]
      FOR each entity IN carryOver:
          IF genderMatches(entity, mention.pronoun):
             candidates.add(entity, score=0.8)

6. RETURN best candidate OR create new entity
```

---

## Testing Strategy

### Unit Tests

1. **Entity Registry Tests**
   - Register entity
   - Add alias
   - Lookup by alias
   - Chapter indexing

2. **Matcher Tests**
   - Exact match
   - Case-insensitive match
   - Partial match
   - Contextual match

3. **Linker Tests**
   - Same entity across chapters
   - Alias propagation
   - Pronoun resolution across chapters

### Integration Tests

Use `docs/perfect_run.md` (131 chapters):
- Track "Ryan Romano" / "Quicksave" across all chapters
- Verify entity graph connectivity
- Measure precision/recall of linking

---

## Performance Considerations

### Memory

- Global registry: O(N) entities
- Alias map: O(M) aliases (M > N due to variants)
- Chapter index: O(C × E) where C=chapters, E=avg entities/chapter

### Time

- Entity lookup: O(1) via hash map
- Partial match: O(N) scan (can be optimized with trie)
- Cross-chapter linking: O(C × E²) worst case, but typically O(C × E) with pruning

---

## File Structure

```
GoKitt/pkg/graptor/
├── graptor.go              # Main pipeline
├── entity_registry.go      # Global entity registry
├── entity_matcher.go       # String-based matching
├── cross_chapter_linker.go # Cross-chapter strategies
├── entity_graph.go         # Graph data structures
├── strategies/
│   ├── exact_string.go
│   ├── alias_propagation.go
│   ├── title_pattern.go
│   ├── cooccurrence.go
│   └── chapter_transition.go
└── graptor_test.go
```

---

## Next Steps

1. **Create `pkg/graptor/` directory structure**
2. **Implement `GlobalEntityRegistry`**
3. **Implement `EntityMatcher` with exact + case-insensitive matching**
4. **Integrate with ChunkerX2 and Conductor**
5. **Test on `docs/perfect_run.md`**
6. **Add alias propagation strategy**
7. **Add chapter transition strategy**

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Entity linking precision | > 90% |
| Entity linking recall | > 80% |
| Memory per 1MB document | < 50MB |
| Processing time per 1MB | < 500ms |
| Cross-chapter link accuracy | > 85% |
