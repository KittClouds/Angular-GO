use phoenix_numerology::{
    annotated_markdown, scan_bytes, DigitPolicy, NumerologyProfile, NumerologyProfileKind,
    ReductionMode, ScanOptions, UnitKind,
};

#[test]
fn bible_scan_groups_books_chapters_and_verses() {
    let input = b"YLT\nGenesis 1:1\tGod made light\nGenesis 1:2\tLight remained\nExodus 1:1\tNames arrived\n";
    let scan = scan_bytes(
        input,
        ScanOptions {
            source_name: Some("mini".to_owned()),
            profile: NumerologyProfile::new(NumerologyProfileKind::NumeracalcCompatible),
        },
    )
    .expect("scan");

    assert_eq!(scan.totals.books, 2);
    assert_eq!(scan.totals.chapters, 2);
    assert_eq!(scan.totals.verses, 3);
    assert_eq!(scan.totals.lines, 0);
    assert!(scan.document.raw_value > 0);
    assert!(scan.units.iter().any(|unit| unit.label == "Genesis 1"));
}

#[test]
fn plain_scan_preserves_line_and_paragraph_units() {
    let input = b"Alpha beta\n\nGamma delta\n";
    let scan = scan_bytes(
        input,
        ScanOptions {
            source_name: None,
            profile: NumerologyProfile {
                kind: NumerologyProfileKind::EnglishOrdinal,
                reduction: ReductionMode::DigitalRoot,
                digit_policy: DigitPolicy::Ignore,
            },
        },
    )
    .expect("scan");

    assert_eq!(scan.totals.lines, 2);
    assert_eq!(scan.totals.paragraphs, 2);
    assert!(scan.units.iter().any(|unit| unit.kind == UnitKind::Line));
}

#[test]
fn annotated_export_keeps_original_verse_refs() {
    let input = b"Genesis 1:1\tGod made light\n";
    let scan = scan_bytes(input, ScanOptions::default()).expect("scan");
    let annotated = annotated_markdown(input, &scan).expect("annotated");

    assert!(annotated.contains("Genesis 1:1\tGod made light [num raw:"));
}
