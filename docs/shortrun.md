# Full-Novel CLI Smoke Test Plan

Test name: `novel_full_manifold_smoke_v1`

Purpose:

```text
raw novel text
  -> chunking
  -> embeddings
  -> normalized vectors
  -> manifold snapshot
  -> icosahedral projection
  -> charts
  -> seams
  -> cone fields
  -> cone traces
  -> report
```

This smoke test is not intended to prove retrieval quality yet. It proves the full manifold pipeline survives a full novel with deterministic geometry, stable projection, sane cone traces, bounded memory, and zero silent drift.

The test passes only if the system is complete, deterministic, bounded, queryable, and traceable.

## Core Decision

```text
Icosahedral grid = structural manifold topology
Hopf projection = placement inside that topology
Cones = bounded traversal across topology
Charts = local readable patches
Stitches = typed transitions across chart seams
```

Use the icosphere as deterministic manifold infrastructure, not decoration.

## CLI Shape

Use one command that runs the full stack.

```bash
cargo run -p manifold-cli -- smoke novel \
  --input ./fixtures/novels/test_novel.txt \
  --out ./target/smoke/novel_full \
  --geometry hopf_ico_r5_v1 \
  --seed 1337 \
  --chunk-tokens 768 \
  --chunk-overlap 96 \
  --embed-batch 64 \
  --normalize true \
  --resolution 5 \
  --max-ring 4 \
  --top-k 24 \
  --repeat 2 \
  --cold-cache true \
  --warm-cache true \
  --trace true \
  --fail-fast false
```

Expected output:

```text
target/smoke/novel_full/
  manifest.json
  phase_timings.json
  memory.json
  chunk_report.json
  embedding_report.json
  projection_report.json
  topology_report.json
  chart_report.json
  seam_report.json
  cone_trace_report.json
  query_results.jsonl
  determinism_diff.json
  smoke_summary.md
```

## Locked Test Parameters

```toml
[test]
name = "novel_full_manifold_smoke_v1"
seed = 1337
repeat = 2
fail_fast = false

[input]
kind = "novel_text"
encoding = "utf-8"
min_chars = 250_000
max_chars = 5_000_000

[chunking]
target_tokens = 768
overlap_tokens = 96
min_chunk_tokens = 120
respect_paragraphs = true
respect_sentence_boundaries = true
emit_chunk_hashes = true

[embedding]
batch_size = 64
normalize = true
expected_l2_norm_min = 0.999
expected_l2_norm_max = 1.001
store_vector_hashes = true

[geometry]
geometry_version = "hopf_ico_r5_v1"
resolution = 5
secondary_cell_boundary_threshold = 0.08
deterministic_cell_ids = true

[charts]
chart_resolution = 3
one_chart_per_occupied_cell = true
merge_charts = false

[cones]
max_ring = 4
top_k = 24
aperture_profiles = ["needle", "narrow", "medium", "wide"]
trace_rejections = true
```

For the first deep smoke, keep chart merging off. Chart merging is second-order behavior; first prove the hard topology.

## Phase Gates

The CLI must log these phases separately:

```text
load_input
chunk_novel
embed_chunks
normalize_vectors
build_snapshot
build_ico_topology
project_vectors
assign_cells
build_charts
build_seams
build_cone_fields
run_query_pack
run_determinism_check
write_reports
```

Each phase needs:

```text
elapsed_ms
peak_rss_mib
allocated_bytes if available
input_count
output_count
error_count
warning_count
```

Hard gate:

```text
Every phase must complete.
Every phase must emit counts.
Every phase must be represented in phase_timings.json.
```

Missing phase timing is a failure.

## Chunking Assertions

For a full novel, chunking must satisfy:

```text
chunk_count > 0
all chunks have stable chunk_id
all chunks have content_hash
no empty chunks
no duplicate chunk IDs
no invalid UTF-8
chunk order is stable
```

Recommended gates:

```text
min average chunk tokens: 300
max average chunk tokens: 950
max overlap drift: 20 tokens
```

Coverage gates:

```text
first_chunk starts near beginning of novel
last_chunk reaches end of novel
total_covered_chars / input_chars >= 0.98
```

## Embedding Assertions

For every embedded chunk:

```text
vector exists
vector dimension matches model dimension
vector contains finite values
vector contains no NaN
vector contains no Inf
vector norm is within [0.999, 1.001]
vector hash is stable across repeat runs
```

Hard fail:

```text
missing vectors
dimension mismatch
NaN / Inf
normalization failure
```

Warnings:

```text
near-duplicate chunk vectors above threshold
extreme vector collapse
too many identical hashes
```

Collapse check:

```text
sample 512 vectors
compute pairwise dot sample
fail if more than 15% are above 0.9999
```

This catches broken embedding fallback where every vector collapses to the same value.

## Icosahedral Projection Assertions

Projection must prove:

```text
same vector -> same primary cell
same vector -> same secondary cells
same geometry version -> same cell IDs
all occupied cells exist in topology
all secondary cells neighbor or near-neighbor primary cell
```

Projection report should include:

```text
occupied_cell_count
empty_cell_count
max_cell_occupancy
mean_cell_occupancy
median_cell_occupancy
p95_cell_occupancy
boundary_anchor_count
secondary_assignment_count
```

Hard gates:

```text
occupied_cell_count > 0
max_cell_occupancy < 35% of all anchors
orphan_occupied_cells = 0
invalid_cell_assignments = 0
```

## Topology Assertions

For the generated icosphere:

```text
neighbor graph is symmetric
every cell has neighbors
parent cells exist
child cells point back to parent
ring expansion is deterministic
no duplicate neighbors
no self-neighbor edges
```

Cone-critical checks:

```text
ring_0 contains only start cell
ring_1 contains direct neighbors
ring_2 includes ring_1 plus next boundary
ring_n is monotonic
```

Property gate:

```text
ring(n) must be subset of ring(n+1)
```

If that fails, cone traversal is invalid.

## Chart And Seam Assertions

With chart merging disabled:

```text
chart_count == occupied_chart_cell_count
every chart has at least one occupied cell
every occupied cell maps to one chart
every chart has geometry_version
```

Seam checks:

```text
neighboring occupied cells produce seam candidates
seam endpoints exist
seam cost is finite
compatibility score is finite
obstruction count is >= 0
```

Hard gates:

```text
invalid_seams = 0
NaN seam costs = 0
charts_without_cells = 0
occupied_cells_without_chart = 0
```

## Cone Trace Smoke Queries

The query pack should be generated automatically from the novel snapshot. Do not rely only on hand-written queries yet.

Generate these query classes:

```text
1. Top anchor lookup
2. Long-tail anchor lookup
3. Dense chart expansion
4. Sparse chart expansion
5. Boundary-cell traversal
6. High-seam traversal
7. Wide synthesis traversal
8. Narrow precision traversal
9. Evidence/support traversal if evidence exists
10. Negative/random query
```

For each query, run:

```text
needle cone
narrow cone
medium cone
wide cone
```

Assertions:

```text
needle results are inside a narrow candidate region
narrow accepted cells <= medium accepted cells
medium accepted cells <= wide accepted cells
increasing max_ring does not reduce accepted cell count
top_k results are deterministic
trace path references valid cells/charts
all returned scores are finite
```

Do not require exact subset of final ranked hits across aperture profiles because scoring can reorder and top-k truncation can hide candidates. Require monotonicity at the accepted cell/candidate-pool level.

## Determinism Check

Run the whole pipeline twice with the same input and seed.

Compare:

```text
chunk IDs
chunk hashes
vector hashes
primary cell assignments
secondary cell assignments
chart IDs
seam IDs
cone accepted cell sets
cone top-k result IDs
cone trace hashes
```

Hard gates:

```text
determinism_diff.changed_chunk_ids = 0
determinism_diff.changed_projection_assignments = 0
determinism_diff.changed_chart_ids = 0
determinism_diff.changed_cone_trace_hashes = 0
```

Allow tiny floating-point score differences:

```text
max_score_delta <= 1e-5
```

Tie-breakers must be deterministic:

```text
score desc
then traversal_cost asc
then cell_id asc
then anchor_id asc
```

## Performance Gates

Absolute gates:

```text
max_total_ms = 120_000
max_peak_rss_mib = 4096
max_query_pack_ms = 15_000
```

Regression gates after first accepted baseline:

```text
fail if total time > baseline * 1.30
fail if peak RSS > baseline * 1.25
fail if query pack time > baseline * 1.35
```

Regression gates matter more than generic absolute gates.

## Output Summary

Expected final CLI summary:

```text
SMOKE: novel_full_manifold_smoke_v1

input_chars:              1,284,992
chunks:                   1,842
vectors:                  1,842
geometry_version:         hopf_ico_r5_v1
occupied_cells:           317
charts:                   214
seams:                    691
cone_queries:             40
cone_traces:              160

determinism:              PASS
topology:                 PASS
projection:               PASS
charts/seams:             PASS
cones:                    PASS

total_ms:                 18,420
peak_rss_mib:             812

result:                   PASS
```

Failure summary:

```text
result: FAIL
failed_gate: projection.invalid_cell_assignments
details: projection_report.json
```

No vague failures. Every failure must name the failed gate and report file.

## Exit Codes

```text
0   pass
10  input/chunking failure
20  embedding failure
30  topology failure
40  projection failure
50  chart/seam failure
60  cone traversal failure
70  determinism failure
80  performance gate failure
90  internal error
```

## Minimum Deep Smoke Pass

The test passes only when all are true:

```text
1. Full novel embeds completely.
2. Every chunk has a normalized vector.
3. Ico topology validates.
4. Every vector projects to valid deterministic cells.
5. Charts and seams build without invalid records.
6. Cone query pack runs across multiple aperture profiles.
7. Cone traces are valid and deterministic.
8. Repeat run produces matching structural hashes.
9. Peak memory and runtime stay inside gates.
10. Reports are written.
```

## Baseline Command

Add this after the first pass:

```bash
cargo run -p manifold-cli -- smoke baseline accept \
  --run-dir ./target/smoke/novel_full \
  --name novel_full_manifold_smoke_v1
```

Then later:

```bash
cargo run -p manifold-cli -- smoke novel \
  --input ./fixtures/novels/test_novel.txt \
  --baseline novel_full_manifold_smoke_v1 \
  --fail-on-regression true
```

## Final Gate

```text
same novel + same snapshot + same geometry_version + same seed
=
same projection, same charts, same cone traces
```

Once that is true, retrieval quality testing can begin. This smoke test proves the machine has bones.
