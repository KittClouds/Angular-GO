# Phoenix Pipeline Capability Inventory

This inventory makes the hidden Phoenix runtime capabilities visible before the UI presents them as runnable recipes. The current Search Panel used to surface a thin operational slice (NER, text graph, embeddings, manifold sidecars, retrieval), while the TypeScript and Rust/native layers already expose a richer multi-lane graph factory.

## Inventory rules

- **Wired** means the Search Panel can already run or read this capability directly.
- **Partial** means runtime evidence or model lanes exist, but the UI does not expose the whole pass as an explicit runnable recipe.
- **Sleeping** means backend types, sidecars, stores, or tests exist, but the Search Panel should show the capability as detected/not yet wired instead of pretending it is runnable.
- **Mutation policy** distinguishes read-only lanes, dirty-only rebuilds, force rebuilds, model warm-only work, and native-only sleeping lanes.

## Capability matrix

| # | Capability / graph type | Runtime source file(s) | UI coverage today | Inputs | Outputs | Cost | Mutation behavior | Existing test coverage | Wiring state |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Dynamic text surface | `rust/phoenix/crates/phoenix-types/src/deterministic.rs`, `rust/phoenix/crates/phoenix-chunker/src/lib.rs`, `src/app/services/atlas-scan-coordinator.service.ts` | Pipeline stage + rich scan route | Scope notes, plain text | tokens, sentences, clauses, phrases, surface units | Low | dirty-only | `atlas-command-status.model.spec.ts` | wired |
| 2 | Dynamic chunking / sentence chunker | `rust/phoenix/crates/phoenix-chunker/src/sentence.rs`, `src/app/components/search-panel/atlas-command-status.model.ts` | Chunk strip only | Surface units, sentence boundaries | lens chunks, chunk ids, leaf candidates | Low | dirty-only | `atlas-command-status.model.spec.ts` | wired |
| 3 | Dynamic NER | `rust-native/phoenix/crates/phoenix-dynamic-ner/src/lib.rs`, `src/app/services/ner.service.ts` | Recipe + model lane | Plain text, chunks | candidate entities, review suggestions | Medium | model warm / run active scan | `atlas-model-recipe.model.spec.ts`, `search-panel.component.spec.ts` | wired |
| 4 | Mention / co-occurrence graph | `rust-native/phoenix/crates/phoenix-machine/src/lib.rs`, `src/app/components/search-panel/search-panel.model.ts` | Graph target + co-occurrence lane | Surface chunks, NER candidates | mentions, resolver links, mention edges | Very low | dirty-only | `search-panel.model.spec.ts` | wired |
| 5 | Evidence graph | `src/app/services/graph-audit.service.ts`, `src/app/services/phoenix-ui-api.service.ts` | Pipeline stage + graph target | Mentions, chunks | evidence edges, graph patch ops | Low | dirty-only | `atlas-command-status.model.spec.ts` | wired |
| 6 | Surface graph | `src/app/services/phoenix-ui-api.service.ts`, `rust-native/phoenix/crates/phoenix-store-overgraph/src/graph_topology.rs` | Graph target only | Surface units, mentions, evidence | document/chunk/mention topology | Low-Med | dirty-only | `search-panel.model.spec.ts` | wired |
| 7 | Asserted kernel graph | `src/app/services/phoenix-machine-control.service.ts`, `rust-native/phoenix/crates/phoenix-store-overgraph/src/graph_topology.rs` | Pipeline graph commit + graph target | Surface graph, evidence graph | committed vertices, kernel edges | Medium | dirty-only / force rebuild | `atlas-command-status.model.spec.ts` | wired |
| 8 | Relation graph | `rust-native/phoenix/crates/phoenix-store-native-core/src/scope_runtime.rs`, `rust-native/phoenix/crates/phoenix-rel-post/src/lib.rs` | Graph target + relation candidate counts | Kernel, mentions, sentence syntax | relation candidates, relation sidecar rows | Medium | native-only | `atlas-command-status.model.spec.ts` | partial |
| 9 | Temporal graph | `rust-native/phoenix/crates/phoenix-temporal-post/src/api.rs`, `rust-native/phoenix/crates/phoenix-temporal-post/src/normalize.rs` | Graph target label only | Event substrate, temporal cues, archives | temporal sidecar, timeline memory cards | Med-High | native-only | registry coverage test | sleeping |
| 10 | Event identity | `rust/phoenix/crates/phoenix-types/src/deterministic.rs`, `rust-native/phoenix/crates/phoenix-store-native-core/src/scope_runtime.rs` | Graph target label only | events, mentions, semantic order | canonical event ids, membership rows | Med-High | native-only | registry coverage test | sleeping |
| 11 | Memory / state graph | `rust/phoenix/crates/phoenix-types/src/deterministic.rs`, `rust-native/phoenix/crates/phoenix-state-schema-post/src/lib.rs` | Graph target label only | states, values, concepts, continuity | memory sidecar, state schema sidecar | High | native-only | registry coverage test | sleeping |
| 12 | Causal graph | `rust/phoenix/crates/phoenix-types/src/deterministic.rs`, `rust-native/phoenix/crates/phoenix-store-native-core/src/scope_runtime.rs` | Graph target label only | semantic nodes, temporal graph, state transitions | causal candidates, causal links | High | native-only | registry coverage test | sleeping |
| 13 | Semantic embedding lane | `src/app/lib/embeddings/EmbeddingEngine.ts`, `src/app/services/phoenix-machine-control.service.ts` | Model lane + warm action | committed graph, surface text | leaf/entity/lens vectors | High | model warm / indexing | `atlas-model-recipe.model.spec.ts`, `search-panel.component.spec.ts` | wired |
| 14 | Semantic Atlas sidecar | `src/app/services/phoenix-ui-api.service.ts`, `src/app/services/atlas-scan-coordinator.service.ts` | Recipe + sidecar counts | kernel, embedding model | semantic sidecar rows, vectors | High | dirty-only | `atlas-command-status.model.spec.ts` | wired |
| 15 | Semantic candidate graph | `src/app/services/phoenix-ui-api.service.ts` | Counts only when rich scan returns candidates | semantic vectors, relation candidates | candidate semantic edges | Very high | native-only | `atlas-command-status.model.spec.ts` | partial |
| 16 | NLI adjudication lane | `src/app/lib/services/nli-worker.service.ts`, `src/app/lib/nli/nli-utils.spec.ts` | Warm lane only | semantic candidates, text pairs | entailment / contradiction scores | High | model warm | `atlas-model-recipe.model.spec.ts` | partial |
| 17 | Hybrid manifold | `rust-native/phoenix/crates/phoenix-hyperbolic/src/hybrid_space.rs`, `src/app/services/manifold-atlas.types.ts` | Sidecar status | semantic vectors | hybrid topology, ANN hints | High | read-only | `atlas-command-status.model.spec.ts` | wired |
| 18 | Hopf projection | `rust-native/phoenix/crates/phoenix-hyperbolic/src/sphere.rs`, `src/app/services/manifold-atlas.types.ts` | Sidecar status | semantic vectors | Hopf fibers, phase projection | High | read-only | `atlas-command-status.model.spec.ts` | wired |
| 19 | Lorentz forest | `src/app/services/manifold-atlas.types.ts`, `rust-native/phoenix/crates/phoenix-hyperbolic/src/lib.rs` | Sidecar status + types | semantic vectors, graph target kinds | Lorentz trees, memberships, hierarchy hits | Very high | read-only | `atlas-command-status.model.spec.ts` | partial |
| 20 | Retrieval / Triverse graph walk | `src/app/services/retrieval-workbench-state.service.ts`, `src/app/services/phoenix-ui-api.service.ts` | Search sources | query text, selected lanes | ranked results, source labels | Low-Med | read-only | `search-panel.component.spec.ts` | wired |
| 21 | Galaxy visualization / render graph | `src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-atlas-preview.component.ts` | Graph button + read-only recipe | kernel snapshot, graph focus | galaxy scene, render graph | Render | read-only | `search-panel.component.spec.ts` | wired |

## Runtime depth confirmed by source

- `AtlasRichScanResult` already returns `stageSummaries`, `lensChunkCounts`, `graphDeltaCounts`, `embeddingCounts`, `relationCandidateCount`, `candidateSuggestions`, and diagnostics.
- `PhoenixMachineControllerService` tracks native stage snapshots for `surface`, `evidenceGraph`, `embeddings`, and `overgraph`.
- `phoenix-types/src/deterministic.rs` defines events, claims, states, values, concepts, semantic node refs, causal candidates, causal links, evidence kinds, provenance, causal kinds, and bi-temporal windows.
- `phoenix-store-native-core/src/scope_runtime.rs` exposes sidecar masks for relation, memory, event identity, state schema, causal, temporal, graph, semantic graph, and relation seed sidecars.
- `manifold-atlas.types.ts` exposes Lorentz tree kinds such as `identity`, `relationship`, `location`, `event`, `temporal`, `causal`, `evidence`, `provenance`, `contradiction`, `abstraction`, `species`, `powerSystem`, and `documentStructure`.

## UI consequence

The Search Panel should not collapse Phoenix into only NER, co-occurrence, embeddings, NLI, and manifold projection. The UI now has a typed capability registry that can show wired lanes, partial lanes, and sleeping lanes distinctly, while preserving current recipe behavior.
