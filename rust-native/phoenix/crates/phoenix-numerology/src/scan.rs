use crate::ids::{book_id, chapter_id, line_id, paragraph_id, slug, verse_id, verse_label};
use crate::profile::{NumberStats, NumerologyProfile};
use crate::segment::{line_ranges, looks_like_markdown, parse_bible_verse_span, SourceFormat};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScanOptions {
    pub source_name: Option<String>,
    pub profile: NumerologyProfile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitKind {
    Document,
    Book,
    Chapter,
    Paragraph,
    Line,
    Verse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitSummary {
    pub id: String,
    pub kind: UnitKind,
    pub label: String,
    pub book: Option<String>,
    pub chapter: Option<u32>,
    pub verse: Option<u32>,
    pub start: usize,
    pub end: usize,
    pub text_start: usize,
    pub text_end: usize,
    pub raw_value: u64,
    pub reduced_value: u64,
    pub ascii_letters: u32,
    pub digits: u32,
    pub child_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanTotals {
    pub bytes: usize,
    pub units: usize,
    pub books: usize,
    pub chapters: usize,
    pub verses: usize,
    pub paragraphs: usize,
    pub lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NumerologyScan {
    pub source_name: Option<String>,
    pub source_format: SourceFormat,
    pub profile: NumerologyProfile,
    pub totals: ScanTotals,
    pub document: UnitSummary,
    pub units: Vec<UnitSummary>,
}

#[derive(Debug)]
pub enum ScanError {
    InvalidUtf8(std::str::Utf8Error),
}

impl fmt::Display for ScanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUtf8(error) => write!(formatter, "input must be valid UTF-8: {error}"),
        }
    }
}

impl std::error::Error for ScanError {}

pub fn scan_bytes(bytes: &[u8], options: ScanOptions) -> Result<NumerologyScan, ScanError> {
    let text = std::str::from_utf8(bytes).map_err(ScanError::InvalidUtf8)?;
    if let Some(scan) = scan_bible(bytes, text, options.clone()) {
        return Ok(scan);
    }

    let format = if looks_like_markdown(bytes, text) {
        SourceFormat::Markdown
    } else {
        SourceFormat::PlainText
    };
    Ok(scan_plain(bytes, text, options, format))
}

fn scan_bible(bytes: &[u8], text: &str, options: ScanOptions) -> Option<NumerologyScan> {
    let mut units = Vec::with_capacity((bytes.len() / 96).clamp(128, 64_000));
    let mut document = Agg::open(0);
    let mut book: Option<BookAgg> = None;
    let mut chapter: Option<ChapterAgg> = None;
    let mut verse_count = 0usize;

    for range in line_ranges(bytes) {
        let Some(parsed) = parse_bible_verse_span(text, range) else {
            continue;
        };
        let record = VerseRecord {
            book: parsed.book,
            chapter: parsed.chapter,
            verse: parsed.verse,
            line_start: parsed.line_start,
            line_end: parsed.line_end,
            text_start: parsed.text_start,
            text_end: parsed.text_end,
            score: options
                .profile
                .score_bytes(&bytes[parsed.text_start..parsed.text_end]),
        };

        match (&mut book, &mut chapter) {
            (None, None) => {
                book = Some(BookAgg::new(&record));
                chapter = Some(ChapterAgg::new(&record));
            }
            (Some(current_book), Some(current_chapter))
                if current_book.book != record.book
                    || current_chapter.chapter != record.chapter =>
            {
                let finished_chapter = chapter
                    .take()
                    .expect("chapter exists while a book exists")
                    .finish(options.profile, &current_book.book, &current_book.slug);
                units.push(finished_chapter);

                if current_book.book != record.book {
                    let finished_book = book
                        .take()
                        .expect("book exists while a chapter exists")
                        .finish(options.profile);
                    units.push(finished_book);
                    book = Some(BookAgg::new(&record));
                }
                chapter = Some(ChapterAgg::new(&record));
            }
            _ => {}
        }

        if let Some(current_book) = &mut book {
            current_book.add(&record);
        }
        if let Some(current_chapter) = &mut chapter {
            current_chapter.add(&record);
        }
        document.add_record(&record);
        let book_slug = book
            .as_ref()
            .expect("book exists for verse unit")
            .slug
            .as_str();
        units.push(record.to_unit(book_slug));
        verse_count += 1;
    }

    if verse_count == 0 {
        return None;
    }

    if let Some(current_chapter) = chapter.take() {
        let current_book = book.as_ref().expect("book exists for final chapter");
        units.push(current_chapter.finish(options.profile, &current_book.book, &current_book.slug));
    }
    if let Some(current_book) = book.take() {
        units.push(current_book.finish(options.profile));
    }

    let document = document.to_unit(
        options.profile,
        UnitKind::Document,
        "document".to_owned(),
        "Document".to_owned(),
        (None, None, None),
    );
    let totals = totals(bytes.len(), &units);

    Some(NumerologyScan {
        source_name: options.source_name,
        source_format: SourceFormat::BibleVerseLines,
        profile: options.profile,
        totals,
        document,
        units,
    })
}

fn scan_plain(
    bytes: &[u8],
    text: &str,
    options: ScanOptions,
    source_format: SourceFormat,
) -> NumerologyScan {
    let mut units = Vec::new();
    let mut document = Agg::open(0);
    let mut paragraph: Option<Agg> = None;
    let mut paragraph_index = 0u32;
    let mut line_index = 0u32;

    for range in line_ranges(bytes) {
        let line = &text[range.start..range.end];
        if line.trim().is_empty() {
            if let Some(agg) = paragraph.take() {
                paragraph_index += 1;
                units.push(paragraph_unit(agg, options.profile, paragraph_index));
            }
            continue;
        }

        let score = options.profile.score_bytes(&bytes[range.start..range.end]);
        line_index += 1;
        let record = PlainRecord { range, score };
        document.add_plain(&record);
        paragraph
            .get_or_insert_with(|| Agg::open(range.start))
            .add_plain(&record);
        units.push(line_unit(&record, options.profile, line_index));
    }

    if let Some(agg) = paragraph.take() {
        paragraph_index += 1;
        units.push(paragraph_unit(agg, options.profile, paragraph_index));
    }

    let document = document.to_unit(
        options.profile,
        UnitKind::Document,
        "document".to_owned(),
        "Document".to_owned(),
        (None, None, None),
    );
    let totals = totals(bytes.len(), &units);

    NumerologyScan {
        source_name: options.source_name,
        source_format,
        profile: options.profile,
        totals,
        document,
        units,
    }
}

fn totals(bytes: usize, units: &[UnitSummary]) -> ScanTotals {
    ScanTotals {
        bytes,
        units: units.len(),
        books: units
            .iter()
            .filter(|unit| unit.kind == UnitKind::Book)
            .count(),
        chapters: units
            .iter()
            .filter(|unit| unit.kind == UnitKind::Chapter)
            .count(),
        verses: units
            .iter()
            .filter(|unit| unit.kind == UnitKind::Verse)
            .count(),
        paragraphs: units
            .iter()
            .filter(|unit| unit.kind == UnitKind::Paragraph)
            .count(),
        lines: units
            .iter()
            .filter(|unit| unit.kind == UnitKind::Line)
            .count(),
    }
}

#[derive(Debug, Clone)]
struct VerseRecord<'a> {
    book: &'a str,
    chapter: u32,
    verse: u32,
    line_start: usize,
    line_end: usize,
    text_start: usize,
    text_end: usize,
    score: NumberStats,
}

impl VerseRecord<'_> {
    fn to_unit(&self, book_slug: &str) -> UnitSummary {
        UnitSummary {
            id: verse_id(book_slug, self.chapter, self.verse),
            kind: UnitKind::Verse,
            label: verse_label(self.book, self.chapter, self.verse),
            book: Some(self.book.to_owned()),
            chapter: Some(self.chapter),
            verse: Some(self.verse),
            start: self.line_start,
            end: self.line_end,
            text_start: self.text_start,
            text_end: self.text_end,
            raw_value: self.score.raw_value,
            reduced_value: self.score.reduced_value,
            ascii_letters: self.score.ascii_letters,
            digits: self.score.digits,
            child_count: 0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct PlainRecord {
    range: crate::segment::LineRange,
    score: NumberStats,
}

#[derive(Debug, Clone)]
struct Agg {
    start: usize,
    end: usize,
    raw_value: u64,
    ascii_letters: u32,
    digits: u32,
    child_count: u32,
}

impl Agg {
    fn open(start: usize) -> Self {
        Self {
            start,
            end: start,
            raw_value: 0,
            ascii_letters: 0,
            digits: 0,
            child_count: 0,
        }
    }

    fn add_record(&mut self, record: &VerseRecord<'_>) {
        self.end = record.line_end;
        self.raw_value += record.score.raw_value;
        self.ascii_letters += record.score.ascii_letters;
        self.digits += record.score.digits;
        self.child_count += 1;
    }

    fn add_plain(&mut self, record: &PlainRecord) {
        self.end = record.range.end;
        self.raw_value += record.score.raw_value;
        self.ascii_letters += record.score.ascii_letters;
        self.digits += record.score.digits;
        self.child_count += 1;
    }

    fn to_unit(
        &self,
        profile: NumerologyProfile,
        kind: UnitKind,
        id: String,
        label: String,
        refs: UnitRefs,
    ) -> UnitSummary {
        let (book, chapter, verse) = refs;
        UnitSummary {
            id,
            kind,
            label,
            book,
            chapter,
            verse,
            start: self.start,
            end: self.end,
            text_start: self.start,
            text_end: self.end,
            raw_value: self.raw_value,
            reduced_value: profile.reduce_raw(self.raw_value),
            ascii_letters: self.ascii_letters,
            digits: self.digits,
            child_count: self.child_count,
        }
    }
}

struct BookAgg {
    book: String,
    slug: String,
    agg: Agg,
    chapter_count: u32,
    last_chapter: u32,
}

impl BookAgg {
    fn new(record: &VerseRecord<'_>) -> Self {
        Self {
            book: record.book.to_owned(),
            slug: slug(record.book),
            agg: Agg::open(record.line_start),
            chapter_count: 0,
            last_chapter: 0,
        }
    }

    fn add(&mut self, record: &VerseRecord<'_>) {
        if self.chapter_count == 0 || self.last_chapter != record.chapter {
            self.chapter_count += 1;
            self.last_chapter = record.chapter;
        }
        self.agg.add_record(record);
    }

    fn finish(self, profile: NumerologyProfile) -> UnitSummary {
        let mut unit = self.agg.to_unit(
            profile,
            UnitKind::Book,
            book_id(&self.slug),
            self.book.clone(),
            (Some(self.book), None, None),
        );
        unit.child_count = self.chapter_count;
        unit
    }
}

struct ChapterAgg {
    chapter: u32,
    agg: Agg,
}

impl ChapterAgg {
    fn new(record: &VerseRecord<'_>) -> Self {
        Self {
            chapter: record.chapter,
            agg: Agg::open(record.line_start),
        }
    }

    fn add(&mut self, record: &VerseRecord<'_>) {
        self.agg.add_record(record);
    }

    fn finish(self, profile: NumerologyProfile, book: &str, book_slug: &str) -> UnitSummary {
        self.agg.to_unit(
            profile,
            UnitKind::Chapter,
            chapter_id(book_slug, self.chapter),
            format!("{book} {}", self.chapter),
            (Some(book.to_owned()), Some(self.chapter), None),
        )
    }
}

fn line_unit(record: &PlainRecord, profile: NumerologyProfile, index: u32) -> UnitSummary {
    Agg {
        start: record.range.start,
        end: record.range.end,
        raw_value: record.score.raw_value,
        ascii_letters: record.score.ascii_letters,
        digits: record.score.digits,
        child_count: 0,
    }
    .to_unit(
        profile,
        UnitKind::Line,
        line_id(index),
        format!("Line {index}"),
        (None, None, None),
    )
}

fn paragraph_unit(agg: Agg, profile: NumerologyProfile, index: u32) -> UnitSummary {
    agg.to_unit(
        profile,
        UnitKind::Paragraph,
        paragraph_id(index),
        format!("Paragraph {index}"),
        (None, None, None),
    )
}

type UnitRefs = (Option<String>, Option<u32>, Option<u32>);
