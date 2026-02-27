# GraphStore Optimization Fix Plan

## Current Status

### Test Failures (4 failing tests)

| Test | Expected | Actual | Root Cause |
|------|----------|--------|------------|
| `TestKHopBitmap` (2-hop) | 5 nodes | 6 nodes | BFS bitmap pool bug |
| `TestKHopBitmap` (3-hop) | 6 nodes | 7 nodes | BFS bitmap pool bug |
| `TestShortestPathUnweighted` | path found | "no path" | BFS not exploring all neighbors |
| `TestConnectedComponents` | 1 component, 7 nodes | 4 components, 3 nodes | BFS not exploring all neighbors |
| `TestIsConnected` | true | false | Depends on ConnectedComponents |
| `TestLargestComponent` | 7 nodes | 3 nodes | Depends on ConnectedComponents |

### Root Cause Analysis

The bugs are in the **bitmap pool usage pattern** in BFS-based algorithms. The issue is in how `getBitmap()` and `putBitmap()` interact with loop variables and deferred cleanup.

#### Bug 1: `KHopBitmap` - Incorrect pool usage

```go
// PROBLEM: defer captures variable, not value
visited := getBitmap()
defer putBitmap(visited)    // Will clear visited at function end
frontier := getBitmap()
defer putBitmap(frontier)   // Will clear frontier at function end

for hop := 0; hop < k && !frontier.IsEmpty(); hop++ {
    next := getBitmap()
    // ... populate next ...
    visited.Or(next)
    result.Or(next)
    putBitmap(frontier)     // BUG: clears current frontier
    frontier = next         // frontier now points to next
}
// When function returns:
// - defer putBitmap(frontier) clears 'next' (the last frontier)
// - defer putBitmap(visited) clears visited
```

The issue is that `putBitmap(frontier)` inside the loop clears the bitmap, but then `frontier = next` reassigns the variable. The deferred `putBitmap(frontier)` will operate on the NEW value of frontier (the last `next`), not the original.

#### Bug 2: `ShortestPathUnweighted` - Same pattern

```go
visited := getBitmap()
defer putBitmap(visited)
frontier := getBitmap()
defer putBitmap(frontier)

for !frontier.IsEmpty() && !found {
    next := getBitmap()
    // ... BFS logic ...
    visited.Or(next)
    putBitmap(frontier)     // BUG: same issue
    frontier = next
}
```

#### Bug 3: `ConnectedComponents` - Same pattern

```go
for !frontier.IsEmpty() {
    next := getBitmap()
    // ... BFS logic ...
    globalVisited.Or(next)
    component.Or(next)
    putBitmap(frontier)     // BUG: same issue
    frontier = next
}
putBitmap(frontier)         // Double-put! frontier was already put in loop
```

## Fix Strategy

### Option A: Remove pool for loop-local bitmaps (Safer)

Don't use the pool for bitmaps that are reassigned in loops. Only use pool for truly transient bitmaps that have a clear lifetime.

### Option B: Fix the pool usage pattern (More efficient)

Use separate variables for pooled bitmaps and avoid reassignment:

```go
// Correct pattern:
visited := getBitmap()
defer putBitmap(visited)
currentFrontier := getBitmap()
defer putBitmap(currentFrontier)
currentFrontier.Add(idx)

for hop := 0; hop < k && !currentFrontier.IsEmpty(); hop++ {
    nextFrontier := getBitmap()
    // ... populate nextFrontier ...
    visited.Or(nextFrontier)
    result.Or(nextFrontier)
    
    // Clear current frontier for reuse
    currentFrontier.Clear()
    currentFrontier.Or(nextFrontier)
    putBitmap(nextFrontier)  // Return next to pool
}
```

### Recommended Fix: Option A for correctness, then optimize

Given the test failures, I recommend:

1. **First**: Fix the bugs by not using pool for loop-reassigned bitmaps
2. **Then**: Optimize with correct pool usage pattern

## Implementation Plan

### Phase 1: Fix Critical Bugs

#### 1.1 Fix `KHopBitmap` in [`algo_paths.go`](GoKitt/internal/graphstore/algo_paths.go)

**Current code (lines 14-46):**
- Uses `getBitmap()` for `visited` and `frontier`
- Reassigns `frontier = next` in loop
- Deferred cleanup operates on reassigned variable

**Fix:**
```go
func (s *SQLiteStore[T]) KHopBitmap(id uuid.UUID, k int) (*roaring.Bitmap, error) {
    s.cache.mu.RLock()
    defer s.cache.mu.RUnlock()

    idx, ok := s.registry.Get(id)
    if !ok {
        return nil, graph.ErrVertexNotFound
    }

    // Don't pool visited - it accumulates across iterations
    visited := roaring.New()
    visited.Add(idx)
    
    // Don't pool frontier - it's reassigned in loop
    frontier := roaring.New()
    frontier.Add(idx)
    
    result := roaring.New()

    for hop := 0; hop < k && !frontier.IsEmpty(); hop++ {
        next := roaring.New()
        it := frontier.Iterator()
        for it.HasNext() {
            f := it.Next()
            if adj, ok := s.cache.outEdges[f]; ok {
                next.Or(roaring.AndNot(adj.neighbors, visited))
            }
        }
        visited.Or(next)
        result.Or(next)
        frontier = next
    }
    return result, nil
}
```

#### 1.2 Fix `ShortestPathUnweighted` in [`algo_paths.go`](GoKitt/internal/graphstore/algo_paths.go)

**Current code (lines 50-126):**
- Same pool usage bug

**Fix:**
```go
func (s *SQLiteStore[T]) ShortestPathUnweighted(src, tgt uuid.UUID) ([]uuid.UUID, error) {
    s.cache.mu.RLock()
    defer s.cache.mu.RUnlock()

    srcIdx, ok1 := s.registry.Get(src)
    tgtIdx, ok2 := s.registry.Get(tgt)
    if !ok1 || !ok2 {
        return nil, graph.ErrVertexNotFound
    }
    if srcIdx == tgtIdx {
        return []uuid.UUID{src}, nil
    }

    parent := map[uint32]uint32{srcIdx: srcIdx}
    visited := roaring.New()
    visited.Add(srcIdx)
    frontier := roaring.New()
    frontier.Add(srcIdx)
    found := false

    for !frontier.IsEmpty() && !found {
        next := roaring.New()
        it := frontier.Iterator()
        for it.HasNext() {
            f := it.Next()
            adj, ok := s.cache.outEdges[f]
            if !ok {
                continue
            }
            newNeighbors := roaring.AndNot(adj.neighbors, visited)
            nit := newNeighbors.Iterator()
            for nit.HasNext() {
                n := nit.Next()
                parent[n] = f
                if n == tgtIdx {
                    found = true
                    break
                }
                next.Add(n)
            }
            if found {
                break
            }
        }
        visited.Or(next)
        frontier = next
    }

    if !found {
        return nil, fmt.Errorf("no path between vertices")
    }

    // Reconstruct path
    path := []uint32{tgtIdx}
    cur := tgtIdx
    for cur != srcIdx {
        cur = parent[cur]
        path = append(path, cur)
    }
    // Reverse path
    for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
        path[i], path[j] = path[j], path[i]
    }

    // Convert indices to UUIDs
    uuids := make([]uuid.UUID, 0, len(path))
    for _, idx := range path {
        if id, ok := s.registry.ReverseLookup(idx); ok {
            uuids = append(uuids, id)
        }
    }
    return uuids, nil
}
```

#### 1.3 Fix `ConnectedComponents` in [`algo_components.go`](GoKitt/internal/graphstore/algo_components.go)

**Current code (lines 10-69):**
- Same pool usage bug
- Additional bug: double `putBitmap(frontier)` at end

**Fix:**
```go
func (s *SQLiteStore[T]) ConnectedComponents() ([][]uuid.UUID, error) {
    if err := s.warmCache(); err != nil {
        return nil, err
    }
    s.cache.mu.RLock()
    defer s.cache.mu.RUnlock()

    allNodes := roaring.New()
    s.registry.mu.RLock()
    for _, idx := range s.registry.uuidToIdx {
        allNodes.Add(idx)
    }
    s.registry.mu.RUnlock()

    globalVisited := roaring.New()
    var components [][]uuid.UUID

    it := allNodes.Iterator()
    for it.HasNext() {
        seed := it.Next()
        if globalVisited.Contains(seed) {
            continue
        }

        component := roaring.New()
        frontier := roaring.New()
        frontier.Add(seed)
        component.Add(seed)
        globalVisited.Add(seed)

        for !frontier.IsEmpty() {
            next := roaring.New()
            fit := frontier.Iterator()
            for fit.HasNext() {
                f := fit.Next()
                if adj, ok := s.cache.outEdges[f]; ok {
                    newNodes := roaring.AndNot(adj.neighbors, globalVisited)
                    next.Or(newNodes)
                }
            }
            globalVisited.Or(next)
            component.Or(next)
            frontier = next
        }

        uuids := make([]uuid.UUID, 0, component.GetCardinality())
        cit := component.Iterator()
        for cit.HasNext() {
            if uid, ok := s.registry.ReverseLookup(cit.Next()); ok {
                uuids = append(uuids, uid)
            }
        }
        components = append(components, uuids)
    }
    return components, nil
}
```

### Phase 2: Verify Fixes

Run tests:
```bash
cd GoKitt
go test ./internal/graphstore/ -v -count=1
```

### Phase 3: Re-enable Pool with Correct Pattern (Optional)

After tests pass, optimize by using pool correctly:

```go
// Correct pool usage pattern:
func (s *SQLiteStore[T]) KHopBitmap(id uuid.UUID, k int) (*roaring.Bitmap, error) {
    // ... setup ...
    
    visited := getBitmap()
    defer putBitmap(visited)
    visited.Add(idx)
    
    frontier := getBitmap()
    defer putBitmap(frontier)
    frontier.Add(idx)
    
    result := roaring.New()
    
    // Use a separate variable for next, don't reassign frontier
    for hop := 0; hop < k && !frontier.IsEmpty(); hop++ {
        next := getBitmap()
        
        // ... populate next ...
        
        visited.Or(next)
        result.Or(next)
        
        // Copy next into frontier, then return next to pool
        frontier.Clear()
        frontier.Or(next)
        putBitmap(next)
    }
    return result, nil
}
```

## Remaining Optimizations from Original Plan

After fixing the bugs, complete these P1/P2 items:

| # | Optimization | File | Status |
|---|--------------|------|--------|
| 1 | Dense float arrays (PageRank + PPR) | `algo_ranking.go` | ✅ Done |
| 2 | PPR BFS → Roaring bitmaps | `algo_ranking.go` | ✅ Done (needs fix) |
| 3 | sync.Pool for transient bitmaps | `cache.go` + consumers | ⚠️ Needs fix |
| 4 | LabelPropagation votes reuse | `algo_ranking.go` | ✅ Done |
| 5 | AndCardinality for clustering | `algo_structural.go` | ❓ Check |
| 6 | BatchVertex + resolveProximity | `store_vertex.go`, `gldr.go` | ❌ Not done |
| 7 | ensureVertex empty attrs | `gldr.go` | ❌ Not done |
| 8 | ListEdges via slab iteration | `store_edge.go` | ❌ Not done |

## Verification Checklist

- [ ] All 42 graphstore tests pass
- [ ] All 34 gldr tests pass
- [ ] Add `BenchmarkPageRank` and `BenchmarkPPR`
- [ ] Run `go test -benchmem` to verify memory improvement
