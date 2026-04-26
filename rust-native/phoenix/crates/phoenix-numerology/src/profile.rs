use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NumerologyProfileKind {
    NumeracalcCompatible,
    BiblicalReducedOrdinal,
    Pythagorean,
    EnglishOrdinal,
}

impl NumerologyProfileKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "numeracalc" | "numeracalc-compatible" | "chaldean" => Some(Self::NumeracalcCompatible),
            "biblical" | "biblical-reduced" | "biblical_reduced" | "reduced-ordinal"
            | "reduced_ordinal" | "ordinal-reduced" | "ordinal_reduced" => {
                Some(Self::BiblicalReducedOrdinal)
            }
            "pythagorean" | "pyth" => Some(Self::Pythagorean),
            "ordinal" | "english-ordinal" | "english" => Some(Self::EnglishOrdinal),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::NumeracalcCompatible => "numeracalc_compatible",
            Self::BiblicalReducedOrdinal => "biblical_reduced_ordinal",
            Self::Pythagorean => "pythagorean",
            Self::EnglishOrdinal => "english_ordinal",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReductionMode {
    None,
    DigitalRoot,
    MasterNumber,
}

impl ReductionMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "none" | "raw" => Some(Self::None),
            "root" | "digital-root" | "digital_root" => Some(Self::DigitalRoot),
            "master" | "master-number" | "master_number" => Some(Self::MasterNumber),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DigitPolicy {
    Ignore,
    IncludeValue,
}

impl DigitPolicy {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "ignore" | "off" => Some(Self::Ignore),
            "include" | "include-value" | "include_value" | "on" => Some(Self::IncludeValue),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct NumerologyProfile {
    pub kind: NumerologyProfileKind,
    pub reduction: ReductionMode,
    pub digit_policy: DigitPolicy,
}

impl NumerologyProfile {
    pub const fn new(kind: NumerologyProfileKind) -> Self {
        Self {
            kind,
            reduction: ReductionMode::DigitalRoot,
            digit_policy: DigitPolicy::Ignore,
        }
    }

    pub fn score_bytes(self, bytes: &[u8]) -> NumberStats {
        let mut raw_value = 0u64;
        let mut ascii_letters = 0u32;
        let mut digits = 0u32;
        let values = self.value_table();

        for &byte in bytes {
            let value = values[byte as usize];
            if value != 0 {
                raw_value += u64::from(value);
                ascii_letters += 1;
            } else if byte.is_ascii_digit() {
                digits += 1;
                if self.digit_policy == DigitPolicy::IncludeValue {
                    raw_value += u64::from(byte - b'0');
                }
            }
        }

        NumberStats {
            raw_value,
            reduced_value: reduce_number(raw_value, self.reduction),
            ascii_letters,
            digits,
        }
    }

    pub fn reduce_raw(self, raw_value: u64) -> u64 {
        reduce_number(raw_value, self.reduction)
    }

    pub fn letter_value(self, byte: u8) -> Option<u8> {
        let value = self.value_table()[byte as usize];
        (value != 0).then_some(value)
    }

    fn value_table(self) -> &'static [u8; 256] {
        match self.kind {
            NumerologyProfileKind::NumeracalcCompatible => &NUMERACALC_TABLE,
            NumerologyProfileKind::BiblicalReducedOrdinal => &PYTHAGOREAN_TABLE,
            NumerologyProfileKind::Pythagorean => &PYTHAGOREAN_TABLE,
            NumerologyProfileKind::EnglishOrdinal => &ENGLISH_ORDINAL_TABLE,
        }
    }
}

impl Default for NumerologyProfile {
    fn default() -> Self {
        Self::new(NumerologyProfileKind::NumeracalcCompatible)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct NumberStats {
    pub raw_value: u64,
    pub reduced_value: u64,
    pub ascii_letters: u32,
    pub digits: u32,
}

const NUMERACALC_VALUES: [u8; 26] = [
    1, 2, 3, 4, 5, 8, 3, 5, 1, 1, 2, 3, 4, 5, 7, 8, 1, 2, 3, 4, 6, 6, 6, 5, 1, 7,
];
const NUMERACALC_TABLE: [u8; 256] = make_table(NUMERACALC_VALUES);
const PYTHAGOREAN_TABLE: [u8; 256] = make_pythagorean_table();
const ENGLISH_ORDINAL_TABLE: [u8; 256] = make_ordinal_table();

const fn make_table(values: [u8; 26]) -> [u8; 256] {
    let mut table = [0u8; 256];
    let mut index = 0usize;
    while index < 26 {
        let value = values[index];
        table[b'a' as usize + index] = value;
        table[b'A' as usize + index] = value;
        index += 1;
    }
    table
}

const fn make_pythagorean_table() -> [u8; 256] {
    let mut values = [0u8; 26];
    let mut index = 0usize;
    while index < 26 {
        values[index] = (index as u8 % 9) + 1;
        index += 1;
    }
    make_table(values)
}

const fn make_ordinal_table() -> [u8; 256] {
    let mut values = [0u8; 26];
    let mut index = 0usize;
    while index < 26 {
        values[index] = index as u8 + 1;
        index += 1;
    }
    make_table(values)
}

fn reduce_number(value: u64, mode: ReductionMode) -> u64 {
    match mode {
        ReductionMode::None => value,
        ReductionMode::DigitalRoot => {
            if value == 0 {
                0
            } else {
                1 + ((value - 1) % 9)
            }
        }
        ReductionMode::MasterNumber => reduce_master_number(value),
    }
}

fn reduce_master_number(mut value: u64) -> u64 {
    while value >= 10 && value != 11 && value != 22 && value != 33 {
        value = digit_sum(value);
    }
    value
}

fn digit_sum(mut value: u64) -> u64 {
    let mut sum = 0u64;
    while value > 0 {
        sum += value % 10;
        value /= 10;
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeracalc_profile_scores_ascii_words() {
        let profile = NumerologyProfile::new(NumerologyProfileKind::NumeracalcCompatible);
        let score = profile.score_bytes(b"god");

        assert_eq!(score.raw_value, 14);
        assert_eq!(score.reduced_value, 5);
        assert_eq!(score.ascii_letters, 3);
    }

    #[test]
    fn pythagorean_profile_wraps_every_nine_letters() {
        let profile = NumerologyProfile::new(NumerologyProfileKind::Pythagorean);
        let score = profile.score_bytes(b"abcxyz");

        assert_eq!(score.raw_value, 27);
        assert_eq!(score.reduced_value, 9);
    }

    #[test]
    fn master_number_reduction_preserves_common_masters() {
        let profile = NumerologyProfile {
            kind: NumerologyProfileKind::EnglishOrdinal,
            reduction: ReductionMode::MasterNumber,
            digit_policy: DigitPolicy::Ignore,
        };

        assert_eq!(profile.score_bytes(b"abcdefghij").reduced_value, 1);
        assert_eq!(reduce_number(22, ReductionMode::MasterNumber), 22);
        assert_eq!(reduce_number(39, ReductionMode::MasterNumber), 3);
    }

    #[test]
    fn biblical_reduced_ordinal_matches_one_to_nine_cycle() {
        let profile = NumerologyProfile::new(NumerologyProfileKind::BiblicalReducedOrdinal);
        let score = profile.score_bytes(b"GRACE");

        assert_eq!(score.raw_value, 25);
        assert_eq!(score.reduced_value, 7);
    }
}
