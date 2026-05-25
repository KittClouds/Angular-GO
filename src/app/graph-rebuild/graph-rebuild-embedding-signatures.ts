import type {
    GraphIndexModelSelection,
    GraphRebuildEmbeddingProfile,
    GraphRebuildEmbeddingTarget,
} from './graph-rebuild-snapshot';

export interface SparseEmbeddingSignature {
    indexes: Uint32Array;
    values: Float32Array;
}

export function embeddingProfileFromModelSelection(
    selection: GraphIndexModelSelection,
): Partial<GraphRebuildEmbeddingProfile> {
    const nativeDimensions = dimensionsFromLabel(selection.embeddingDimensionLabel)
        || defaultNativeDimensions(selection.embeddingModelId);
    return {
        modelId: selection.embeddingModelId,
        modelLabel: selection.embeddingModelLabel || selection.embeddingModelId,
        modelFamily: modelFamily(selection.embeddingModelId),
        dimensionLabel: selection.embeddingDimensionLabel || `${nativeDimensions}d`,
        nativeDimensions,
        selectedDimensions: nativeDimensions,
        taskProfile: taskProfile(selection.embeddingModelId),
        vectorSource: 'signature-preview',
        normalized: true,
    };
}

export function normalizeEmbeddingProfile(
    profile: Partial<GraphRebuildEmbeddingProfile> | undefined,
): GraphRebuildEmbeddingProfile {
    const modelId = profile?.modelId || 'mongodb-leaf';
    const nativeDimensions = positiveInt(profile?.nativeDimensions)
        || dimensionsFromLabel(profile?.dimensionLabel)
        || defaultNativeDimensions(modelId);
    const selectedDimensions = positiveInt(profile?.selectedDimensions)
        || dimensionsFromLabel(profile?.dimensionLabel)
        || nativeDimensions;
    return {
        schemaVersion: 'phoenix-embedding-profile/v1',
        modelId,
        modelLabel: profile?.modelLabel || modelId,
        modelFamily: profile?.modelFamily || modelFamily(modelId),
        dimensionLabel: profile?.dimensionLabel || `${selectedDimensions}d`,
        nativeDimensions,
        selectedDimensions,
        taskProfile: profile?.taskProfile || taskProfile(modelId),
        vectorSource: profile?.vectorSource || 'signature-preview',
        normalized: profile?.normalized ?? true,
    };
}

export function embeddingTargetText(target: GraphRebuildEmbeddingTarget): string {
    return `${target.kind} ${target.entityKind || ''} ${target.label} ${target.text} ${target.noteId || ''} ${target.chunkId || ''}`;
}

export function sparseEmbeddingSignature(
    target: GraphRebuildEmbeddingTarget,
    dimensions: number,
): SparseEmbeddingSignature {
    const dim = Math.max(8, Math.floor(dimensions));
    const weights = new Map<number, number>();
    const tokens = embeddingTargetText(target).toLowerCase().match(/[a-z0-9_'-]+/g) || [target.id || 'graph'];
    for (const token of tokens) {
        const seed = hash(token);
        addWeight(weights, seed % dim, 1);
        addWeight(weights, (seed >>> 5) % dim, 0.5);
    }
    return sparseFromWeights(weights);
}

export function sparseToDenseVector(signature: SparseEmbeddingSignature, dimensions: number): Float32Array {
    const vector = new Float32Array(Math.max(8, Math.floor(dimensions)));
    for (let index = 0; index < signature.indexes.length; index += 1) {
        vector[signature.indexes[index]] = signature.values[index];
    }
    return vector;
}

export function sparseCosine(left: SparseEmbeddingSignature, right: SparseEmbeddingSignature): number {
    let i = 0;
    let j = 0;
    let dot = 0;
    while (i < left.indexes.length && j < right.indexes.length) {
        const a = left.indexes[i];
        const b = right.indexes[j];
        if (a === b) {
            dot += left.values[i] * right.values[j];
            i += 1;
            j += 1;
        } else if (a < b) {
            i += 1;
        } else {
            j += 1;
        }
    }
    return Math.max(0, Math.min(1, dot));
}

function sparseFromWeights(weights: Map<number, number>): SparseEmbeddingSignature {
    const entries = [...weights.entries()].sort((left, right) => left[0] - right[0]);
    let norm = 0;
    for (const [, value] of entries) norm += value * value;
    const inv = 1 / (Math.sqrt(norm) || 1);
    const indexes = new Uint32Array(entries.length);
    const values = new Float32Array(entries.length);
    for (let index = 0; index < entries.length; index += 1) {
        indexes[index] = entries[index][0];
        values[index] = entries[index][1] * inv;
    }
    return { indexes, values };
}

function addWeight(weights: Map<number, number>, index: number, weight: number): void {
    weights.set(index, (weights.get(index) || 0) + weight);
}

function dimensionsFromLabel(label: string | undefined): number {
    const match = String(label || '').match(/(\d+)/);
    return match ? positiveInt(Number(match[1])) : 0;
}

function defaultNativeDimensions(modelId: string): number {
    if (/jina.*v5/i.test(modelId)) return 768;
    return 384;
}

function modelFamily(modelId: string): string {
    if (/jina.*v5/i.test(modelId)) return 'jina-v5';
    if (/mdbr|mongodb.*leaf/i.test(modelId)) return 'mdbr-leaf';
    if (/bge/i.test(modelId)) return 'bge';
    return 'unknown';
}

function taskProfile(modelId: string): GraphRebuildEmbeddingProfile['taskProfile'] {
    if (/mdbr.*mt|leaf.*mt/i.test(modelId)) return 'multi_task';
    if (/ir|retrieval|bge/i.test(modelId)) return 'retrieval';
    if (/jina.*v5/i.test(modelId)) return 'semantic_topology';
    return 'unknown';
}

function positiveInt(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function hash(value: string): number {
    let out = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        out ^= value.charCodeAt(index);
        out = Math.imul(out, 16777619);
    }
    return out >>> 0;
}
