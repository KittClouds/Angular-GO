# Graptor + Reality Integration Plan

## Implementation Status (Updated 2026-02-23)

### ✅ All Phases Complete

| Phase | Component | Status | Files |
|-------|-----------|--------|-------|
| **Phase 1** | GlobalEntityRegistry | ✅ Complete | [`entity_registry.go`](GoKitt/pkg/graptor/entity_registry.go) (917 lines) |
| **Phase 2** | ChapterContext | ✅ Complete | [`chapter_context.go`](GoKitt/pkg/graptor/chapter_context.go) |
| **Phase 3** | Conductor Integration | ✅ Complete | Dictionary seeding, ID preservation |
| **Phase 4** | Projector Integration | ✅ Complete | Uses Reality's Projector in `processLeaf()` |
| **Phase 5** | GraptorConductor | ✅ Complete | [`graptor_conductor.go`](GoKitt/pkg/graptor/graptor_conductor.go) (700+ lines) |
| **Phase 6** | Co-occurrence Statistics | ✅ Complete | [`cooccurrence.go`](GoKitt/pkg/graptor/cooccurrence.go) |
| **Phase 6** | Alias Propagation | ✅ Complete | [`alias_detection.go`](GoKitt/pkg/graptor/alias_detection.go) |
| **Phase 6** | Chapter Transition | ✅ Complete | Implemented in `chapter_context.go` |

### Test Results

```
📊 MULTI-CHAPTER ENTITIES:
  Ryan: appears in 11 chapters [0 1 2 3 4 5 6 7 8 9 10]
  Len: appears in 11 chapters [0 1 2 3 4 5 6 7 8 9 10]
  Wyvern: appears in 8 chapters [0 1 2 3 6 7 9 10]
  Ghoul: appears in 9 chapters [0 1 2 3 4 5 6 7 9]
  Zanbato: appears in 8 chapters [0 3 4 5 6 7 9 10]
  Meta-Gang: appears in 11 chapters [0 1 2 3 4 5 6 7 8 9 10]
  Augusti: appears in 10 chapters [0 1 2 3 4 5 6 7 9 10]
  New Rome: appears in 7 chapters [0 1 2 3 7 9 10]
```

### Phase 6 Implementation Details

#### Alias Propagation Strategy
- **File**: [`alias_detection.go`](GoKitt/pkg/graptor/alias_detection.go)
- **Patterns Supported**:
  - "X, also known as Y"
  - "X, aka Y"
  - "X (Y)" parenthetical
  - "X or Y"
  - "X, real name Y"
  - "X, otherwise known as Y"
  - "X - Y" dash separated
- **Integration**: Called in `processLeaf()` via `detectAndRegisterAliases()`
- **Registry Update**: Automatically adds detected aliases to `GlobalEntityRegistry`

#### Chapter Transition Strategy
- **File**: [`chapter_context.go`](GoKitt/pkg/graptor/chapter_context.go)
- **Components**:
  - `ChapterContext.Finish()` - Computes carry-over entities based on gender and recency
  - `ChapterTransition.ResolvePronoun()` - Resolves pronouns at chapter boundaries
  - `ChapterManager.CreateTransition()` - Creates transition handler between chapters
- **Carry-over Logic**: Prioritizes entities with known gender for pronoun resolution

#### Co-occurrence Statistics
- **File**: [`cooccurrence.go`](GoKitt/pkg/graptor/cooccurrence.go)
- **Features**:
  - Tracks entity pair co-occurrences within sliding windows
  - Provides `GetRelated()` for relationship queries
  - Integrated in `processLeaf()` for automatic tracking

### ❌ Remaining Work (Future Enhancement)

| Component | Description |
|-----------|-------------|
| SQLite Persistence | Store GlobalEntityRegistry in database for document reload |

---

## Executive Summary

**Goal**: Integrate the existing Reality layer (CST → Graph) with Graptor's cross-chapter entity linking to create a fully unified ingestion pipeline.

**Key Insight**: Reality already creates graphs from text. We need to inject Graptor's GlobalEntityRegistry at the right integration points.

---

## Current Architecture Analysis

### The Reality Stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            REALITY LAYER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Text ──► Conductor.Scan() ──► ScanResult                                   │
│                                     │                                        │
│                                     ▼                                        │
│                              Builder.Zip() ──► CST                           │
│                                     │                                        │
│                                     ▼                                        │
│                           Projector.Project() ──► ConceptGraph               │
│                                     │                                        │
│                                     ▼                                        │
│                          Merger.AddScannerGraph() ──► MergedGraph            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Location | Role | Current Limitation |
|-----------|----------|------|-------------------|
| **Conductor** | [`pkg/scanner/conductor/conductor.go`](GoKitt/pkg/scanner/conductor/conductor.go) | Orchestrates NER pipeline | Per-scan scope only |
| **Discovery** | [`pkg/scanner/discovery/engine.go`](GoKitt/pkg/scanner/discovery/engine.go) | Unsupervised NER via relational patterns | No cross-chapter memory |
| **Resolver** | [`pkg/scanner/resolver/resolver.go`](GoKitt/pkg/scanner/resolver/resolver.go) | Pronoun resolution | `maxHistory = 10` |
| **Builder/Zipper** | [`pkg/reality/builder/zipper.go`](GoKitt/pkg/reality/builder/zipper.go) | CST construction from ScanResult | No chapter awareness |
| **Projector** | [`pkg/reality/projection/projector.go`](GoKitt/pkg/reality/projection/projector.go) | CST → Graph projection | Uses local EntityMap |
| **Merger** | [`pkg/reality/merger/merger.go`](GoKitt/pkg/reality/merger/merger.go) | Combines multiple graph sources | No entity deduplication |

---

## Data Flow Deep Dive

### Phase 1: Discovery Anchoring

```go
// From discovery/engine.go - The "Virus" Pattern
func (e *DiscoveryEngine) ScanText(text string) []DiscoveryCandidate {
    // Pattern: Source (Known) → Verb → Target (Capitalized)
    // If Source is Promoted + Has Kind, and Verb matches narrative pattern,
    // then Target becomes a candidate entity.
    
    for i := 0; i < len(tokens)-2; i++ {
        sourceTok := tokens[i]
        verbTok := tokens[i+1]
        targetTok := tokens[i+2]
        
        // 1. Source must be Known + Promoted + Have Kind
        sourceStats := e.Registry.GetStats(sourceTok)
        if sourceStats.Status != StatusPromoted {
            continue
        }
        
        // 2. Target must be Capitalized
        if !isCapitalized(targetTok) {
            continue
        }
        
        // 3. Verb must match narrative pattern
        verbMatch := e.Matcher.Lookup(verbTok)
        if verbMatch == nil {
            continue
        }
        
        // 4. Infer target kind from source + verb
        inferredKind := e.Scanner.InferTarget(*sourceStats.InferredKind, verbMatch)
    }
}
```

**Key Insight**: Discovery already does entity anchoring via relational inference. This is the "seed" for cross-chapter linking.

### Phase 2: CST Construction

```go
// From builder/zipper.go
func Zip(text string, scan conductor.ScanResult) *cst.Node {
    spans := collectSpans(text, scan)
    
    // Spans include:
    // - Paragraphs (priority 90)
    // - Sentences (priority 80)
    // - Chunks - NP, VP, PP (priority 50)
    // - EntitySpans (priority 40)
    // - Tokens (priority 10)
    
    // Build tree via event-based construction
    // Higher priority = outer container
}
```

**Key Insight**: CST provides structural context. Entity spans are embedded in the tree with parent/child relationships.

### Phase 3: Graph Projection

```go
// From projection/projector.go
func Project(root *cst.Node, matcher *narrative.NarrativeMatcher, 
             entities EntityMap, text string, prov *hierarchy.ProvenanceContext) *graph.ConceptGraph {
    
    // EntityMap is: offset → entityID
    // Used to resolve EntitySpan nodes to actual entity IDs
    
    // Walk CST looking for Sentences
    // For each VP, find Subject (left NP) and Object (right NP)
    // Create edge: Subject --[Relation]--> Object
}
```

**Key Insight**: Projector uses EntityMap to resolve entity spans. This is where GlobalEntityRegistry should integrate.

---

## Integration Architecture

### Unified Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      GRAPTOR + REALITY INTEGRATION                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Document                                                                   │
│      │                                                                       │
│      ▼                                                                       │
│   ChunkerX2.ChunkDocumentExtended() ──► ChunkTreeExtended                   │
│      │                              (Chapters → Parents → Leaves)            │
│      │                                                                       │
│      ├──────────────────────────────────────────────────────────┐            │
│      │                                                          │            │
│      ▼                                                          ▼            │
│   For each Chapter:                                    GlobalEntityRegistry  │
│      │                                                       │              │
│      ▼                                                       │              │
│   For each Leaf:                                             │              │
│      │                                                       │              │
│      ▼                                                       │              │
│   ┌────────────────────────────────────────┐                 │              │
│   │         Conductor.Scan(leaf.Text)       │                 │              │
│   │  ┌────────────────────────────────────┐ │                 │              │
│   │  │ Discovery (Virus)                  │ │                 │              │
│   │  │  - Relational entity discovery     │ │                 │              │
│   │  │  - Kind inference                  │ │                 │              │
│   │  └────────────────────────────────────┘ │                 │              │
│   │  ┌────────────────────────────────────┐ │                 │              │
│   │  │ Implicit Matcher (Registry)        │◄┼─────────────────┘              │
│   │  │  - Aho-Corasick exact match        │ │                                │
│   │  │  - Alias lookup                    │ │                                │
│   │  └────────────────────────────────────┘ │                                │
│   │  ┌────────────────────────────────────┐ │                                │
│   │  │ Resolver (Pronouns)                │ │                                │
│   │  │  - Gender-aware resolution         │ │                                │
│   │  │  - History: 10 (per-leaf)          │ │                                │
│   │  └────────────────────────────────────┘ │                                │
│   └────────────────────────────────────────┘                 │              │
│      │                                                       │              │
│      ▼                                                       │              │
│   ScanResult ──► Builder.Zip() ──► CST                       │              │
│      │                              │                        │              │
│      │                              ▼                        │              │
│      │                    Projector.Project()                │              │
│      │                              │                        │              │
│      │                              ▼                        │              │
│      │                    LeafGraph ◄────────────────────────┘              │
│      │                              │                                       │
│      ▼                              ▼                                       │
│   Register Entities ──► GlobalEntityRegistry.Update()                       │
│                              │                                              │
│                              ▼                                              │
│                    CrossChapterLinker.Link()                                │
│                              │                                              │
│                              ▼                                              │
│                    ChapterGraph (merged)                                    │
│                              │                                              │
│                              ▼                                              │
│                    DocumentGraph (final)                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Integration Points

### Point 1: GlobalEntityRegistry Injection

**Location**: [`Conductor.SetDictionary()`](GoKitt/pkg/scanner/conductor/conductor.go:74)

```go
// CURRENT
func (c *Conductor) SetDictionary(dict *implicitmatcher.RuntimeDictionary) {
    c.implicitScanner = dict
}

// PROPOSED: Add GlobalEntityRegistry
func (c *Conductor) SetGlobalRegistry(registry *graptor.GlobalEntityRegistry) {
    c.globalRegistry = registry
    // Also inject into Resolver for cross-chapter pronoun resolution
    c.resolver.SetGlobalRegistry(registry)
}
```

### Point 2: EntityMap Construction

**Location**: [`Projector.Project()`](GoKitt/pkg/reality/projection/projector.go:18)

```go
// CURRENT: EntityMap is built per-scan
type EntityMap map[int]string  // offset → entityID

// PROPOSED: Use GlobalEntityRegistry for resolution
func Project(root *cst.Node, matcher *narrative.NarrativeMatcher,
             registry *graptor.GlobalEntityRegistry,  // Changed from EntityMap
             text string, prov *hierarchy.ProvenanceContext) *graph.ConceptGraph {
    
    // Resolve entities via registry instead of static map
    // This enables cross-chapter alias matching
}
```

### Point 3: Resolver History Expansion

**Location**: [`resolver.NarrativeContext`](GoKitt/pkg/scanner/resolver/resolver.go:33)

```go
// CURRENT: Limited history
type NarrativeContext struct {
    history    []string  // maxHistory = 10
    maxHistory int
}

// PROPOSED: Chapter-aware history
type NarrativeContext struct {
    localHistory   []string           // Per-leaf history (10)
    globalRegistry *GlobalEntityRegistry  // Cross-chapter lookup
    chapterContext *ChapterContext    // Entities active in current chapter
}
```

### Point 4: Discovery → Registry Feedback Loop

**Location**: [`DiscoveryEngine.ScanText()`](GoKitt/pkg/scanner/discovery/engine.go:52)

```go
// CURRENT: Discovery candidates are per-scan
func (e *DiscoveryEngine) ScanText(text string) []DiscoveryCandidate

// PROPOSED: Feed discovered entities back to GlobalEntityRegistry
func (e *DiscoveryEngine) ScanText(text string, registry *graptor.GlobalEntityRegistry) []DiscoveryCandidate {
    candidates := e.scanTextInternal(text)
    
    // Register discovered entities globally
    for _, cand := range candidates {
        registry.RegisterMention(cand.Text, cand.Kind, currentChapter)
    }
    
    return candidates
}
```

---

## New Components

### 1. ChapterContext

```go
// pkg/graptor/chapter_context.go
package graptor

// ChapterContext maintains entity state within a chapter
type ChapterContext struct {
    ChapterID      uint32
    
    // Entities first mentioned in this chapter
    FirstMentions  map[string]*EntityMention  // entityID → first mention
    
    // Entities active (mentioned) in this chapter
    ActiveEntities map[string]int  // entityID → mention count
    
    // Last N entities mentioned (for pronoun resolution at chapter boundary)
    LastMentioned  []string  // max 20
    
    // Carry-over to next chapter
    CarryOver      []string  // Entities to propagate to next chapter
}

// ChapterTransition handles chapter boundary logic
type ChapterTransition struct {
    prevContext *ChapterContext
    currContext *ChapterContext
    registry    *GlobalEntityRegistry
}

// ResolveAtBoundary resolves pronouns at chapter start using previous chapter context
func (ct *ChapterTransition) ResolveAtBoundary(pronoun string, gender Gender) string {
    // Check carry-over from previous chapter first
    for _, entityID := range ct.prevContext.CarryOver {
        if entity, ok := ct.registry.Get(entityID); ok {
            if gendersCompatible(entity.Gender, gender) {
                return entityID
            }
        }
    }
    return ""
}
```

### 2. GraptorConductor

```go
// pkg/graptor/graptor_conductor.go
package graptor

import (
    "github.com/kittclouds/gokitt/pkg/chunker"
    "github.com/kittclouds/gokitt/pkg/scanner/conductor"
    "github.com/kittclouds/gokitt/pkg/reality/builder"
    "github.com/kittclouds/gokitt/pkg/reality/projection"
)

// GraptorConductor orchestrates the full ingestion pipeline
type GraptorConductor struct {
    chunker      *chunker.ChunkerX2
    conductor    *conductor.Conductor
    registry     *GlobalEntityRegistry
    linker       *CrossChapterLinker
    merger       *ChapterMerger
}

// IngestDocument processes a full document
func (gc *GraptorConductor) IngestDocument(docID, text string) *DocumentGraph {
    // 1. Chunk into 3-level hierarchy
    chunkTree := gc.chunker.ChunkDocumentExtended(docID, text)
    
    // 2. Process each chapter
    for _, chapter := range chunkTree.Chapters {
        gc.processChapter(chapter)
    }
    
    // 3. Cross-chapter linking
    gc.linker.LinkAllChapters(gc.registry)
    
    // 4. Build final document graph
    return gc.merger.Merge()
}

func (gc *GraptorConductor) processChapter(chapter *chunker.ChapterNode) {
    chapterCtx := NewChapterContext(chapter.ID)
    
    // Process each leaf in chapter
    for _, leaf := range chapter.Leaves {
        gc.processLeaf(leaf, chapterCtx)
    }
    
    // Store chapter context for cross-chapter linking
    gc.registry.AddChapterContext(chapter.ID, chapterCtx)
}

func (gc *GraptorConductor) processLeaf(leaf *chunker.LeafNode, ctx *ChapterContext) *graph.ConceptGraph {
    // 1. Run Conductor scan
    scanResult := gc.conductor.Scan(leaf.Text)
    
    // 2. Build CST
    cst := builder.Zip(leaf.Text, scanResult)
    
    // 3. Project to graph (using global registry)
    leafGraph := projection.Project(cst, gc.conductor.GetMatcher(), 
                                    gc.registry, leaf.Text, nil)
    
    // 4. Register entities in global registry
    for _, entity := range leafGraph.AllNodes() {
        gc.registry.RegisterMention(entity.ID, entity.Kind, ctx.ChapterID)
    }
    
    return leafGraph
}
```

### 3. ChapterMerger

```go
// pkg/graptor/chapter_merger.go
package graptor

// ChapterMerger combines leaf graphs into chapter graphs, then document graph
type ChapterMerger struct {
    leafGraphs    map[uint32][]*graph.ConceptGraph  // chapterID → leaf graphs
    chapterGraphs map[uint32]*graph.ConceptGraph    // chapterID → merged chapter graph
    registry      *GlobalEntityRegistry
}

// AddLeafGraph adds a leaf graph to the chapter
func (cm *ChapterMerger) AddLeafGraph(chapterID uint32, g *graph.ConceptGraph) {
    cm.leafGraphs[chapterID] = append(cm.leafGraphs[chapterID], g)
}

// MergeChapter combines all leaf graphs in a chapter
func (cm *ChapterMerger) MergeChapter(chapterID uint32) *graph.ConceptGraph {
    merged := graph.NewGraph()
    
    for _, leafGraph := range cm.leafGraphs[chapterID] {
        // Merge nodes
        for _, node := range leafGraph.AllNodes() {
            merged.EnsureNode(node.ID, node.Label, node.Kind)
        }
        
        // Merge edges (deduplicate using registry)
        for _, edge := range leafGraph.AllEdges() {
            // Normalize entity IDs using registry
            sourceID := cm.registry.NormalizeID(edge.Source.ID)
            targetID := cm.registry.NormalizeID(edge.Target.ID)
            
            merged.AddEdge(sourceID, targetID, edge.Edge.Relation, edge.Edge.Weight)
        }
    }
    
    cm.chapterGraphs[chapterID] = merged
    return merged
}

// Merge combines all chapter graphs into document graph
func (cm *ChapterMerger) Merge() *DocumentGraph {
    docGraph := &DocumentGraph{
        Chapters: make(map[uint32]*graph.ConceptGraph),
        CrossChapterEdges: []*CrossChapterEdge{},
    }
    
    // Merge each chapter
    for chapterID := range cm.leafGraphs {
        docGraph.Chapters[chapterID] = cm.MergeChapter(chapterID)
    }
    
    // Add cross-chapter edges from registry
    for _, link := range cm.registry.GetCrossChapterLinks() {
        docGraph.CrossChapterEdges = append(docGraph.CrossChapterEdges, link)
    }
    
    return docGraph
}
```

---

## Cross-Chapter Linking Strategies

### Strategy 1: Alias Propagation

```go
// When "Ryan Romano" and "Quicksave" appear in same sentence:
// 1. Detect apposition pattern: "Ryan Romano, also known as Quicksave"
// 2. Register as aliases in GlobalEntityRegistry
// 3. Propagate to all chapters

func (r *GlobalEntityRegistry) RegisterAliasFromApposition(text string, entities []string) {
    if len(entities) == 2 {
        // Check for apposition pattern
        if strings.Contains(text, "also known as") ||
           strings.Contains(text, "aka") ||
           strings.Contains(text, ", the ") {
            r.AddAlias(entities[0], entities[1])
        }
    }
}
```

### Strategy 2: Chapter Transition Carry-Over

```go
// Last mentioned entities in Chapter N become candidates for pronouns in Chapter N+1

func (r *GlobalEntityRegistry) GetCarryOverEntities(chapterID uint32) []string {
    ctx := r.chapterContexts[chapterID]
    
    // Sort by recency, take top N
    sorted := sortEntitiesByLastMention(ctx.ActiveEntities)
    
    carryOver := make([]string, 0, 10)
    for _, entityID := range sorted[:min(10, len(sorted))] {
        entity := r.entities[entityID]
        // Prefer entities with gender (for pronoun resolution)
        if entity.Gender != GenderUnknown {
            carryOver = append(carryOver, entityID)
        }
    }
    
    return carryOver
}
```

### Strategy 3: Co-occurrence Statistics

```go
// Entities appearing together frequently are likely related

type CooccurrenceStats struct {
    pairCounts  map[string]int  // "entity1|entity2" → count
    windowSize  int             // sentences
}

func (cs *CooccurrenceStats) RecordCooccurrence(entities []string) {
    for i, e1 := range entities {
        for _, e2 := range entities[i+1:] {
            key := cooccurrenceKey(e1, e2)
            cs.pairCounts[key]++
        }
    }
}

func (cs *CooccurrenceStats) GetRelated(entityID string, threshold int) []string {
    related := []string{}
    for key, count := range cs.pairCounts {
        if count >= threshold {
            e1, e2 := parseCooccurrenceKey(key)
            if e1 == entityID {
                related = append(related, e2)
            } else if e2 == entityID {
                related = append(related, e1)
            }
        }
    }
    return related
}
```

---

## Implementation Phases

### Phase 1: GlobalEntityRegistry (Week 1)

1. Create `pkg/graptor/entity_registry.go`
2. Implement core registry with:
   - Entity storage (canonical ID → Entity)
   - Alias map (alias → canonical ID)
   - Chapter index (chapter → entities)
   - Entity chapters (entity → chapters)
3. Write unit tests

### Phase 2: ChapterContext (Week 1)

1. Create `pkg/graptor/chapter_context.go`
2. Implement chapter-scoped entity tracking
3. Integrate with Resolver for chapter-boundary pronoun resolution
4. Write unit tests

### Phase 3: Conductor Integration (Week 2)

1. Modify `Conductor` to accept `GlobalEntityRegistry`
2. Update `Resolver` to use global registry for lookups
3. Update `Discovery` to feed entities to registry
4. Integration tests

### Phase 4: Projector Integration (Week 2)

1. Modify `Projector.Project()` to use `GlobalEntityRegistry`
2. Update entity resolution logic
3. Add cross-chapter edge creation
4. Integration tests

### Phase 5: GraptorConductor (Week 3)

1. Create `pkg/graptor/graptor_conductor.go`
2. Implement full pipeline orchestration
3. Integrate ChunkerX2
4. End-to-end tests with `docs/perfect_run.md`

### Phase 6: Cross-Chapter Linking (Week 3-4)

1. Implement alias propagation strategy
2. Implement chapter transition strategy
3. Implement co-occurrence statistics
4. Validation tests

---

## File Structure

```
GoKitt/pkg/graptor/
├── graptor_conductor.go      # Main pipeline orchestrator
├── entity_registry.go        # Global entity registry
├── entity_matcher.go         # String-based matching
├── chapter_context.go        # Chapter-scoped context
├── chapter_merger.go         # Graph merging
├── cross_chapter_linker.go   # Cross-chapter strategies
├── strategies/
│   ├── alias_propagation.go
│   ├── chapter_transition.go
│   └── cooccurrence.go
└── graptor_test.go
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Entity history scope | 10 mentions | Unlimited (global) |
| Cross-chapter linking | None | 85%+ accuracy |
| Alias propagation | Manual | Automatic |
| Chapter boundary resolution | None | 80%+ accuracy |
| Memory per 1MB document | N/A | < 100MB |
| Processing time per chapter | N/A | < 100ms |

---

## Design Decisions (Confirmed)

Based on user feedback, the following design decisions have been made:

### 1. Separation from Original Systems
- **Decision**: Keep Graptor components completely separate from existing systems
- **Rationale**: Easier debugging, no risk of breaking existing functionality
- **Implementation**: Graptor has its own package (`pkg/graptor/`) with no modifications to existing packages

### 2. Persistence
- **Decision**: Persist GlobalEntityRegistry to SQLiteStore
- **Rationale**: Cross-session entity memory, supports incremental document processing
- **Implementation**: New SQLite tables for entities, aliases, and chapter indices

### 3. Conductor Architecture
- **Decision**: Create new GraptorConductor (not wrapping existing Conductor)
- **Rationale**: Clean separation, purpose-built for cross-chapter processing
- **Implementation**: GraptorConductor uses its own internal pipeline components

### 4. Graph Output Type
- **Decision**: Create new chapter-aware DocumentGraph type
- **Rationale**: Need chapter-level granularity for cross-chapter linking
- **Implementation**: New type with chapter graphs + cross-chapter edges

---

## SQLite Schema for GlobalEntityRegistry

```sql
-- Graptor Entity Tables (separate from existing entities table)

-- Canonical entities
CREATE TABLE IF NOT EXISTS graptor_entities (
    id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    gender TEXT,
    first_chapter_id INTEGER,
    first_chunk_id INTEGER,
    total_mentions INTEGER DEFAULT 1,
    created_at INTEGER,
    updated_at INTEGER
);

-- Aliases (all known surface forms)
CREATE TABLE IF NOT EXISTS graptor_aliases (
    alias TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    source TEXT,  -- 'explicit', 'discovered', 'apposition', 'user'
    confidence REAL DEFAULT 1.0,
    PRIMARY KEY (alias, entity_id),
    FOREIGN KEY (entity_id) REFERENCES graptor_entities(id)
);

-- Chapter index (which entities appear in which chapters)
CREATE TABLE IF NOT EXISTS graptor_chapter_entities (
    chapter_id INTEGER NOT NULL,
    entity_id TEXT NOT NULL,
    mention_count INTEGER DEFAULT 1,
    first_mention_offset INTEGER,
    last_mention_offset INTEGER,
    PRIMARY KEY (chapter_id, entity_id),
    FOREIGN KEY (entity_id) REFERENCES graptor_entities(id)
);

-- Cross-chapter links (provenance for entity linking)
CREATE TABLE IF NOT EXISTS graptor_cross_chapter_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    link_type TEXT NOT NULL,  -- 'SAME_AS', 'ALIAS_OF', 'RELATED_TO'
    confidence REAL,
    source_chapter INTEGER,
    evidence TEXT,  -- JSON: {text, offset, pattern}
    created_at INTEGER,
    FOREIGN KEY (source_entity_id) REFERENCES graptor_entities(id),
    FOREIGN KEY (target_entity_id) REFERENCES graptor_entities(id)
);

-- Co-occurrence statistics
CREATE TABLE IF NOT EXISTS graptor_cooccurrences (
    entity1_id TEXT NOT NULL,
    entity2_id TEXT NOT NULL,
    cooccurrence_count INTEGER DEFAULT 1,
    last_chapter INTEGER,
    PRIMARY KEY (entity1_id, entity2_id),
    FOREIGN KEY (entity1_id) REFERENCES graptor_entities(id),
    FOREIGN KEY (entity2_id) REFERENCES graptor_entities(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_graptor_aliases_entity ON graptor_aliases(entity_id);
CREATE INDEX IF NOT EXISTS idx_graptor_chapter_entities_entity ON graptor_chapter_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_graptor_cross_chapter_source ON graptor_cross_chapter_links(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_graptor_cross_chapter_target ON graptor_cross_chapter_links(target_entity_id);
```
