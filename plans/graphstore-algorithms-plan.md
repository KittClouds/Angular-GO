# Graphstore Bitmap Algorithm Implementation Plan

## Executive Summary

Implement pure in-memory graph algorithms using Roaring Bitmaps on `uint32` indices. Zero SQL inside any algorithm. All operations read from `s.cache` under `RLock`. UUID conversion happens only at result boundaries.

---

## Architecture Context

### Existing Infrastructure

| Component | File | Purpose |
|-----------|------|---------|
| [`SQLiteStore[T]`](GoKitt/internal/graphstore/store.go:17) | store.go | Main store with db, registry, cache |
| [`IndexRegistry`](GoKitt/internal/graphstore/index.go:14) | index.go | UUID ↔ uint32 bidirectional mapping |
| [`adjacencyCache[T]`](GoKitt/internal/graphstore/cache.go:30) | cache.go | In-memory bitmap adjacency structure |
| [`bitmapAdjacency`](GoKitt/internal/graphstore/cache.go:18) | cache.go | Per-node roaring.Bitmap + edge metadata |

### Lock Discipline

```
warmCache()           → lazy load (write lock internally)
cache.mu.RLock()      → all algo work happens here
registry.mu.RLock()   → only if iterating all indices
// pure uint32 bitmap ops
// convert to UUID only at result construction
cache.mu.RUnlock()
```

---

## Division of Labor

### Use `dominikbraun/graph` For:

| Algorithm | Reason |
|-----------|--------|
| Dijkstra weighted shortest path | Needs edge weights, their heap is solid |
| TopologicalSort | Directed-only, not our use case |
| MST (Kruskal/Prim) | Weight-driven |
| StronglyConnectedComponents | Directed-only |

### Implement in Store (Bitmap-Based):

| Algorithm | Complexity | Why Store |
|-----------|------------|-----------|
| ConnectedComponents | O(V + E) | Bitmap BFS sweep, massively faster |
| ShortestPath (unweighted) | O(V + E) | Pure bitmap BFS, no heap overhead |
| k-Hop Neighborhood | O(k × avg_deg) | Core Traverse primitive |
| Common Neighbors | O(n/64) | Single bitmap `And`, trivial |
| Jaccard Similarity | O(n/64) | Bitmap And/Or |
| Adamic-Adar | O(common × log) | Bitmap intersection + degree lookup |
| Clustering Coefficient | O(k²) | Triangle counting via bitmap intersection |
| PageRank | O(iter × E) | Sparse vector on bitmap adjacency |
| Label Propagation | O(iter × E) | Uses label bitmap infrastructure |
| Degree Centrality | O(1) | `GetCardinality()` |

---

## File Structure

```
internal/graphstore/
├── algo_structural.go   // degree, neighbors, common, jaccard, adamic-adar, clustering
├── algo_paths.go        // unweighted BFS shortest path, k-hop bitmap, ego network
├── algo_components.go   // connected components, is-connected, largest component
└── algo_ranking.go      // PageRank, label propagation, degree centrality map
```

---

## Algorithm Specifications

### 1. `algo_structural.go` - Structural Metrics

All O(1) or O(neighbors) via bitmap ops:

```go
// Degree returns the out-degree of a vertex - O(1)
func (s *SQLiteStore[T]) Degree(id uuid.UUID) (int, error)

// CommonNeighbors returns intersection of neighbor sets - O(n/64) SIMD
func (s *SQLiteStore[T]) CommonNeighbors(a, b uuid.UUID) (*roaring.Bitmap, error)

// Jaccard returns |A∩B| / |A∪B| similarity
func (s *SQLiteStore[T]) Jaccard(a, b uuid.UUID) (float64, error)

// AdamicAdar returns sum of 1/log(degree(w)) for common neighbors
func (s *SQLiteStore[T]) AdamicAdar(a, b uuid.UUID) (float64, error)

// ClusteringCoefficient returns local clustering: edges between neighbors / possible
func (s *SQLiteStore[T]) ClusteringCoefficient(id uuid.UUID) (float64, error)
```

### 2. `algo_paths.go` - Path Algorithms

BFS-based, unweighted:

```go
// KHopBitmap returns all node indices within k hops (excludes root)
func (s *SQLiteStore[T]) KHopBitmap(id uuid.UUID, k int) (*roaring.Bitmap, error)

// ShortestPathUnweighted returns hop path via BFS
func (s *SQLiteStore[T]) ShortestPathUnweighted(src, tgt uuid.UUID) ([]uuid.UUID, error)

// SubGraph is a lightweight extracted subgraph
type SubGraph struct {
    Nodes []uuid.UUID
    Edges [][2]uuid.UUID
}

// EgoNetwork extracts subgraph within depth hops
func (s *SQLiteStore[T]) EgoNetwork(id uuid.UUID, depth int) (*SubGraph, error)
```

### 3. `algo_components.go` - Component Analysis

Single BFS sweep over bitmap adjacency:

```go
// ConnectedComponents returns all weakly connected components
func (s *SQLiteStore[T]) ConnectedComponents() ([][]uuid.UUID, error)

// IsConnected checks if graph has single component
func (s *SQLiteStore[T]) IsConnected() (bool, error)

// LargestComponent returns the biggest connected component
func (s *SQLiteStore[T]) LargestComponent() ([]uuid.UUID, error)
```

### 4. `algo_ranking.go` - Ranking Algorithms

Iterative algorithms on sparse adjacency:

```go
type PageRankOpts struct {
    Damping   float64 // default 0.85
    MaxIter   int     // default 100
    Tolerance float64 // default 1e-6
}

// PageRank runs power-iteration PageRank
func (s *SQLiteStore[T]) PageRank(opts PageRankOpts) (map[uuid.UUID]float64, error)

// LabelPropagation detects communities via neighbor-majority voting
func (s *SQLiteStore[T]) LabelPropagation(maxIter int) (map[uuid.UUID]uint32, error)

// DegreeCentrality returns normalized degree for every node
func (s *SQLiteStore[T]) DegreeCentrality() (map[uuid.UUID]float64, error)
```

---

## Test Strategy

### Test File: `algo_test.go`

```go
// Test graph fixture:
//   0 -- 1 -- 2
//   |    |
//   3 -- 4 -- 5
//   |
//   6 (isolated after removing from main component)

func TestDegree(t *testing.T)
func TestCommonNeighbors(t *testing.T)
func TestJaccard(t *testing.T)
func TestAdamicAdar(t *testing.T)
func TestClusteringCoefficient(t *testing.T)
func TestKHopBitmap(t *testing.T)
func TestShortestPathUnweighted(t *testing.T)
func TestEgoNetwork(t *testing.T)
func TestConnectedComponents(t *testing.T)
func TestPageRank(t *testing.T)
func TestLabelPropagation(t *testing.T)
func TestDegreeCentrality(t *testing.T)
```

---

## Implementation Order

1. **algo_structural.go** - Simplest, validates bitmap patterns
2. **algo_paths.go** - BFS patterns, builds on structural
3. **algo_components.go** - Full-graph sweep, validates registry iteration
4. **algo_ranking.go** - Most complex, iterative state
5. **algo_test.go** - Comprehensive test coverage

---

## Key Implementation Notes

### Bitmap Operations

```go
// Intersection (AND)
common := roaring.And(adjA.neighbors, adjB.neighbors)

// Union (OR)
union := roaring.Or(adjA.neighbors, adjB.neighbors)

// Difference (AND NOT)
newNodes := roaring.AndNot(adj.neighbors, visited)

// Cardinality
count := bitmap.GetCardinality()

// Iteration
it := bitmap.Iterator()
for it.HasNext() {
    idx := it.Next()
    // process idx
}
```

### Index ↔ UUID Conversion

```go
// UUID → Index
idx, ok := s.registry.Get(id)

// Index → UUID
uid, ok := s.registry.ReverseLookup(idx)
```

### Undirected Graph Handling

The cache stores both directions for undirected graphs:
- `outEdges[u]` contains v
- `outEdges[v]` contains u
- `inEdges` mirrors `outEdges`

For undirected algorithms, use `outEdges` only (it contains all neighbors).

---

## Dependencies

Already in `go.mod`:
- `github.com/RoaringBitmap/roaring/v2` - Bitmap operations
- `github.com/dominikbraun/graph` - Graph interface + weighted algorithms
- `github.com/google/uuid` - UUID handling

Need to import:
- `math` - For Log in AdamicAdar
- `math/rand` - For LabelPropagation shuffle

---

## Verification Checklist

- [ ] All algorithms use `RLock` only (no writes to cache)
- [ ] No SQL inside any algorithm
- [ ] UUID conversion only at result boundaries
- [ ] All errors properly wrapped
- [ ] Edge cases handled (empty graph, single node, disconnected)
- [ ] Tests pass with `go test ./internal/graphstore/...`
