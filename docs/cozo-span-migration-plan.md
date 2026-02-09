# CozoDB Span/Wormhole/SpanMention Migration Plan

## Executive Summary

Migrate `spans`, `wormholes`, and `spanMentions` from Dexie (IndexedDB) to CozoDB. These tables are currently unused in active features but need proper CozoDB schemas for the future projection system.

**Status**: These tables exist in Dexie schema but are NOT actively used. The `projection-cache.service.ts` returns empty results with a TODO.

---

## Current State Analysis

### Dexie Tables (to be REMOVED)

| Table | Dexie Schema | Status |
|-------|--------------|--------|
| `spans` | `'id, worldId, noteId, narrativeId, status, createdAt, contentHash, [noteId+status], [worldId+start+end]'` | Unused |
| `wormholes` | `'id, srcSpanId, dstSpanId, mode, wormholeType, [srcSpanId+dstSpanId]'` | Unused |
| `spanMentions` | `'id, spanId, candidateEntityId, status, [spanId+candidateEntityId]'` | Unused |

### TypeScript Interfaces (src/app/lib/dexie/db.ts)

```typescript
// Span - immutable fact with Web Annotation selectors
interface Span {
    id: string;
    worldId: string;
    noteId: string;
    narrativeId?: string;
    
    // Position (Web Annotation selector)
    start: number;
    end: number;
    text: string;              // The actual text span
    contentHash: string;       // SHA-256 for deduplication
    
    // Classification
    spanKind: 'entity' | 'claim' | 'quote' | 'note';
    status: 'active' | 'detached' | 'reanchored';
    
    // Provenance
    createdBy: 'user' | 'scanner' | 'llm';
    createdAt: number;
    updatedAt: number;
}

// Wormhole - binding contract between spans
interface Wormhole {
    id: string;
    srcSpanId: string;
    dstSpanId: string;
    mode: 'user' | 'suggested' | 'auto';
    confidence: number;
    rationale?: string;
    wormholeType?: string;
    bidirectional: boolean;
    createdAt: number;
    updatedAt: number;
}

// SpanMention - span → candidate entity evidence
interface SpanMention {
    id: string;
    spanId: string;
    candidateEntityId?: string;
    matchType: 'exact' | 'alias' | 'fuzzy' | 'inferred';
    confidence: number;
    evidenceVector?: {
        frequency: number;
        capitalRatio: number;
        contextScore: number;
        cooccurrence: number;
    };
    status: 'pending' | 'accepted' | 'rejected';
    createdAt: number;
    updatedAt: number;
}
```

---

## CozoDB Schema Design

### 1. Spans Relation

```cozo
:create spans {
    id: String =>
    world_id: String,
    note_id: String,
    narrative_id: String?,
    
    // Position
    start: Int,
    end: Int,
    text: String,
    content_hash: String,
    
    // Classification
    span_kind: String,  -- 'entity' | 'claim' | 'quote' | 'note'
    status: String,     -- 'active' | 'detached' | 'reanchored'
    
    // Provenance
    created_by: String, -- 'user' | 'scanner' | 'llm'
    created_at: Float,
    updated_at: Float
}
```

**Indexes needed:**
- Primary: `id` (key attribute)
- By note: `?[note_id, id] := *spans{note_id, id}`
- By world + position: `?[world_id, start, end, id] := *spans{world_id, start, end, id}`
- By content hash: `?[content_hash, id] := *spans{content_hash, id}`
- By status: `?[status, id] := *spans{status, id}`

### 2. Wormholes Relation

```cozo
:create wormholes {
    id: String =>
    src_span_id: String,
    dst_span_id: String,
    mode: String,           -- 'user' | 'suggested' | 'auto'
    confidence: Float,
    rationale: String?,
    wormhole_type: String?,
    bidirectional: Bool,
    created_at: Float,
    updated_at: Float
}
```

**Indexes needed:**
- Primary: `id` (key attribute)
- By source span: `?[src_span_id, id] := *wormholes{src_span_id, id}`
- By destination span: `?[dst_span_id, id] := *wormholes{dst_span_id, id}`
- By span pair: `?[src_span_id, dst_span_id, id] := *wormholes{src_span_id, dst_span_id, id}`

### 3. Span Mentions Relation

```cozo
:create span_mentions {
    id: String =>
    span_id: String,
    candidate_entity_id: String?,
    match_type: String,     -- 'exact' | 'alias' | 'fuzzy' | 'inferred'
    confidence: Float,
    
    -- Evidence vector (flattened for Cozo)
    ev_frequency: Float?,
    ev_capital_ratio: Float?,
    ev_context_score: Float?,
    ev_cooccurrence: Float?,
    
    status: String,         -- 'pending' | 'accepted' | 'rejected'
    created_at: Float,
    updated_at: Float
}
```

**Indexes needed:**
- Primary: `id` (key attribute)
- By span: `?[span_id, id] := *span_mentions{span_id, id}`
- By entity: `?[candidate_entity_id, id] := *span_mentions{candidate_entity_id, id}`
- By span + entity: `?[span_id, candidate_entity_id, id] := *span_mentions{span_id, candidate_entity_id, id}`

---

## Go Operations Required

### File: `GoKitt/internal/store/sqlite_store.go`

Add these methods to `GoSQLiteStore`:

```go
// =========================================================================
// SPAN OPERATIONS
// =========================================================================

// InsertSpan creates a new span
func (s *GoSQLiteStore) InsertSpan(span Span) error

// GetSpan retrieves a span by ID
func (s *GoSQLiteStore) GetSpan(id string) (*Span, error)

// GetSpansByNote retrieves all spans for a note
func (s *GoSQLiteStore) GetSpansByNote(noteId string) ([]Span, error)

// GetSpansByWorld retrieves spans in a world within position range
func (s *GoSQLiteStore) GetSpansByWorldRange(worldId string, start, end int) ([]Span, error)

// GetSpanByContentHash finds span by content hash (deduplication)
func (s *GoSQLiteStore) GetSpanByContentHash(hash string) (*Span, error)

// UpdateSpanStatus updates span status (active/detached/reanchored)
func (s *GoSQLiteStore) UpdateSpanStatus(id string, status string) error

// DeleteSpan removes a span
func (s *GoSQLiteStore) DeleteSpan(id string) error

// =========================================================================
// WORMHOLE OPERATIONS
// =========================================================================

// InsertWormhole creates a new wormhole between spans
func (s *GoSQLiteStore) InsertWormhole(wh Wormhole) error

// GetWormhole retrieves a wormhole by ID
func (s *GoSQLiteStore) GetWormhole(id string) (*Wormhole, error)

// GetWormholesBySource retrieves wormholes from a source span
func (s *GoSQLiteStore) GetWormholesBySource(srcSpanId string) ([]Wormhole, error)

// GetWormholesByDestination retrieves wormholes to a destination span
func (s *GoSQLiteStore) GetWormholesByDestination(dstSpanId string) ([]Wormhole, error)

// GetWormholeByPair finds wormhole between two spans
func (s *GoSQLiteStore) GetWormholeByPair(srcSpanId, dstSpanId string) (*Wormhole, error)

// DeleteWormhole removes a wormhole
func (s *GoSQLiteStore) DeleteWormhole(id string) error

// =========================================================================
// SPAN MENTION OPERATIONS
// =========================================================================

// InsertSpanMention creates a new span mention
func (s *GoSQLiteStore) InsertSpanMention(sm SpanMention) error

// GetSpanMention retrieves a span mention by ID
func (s *GoSQLiteStore) GetSpanMention(id string) (*SpanMention, error)

// GetSpanMentionsBySpan retrieves all mentions for a span
func (s *GoSQLiteStore) GetSpanMentionsBySpan(spanId string) ([]SpanMention, error)

// GetSpanMentionsByEntity retrieves all mentions for an entity candidate
func (s *GoSQLiteStore) GetSpanMentionsByEntity(entityId string) ([]SpanMention, error)

// UpdateSpanMentionStatus updates mention status (pending/accepted/rejected)
func (s *GoSQLiteStore) UpdateSpanMentionStatus(id string, status string) error

// DeleteSpanMention removes a span mention
func (s *GoSQLiteStore) DeleteSpanMention(id string) error
```

### Go Structs Required

```go
// File: GoKitt/internal/store/models.go

type Span struct {
    ID           string
    WorldID      string
    NoteID       string
    NarrativeID  *string
    Start        int
    End          int
    Text         string
    ContentHash  string
    SpanKind     string // 'entity' | 'claim' | 'quote' | 'note'
    Status       string // 'active' | 'detached' | 'reanchored'
    CreatedBy    string // 'user' | 'scanner' | 'llm'
    CreatedAt    float64
    UpdatedAt    float64
}

type Wormhole struct {
    ID            string
    SrcSpanID     string
    DstSpanID     string
    Mode          string  // 'user' | 'suggested' | 'auto'
    Confidence    float64
    Rationale     *string
    WormholeType  *string
    Bidirectional bool
    CreatedAt     float64
    UpdatedAt     float64
}

type SpanMention struct {
    ID                 string
    SpanID             string
    CandidateEntityID  *string
    MatchType          string  // 'exact' | 'alias' | 'fuzzy' | 'inferred'
    Confidence         float64
    EvFrequency        *float64
    EvCapitalRatio     *float64
    EvContextScore     *float64
    EvCooccurrence     *float64
    Status             string  // 'pending' | 'accepted' | 'rejected'
    CreatedAt          float64
    UpdatedAt          float64
}
```

---

## Migration Steps

### Phase 1: Add CozoDB Schemas (NO Dexie changes yet)

1. Create `src/app/lib/cozo/schema/layer2-span-model.ts`:
   ```typescript
   export const SPANS_SCHEMA = `:create spans { ... }`;
   export const WORMHOLES_SCHEMA = `:create wormholes { ... }`;
   export const SPAN_MENTIONS_SCHEMA = `:create span_mentions { ... }`;
   ```

2. Register schemas in `GraphSchema.ts`:
   ```typescript
   import { SPANS_SCHEMA, WORMHOLES_SCHEMA, SPAN_MENTIONS_SCHEMA } from './schema/layer2-span-model';
   
   const allSchemas = [
       ...basicSchemas,
       { name: 'spans', script: SPANS_SCHEMA.trim() },
       { name: 'wormholes', script: WORMHOLES_SCHEMA.trim() },
       { name: 'span_mentions', script: SPAN_MENTIONS_SCHEMA.trim() },
       // ... rest
   ];
   ```

### Phase 2: Add Go Operations

1. Add structs to `GoKitt/internal/store/models.go`
2. Add methods to `GoKitt/internal/store/sqlite_store.go`
3. Export via Wasm in `GoKitt/cmd/wasm/main.go`
4. Add TypeScript operations in `src/app/lib/go/operations.ts`

### Phase 3: Remove from Dexie

1. Remove from `src/app/lib/dexie/db.ts`:
   - Remove `Span`, `Wormhole`, `SpanMention` interfaces (move to types file if needed)
   - Remove table declarations: `spans!`, `wormholes!`, `spanMentions!`
   - Remove from version 4 schema definition

2. Remove from `src/app/lib/nebula/db.ts`:
   - Remove collection declarations
   - Remove from `clearAll()` array

### Phase 4: Update Services

1. Update `projection-cache.service.ts` to use Go operations
2. Search for any other references and update

---

## SQL Table Definitions (for GoSQLite)

```sql
-- Spans table
CREATE TABLE IF NOT EXISTS spans (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    narrative_id TEXT,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    span_kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX idx_spans_note_id ON spans(note_id);
CREATE INDEX idx_spans_world_pos ON spans(world_id, start, end);
CREATE INDEX idx_spans_content_hash ON spans(content_hash);
CREATE INDEX idx_spans_status ON spans(status);

-- Wormholes table
CREATE TABLE IF NOT EXISTS wormholes (
    id TEXT PRIMARY KEY,
    src_span_id TEXT NOT NULL,
    dst_span_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    confidence REAL NOT NULL,
    rationale TEXT,
    wormhole_type TEXT,
    bidirectional INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(src_span_id, dst_span_id)
);

CREATE INDEX idx_wormholes_src ON wormholes(src_span_id);
CREATE INDEX idx_wormholes_dst ON wormholes(dst_span_id);

-- Span Mentions table
CREATE TABLE IF NOT EXISTS span_mentions (
    id TEXT PRIMARY KEY,
    span_id TEXT NOT NULL,
    candidate_entity_id TEXT,
    match_type TEXT NOT NULL,
    confidence REAL NOT NULL,
    ev_frequency REAL,
    ev_capital_ratio REAL,
    ev_context_score REAL,
    ev_cooccurrence REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE(span_id, candidate_entity_id)
);

CREATE INDEX idx_span_mentions_span ON span_mentions(span_id);
CREATE INDEX idx_span_mentions_entity ON span_mentions(candidate_entity_id);
```

---

## Files to Modify

### Add
- `src/app/lib/cozo/schema/layer2-span-model.ts` - CozoDB schemas

### Modify
- `src/app/lib/cozo/graph/GraphSchema.ts` - Register new schemas
- `GoKitt/internal/store/models.go` - Add Go structs
- `GoKitt/internal/store/sqlite_store.go` - Add CRUD operations
- `GoKitt/cmd/wasm/main.go` - Export new functions
- `src/app/lib/go/operations.ts` - TypeScript wrappers

### Remove From (after Phase 1-2 complete)
- `src/app/lib/dexie/db.ts` - Remove tables and interfaces
- `src/app/lib/nebula/db.ts` - Remove collections

### Update
- `src/app/lib/services/projection-cache.service.ts` - Use Go operations

---

## TODO Tracking

- [ ] Create `layer2-span-model.ts` with CozoDB schemas
- [ ] Register schemas in `GraphSchema.ts`
- [ ] Add Go structs to `models.go`
- [ ] Add SQL table creation to `sqlite_store.go`
- [ ] Add CRUD operations for spans
- [ ] Add CRUD operations for wormholes
- [ ] Add CRUD operations for span_mentions
- [ ] Export via Wasm
- [ ] Add TypeScript operations
- [ ] Remove from Dexie db.ts
- [ ] Remove from NebulaDB
- [ ] Update projection-cache.service.ts
- [ ] Verify build passes
