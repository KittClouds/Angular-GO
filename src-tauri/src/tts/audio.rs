use std::path::Path;

use hound::{SampleFormat, WavReader};

pub const SAMPLE_RATE: u32 = 24_000;

pub fn read_reference_wav(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = WavReader::open(path)
        .map_err(|error| format!("open reference WAV {}: {error}", path.display()))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let mut mono = Vec::with_capacity(reader.duration() as usize / channels.max(1));

    match (spec.sample_format, spec.bits_per_sample) {
        (SampleFormat::Float, 32) => {
            let mut frame_sum = 0.0f32;
            let mut frame_len = 0usize;
            for sample in reader.samples::<f32>() {
                frame_sum += sample.map_err(|error| format!("read float WAV sample: {error}"))?;
                frame_len += 1;
                if frame_len == channels {
                    mono.push(frame_sum / channels as f32);
                    frame_sum = 0.0;
                    frame_len = 0;
                }
            }
        }
        (SampleFormat::Int, bits) if bits <= 16 => {
            let scale = (1u32 << bits.saturating_sub(1)) as f32;
            push_int_samples(reader.samples::<i16>(), channels, scale, &mut mono)?;
        }
        (SampleFormat::Int, bits) if bits <= 32 => {
            let scale = (1u64 << bits.saturating_sub(1)) as f32;
            push_int_samples(reader.samples::<i32>(), channels, scale, &mut mono)?;
        }
        _ => {
            return Err(format!(
                "unsupported WAV format: {:?} {}-bit",
                spec.sample_format, spec.bits_per_sample
            ));
        }
    }

    if spec.sample_rate == SAMPLE_RATE {
        return Ok(mono);
    }
    Ok(resample_linear(&mono, spec.sample_rate, SAMPLE_RATE))
}

fn push_int_samples<I, T>(
    samples: I,
    channels: usize,
    scale: f32,
    mono: &mut Vec<f32>,
) -> Result<(), String>
where
    I: Iterator<Item = Result<T, hound::Error>>,
    T: Into<i32>,
{
    let mut frame_sum = 0.0f32;
    let mut frame_len = 0usize;
    for sample in samples {
        frame_sum += sample
            .map_err(|error| format!("read int WAV sample: {error}"))?
            .into() as f32
            / scale;
        frame_len += 1;
        if frame_len == channels {
            mono.push(frame_sum / channels as f32);
            frame_sum = 0.0;
            frame_len = 0;
        }
    }
    Ok(())
}

pub fn pcm_s16le(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let scaled = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        bytes.extend_from_slice(&scaled.to_le_bytes());
    }
    bytes
}

fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() || from_rate == 0 || from_rate == to_rate {
        return samples.to_vec();
    }
    let out_len = (samples.len() as u64 * to_rate as u64).div_ceil(from_rate as u64) as usize;
    let ratio = from_rate as f64 / to_rate as f64;
    let mut out = Vec::with_capacity(out_len);
    for index in 0..out_len {
        let source = index as f64 * ratio;
        let left = source.floor() as usize;
        let right = (left + 1).min(samples.len() - 1);
        let frac = (source - left as f64) as f32;
        out.push(samples[left] + (samples[right] - samples[left]) * frac);
    }
    out
}
