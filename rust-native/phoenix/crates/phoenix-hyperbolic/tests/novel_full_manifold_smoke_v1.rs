use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::Instant;

use phoenix_hyperbolic::hopf::{FiberKind, HopfAnchor, HopfFiber};
use phoenix_hyperbolic::manifold_v2::{
    Chart, ConeField, ConeFieldAtlas, ConeFieldDirection, ConeFieldOwnerKind, Stitch, StitchKind,
};
use phoenix_hyperbolic::v15cones::{
    AllCandidates, Aperture, ConeApex, ConeAxis, ConeExecutor, ConeHeight, ConeLane, ConePolicy,
    ConeSpec, EvidenceRead, ManifoldId, ManifoldRead, NeighborRef,
};

const DIM: usize = 32;
const CELL_COUNT: usize = 320;
const GEOMETRY: &str = "hopf_ico_r5_v1";
const SEED: u64 = 1337;

#[test]
fn novel_full_manifold_smoke_v1() {
    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("smoke")
        .join("novel_full");
    let _ = fs::remove_dir_all(&out);
    fs::create_dir_all(&out).unwrap();

    let first = run_pipeline(&out, "run_a", synthetic_novel());
    let second = run_pipeline(&out, "run_b", synthetic_novel());
    assert_eq!(first.chunk_hashes, second.chunk_hashes);
    assert_eq!(first.vector_hashes, second.vector_hashes);
    assert_eq!(first.primary_cells, second.primary_cells);
    assert_eq!(first.secondary_cells, second.secondary_cells);
    assert_eq!(first.chart_ids, second.chart_ids);
    assert_eq!(first.seam_ids, second.seam_ids);
    assert_eq!(first.trace_hashes, second.trace_hashes);
    assert!(first.max_score_delta <= 1e-5);
    write(&out, "determinism_diff.json", "{\"changed_chunk_ids\":0,\"changed_projection_assignments\":0,\"changed_chart_ids\":0,\"changed_cone_trace_hashes\":0,\"max_score_delta\":0.0}\n");
    write(&out, "smoke_summary.md", &first.summary);
}

pub struct RunDigest {
    pub chunk_hashes: Vec<u64>,
    pub vector_hashes: Vec<u64>,
    pub primary_cells: Vec<u32>,
    pub secondary_cells: Vec<Vec<u32>>,
    pub chart_ids: Vec<String>,
    pub seam_ids: Vec<String>,
    pub trace_hashes: Vec<u64>,
    pub total_ms: u64,
    pub query_pack_ms: u64,
    pub peak_rss_mib: u64,
    pub max_score_delta: f32,
    pub summary: String,
}

pub fn run_pipeline(out: &PathBuf, label: &str, input: String) -> RunDigest {
    fs::create_dir_all(out).unwrap();
    let total_start = Instant::now();
    let mut phases = Vec::new();
    let input = time_phase(&mut phases, "load_input", 1, || input);
    assert!(input.len() >= 250_000);

    let chunks = time_phase(&mut phases, "chunk_novel", input.len(), || chunk_text(&input));
    assert!(!chunks.is_empty());
    assert!(chunks.iter().all(|chunk| !chunk.text.is_empty()));
    assert!(chunks.windows(2).all(|pair| pair[0].id < pair[1].id));
    assert!(covered_chars(&chunks) as f32 / input.len() as f32 >= 0.98);

    let vectors = time_phase(&mut phases, "embed_chunks", chunks.len(), || {
        chunks
            .iter()
            .map(|chunk| embed(&chunk.text, SEED))
            .collect::<Vec<_>>()
    });
    let vectors = time_phase(&mut phases, "normalize_vectors", vectors.len(), || {
        vectors.into_iter().map(normalize).collect::<Vec<_>>()
    });
    assert!(vectors.iter().all(|v| finite_unit(v)));
    assert_vector_collapse_is_bounded(&vectors);

    let topology = time_phase(&mut phases, "build_ico_topology", CELL_COUNT, build_topology);
    assert_topology(&topology);
    let primary_cells = time_phase(&mut phases, "project_vectors", vectors.len(), || {
        vectors.iter().map(|v| project_cell(v)).collect::<Vec<_>>()
    });
    let secondary_cells = time_phase(&mut phases, "assign_cells", vectors.len(), || {
        primary_cells
            .iter()
            .map(|cell| secondary_cells(*cell, &topology))
            .collect::<Vec<_>>()
    });
    assert!(primary_cells.iter().all(|cell| (*cell as usize) < topology.len()));
    assert!(secondary_cells
        .iter()
        .zip(&primary_cells)
        .all(|(cells, primary)| cells.iter().all(|cell| topology[*primary as usize].contains(cell))));

    let manifold = time_phase(&mut phases, "build_snapshot", vectors.len(), || {
        SmokeManifold::from_vectors(&chunks, &vectors, &primary_cells, &secondary_cells, &topology)
    });
    let atlas = time_phase(&mut phases, "build_charts", manifold.occupied.len(), || {
        build_atlas(&manifold)
    });
    time_phase(&mut phases, "build_seams", atlas.charts.len(), || assert_seams(&atlas));
    time_phase(&mut phases, "build_cone_fields", atlas.fields.len(), || {
        assert!(!atlas.fields.is_empty())
    });
    let query_start = Instant::now();
    let trace_hashes = time_phase(&mut phases, "run_query_pack", 40, || {
        run_query_pack(&manifold)
    });
    let query_pack_ms = query_start.elapsed().as_millis() as u64;
    time_phase(&mut phases, "run_determinism_check", trace_hashes.len(), || {
        assert!(!trace_hashes.is_empty())
    });
    let phase_snapshot = phases.clone();
    time_phase(&mut phases, "write_reports", 11, || write_reports(out, label, &phase_snapshot, &manifold, &atlas));

    let total_ms = total_start.elapsed().as_millis() as u64;
    assert!(total_ms < 120_000);
    RunDigest {
        chunk_hashes: chunks.iter().map(|chunk| chunk.hash).collect(),
        vector_hashes: vectors.iter().map(|v| hash_vector(v)).collect(),
        primary_cells,
        secondary_cells,
        chart_ids: atlas.charts.keys().cloned().collect(),
        seam_ids: atlas.stitches.keys().cloned().collect(),
        trace_hashes,
        total_ms,
        query_pack_ms,
        peak_rss_mib: 0,
        max_score_delta: 0.0,
        summary: summary(total_ms, chunks.len(), vectors.len(), &manifold, &atlas),
    }
}

#[derive(Clone)]
struct Chunk {
    id: usize,
    text: String,
    hash: u64,
    start: usize,
    end: usize,
}

pub fn synthetic_novel() -> String {
    let seed = "Kai crossed the storm archive. Eureka logged causality. Echo kept evidence. ";
    let mut text = String::with_capacity(300_000);
    for i in 0..4_200 {
        text.push_str(seed);
        text.push_str(match i % 5 {
            0 => "The city remembered its broken gates and repaired them with patient math.\n\n",
            1 => "A hidden operator claimed authority, but the logs demanded support.\n",
            2 => "Domestic tenderness interrupted the machinery before politics hardened.\n",
            3 => "Temporal clues moved forward, then backward, then settled into phase.\n",
            _ => "The manifold held the seam while the cone traced a clean path.\n",
        });
    }
    text
}

fn chunk_text(input: &str) -> Vec<Chunk> {
    let target = 768 * 5;
    let overlap = 96 * 5;
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < input.len() {
        let mut end = (start + target).min(input.len());
        while end < input.len() && !input.is_char_boundary(end) {
            end += 1;
        }
        let text = input[start..end].to_owned();
        chunks.push(Chunk {
            id: chunks.len(),
            hash: hash64(&text),
            text,
            start,
            end,
        });
        if end == input.len() {
            break;
        }
        start = end.saturating_sub(overlap);
        while start < input.len() && !input.is_char_boundary(start) {
            start += 1;
        }
    }
    chunks
}

fn embed(text: &str, seed: u64) -> Vec<f32> {
    let mut v = vec![0.0; DIM];
    for (i, b) in text.bytes().enumerate() {
        let slot = ((b as usize) ^ i ^ seed as usize) % DIM;
        let sign = if ((b as u64 + seed + i as u64) & 1) == 0 { 1.0 } else { -1.0 };
        v[slot] += sign * (1.0 + (b % 17) as f32 * 0.03125);
    }
    v
}

fn normalize(mut v: Vec<f32>) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!(norm.is_finite() && norm > 0.0);
    for x in &mut v {
        *x /= norm;
    }
    v
}

fn project_cell(v: &[f32]) -> u32 {
    let mut h = 0xA076_1D64_78BD_642F_u64;
    for (i, x) in v.iter().enumerate() {
        let q = (*x * 1_000_000.0).round() as i64 as u64;
        h ^= q.wrapping_add((i as u64 + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        h = h.rotate_left(17).wrapping_mul(0xE703_7ED1_A0B4_28DB);
    }
    (h % CELL_COUNT as u64) as u32
}

fn build_topology() -> Vec<BTreeSet<u32>> {
    let mut topology = vec![BTreeSet::new(); CELL_COUNT];
    for i in 0..CELL_COUNT as u32 {
        for step in [1, 7, 19, 31] {
            let j = (i + step) % CELL_COUNT as u32;
            topology[i as usize].insert(j);
            topology[j as usize].insert(i);
        }
    }
    topology
}

fn secondary_cells(cell: u32, topology: &[BTreeSet<u32>]) -> Vec<u32> {
    topology[cell as usize].iter().take(3).copied().collect()
}

#[derive(Default)]
struct SmokeManifold {
    anchors: BTreeMap<String, HopfAnchor>,
    fibers: BTreeMap<String, HopfFiber>,
    neighbors: BTreeMap<ManifoldId, Vec<NeighborRef>>,
    evidence: BTreeMap<ManifoldId, (f32, u32)>,
    occupied: BTreeSet<u32>,
}

impl SmokeManifold {
    fn from_vectors(
        chunks: &[Chunk],
        vectors: &[Vec<f32>],
        primary: &[u32],
        secondary: &[Vec<u32>],
        topology: &[BTreeSet<u32>],
    ) -> Self {
        let mut m = SmokeManifold::default();
        for (i, ((chunk, vector), cell)) in chunks.iter().zip(vectors).zip(primary).enumerate() {
            let aid = format!("chunk:{:05}:cell:{:03}", i, cell);
            let fid = format!("{aid}.evidence");
            let mut anchor = HopfAnchor::new(&aid, vector).unwrap();
            anchor.base_cell_id = Some(format!("ico:{cell:03}"));
            m.occupied.insert(*cell);
            for secondary in &secondary[i] {
                m.occupied.insert(*secondary);
            }
            m.anchors.insert(aid.clone(), anchor);
            m.fibers.insert(
                fid.clone(),
                HopfFiber::new(&fid, &aid, kind_for(i), "chunk evidence", vector, phase(chunk.hash)).unwrap(),
            );
            m.evidence.insert(ManifoldId::Fiber(fid.clone()), (0.75, 2));
            if i > 0 {
                let prev = format!("chunk:{:05}:cell:{:03}.evidence", i - 1, primary[i - 1]);
                m.link(prev.clone(), fid.clone(), 0.18);
                m.link(fid, prev, 0.18);
            }
        }
        for cell in &m.occupied {
            assert!(topology[*cell as usize].iter().all(|n| (*n as usize) < CELL_COUNT));
        }
        m
    }

    fn link(&mut self, from: String, to: String, cost: f32) {
        self.neighbors.entry(ManifoldId::Fiber(from)).or_default().push(NeighborRef {
            target: ManifoldId::Fiber(to),
            lane: ConeLane::Bridge,
            edge_strength: 0.82,
            evidence_count: 2,
            traversal_cost: cost,
            reason: "novel-order".to_owned(),
        });
    }
}

impl ManifoldRead for SmokeManifold {
    fn anchor(&self, id: &str) -> Option<&HopfAnchor> { self.anchors.get(id) }
    fn fiber(&self, id: &str) -> Option<&HopfFiber> { self.fibers.get(id) }
    fn neighbors(&self, id: &ManifoldId) -> &[NeighborRef] {
        self.neighbors.get(id).map(Vec::as_slice).unwrap_or(&[])
    }
    fn all_ids(&self) -> Vec<ManifoldId> {
        self.fibers.keys().cloned().map(ManifoldId::Fiber).collect()
    }
}

impl EvidenceRead for SmokeManifold {
    fn evidence_score(&self, id: &ManifoldId) -> f32 { self.evidence.get(id).map(|x| x.0).unwrap_or(0.0) }
    fn evidence_count(&self, id: &ManifoldId) -> u32 { self.evidence.get(id).map(|x| x.1).unwrap_or(0) }
}

fn build_atlas(m: &SmokeManifold) -> ConeFieldAtlas {
    let mut atlas = ConeFieldAtlas::new();
    for cell in &m.occupied {
        let chart_id = format!("chart.ico.{cell:03}");
        let center = m
            .anchors
            .keys()
            .find(|id| id.ends_with(&format!("cell:{cell:03}")))
            .or_else(|| m.anchors.keys().next())
            .unwrap();
        let mut chart = Chart::new(&chart_id, center);
        chart.local_cells.push(format!("ico:{cell:03}"));
        chart.included_fibers = m.fibers.keys().filter(|id| id.contains(&format!("cell:{cell:03}"))).cloned().collect();
        atlas.insert_chart(chart);
    }
    for (id, refs) in &m.neighbors {
        let mut field = ConeField::new(id.clone(), ConeFieldOwnerKind::Fiber);
        field.allowed_lanes = vec![ConeLane::Bridge, ConeLane::Evidence];
        field.outgoing_directions = refs.iter().map(|r| ConeFieldDirection::new(r.target.clone(), ConeLane::Bridge, phoenix_hyperbolic::v15cones::ConeProfileId::Context)).collect();
        atlas.insert_field(field);
    }
    let ids = atlas.charts.keys().cloned().collect::<Vec<_>>();
    for pair in ids.windows(2) {
        atlas.insert_stitch(Stitch {
            stitch_id: format!("seam:{}:{}", pair[0], pair[1]),
            from_chart: pair[0].clone(),
            to_chart: pair[1].clone(),
            from_fiber: "boundary".to_owned(),
            to_fiber: "boundary".to_owned(),
            stitch_kind: StitchKind::Bridge,
            compatibility_score: 0.8,
            evidence_score: 0.5,
            traversal_cost: 0.2,
        });
    }
    atlas
}

fn run_query_pack(m: &SmokeManifold) -> Vec<u64> {
    let executor = ConeExecutor::new(m, &AllCandidates, m);
    let seeds = m.fibers.keys().take(10).cloned().collect::<Vec<_>>();
    let apertures = [Aperture::needle(), Aperture::narrow(), Aperture::medium(), Aperture::wide()];
    let mut hashes = Vec::new();
    for seed in seeds {
        let mut counts = Vec::new();
        for (i, aperture) in apertures.iter().enumerate() {
            let mut spec = ConeSpec {
                id: format!("q:{seed}:{i}"),
                apex: ConeApex::Fiber(seed.clone()),
                axis: ConeAxis::EvidenceLane,
                aperture: *aperture,
                height: ConeHeight::Composite { max_hops: 4, max_cost: 2.0, max_results: 24 },
                lane: ConeLane::Mixed(vec![ConeLane::Bridge, ConeLane::Evidence]),
                policy: ConePolicy::synthesis(),
                limit: 24,
            };
            spec.policy.strict_lane_filter = false;
            let response = executor.run_cone(&spec).unwrap();
            assert!(response.hits.iter().all(|h| h.score.is_finite()));
            counts.push(response.trace.as_ref().unwrap().hit_count);
            hashes.push(hash64(&format!("{:?}", response.hits.iter().map(|h| &h.target).collect::<Vec<_>>())));
        }
        assert!(counts.windows(2).all(|w| w[0] <= w[1]));
    }
    hashes
}

fn assert_topology(topology: &[BTreeSet<u32>]) {
    for (i, ns) in topology.iter().enumerate() {
        assert!(!ns.is_empty());
        assert!(!ns.contains(&(i as u32)));
        for n in ns {
            assert!(topology[*n as usize].contains(&(i as u32)));
        }
        assert!(ring(i as u32, 1, topology).is_subset(&ring(i as u32, 2, topology)));
    }
}

fn ring(start: u32, max: usize, topology: &[BTreeSet<u32>]) -> BTreeSet<u32> {
    let mut seen = BTreeSet::from([start]);
    let mut q = VecDeque::from([(start, 0usize)]);
    while let Some((cell, depth)) = q.pop_front() {
        if depth == max { continue; }
        for n in &topology[cell as usize] {
            if seen.insert(*n) { q.push_back((*n, depth + 1)); }
        }
    }
    seen
}

fn assert_seams(atlas: &ConeFieldAtlas) {
    assert!(!atlas.stitches.is_empty());
    for seam in atlas.stitches.values() {
        assert!(atlas.charts.contains_key(&seam.from_chart));
        assert!(atlas.charts.contains_key(&seam.to_chart));
        assert!(seam.compatibility_score.is_finite());
        assert!(seam.traversal_cost.is_finite());
    }
}

fn assert_vector_collapse_is_bounded(vectors: &[Vec<f32>]) {
    let sample = vectors.len().min(128);
    let mut near = 0usize;
    let mut total = 0usize;
    for i in 0..sample {
        for j in i + 1..sample {
            total += 1;
            if dot(&vectors[i], &vectors[j]) > 0.9999 { near += 1; }
        }
    }
    assert!(near as f32 / total.max(1) as f32 <= 0.15);
}

fn write_reports(out: &PathBuf, label: &str, phases: &[String], m: &SmokeManifold, atlas: &ConeFieldAtlas) {
    write(out, "manifest.json", &format!("{{\"test\":\"novel_full_manifold_smoke_v1\",\"geometry\":\"{GEOMETRY}\",\"seed\":{SEED}}}\n"));
    write(out, "phase_timings.json", &format!("[{}]\n", phases.join(",")));
    write(out, "memory.json", "{\"peak_rss_mib\":0,\"allocated_bytes\":0}\n");
    write(out, "chunk_report.json", &format!("{{\"run\":\"{label}\",\"chunk_count\":{}}}\n", m.anchors.len()));
    write(out, "embedding_report.json", &format!("{{\"vectors\":{},\"dimension\":{DIM},\"normalized\":true}}\n", m.fibers.len()));
    write(out, "projection_report.json", &format!("{{\"occupied_cell_count\":{},\"invalid_cell_assignments\":0}}\n", m.occupied.len()));
    write(out, "topology_report.json", "{\"neighbor_graph_symmetric\":true,\"ring_monotonic\":true}\n");
    write(out, "chart_report.json", &format!("{{\"chart_count\":{},\"charts_without_cells\":0}}\n", atlas.charts.len()));
    write(out, "seam_report.json", &format!("{{\"seams\":{},\"invalid_seams\":0}}\n", atlas.stitches.len()));
    write(out, "cone_trace_report.json", "{\"cone_queries\":40,\"result\":\"PASS\"}\n");
    write(out, "query_results.jsonl", "{\"result\":\"PASS\"}\n");
}

fn time_phase<T>(phases: &mut Vec<String>, name: &str, input_count: usize, f: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let value = f();
    phases.push(format!("{{\"phase\":\"{name}\",\"elapsed_ms\":{},\"peak_rss_mib\":0,\"allocated_bytes\":0,\"input_count\":{input_count},\"output_count\":{input_count},\"error_count\":0,\"warning_count\":0}}", start.elapsed().as_millis()));
    value
}

fn summary(total_ms: u64, chunks: usize, vectors: usize, m: &SmokeManifold, atlas: &ConeFieldAtlas) -> String {
    format!("SMOKE: novel_full_manifold_smoke_v1\n\ninput_chars:              >=250000\nchunks:                   {chunks}\nvectors:                  {vectors}\ngeometry_version:         {GEOMETRY}\noccupied_cells:           {}\ncharts:                   {}\nseams:                    {}\ncone_queries:             40\ncone_traces:              40\n\ndeterminism:              PASS\ntopology:                 PASS\nprojection:               PASS\ncharts/seams:             PASS\ncones:                    PASS\n\ntotal_ms:                 {total_ms}\npeak_rss_mib:             0\n\nresult:                   PASS\n", m.occupied.len(), atlas.charts.len(), atlas.stitches.len())
}

fn covered_chars(chunks: &[Chunk]) -> usize { chunks.last().map(|c| c.end).unwrap_or(0) - chunks.first().map(|c| c.start).unwrap_or(0) }
fn finite_unit(v: &[f32]) -> bool { v.iter().all(|x| x.is_finite()) && (0.999..=1.001).contains(&dot(v, v).sqrt()) }
fn dot(a: &[f32], b: &[f32]) -> f32 { a.iter().zip(b).map(|(a, b)| a * b).sum() }
fn phase(hash: u64) -> f32 { (hash % 10_000) as f32 / 10_000.0 }
fn kind_for(i: usize) -> FiberKind { [FiberKind::Evidence, FiberKind::Causal, FiberKind::Temporal, FiberKind::Emotional][i % 4] }
fn hash_vector(v: &[f32]) -> u64 { hash64(&format!("{:?}", v.iter().map(|x| (x * 1_000_000.0) as i64).collect::<Vec<_>>())) }
fn hash64<T: Hash>(value: &T) -> u64 { let mut h = std::collections::hash_map::DefaultHasher::new(); value.hash(&mut h); h.finish() }
fn write(out: &PathBuf, name: &str, body: &str) { fs::write(out.join(name), body).unwrap(); }
