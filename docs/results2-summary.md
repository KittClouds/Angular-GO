# RAPTOR Evaluation Analysis (Run 2)

## Key Findings
- **Identical Top-3 Results:** `collapsed-tree` returned the exact same Top-3 chunks as `leaf-only` for all queried cases.
  - **Precision:** 100% (relative to leaf-only baseline).
  - **Recall:** 100% (relative coverage of leaf-only top-3).
- **Latency Issue:** `collapsed-tree` was significantly slower (easiest seen in P95: 63ms vs 39ms).
  - Extreme cases like "white rabbit plushie" took ~82ms vs 16ms.
  - Cause: Post-filtering of global search results instead of pre-filtering the index scan.

## Optimization Implemented
- **Pre-filtering:** Modified `HybridIndex.Search` to call `SearchKNNFiltered` with an `allowedUIDs` bitmap.
- **Mechanism:** The HNSW search (and lexical gate) now filters candidates *before* scoring, using the `allowedLeaves` bitmap from the Router Pass.
- **Expected Outcome:** `collapsed-tree` latency should now be comparable to or faster than `leaf-only` (since it searches a smaller subset of the index).

## Recommendations
- **Verify Latency:** Re-run specific slow queries (e.g., "white rabbit plushie") to confirm speedup.
- **Expand Evaluation:** If Top-3 are identical, we might want to increase `k` to see where `collapsed-tree` diverges or adds value (e.g., bringing in relevant chunks that are *not* in the global top-10 but exist in relevant docs).
