# Architecture Defense: The Holy Trinity (Go/Rust/JS) & Data Topology

## 1. Data Topology (The Brain)

### CozoDB (Datalog) vs Dexie (IndexedDB)
We employ a **bifurcated persistence strategy** to balance graph complexity with document retrieval speed.

*   **Dexie.js (The Document Store)**:
    *   **Role**: Source of Truth for raw entity state, user preferences, and "flat" lists.
    *   **Justification**: IndexedDB is faster for simple key-value lookups (`O(1)`) than a Datalog query. UI components (Angular Signals) bind directly to Dexie observables for reactive updates.
    *   **Consistency**: Serves as the "Log" of the system.

*   **CozoDB (The Graph)**:
    *   **Role**: Relational reasoning, recursive queries, and semantic linking.
    *   **Justification**: Entities are not islands. Resolving "The King" requires traversing `NarrativeContext -> Location -> Occupants -> Roles`. Cozo's fixed-point logic (`?[x, y] :- ...`) handles this recursion natively, which is impossible in IndexedDB without massive client-side joining.
    *   **Optimization**: We use **Stored Rules** to pre-compile traversal paths.
    
    ```datalog
    # Example: Transitive containment for "Where is the sword?"
    ?[item, container] :- contains(container, item)
    ?[item, ancestor] :- contains(mid, item), ?[mid, ancestor]
    ```

### Sync Strategy
*   **Eventual Consistency**: Dexie writes trigger a `CozoSyncService`. The UI updates immediately (Optimistic UI), while the graph updates in the background.
*   **Corruption Recovery**: Since Dexie is the Source of Truth, the Graph can always be rebuilt from the Document Store.

## 2. The Polyglot Runtime (Wasm)

### Go (The Logic & Orchestrator)
*   **Role**: System Bus, Parsing, Networking, and Narrative State.
*   **Justification**: Go's garbage collector (TinyGo) is manageable for "Business Logic" where allocation frequency is moderate. Its concurrency model (Goroutines) maps well to supervising sequential tasks (Scanning Pipeline).
*   **Implementation**: `Conductor`, `Resolver`, `Scanner`.
*   **Why not Rust?**: Parsing text and managing complex struct graphs (Entities, Narratives) is ergonomic in Go. Rust's borrow checker adds friction for high-level logic without significant perf gain over optimized Go.

### Rust (The Muscle)
*   **Role**: Heavy Compute, Vector Math, Graph Algorithms.
*   **Justification**: `simd` support and manual memory management are non-negotiable for:
    1.  **Vector Search (ResoRank)**: Cosine similarity over 10k+ vectors.
    2.  **Pathfinding**: A* on nav-meshes.
    3.  **Procedural Generation**: Noise fields and cellular automata.
*   **Panic Safety**: Rust functions are wrapped in `catch_unwind` at the Wasm boundary to prevent crashing the entire runtime.

### The Bridge Tax (Serialization)
*   **Strategy**: Minimize cross-boundary calls.
    *   **Bad**: JS calls Go for *every token*. (Serialization overhead > Compute time).
    *   **Good**: JS passes a full paragraph to Go. Go processes it entirely (Tokenize -> Parse -> Resolve) and returns a single JSON result.
*   **Shared Memory**: Future optimization using `SharedArrayBuffer` for the Vector Store to avoid copying float arrays between JS and Rust.

## 3. Concurrency & Async Physics

### The UI Thread (60fps Rule)
*   **JS Main Thread**: Purely for Rendering (Angular) and Event Handling.
*   **Web Workers**:
    *   **Worker A (Semantic)**: Runs `@xenova/transformers` for embedding generation.
    *   **Worker B (Simulation)**: Runs the Wasm runtime (Go/Rust).
*   **Angular Signals**: The bridge between Workers and UI. Workers post messages -> `Effect` updates Signal -> UI Repaints.

### Resolver Integration (The Scanner)
We chose a **Hybrid Search** approach for the `Resolver`:
1.  **Exact Match (Go)**: `O(1)` map lookup. Fast, handled in main loop.
2.  **Vector Fallback (Go/Rust)**: If Exact fails, use `ResoRank`.
    *   **Current State**: Go implementation of `CosineSimilarity` (for portability and simplicity in initial version).
    *   **Future**: Offload `Score` calculation to Rust if vector dimensions > 512 or document count > 1000.

## 4. Specific Optimizations (Scanner)
*   **Allocation Reduction**: Refactored `Chunker` and `Tagger` to use pre-allocated slices and `fastLower` to avoid string churn on the heap.
*   **Vector awareness**: `EntityMetadata` now carries `Embedding` payload, enabling the `Resolver` to perform semantic matching immediately upon registration.
