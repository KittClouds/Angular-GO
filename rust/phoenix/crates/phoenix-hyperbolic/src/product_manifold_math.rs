const EPS: f32 = 1e-6;

pub(crate) fn normalize4(values: [f32; 4]) -> [f32; 4] {
    let norm = dot4(values, values).sqrt();
    if !norm.is_finite() || norm <= EPS {
        return [1.0, 0.0, 0.0, 0.0];
    }
    [
        values[0] / norm,
        values[1] / norm,
        values[2] / norm,
        values[3] / norm,
    ]
}

pub(crate) fn dot4(a: [f32; 4], b: [f32; 4]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

pub(crate) fn normalize3(values: [f32; 3]) -> [f32; 3] {
    let norm = (values[0] * values[0] + values[1] * values[1] + values[2] * values[2]).sqrt();
    if !norm.is_finite() || norm <= EPS {
        return [0.0, 1.0, 0.0];
    }
    [values[0] / norm, values[1] / norm, values[2] / norm]
}

pub(crate) fn stable_tangent(radial: [f32; 3], seed: f32) -> [f32; 3] {
    let basis = if radial[1].abs() < 0.82 {
        [0.0, 1.0, seed - 0.5]
    } else {
        [1.0, 0.0, seed - 0.5]
    };
    normalize3(cross(radial, normalize3(basis)))
}

pub(crate) fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub(crate) fn stable_unit(value: &str) -> f32 {
    stable_hash(value) as f32 / u64::MAX as f32
}

pub(crate) fn stable_signed_unit(value: &str, salt: u64) -> f32 {
    let mixed = stable_hash(&format!("{value}:{salt}")) as f32 / u64::MAX as f32;
    mixed * 2.0 - 1.0
}

pub(crate) fn stable_hash(value: &str) -> u64 {
    let mut hash = 1469598103934665603u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}
