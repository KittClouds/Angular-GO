use memchr::memchr;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceFormat {
    BibleVerseLines,
    Markdown,
    PlainText,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BibleLineRef<'a> {
    pub book: &'a str,
    pub chapter: u32,
    pub verse: u32,
    pub line_start: usize,
    pub line_end: usize,
    pub text_start: usize,
    pub text_end: usize,
}

pub struct LineRanges<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> LineRanges<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }
}

impl Iterator for LineRanges<'_> {
    type Item = LineRange;

    fn next(&mut self) -> Option<Self::Item> {
        if self.cursor >= self.bytes.len() {
            return None;
        }

        let start = self.cursor;
        let remaining = &self.bytes[start..];
        let raw_end = match memchr(b'\n', remaining) {
            Some(offset) => start + offset,
            None => self.bytes.len(),
        };

        self.cursor = raw_end.saturating_add(1);
        let end = if raw_end > start && self.bytes[raw_end - 1] == b'\r' {
            raw_end - 1
        } else {
            raw_end
        };

        Some(LineRange { start, end })
    }
}

pub fn line_ranges(bytes: &[u8]) -> LineRanges<'_> {
    LineRanges::new(bytes)
}

pub fn parse_bible_verse_line<'a>(
    line: &'a str,
    absolute_start: usize,
) -> Option<BibleLineRef<'a>> {
    parse_bible_verse_span(
        line,
        LineRange {
            start: 0,
            end: line.len(),
        },
    )
    .map(|mut parsed| {
        parsed.line_start += absolute_start;
        parsed.line_end += absolute_start;
        parsed.text_start += absolute_start;
        parsed.text_end += absolute_start;
        parsed
    })
}

pub fn parse_bible_verse_span<'a>(text: &'a str, range: LineRange) -> Option<BibleLineRef<'a>> {
    let bytes = text.as_bytes();
    let line = &bytes[range.start..range.end];
    if let Some(tab) = memchr(b'\t', line) {
        let (label_start, label_end) = trim_ascii_range(line, 0, tab);
        let (book_start, book_end, chapter, verse) =
            parse_label_bytes(line, label_start, label_end)?;
        let body_start = skip_ascii_space(line, tab + 1);
        return Some(BibleLineRef {
            book: &text[range.start + book_start..range.start + book_end],
            chapter,
            verse,
            line_start: range.start,
            line_end: range.end,
            text_start: range.start + body_start,
            text_end: range.end,
        });
    }

    parse_unseparated_bible_span(text, range)
}

pub fn looks_like_markdown(bytes: &[u8], text: &str) -> bool {
    for range in line_ranges(bytes).take(64) {
        let line = text[range.start..range.end].trim_start();
        if line.starts_with("# ") || line.starts_with("## ") || line.starts_with("### ") {
            return true;
        }
    }
    false
}

fn parse_label_bytes(
    bytes: &[u8],
    label_start: usize,
    label_end: usize,
) -> Option<(usize, usize, u32, u32)> {
    let mut split = label_end;
    while split > label_start {
        split -= 1;
        if bytes[split].is_ascii_whitespace() {
            let (book_start, book_end) = trim_ascii_range(bytes, label_start, split);
            let (token_start, token_end) = trim_ascii_range(bytes, split + 1, label_end);
            let (chapter, verse) = parse_chapter_verse_bytes(&bytes[token_start..token_end])?;
            return (book_start < book_end).then_some((book_start, book_end, chapter, verse));
        }
    }
    None
}

fn parse_unseparated_bible_span<'a>(text: &'a str, range: LineRange) -> Option<BibleLineRef<'a>> {
    let line = &text[range.start..range.end];
    let mut cursor = 0usize;
    let bytes = line.as_bytes();

    while cursor < bytes.len() {
        cursor = skip_ascii_space(bytes, cursor);
        let word_start = cursor;
        while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let word_end = cursor;
        if word_start == word_end {
            break;
        }

        let token = &line[word_start..word_end];
        if let Some((chapter, verse)) = parse_chapter_verse_bytes(token.as_bytes()) {
            let book = line[..word_start].trim();
            if !book.is_empty() {
                let body_start = skip_ascii_space(bytes, word_end);
                return Some(BibleLineRef {
                    book,
                    chapter,
                    verse,
                    line_start: range.start,
                    line_end: range.end,
                    text_start: range.start + body_start,
                    text_end: range.end,
                });
            }
        }
    }

    None
}

fn parse_chapter_verse_bytes(token: &[u8]) -> Option<(u32, u32)> {
    let colon = memchr(b':', token)?;
    if colon == 0 || colon + 1 >= token.len() {
        return None;
    }

    let chapter = parse_ascii_u32(&token[..colon])?;
    let verse_end = trim_trailing_non_digit(token, colon + 1, token.len());
    let verse = parse_ascii_u32(&token[colon + 1..verse_end])?;
    Some((chapter, verse))
}

fn parse_ascii_u32(value: &[u8]) -> Option<u32> {
    let mut parsed = 0u32;
    for &byte in value {
        if !byte.is_ascii_digit() {
            return None;
        }
        parsed = parsed
            .checked_mul(10)?
            .checked_add(u32::from(byte - b'0'))?;
    }
    Some(parsed)
}

fn trim_ascii_range(bytes: &[u8], mut start: usize, mut end: usize) -> (usize, usize) {
    while start < end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    (start, end)
}

fn trim_trailing_non_digit(bytes: &[u8], start: usize, mut end: usize) -> usize {
    while end > start && !bytes[end - 1].is_ascii_digit() {
        end -= 1;
    }
    end
}

fn skip_ascii_space(bytes: &[u8], mut cursor: usize) -> usize {
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    cursor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tabbed_bible_verse_lines() {
        let line = "Genesis 1:1\tIn the beginning";
        let parsed = parse_bible_verse_line(line, 10).expect("verse ref");

        assert_eq!(parsed.book, "Genesis");
        assert_eq!(parsed.chapter, 1);
        assert_eq!(parsed.verse, 1);
        assert_eq!(parsed.text_start, 22);
        assert_eq!(parsed.text_end, 38);
    }

    #[test]
    fn parses_spaced_bible_verse_lines() {
        let line = "1 John 3:16 For God so loved";
        let parsed = parse_bible_verse_line(line, 0).expect("verse ref");

        assert_eq!(parsed.book, "1 John");
        assert_eq!(parsed.chapter, 3);
        assert_eq!(parsed.verse, 16);
        assert_eq!(
            &line[parsed.text_start..parsed.text_end],
            "For God so loved"
        );
    }

    #[test]
    fn line_ranges_trim_crlf_without_allocating() {
        let bytes = b"one\r\ntwo\nthree";
        let ranges: Vec<_> = line_ranges(bytes).collect();

        assert_eq!(ranges[0], LineRange { start: 0, end: 3 });
        assert_eq!(ranges[1], LineRange { start: 5, end: 8 });
        assert_eq!(ranges[2], LineRange { start: 9, end: 14 });
    }
}
