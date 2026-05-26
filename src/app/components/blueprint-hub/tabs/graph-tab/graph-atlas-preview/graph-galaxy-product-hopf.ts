const TAU = Math.PI * 2;

export interface ProductHopfFactorInfo {
    clusterId: string;
    lane: string;
    role: string;
    phase: number;
    medoidId?: string;
}

export interface ProductHopfVector {
    x: number;
    y: number;
    z: number;
}

export function normalizeProductHopfPhase(value: unknown, fallbackKey = ''): number {
    const number = Number(value);
    const raw = Number.isFinite(number)
        ? number
        : stableUnit(`product-hopf-phase:${fallbackKey || 'fallback'}`);
    const radians = Math.abs(raw) <= 1 ? raw * TAU : raw;
    return ((radians % TAU) + TAU) % TAU;
}

export function productHopfAgreement(left: ProductHopfFactorInfo, right: ProductHopfFactorInfo): number {
    let score = productHopfPhaseAgreement(left, right) * 0.72;
    if (left.clusterId === right.clusterId) score += 0.14;
    if (left.medoidId && left.medoidId === right.medoidId) score += 0.08;
    if (left.lane === right.lane) score += 0.06;
    return clamp(score, 0, 1);
}

export function productHopfPhaseAgreement(left: ProductHopfFactorInfo, right: ProductHopfFactorInfo): number {
    return 0.5 + Math.cos(productHopfPhaseDelta(left.phase, right.phase)) * 0.5;
}

export function productHopfTension(left: ProductHopfFactorInfo, right: ProductHopfFactorInfo): number {
    const phaseMismatch = 1 - productHopfPhaseAgreement(left, right);
    const laneMismatch = left.lane === right.lane ? 0 : 0.06;
    const roleMismatch = left.role === right.role ? 0 : 0.05;
    return clamp(phaseMismatch * 0.9 + laneMismatch + roleMismatch, 0, 1);
}

export function productHopfBraidDirection(left: ProductHopfFactorInfo, right: ProductHopfFactorInfo, key: string): ProductHopfVector {
    const phase = left.phase + signedPhaseDelta(left.phase, right.phase) * 0.5;
    const lanePhase = stableUnit(`product-hopf-lane:${left.lane}:${right.lane}:${key}`) * TAU;
    return normalize({
        x: Math.cos(phase) * 0.68 + Math.cos(lanePhase) * 0.24,
        y: Math.sin(phase * 0.5 + lanePhase) * 0.46,
        z: Math.sin(phase) * 0.68 + Math.sin(lanePhase) * 0.24,
    });
}

function productHopfPhaseDelta(left: number, right: number): number {
    return Math.abs(signedPhaseDelta(left, right));
}

function signedPhaseDelta(left: number, right: number): number {
    return Math.atan2(Math.sin(right - left), Math.cos(right - left));
}

function normalize(value: ProductHopfVector): ProductHopfVector {
    const length = Math.max(0.001, Math.hypot(value.x, value.y, value.z));
    return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function stableUnit(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return (hash >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
