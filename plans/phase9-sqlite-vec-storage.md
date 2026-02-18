# Phase 9 Parts 4 & 5: SQLite Vec Storage & Performance Metrics

## Overview

Wire SQLite storage for HNSW persistence, mapper state, and chunk metadata. Add performance metrics for expansion loop monitoring.

---

## Part 4: SQLite Tables

### Table Schema

```sql
-- HNSW index blobs per dimension
-- dim=256, 384, 768, 1536 etc.
CREATE TABLE IF NOT EXISTS hnsw_index (
    dim INTEGER PRIMARY KEY,
    version INTEGER NOT NULL,
    bytes BLOB NOT NULL
);

-- DocID mapper state (uint32 ↔ string mapping)
CREATE TABLE IF NOT EXISTS docid_map (
    id INTEGER PRIMARY KEY,
    docid TEXT NOT NULL UNIQUE
);

-- Chunk metadata with scope filtering
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id INTEGER PRIMARY KEY,
    doc_id INTEGER NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    scope_narrative TEXT,
    scope_folder TEXT,
    FOREIGN KEY (doc_id) REFERENCES docid_map(id)
);
```

### API Design

```go
// HNSW Persistence
func (s *SQLiteStore) SaveHNSW(dim int, data []byte) error
func (s *SQLiteStore) LoadHNSW(dim int) ([]byte, error)
func (s *SQLiteStore) ListHNSWDims() ([]int, error)

// Mapper Persistence
func (s *SQLiteStore) SaveDocIDMapper(mapper *qgram.DocIDMapper) error
func (s *SQLiteStore) LoadDocIDMapper() (*qgram.DocIDMapper, error)
func (s *SQLiteStore) SaveChunkIDMapper(mapper *chunker.ChunkIDMapper) error
func (s *SQLiteStore) LoadChunkIDMapper() (*chunker.ChunkIDMapper, error)

// Chunk Persistence
func (s *SQLiteStore) SaveChunks(chunks []chunker.Chunk) error
func (s *SQLiteStore) LoadChunks() ([]chunker.Chunk, error)
func (s *SQLiteStore) GetChunksByDoc(docID string) ([]chunker.Chunk, error)
func (s *SQLiteStore) GetChunksByScope(narrativeID, folderPath string) ([]chunker.Chunk, error)
```

### Startup Flow

```
1. Initialize SQLiteStore
2. Load DocIDMapper from docid_map table
3. Load ChunkIDMapper from docid_map (or separate table)
4. Load HNSW blobs per dimension into DimensionRouter
5. Load chunk metadata into memory
6. Ready for queries
```

---

## Part 5: Performance Metrics

### Expansion Loop Hit Rate

Track how often the hybrid search needs to expand beyond initial fetch:

```go
type HybridMetrics struct {
    TotalQueries       int64
    Expansion1xCount   int64  // First expansion (4x)
    Expansion2xCount   int64  // Second expansion (8x)
    Expansion3xCount   int64  // Third expansion (16x)
    PhraseHardRejects  int64  // Candidates rejected by PhraseHard
    AvgResultsReturned float64
}

func (m *HybridMetrics) ExpansionHitRate() float64 {
    if m.TotalQueries == 0 {
        return 0
    }
    return float64(m.Expansion1xCount+m.Expansion2xCount+m.Expansion3xCount) / float64(m.TotalQueries)
}
```

### Integration Point

Add metrics collection to [`hybrid/search.go`](GoKitt/pkg/hybrid/search.go):

```go
func (hx *HybridIndex) SearchWithMetrics(input SearchInput, config HybridConfig) ([]HybridResult, *HybridMetrics) {
    // Track expansion iterations
    // Track PhraseHard rejections
    // Return results + metrics
}
```

---

## Implementation Order

1. **Add tables to schema** in `sqlite_store.go`
2. **Implement SaveHNSW/LoadHNSW**
3. **Implement SaveDocIDMapper/LoadDocIDMapper**
4. **Implement SaveChunks/LoadChunks**
5. **Add startup load logic** to `main.go`
6. **Add HybridMetrics** to `hybrid` package
7. **Wire metrics into search path**

---

## Files to Modify

| File | Changes |
|------|---------|
| `internal/store/sqlite_store.go` | Add tables, implement persistence methods |
| `internal/store/models.go` | Add ChunkRecord struct |
| `pkg/hybrid/search.go` | Add metrics collection |
| `pkg/hybrid/hybrid.go` | Add HybridMetrics field |
| `cmd/wasm/main.go` | Add startup load logic |

---

## Testing Strategy

1. **Unit tests** for each persistence method
2. **Roundtrip test**: Save → Load → Verify
3. **Integration test**: Full startup flow
4. **Metrics test**: Verify expansion tracking
