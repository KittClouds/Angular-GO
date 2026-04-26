use crate::profile::NumerologyProfile;
use crate::scan::{NumerologyScan, UnitKind, UnitSummary};
use crate::segment::line_ranges;
use serde::Serialize;
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WordValueMode {
    Raw,
    Reduced,
    Both,
}

impl WordValueMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "raw" => Some(Self::Raw),
            "reduced" | "root" | "digit" | "1-9" => Some(Self::Reduced),
            "both" | "raw-reduced" | "raw_reduced" => Some(Self::Both),
            _ => None,
        }
    }
}

#[derive(Debug)]
pub enum ExportError {
    InvalidUtf8(std::str::Utf8Error),
}

impl fmt::Display for ExportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUtf8(error) => write!(formatter, "input must be valid UTF-8: {error}"),
        }
    }
}

impl std::error::Error for ExportError {}

pub fn summary_text(scan: &NumerologyScan, top_limit: usize) -> String {
    let mut output = String::with_capacity(2048);
    push_kv(
        &mut output,
        "source",
        scan.source_name.as_deref().unwrap_or("<memory>"),
    );
    push_kv(&mut output, "format", &format!("{:?}", scan.source_format));
    push_kv(&mut output, "profile", scan.profile.kind.as_str());
    push_kv(
        &mut output,
        "reduction",
        &format!("{:?}", scan.profile.reduction),
    );
    push_kv(
        &mut output,
        "document",
        &format!(
            "raw={} reduced={} letters={} digits={}",
            scan.document.raw_value,
            scan.document.reduced_value,
            scan.document.ascii_letters,
            scan.document.digits
        ),
    );
    push_kv(
        &mut output,
        "units",
        &format!(
            "books={} chapters={} verses={} paragraphs={} lines={} total={}",
            scan.totals.books,
            scan.totals.chapters,
            scan.totals.verses,
            scan.totals.paragraphs,
            scan.totals.lines,
            scan.totals.units
        ),
    );

    let mut chapters: Vec<_> = scan
        .units
        .iter()
        .filter(|unit| unit.kind == UnitKind::Chapter)
        .collect();
    chapters.sort_unstable_by(|left, right| {
        right
            .raw_value
            .cmp(&left.raw_value)
            .then_with(|| left.label.cmp(&right.label))
    });

    if !chapters.is_empty() {
        output.push_str("\ntop chapters by raw value\n");
        for chapter in chapters.into_iter().take(top_limit.max(1)) {
            output.push_str(&format_unit_line(chapter));
        }
    }

    let mut books = scan.units.iter().filter(|unit| unit.kind == UnitKind::Book);
    if scan.totals.books > 0 {
        output.push_str("\nbooks\n");
        for book in books.by_ref().take(top_limit.max(1)) {
            output.push_str(&format_unit_line(book));
        }
    }

    if scan.totals.lines > 0 {
        output.push_str("\nfirst lines\n");
        for line in scan
            .units
            .iter()
            .filter(|unit| unit.kind == UnitKind::Line)
            .take(top_limit.max(1))
        {
            output.push_str(&format_unit_line(line));
        }
    }

    output
}

pub fn annotated_markdown(bytes: &[u8], scan: &NumerologyScan) -> Result<String, ExportError> {
    let text = std::str::from_utf8(bytes).map_err(ExportError::InvalidUtf8)?;
    if scan.source_format == crate::segment::SourceFormat::BibleVerseLines {
        return Ok(annotate_bible(text, scan));
    }
    Ok(annotate_lines(bytes, text, scan))
}

pub fn word_annotated_text(bytes: &[u8], scan: &NumerologyScan) -> Result<String, ExportError> {
    word_annotated_text_with_mode(bytes, scan, WordValueMode::Raw)
}

pub fn word_annotated_text_with_mode(
    bytes: &[u8],
    scan: &NumerologyScan,
    mode: WordValueMode,
) -> Result<String, ExportError> {
    let text = std::str::from_utf8(bytes).map_err(ExportError::InvalidUtf8)?;
    if scan.source_format == crate::segment::SourceFormat::BibleVerseLines {
        return Ok(annotate_bible_words(text, scan, mode));
    }
    Ok(annotate_line_words(bytes, text, scan, mode))
}

pub fn json_pretty<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(value)
}

fn annotate_bible(text: &str, scan: &NumerologyScan) -> String {
    let mut output = String::with_capacity(text.len() + scan.totals.verses * 32);
    let mut current_book: Option<&str> = None;
    let mut current_chapter: Option<u32> = None;
    let mut verses: Vec<_> = scan
        .units
        .iter()
        .filter(|unit| unit.kind == UnitKind::Verse)
        .collect();
    verses.sort_unstable_by_key(|unit| unit.start);

    for verse in verses {
        let book = verse.book.as_deref().unwrap_or("Unknown");
        let chapter = verse.chapter.unwrap_or_default();
        if current_book != Some(book) {
            current_book = Some(book);
            current_chapter = None;
            if let Some(book_unit) = find_book(scan, book) {
                output.push_str(&format!("\n# {} {}\n", book, inline_score(book_unit)));
            } else {
                output.push_str(&format!("\n# {book}\n"));
            }
        }
        if current_chapter != Some(chapter) {
            current_chapter = Some(chapter);
            if let Some(chapter_unit) = find_chapter(scan, book, chapter) {
                output.push_str(&format!(
                    "\n## {} {} {}\n",
                    book,
                    chapter,
                    inline_score(chapter_unit)
                ));
            }
        }

        let line = &text[verse.start..verse.end];
        output.push_str(line);
        output.push(' ');
        output.push_str(&inline_score(verse));
        output.push('\n');
    }

    output.trim_start().to_owned()
}

fn annotate_lines(bytes: &[u8], text: &str, scan: &NumerologyScan) -> String {
    let mut by_start: HashMap<usize, &UnitSummary> = HashMap::new();
    for unit in scan.units.iter().filter(|unit| unit.kind == UnitKind::Line) {
        by_start.insert(unit.start, unit);
    }

    let mut output = String::with_capacity(text.len() + scan.totals.lines * 32);
    for range in line_ranges(bytes) {
        let line = &text[range.start..range.end];
        output.push_str(line);
        if let Some(unit) = by_start.get(&range.start) {
            output.push(' ');
            output.push_str(&inline_score(unit));
        }
        output.push('\n');
    }
    output
}

fn annotate_bible_words(text: &str, scan: &NumerologyScan, mode: WordValueMode) -> String {
    let mut output = String::with_capacity(text.len() * 3);
    let mut current_book: Option<&str> = None;
    let mut current_chapter: Option<u32> = None;
    let mut verses: Vec<_> = scan
        .units
        .iter()
        .filter(|unit| unit.kind == UnitKind::Verse)
        .collect();
    verses.sort_unstable_by_key(|unit| unit.start);

    for verse in verses {
        let book = verse.book.as_deref().unwrap_or("Unknown");
        let chapter = verse.chapter.unwrap_or_default();
        if current_book != Some(book) {
            current_book = Some(book);
            current_chapter = None;
            if let Some(book_unit) = find_book(scan, book) {
                output.push_str(&format!("\n# {} {}\n", book, inline_score(book_unit)));
            } else {
                output.push_str(&format!("\n# {book}\n"));
            }
        }
        if current_chapter != Some(chapter) {
            current_chapter = Some(chapter);
            if let Some(chapter_unit) = find_chapter(scan, book, chapter) {
                output.push_str(&format!(
                    "\n## {} {} {}\n",
                    book,
                    chapter,
                    inline_score(chapter_unit)
                ));
            }
        }

        output.push_str(&text[verse.start..verse.text_start]);
        push_word_scores(
            &mut output,
            &text[verse.text_start..verse.text_end],
            scan.profile,
            mode,
        );
        output.push(' ');
        output.push_str(&line_score(verse));
        output.push('\n');
    }

    output.trim_start().to_owned()
}

fn annotate_line_words(
    bytes: &[u8],
    text: &str,
    scan: &NumerologyScan,
    mode: WordValueMode,
) -> String {
    let mut by_start: HashMap<usize, &UnitSummary> = HashMap::new();
    for unit in scan.units.iter().filter(|unit| unit.kind == UnitKind::Line) {
        by_start.insert(unit.start, unit);
    }

    let mut output = String::with_capacity(text.len() * 3);
    for range in line_ranges(bytes) {
        push_word_scores(
            &mut output,
            &text[range.start..range.end],
            scan.profile,
            mode,
        );
        if let Some(unit) = by_start.get(&range.start) {
            output.push(' ');
            output.push_str(&line_score(unit));
        }
        output.push('\n');
    }
    output
}

fn push_word_scores(
    output: &mut String,
    text: &str,
    profile: NumerologyProfile,
    mode: WordValueMode,
) {
    let bytes = text.as_bytes();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        let word_start = match find_next_word_start(bytes, cursor) {
            Some(start) => start,
            None => {
                output.push_str(&text[cursor..]);
                break;
            }
        };
        output.push_str(&text[cursor..word_start]);
        let word_end = find_word_end(bytes, word_start);
        output.push_str(&text[word_start..word_end]);
        let stats = profile.score_bytes(&bytes[word_start..word_end]);
        output.push('[');
        match mode {
            WordValueMode::Raw => push_u64(output, stats.raw_value),
            WordValueMode::Reduced => push_u64(output, stats.reduced_value),
            WordValueMode::Both => {
                push_u64(output, stats.raw_value);
                output.push_str("->");
                push_u64(output, stats.reduced_value);
            }
        }
        output.push(']');
        cursor = word_end;
    }
}

fn find_next_word_start(bytes: &[u8], mut cursor: usize) -> Option<usize> {
    while cursor < bytes.len() {
        if bytes[cursor].is_ascii_alphabetic() {
            return Some(cursor);
        }
        cursor += utf8_char_width(bytes[cursor]).max(1);
    }
    None
}

fn find_word_end(bytes: &[u8], mut cursor: usize) -> usize {
    while cursor < bytes.len() {
        if bytes[cursor].is_ascii_alphabetic() {
            cursor += 1;
        } else if let Some(width) = apostrophe_connector_width(bytes, cursor) {
            cursor += width;
        } else {
            break;
        }
    }
    cursor
}

fn apostrophe_connector_width(bytes: &[u8], cursor: usize) -> Option<usize> {
    const ASCII: &[u8] = b"'";
    const CURLY_RIGHT: &[u8] = &[0xE2, 0x80, 0x99];
    const CURLY_LEFT: &[u8] = &[0xE2, 0x80, 0x98];
    const MOJIBAKE_RIGHT: &[u8] = "â€™".as_bytes();
    const MOJIBAKE_LEFT: &[u8] = "â€˜".as_bytes();

    for marker in [
        ASCII,
        CURLY_RIGHT,
        CURLY_LEFT,
        MOJIBAKE_RIGHT,
        MOJIBAKE_LEFT,
    ] {
        let end = cursor + marker.len();
        if end < bytes.len()
            && bytes[cursor..].starts_with(marker)
            && bytes[end].is_ascii_alphabetic()
        {
            return Some(marker.len());
        }
    }
    None
}

fn utf8_char_width(byte: u8) -> usize {
    if byte < 0x80 {
        1
    } else if byte >> 5 == 0b110 {
        2
    } else if byte >> 4 == 0b1110 {
        3
    } else if byte >> 3 == 0b11110 {
        4
    } else {
        1
    }
}

fn find_book<'a>(scan: &'a NumerologyScan, book: &str) -> Option<&'a UnitSummary> {
    scan.units
        .iter()
        .find(|unit| unit.kind == UnitKind::Book && unit.book.as_deref() == Some(book))
}

fn find_chapter<'a>(scan: &'a NumerologyScan, book: &str, chapter: u32) -> Option<&'a UnitSummary> {
    scan.units.iter().find(|unit| {
        unit.kind == UnitKind::Chapter
            && unit.book.as_deref() == Some(book)
            && unit.chapter == Some(chapter)
    })
}

fn inline_score(unit: &UnitSummary) -> String {
    format!(
        "[num raw:{} root:{} letters:{}]",
        unit.raw_value, unit.reduced_value, unit.ascii_letters
    )
}

fn line_score(unit: &UnitSummary) -> String {
    format!(
        "[line raw:{} root:{} letters:{}]",
        unit.raw_value, unit.reduced_value, unit.ascii_letters
    )
}

fn format_unit_line(unit: &UnitSummary) -> String {
    format!(
        "- {} raw={} reduced={} letters={} children={}\n",
        unit.label, unit.raw_value, unit.reduced_value, unit.ascii_letters, unit.child_count
    )
}

fn push_u64(output: &mut String, value: u64) {
    let mut buffer = itoa::Buffer::new();
    output.push_str(buffer.format(value));
}

fn push_kv(output: &mut String, key: &str, value: &str) {
    output.push_str(key);
    output.push_str(": ");
    output.push_str(value);
    output.push('\n');
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{NumerologyProfile, NumerologyProfileKind};
    use crate::scan::{scan_bytes, ScanOptions};

    #[test]
    fn annotates_bible_lines_with_inline_scores() {
        let input = b"Genesis 1:1\tGod made light\nGenesis 1:2\tLight remained\n";
        let scan = scan_bytes(
            input,
            ScanOptions {
                source_name: None,
                profile: NumerologyProfile::new(NumerologyProfileKind::NumeracalcCompatible),
            },
        )
        .expect("scan");

        let annotated = annotated_markdown(input, &scan).expect("annotated");

        assert!(annotated.contains("# Genesis [num raw:"));
        assert!(annotated.contains("Genesis 1:1\tGod made light [num raw:"));
    }

    #[test]
    fn annotates_each_word_with_its_raw_value() {
        let input = b"Genesis 1:1\tGod's made light\n";
        let scan = scan_bytes(input, ScanOptions::default()).expect("scan");

        let annotated = word_annotated_text(input, &scan).expect("word annotated");

        assert!(annotated.contains("Genesis 1:1\tGod's[17] made[14] light[16]"));
        assert!(annotated.contains("[line raw:47 root:2 letters:13]"));
    }

    #[test]
    fn annotates_each_word_with_reduced_values() {
        let input = b"Genesis 1:1\tGrace came\n";
        let scan = scan_bytes(
            input,
            ScanOptions {
                source_name: None,
                profile: NumerologyProfile::new(NumerologyProfileKind::BiblicalReducedOrdinal),
            },
        )
        .expect("scan");

        let annotated =
            word_annotated_text_with_mode(input, &scan, WordValueMode::Reduced).expect("annotated");

        assert!(annotated.contains("Genesis 1:1\tGrace[7] came[4]"));
        assert!(annotated.contains("[line raw:38 root:2 letters:9]"));
    }
}
