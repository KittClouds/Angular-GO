# Polymorphic Temporal Edge System Design

## Overview

Design a temporal edge system for GLDR that supports multiple time representations:
- **Narrative chapters** (Chapter 1, Chapter 2, etc.)
- **Calendar time** (real-world dates)
- **Story time** (custom narrative time like "Day 1", "Spring", "1995")
- **Custom time** (user-defined temporal markers)

## Current State Analysis

### Existing Temporal Support

| Component | Current Implementation |
|-----------|----------------------|
| Graptor `EntityMention` | `ChapterID uint32` |
| Graptor `CrossChapterEdge` | `SourceChapter`, `TargetChapter uint32` |
| GraphStore `graph_properties` | `valid_from`, `valid_until` (timestamp-based) |
| GLDR `GraphEdge` | **No temporal fields** |

### Gap Analysis

1. **GLDR `GraphEdge`** has no temporal tracking
2. **No polymorphic time model** - only chapters or timestamps, not both
3. **No temporal filtering** on graph queries
4. **No time-travel queries** ("relationships as of chapter 5")

---

## Design

### 1. TemporalMarker Struct

```go
// TemporalMarker represents a point in time using multiple time systems.
// Only one field should be set at a time, indicated by Source.
type TemporalMarker struct {
    // Narrative chapter (1-indexed)
    Chapter *uint32 `json:"chapter,omitempty"`
    
    // Calendar time (Unix milliseconds)
    Calendar *int64 `json:"calendar,omitempty"`
    
    // Story time (custom string like "Day 1", "Spring", "1995")
    StoryTime *string `json:"storyTime,omitempty"`
    
    // Custom ordinal (user-defined sequence)
    Ordinal *int64 `json:"ordinal,omitempty"`
    
    // Source indicates which field is active
    // Values: "chapter", "calendar", "story", "ordinal", ""
    Source string `json:"source"`
}

// IsZero returns true if no temporal marker is set.
func (tm *TemporalMarker) IsZero() bool {
    return tm.Source == "" || 
           (tm.Chapter == nil && tm.Calendar == nil && 
            tm.StoryTime == nil && tm.Ordinal == nil)
}

// Compare returns -1, 0, or 1 based on temporal ordering.
// Returns error if markers use different sources.
func (tm *TemporalMarker) Compare(other *TemporalMarker) (int, error) {
    if tm.Source != other.Source {
        return 0, fmt.Errorf("cannot compare different temporal sources: %s vs %s", tm.Source, other.Source)
    }
    
    switch tm.Source {
    case "chapter":
        return compareUint32(tm.Chapter, other.Chapter), nil
    case "calendar":
        return compareInt64(tm.Calendar, other.Calendar), nil
    case "ordinal":
        return compareInt64(tm.Ordinal, other.Ordinal), nil
    case "story":
        return 0, fmt.Errorf("story time is not comparable")
    default:
        return 0, fmt.Errorf("unknown temporal source: %s", tm.Source)
    }
}
```

### 2. TemporalRange for Queries

```go
// TemporalRange defines a time range for filtering.
type TemporalRange struct {
    Start *TemporalMarker `json:"start,omitempty"`
    End   *TemporalMarker `json:"end,omitempty"`
    
    // Inclusive flags
    StartInclusive bool `json:"startInclusive"`
    EndInclusive   bool `json:"endInclusive"`
}

// Contains checks if a marker falls within the range.
func (tr *TemporalRange) Contains(marker *TemporalMarker) (bool, error) {
    if tr.Start != nil {
        cmp, err := tr.Start.Compare(marker)
        if err != nil {
            return false, err
        }
        if tr.StartInclusive && cmp > 0 {
            return false, nil
        }
        if !tr.StartInclusive && cmp >= 0 {
            return false, nil
        }
    }
    
    if tr.End != nil {
        cmp, err := tr.End.Compare(marker)
        if err != nil {
            return false, err
        }
        if tr.EndInclusive && cmp < 0 {
            return false, nil
        }
        if !tr.EndInclusive && cmp <= 0 {
            return false, nil
        }
    }
    
    return true, nil
}
```

### 3. Updated GraphEdge

```go
// GraphEdge is a lightweight edge descriptor with temporal tracking.
type GraphEdge struct {
    TargetID   string         `json:"targetId"`
    RelType    string         `json:"relType"`
    Confidence float64        `json:"confidence"`
    Source     string         `json:"source"` // "explicit", "inferred", "cooccurrence"
    
    // NEW: Temporal tracking
    ValidFrom  *TemporalMarker `json:"validFrom,omitempty"`
    ValidUntil *TemporalMarker `json:"validUntil,omitempty"`
}

// IsValidAt checks if the edge was valid at a given temporal marker.
func (e *GraphEdge) IsValidAt(marker *TemporalMarker) (bool, error) {
    // No temporal bounds = always valid
    if e.ValidFrom == nil && e.ValidUntil == nil {
        return true, nil
    }
    
    range_ := TemporalRange{
        Start:          e.ValidFrom,
        End:            e.ValidUntil,
        StartInclusive: true,
        EndInclusive:   true,
    }
    return range_.Contains(marker)
}
```

### 4. Temporal Query Options

```go
// TemporalQueryOptions controls time-based filtering.
type TemporalQueryOptions struct {
    // AsOf returns the graph state at a specific point in time
    AsOf *TemporalMarker `json:"asOf,omitempty"`
    
    // During returns edges valid during a time range
    During *TemporalRange `json:"during,omitempty"`
    
    // IncludeTimeless includes edges without temporal markers
    IncludeTimeless bool `json:"includeTimeless"`
    
    // TemporalMode controls how temporal edges are handled
    // "strict" = only edges valid at AsOf
    // "snapshot" = graph state as of AsOf (includes timeless)
    // "full" = ignore temporal markers
    TemporalMode string `json:"temporalMode"`
}

// PathOptions extends existing path options with temporal filtering.
type PathOptions struct {
    MaxDepth     int
    EdgeFilter   *EdgePattern
    NodeFilter   *NodePattern
    
    // NEW: Temporal filtering
    Temporal     *TemporalQueryOptions
}
```

### 5. GLDR Index Integration

```go
// AddGraphEdgeWithTemporal adds an edge with temporal markers.
func (idx *GLDRIndex) AddGraphEdgeWithTemporal(sourceID string, edge GraphEdge) {
    idx.mu.Lock()
    defer idx.mu.Unlock()
    
    srcUUID := idx.ensureVertex(sourceID)
    tgtUUID := idx.ensureVertex(edge.TargetID)
    
    // Store temporal markers in edge attributes
    attrs := make(map[string]string)
    attrs["type"] = edge.RelType
    attrs["source"] = edge.Source
    
    if edge.ValidFrom != nil {
        attrs["valid_from_source"] = edge.ValidFrom.Source
        if edge.ValidFrom.Chapter != nil {
            attrs["valid_from_chapter"] = fmt.Sprintf("%d", *edge.ValidFrom.Chapter)
        }
        // ... other temporal fields
    }
    
    _ = idx.Store.AddEdge(srcUUID, tgtUUID, graph.Edge[uuid.UUID]{
        Properties: graph.EdgeProperties{
            Weight:     edge.Confidence,
            Attributes: attrs,
        },
    })
}

// FindPaths finds paths with optional temporal filtering.
func (idx *GLDRIndex) FindPaths(sourceID string, opts PathOptions) [][]string {
    // ... existing path finding logic ...
    
    // Apply temporal filter
    if opts.Temporal != nil && opts.Temporal.AsOf != nil {
        paths = idx.filterPathsByTime(paths, opts.Temporal)
    }
    
    return paths
}
```

### 6. GraphStore Schema Update

The existing `graph_edges` table already supports temporal via attributes. We add a helper table:

```sql
-- Optional: Index temporal markers for efficient queries
CREATE TABLE IF NOT EXISTS edge_temporal (
    edge_id        INTEGER PRIMARY KEY REFERENCES graph_edges(rowid),
    source_id      TEXT NOT NULL,
    target_id      TEXT NOT NULL,
    valid_from_chapter INTEGER,
    valid_until_chapter INTEGER,
    valid_from_calendar INTEGER,
    valid_until_calendar INTEGER,
    valid_from_ordinal  INTEGER,
    valid_until_ordinal INTEGER,
    valid_from_story    TEXT,
    valid_until_story   TEXT,
    temporal_source     TEXT NOT NULL
);

CREATE INDEX idx_edge_temporal_chapter ON edge_temporal(temporal_source, valid_from_chapter, valid_until_chapter);
CREATE INDEX idx_edge_temporal_calendar ON edge_temporal(temporal_source, valid_from_calendar, valid_until_calendar);
```

---

## Query Patterns

### Pattern 1: "Show Ryan's relationships as of Chapter 5"

```go
results := idx.FindPaths("Ryan", PathOptions{
    MaxDepth: 2,
    Temporal: &TemporalQueryOptions{
        AsOf: &TemporalMarker{
            Chapter: ptr(uint32(5)),
            Source:  "chapter",
        },
        IncludeTimeless: true,
        TemporalMode:    "snapshot",
    },
})
```

### Pattern 2: "Show relationships that changed between Chapter 3 and Chapter 7"

```go
results := idx.FindPaths("Ryan", PathOptions{
    Temporal: &TemporalQueryOptions{
        During: &TemporalRange{
            Start:          &TemporalMarker{Chapter: ptr(uint32(3)), Source: "chapter"},
            End:            &TemporalMarker{Chapter: ptr(uint32(7)), Source: "chapter"},
            StartInclusive: true,
            EndInclusive:   true,
        },
    },
})
```

### Pattern 3: "Show relationships on a specific date"

```go
results := idx.FindPaths("Ryan", PathOptions{
    Temporal: &TemporalQueryOptions{
        AsOf: &TemporalMarker{
            Calendar: ptr(int64(time.Date(1995, 3, 15, 0, 0, 0, 0, time.UTC).UnixMilli())),
            Source:   "calendar",
        },
    },
})
```

---

## Implementation Plan

### Phase 1: Core Types (Low Risk)
1. Add `TemporalMarker` struct to `pkg/gldr/temporal.go`
2. Add `TemporalRange` struct
3. Add comparison and validation methods
4. Unit tests for temporal logic

### Phase 2: GraphEdge Update (Medium Risk)
1. Add `ValidFrom`, `ValidUntil` to `GraphEdge`
2. Update `AddGraphEdge` to accept temporal markers
3. Add `AddGraphEdgeWithTemporal` method
4. Update JSON serialization

### Phase 3: GraphStore Integration (Medium Risk)
1. Add temporal attribute serialization in `AddEdge`
2. Add temporal attribute deserialization in edge retrieval
3. Optional: Add `edge_temporal` table for indexed queries

### Phase 4: Query API (Higher Risk)
1. Add `TemporalQueryOptions` to path finding
2. Add `filterPathsByTime` method
3. Add temporal filtering to `ExtractSubgraph`
4. Add temporal filtering to `PersonalizedPageRank`

### Phase 5: Graptor Integration (Medium Risk)
1. Update `CrossChapterEdge` to use `TemporalMarker`
2. Update `GraptorConductor` to set temporal markers on edges
3. Update chapter-based edge creation

---

## Backward Compatibility

- Edges without temporal markers are treated as "timeless" (always valid)
- `IncludeTimeless: true` (default) includes timeless edges in temporal queries
- Existing `AddGraphEdge` calls continue to work (no temporal markers)
- New `AddGraphEdgeWithTemporal` for explicit temporal edges

---

## Testing Strategy

1. **Unit Tests**: TemporalMarker comparison, range containment
2. **Integration Tests**: Graph edge creation with temporal markers
3. **Query Tests**: Time-travel queries return correct edges
4. **Performance Tests**: Temporal filtering overhead

---

## Design Decisions

1. **Story Time Ordering**: ✅ Lexicographic comparison
   - Story time strings are compared lexicographically (e.g., "Day 1" < "Day 2" < "Day 10")
   - Users should use zero-padded formats for numeric sequences: "Day 01", "Day 02", etc.

2. **Temporal Indexing**: ✅ Pre-index temporal markers
   - Add `edge_temporal` table for O(log n) temporal queries
   - Trade-off: Additional storage (~16 bytes per edge) for faster queries

3. **PPR Time Travel**: ✅ Support with safe caching
   - Build per-snapshot adjacency cache on demand
   - Cache snapshots with LRU eviction
   - Mark as "safe" because it doesn't modify the base graph
