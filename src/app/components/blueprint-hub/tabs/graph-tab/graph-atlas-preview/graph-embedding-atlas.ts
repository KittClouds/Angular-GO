import type { Note, NoteBlockProjection } from '../../../../../lib/dexie/db';
import type { GalaxyInputEdge, GalaxyRenderableNode } from './graph-galaxy-engine';

export interface EmbeddingAtlasData {
    nodes: GalaxyRenderableNode[];
    edges: GalaxyInputEdge[];
    sourceLabel: string;
    searchIndex: EmbeddingAtlasSearchItem[];
}

export interface EmbeddingAtlasSearchItem {
    nodeId: string;
    vector: Float32Array;
}

export interface EmbeddingSourcePreview {
    nodeId: string;
    label: string;
    score: number;
    sourceType: string;
    preview: string;
}

export interface EmbeddingQueryTrace {
    query: string;
    queryNode: GalaxyRenderableNode;
    primaryIds: string[];
    secondaryIds: string[];
    edgeIds: string[];
    edges: GalaxyInputEdge[];
    previews: EmbeddingSourcePreview[];
}

interface Signature {
    vector: Float32Array;
    tokens: number;
}

const DIMS = 32;
const COLORS = ['184 78% 58%', '198 78% 60%', '262 70% 62%', '172 68% 52%'];
const EMBEDDING_SHELL_RADIUS = 1.52;
const EMBEDDING_SHELL_SMALL_RADIUS = 1.08;

export function buildDocEmbeddingAtlas(notes: Note[], limit = 180, topK = 4): EmbeddingAtlasData {
    const selected = notes
        .filter((note) => noteText(note).trim().length > 0)
        .slice(0, limit);
    const signatures = selected.map((note) => textSignature(`${note.title}\n${noteText(note)}`));
    const nodes = selected.map((note, index) => {
        const signature = signatures[index];
        const point = projectSignature(signature.vector, note.id, index, selected.length);
        return {
            id: `embed:doc:${note.id}`,
            label: note.title || `Doc ${index + 1}`,
            kind: 'CONCEPT',
            totalMentions: Math.max(1, Math.round(signature.tokens / 220)),
            atlasX: point.x,
            atlasY: point.y,
            atlasZ: point.z,
            colorHsl: COLORS[index % COLORS.length],
            metadata: {
                sourceType: 'doc',
                sourceId: note.id,
                sourceTitle: note.title,
                tokenCount: signature.tokens,
                preview: previewText(noteText(note)),
            },
        } satisfies GalaxyRenderableNode;
    });
    return {
        nodes,
        edges: buildKnnEdges(nodes, signatures, topK),
        sourceLabel: 'doc vectors',
        searchIndex: buildSearchIndex(nodes, signatures),
    };
}

export function buildLeafEmbeddingAtlas(blocks: NoteBlockProjection[], limit = 220, topK = 4): EmbeddingAtlasData {
    const selected = blocks
        .filter((block) => block.text.trim().length > 0)
        .slice(0, limit);
    const signatures = selected.map((block) => textSignature(`${block.path}\n${block.text}`));
    const nodes = selected.map((block, index) => {
        const signature = signatures[index];
        const point = projectSignature(signature.vector, block.id, index, selected.length);
        return {
            id: `embed:leaf:${block.id}`,
            label: block.path || `Leaf ${index + 1}`,
            kind: 'CONCEPT',
            totalMentions: Math.max(1, Math.round(signature.tokens / 120)),
            atlasX: point.x,
            atlasY: point.y,
            atlasZ: point.z,
            colorHsl: COLORS[(index + 1) % COLORS.length],
            metadata: {
                sourceType: 'leaf',
                sourceId: block.id,
                noteId: block.noteId,
                tokenCount: signature.tokens,
                preview: previewText(block.text),
            },
        } satisfies GalaxyRenderableNode;
    });
    return {
        nodes,
        edges: buildKnnEdges(nodes, signatures, topK),
        sourceLabel: 'leaf vectors',
        searchIndex: buildSearchIndex(nodes, signatures),
    };
}

export function buildEmbeddingQueryTrace(query: string, atlas: EmbeddingAtlasData, topK = 6): EmbeddingQueryTrace | null {
    const text = query.trim();
    if (!text || atlas.searchIndex.length === 0) return null;
    const signature = textSignature(text);
    const scores = atlas.searchIndex
        .map((item) => ({ nodeId: item.nodeId, score: cosine(signature.vector, item.vector) }))
        .sort((a, b) => b.score - a.score);
    const primary = scores.slice(0, Math.min(topK, scores.length));
    const primaryIds = primary.map((item) => item.nodeId);
    const secondaryIds = multiHopIds(primaryIds, atlas.edges, 10);
    const queryId = `query:${hashToken(text).toString(16)}`;
    const queryPoint = projectSignature(signature.vector, queryId, 0, Math.max(1, atlas.nodes.length));
    const queryNode: GalaxyRenderableNode = {
        id: queryId,
        label: text.length > 28 ? `${text.slice(0, 27)}...` : text,
        kind: 'NETWORK',
        totalMentions: 18,
        atlasX: queryPoint.x,
        atlasY: queryPoint.y,
        atlasZ: queryPoint.z,
        colorHsl: '184 92% 62%',
        metadata: { sourceType: 'query', preview: text },
    };
    const directEdges = primary.map((item, index) => ({
        id: `${queryId}:direct:${item.nodeId}`,
        sourceId: queryId,
        targetId: item.nodeId,
        type: 'query-direct',
        confidence: Math.max(0.25, item.score * 3.2 + (topK - index) * 0.03),
    }));
    const hopEdges = atlas.edges
        .filter((edge) => isQueryHop(edge, primaryIds, secondaryIds))
        .slice(0, 14)
        .map((edge) => ({ ...edge, id: `${queryId}:hop:${edge.id}`, type: 'query-hop', confidence: edge.confidence * 0.8 }));
    const nodeById = new Map(atlas.nodes.map((node) => [node.id, node]));
    return {
        query: text,
        queryNode,
        primaryIds,
        secondaryIds,
        edgeIds: [...directEdges, ...hopEdges].map((edge) => edge.id),
        edges: [...directEdges, ...hopEdges],
        previews: primary.map((item) => sourcePreview(nodeById.get(item.nodeId), item.score)).filter(Boolean) as EmbeddingSourcePreview[],
    };
}

function noteText(note: Note): string {
    return note.markdownContent || note.content || note.title || '';
}

function previewText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function textSignature(text: string): Signature {
    const vector = new Float32Array(DIMS);
    let token = '';
    let tokens = 0;
    for (let index = 0; index <= text.length; index++) {
        const char = index < text.length ? text.charCodeAt(index) : 32;
        const normalized = normalizeChar(char);
        if (normalized) {
            token += normalized;
            continue;
        }
        if (token.length > 2) {
            addToken(vector, token);
            tokens++;
        }
        token = '';
    }
    normalize(vector);
    return { vector, tokens };
}

function normalizeChar(code: number): string {
    if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) return String.fromCharCode(code);
    return '';
}

function addToken(vector: Float32Array, token: string): void {
    const hash = hashToken(token);
    const first = hash % DIMS;
    const second = (hash >>> 7) % DIMS;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    const weight = 1 + Math.min(9, token.length) * 0.035;
    vector[first] += sign * weight;
    vector[second] += sign * weight * 0.5;
}

function hashToken(token: string): number {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index++) {
        hash ^= token.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function normalize(vector: Float32Array): void {
    let sum = 0;
    for (let index = 0; index < vector.length; index++) sum += vector[index] * vector[index];
    const scale = sum > 0 ? 1 / Math.sqrt(sum) : 1;
    for (let index = 0; index < vector.length; index++) vector[index] *= scale;
}

function projectSignature(vector: Float32Array, id: string, index: number, total: number): { x: number; y: number; z: number } {
    const seed = hashToken(id);
    const raw = projectVectorTo3d(vector, seed);
    const norm = Math.hypot(raw.x, raw.y, raw.z);
    const radius = total < 8 ? EMBEDDING_SHELL_SMALL_RADIUS : EMBEDDING_SHELL_RADIUS;
    if (!Number.isFinite(norm) || norm < 1e-8) {
        return fibonacciSpherePoint(index, Math.max(1, total), radius, seed);
    }

    return {
        x: radius * raw.x / norm,
        y: radius * raw.y / norm,
        z: radius * raw.z / norm,
    };
}

function projectVectorTo3d(vector: Float32Array, seed: number): { x: number; y: number; z: number } {
    const phase = seed / 4294967295;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let dim = 0; dim < vector.length; dim++) {
        const value = vector[dim];
        const n = dim + 1;
        x += value * Math.sin(n * 12.9898 + phase * 6.283185307179586);
        y += value * Math.cos(n * 78.233 + phase * 3.883222077450933);
        z += value * Math.sin(n * 37.719 + phase * 2.399963229728653);
    }
    return { x, y, z };
}

function fibonacciSpherePoint(index: number, total: number, radius: number, seed: number): { x: number; y: number; z: number } {
    const y = 1 - (index / Math.max(1, total - 1)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = (index + seed / 4294967295) * 2.399963229728653;
    return {
        x: Math.cos(angle) * radial * radius,
        y: y * radius,
        z: Math.sin(angle) * radial * radius,
    };
}

function buildKnnEdges(nodes: GalaxyRenderableNode[], signatures: Signature[], topK: number): GalaxyInputEdge[] {
    const seen = new Set<string>();
    const edges: GalaxyInputEdge[] = [];
    for (let source = 0; source < nodes.length; source++) {
        const candidates: Array<{ target: number; score: number }> = [];
        for (let target = 0; target < nodes.length; target++) {
            if (source === target) continue;
            candidates.push({ target, score: cosine(signatures[source].vector, signatures[target].vector) });
        }
        candidates.sort((a, b) => b.score - a.score);
        for (const candidate of candidates.slice(0, topK)) {
            if (candidate.score < 0.08 && edges.length > nodes.length) continue;
            const low = Math.min(source, candidate.target);
            const high = Math.max(source, candidate.target);
            const key = `${low}:${high}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({
                id: `embed:${nodes[low].id}:${nodes[high].id}`,
                sourceId: nodes[low].id,
                targetId: nodes[high].id,
                type: 'semantic-neighbor',
                confidence: Math.max(0.1, candidate.score * 3),
            });
        }
    }
    return edges;
}

function buildSearchIndex(nodes: GalaxyRenderableNode[], signatures: Signature[]): EmbeddingAtlasSearchItem[] {
    return nodes.map((node, index) => ({ nodeId: node.id, vector: signatures[index].vector }));
}

function multiHopIds(primaryIds: string[], edges: GalaxyInputEdge[], limit: number): string[] {
    const primary = new Set(primaryIds);
    const secondary: string[] = [];
    const seen = new Set(primaryIds);
    for (const edge of edges) {
        const next = primary.has(edge.sourceId) ? edge.targetId : primary.has(edge.targetId) ? edge.sourceId : '';
        if (!next || seen.has(next)) continue;
        seen.add(next);
        secondary.push(next);
        if (secondary.length >= limit) break;
    }
    return secondary;
}

function isQueryHop(edge: GalaxyInputEdge, primaryIds: string[], secondaryIds: string[]): boolean {
    const primary = new Set(primaryIds);
    const secondary = new Set(secondaryIds);
    return (primary.has(edge.sourceId) && secondary.has(edge.targetId)) || (primary.has(edge.targetId) && secondary.has(edge.sourceId));
}

function sourcePreview(node: GalaxyRenderableNode | undefined, score: number): EmbeddingSourcePreview | null {
    if (!node) return null;
    const metadata = node.metadata || {};
    return {
        nodeId: node.id,
        label: node.label,
        score,
        sourceType: String(metadata['sourceType'] || 'source'),
        preview: String(metadata['preview'] || ''),
    };
}

function cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let index = 0; index < a.length; index++) dot += a[index] * b[index];
    return Math.max(0, dot);
}
