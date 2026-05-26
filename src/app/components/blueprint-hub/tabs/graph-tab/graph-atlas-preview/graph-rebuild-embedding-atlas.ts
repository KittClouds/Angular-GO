import {
    HOPF_MANIFOLD_CAPABILITIES,
    HYBRID_MANIFOLD_CAPABILITIES,
    LORENTZ_MANIFOLD_CAPABILITIES,
    PRODUCT_MANIFOLD_CAPABILITIES,
    type AtlasManifoldMode,
    type ManifoldCapabilities,
} from '../../../../../services/manifold-atlas.types';
import type {
    GraphRebuildEmbeddingTargetPostProcess,
    GraphRebuildEmbeddingTarget,
    GraphRebuildSnapshot,
} from '../../../../../graph-rebuild/graph-rebuild-snapshot';
import {
    normalizeEmbeddingProfile,
    sparseEmbeddingSignature,
    sparseToDenseVector,
} from '../../../../../graph-rebuild/graph-rebuild-embedding-signatures';
import type { GalaxyInputEdge, GalaxyRenderableNode } from './graph-galaxy-engine';
import type { EmbeddingAtlasData, EmbeddingAtlasSearchItem } from './graph-embedding-atlas';
import { relationFamilyFromText, relationHslFromText } from './graph-relation-visual-style';
import { entityColorStore } from '../../../../../lib/store/entityColorStore';

const LIMIT = 420;
const STORY_TARGET_BUDGET = 120;
const STORY_TARGET_KINDS = new Set(['causalFact', 'temporalFact', 'event', 'memoryState']);

export function buildGraphRebuildEmbeddingAtlas(
    snapshot: GraphRebuildSnapshot,
    manifold: AtlasManifoldMode,
): EmbeddingAtlasData {
    const entityKindById = new Map(snapshot.nodes.map((node) => [node.entityId, node.kind]));
    const profile = normalizeEmbeddingProfile(snapshot.embeddingProfile);
    const postByTarget = new Map((snapshot.embeddingGraphPostProcess?.targets || []).map((row) => [row.targetId, row]));
    const selected = selectEmbeddingTargets(snapshot)
        .map((target) => hydrateTargetEntityKind(target, entityKindById));
    const vectors = selected.map((target) => textVector(target, profile.selectedDimensions));
    const nodes = selected.map((target, index) =>
        targetNode(target, vectors[index], index, selected.length, manifold, postByTarget.get(target.id)),
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

function selectEmbeddingTargets(snapshot: GraphRebuildSnapshot): GraphRebuildEmbeddingTarget[] {
    const candidates = snapshot.embeddingTargets.filter((target) => target.text.trim() || target.label.trim());
    if (candidates.length <= LIMIT) return candidates;

    const selected = new Map<string, GraphRebuildEmbeddingTarget>();
    const byId = new Map(candidates.map((target) => [target.id, target]));
    const temporalById = new Map([...snapshot.temporalEdges, ...snapshot.causalEdges].map((edge) => [edge.id, edge]));
    const add = (target?: GraphRebuildEmbeddingTarget) => {
        if (target && selected.size < LIMIT) selected.set(target.id, target);
    };
    const addLinkedEvents = (target: GraphRebuildEmbeddingTarget) => {
        if (target.kind !== 'temporalFact' && target.kind !== 'causalFact') return;
        const edge = temporalById.get(target.sourceId);
        if (!edge) return;
        add(byId.get(`embed:event:${edge.sourceId}`));
        add(byId.get(`embed:event:${edge.targetId}`));
    };

    for (const target of evenSample(candidates.filter((candidate) => STORY_TARGET_KINDS.has(candidate.kind)), STORY_TARGET_BUDGET)) {
        add(target);
        addLinkedEvents(target);
    }
    for (const target of candidates) add(target);
    return [...selected.values()];
}

function evenSample<T>(values: T[], limit: number): T[] {
    if (values.length <= limit) return values;
    if (limit <= 0) return [];
    const step = (values.length - 1) / Math.max(1, limit - 1);
    const out: T[] = [];
    for (let index = 0; index < limit; index += 1) out.push(values[Math.round(index * step)]);
    return out;
}

function hydrateTargetEntityKind(
    target: GraphRebuildEmbeddingTarget,
    entityKindById: Map<string, string>,
): GraphRebuildEmbeddingTarget {
    if (target.entityKind || !target.entityId) return target;
    const entityKind = entityKindById.get(target.entityId);
    return entityKind ? { ...target, entityKind } : target;
}

function targetNode(
    target: GraphRebuildEmbeddingTarget,
    vector: Float32Array,
    index: number,
    total: number,
    manifold: AtlasManifoldMode,
    post?: GraphRebuildEmbeddingTargetPostProcess,
): GalaxyRenderableNode {
    const point = projectVector(vector, target.id, index, total, manifold);
    const relationFamily = displayKind(target.kind) === 'graph-fact'
        ? relationFamilyFromText(target.label, target.text, target.sourceId)
        : null;
    return {
        id: target.id,
        label: target.label || target.id,
        kind: targetRenderKind(target),
        totalMentions: Math.max(1, target.evidenceIds.length),
        atlasX: point.x,
        atlasY: point.y,
        atlasZ: point.z,
        colorHsl: targetColorHsl(target),
        metadata: {
            sourceType: target.kind,
            sourceId: target.sourceId,
            entityKind: target.entityKind,
            graphColorKind: relationFamily || targetRenderKind(target),
            graphRelationFamily: relationFamily || undefined,
            noteId: target.noteId,
            chunkId: target.chunkId,
            sourceEntityId: target.entityId,
            embeddingClusterId: post?.clusterId,
            embeddingClusterRole: post?.clusterRole,
            embeddingMedoidTargetId: post?.medoidTargetId,
            embeddingOutlierScore: post?.outlierScore,
            embeddingHubScore: post?.hubScore,
            productRegionId: post?.productTopologyRegion.id,
            productRegionRole: post?.productTopologyRegion.role,
            productLaneKind: post?.productTopologyRegion.laneKind,
            productRegionConfidence: post?.productTopologyRegion.confidence,
            product: post ? {
                role: 'embeddingTarget',
                clusterId: post.clusterId,
                clusterRole: post.clusterRole,
                medoidTargetId: post.medoidTargetId,
                region: post.productTopologyRegion,
                dominantLane: post.productLaneFeatures.dominantLane,
                lanes: post.productLaneFeatures,
            } : undefined,
            lorentz: post ? productLorentzMetadata(target, point, post) : undefined,
            hopf: post ? {
                role: 'anchor',
                baseId: target.id,
                fiberKind: productFiberKind(post.clusterRole, post.productTopologyRegion.laneKind),
                phase: post.productLaneFeatures.fiberPhase,
            } : undefined,
            graphKind: targetRenderKind(target),
            graphRebuildEmbeddingTarget: true,
            manifold,
            preview: target.text || target.label,
        },
    };
}

function productLorentzMetadata(
    target: GraphRebuildEmbeddingTarget,
    point: { x: number; y: number; z: number },
    post: GraphRebuildEmbeddingTargetPostProcess,
): Record<string, unknown> {
    const lane = post.productLaneFeatures;
    const region = post.productTopologyRegion;
    const radius = Math.max(0.001, Math.hypot(point.x, point.y, point.z));
    const depth = Math.max(0, Math.min(1, 1 - lane.semanticDepth));
    const scale = 0.22 + depth * 0.66;
    const treeKind = productFiberKind(post.clusterRole, region.laneKind);
    const parentNodeId = post.medoidTargetId && post.medoidTargetId !== target.id ? post.medoidTargetId : null;
    const level = productRegionLevel(post);
    return {
        klein: [
            (point.x / radius) * scale,
            (point.y / radius) * scale,
            (point.z / radius) * scale,
            lane.fiberPhase,
        ],
        level,
        primaryTreeKind: treeKind,
        w: lane.clusterRadius,
        regionId: region.id,
        regionRole: region.role,
        dominantLane: region.laneKind,
        memberships: [{
            treeId: region.id,
            treeKind,
            parentNodeId,
            level,
            pathKey: `${region.id}/${parentNodeId || 'medoid'}/${target.id}`,
        }, {
            treeId: `product-lane:${region.laneKind}`,
            treeKind: region.laneKind,
            parentNodeId,
            level,
            pathKey: `product-lane:${region.laneKind}/${post.clusterId}/${target.id}`,
        }],
    };
}

function productRegionLevel(post: GraphRebuildEmbeddingTargetPostProcess): number {
    const role = post.productTopologyRegion.role;
    if (post.medoidTargetId === post.targetId && role === 'core') return 0;
    if (role === 'core') return 1;
    if (role === 'backbone') return 1;
    if (role === 'bridge') return 2;
    if (role === 'boundary') return 3;
    return 4;
}

function productFiberKind(role: string, laneKind?: string): string {
    if (laneKind === 'causal') return 'causal';
    if (laneKind === 'temporal') return 'timeline';
    if (laneKind === 'evidence') return 'evidence';
    if (laneKind === 'entity') return 'identity';
    if (laneKind === 'document') return 'documentStructure';
    if (laneKind === 'relation') return 'relationship';
    if (laneKind === 'semantic') return 'abstraction';
    if (role === 'document_region') return 'documentStructure';
    if (role === 'event_region') return 'event';
    if (role === 'fact_region') return 'relationship';
    if (role === 'entity_region') return 'identity';
    return 'abstraction';
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
    for (const edge of snapshot.embeddingGraphPostProcess?.backboneEdges || []) {
        add(edge.id, edge.sourceTargetId, edge.targetTargetId, `embedding-${edge.role}`, edge.score);
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

function textVector(target: GraphRebuildEmbeddingTarget, dimensions: number): Float32Array {
    return sparseToDenseVector(sparseEmbeddingSignature(target, dimensions), dimensions);
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
    const scale = manifold === 'hopf' ? 0.86 : manifold === 'lorentz' ? 1.22 : manifold === 'product' ? 1.08 : 1.48;
    return {
        x: (vector[0] * 0.9 + Math.cos(spiral) * radial) * scale,
        y: (vector[1] * 0.7 + y * 0.64) * scale,
        z: (vector[2] * 0.9 + Math.sin(spiral) * radial) * scale,
    };
}

function displayKind(kind: string): string {
    return String(kind || 'target').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function targetRenderKind(target: GraphRebuildEmbeddingTarget): string {
    if (displayKind(target.kind) === 'entity' && target.entityKind) {
        return displayKind(target.entityKind);
    }
    return displayKind(target.kind);
}

function targetColorHsl(target: GraphRebuildEmbeddingTarget): string {
    const kind = displayKind(target.kind);
    if (kind === 'graph-fact') {
        return relationHslFromText(target.label, target.text, target.sourceId) || kindHsl(kind);
    }
    if ((kind === 'entity' || kind === 'anchor') && target.entityKind) {
        return entityColorStore.getRawHsl(target.entityKind.toUpperCase() as any);
    }
    return kindHsl(kind);
}

function kindHsl(kind: string): string {
    switch (displayKind(kind)) {
        case 'note': return entityColorStore.getRawGraphNodeHsl('document');
        case 'chunk': return entityColorStore.getRawGraphNodeHsl('chunk');
        case 'entity': return '282 70% 62%';
        case 'anchor': return entityColorStore.getRawGraphNodeHsl('anchor');
        case 'graph-fact': return entityColorStore.getRawGraphNodeHsl('graphFact');
        case 'event': return entityColorStore.getRawGraphNodeHsl('eventNode');
        case 'temporal-fact': return entityColorStore.getRawGraphNodeHsl('temporalFact');
        case 'causal-fact': return entityColorStore.getRawGraphNodeHsl('causalFact');
        case 'memory-state': return entityColorStore.getRawGraphNodeHsl('memoryState');
        default: return '220 12% 58%';
    }
}

function graphRebuildGeometryVersion(manifold: AtlasManifoldMode): string {
    if (manifold === 'hopf') return 'graph_rebuild_hopf_v1';
    if (manifold === 'lorentz') return 'graph_rebuild_lorentz_v1';
    if (manifold === 'product') return 'graph_rebuild_product_lorentz_hopf_v1';
    return 'graph_rebuild_hybrid_v1';
}

function graphRebuildCapabilities(manifold: AtlasManifoldMode): ManifoldCapabilities {
    if (manifold === 'hopf') return HOPF_MANIFOLD_CAPABILITIES;
    if (manifold === 'lorentz') return LORENTZ_MANIFOLD_CAPABILITIES;
    if (manifold === 'product') return PRODUCT_MANIFOLD_CAPABILITIES;
    return HYBRID_MANIFOLD_CAPABILITIES;
}

function unitHash(value: string): number {
    return hash(value) / 4294967295;
}

function hash(value: string): number {
    let out = 2166136261;
    for (let index = 0; index < value.length; index++) {
        out ^= value.charCodeAt(index);
        out = Math.imul(out, 16777619);
    }
    return out >>> 0;
}
