use memmap2::Mmap;
use phoenix_numerology::export::json_pretty;
use phoenix_numerology::{
    annotated_markdown, number_only_text_with_mode, scan_bytes, summary_text,
    word_annotated_text_with_mode, DigitPolicy, NumerologyProfile, NumerologyProfileKind,
    ReductionMode, ScanOptions, WordValueMode,
};
use std::env;
use std::error::Error;
use std::fs::File;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args = CliArgs::parse(env::args().skip(1))
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    let input = map_input(&args.input)?;
    let source_name = args
        .input
        .file_name()
        .map(|name| name.to_string_lossy().to_string());
    if args.repeat > 1 {
        return run_bench(input.as_slice(), source_name, args);
    }

    let scan = scan_bytes(
        input.as_slice(),
        ScanOptions {
            source_name,
            profile: args.profile,
        },
    )?;

    let output = match args.format {
        OutputFormat::Summary => summary_text(&scan, args.top),
        OutputFormat::Json => json_pretty(&scan)?,
        OutputFormat::Annotated => annotated_markdown(input.as_slice(), &scan)?,
        OutputFormat::WordAnnotated => {
            word_annotated_text_with_mode(input.as_slice(), &scan, args.word_value_mode)?
        }
        OutputFormat::NumberOnly => {
            number_only_text_with_mode(input.as_slice(), &scan, args.word_value_mode)?
        }
    };

    if let Some(out_path) = args.out {
        std::fs::write(out_path, output)?;
    } else {
        print!("{output}");
    }

    Ok(())
}

struct CliArgs {
    input: PathBuf,
    out: Option<PathBuf>,
    profile: NumerologyProfile,
    format: OutputFormat,
    top: usize,
    repeat: usize,
    word_value_mode: WordValueMode,
}

impl CliArgs {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut input = None;
        let mut out = None;
        let mut kind = NumerologyProfileKind::NumeracalcCompatible;
        let mut reduction = ReductionMode::DigitalRoot;
        let mut digit_policy = DigitPolicy::Ignore;
        let mut format = OutputFormat::Summary;
        let mut top = 10usize;
        let mut repeat = 1usize;
        let mut word_value_mode = WordValueMode::Raw;
        let mut iter = args.into_iter();

        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--input" | "-i" => input = Some(next_path(&mut iter, "--input")?),
                "--out" | "-o" => out = Some(next_path(&mut iter, "--out")?),
                "--profile" => {
                    let value = next_value(&mut iter, "--profile")?;
                    kind = NumerologyProfileKind::parse(&value)
                        .ok_or_else(|| format!("unknown profile: {value}"))?;
                }
                "--reduction" => {
                    let value = next_value(&mut iter, "--reduction")?;
                    reduction = ReductionMode::parse(&value)
                        .ok_or_else(|| format!("unknown reduction: {value}"))?;
                }
                "--digits" => {
                    let value = next_value(&mut iter, "--digits")?;
                    digit_policy = DigitPolicy::parse(&value)
                        .ok_or_else(|| format!("unknown digit policy: {value}"))?;
                }
                "--format" => {
                    let value = next_value(&mut iter, "--format")?;
                    format = OutputFormat::parse(&value)
                        .ok_or_else(|| format!("unknown output format: {value}"))?;
                }
                "--top" => {
                    let value = next_value(&mut iter, "--top")?;
                    top = value
                        .parse()
                        .map_err(|_| format!("--top must be an integer, got: {value}"))?;
                }
                "--repeat" => {
                    let value = next_value(&mut iter, "--repeat")?;
                    repeat = value
                        .parse()
                        .map_err(|_| format!("--repeat must be an integer, got: {value}"))?;
                }
                "--word-values" => {
                    let value = next_value(&mut iter, "--word-values")?;
                    word_value_mode = WordValueMode::parse(&value)
                        .ok_or_else(|| format!("unknown word value mode: {value}"))?;
                }
                "--help" | "-h" => return Err(usage()),
                _ if input.is_none() && !arg.starts_with('-') => input = Some(PathBuf::from(arg)),
                _ => return Err(format!("unknown argument: {arg}\n{}", usage())),
            }
        }

        let input = input.ok_or_else(usage)?;
        Ok(Self {
            input,
            out,
            profile: NumerologyProfile {
                kind,
                reduction,
                digit_policy,
            },
            format,
            top,
            repeat: repeat.max(1),
            word_value_mode,
        })
    }
}

fn run_bench(
    bytes: &[u8],
    source_name: Option<String>,
    args: CliArgs,
) -> Result<(), Box<dyn Error>> {
    let mut last = None;
    let started = Instant::now();
    for _ in 0..args.repeat {
        last = Some(scan_bytes(
            bytes,
            ScanOptions {
                source_name: source_name.clone(),
                profile: args.profile,
            },
        )?);
    }
    let elapsed = started.elapsed();
    let scan = last.expect("repeat is clamped to at least one");
    let total_ms = elapsed.as_secs_f64() * 1_000.0;
    let avg_us = elapsed.as_secs_f64() * 1_000_000.0 / args.repeat as f64;

    println!("iterations: {}", args.repeat);
    println!("total_ms: {:.3}", total_ms);
    println!("avg_scan_us: {:.3}", avg_us);
    println!("bytes: {}", scan.totals.bytes);
    println!("verses: {}", scan.totals.verses);
    println!("chapters: {}", scan.totals.chapters);
    println!("document_raw: {}", scan.document.raw_value);
    println!("document_reduced: {}", scan.document.reduced_value);
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum OutputFormat {
    Summary,
    Json,
    Annotated,
    WordAnnotated,
    NumberOnly,
}

impl OutputFormat {
    fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "summary" => Some(Self::Summary),
            "json" => Some(Self::Json),
            "annotated" | "markdown" | "md" => Some(Self::Annotated),
            "word-annotated" | "words" | "word-markdown" | "word-md" => Some(Self::WordAnnotated),
            "number-only" | "numbers" | "numeric" | "numeric-words" => Some(Self::NumberOnly),
            _ => None,
        }
    }
}

enum InputBytes {
    Mapped(Mmap),
    Empty,
}

impl InputBytes {
    fn as_slice(&self) -> &[u8] {
        match self {
            Self::Mapped(map) => map,
            Self::Empty => &[],
        }
    }
}

fn map_input(path: &PathBuf) -> Result<InputBytes, Box<dyn Error>> {
    let file = File::open(path)?;
    if file.metadata()?.len() == 0 {
        return Ok(InputBytes::Empty);
    }

    let map = unsafe { Mmap::map(&file)? };
    Ok(InputBytes::Mapped(map))
}

fn next_value<I>(iter: &mut I, flag: &str) -> Result<String, String>
where
    I: Iterator<Item = String>,
{
    iter.next()
        .ok_or_else(|| format!("{flag} requires a value\n{}", usage()))
}

fn next_path<I>(iter: &mut I, flag: &str) -> Result<PathBuf, String>
where
    I: Iterator<Item = String>,
{
    next_value(iter, flag).map(PathBuf::from)
}

fn usage() -> String {
    "usage: phoenix-numerology-scan --input <path> [--profile numeracalc|biblical|pythagorean|ordinal] [--format summary|json|annotated|word-annotated|number-only] [--word-values raw|reduced|both] [--repeat N] [--out <path>]".to_owned()
}
