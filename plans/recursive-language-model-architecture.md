# Recursive Language Model (RLM) Architecture

## Executive Summary

This document outlines the architecture for a **graph-native Recursive Language Model** system built on CozoDB. The key insight: **recursion works better in a graph**. Instead of implementing RLM logic in Go, we leverage CozoDB's Datalog engine for recursive queries, fixed-point computation, and graph traversal.

## 1. Foundational Principles

### 1.1 Why Graph-Based RLM?

Traditional RLM implementations use imperative loops in application code. This approach has limitations:
- **State management complexity**: Manual tracking of recursion depth, visited nodes, and termination conditions
- **No native backtracking**: Must implement search strategies manually
- **Limited composability**: Hard to combine multiple reasoning paths

**Graph-based RLM advantages**:
- **Native recursion**: Datalog's fixed-point semantics handle recursive queries naturally
- **Declarative reasoning**: Express *what* to discover, not *how* to traverse
- **Composable queries**: Chain reasoning steps through relation composition
- **Built-in memoization**: CozoDB caches intermediate results

### 1.2 Core Design Decisions

| Decision | Rationale |
|----------|-----------|
| Workspace as first-class subgraph | Isolated namespace for model experimentation without polluting canonical data |
| Model-authored Cozo queries | Discovery over hardcoding - let the model find retrieval strategies |
| RO/WS split | Read-only across all data, write-only to workspace - safety by design |
| Episode logging | Every retrieval attempt becomes an auditable artifact |
| TypeScript implementation | No Go complexity - leverage existing CozoDB WASM directly |

## 2. Workspace Schema Design

### 2.1 Namespace Isolation

All workspace relations use the `ws_` prefix and are keyed by `workspace_id`. This allows multiple concurrent reasoning sessions without collision.

```cozo
# Session metadata - one per reasoning episode
:create ws_session {
    workspace_id: String =>
    world_id: String,
    created_at: Float,
    meta: Json default {}
}

# Nodes - the model's working memory
:create ws_node {
    workspace_id: String,
    node_id: String =>
    kind: String,              # prompt | thread | claim | span | plan | query | result | draft
    json: Json default {},     # arbitrary payload
    created_at: Float,
    updated_at: Float
}

# Edges - relationships between workspace nodes
:create ws_edge {
    workspace_id: String,
    from_id: String,
    to_id: String,
    rel: String =>             # produced | refines | contradicts | supports | derives
    meta: Json default {},
    created_at: Float
}

# Materialized views - cached query results
:create ws_view_cache {
    workspace_id: String,
    view_id: String =>
    json: Json,                # materialized view payload
    created_at: Float,
    updated_at: Float
}

# Metrics - performance tracking
:create ws_metric {
    workspace_id: String,
    key: String =>
    value: Json,               # {query_id, lat_ms, rows, cost}
    ts: Float
}
```

### 2.2 Node Kind Taxonomy

| Kind | Purpose | JSON Payload |
|------|---------|--------------|
| `prompt` | Long context storage | `{body, source_note_id, cursor, chunks}` |
| `thread` | Conversation thread reference | `{thread_id, message_count}` |
| `claim` | Extracted assertion | `{text, confidence, source_ids}` |
| `span` | Temporal segment | `{start_ts, end_ts, entities}` |
| `plan` | Reasoning plan | `{steps, current_step, status}` |
| `query` | Cozo query script | `{script, bindings, intent, cost_budget}` |
| `result` | Query result | `{rows, schema, provenance, truncated}` |
| `draft` | Working output | `{content, version, parent_id}` |

### 2.3 Edge Relationship Types

| Rel | Meaning | Example |
|-----|---------|---------|
| `produced` | Query → Result | Query node produced result node |
| `refines` | Draft → Draft | New version refines previous |
| `contradicts` | Claim → Claim | New evidence contradicts claim |
| `supports` | Result → Claim | Evidence supports claim |
| `derives` | Claim → Draft | Claim derived into output |
| `references` | Node → Entity | Workspace node references canonical entity |

## 3. Query Execution Model

### 3.1 Two-Lane Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Model Query Request                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   Query Classifier    │
                    │  (RO vs WS mutation)  │
                    └───────────────────────┘
                           │         │
              ┌────────────┘         └────────────┐
              ▼                                   ▼
    ┌─────────────────┐                 ┌─────────────────┐
    │   RunRO Lane    │                 │   RunWS Lane    │
    │                 │                 │                 │
    │ • Read all data │                 │ • Write ws_*    │
    │ • FTS queries   │                 │ • Update nodes  │
    │ • Vector search │                 │ • Create edges  │
    │ • Graph expand  │                 │ • Log episodes  │
    │                 │                 │                 │
    │ VALIDATOR:      │                 │ VALIDATOR:      │
    │ • No mutations  │                 │ • ws_* only     │
    │ • :limit req'd  │                 │ • No canonical  │
    │ • Time caps     │                 │   data writes   │
    └─────────────────┘                 └─────────────────┘
              │                                   │
              └────────────┐         ┌────────────┘
                           ▼         ▼
                    ┌───────────────────────┐
                    │   Episode Logger      │
                    │   (Audit Trail)       │
                    └───────────────────────┘
```

### 3.2 RunRO: Read-Only Query Execution

**Allowlist**:
- `?[...] := ...` (pure queries)
- `:order`, `:limit`, `:offset`
- FTS: `~relation:fts_idx {...| query: ...}`
- Vector: `~relation:hnsw_idx {...| query_vec: ..., k: ..., ef: ...}`
- Aggregations: `count`, `mean`, `sum`, `min`, `max`
- Graph traversal: recursive rules with fixed-point

**Hard Caps**:
```typescript
interface ROCaps {
    maxRuntimeMs: 5000;      // 5 second timeout
    maxRows: 1000;           // Limit result size
    maxOutputBytes: 1_000_000; // 1MB max response
    requireLimit: true;      // Must have :limit unless FTS/vector
}
```

**Validation Rules**:
```typescript
function validateRO(script: string): ValidationResult {
    // Block all mutations
    if (/:put|:rm|:update|:create|:delete/i.test(script)) {
        return { valid: false, error: 'Mutations not allowed in RO mode' };
    }
    
    // Require :limit for non-indexed queries
    if (!/:limit/i.test(script) && !isIndexedQuery(script)) {
        return { valid: false, error: 'Non-indexed queries require :limit' };
    }
    
    return { valid: true };
}
```

### 3.3 RunWS: Workspace Mutation Execution

**Allowlist**:
- `:put ws_*` - Insert into workspace relations
- `:rm ws_*` - Remove from workspace relations
- `:update ws_*` - Update workspace relations

**Forbidden**:
- Any mutation to non-ws relations (entities, notes, blocks, etc.)
- Schema modifications (`:create`, `::index`)

**Validation Rules**:
```typescript
function validateWS(script: string): ValidationResult {
    // Extract target relations
    const mutations = extractMutations(script);
    
    for (const mutation of mutations) {
        if (!mutation.relation.startsWith('ws_')) {
            return { 
                valid: false, 
                error: `Cannot mutate non-workspace relation: ${mutation.relation}` 
            };
        }
    }
    
    return { valid: true };
}
```

### 3.4 Higher-Level Workspace Ops

For common operations, provide compiled ops that generate safe Cozo scripts:

```typescript
interface WorkspaceOp {
    op: 'create_node' | 'update_node' | 'link' | 'unlink' | 
        'snapshot_view' | 'store_query' | 'store_result' | 'spawn_task';
    payload: Record<string, unknown>;
}

function compileOp(workspaceId: string, op: WorkspaceOp): string {
    switch (op.op) {
        case 'create_node':
            return `
                ?[workspace_id, node_id, kind, json, created_at, updated_at] <- [[
                    "${workspaceId}",
                    "${op.payload.node_id}",
                    "${op.payload.kind}",
                    ${JSON.stringify(op.payload.json)},
                    ${Date.now()},
                    ${Date.now()}
                ]]
                :put ws_node {workspace_id, node_id}
            `;
        
        case 'link':
            return `
                ?[workspace_id, from_id, to_id, rel, meta, created_at] <- [[
                    "${workspaceId}",
                    "${op.payload.from_id}",
                    "${op.payload.to_id}",
                    "${op.payload.rel}",
                    ${JSON.stringify(op.payload.meta || {})},
                    ${Date.now()}
                ]]
                :put ws_edge {workspace_id, from_id, to_id, rel}
            `;
        
        // ... other ops
    }
}
```

## 4. Retrieval Building Blocks

### 4.1 Three Retrieval Modalities

```
┌─────────────────────────────────────────────────────────────────┐
│                    Retrieval Modalities                          │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   Text (FTS)    │   Vector (HNSW) │   Graph (Expand)            │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ • BM25 scoring  │ • Cosine sim    │ • Edge traversal            │
│ • Boolean ops   │ • k-NN search   │ • Recursive expansion       │
│ • Phrase match  │ • ef tuning     │ • Path finding              │
│ • Prefix search │ • Dimension     │ • Community detection       │
│                 │   filtering     │                             │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

### 4.2 FTS for Notes/Blocks

**Schema** (Cozo v0.7+):
```cozo
# Create FTS index on blocks
::fts create blocks_fts {
    extractor: text,
    tokenizer: default,
    filter: default
}

# Query FTS
?[block_id, text, score] :=
    ~blocks:blocks_fts {block_id, text |
        query: $query,
        min_score: 0.3,
        k: 20
    }
```

**Fallback Regex Scan** (for exploration without index):
```cozo
?[block_id, text] :=
    *blocks{block_id, text},
    text ~ $pattern  # regex match
```

### 4.3 Vector Recall (HNSW)

Already implemented in [`MemoryRecallService`](src/app/lib/cozo/memory/MemoryRecallService.ts:74):

```cozo
# Existing HNSW query
?[block_id, note_id, text, distance] :=
    ~blocks:blocks_hnsw {block_id, note_id, text |
        query_vec: $query_vector,
        k: $k,
        ef: $ef
    }
```

**Model-controllable parameters**:
- `k`: Number of neighbors (breadth vs precision)
- `ef`: Search effort (speed vs accuracy tradeoff)

### 4.4 Graph Expansion

**Recursive entity expansion**:
```cozo
# Expand entity neighborhood to depth N
expand[entity_id, depth] :=
    depth = 0,
    *entities{id: entity_id},
    entity_id in $seed_entities

expand[neighbor_id, depth] :=
    expand[entity_id, prev_depth],
    prev_depth < $max_depth,
    *entity_edge{source_id: entity_id, target_id: neighbor_id},
    depth = prev_depth + 1

expand[neighbor_id, depth] :=
    expand[entity_id, prev_depth],
    prev_depth < $max_depth,
    *entity_edge{target_id: entity_id, source_id: neighbor_id},
    depth = prev_depth + 1

?[entity_id, name, kind, min_depth] :=
    expand[entity_id, depth],
    *entities{id: entity_id, label: name, kind},
    min_depth = min(depth)
:order min_depth
:limit 50
```

**Path finding between entities**:
```cozo
# Find paths between two entities
path[from_id, to_id, path, cost] :=
    from_id = $source_id,
    to_id = $target_id,
    path = [from_id],
    cost = 0

path[from_id, to_id, path, cost] :=
    path[prev_from, to_id, prev_path, prev_cost],
    *entity_edge{source_id: prev_from, target_id: next_id},
    next_id not in prev_path,
    from_id = next_id,
    path = array_append(prev_path, next_id),
    cost = prev_cost + 1

?[path, cost] :=
    path[$source_id, $target_id, path, cost]
:order cost
:limit 5
```

## 5. RLM Episode Types

### 5.1 New Episode Action Types

Extend [`EpisodeActionType`](src/app/lib/cozo/schema/layer4-memory.ts:31) with RLM-specific actions:

```typescript
export type EpisodeActionType =
    | 'created_entity'
    | 'renamed_entity'
    // ... existing types ...
    | 'rlm_query_executed'      // Model ran a query
    | 'rlm_workspace_mutation'  // Model modified workspace
    | 'rlm_step'                // Reasoning step completed
    | 'rlm_claim_extracted'     // New claim from reasoning
    | 'rlm_contradiction_found' // Contradiction detected
    | 'rlm_plan_created'        // New reasoning plan
    | 'rlm_plan_completed';     // Plan finished
```

### 5.2 Episode Payload Schemas

```typescript
interface RLMQueryExecutedPayload {
    workspace_id: string;
    query_node_id: string;
    script: string;
    lat_ms: number;
    rows: number;
    truncated: boolean;
    error?: string;
}

interface RLMWorkspaceMutationPayload {
    workspace_id: string;
    ops: WorkspaceOp[];
    affected: string[];  // node_ids touched
}

interface RLMStepPayload {
    prompt_ref: string;      // ws_node id of prompt
    view_id: string;         // ws_view_cache id
    model_output_ref: string; // ws_node id of output
    reasoning: string;       // Model's reasoning trace
}
```

### 5.3 Episode Logging Integration

```typescript
// In RLM service
async function executeQuery(
    workspaceId: string,
    script: string,
    bindings: Record<string, unknown>
): Promise<QueryResult> {
    const start = Date.now();
    const queryNodeId = generateId();
    
    // Store query as workspace node
    await workspaceOps.createNode(workspaceId, queryNodeId, 'query', {
        script,
        bindings,
        intent: 'model-initiated',
    });
    
    try {
        const result = await cozoDb.run(script, bindings);
        const latMs = Date.now() - start;
        
        // Log episode
        recordAction(
            workspaceId,
            '',
            'rlm_query_executed',
            queryNodeId,
            'node',
            {
                workspace_id: workspaceId,
                query_node_id: queryNodeId,
                script,
                lat_ms: latMs,
                rows: result.rows?.length ?? 0,
                truncated: result.truncated ?? false,
            },
            ''
        );
        
        return result;
    } catch (error) {
        // Log failed query too
        recordAction(
            workspaceId,
            '',
            'rlm_query_executed',
            queryNodeId,
            'node',
            {
                workspace_id: workspaceId,
                query_node_id: queryNodeId,
                script,
                lat_ms: Date.now() - start,
                rows: 0,
                truncated: false,
                error: String(error),
            },
            ''
        );
        throw error;
    }
}
```

## 6. RLM Loop Architecture

### 6.1 Minimal Recursive Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                     RLM Reasoning Loop                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   1. Observe Context   │
                    │   (RO queries)         │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   2. Formulate Plan    │
                    │   (Create plan node)   │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   3. Execute Step      │
                    │   (Query + Mutate WS)  │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   4. Evaluate Result   │
                    │   (Check termination)  │
                    └───────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
            ┌─────────────┐         ┌─────────────┐
            │   Recurse   │         │   Complete  │
            │   (New task)│         │   (Output)  │
            └─────────────┘         └─────────────┘
```

### 6.2 TypeScript Implementation

```typescript
interface RLMContext {
    workspaceId: string;
    threadId: string;
    narrativeId: string;
    maxDepth: number;
    currentDepth: number;
}

interface RLMStep {
    type: 'observe' | 'plan' | 'execute' | 'evaluate';
    nodeId: string;
    result?: unknown;
}

async function rlmLoop(ctx: RLMContext): Promise<string> {
    // 1. Observe: Gather context via RO queries
    const contextNode = await observe(ctx);
    
    // 2. Plan: Create reasoning plan
    const planNode = await plan(ctx, contextNode);
    
    // 3. Execute: Run queries, mutate workspace
    const resultNode = await execute(ctx, planNode);
    
    // 4. Evaluate: Check if complete or need recursion
    const evaluation = await evaluate(ctx, resultNode);
    
    if (evaluation.complete || ctx.currentDepth >= ctx.maxDepth) {
        // Return final output
        return evaluation.output;
    }
    
    // Recurse with new task
    const childCtx: RLMContext = {
        ...ctx,
        currentDepth: ctx.currentDepth + 1,
    };
    
    // Spawn child task node
    const taskNode = await workspaceOps.createNode(
        ctx.workspaceId,
        generateId(),
        'task',
        { parent_plan: planNode.nodeId, depth: ctx.currentDepth + 1 }
    );
    
    return rlmLoop(childCtx);
}
```

### 6.3 CozoDB Recursive Query for RLM

The key insight: **use Datalog's fixed-point for reasoning**:

```cozo
# Recursive reasoning path
reasoning[node_id, depth, confidence] :=
    *ws_node{workspace_id: $workspace_id, node_id, kind: "claim"},
    depth = 0,
    confidence = 1.0

reasoning[node_id, depth, confidence] :=
    reasoning[parent_id, parent_depth, parent_conf],
    *ws_edge{workspace_id: $workspace_id, from_id: parent_id, to_id: node_id, rel: "supports"},
    *ws_node{workspace_id: $workspace_id, node_id, kind: "claim"},
    depth = parent_depth + 1,
    confidence = parent_conf * 0.9  # Decay factor

# Find strongest reasoning chains
?[node_id, kind, json, depth, confidence] :=
    reasoning[node_id, depth, confidence],
    *ws_node{workspace_id: $workspace_id, node_id, kind, json}
:order -confidence
:limit 10
```

## 7. Implementation Phases

### Phase 1: Schema Migration
- [ ] Add `ws_*` relations to CozoDB schema
- [ ] Create FTS index on blocks (or notes)
- [ ] Add RLM episode types to layer4-memory

### Phase 2: Query Runner
- [ ] Implement `RunRO` with validation
- [ ] Implement `RunWS` with validation
- [ ] Add hard caps (time, rows, bytes)
- [ ] Create query classifier

### Phase 3: Workspace Ops
- [ ] Implement 8-10 canonical ops
- [ ] Create `WorkspaceOps` service
- [ ] Add op → Cozo compiler

### Phase 4: FTS Integration
- [ ] Replace `NoteRepo.search()` with FTS query
- [ ] Add fallback regex scan
- [ ] Expose FTS to model via RO lane

### Phase 5: RLM Loop
- [ ] Implement `observe` step
- [ ] Implement `plan` step
- [ ] Implement `execute` step
- [ ] Implement `evaluate` step
- [ ] Add recursion with depth limits

### Phase 6: Orchestrator Integration
- [ ] Replace stub `OrchestratorService.orchestrate()`
- [ ] Wire RLM loop to chat context gathering
- [ ] Add workspace lifecycle management

## 8. File Structure

```
src/app/lib/rlm/
├── index.ts                    # Public exports
├── schema/
│   └── workspace-schema.ts     # ws_* DDL definitions
├── services/
│   ├── query-runner.service.ts # RunRO, RunWS execution
│   ├── workspace-ops.service.ts # High-level ops
│   ├── rlm-loop.service.ts     # Main reasoning loop
│   └── retrieval.service.ts    # FTS, vector, graph
├── validators/
│   ├── ro-validator.ts         # RO query validation
│   └── ws-validator.ts         # WS mutation validation
└── types/
    ├── workspace.ts            # Workspace types
    └── episodes.ts             # RLM episode types
```

## 9. Security Considerations

### 9.1 Query Injection Prevention

All model-authored queries must pass through validators:
- Parse CozoScript AST (or regex-based validation)
- Block dangerous directives
- Enforce workspace isolation

### 9.2 Resource Limits

| Resource | Limit | Enforcement |
|----------|-------|-------------|
| Query runtime | 5s | CozoDB timeout |
| Result rows | 1000 | `:limit` requirement |
| Output size | 1MB | Post-query check |
| Recursion depth | 10 | Loop counter |
| Workspace size | 10K nodes | Pre-mutation check |

### 9.3 Audit Trail

Every query and mutation is logged to `episode_log`:
- Replayable for debugging
- Analyzable for optimization
- Auditable for security

## 10. Testing Strategy

### 10.1 Unit Tests

- Validator tests (valid/invalid queries)
- Op compiler tests (output Cozo scripts)
- Schema creation tests

### 10.2 Integration Tests

- RunRO → CozoDB execution
- RunWS → workspace mutation
- RLM loop → end-to-end reasoning

### 10.3 Property Tests

- All generated Cozo scripts are valid
- All mutations stay within ws_* namespace
- Recursion terminates within depth limit

---

## Appendix A: CozoScript Examples

### A.1 Entity Neighborhood Expansion

```cozo
# Get 2-hop neighborhood of entities
neighbor[entity_id, hop] :=
    entity_id in $seed_entities,
    hop = 0

neighbor[neighbor_id, hop] :=
    neighbor[entity_id, prev_hop],
    prev_hop < 2,
    *entity_edge{source_id: entity_id, target_id: neighbor_id},
    hop = prev_hop + 1

neighbor[neighbor_id, hop] :=
    neighbor[entity_id, prev_hop],
    prev_hop < 2,
    *entity_edge{target_id: entity_id, source_id: neighbor_id},
    hop = prev_hop + 1

?[entity_id, label, kind, hop] :=
    neighbor[entity_id, hop],
    *entities{id: entity_id, label, kind}
:order hop
```

### A.2 Claim Contradiction Detection

```cozo
# Find contradictory claims in workspace
?[claim_a, claim_b, confidence] :=
    *ws_node{workspace_id: $workspace_id, node_id: claim_a, kind: "claim", json: json_a},
    *ws_node{workspace_id: $workspace_id, node_id: claim_b, kind: "claim", json: json_b},
    claim_a != claim_b,
    # Check for negation patterns in json
    json_a.subject == json_b.subject,
    json_a.predicate == json_b.predicate,
    json_a.object != json_b.object,
    confidence = min(json_a.confidence, json_b.confidence)
```

### A.3 Reasoning Chain Reconstruction

```cozo
# Reconstruct full reasoning chain from result to sources
chain[node_id, path] :=
    *ws_node{workspace_id: $workspace_id, node_id, kind: "result"},
    path = [node_id]

chain[node_id, path] :=
    chain[child_id, child_path],
    *ws_edge{workspace_id: $workspace_id, from_id: node_id, to_id: child_id, rel: "produced"},
    path = array_concat([node_id], child_path)

?[path] :=
    chain[_, path]
```

---

## Appendix B: Migration from Old RLM

| Old (Go) | New (TypeScript/CozoDB) |
|----------|-------------------------|
| `GoKitt/pkg/rlm/` | `src/app/lib/rlm/` |
| Go structs for memory | CozoDB `ws_node` relations |
| Imperative planning | Declarative Datalog rules |
| Manual recursion | Fixed-point queries |
| SQLite tables | CozoDB relations |

**Key difference**: No more Go WASM for RLM logic. Everything runs in TypeScript with CozoDB WASM for queries.
