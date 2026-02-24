# Zero-Copy Optimization Plan: `profile.go`

## Executive Summary

Analysis of [`profile.go`](GoKitt/pkg/graptor/profile.go) reveals **3 critical allocation hotspots** that violate zero-copy principles. The most egregious is on line 134 - allocating up to 1 million structs just to get a count.

---

## Critical Issues

### 1. **CRITICAL: `GetTopPairs(1000000)` - Line 134**

```go
// CURRENT - ALLOCATES UP TO 40MB+ JUST TO COUNT!
pairs := cooccurrence.GetTopPairs(1000000) // Get all
graptorStats.CooccurrenceCount = len(pairs)
```

**Problem:**
- [`GetTopPairs()`](GoKitt/pkg/graptor/cooccurrence.go:191) calls [`GetAllPairs()`](GoKitt/pkg/graptor/cooccurrence.go:159)
- Allocates a slice of `CooccurrencePair` structs (2 strings + 1 int each ≈ 40+ bytes)
- For 1M pairs: **40MB+ allocation** just to get `len()`
- Then the slice is immediately garbage

**Solution:**
- [`CooccurrenceStats.Stats()`](GoKitt/pkg/graptor/cooccurrence.go:208) already returns `TotalPairs` - USE IT!
- Zero allocation, O(1) complexity

```go
// ZERO-COPY FIX
if cooccurrence != nil {
    graptorStats.CooccurrenceCount = cooccurrence.Stats().TotalPairs
}
```

---

### 2. **MODERATE: `GetAllChapters()` - Lines 139-146**

```go
// CURRENT - ALLOCATES SLICE OF POINTERS
chapters := chapterMgr.GetAllChapters()
totalRingSize := 0
for _, ch := range chapters {
    if ch.lastMentioned != nil {
        totalRingSize += ch.lastMentioned.Len()
    }
}
```

**Problem:**
- [`GetAllChapters()`](GoKitt/pkg/graptor/chapter_context.go:482) allocates `[]*ChapterContext`
- Only used to iterate and sum ring buffer sizes
- Slice is thrown away after counting

**Solution:**
- Add a `Stats()` method to `ChapterManager` that returns ring buffer totals
- Or add a `GetTotalRingBufferSize()` method

```go
// ZERO-COPY FIX - Add to ChapterManager
func (cm *ChapterManager) GetTotalRingBufferSize() int {
    cm.mu.RLock()
    defer cm.mu.RUnlock()
    
    total := 0
    for _, ctx := range cm.chapters {
        if ctx.lastMentioned != nil {
            total += ctx.lastMentioned.Len()
        }
    }
    return total
}
```

---

### 3. **MODERATE: `GetSnapshots()` - Line 175**

```go
// CURRENT - COPIES ENTIRE SLICE
func (mp *MemoryProfiler) GetSnapshots() []ProfileSnapshot {
    mp.mu.RLock()
    defer mp.mu.RUnlock()
    return append([]ProfileSnapshot{}, mp.snapshots...)
}
```

**Problem:**
- Copies all snapshots on every call
- Each `ProfileSnapshot` ≈ 200+ bytes (MemoryStats + GraptorStats + Duration)
- With 100 snapshots: **20KB+ per call**
- Multiple callers = multiple copies

**Solutions:**

**Option A: Iterator Pattern (Recommended)**
```go
// ZERO-COPY: Iterator callback
func (mp *MemoryProfiler) ForEachSnapshot(fn func(ProfileSnapshot) bool) {
    mp.mu.RLock()
    defer mp.mu.RUnlock()
    for _, s := range mp.snapshots {
        if !fn(s) {
            break
        }
    }
}
```

**Option B: Return Read-Only View**
```go
// ZERO-COPY: Return slice header without copying
func (mp *MemoryProfiler) GetSnapshotsReadOnly() []ProfileSnapshot {
    mp.mu.RLock()
    defer mp.mu.RUnlock()
    return mp.snapshots // Caller MUST NOT modify!
}
```

**Option C: Keep defensive copy but document cost**
- Current approach is safe but allocates
- Document that callers should cache results

---

## Implementation Priority

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| **P0** | GetTopPairs | 40MB+ per snapshot | Trivial - 1 line |
| **P1** | GetAllChapters | ~1KB per snapshot | Easy - add method |
| **P2** | GetSnapshots | 20KB per call | Medium - API change |

---

## Additional Observations

### MemoryStats Copy (Lines 89-115)

The copy from `runtime.MemStats` to `MemoryStats` is **unavoidable** because:
1. `runtime.MemStats` cannot be retained (it's filled by `ReadMemStats`)
2. We need JSON serialization with specific field names
3. Using `unsafe` for true zero-copy would be fragile

This is acceptable overhead.

### Delta Method (Lines 186-204)

Creates a new `MemoryStats` for delta - this is fine since it's a small struct and the result is needed.

---

## Proposed Changes

### File: `GoKitt/pkg/graptor/profile.go`

```go
// CaptureSnapshot - ZERO-COPY VERSION
func (mp *MemoryProfiler) CaptureSnapshot(registry *GlobalEntityRegistry, cooccurrence *CooccurrenceStats, chapterMgr *ChapterManager) ProfileSnapshot {
    // ... memory stats capture unchanged ...

    // ZERO-COPY: Use Stats() instead of GetTopPairs
    if cooccurrence != nil {
        graptorStats.CooccurrenceCount = cooccurrence.Stats().TotalPairs
    }

    // ZERO-COPY: Use dedicated method
    if chapterMgr != nil {
        graptorStats.RingBufferSize = chapterMgr.GetTotalRingBufferSize()
    }

    // ... rest unchanged ...
}
```

### File: `GoKitt/pkg/graptor/chapter_context.go`

Add new method to `ChapterManager`:

```go
// GetTotalRingBufferSize returns the total size of all ring buffers.
// ZERO-COPY: Does not allocate any slices.
func (cm *ChapterManager) GetTotalRingBufferSize() int {
    cm.mu.RLock()
    defer cm.mu.RUnlock()
    
    total := 0
    for _, ctx := range cm.chapters {
        if ctx.lastMentioned != nil {
            total += ctx.lastMentioned.Len()
        }
    }
    return total
}
```

---

## Testing Strategy

1. **Benchmark before/after** with large datasets (10K+ entities, 100K+ co-occurrences)
2. **Verify counts match** between old and new implementations
3. **Memory profile** to confirm allocation reduction

---

## Questions for User

1. Should we change `GetSnapshots()` API or keep backward compatibility?
2. Are there other callers of `GetTopPairs()` that could benefit from `Stats()`?
3. Should we add more stats to `ChapterManager.Stats()` for future zero-copy access?
