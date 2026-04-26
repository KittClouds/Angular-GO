#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use phoenix_om::{
    approx_token_count, NativeOpenRouterTransport, OmEngine, OmNativeBridge, OmTransport,
};
use phoenix_store_native_core::PhoenixNativeRowStore;
use phoenix_store_overgraph::PhoenixOvergraphStore;
use phoenix_types::OmConfig;
use serde_json::{json, Value};

const DEFAULT_OBSERVER_MODEL: &str = "openrouter/elephant-alpha";
const DEFAULT_REFLECTOR_MODEL: &str = "google/gemma-4-31b-it:free";

fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();
    let started_at = now_ms();
    let key = read_openrouter_key(args.key_path.as_deref())?;
    let source = fs::read_to_string(&args.source_path)?;
    let store_path = args.store_path.clone().unwrap_or_else(|| {
        env::temp_dir().join(format!(
            "phoenix-om-smoke-{}-{}",
            std::process::id(),
            started_at
        ))
    });
    let store = PhoenixOvergraphStore::open(&store_path)?;
    store.init_schema()?;

    let thread_id = format!("om-smoke-perfect-run-{started_at}");
    seed_thread_messages(
        &store,
        &thread_id,
        &source,
        args.message_count,
        args.max_chars,
    )?;

    let engine = OmEngine::default();
    let bridge = OmNativeBridge;
    let transport = NativeOpenRouterTransport::new(
        &key,
        "https://overgraph.io",
        "Phoenix OM CLI smoke",
        Some(0.2),
        Some(args.max_tokens),
    )?;

    let observer_action = engine
        .prepare_pending_action_with_graph(
            &store,
            &bridge,
            &thread_id,
            &OmConfig {
                enabled: true,
                model: args.observer_model.clone(),
                observe_threshold: 200,
                reflect_threshold: 100_000,
                graph_index_enabled: true,
                index_raw_messages: true,
                index_observations: true,
                index_reflections: true,
                reflector_tooling_enabled: false,
                reflector_max_tool_rounds: 0,
            },
        )?
        .ok_or("observer action was not scheduled")?;
    let observer_response = transport.observe(&observer_action)?;
    let observed = engine.apply_pending_action_with_graph(
        &store,
        &bridge,
        &OmConfig {
            enabled: true,
            model: args.observer_model.clone(),
            observe_threshold: 200,
            reflect_threshold: 100_000,
            graph_index_enabled: true,
            index_raw_messages: true,
            index_observations: true,
            index_reflections: true,
            reflector_tooling_enabled: false,
            reflector_max_tool_rounds: 0,
        },
        &observer_action,
        &observer_response,
    )?;

    let reflector_action = engine
        .prepare_pending_action_with_graph(
            &store,
            &bridge,
            &thread_id,
            &OmConfig {
                enabled: true,
                model: args.reflector_model.clone(),
                observe_threshold: 100_000,
                reflect_threshold: 1,
                graph_index_enabled: true,
                index_raw_messages: false,
                index_observations: true,
                index_reflections: true,
                reflector_tooling_enabled: false,
                reflector_max_tool_rounds: 0,
            },
        )?
        .ok_or("reflector action was not scheduled")?;
    let reflector_response = transport.reflect(&reflector_action)?;
    let reflected = engine.apply_pending_action_with_graph(
        &store,
        &bridge,
        &OmConfig {
            enabled: true,
            model: args.reflector_model.clone(),
            observe_threshold: 100_000,
            reflect_threshold: 1,
            graph_index_enabled: true,
            index_raw_messages: false,
            index_observations: true,
            index_reflections: true,
            reflector_tooling_enabled: false,
            reflector_max_tool_rounds: 0,
        },
        &reflector_action,
        &reflector_response,
    )?;

    let report = build_report(
        &store,
        &thread_id,
        &args,
        &store_path,
        started_at,
        observed,
        reflected,
        &observer_response,
        &reflector_response,
    )?;
    let report_path = write_report(&report)?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    println!("report_path={}", report_path.display());
    store.publish_and_close()?;
    Ok(())
}

struct Args {
    source_path: PathBuf,
    key_path: Option<PathBuf>,
    store_path: Option<PathBuf>,
    observer_model: String,
    reflector_model: String,
    message_count: usize,
    max_chars: usize,
    max_tokens: u32,
}

impl Args {
    fn parse() -> Self {
        let mut values = env::args().skip(1);
        let mut args = Self {
            source_path: PathBuf::from("docs/perfect_run.md"),
            key_path: None,
            store_path: None,
            observer_model: DEFAULT_OBSERVER_MODEL.to_owned(),
            reflector_model: DEFAULT_REFLECTOR_MODEL.to_owned(),
            message_count: 8,
            max_chars: 14_000,
            max_tokens: 1_200,
        };
        while let Some(flag) = values.next() {
            let Some(value) = values.next() else {
                break;
            };
            match flag.as_str() {
                "--source" => args.source_path = PathBuf::from(value),
                "--key" => args.key_path = Some(PathBuf::from(value)),
                "--store" => args.store_path = Some(PathBuf::from(value)),
                "--observer-model" => args.observer_model = value,
                "--reflector-model" => args.reflector_model = value,
                "--messages" => args.message_count = value.parse().unwrap_or(args.message_count),
                "--max-chars" => args.max_chars = value.parse().unwrap_or(args.max_chars),
                "--max-tokens" => args.max_tokens = value.parse().unwrap_or(args.max_tokens),
                _ => {}
            }
        }
        args
    }
}

fn seed_thread_messages(
    store: &impl PhoenixNativeRowStore,
    thread_id: &str,
    source: &str,
    message_count: usize,
    max_chars: usize,
) -> Result<(), Box<dyn Error>> {
    let now = now_ms();
    store.put_row(
        "threads",
        json!({
            "id": thread_id,
            "world_id": "perfect-run-smoke",
            "narrative_id": "perfect-run",
            "title": "Perfect Run OM smoke",
            "created_at": now,
            "updated_at": now,
        }),
    )?;
    for (index, chunk) in source_chunks(source, message_count, max_chars)
        .into_iter()
        .enumerate()
    {
        let role = if index % 2 == 0 { "user" } else { "assistant" };
        let content = if role == "user" {
            format!("Perfect Run source packet {}:\n\n{chunk}", index + 1)
        } else {
            format!(
                "Tracking continuity notes for packet {}:\n\n{chunk}",
                index + 1
            )
        };
        store.put_row(
            "thread_messages",
            json!({
                "id": format!("msg-{thread_id}-{index:03}"),
                "thread_id": thread_id,
                "role": role,
                "content": content,
                "narrative_id": "perfect-run",
                "created_at": now + index as i64 + 1,
                "updated_at": now + index as i64 + 1,
                "is_streaming": false,
                "token_count": approx_token_count(&content),
                "is_observed": false,
            }),
        )?;
    }
    Ok(())
}

fn source_chunks(source: &str, message_count: usize, max_chars: usize) -> Vec<String> {
    let packet = source.chars().take(max_chars).collect::<String>();
    let target_chars = (packet.chars().count() / message_count.max(1)).max(800);
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_chars = 0usize;
    for word in packet.split_whitespace() {
        let word_chars = word.chars().count();
        if !current.is_empty()
            && current_chars + word_chars + 1 > target_chars
            && chunks.len() + 1 < message_count
        {
            chunks.push(std::mem::take(&mut current));
            current_chars = 0;
        }
        if !current.is_empty() {
            current.push(' ');
            current_chars += 1;
        }
        current.push_str(word);
        current_chars += word_chars;
    }
    if !current.is_empty() && chunks.len() < message_count {
        chunks.push(current);
    }
    chunks
}

fn build_report(
    store: &impl PhoenixNativeRowStore,
    thread_id: &str,
    args: &Args,
    store_path: &Path,
    started_at: i64,
    observed: bool,
    reflected: bool,
    observer_response: &str,
    reflector_response: &str,
) -> Result<Value, Box<dyn Error>> {
    let messages = store.fetch_rows("thread_messages")?;
    let observed_messages = messages
        .iter()
        .filter(|row| row.get("thread_id").and_then(Value::as_str) == Some(thread_id))
        .filter(|row| {
            row.get("is_observed")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count();
    let relations = [
        "om_records",
        "om_generations",
        "om_graph_index",
        "om_graph_entities",
        "om_graph_relations",
    ];
    let mut counts = BTreeMap::new();
    for relation in relations {
        counts.insert(relation, store.fetch_rows(relation)?.len());
    }
    let record = store
        .fetch_rows("om_records")?
        .into_iter()
        .find(|row| row.get("thread_id").and_then(Value::as_str) == Some(thread_id));
    Ok(json!({
        "startedAt": started_at,
        "completedAt": now_ms(),
        "threadId": thread_id,
        "storePath": store_path,
        "sourcePath": args.source_path,
        "observerModel": args.observer_model,
        "reflectorModel": args.reflector_model,
        "observed": observed,
        "reflected": reflected,
        "messageCount": messages.len(),
        "observedMessages": observed_messages,
        "relationCounts": counts,
        "record": record,
        "observerResponseChars": observer_response.len(),
        "reflectorResponseChars": reflector_response.len(),
        "observerPreview": preview(observer_response, 360),
        "reflectorPreview": preview(reflector_response, 360),
    }))
}

fn write_report(report: &Value) -> Result<PathBuf, Box<dyn Error>> {
    let dir = PathBuf::from("rust-native/phoenix/reports/om-smoke");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("om-smoke-{}.json", now_ms()));
    fs::write(&path, serde_json::to_vec_pretty(report)?)?;
    Ok(path)
}

fn read_openrouter_key(path: Option<&Path>) -> Result<String, Box<dyn Error>> {
    if let Ok(value) = env::var("OPENROUTER_API_KEY") {
        let value = value.trim();
        if !value.is_empty() {
            return Ok(value.to_owned());
        }
    }
    let candidates = path
        .map(|value| vec![value.to_path_buf()])
        .unwrap_or_else(|| vec![PathBuf::from("key.md"), PathBuf::from("docs/key.md")]);
    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        let content = fs::read_to_string(candidate)?;
        if let Some(key) = extract_key(&content) {
            return Ok(key);
        }
    }
    Err("OPENROUTER_API_KEY or key.md/docs/key.md is required".into())
}

fn extract_key(content: &str) -> Option<String> {
    content
        .split(|ch: char| ch.is_whitespace() || ch == '"' || ch == '\'' || ch == '`')
        .map(|part| part.trim_matches(|ch| ch == ':' || ch == '='))
        .find(|part| part.starts_with("sk-or-") || part.starts_with("sk-"))
        .map(str::to_owned)
}

fn preview(value: &str, max_chars: usize) -> String {
    let mut preview = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        preview.push_str("...");
    }
    preview
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
