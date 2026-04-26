use std::env;
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use phoenix_api::depth_audit::{run_depth_audit, DepthAuditConfig};
use phoenix_graph_post::smoke_support::{string_arg, usize_arg};

fn main() {
    let trace_enabled = env::var_os("PHOENIX_DEPTH_AUDIT_TRACE").is_some();
    let started_at = Instant::now();
    trace(trace_enabled, &started_at, "main:start");
    let config = parse_args(env::args().skip(1).collect());
    trace(trace_enabled, &started_at, "args:parsed");
    match run_depth_audit(config) {
        Ok(report) => {
            trace(trace_enabled, &started_at, "audit:complete");
            let json = serde_json::to_string_pretty(&report).expect("serialize depth audit report");
            trace(trace_enabled, &started_at, "json:serialized");
            println!("{json}");
            let _ = std::io::stdout().flush();
            trace(trace_enabled, &started_at, "stdout:flushed");
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn trace(enabled: bool, started_at: &Instant, label: &str) {
    if enabled {
        eprintln!(
            "depth_audit_trace label={label} elapsed_ms={}",
            started_at.elapsed().as_millis()
        );
    }
}

fn parse_args(args: Vec<String>) -> DepthAuditConfig {
    let mut config = DepthAuditConfig::default();
    if let Some(path) = string_arg(&args, "--store-path") {
        config.store_path = PathBuf::from(path);
    }
    if let Some(value) = usize_arg(&args, "--probe-limit") {
        config.probe_limit = value.max(1);
    }
    if let Some(value) = usize_arg(&args, "--seed-limit") {
        config.seed_limit = value.max(1);
    }
    if let Some(value) = usize_arg(&args, "--oversample") {
        config.oversample = value.max(config.seed_limit);
    }
    if let Some(value) = usize_arg(&args, "--expansion-hops") {
        config.expansion_hops = value.max(1);
    }
    if let Some(value) = usize_arg(&args, "--region-node-limit") {
        config.region_node_limit = value.max(32);
    }
    if let Some(value) = usize_arg(&args, "--history-limit") {
        config.history_limit = value.max(1);
    }
    if let Some(value) = usize_arg(&args, "--causal-limit") {
        config.causal_limit = value.max(1);
    }
    if let Some(value) = usize_arg(&args, "--neighbor-limit") {
        config.graph.neighbor_limit = value.max(1);
    }
    if let Some(value) = usize_arg(&args, "--min-score") {
        config.graph.min_score_millis = value.min(1000) as u32;
    }
    if args.iter().any(|arg| arg == "--refresh-graph") {
        config.refresh_graph = true;
    }
    if args.iter().any(|arg| arg == "--refresh-pipeline") {
        config.refresh_pipeline = true;
    }
    if args.iter().any(|arg| arg == "--refresh-semantic") {
        config.refresh_semantic = true;
    }
    config
}
