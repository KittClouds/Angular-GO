pub fn book_id(book_slug: &str) -> String {
    let mut out = String::with_capacity(5 + book_slug.len());
    out.push_str("book:");
    out.push_str(book_slug);
    out
}

pub fn chapter_id(book_slug: &str, chapter: u32) -> String {
    let mut out = String::with_capacity(9 + book_slug.len() + decimal_len(chapter));
    out.push_str("chapter:");
    out.push_str(book_slug);
    out.push(':');
    push_u32(&mut out, chapter);
    out
}

pub fn verse_id(book_slug: &str, chapter: u32, verse: u32) -> String {
    let mut out =
        String::with_capacity(7 + book_slug.len() + decimal_len(chapter) + decimal_len(verse));
    out.push_str("verse:");
    out.push_str(book_slug);
    out.push(':');
    push_u32(&mut out, chapter);
    out.push(':');
    push_u32(&mut out, verse);
    out
}

pub fn verse_label(book: &str, chapter: u32, verse: u32) -> String {
    let mut out = String::with_capacity(book.len() + 2 + decimal_len(chapter) + decimal_len(verse));
    out.push_str(book);
    out.push(' ');
    push_u32(&mut out, chapter);
    out.push(':');
    push_u32(&mut out, verse);
    out
}

pub fn line_id(index: u32) -> String {
    prefixed_u32("line:", index)
}

pub fn paragraph_id(index: u32) -> String {
    prefixed_u32("paragraph:", index)
}

pub fn slug(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        let lower = byte.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower as char);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_owned()
}

fn prefixed_u32(prefix: &str, value: u32) -> String {
    let mut out = String::with_capacity(prefix.len() + decimal_len(value));
    out.push_str(prefix);
    push_u32(&mut out, value);
    out
}

fn push_u32(out: &mut String, value: u32) {
    let mut buffer = itoa::Buffer::new();
    out.push_str(buffer.format(value));
}

fn decimal_len(value: u32) -> usize {
    if value < 10 {
        1
    } else if value < 100 {
        2
    } else if value < 1_000 {
        3
    } else if value < 10_000 {
        4
    } else if value < 100_000 {
        5
    } else if value < 1_000_000 {
        6
    } else if value < 10_000_000 {
        7
    } else if value < 100_000_000 {
        8
    } else if value < 1_000_000_000 {
        9
    } else {
        10
    }
}
