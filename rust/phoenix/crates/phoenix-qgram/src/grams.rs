pub type PackedGram = u32;

pub fn extract_packed_grams(normalized: &str, width: usize, output: &mut Vec<PackedGram>) {
    output.clear();
    if width == 0 || normalized.len() < width {
        return;
    }

    let bytes = normalized.as_bytes();
    for start in 0..=bytes.len() - width {
        if let Some(packed) = pack_ngram(&bytes[start..start + width]) {
            output.push(packed);
        }
    }
    output.sort_unstable();
    output.dedup();
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
        let mut trigrams = Vec::new();
        extract_packed_grams("banana", 3, &mut trigrams);
        let mut bigrams = Vec::new();
        extract_packed_grams("aa", 2, &mut bigrams);

        assert_eq!(trigrams.len(), 3);
        assert_eq!(bigrams.len(), 1);
    }
}
