use crate::export::WordValueMode;
use crate::profile::{NumberStats, NumerologyProfile};
use crate::scan::{NumerologyScan, UnitKind, UnitSummary};
use crate::segment::{line_ranges, SourceFormat};
use std::collections::HashMap;
use std::fmt;

#[derive(Debug)]
pub enum NumericExportError {
    InvalidUtf8(std::str::Utf8Error),
}

impl fmt::Display for NumericExportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUtf8(error) => write!(formatter, "input must be valid UTF-8: {error}"),
        }
    }
}

impl std::error::Error for NumericExportError {}

pub fn number_only_text_with_mode(
    bytes: &[u8],
    scan: &NumerologyScan,
    mode: WordValueMode,
) -> Result<String, NumericExportError> {
    let text = std::str::from_utf8(bytes).map_err(NumericExportError::InvalidUtf8)?;
    if scan.source_format == SourceFormat::BibleVerseLines {
        return Ok(number_bible(text, scan, mode));
    }
    Ok(number_lines(bytes, text, scan, mode))
}

fn number_bible(text: &str, scan: &NumerologyScan, mode: WordValueMode) -> String {
    let mut output = String::with_capacity(text.len() * 2);
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
                output.push_str(&format!("\n# {} {}\n", book, unit_score(book_unit, "book")));
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
                    unit_score(chapter_unit, "chapter")
                ));
            }
        }

        output.push_str(&text[verse.start..verse.text_start]);
        push_numeric_words(
            &mut output,
            &text[verse.text_start..verse.text_end],
            scan.profile,
            mode,
        );
        output.push(' ');
        output.push_str(&unit_score(verse, "line"));
        output.push('\n');
    }

    output.trim_start().to_owned()
}

fn number_lines(bytes: &[u8], text: &str, scan: &NumerologyScan, mode: WordValueMode) -> String {
    let mut by_start: HashMap<usize, &UnitSummary> = HashMap::new();
    for unit in scan.units.iter().filter(|unit| unit.kind == UnitKind::Line) {
        by_start.insert(unit.start, unit);
    }

    let mut output = String::with_capacity(text.len() * 2);
    for range in line_ranges(bytes) {
        push_numeric_words(
            &mut output,
            &text[range.start..range.end],
            scan.profile,
            mode,
        );
        if let Some(unit) = by_start.get(&range.start) {
            output.push(' ');
            output.push_str(&unit_score(unit, "line"));
        }
        output.push('\n');
    }
    output
}

fn push_numeric_words(
    output: &mut String,
    text: &str,
    profile: NumerologyProfile,
    mode: WordValueMode,
) {
    let bytes = text.as_bytes();
    let mut cursor = 0usize;
    let mut wrote_word = false;

    while cursor < bytes.len() {
        let word_start = match find_next_word_start(bytes, cursor) {
            Some(start) => start,
            None => break,
        };
        let word_end = find_word_end(bytes, word_start);
        if wrote_word {
            output.push(' ');
        }
        push_word_number(output, &bytes[word_start..word_end], profile, mode);
        wrote_word = true;
        cursor = word_end;
    }
}

fn push_word_number(
    output: &mut String,
    bytes: &[u8],
    profile: NumerologyProfile,
    mode: WordValueMode,
) {
    let mut stats = NumberStats {
        raw_value: 0,
        reduced_value: 0,
        ascii_letters: 0,
        digits: 0,
    };
    let mut wrote_letter = false;

    for &byte in bytes {
        let Some(value) = profile.letter_value(byte) else {
            continue;
        };
        if wrote_letter {
            output.push('-');
        }
        push_u64(output, u64::from(value));
        stats.raw_value += u64::from(value);
        stats.ascii_letters += 1;
        wrote_letter = true;
    }

    stats.reduced_value = profile.reduce_raw(stats.raw_value);
    output.push('[');
    push_value(output, stats, mode);
    output.push(']');
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
    const MOJIBAKE_RIGHT: &[u8] = "Ã¢â‚¬â„¢".as_bytes();
    const MOJIBAKE_LEFT: &[u8] = "Ã¢â‚¬Ëœ".as_bytes();

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

fn unit_score(unit: &UnitSummary, label: &str) -> String {
    format!(
        "[{} raw:{} root:{} letters:{}]",
        label, unit.raw_value, unit.reduced_value, unit.ascii_letters
    )
}

fn push_value(output: &mut String, stats: NumberStats, mode: WordValueMode) {
    match mode {
        WordValueMode::Raw => push_u64(output, stats.raw_value),
        WordValueMode::Reduced => push_u64(output, stats.reduced_value),
        WordValueMode::Both => {
            push_u64(output, stats.raw_value);
            output.push_str("->");
            push_u64(output, stats.reduced_value);
        }
    }
}

fn push_u64(output: &mut String, value: u64) {
    let mut buffer = itoa::Buffer::new();
    output.push_str(buffer.format(value));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{NumerologyProfile, NumerologyProfileKind};
    use crate::scan::{scan_bytes, ScanOptions};

    #[test]
    fn emits_numbers_only_for_bible_verses() {
        let input = b"Genesis 1:1\tGrace came\n";
        let scan = scan_bytes(
            input,
            ScanOptions {
                source_name: None,
                profile: NumerologyProfile::new(NumerologyProfileKind::BiblicalReducedOrdinal),
            },
        )
        .expect("scan");

        let output = number_only_text_with_mode(input, &scan, WordValueMode::Reduced)
            .expect("number export");

        assert!(output.contains("Genesis 1:1\t7-9-1-3-5[7] 3-1-4-5[4]"));
        assert!(output.contains("[line raw:38 root:2 letters:9]"));
    }

    #[test]
    fn supports_raw_and_reduced_totals_together() {
        let input = b"Genesis 1:1\tIn\n";
        let scan = scan_bytes(
            input,
            ScanOptions {
                source_name: None,
                profile: NumerologyProfile::new(NumerologyProfileKind::BiblicalReducedOrdinal),
            },
        )
        .expect("scan");

        let output =
            number_only_text_with_mode(input, &scan, WordValueMode::Both).expect("number export");

        assert!(output.contains("Genesis 1:1\t9-5[14->5]"));
    }
}
