# RAPTOR Evaluation Harness Plan

## Overview

Build an evaluation harness to test RAPTOR retrieval quality using "The Perfect Run" document (36k+ lines, 130 chapters).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TypeScript / Angular                         │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │ LocalEmbedding    │    │ RaptorEvalService                │  │
│  │ Provider          │    │ - Ingest documents               │  │
│  │ (HuggingFace)     │    │ - Run queries                    │  │
│  │ - all-MiniLM-L6   │    │ - Compare modes                  │  │
│  └────────┬─────────┘    └──────────────┬───────────────────┘  │
│           │                               │                      │
│           │ embeddings[]                  │ JS calls             │
│           ▼                               ▼                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              GoKitt WASM (Go)                               │ │
│  │  ┌─────────────────────────────────────────────────────┐   │ │
│  │  │ RaptorIndex                                          │   │ │
│  │  │ - IngestDocument(docID, text, embeddings)            │   │ │
│  │  │ - BuildTree(embedFn)                                 │   │ │
│  │  │ - Search(query, queryVec, k)                         │   │ │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Phase 1: WASM Bridge for RAPTOR

### Go Functions to Export

```go
// RAPTOR Index Management
raptorInit()                           // Initialize RAPTOR index
raptorIngest(docID, text, embeddings)  // Ingest with pre-computed embeddings
raptorBuildTree()                      // Build tree from ingested docs
raptorSearch(query, embeddings, k)     // Search with query embeddings
raptorSearchAggregated(query, embeddings, k) // Search with doc aggregation

// Persistence
raptorSave()                           // Save to SQLite
raptorLoad()                           // Load from SQLite
raptorClear()                          // Clear index
```

### TypeScript Service

```typescript
// src/app/services/raptor-eval.service.ts
export class RaptorEvalService {
  private embeddingProvider: LocalEmbeddingProvider;
  
  async ingestDocument(docID: string, text: string): Promise<void> {
    // 1. Chunk text
    const chunks = this.chunkText(text, 512, 128);
    
    // 2. Get embeddings for chunks
    const embeddings = await this.embeddingProvider.embed(chunks);
    
    // 3. Call Go WASM
    GoKitt.raptorIngest(docID, chunks, embeddings);
  }
  
  async search(query: string, k: number): Promise<RaptorResult[]> {
    // 1. Get query embedding
    const [queryVec] = await this.embeddingProvider.embed([query]);
    
    // 2. Call Go WASM
    return GoKitt.raptorSearch(query, queryVec, k);
  }
}
```

## Phase 2: Gold Query Set

### Query Categories

1. **Exact Phrase Lookups (20 queries)**
   - "Ryan Romano" → find character mentions
   - "Quicksave" → find superhero identity
   - "New Rome" → find city descriptions
   - "Dynamis Tower" → find location references

2. **Paraphrase Questions (30 queries)**
   - "What is Ryan's superpower?" → time loops / save points
   - "Who is the ice assassin?" → Ghoul
   - "What happened at the bar?" → Renesco's Jolie Wrangler attack
   - "Describe the city setting" → New Rome description

3. **Thematic Multi-Hop (30 queries)**
   - "How does Ryan's immortality affect his relationships?"
   - "What are the major factions in New Rome?"
   - "Trace the Meta-Gang storyline across chapters"
   - "Compare Dynamis Corporation's role in different arcs"

4. **Cross-Chapter Queries (20 queries)**
   - "Find all mentions of the black briefcase"
   - "Track character introductions across chapters"
   - "Locate all fight scenes with Genomes"

### Ground Truth Format

```typescript
interface GoldQuery {
  id: string;
  query: string;
  category: 'exact' | 'paraphrase' | 'thematic' | 'cross-chapter';
  expectedChunks: string[];  // Chunk IDs that should match
  expectedDocs: string[];    // Doc IDs (chapters) that should match
  relevanceGrades: Record<string, number>; // chunkId -> 0-3 relevance
}
```

## Phase 3: Evaluation Metrics

### Retrieval Quality

```typescript
interface EvalMetrics {
  // Per-query metrics
  precision: number;      // TP / (TP + FP)
  recall: number;         // TP / (TP + FN)
  f1: number;             // 2 * P * R / (P + R)
  mrr: number;            // Mean Reciprocal Rank
  ndcg: number;           // Normalized DCG
  
  // Aggregate metrics
  map: number;            // Mean Average Precision
  recallAtK: number[];    // Recall@1, @5, @10, @20
}
```

### Mode Comparison

```typescript
interface ModeComparison {
  mode: 'leaf-only' | 'router-leaf' | 'collapsed-tree';
  metrics: EvalMetrics;
  latencyMs: number;
  expansionsUsed: number;  // For expansion loop tracking
}
```

## Phase 4: Implementation Steps

### Step 1: WASM Bridge (Code mode)
- Add RAPTOR functions to `GoKitt/cmd/wasm/main.go`
- Create TypeScript service in `src/app/services/raptor-eval.service.ts`

### Step 2: Document Ingestion (Code mode)
- Load "Perfect Run" from `docs/perfect_run.md`
- Chunk into 512-byte segments with 128-byte overlap
- Generate embeddings via LocalEmbeddingProvider
- Store in RAPTOR index

### Step 3: Gold Query Set (Code mode)
- Create `src/app/lib/eval/gold-queries.ts`
- Define 100 queries with ground truth
- Include relevance grades for NDCG

### Step 4: Evaluation Runner (Code mode)
- Create `src/app/lib/eval/eval-runner.ts`
- Run all queries against all modes
- Generate comparison report

### Step 5: Analysis Dashboard (Code mode)
- Create Angular component for results
- Show per-query breakdown
- Compare mode performance

## Expected Outcomes

1. **Collapsed-tree should outperform leaf-only** for thematic/multi-hop queries
2. **Router-leaf should be faster** but may miss cross-chapter connections
3. **Hard failures** (vector picks right region, qgram rejects) indicate expansion loop stress

## Files to Create

```
GoKitt/cmd/wasm/raptor.go           # WASM bridge for RAPTOR
src/app/services/raptor-eval.service.ts  # TS service
src/app/lib/eval/gold-queries.ts    # Gold query set
src/app/lib/eval/eval-runner.ts     # Evaluation runner
src/app/lib/eval/types.ts           # TypeScript types
src/app/components/eval-dashboard/  # Results UI
```

## Next Steps

1. **Shall I proceed with WASM bridge implementation?**
2. **Do you want to start with a smaller test document first?**
3. **Should I create the gold query set manually or generate it?**
