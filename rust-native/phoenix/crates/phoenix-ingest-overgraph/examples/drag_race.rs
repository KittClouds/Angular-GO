use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::time::{Duration, Instant};

use phoenix_ingest_overgraph::{InvarantV3Config, PhoenixInvarantV3};
use phoenix_types::{EntityId, EntityKind, ResolverEntitySeed, ScopeKey};

fn story_seeds() -> Vec<ResolverEntitySeed> {
    [
        "Aella", "Aurora", "Brynwyn", "Iriane", "Isolde", "Kai", "Phaeris", "Rowan", "Siofra",
    ]
    .into_iter()
    .map(|name| ResolverEntitySeed {
        entity_id: EntityId(name.to_ascii_lowercase()),
        canonical_name: name.to_owned(),
        aliases: Vec::new(),
        kind: Some(EntityKind::Character),
        gender: None,
        number: None,
        scope: ScopeKey::default(),
    })
    .collect()
}

fn median(mut values: Vec<u128>) -> u128 {
    if values.is_empty() {
        return 0;
    }
    values.sort_unstable();
    values[values.len() / 2]
}

fn normalize_group(label: &str) -> &'static str {
    match label {
        "person" | "character" | "npc" => "person",
        "organization" | "faction" => "organization",
        "location" => "location",
        "event" => "event",
        "item" | "artifact" => "item",
        "concept" => "concept",
        "pronoun" => "pronoun",
        "nominal" => "nominal",
        _ => "other",
    }
}

fn format_duration_us(us: u128) -> String {
    if us >= 1_000 {
        format!("{:.3} ms", us as f64 / 1_000.0)
    } else {
        format!("{us} us")
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = env::args()
        .nth(1)
        .unwrap_or_else(|| "docs\\shortrun.md".to_owned());
    let runs = env::args()
        .nth(2)
        .and_then(|arg| arg.parse::<usize>().ok())
        .unwrap_or(7)
        .max(1);

    let text = fs::read_to_string(&path)?;
    let engine = PhoenixInvarantV3::new(InvarantV3Config::default());
    let seeds = story_seeds();
    let scope = ScopeKey::default();

    let mut timings = Vec::with_capacity(runs);
    let mut last_report = None;
    for _ in 0..runs {
        let started = Instant::now();
        let report = engine.benchmark_native_ner(&text, &scope, &seeds);
        timings.push(started.elapsed());
        last_report = Some(report);
    }

    let report = last_report.expect("at least one run");
    let timing_us: Vec<u128> = timings.iter().map(Duration::as_micros).collect();
    let best = timing_us.iter().copied().min().unwrap_or(0);
    let worst = timing_us.iter().copied().max().unwrap_or(0);
    let med = median(timing_us.clone());

    let mut grouped: BTreeMap<&'static str, BTreeMap<String, String>> = BTreeMap::new();
    let mut source_counts: BTreeMap<String, usize> = BTreeMap::new();
    for mention in &report.mentions {
        let group = normalize_group(&mention.label);
        grouped
            .entry(group)
            .or_default()
            .entry(mention.normalized.clone())
            .or_insert_with(|| mention.surface.clone());
        let source = mention
            .source
            .clone()
            .unwrap_or_else(|| "unknown".to_owned());
        *source_counts.entry(source).or_default() += 1;
    }

    println!("ENGINE old_ingest_overgraph_native");
    println!("DOC {path}");
    println!("BYTES {}", text.len());
    println!("CHARS {}", text.chars().count());
    println!("RUNS {runs}");
    println!(
        "TIME best={} median={} worst={}",
        format_duration_us(best),
        format_duration_us(med),
        format_duration_us(worst)
    );
    println!(
        "COUNTS mentions={} named={} nominal={} pronoun={} discoveries={} sentences={}",
        report.mention_count,
        report.named_count,
        report.nominal_count,
        report.pronoun_count,
        report.discovery_count,
        report.sentence_count
    );
    println!("SOURCES");
    for (source, count) in source_counts {
        println!("  {source}: {count}");
    }
    println!("GROUPS");
    for (group, surfaces) in grouped {
        let ordered: BTreeSet<_> = surfaces.values().cloned().collect();
        let list = ordered.into_iter().collect::<Vec<_>>().join(" | ");
        println!("  {group}: {} :: {list}", surfaces.len());
    }
    Ok(())
}
