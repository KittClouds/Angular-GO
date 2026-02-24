# GLDR: Graph-Based Lexical Document Retrieval

## Executive Summary

GLDR (Graph-based Lexical Document Retrieval) is a **no-embeddings** retrieval system that fuses:
1. **qgram BM25-esque lexical scoring** (existing)
2. **Graph proximity scoring** from entity relationships (new)
3. **Discovery-aware entity anchoring** (new)

The key innovation: **entity anchors from Discovery** provide deterministic, unsupervised NER for query understanding without embeddings.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GLDR Indexing Pipeline                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │  Chunk Text  │    │ Chunk Mentions│    │ Graph Edges  │                   │
│  │  [sentence]  │    │ [entity_id,  │    │ [e1,e2,rel]  │                   │
│  │              │    │  conf, span] │    │              │                   │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                   │
│         │                   │                   │                           │
│         ▼                   ▼                   ▼                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │ qgramIndex   │    │entityChunks  │    │  graphAdj    │                   │
│  │ chunk_id →   │    │ entity_id →  │    │ entity_id →  │                   │
│  │ fields       │    │ roaring.BM   │    │ []Edge       │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│         │                   │                   │                           │
│         │           ┌───────┴───────┐           │                           │
│         │           ▼               ▼           │                           │
│         │    ┌──────────────┐              ┌────┴─────┐                     │
│         │    │chunkEntities │              │ proximity│                     │
│         │    │ chunk_id →   │              │  cache   │                     │
│         │    │ []entity_id  │              └──────────┘                     │
│         │    └──────────────┘                                               │
│         │                   │                                               │
└─────────┴───────────────────┴───────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GLDR Query Pipeline                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         1. ENTITY ANCHORING                           │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │   Query Text ──► Canonicalize ──► Entity Registry Lookup             │   │
│  │        │                           │                                  │   │
│  │        │                           ├─► Direct Anchors [known entities]│   │
│  │        │                           │                                  │   │
│  │        └─► qgram gate ──► top-N chunks ──► Soft Anchors [mentions]   │   │
│  │                                    │                                  │   │
│  │                                    └─► Discovery candidates           │   │
│  │                                       [promoted StatusPromoted]       │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      2. CANDIDATE GENERATION                          │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │   candidates = qgram.GenerateCandidates(query)                       │   │
│  │               ∪ entityChunks[anchor] for each anchor                 │   │
│  │               ∪ graph-expanded entities [BFS from anchors]           │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                       3. FUSED SCORING                                │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │   For each candidate chunk c:                                        │   │
│  │                                                                       │   │
│  │   lex_score(c)  = BM25-ish from qgram                                │   │
│  │   graph_score(c) = Σ proximity(e) for e in chunkEntities[c]          │   │
│  │                   where proximity computed via weighted BFS from      │   │
│  │                   anchor entities                                     │   │
│  │                                                                       │   │
│  │   chunk_score = α * norm(lex_score) + β * norm(graph_score)          │   │
│  │   default: α=0.6, β=0.4 (flip if no direct anchors: α=0.4, β=0.6)    │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                       4. NODE RANKING                                 │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │   For each entity/node e:                                            │   │
│  │                                                                       │   │
│  │   node_score(e) = max(chunk_score(c) for c in entityChunks[e])      │   │
│  │                  + λ * proximity(e)                                  │   │
│  │                                                                       │   │
│  │   Output: [(entity_id, node_score, top_supporting_chunks[])]        │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Types

### 1. Index Structures

```go
// GLDRIndex is the main retrieval index combining lexical and graph components.
type GLDRIndex struct {
    mu sync.RWMutex

    // Lexical index (wraps existing qgram)
    QGram *qgram.CompressedQGramIndex

    // Entity→Chunk mapping (roaring bitmap for fast intersection)
    EntityChunks map[string]*roaring.Bitmap // entity_id → chunk_ids

    // Chunk→Entity mapping (for scoring)
    ChunkEntities map[uint32][]EntityMention // chunk_id → mentions

    // Graph adjacency
    GraphAdj map[string][]GraphEdge // entity_id → outgoing edges

    // Proximity cache (invalidated on graph update)
    proximityCache *ProximityCache

    // Configuration
    Config GLDRConfig
}

// EntityMention records an entity occurrence in a chunk.
type EntityMention struct {
    EntityID   string  // Canonical entity ID
    Confidence float64 // Discovery confidence (1.0 for known entities)
    Start      int     // Character offset in chunk
    End        int     // End offset
}

// GraphEdge represents a relationship between entities.
type GraphEdge struct {
    TargetID   string  // Target entity ID
    RelType    string  // Relationship type (e.g., "interacts", "located_at")
    Confidence float64 // Edge confidence
    Source     string  // "explicit" | "inferred" | "svo"
}
```

### 2. Query Types

```go
// GLDRQuery represents a parsed query with entity anchors.
type GLDRQuery struct {
    RawText      string
    DirectAnchors []EntityAnchor    // Entities found via canonicalization
    SoftAnchors  []EntityAnchor    // Entities from chunk-based discovery
    Clauses      []qgram.Clause    // Parsed lexical clauses
}

// EntityAnchor represents an anchored entity for graph traversal.
type EntityAnchor struct {
    EntityID   string
    Confidence float64 // 1.0 for direct, <1.0 for soft
    Source     string  // "direct" | "soft" | "discovery"
}

// GLDRResult represents a scored result.
type GLDRResult struct {
    // Chunk-level scoring
    ChunkID    string
    ChunkScore float64
    LexScore   float64
    GraphScore float64

    // Entity attribution
    MatchedEntities []EntityMatch
}

// EntityMatch records why an entity matched.
type EntityMatch struct {
    EntityID      string
    Proximity     float64 // Graph proximity from anchor
    MentionCount  int     // Times mentioned in chunk
}

// NodeResult represents a ranked entity/node.
type NodeResult struct {
    EntityID           string
    NodeScore          float64
    TopChunks          []string // Top supporting chunk IDs
    ProximityFromQuery float64  // Graph distance from anchors
}
```

### 3. Configuration

```go
// GLDRConfig holds all tuning parameters.
type GLDRConfig struct {
    // Lexical config (passed through to qgram)
    LexicalConfig qgram.SearchConfig

    // Fusion weights
    Alpha float64 // Lexical weight (default: 0.6)
    Beta  float64 // Graph weight (default: 0.4)

    // Graph traversal
    MaxGraphHops    int     // Max BFS depth (default: 3)
    ProximityDecay  float64 // Decay per hop (default: 0.5)
    MinProximity    float64 // Minimum proximity to consider (default: 0.1)

    // Anchor extraction
    SoftAnchorChunks   int     // Top-N chunks for soft anchors (default: 10)
    DiscoveryThreshold float64 // Min confidence for discovery anchors (default: 0.7)

    // Node ranking
    Lambda float64 // Proximity boost for node score (default: 0.3)

    // Result limits
    TopChunks int // Max chunks to return (default: 20)
    TopNodes  int // Max nodes to return (default: 10)
}
```

---

## Key Algorithms

### 1. Entity Anchoring (Discovery Integration)

```go
// AnchorEntities extracts entity anchors from a query.
func (idx *GLDRIndex) AnchorEntities(query string) *GLDRQuery {
    result := &GLDRQuery{RawText: query}

    // 1. Parse lexical clauses
    result.Claauses = qgram.ParseQuery(query)

    // 2. Direct anchors: canonicalize each clause and lookup
    for _, clause := range result.Clauses {
        canonKey, _, valid := discovery.Canonicalize(clause.Pattern)
        if !valid {
            continue
        }

        // Lookup in entity registry (graptor)
        if entityID, ok := idx.entityRegistry.LookupByCanonical(canonKey); ok {
            result.DirectAnchors = append(result.DirectAnchors, EntityAnchor{
                EntityID:   entityID,
                Confidence: 1.0,
                Source:     "direct",
            })
        }

        // Also check discovery registry for promoted candidates
        if stats := idx.discoveryRegistry.GetStats(string(canonKey)); stats != nil {
            if stats.Status == discovery.StatusPromoted {
                result.DirectAnchors = append(result.DirectAnchors, EntityAnchor{
                    EntityID:   string(canonKey), // Use canonical as ID
                    Confidence: float64(stats.Count) / float64(idx.discoveryRegistry.Threshold),
                    Source:     "discovery",
                })
            }
        }
    }

    // 3. Soft anchors: if no direct anchors, use lexical gate
    if len(result.DirectAnchors) == 0 {
        topChunks := idx.QGram.Search(query, idx.Config.LexicalConfig, idx.Config.SoftAnchorChunks)
        for _, chunk := range topChunks {
            mentions := idx.ChunkEntities[chunk.DocID]
            for _, m := range mentions {
                result.SoftAnchors = append(result.SoftAnchors, EntityAnchor{
                    EntityID:   m.EntityID,
                    Confidence: m.Confidence * chunk.Score / topChunks[0].Score,
                    Source:     "soft",
                })
            }
        }
    }

    return result
}
```

### 2. Graph Proximity (Weighted BFS)

```go
// ComputeProximity computes proximity scores from anchors via BFS.
func (idx *GLDRIndex) ComputeProximity(anchors []EntityAnchor) map[string]float64 {
    proximity := make(map[string]float64)
    visited := make(map[string]int) // entity_id → hops

    // Priority queue: (entity_id, proximity, hops)
    pq := make(PriorityQueue, 0)
    heap.Init(&pq)

    // Initialize with anchors
    for _, a := range anchors {
        heap.Push(&pq, &Item{
            EntityID: a.EntityID,
            Prox:     a.Confidence,
            Hops:     0,
        })
        proximity[a.EntityID] = a.Confidence
        visited[a.EntityID] = 0
    }

    // BFS with decay
    for pq.Len() > 0 {
        item := heap.Pop(&pq).(*Item)

        // Stop if below threshold
        if item.Prox < idx.Config.MinProximity {
            continue
        }

        // Expand neighbors
        for _, edge := range idx.GraphAdj[item.EntityID] {
            newHops := item.Hops + 1
            if newHops > idx.Config.MaxGraphHops {
                continue
            }

            // Check if already visited with fewer hops
            if h, ok := visited[edge.TargetID]; ok && h <= newHops {
                continue
            }

            // Compute new proximity
            newProx := item.Prox * idx.Config.ProximityDecay * edge.Confidence

            // Update if better
            if curProx, ok := proximity[edge.TargetID]; !ok || newProx > curProx {
                proximity[edge.TargetID] = newProx
                visited[edge.TargetID] = newHops
                heap.Push(&pq, &Item{
                    EntityID: edge.TargetID,
                    Prox:     newProx,
                    Hops:     newHops,
                })
            }
        }
    }

    return proximity
}
```

### 3. Fused Scoring

```go
// ScoreChunks computes fused scores for candidate chunks.
func (idx *GLDRIndex) ScoreChunks(
    candidates []uint32,
    proximity map[string]float64,
    lexScores map[uint32]float64,
) []GLDRResult {
    results := make([]GLDRResult, 0, len(candidates))

    // Normalize lexical scores
    maxLex := 0.0
    for _, s := range lexScores {
        if s > maxLex {
            maxLex = s
        }
    }

    // Normalize proximity scores
    maxProx := 0.0
    for _, p := range proximity {
        if p > maxProx {
            maxProx = p
        }
    }

    // Determine weights based on anchor presence
    alpha, beta := idx.Config.Alpha, idx.Config.Beta
    hasDirectAnchors := len(proximity) > 0 // Simplified check
    if !hasDirectAnchors {
        alpha, beta = 0.4, 0.6 // Favor graph when no direct anchors
    }

    for _, chunkID := range candidates {
        // Lexical component
        lexNorm := 0.0
        if maxLex > 0 {
            lexNorm = lexScores[chunkID] / maxLex
        }

        // Graph component: sum proximity of mentioned entities
        graphScore := 0.0
        var matchedEntities []EntityMatch
        for _, m := range idx.ChunkEntities[chunkID] {
            if prox, ok := proximity[m.EntityID]; ok {
                graphScore += prox
                matchedEntities = append(matchedEntities, EntityMatch{
                    EntityID:     m.EntityID,
                    Proximity:    prox,
                    MentionCount: 1, // Could count multiple mentions
                })
            }
        }

        // Normalize graph score
        graphNorm := 0.0
        if maxProx > 0 {
            graphNorm = graphScore / maxProx
        }

        // Fused score
        fusedScore := alpha*lexNorm + beta*graphNorm

        results = append(results, GLDRResult{
            ChunkID:         idx.QGram.Mapper.GetDocID(chunkID),
            ChunkScore:      fusedScore,
            LexScore:        lexScores[chunkID],
            GraphScore:      graphScore,
            MatchedEntities: matchedEntities,
        })
    }

    // Sort by fused score
    sort.Slice(results, func(i, j int) bool {
        return results[i].ChunkScore > results[j].ChunkScore
    })

    return results
}
```

### 4. Node Ranking

```go
// RankNodes converts chunk scores to entity/node scores.
func (idx *GLDRIndex) RankNodes(
    chunkResults []GLDRResult,
    proximity map[string]float64,
) []NodeResult {
    // Aggregate chunk scores per entity
    entityChunkScores := make(map[string][]float64)
    entityTopChunks := make(map[string][]string)

    for _, cr := range chunkResults {
        for _, m := range cr.MatchedEntities {
            entityChunkScores[m.EntityID] = append(entityChunkScores[m.EntityID], cr.ChunkScore)
            if len(entityTopChunks[m.EntityID]) < 3 {
                entityTopChunks[m.EntityID] = append(entityTopChunks[m.EntityID], cr.ChunkID)
            }
        }
    }

    // Compute node scores
    var nodes []NodeResult
    for entityID, scores := range entityChunkScores {
        // Max chunk score
        maxScore := 0.0
        for _, s := range scores {
            if s > maxScore {
                maxScore = s
            }
        }

        // Add proximity boost
        prox := 0.0
        if p, ok := proximity[entityID]; ok {
            prox = p
        }

        nodeScore := maxScore + idx.Config.Lambda*prox

        nodes = append(nodes, NodeResult{
            EntityID:           entityID,
            NodeScore:          nodeScore,
            TopChunks:          entityTopChunks[entityID],
            ProximityFromQuery: prox,
        })
    }

    // Sort by node score
    sort.Slice(nodes, func(i, j int) bool {
        return nodes[i].NodeScore > nodes[j].NodeScore
    })

    // Limit results
    if len(nodes) > idx.Config.TopNodes {
        nodes = nodes[:idx.Config.TopNodes]
    }

    return nodes
}
```

---

## Integration Points

### 1. With Discovery Package

```go
// DiscoveryIntegration connects GLDR with the discovery engine.
type DiscoveryIntegration struct {
    DiscoveryEngine *discovery.Engine
    EntityRegistry  *graptor.GlobalEntityRegistry
}

// GetPromotedEntities returns entities that have been promoted by discovery.
func (di *DiscoveryIntegration) GetPromotedEntities() []EntityAnchor {
    var anchors []EntityAnchor
    for canon, stats := range di.DiscoveryEngine.Registry.Stats {
        if stats.Status == discovery.StatusPromoted {
            anchors = append(anchors, EntityAnchor{
                EntityID:   string(canon),
                Confidence: float64(stats.Count) / float64(di.DiscoveryEngine.Registry.PromotionThreshold),
                Source:     "discovery",
            })
        }
    }
    return anchors
}
```

### 2. With Graptor Package

```go
// GraptorIntegration connects GLDR with the entity registry.
type GraptorIntegration struct {
    Registry *graptor.GlobalEntityRegistry
}

// GetEntityChunks returns all chunk IDs where an entity is mentioned.
func (gi *GraptorIntegration) GetEntityChunks(entityID string) []uint32 {
    mentions := gi.Registry.GetMentions(entityID)
    chunks := make(map[uint32]bool)
    for _, m := range mentions {
        chunks[m.ChunkID] = true
    }

    result := make([]uint32, 0, len(chunks))
    for c := range chunks {
        result = append(result, c)
    }
    return result
}

// GetCooccurrenceEdges extracts graph edges from co-occurrence data.
func (gi *GraptorIntegration) GetCooccurrenceEdges(minCount int) []GraphEdge {
    var edges []GraphEdge
    for pair, count := range gi.Registry.Cooccurrences {
        if count >= minCount {
            e1, e2 := parsePair(pair)
            edges = append(edges,
                GraphEdge{TargetID: e2, RelType: "cooccurs", Confidence: float64(count), Source: "inferred"},
                GraphEdge{TargetID: e1, RelType: "cooccurs", Confidence: float64(count), Source: "inferred"},
            )
        }
    }
    return edges
}
```

---

## Zero-Copy Patterns

Following the patterns established in `profile.go`:

```go
// ForEachChunk iterates over chunks without allocating a slice.
func (idx *GLDRIndex) ForEachChunk(fn func(chunkID uint32, mentions []EntityMention) bool) {
    idx.mu.RLock()
    defer idx.mu.RUnlock()

    for chunkID, mentions := range idx.ChunkEntities {
        if !fn(chunkID, mentions) {
            break
        }
    }
}

// ForEachEntityEdge iterates over entity edges without allocation.
func (idx *GLDRIndex) ForEachEntityEdge(entityID string, fn func(edge GraphEdge) bool) {
    idx.mu.RLock()
    defer idx.mu.RUnlock()

    for _, edge := range idx.GraphAdj[entityID] {
        if !fn(edge) {
            break
        }
    }
}

// GetEntityCount returns the number of entities (O(1), no allocation).
func (idx *GLDRIndex) GetEntityCount() int {
    idx.mu.RLock()
    defer idx.mu.RUnlock()
    return len(idx.EntityChunks)
}
```

---

## File Structure

```
GoKitt/pkg/gldr/
├── gldr.go              // Main index and public API
├── config.go            // Configuration types
├── types.go             // Core type definitions
├── anchor.go            // Entity anchoring logic
├── proximity.go         // Graph proximity computation
├── scorer.go            // Fused scoring logic
├── node_ranker.go       // Node ranking from chunk scores
├── integration.go       // Discovery/Graptor integration
├── iterator.go          // Zero-copy iteration patterns
├── gldr_test.go         // Comprehensive tests
└── benchmark_test.go    // Performance benchmarks
```

---

## Implementation Priority

| Phase | Component | Description |
|-------|-----------|-------------|
| **P0** | `types.go` | Core type definitions |
| **P0** | `config.go` | Configuration with defaults |
| **P0** | `gldr.go` | Main index structure |
| **P1** | `anchor.go` | Entity anchoring with Discovery |
| **P1** | `proximity.go` | Graph proximity BFS |
| **P1** | `scorer.go` | Fused scoring |
| **P2** | `node_ranker.go` | Node ranking |
| **P2** | `integration.go` | Graptor/Discovery integration |
| **P2** | `iterator.go` | Zero-copy patterns |
| **P3** | Tests | Comprehensive test coverage |

---

## Questions for Clarification

1. **Discovery candidates searchable before promotion?**
   - Recommended: Only after promotion (keeps graph clean)
   - Alternative: Pre-promotion with lower confidence path

2. **Graph edge sources?**
   - Co-occurrence from Graptor (inferred)
   - SVO extraction (explicit)
   - User-defined relationships?

3. **Chunk granularity?**
   - Sentence-level (from GRAPTOR)
   - Paragraph-level
   - Configurable?

4. **Roaring bitmap dependency?**
   - Use existing `github.com/RoaringBitmap/roaring/v2`?
   - Or implement custom sparse bitmap?
