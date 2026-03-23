use std::env;
use std::path::PathBuf;

use phoenix_perf::{
    default_out_dir, render_markdown, run_perf_suite_filtered, strict_check, write_suite_report,
};

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let strict = args.iter().any(|arg| arg == "--strict");
    let json_only = args.iter().any(|arg| arg == "--json");
    let corpus_filter = args
        .windows(2)
        .find_map(|window| (window[0] == "--corpus").then(|| window[1].clone()));
    let out_dir = args
        .windows(2)
        .find_map(|window| (window[0] == "--out-dir").then(|| PathBuf::from(&window[1])))
        .unwrap_or_else(default_out_dir);

    let report = match run_perf_suite_filtered(corpus_filter.as_deref()) {
        Ok(report) => report,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };

    let (json_path, md_path) = match write_suite_report(&report, &out_dir) {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };

    if json_only {
        println!("{}", serde_json::to_string_pretty(&report).expect("json"));
    } else {
        println!("{}", render_markdown(&report));
        println!();
        println!("JSON report: {}", json_path.display());
        println!("Markdown report: {}", md_path.display());
    }

    if strict {
        if let Err(error) = strict_check(&report) {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
