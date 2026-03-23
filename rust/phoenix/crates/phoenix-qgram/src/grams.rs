use rustc_hash::FxHashSet;

pub type PackedGram = u32;

pub fn extract_packed_grams(normalized: &str, width: usize) -> Vec<PackedGram> {
    if width == 0 || normalized.len() < width {
        return Vec::new();
    }

    let mut grams = FxHashSet::default();
    let bytes = normalized.as_bytes();
    for start in 0..=bytes.len() - width {
        if let Some(packed) = pack_ngram(&bytes[start..start + width]) {
            grams.insert(packed);
        }
    }
    let mut grams = grams.into_iter().collect::<Vec<_>>();
    grams.sort_unstable();
    grams
}

pub fn pack_ngram(bytes: &[u8]) -> Option<PackedGram> {
    match bytes.len() {
        2 => Some(((2_u32) << 24) | ((bytes[0] as u32) << 16) | ((bytes[1] as u32) << 8)),
        3 => Some(
            ((3_u32) << 24)
                | ((bytes[0] as u32) << 16)
                | ((bytes[1] as u32) << 8)
                | bytes[2] as u32,
        ),
        _ => None,
    }
}

pub fn unpack_ngram(packed: PackedGram) -> Vec<u8> {
    let width = (packed >> 24) as usize;
    match width {
        2 => vec![((packed >> 16) & 0xFF) as u8, ((packed >> 8) & 0xFF) as u8],
        3 => vec![
            ((packed >> 16) & 0xFF) as u8,
            ((packed >> 8) & 0xFF) as u8,
            (packed & 0xFF) as u8,
        ],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packed_grams_round_trip() {
        let packed = pack_ngram(b"pho").expect("packed");
        assert_eq!(unpack_ngram(packed), b"pho");
    }

    #[test]
    fn extracts_deduped_trigrams_and_bigrams() {
        let trigrams = extract_packed_grams("banana", 3);
        let bigrams = extract_packed_grams("aa", 2);

        assert_eq!(trigrams.len(), 3);
        assert_eq!(bigrams.len(), 1);
    }
}
