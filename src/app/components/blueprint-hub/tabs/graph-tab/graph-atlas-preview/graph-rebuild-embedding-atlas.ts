import {
    HOPF_MANIFOLD_CAPABILITIES,
    HYBRID_MANIFOLD_CAPABILITIES,
    LORENTZ_MANIFOLD_CAPABILITIES,
    type AtlasManifoldMode,
    type ManifoldCapabilities,
} from '../../../../../services/manifold-atlas.types';
import type {
    GraphRebuildEmbeddingTarget,
    GraphRebuildSnapshot,
} from '../../../../../graph-rebuild/graph-rebuild-snapshot';
import type { GalaxyInputEdge, GalaxyRenderableNode } from './graph-galaxy-engine';
import type { EmbeddingAtlasData, EmbeddingAtlasSearchItem } from './graph-embedding-atlas';

const DIMS = 32;
const LIMIT = 420;

export function buildGraphRebuildEmbeddingAtlas(
    snapshot: GraphRebuildSnapshot,
    manifold: AtlasManifoldMode,
): EmbeddingAtlasData {
    const selected = snapshot.embeddingTargets
        .filter((target) => target.text.trim() || target.label.trim())
        .slice(0, LIMIT);
    const vectors = selected.map((target) => textVector(targetText(target)));
    const nodes = selected.map((target, index) =>
        targetNode(target, vectors[index], index, selected.length, manifold),
    );
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
        nodes,
        edges: buildTargetEdges(snapshot).filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)),
        sourceLabel: `graph rebuild snapshot -> ${manifold} projection`,
        searchIndex: nodes.map((node, index): EmbeddingAtlasSearchItem => ({
            nodeId: node.id,
            vector: vectors[index],
        })),
        manifold: {
            mode: manifold,
            geometryVersion: graphRebuildGeometryVersion(manifold),
            sourceLabel: 'graph rebuild snapshot',
            capabilities: graphRebuildCapabilities(manifold),
            projectionSource: 'graph_rebuild_embedding_targets',
            cells: [],
            charts: [],
            seams: [],
            neighborRings: [],
            coneTraces: [],
            anchorProjections: [],
        },
    };
}

function targetNode(
    target: GraphRebuildEmbeddingTarget,
    vector: Float32Array,
    index: number,
    total: number,
    manifold: AtlasManifoldMode,
): GalaxyRenderableNode {
    const point = projectVector(vector, target.id, index, total, manifold);
    return {
        id: target.id,
        label: target.label || target.id,
        kind: displayKind(target.kind),
        totalMentions: Math.max(1, target.evidenceIds.length),
        atlasX: point.x,
        atlasY: point.y,
        atlasZ: point.z,
        colorHsl: kindHsl(target.kind),
        metadata: {
            sourceType: target.kind,
            sourceId: target.sourceId,
            noteId: target.noteId,
            chunkId: target.chunkId,
            sourceEntityId: target.entityId,
            graphRebuildEmbeddingTarget: true,
            manifold,
            preview: target.text || target.label,
        },
    };
}

function buildTargetEdges(snapshot: GraphRebuildSnapshot): GalaxyInputEdge[] {
    const edges: GalaxyInputEdge[] = [];
    const add = (id: string, sourceId: string, targetId: string, type: string, confidence: number) => {
        if (sourceId === targetId) return;
        edges.push({ id, sourceId, targetId, type, confidence });
    };

    for (const chunk of snapshot.chunks) {
        add(`embed:note-chunk:${chunk.id}`, `embed:note:${chunk.noteId}`, `embed:chunk:${chunk.id}`, 'note-chunk', 0.9);
    }
    for (const anchor of snapshot.entityAnchors) {
        if (anchor.chunkId) {
            add(`embed:chunk-anchor:${anchor.id}`, `embed:chunk:${anchor.chunkId}`, `embed:anchor:${anchor.id}`, 'chunk-anchor', anchor.confidence);
        }
        add(`embed:anchor-entity:${anchor.id}`, `embed:anchor:${anchor.id}`, `embed:entity:${anchor.entityId}`, 'anchor-entity', anchor.confidence);
    }
    for (const edge of snapshot.edges) {
        add(`embed:graph-edge:${edge.id}`, `embed:entity:${edge.sourceId}`, `embed:entity:${edge.targetId}`, edge.type, edge.confidence);
    }
    for (const relationship of snapshot.relationships) {
        if (relationship.status === 'rejected') continue;
        const factId = `embed:graph-fact:${relationship.id}`;
        add(`embed:fact-source:${relationship.id}`, factId, `embed:entity:${relationship.sourceEntityId}`, relationship.relationType, relationship.confidence);
        add(`embed:fact-target:${relationship.id}`, factId, `embed:entity:${relationship.targetEntityId}`, relationship.relationType, relationship.confidence);
    }
    for (const event of snapshot.events) {
        const eventId = `embed:event:${event.id}`;
        if (event.chunkId) add(`embed:event-chunk:${event.id}`, eventId, `embed:chunk:${event.chunkId}`, 'event-chunk', event.confidence);
        for (const entityId of event.entityIds) add(`embed:event-entity:${event.id}:${entityId}`, eventId, `embed:entity:${entityId}`, 'event-entity', event.confidence);
    }
    for (const edge of snapshot.temporalEdges) {
        add(`embed:temporal:${edge.id}`, `embed:temporalFact:${edge.id}`, `embed:event:${edge.sourceId}`, edge.relationType, edge.confidence);
        add(`embed:temporal-target:${edge.id}`, `embed:temporalFact:${edge.id}`, `embed:event:${edge.targetId}`, edge.relationType, edge.confidence);
    }
    for (const edge of snapshot.causalEdges) {
        add(`embed:causal:${edge.id}`, `embed:causalFact:${edge.id}`, `embed:event:${edge.sourceId}`, edge.relationType, edge.confidence);
        add(`embed:causal-target:${edge.id}`, `embed:causalFact:${edge.id}`, `embed:event:${edge.targetId}`, edge.relationType, edge.confidence);
    }
    for (const state of snapshot.memoryState) {
        add(`embed:memory-entity:${state.id}`, `embed:memory:${state.id}`, `embed:entity:${state.entityId}`, 'memory-entity', 0.72);
    }
    return dedupeEdges(edges);
}

function dedupeEdges(edges: GalaxyInputEdge[]): GalaxyInputEdge[] {
    const seen = new Set<string>();
    return edges.filter((edge) => {
        const key = `${edge.sourceId}|${edge.targetId}|${edge.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function targetText(target: GraphRebuildEmbeddingTarget): string {
    return `${target.kind} ${target.label} ${target.text} ${target.noteId || ''} ${target.chunkId || ''}`;
}

function textVector(text: string): Float32Array {
    const vector = new Float32Array(DIMS);
    const tokens = text.toLowerCase().match(/[a-z0-9_'-]+/g) || [text || 'graph'];
    for (const token of tokens) {
        const seed = hash(token);
        vector[seed % DIMS] += 1;
        vector[(seed >>> 5) % DIMS] += 0.5;
    }
    normalize(vector);
    return vector;
}

function projectVector(
    vector: Float32Array,
    id: string,
    index: number,
    total: number,
    manifold: AtlasManifoldMode,
): { x: number; y: number; z: number } {
    const spiral = index * 2.399963229728653 + unitHash(id);
    const y = total > 1 ? 1 - (index / (total - 1)) * 2 : 0;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const scale = manifold === 'hopf' ? 0.86 : manifold === 'lorentz' ? 1.22 : 1.48;
    return {
        x: (vector[0] * 0.9 + Math.cos(spiral) * radial) * scale,
        y: (vector[1] * 0.7 + y * 0.64) * scale,
        z: (vector[2] * 0.9 + Math.sin(spiral) * radial) * scale,
    };
}

function normalize(vector: Float32Array): void {
    let sum = 0;
    for (const value of vector) sum += value * value;
    const norm = Math.sqrt(sum) || 1;
    for (let index = 0; index < vector.length; index++) vector[index] /= norm;
}

function displayKind(kind: string): string {
    return String(kind || 'target').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function kindHsl(kind: string): string {
    switch (displayKind(kind)) {
        case 'note': return '210 82% 58%';
        case 'chunk': return '176 70% 46%';
        case 'entity': return '282 70% 62%';
        case 'anchor': return '262 78% 66%';
        case 'graph-fact': return '38 92% 57%';
        case 'event': return '24 92% 58%';
        case 'temporal-fact': return '199 80% 58%';
        case 'causal-fact': return '345 82% 61%';
        case 'memory-state': return '145 70% 50%';
        default: return '220 12% 58%';
    }
}

function graphRebuildGeometryVersion(manifold: AtlasManifoldMode): string {
    if (manifold === 'hopf') return 'graph_rebuild_hopf_v1';
    if (manifold === 'lorentz') return 'graph_rebuild_lorentz_v1';
    return 'graph_rebuild_hybrid_v1';
}

function graphRebuildCapabilities(manifold: AtlasManifoldMode): ManifoldCapabilities {
    if (manifold === 'hopf') return HOPF_MANIFOLD_CAPABILITIES;
    if (manifold === 'lorentz') return LORENTZ_MANIFOLD_CAPABILITIES;
    return HYBRID_MANIFOLD_CAPABILITIES;
}

function hash(value: string): number {
    let out = 2166136261;
    for (let index = 0; index < value.length; index++) {
        out ^= value.charCodeAt(index);
        out = Math.imul(out, 16777619);
    }
    return out >>> 0;
}

function unitHash(value: string): number {
    return hash(value) / 4294967295;
}
