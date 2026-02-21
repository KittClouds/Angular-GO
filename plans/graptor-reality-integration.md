# GRAPTOR: Graph-Augmented RAPTOR with Reality Integration

**Status:** Architecture Design  
**Author:** KAMMI  
**Date:** 2026-02-21

---

## Executive Summary

GRAPTOR overlays a bipartite entity-chunk graph on top of existing RAPTOR trees. Unlike the original plan that used only the scanner pipeline, this refined architecture leverages the **full reality projection system** to extract richer semantic relationships including narrative events, provenance tracking, and proper entity resolution.

---

## The Problem

Our RAPTOR system builds one tree per document. Trees are structurally isolated:

- A chunk in `chapter-3` cannot "see" that the same character appears in `chapter-98`
- The scanner pipeline extracts entities and relations, but they never feed back into retrieval
- Entity knowledge and retrieval knowledge live in two disconnected worlds

---

## Why Mastra's GraphRAG Doesn't Fit

Mastra's approach (`packages/rag/src/graph-rag/index.ts`):

1. **Flat similarity graph** — connect chunks if cosine > threshold (O(n²) pair scan)
2. **Random-walk-with-restart (RWR) reranking** — walk the similarity graph to boost neighbors
3. **Only semantic edges** — no entity, hierarchy, or narrative edge types

**Problems for us:**

- O(n²) edge construction at scale (520+ leaf chunks per document)
- RWR on similarity graph is just smoothed vector search — no new information
- Zero entity awareness — two chunks mentioning "Kaido" never discover they're connected
- No hierarchy — parent/child structure of trees is lost

**Verdict:** The concept of graph reranking is useful. The implementation is not. We rebuild on our primitives.

---

## Architecture: GRAPTOR with Reality Integration

### Core Idea

Overlay a bipartite entity-chunk graph on top of existing RAPTOR trees. Use the **reality projection pipeline** to extract entities, relations, and narrative events from each chunk.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GRAPTOR ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐      │
│   │  Document A     │     │  Document B     │     │  Document C     │      │
│   │  RAPTOR Tree    │     │  RAPTOR Tree    │     │  RAPTOR Tree    │      │
│   └────────┬────────┘     └────────┬────────┘     └────────┬────────┘      │
│            │                       │                       │               │
│            ▼                       ▼                       ▼               │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                    ENTITY LINKER (Reality)                       │      │
│   │  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐     │      │
│   │  │ Chunker  │ → │ Scanner  │ → │   CST    │ → │Projector │     │      │
│   │  │          │   │Conductor │   │  Builder │   │          │     │      │
│   │  └──────────┘   └──────────┘   └──────────┘   └──────────┘     │      │
│   └──────────────────────────────┬──────────────────────────────────┘      │
│                                  │                                          │
│                                  ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                     GRAPH OVERLAY                                │      │
│   │  ┌─────────────────────────────────────────────────────────┐   │      │
│   │  │                 KnowledgeGraph                           │   │      │
│   │  │  ┌─────────┐  MENTIONED_IN  ┌─────────┐                │   │      │
│   │  │  │ Entity  │ ◄──────────────│  Chunk  │                │   │      │
│   │  │  │  Node   │───────────────►│  Node   │                │   │      │
│   │  │  └─────────┘ ENTITY_BRIDGE  └─────────┘                │   │      │
│   │  │       ▲                         ▲                       │   │      │
│   │  │       │ NARRATIVE_REL          │ CHAPTER_NEXT          │   │      │
│   │  │       │                         │                       │   │      │
│   │  │  ┌─────────┐             ┌─────────┐                   │   │      │
│   │  │  │ Event   │             │ Adjacent│                   │   │      │
│   │  │  │ Node    │             │ Chunk   │                   │   │      │
│   │  │  └─────────┘             └─────────┘                   │   │      │
│   │  └─────────────────────────────────────────────────────────┘   │      │
│   └──────────────────────────────┬──────────────────────────────────┘      │
│                                  │                                          │
│                                  ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                   GRAPTOR RETRIEVER                              │      │
│   │  1. CollapsedRetriever.Search() → base results                  │      │
│   │  2. Graph expansion via ENTITY_BRIDGE edges                      │      │
│   │  3. Score boost: bridge_boost = base × entity_overlap_ratio     │      │
│   │  4. Merge, dedupe, re-rank                                       │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Edge Types

| Edge Type | Source → Target | How Created | Weight |
|-----------|-----------------|-------------|--------|
| `MENTIONED_IN` | Entity → Chunk | Reality Projector finds entity in chunk span | 1.0 |
| `ENTITY_BRIDGE` | Chunk → Chunk | Two chunks share ≥1 entity | Jaccard similarity |
| `CHAPTER_NEXT` | Chunk → Chunk | Sequential chunks in same document | 1.0 |
| `PARENT_OF` | Internal → Leaf | Exists in `RaptorNode.ChildIDs` | 1.0 |
| `NARRATIVE_REL` | Entity → Entity | Reality Projector extracts relation | Event weight |
| `WORLD_CONTAINS` | World → Entity | Provenance tracking | 1.0 |

---

## Component 1: Entity Linker (Using Reality Pipeline)

**File:** `pkg/raptor/entity_linker.go`

### Design

The EntityLinker wraps the full reality projection pipeline to extract entities and relations from chunk text:

```go
// EntityLinker bridges RAPTOR chunks with the reality projection pipeline.
type EntityLinker struct {
    conductor *conductor.Conductor
    builder   *cst.Builder
}

// EntityMention records an entity occurrence within a chunk.
type EntityMention struct {
    EntityID   string       // Canonical entity ID from resolver
    EntityKind string       // Character, Location, Concept, etc.
    ChunkKey   string       // "docID:start:end"
    Offsets    [2]int       // Span within chunk text
    Text       string       // Original mention text
}

// NarrativeLink records a relation extracted from chunk text.
type NarrativeLink struct {
    SubjectID  string       // Entity ID or "Unknown"
    ObjectID   string       // Entity ID or "Unknown"
    Relation   string       // SPEAKS_TO, MENTIONS, etc.
    ChunkKey   string       // Source chunk
    Manner     string       // Optional modifier
    Location   string       // Optional location
}
```

### Key Methods

```go
// NewEntityLinker creates a linker with the full reality pipeline.
func NewEntityLinker() (*EntityLinker, error)

// LinkChunks processes all leaf nodes through reality projection.
// Returns entity mentions and narrative links for graph overlay.
func (el *EntityLinker) LinkChunks(tree *RaptorTree) LinkResult

// LinkSingleChunk processes one chunk - useful for incremental updates.
func (el *EntityLinker) LinkSingleChunk(chunk *RaptorNode) ([]EntityMention, []NarrativeLink)
```

### Integration with Reality

```go
func (el *EntityLinker) LinkSingleChunk(chunk *RaptorNode) ([]EntityMention, []NarrativeLink) {
    // 1. Run Conductor.Scan() to get entities and tokens
    scanResult := el.conductor.Scan(chunk.Text)
    
    // 2. Build EntityMap from ResolvedReferences
    entityMap := make(projection.EntityMap)
    for _, ref := range scanResult.ResolvedRefs {
        entityMap[ref.Range.Start] = ref.EntityID
    }
    for _, syn := range scanResult.Syntax {
        if syn.Kind == syntax.KindEntity {
            entityMap[syn.Start] = syn.ID
        }
    }
    
    // 3. Build CST from chunk text
    cstRoot := el.builder.Parse(chunk.Text)
    
    // 4. Project to semantic graph
    conceptGraph := projection.Project(
        cstRoot,
        el.conductor.GetMatcher(),
        entityMap,
        chunk.Text,
        nil, // No provenance for single chunk
    )
    
    // 5. Extract mentions and links from concept graph
    mentions := el.extractMentions(conceptGraph, chunk)
    links := el.extractLinks(conceptGraph, chunk)
    
    return mentions, links
}
```

---

## Component 2: Graph Overlay

**File:** `pkg/raptor/graph_overlay.go`

### Design

The GraphOverlay maintains a unified `KnowledgeGraph` that spans all RAPTOR trees:

```go
// GraphOverlay maintains the cross-document entity-chunk graph.
type GraphOverlay struct {
    graph    *knowledge.KnowledgeGraph
    
    // Inverted indices for fast lookup
    entityChunks map[string][]string  // entityID → []chunkKey
    chunkEntities map[string][]string // chunkKey → []entityID
    
    // Narrative links
    narrativeLinks []NarrativeLink
    
    // Configuration
    config OverlayConfig
}

// OverlayConfig tunes graph construction.
type OverlayConfig struct {
    MinEntityMentions int     // Min mentions to include entity (default: 1)
    BridgeMinOverlap  int     // Min shared entities for bridge (default: 1)
    NarrativeWeight   float64 // Weight for NARRATIVE_REL edges (default: 0.5)
}

// BridgeResult represents a chunk connected via shared entities.
type BridgeResult struct {
    ChunkKey       string
    SharedEntities []string
    OverlapRatio   float64  // Jaccard: |A∩B| / |A∪B|
}
```

### Key Methods

```go
// NewGraphOverlay creates an empty overlay.
func NewGraphOverlay(config OverlayConfig) *GraphOverlay

// IngestMentions adds entity-chunk relationships from a document.
func (go *GraphOverlay) IngestMentions(mentions []EntityMention, docID string)

// IngestNarrativeLinks adds entity-entity relationships.
func (go *GraphOverlay) IngestNarrativeLinks(links []NarrativeLink)

// GetBridgedChunks finds chunks connected via shared entities.
func (go *GraphOverlay) GetBridgedChunks(chunkKey string, topK int) []BridgeResult

// GetEntityContext returns all chunks mentioning an entity.
func (go *GraphOverlay) GetEntityContext(entityID string) []string

// GetRelatedEntities finds entities connected via narrative relations.
func (go *GraphOverlay) GetRelatedEntities(entityID string) []string
```

### Bridge Edge Computation

```go
func (go *GraphOverlay) GetBridgedChunks(chunkKey string, topK int) []BridgeResult {
    // Get entities in source chunk
    sourceEntities := go.chunkEntities[chunkKey]
    if len(sourceEntities) == 0 {
        return nil
    }
    
    // Find candidate chunks via entity inverted index
    candidates := make(map[string]int) // chunkKey → shared count
    for _, entityID := range sourceEntities {
        for _, otherChunk := range go.entityChunks[entityID] {
            if otherChunk != chunkKey {
                candidates[otherChunk]++
            }
        }
    }
    
    // Compute Jaccard similarity and sort
    results := make([]BridgeResult, 0, len(candidates))
    for otherKey, sharedCount := range candidates {
        otherEntities := go.chunkEntities[otherKey]
        unionSize := len(sourceEntities) + len(otherEntities) - sharedCount
        ratio := float64(sharedCount) / float64(unionSize)
        
        if sharedCount >= go.config.BridgeMinOverlap {
            results = append(results, BridgeResult{
                ChunkKey:       otherKey,
                SharedEntities: go.getSharedEntities(sourceEntities, otherEntities),
                OverlapRatio:   ratio,
            })
        }
    }
    
    // Sort by overlap ratio, limit to topK
    sort.Slice(results, func(i, j int) bool {
        return results[i].OverlapRatio > results[j].OverlapRatio
    })
    
    if len(results) > topK {
        results = results[:topK]
    }
    
    return results
}
```

---

## Component 3: GRAPTOR Retriever

**File:** `pkg/raptor/retrieval.go` (modifications)

### Design

The GraptorRetriever wraps CollapsedRetriever and adds graph expansion:

```go
// GraptorRetriever implements graph-augmented RAPTOR retrieval.
type GraptorRetriever struct {
    collapsed *CollapsedRetriever
    overlay   *GraphOverlay
    config    GraptorConfig
}

// GraptorConfig tunes retrieval behavior.
type GraptorConfig struct {
    BridgeBoost     float64  // Score multiplier for bridged chunks (default: 0.3)
    MaxBridgeExpand int      // Max additional chunks from graph (default: 5)
    MinOverlap      int      // Minimum shared entities for bridge (default: 1)
    UseNarrative    bool     // Include narrative relations in expansion (default: true)
}

// GraptorResult extends CollapsedResult with graph metadata.
type GraptorResult struct {
    CollapsedResult
    BridgedFrom   string   // Source chunk if graph-expanded
    SharedEntities []string // Entities that triggered bridge
    GraphScore    float64  // Score contribution from graph
}
```

### Search Algorithm

```go
func (gr *GraptorRetriever) Search(query string, queryVec []float32, k int) []GraptorResult {
    // 1. Base retrieval via collapsed tree
    baseResults := gr.collapsed.Search(query, queryVec, k)
    
    // 2. Graph expansion for each result
    expanded := make(map[string]*GraptorResult) // dedupe by chunkKey
    
    for _, base := range baseResults {
        // Add base result
        gr.addResult(expanded, base, nil, 0)
        
        // Find bridged chunks
        bridges := gr.overlay.GetBridgedChunks(base.ChunkKey, gr.config.MaxBridgeExpand)
        
        for _, bridge := range bridges {
            // Compute boosted score
            boost := gr.config.BridgeBoost * bridge.OverlapRatio
            graphScore := base.Score * boost
            
            // Create expanded result
            exp := GraptorResult{
                BridgedFrom:    base.ChunkKey,
                SharedEntities: bridge.SharedEntities,
                GraphScore:     graphScore,
            }
            
            // Need to fetch chunk details from index
            // ... populate CollapsedResult fields
            
            gr.addResult(expanded, exp, bridge, graphScore)
        }
    }
    
    // 3. Sort by combined score
    results := make([]GraptorResult, 0, len(expanded))
    for _, r := range expanded {
        results = append(results, *r)
    }
    sort.Slice(results, func(i, j int) bool {
        return results[i].Score+results[i].GraphScore > results[j].Score+results[j].GraphScore
    })
    
    // 4. Limit to k
    if len(results) > k {
        results = results[:k]
    }
    
    return results
}
```

---

## Component 4: RaptorIndex Integration

**File:** `pkg/raptor/raptor.go` (modifications)

### New Fields

```go
type RaptorIndex struct {
    // ... existing fields ...
    
    // GRAPTOR components
    linker *EntityLinker
    overlay *GraphOverlay
}
```

### Modified Ingestion

```go
func (ri *RaptorIndex) IngestDocument(docID string, text string, vecFn func(text string) []float32) (*RaptorTree, error) {
    // 1. Existing chunking and indexing
    tree, err := ri.ingestDocumentChunks(docID, text, vecFn)
    if err != nil {
        return nil, err
    }
    
    // 2. GRAPTOR: Extract entities and relations via reality pipeline
    if ri.linker != nil && ri.overlay != nil {
        linkResult := ri.linker.LinkChunks(tree)
        
        // Add to overlay
        ri.overlay.IngestMentions(linkResult.Mentions, docID)
        ri.overlay.IngestNarrativeLinks(linkResult.Links)
    }
    
    return tree, nil
}
```

### Factory Method

```go
// NewGraptorRetriever creates a graph-augmented retriever.
func (ri *RaptorIndex) NewGraptorRetriever(config GraptorConfig) *GraptorRetriever {
    return &GraptorRetriever{
        collapsed: NewCollapsedRetriever(ri),
        overlay:   ri.overlay,
        config:    config,
    }
}
```

---

## What We Don't Change

| Component | Why |
|-----------|-----|
| `TreeBuilder` | Tree structure stays. Graph is an overlay, not a replacement. |
| `GDR / HNSW` | Leaf search still uses hard hybrid. Graph only helps expansion. |
| `Chunker` | Chunks stay the same. We just scan their text for entities. |
| `KnowledgeGraph` | We reuse `pkg/knowledge` as-is. No new graph implementation. |
| `Reality/Projector` | We call it. No modifications needed. |
| `Scanner/Conductor` | We call it. No modifications needed. |

---

## Execution Order

1. **`entity_linker.go`** (~150 lines) — Bridges reality → raptor
2. **`graph_overlay.go`** (~200 lines) — Builds bipartite graph
3. **Modify `raptor.go`** — Wire linker + overlay
4. **`GraptorRetriever` in `retrieval.go`** (~150 lines) — Graph-expanded search
5. **Tests** — Entity linking, bridge computation, retrieval expansion
6. **WASM** — Expose `graptorSearch` alongside existing raptor search

---

## Verification Plan

### Automated Tests

| Test File | Purpose |
|-----------|---------|
| `entity_linker_test.go` | Verify entity extraction from known text |
| `graph_overlay_test.go` | Verify bridge edges form between chunks sharing entities |
| `retrieval_test.go` additions | Verify GRAPTOR retriever finds cross-document results |

### Test Cases

```go
// entity_linker_test.go
func TestLinkChunks_ExtractsEntities(t *testing.T) {
    // Given: Chunk with "Kaido stood at the gates of Wano"
    // Expect: EntityMention{EntityID: "Kaido", Kind: "Character"}
    // Expect: EntityMention{EntityID: "Wano", Kind: "Location"}
}

func TestLinkChunks_ExtractsNarrative(t *testing.T) {
    // Given: Chunk with "Luffy punched Kaido"
    // Expect: NarrativeLink{Subject: "Luffy", Object: "Kaido", Relation: "ATTACKS"}
}

// graph_overlay_test.go
func TestBridgeChunks_SharesEntity(t *testing.T) {
    // Given: Chunk A mentions "Kaido", Chunk B mentions "Kaido"
    // Expect: BridgeResult with SharedEntities: ["Kaido"]
}

func TestBridgeChunks_CrossDocument(t *testing.T) {
    // Given: Chunk in docA mentions "Kaido", Chunk in docB mentions "Kaido"
    // Expect: Bridge edge connects them despite different documents
}

// retrieval_test.go
func TestGraptorRetriever_CrossDocumentRecall(t *testing.T) {
    // Given: Query "Who fought Kaido?"
    // And: Doc A has "Luffy fought Kaido" (matches query)
    // And: Doc B has "Zoro fought Kaido" (shares entity, not direct match)
    // Expect: Both chunks returned, Doc B via graph expansion
}
```

### Eval Harness Integration

1. Add GRAPTOR search mode to existing eval page
2. Compare RAPTOR vs GRAPTOR recall on queries referencing entities spanning multiple chapters
3. Measure precision@k and recall@k for both approaches

---

## Performance Considerations

### Memory

- Entity-chunk edges: O(E × C) where E = entities, C = chunks
- Inverted indices: O(E + C) for fast lookup
- Typical: 10K entities × 50K chunks = 500K edges (manageable)

### Latency

- Bridge computation: O(k × avg_entities_per_chunk) for top-k expansion
- Pre-compute bridge edges on ingestion for faster retrieval
- Lazy evaluation option for large corpora

### Incremental Updates

- `LinkSingleChunk()` supports adding new documents without reprocessing
- Overlay supports incremental edge addition
- No need to rebuild entire graph for new documents

---

## WASM API

```go
// Exposed to JS
func graptorSearch(queryJSON string) string {
    // Parse query
    var req struct {
        Query   string
        Vector  []float32
        K       int
        Config  GraptorConfig
    }
    json.Unmarshal([]byte(queryJSON), &req)
    
    // Search
    results := graptorRetriever.Search(req.Query, req.Vector, req.K)
    
    // Return JSON
    out, _ := json.Marshal(results)
    return string(out)
}
```

---

## Summary

GRAPTOR with Reality Integration:

1. **Leverages existing infrastructure** — Reality projection, scanner pipeline, knowledge graph
2. **No O(n²) construction** — Bridge edges computed from entity co-occurrence, not pair scanning
3. **Entity-aware** — Chunks connected via shared entities, not just semantic similarity
4. **Narrative-aware** — Relations extracted from text enrich the graph
5. **Incremental** — New documents add to overlay without full rebuild
6. **Testable** — Clear test cases for each component

The result: Cross-document retrieval that understands entity relationships, not just text similarity.
