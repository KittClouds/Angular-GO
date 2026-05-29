import {
    HOPF_MANIFOLD_CAPABILITIES,
    HYBRID_MANIFOLD_CAPABILITIES,
    LORENTZ_MANIFOLD_CAPABILITIES,
    PRODUCT_MANIFOLD_CAPABILITIES,
    SIEGEL_FINSLER_CAPABILITIES,
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
import { createGraphModelV2ReadModel } from '../../../../../graph-rebuild/graph-model-v2-read-model';
import { buildGraphSignalTruthIndex, type GraphSignalTruthRecord } from '../../../../../graph-rebuild/graph-rebuild-signal-truth';
import type { GalaxyInputEdge, GalaxyRenderableNode } from './graph-galaxy-engine';
import type { EmbeddingAtlasData, EmbeddingAtlasSearchItem } from './graph-embedding-atlas';
import { relationFamilyFromText, relationHslFromText } from './graph-relation-visual-style';
import { entityColorStore } from '../../../../../lib/store/entityColorStore';

const VISIBLE_TARGET_LIMIT = 960;
const STORY_TARGET_BUDGET = 120;
const RELATION_TARGET_BUDGET = 96;
const CO_OCCURRENCE_TARGET_BUDGET = 48;
const HOPF_BASE_SPLIT_TARGET_LIMIT = 56;
const HOPF_BASE_SPLIT_MEMBER_LIMIT = 96;
const HOPF_SUBFIBER_TARGET_LIMIT = 28;
const STORY_TARGET_KINDS = new Set(['causalFact', 'temporalFact', 'event', 'memoryState']);

type HopfBaseAssignment = {
    rootBaseId: string;
    baseId: string;
    anchorTargetId?: string;
    splitKey?: string;
};

type TargetHierarchyContext = {
    noteId?: string;
    chunkId?: string;
    folderId?: string;
    folderLabel?: string;
    folderKind?: string;
    folderParentId?: string;
};

export function buildGraphRebuildEmbeddingAtlas(
    snapshot: GraphRebuildSnapshot,
    manifold: AtlasManifoldMode,
): EmbeddingAtlasData {
    const entityKindById = new Map(snapshot.nodes.map((node) => [node.entityId, node.kind]));
    const profile = normalizeEmbeddingProfile(snapshot.embeddingProfile);
    const postByTarget = new Map((snapshot.embeddingGraphPostProcess?.targets || []).map((row) => [row.targetId, row]));
    const selected = selectEmbeddingTargets(snapshot)
        .map((target) => hydrateTargetEntityKind(target, entityKindById));
    const hierarchyByTarget = buildTargetHierarchyContext(snapshot);
    const truthByTarget = buildGraphSignalTruthIndex(snapshot);
    const hopfBasePlan = manifold === 'hopf' ? buildHopfBasePlan(selected, postByTarget) : undefined;
    const vectors = selected.map((target) => textVector(target, profile.selectedDimensions));
    const nodes = selected.map((target, index) =>
        targetNode(target, vectors[index], index, selected.length, manifold, postByTarget.get(target.id), hopfBasePlan?.get(target.id), hierarchyByTarget.get(target.id), truthByTarget.get(target.id)),
    );
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
        nodes,
        edges: buildTargetEdges(snapshot).filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)),
        sourceLabel: `graph rebuild snapshot -> ${graphRebuildProjectionLabel(manifold)} projection`,
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
    if (candidates.length <= VISIBLE_TARGET_LIMIT) return candidates;

    const selected = new Map<string, GraphRebuildEmbeddingTarget>();
    const byId = new Map(candidates.map((target) => [target.id, target]));
    const temporalById = new Map([...snapshot.temporalEdges, ...snapshot.causalEdges].map((edge) => [edge.id, edge]));
    const relationshipById = new Map(snapshot.relationships.map((relationship) => [relationship.id, relationship]));
    const selectedRelationIds = new Set<string>();
    const add = (target?: GraphRebuildEmbeddingTarget) => {
        if (target && selected.size < VISIBLE_TARGET_LIMIT) selected.set(target.id, target);
    };
    const addGroup = (targets: Array<GraphRebuildEmbeddingTarget | undefined>) => {
        const missing = targets.filter((target): target is GraphRebuildEmbeddingTarget => !!target && !selected.has(target.id));
        if (selected.size + missing.length > VISIBLE_TARGET_LIMIT) return false;
        for (const target of missing) selected.set(target.id, target);
        return true;
    };
    const addLinkedEvents = (target: GraphRebuildEmbeddingTarget) => {
        if (target.kind !== 'temporalFact' && target.kind !== 'causalFact') return;
        const edge = temporalById.get(target.sourceId);
        if (!edge) return;
        add(byId.get(`embed:event:${edge.sourceId}`));
        add(byId.get(`embed:event:${edge.targetId}`));
    };
    const addLinkedRelationship = (target?: GraphRebuildEmbeddingTarget) => {
        if (!target || selectedRelationIds.has(target.id)) return;
        if (displayKind(target.kind) !== 'graph-fact') {
            if (addGroup([target])) selectedRelationIds.add(target.id);
            return;
        }
        const relationship = relationshipById.get(target.sourceId);
        const group = relationship ? [
            target,
            byId.get(`embed:entity:${relationship.sourceEntityId}`),
            byId.get(`embed:entity:${relationship.targetEntityId}`),
        ] : [target];
        if (addGroup(group)) selectedRelationIds.add(target.id);
    };

    const relationTargets = candidates.filter((candidate) => displayKind(candidate.kind) === 'graph-fact');
    const cooccurrenceTargets = relationTargets.filter((target) =>
        relationFamilyFromText(target.label, target.text, target.sourceId) === 'cooccurrence',
    );
    for (const target of evenSample(cooccurrenceTargets, CO_OCCURRENCE_TARGET_BUDGET)) {
        addLinkedRelationship(target);
    }
    for (const target of evenSample(candidates.filter((candidate) => STORY_TARGET_KINDS.has(candidate.kind)), STORY_TARGET_BUDGET)) {
        add(target);
        addLinkedEvents(target);
    }
    const relationBudgetLeft = Math.max(0, RELATION_TARGET_BUDGET - selectedRelationIds.size);
    for (const target of evenSample(relationTargets.filter((target) => !selectedRelationIds.has(target.id)), relationBudgetLeft)) {
        addLinkedRelationship(target);
    }
    for (const target of coverageOrderedTargets(candidates)) add(target);
    return [...selected.values()];
}

function coverageOrderedTargets(targets: GraphRebuildEmbeddingTarget[]): GraphRebuildEmbeddingTarget[] {
    const weight = (target: GraphRebuildEmbeddingTarget) => {
        switch (displayKind(target.kind)) {
            case 'note': return 900;
            case 'chunk': return 880;
            case 'causal-fact': return 860;
            case 'temporal-fact': return 850;
            case 'event': return 830;
            case 'memory-state': return 810;
            case 'graph-fact': return 790;
            case 'entity': return 760;
            case 'anchor': return 700;
            default: return 650;
        }
    };
    return [...targets].sort((left, right) =>
        weight(right) - weight(left)
        || targetEvidenceScore(right) - targetEvidenceScore(left)
        || left.id.localeCompare(right.id),
    );
}

function targetEvidenceScore(target: GraphRebuildEmbeddingTarget): number {
    const confidence = targetConfidence(target);
    const text = `${target.label} ${target.text}`.toLowerCase();
    let score = confidence * 100 + Math.min(48, target.evidenceIds.length * 6);
    if (text.includes('[accepted]')) score += 34;
    if (/causal|cause|because|before|after|temporal|memory_key|chunk_role|meaning_cues/.test(text)) score += 24;
    if (/evidence_context:/.test(text)) score += 16;
    return score;
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

function buildTargetHierarchyContext(snapshot: GraphRebuildSnapshot): Map<string, TargetHierarchyContext> {
    const contexts = new Map<string, TargetHierarchyContext>();
    const targetById = new Map(snapshot.embeddingTargets.map((target) => [target.id, target]));
    for (const noteId of snapshot.noteIds || []) {
        const context = targetHierarchyBase(targetById.get(`embed:note:${noteId}`), { noteId });
        contexts.set(`embed:note:${noteId}`, context);
        contexts.set(`embed:structure-root:${noteId}:document-structure`, targetHierarchyBase(targetById.get(`embed:structure-root:${noteId}:document-structure`), context));
        contexts.set(`embed:structure-root:${noteId}:identity`, targetHierarchyBase(targetById.get(`embed:structure-root:${noteId}:identity`), context));
        contexts.set(`embed:structure-root:${noteId}:temporal`, targetHierarchyBase(targetById.get(`embed:structure-root:${noteId}:temporal`), context));
        contexts.set(`embed:structure-root:${noteId}:causal`, targetHierarchyBase(targetById.get(`embed:structure-root:${noteId}:causal`), context));
        contexts.set(`embed:structure-root:${noteId}:evidence`, targetHierarchyBase(targetById.get(`embed:structure-root:${noteId}:evidence`), context));
    }
    for (const chunk of snapshot.chunks || []) {
        const fallback = contexts.get(`embed:note:${chunk.noteId}`) || { noteId: chunk.noteId };
        contexts.set(`embed:chunk:${chunk.id}`, targetHierarchyBase(targetById.get(`embed:chunk:${chunk.id}`), { ...fallback, chunkId: chunk.id }));
    }
    const entityContexts = new Map<string, { confidence: number; context: TargetHierarchyContext }>();
    for (const anchor of snapshot.entityAnchors || []) {
        const fallback = contexts.get(`embed:chunk:${anchor.chunkId}`) || contexts.get(`embed:note:${anchor.noteId}`) || { noteId: anchor.noteId };
        const context = targetHierarchyBase(targetById.get(`embed:anchor:${anchor.id}`), { ...fallback, noteId: anchor.noteId, chunkId: anchor.chunkId });
        contexts.set(`embed:anchor:${anchor.id}`, context);
        if (!anchor.entityId) continue;
        const existing = entityContexts.get(anchor.entityId);
        if (!existing || anchor.confidence > existing.confidence) {
            entityContexts.set(anchor.entityId, { confidence: anchor.confidence, context });
        }
    }
    for (const [entityId, value] of entityContexts) {
        contexts.set(`embed:entity:${entityId}`, value.context);
    }
    return contexts;
}

function targetHierarchyBase(
    target: GraphRebuildEmbeddingTarget | undefined,
    fallback: TargetHierarchyContext,
): TargetHierarchyContext {
    return {
        ...fallback,
        noteId: target?.noteId || fallback.noteId,
        chunkId: target?.chunkId || fallback.chunkId,
        folderId: target?.folderId || fallback.folderId,
        folderLabel: target?.folderLabel || fallback.folderLabel,
        folderKind: target?.folderKind || fallback.folderKind,
        folderParentId: target?.folderParentId || fallback.folderParentId,
    };
}

function targetNode(
    target: GraphRebuildEmbeddingTarget,
    vector: Float32Array,
    index: number,
    total: number,
    manifold: AtlasManifoldMode,
    post?: GraphRebuildEmbeddingTargetPostProcess,
    hopfBase?: HopfBaseAssignment,
    hierarchyContext?: TargetHierarchyContext,
    graphTruth?: GraphSignalTruthRecord,
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
            signalLane: target.lane,
            signalStructuralRole: target.structuralRole,
            signalAdmissionTier: target.admissionTier,
            signalAdmissionStatus: target.admissionStatus,
            signalAdmissionReason: target.admissionReason,
            signalParentIds: target.parentIds,
            graphTruth,
            graphTruthStatus: graphTruth?.status,
            graphTruthReason: graphTruth?.reason,
            graphTruthKind: graphTruth?.kind,
            targetConfidence: targetConfidence(target),
            noteId: target.noteId || hierarchyContext?.noteId,
            chunkId: target.chunkId || hierarchyContext?.chunkId,
            folderId: target.folderId || hierarchyContext?.folderId,
            folderLabel: target.folderLabel || hierarchyContext?.folderLabel,
            folderKind: target.folderKind || hierarchyContext?.folderKind,
            folderParentId: target.folderParentId || hierarchyContext?.folderParentId,
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
            siegel: manifold === 'siegel' ? graphRebuildSiegelMetadata(target, post, hierarchyContext) : undefined,
            lorentz: post ? productLorentzMetadata(target, point, post, hierarchyContext) : undefined,
            hopf: post ? graphRebuildHopfMetadata(target, post, manifold, hopfBase) : undefined,
            graphKind: targetRenderKind(target),
            graphRebuildEmbeddingTarget: true,
            manifold,
            preview: target.text || target.label,
        },
    };
}

function targetConfidence(target: GraphRebuildEmbeddingTarget): number {
    const match = target.text.match(/\bconfidence:([0-9.]+)/i);
    if (match) return clamp01(Number(match[1]));
    if (target.kind === 'entity') {
        const mentions = target.text.match(/\bmentions:(\d+)/i);
        const mentionCount = mentions ? Number(mentions[1]) : target.evidenceIds.length;
        return clamp01(0.68 + Math.min(0.24, Math.log1p(Math.max(0, mentionCount)) * 0.08));
    }
    if (target.kind === 'anchor') return 0.86;
    if (target.kind === 'chunk') return 0.78;
    return 0.62;
}

function graphRebuildSiegelMetadata(
    target: GraphRebuildEmbeddingTarget,
    post?: GraphRebuildEmbeddingTargetPostProcess,
    hierarchyContext?: TargetHierarchyContext,
): Record<string, unknown> {
    const lane = normalizeSiegelLane(target.lane, target.kind);
    const confidence = targetConfidence(target);
    const depth = siegelDepth(target, hierarchyContext);
    return {
        role: target.structuralRole || target.admissionStatus || 'signal',
        lane,
        depth,
        confidence,
        ambiguity: post?.outlierScore ?? (target.admissionStatus === 'deferred' ? 0.72 : 0),
        phase: unitHash(`${target.id}:siegel-phase`),
        matrixCells: siegelMatrixCells(target, lane, depth),
        parentIds: target.parentIds || [],
        directed: true,
    };
}

function graphRebuildHopfMetadata(
    target: GraphRebuildEmbeddingTarget,
    post: GraphRebuildEmbeddingTargetPostProcess,
    manifold: AtlasManifoldMode,
    assignment?: HopfBaseAssignment,
): Record<string, unknown> {
    const fiberKind = productFiberKind(post.clusterRole, post.productTopologyRegion.laneKind);
    if (manifold !== 'hopf') {
        return {
            role: 'anchor',
            baseId: target.id,
            fiberKind,
            phase: post.productLaneFeatures.fiberPhase,
        };
    }

    const baseId = assignment?.baseId || hopfRootBaseId(target, post);
    const role = target.id === (assignment?.anchorTargetId || baseId) ? 'anchor' : 'fiber';
    return {
        role,
        baseId,
        fiberKind,
        phase: role === 'anchor' ? 0 : stableHopfFiberPhase(target, post, assignment?.splitKey),
        clusterId: post.clusterId,
        medoidTargetId: post.medoidTargetId,
        regionId: post.productTopologyRegion.id,
        laneKind: post.productTopologyRegion.laneKind,
        rootBaseId: assignment?.rootBaseId,
        splitKey: assignment?.splitKey,
    };
}

function normalizeSiegelLane(lane: string | undefined, kind: string): string {
    const raw = String(lane || kind || '').toLowerCase();
    if (/document|chunk|spine|structure/.test(raw)) return 'document';
    if (/entity|anchor/.test(raw)) return 'entity';
    if (/relationship|cooccurrence/.test(raw)) return 'relationship';
    if (/temporal/.test(raw)) return 'temporal';
    if (/causal/.test(raw)) return 'causal';
    if (/memory|evidence/.test(raw)) return 'evidence';
    if (/event|story/.test(raw)) return 'event';
    return 'semantic';
}

function siegelDepth(target: GraphRebuildEmbeddingTarget, hierarchyContext?: TargetHierarchyContext): number {
    const kind = displayKind(target.kind);
    if (kind === 'note') return 0;
    if (kind === 'structure-root') return 1;
    if (kind === 'chunk') return 2;
    if (kind === 'entity') return 3;
    if (kind === 'anchor') return 4;
    if (hierarchyContext?.chunkId) return 4;
    return target.structuralRole === 'root' ? 1 : target.structuralRole === 'spine' ? 2 : 4;
}

function siegelMatrixCells(target: GraphRebuildEmbeddingTarget, lane: string, depth: number): number[] {
    const source = `${target.id}:${lane}:${depth}:${target.parentIds?.join('|') || ''}`;
    return Array.from({ length: 6 }, (_, index) => unitHash(`${source}:${index}`));
}

function buildHopfBasePlan(
    targets: GraphRebuildEmbeddingTarget[],
    postByTarget: Map<string, GraphRebuildEmbeddingTargetPostProcess>,
): Map<string, HopfBaseAssignment> {
    const byRoot = new Map<string, Array<{ target: GraphRebuildEmbeddingTarget; post: GraphRebuildEmbeddingTargetPostProcess }>>();
    for (const target of targets) {
        const post = postByTarget.get(target.id);
        if (!post) continue;
        const root = hopfRootBaseId(target, post);
        const bucket = byRoot.get(root) || [];
        bucket.push({ target, post });
        byRoot.set(root, bucket);
    }

    const plan = new Map<string, HopfBaseAssignment>();
    for (const [rootBaseId, entries] of byRoot) {
        const shouldSplit = entries.length > HOPF_BASE_SPLIT_TARGET_LIMIT
            || entries.some(({ post }) => post.productTopologyRegion.memberCount > HOPF_BASE_SPLIT_MEMBER_LIMIT);
        if (!shouldSplit) continue;

        const bySplitKey = new Map<string, typeof entries>();
        for (const entry of entries) {
            const coarseKey = hopfSemanticSubfiberKey(entry.target, entry.post);
            const bucket = bySplitKey.get(coarseKey) || [];
            bucket.push(entry);
            bySplitKey.set(coarseKey, bucket);
        }

        for (const [coarseKey, coarseEntries] of bySplitKey) {
            const shardCount = Math.max(1, Math.ceil(coarseEntries.length / HOPF_SUBFIBER_TARGET_LIMIT));
            const byShard = new Map<string, typeof entries>();
            for (const entry of coarseEntries) {
                const shard = shardCount > 1
                    ? Math.min(shardCount - 1, Math.floor(unitHash(`${coarseKey}:${entry.target.entityId || entry.target.noteId || entry.target.sourceId || entry.target.id}`) * shardCount))
                    : 0;
                const splitKey = shardCount > 1 ? `${coarseKey}:shard-${shard}` : coarseKey;
                const bucket = byShard.get(splitKey) || [];
                bucket.push(entry);
                byShard.set(splitKey, bucket);
            }

            for (const [splitKey, splitEntries] of byShard) {
                const anchorTargetId = hopfSubfiberAnchor(rootBaseId, splitEntries);
                const baseId = anchorTargetId === rootBaseId ? rootBaseId : `${rootBaseId}:hopf:${splitKey}`;
                for (const { target } of splitEntries) {
                    plan.set(target.id, { rootBaseId, baseId, anchorTargetId, splitKey });
                }
            }
        }
    }
    return plan;
}

function hopfRootBaseId(
    target: GraphRebuildEmbeddingTarget,
    post: GraphRebuildEmbeddingTargetPostProcess,
): string {
    return post.medoidTargetId || post.productTopologyRegion.medoidTargetId || post.clusterId || post.productTopologyRegion.id || target.id;
}

function hopfSubfiberAnchor(
    rootBaseId: string,
    entries: Array<{ target: GraphRebuildEmbeddingTarget; post: GraphRebuildEmbeddingTargetPostProcess }>,
): string {
    const root = entries.find(({ target }) => target.id === rootBaseId);
    if (root) return root.target.id;
    return [...entries]
        .sort((left, right) => right.post.hubScore - left.post.hubScore
            || right.post.neighborCount - left.post.neighborCount
            || left.target.id.localeCompare(right.target.id))[0]?.target.id || rootBaseId;
}

function hopfSemanticSubfiberKey(
    target: GraphRebuildEmbeddingTarget,
    post: GraphRebuildEmbeddingTargetPostProcess,
): string {
    const lane = post.productTopologyRegion.laneKind || post.productLaneFeatures.dominantLane;
    const kind = targetRenderKind(target);
    if (kind === 'graph-fact') return `relation:${relationFamilyFromText(target.label, target.text, target.sourceId)}`;
    if (target.kind === 'chunk') return `document:${target.noteId || target.chunkId || 'unknown'}`;
    if (target.kind === 'entity') return `entity:${normalizeHopfToken(target.entityKind || target.kind || 'entity')}`;
    if (target.entityId) return `${lane}:${kind}:entity-${normalizeHopfToken(target.entityId)}`;
    return `${lane}:${kind}`;
}

function stableHopfFiberPhase(
    target: GraphRebuildEmbeddingTarget,
    post: GraphRebuildEmbeddingTargetPostProcess,
    splitKey?: string,
): number {
    const raw = unitPhase(post.productLaneFeatures.fiberPhase);
    const lane = unitHash(`${post.clusterId}:${post.productTopologyRegion.laneKind}:hopf-lane`);
    const split = splitKey ? unitHash(`${post.clusterId}:${splitKey}:hopf-subfiber`) : 0;
    const order = unitHash(`${post.clusterId}:${post.productTopologyRegion.laneKind}:${target.id}:hopf-order`);
    return splitKey
        ? unitPhase(raw * 0.46 + lane * 0.14 + split * 0.16 + order * 0.24)
        : unitPhase(raw * 0.74 + lane * 0.18 + order * 0.08);
}

function productLorentzMetadata(
    target: GraphRebuildEmbeddingTarget,
    point: { x: number; y: number; z: number },
    post: GraphRebuildEmbeddingTargetPostProcess,
    hierarchyContext?: TargetHierarchyContext,
): Record<string, unknown> {
    const lane = post.productLaneFeatures;
    const region = post.productTopologyRegion;
    const radius = Math.max(0.001, Math.hypot(point.x, point.y, point.z));
    const depth = Math.max(0, Math.min(1, 1 - lane.semanticDepth));
    const scale = 0.22 + depth * 0.66;
    const treeKind = productFiberKind(post.clusterRole, region.laneKind);
    const parentNodeId = post.medoidTargetId && post.medoidTargetId !== target.id ? post.medoidTargetId : null;
    const capId = productCapId(target, region.id, hierarchyContext);
    const parentId = productCapParentId(target, parentNodeId, hierarchyContext);
    const level = productRegionLevel(target, post);
    const specificity = productHierarchySpecificity(target, post);
    const ambiguity = productHierarchyAmbiguity(post);
    return {
        geometry: 'hierarchy_caps_v1',
        klein: [
            (point.x / radius) * scale,
            (point.y / radius) * scale,
            (point.z / radius) * scale,
            lane.fiberPhase,
        ],
        capId,
        capDirection: [point.x / radius, point.y / radius, point.z / radius],
        capPhase: lane.fiberPhase,
        shellRadius: productCapShellRadius(target, specificity, ambiguity),
        parentNodeId: parentId,
        signalLane: target.lane,
        structuralRole: target.structuralRole,
        specificity,
        ambiguity,
        level,
        primaryTreeKind: treeKind,
        w: lane.clusterRadius,
        regionId: region.id,
        regionRole: region.role,
        dominantLane: region.laneKind,
        memberships: [{
            treeId: capId,
            treeKind,
            parentNodeId: parentId,
            level,
            pathKey: `${capId}/${parentId || 'root'}/${target.id}`,
        }, {
            treeId: `product-lane:${region.laneKind}`,
            treeKind: region.laneKind,
            parentNodeId: parentId,
            level,
            pathKey: `product-lane:${region.laneKind}/${post.clusterId}/${target.id}`,
        }],
    };
}

function productCapId(target: GraphRebuildEmbeddingTarget, fallback: string, hierarchyContext?: TargetHierarchyContext): string {
    const folderId = target.folderId || hierarchyContext?.folderId;
    if (folderId) return `folder:${folderId}`;
    const noteId = target.noteId || hierarchyContext?.noteId;
    if (noteId) return `document:${noteId}`;
    return fallback;
}

function productCapParentId(
    target: GraphRebuildEmbeddingTarget,
    fallback: string | null,
    hierarchyContext?: TargetHierarchyContext,
): string | null {
    const parents = target.parentIds || [];
    const noteId = target.noteId || hierarchyContext?.noteId;
    const chunkId = target.chunkId || hierarchyContext?.chunkId;
    const kind = displayKind(target.kind);
    if (kind === 'structure-root' && noteId) return `embed:note:${noteId}`;
    if (target.kind === 'chunk' && noteId) return firstParentWithPrefix(parents, `embed:structure-root:${noteId}:document-structure`) || `embed:note:${noteId}`;
    if (target.kind === 'entity' && chunkId) return `embed:chunk:${chunkId}`;
    if (target.kind === 'entity' && noteId) return firstParentWithPrefix(parents, `embed:structure-root:${noteId}:identity`) || `embed:note:${noteId}`;
    if (target.kind === 'anchor' && target.entityId) return `embed:entity:${target.entityId}`;
    if (target.kind === 'anchor' && chunkId) return `embed:chunk:${chunkId}`;
    if (parents.length) return parents[0];
    return fallback;
}

function productCapShellRadius(
    target: GraphRebuildEmbeddingTarget,
    specificity: number,
    ambiguity: number,
): number {
    const lane = target.lane || 'unknown';
    const kind = displayKind(target.kind);
    let radius = 1.28;
    if (lane === 'document_spine') radius = kind === 'note' ? 2.08 : kind === 'structure-root' ? 1.92 : 1.72;
    else if (lane === 'chunk_spine') radius = 1.66;
    else if (lane === 'entity_anchor') radius = 1.42;
    else if (lane === 'event_identity' || lane === 'temporal_fact' || lane === 'causal_fact') radius = 1.34;
    else if (lane === 'relationship_fact') radius = 1.3;
    else if (lane === 'memory_state') radius = 1.16;
    else if (lane === 'cooccurrence_weak') radius = 1.08;
    else if (lane === 'anchor_evidence') radius = 0.96;
    const confidence = targetConfidence(target);
    const confidenceDrop = lane === 'document_spine' ? 0.08 : 0.24;
    radius -= (1 - confidence) * confidenceDrop;
    radius += (specificity - 0.72) * 0.08;
    radius -= ambiguity * 0.08;
    const [min, max] = productCapShellBand(target);
    return clampRange(radius, min, max);
}

function productCapShellBand(target: GraphRebuildEmbeddingTarget): [number, number] {
    const lane = target.lane || 'unknown';
    const kind = displayKind(target.kind);
    if (lane === 'document_spine' && kind === 'note') return [2.02, 2.12];
    if (lane === 'document_spine' && kind === 'structure-root') return [1.86, 1.98];
    if (lane === 'document_spine' || lane === 'chunk_spine') return [1.56, 1.74];
    if (lane === 'entity_anchor') return [1.34, 1.52];
    if (lane === 'event_identity' || lane === 'temporal_fact' || lane === 'causal_fact') return [1.22, 1.48];
    if (lane === 'relationship_fact') return [1.18, 1.42];
    if (lane === 'memory_state') return [1.04, 1.28];
    if (lane === 'cooccurrence_weak') return [0.96, 1.2];
    if (lane === 'anchor_evidence') return [0.84, 1.08];
    return [0.54, 2.12];
}

function productHierarchySpecificity(
    target: GraphRebuildEmbeddingTarget,
    post: GraphRebuildEmbeddingTargetPostProcess,
): number {
    const kind = displayKind(target.kind);
    let base = 0.58;
    if (kind === 'note') base = 0.22;
    else if (kind === 'structure-root') base = 0.42;
    else if (kind === 'chunk' || kind === 'anchor') base = 0.9;
    else if (kind === 'entity') base = 0.82;
    else if (kind === 'event' || kind === 'temporal-fact' || kind === 'causal-fact') base = 0.74;
    else if (kind === 'graph-fact' || kind === 'memory-state') base = 0.64;
    const role = post.productTopologyRegion.role;
    const roleBoost = role === 'outlier' ? 0.14 : role === 'boundary' ? 0.08 : role === 'bridge' ? 0.05 : role === 'core' ? -0.04 : 0;
    return clamp01(base + roleBoost + post.productLaneFeatures.semanticDepth * 0.08);
}

function productHierarchyAmbiguity(post: GraphRebuildEmbeddingTargetPostProcess): number {
    const role = post.productTopologyRegion.role;
    const roleBoost = role === 'outlier' ? 0.22 : role === 'bridge' ? 0.12 : role === 'boundary' ? 0.08 : 0;
    return clamp01(post.productLaneFeatures.clusterRadius * 0.52 + post.outlierScore * 0.28 + roleBoost);
}

function productRegionLevel(target: GraphRebuildEmbeddingTarget, post: GraphRebuildEmbeddingTargetPostProcess): number {
    const kind = displayKind(target.kind);
    if (target.lane === 'document_spine' && kind === 'note') return 0;
    if (kind === 'structure-root') return 1;
    if (target.lane === 'document_spine' || target.lane === 'chunk_spine' || kind === 'chunk') return 2;
    if (target.lane === 'entity_anchor' || kind === 'entity') return 3;
    if (target.lane === 'anchor_evidence' || kind === 'anchor') return 4;
    if (target.lane === 'relationship_fact' || target.lane === 'event_identity' || target.lane === 'temporal_fact' || target.lane === 'causal_fact') return 3;
    if (target.lane === 'memory_state' || target.lane === 'cooccurrence_weak') return 4;
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
    const targetIds = new Set(snapshot.embeddingTargets.map((target) => target.id));
    for (const target of snapshot.embeddingTargets) {
        for (const parentId of target.parentIds || []) {
            if (targetIds.has(parentId)) add(`embed:target-parent:${parentId}:${target.id}`, parentId, target.id, 'target-parent', 0.88);
        }
    }
    for (const anchor of snapshot.entityAnchors) {
        if (anchor.chunkId) {
            add(`embed:chunk-anchor:${anchor.id}`, `embed:chunk:${anchor.chunkId}`, `embed:anchor:${anchor.id}`, 'chunk-anchor', anchor.confidence);
            add(`embed:chunk-entity:${anchor.chunkId}:${anchor.entityId}`, `embed:chunk:${anchor.chunkId}`, `embed:entity:${anchor.entityId}`, 'chunk-entity', anchor.confidence);
        }
        add(`embed:anchor-entity:${anchor.id}`, `embed:anchor:${anchor.id}`, `embed:entity:${anchor.entityId}`, 'anchor-entity', anchor.confidence);
    }
    const v2EdgesAdded = addGraphModelV2ProjectionEdges(snapshot, add);
    if (!v2EdgesAdded) {
        for (const edge of snapshot.edges) {
            add(`embed:graph-edge:${edge.id}`, `embed:entity:${edge.sourceId}`, `embed:entity:${edge.targetId}`, edge.type, edge.confidence);
        }
        for (const relationship of snapshot.relationships) {
            if (relationship.status === 'rejected') continue;
            const factId = `embed:graph-fact:${relationship.id}`;
            add(`embed:fact-source:${relationship.id}`, factId, `embed:entity:${relationship.sourceEntityId}`, relationship.relationType, relationship.confidence);
            add(`embed:fact-target:${relationship.id}`, factId, `embed:entity:${relationship.targetEntityId}`, relationship.relationType, relationship.confidence);
        }
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

function addGraphModelV2ProjectionEdges(
    snapshot: GraphRebuildSnapshot,
    add: (id: string, sourceId: string, targetId: string, type: string, confidence: number) => void,
): boolean {
    if (!snapshot.graphModelV2) return false;
    const readModel = createGraphModelV2ReadModel(snapshot.graphModelV2);
    let added = 0;
    for (const edge of readModel.model.projectionEdges) {
        if (edge.projectionKind === 'structure') continue;
        const sourceId = graphModelV2TargetToEmbeddingId(edge.sourceId);
        const targetId = graphModelV2TargetToEmbeddingId(edge.targetId);
        if (!sourceId || !targetId) continue;
        add(`embed:v2:${edge.id}`, sourceId, targetId, edge.edgeType.replace(/^role:/, ''), edge.confidence);
        added += 1;
    }
    return added > 0;
}

function graphModelV2TargetToEmbeddingId(targetId: string): string | null {
    const [prefix, kind, ...rest] = targetId.split(':');
    const sourceId = rest.join(':');
    if (!sourceId) return null;
    if (prefix === 'atom') {
        if (kind === 'document') return `embed:note:${sourceId}`;
        if (kind === 'chunk') return `embed:chunk:${sourceId}`;
        if (kind === 'evidence' || kind === 'sourceSpan') return `embed:anchor:${sourceId}`;
        if (kind === 'entity') return `embed:entity:${sourceId}`;
        if (kind === 'event') return `embed:event:${sourceId}`;
        if (kind === 'state') return `embed:memory:${sourceId}`;
    }
    if (prefix === 'fact') {
        if (kind === 'relationship') return `embed:graph-fact:${sourceId}`;
        if (kind === 'temporal') return `embed:temporalFact:${sourceId}`;
        if (kind === 'causal') return `embed:causalFact:${sourceId}`;
        if (kind === 'memory') return `embed:memory:${sourceId}`;
    }
    return null;
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
    const scale = manifold === 'hopf' ? 0.86 : manifold === 'lorentz' ? 1.22 : manifold === 'product' ? 1.08 : manifold === 'siegel' ? 1.12 : 1.48;
    return {
        x: (vector[0] * 0.9 + Math.cos(spiral) * radial) * scale,
        y: (vector[1] * 0.7 + y * 0.64) * scale,
        z: (vector[2] * 0.9 + Math.sin(spiral) * radial) * scale,
    };
}

function displayKind(kind: string): string {
    return String(kind || 'target').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function normalizeHopfToken(value: string): string {
    return String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
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
    if (kind === 'entity' && target.entityKind) {
        return entityColorStore.getRawHsl(target.entityKind.toUpperCase() as any);
    }
    return kindHsl(kind);
}

function kindHsl(kind: string): string {
    switch (displayKind(kind)) {
        case 'note': return entityColorStore.getRawGraphNodeHsl('document');
        case 'structure-root': return entityColorStore.getRawGraphNodeHsl('document');
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
    if (manifold === 'lorentz') return 'graph_rebuild_hierarchy_caps_v1';
    if (manifold === 'product') return 'graph_rebuild_product_lorentz_hopf_v1';
    if (manifold === 'siegel') return 'graph_rebuild_siegel_finsler_v1';
    return 'graph_rebuild_hybrid_v1';
}

function graphRebuildProjectionLabel(manifold: AtlasManifoldMode): string {
    if (manifold === 'lorentz') return 'hierarchy caps';
    if (manifold === 'siegel') return 'siegel-finsler';
    return manifold;
}

function graphRebuildCapabilities(manifold: AtlasManifoldMode): ManifoldCapabilities {
    if (manifold === 'hopf') return HOPF_MANIFOLD_CAPABILITIES;
    if (manifold === 'lorentz') return LORENTZ_MANIFOLD_CAPABILITIES;
    if (manifold === 'product') return PRODUCT_MANIFOLD_CAPABILITIES;
    if (manifold === 'siegel') return SIEGEL_FINSLER_CAPABILITIES;
    return HYBRID_MANIFOLD_CAPABILITIES;
}

function firstParentWithPrefix(parentIds: string[], prefix: string): string | null {
    return parentIds.find((parentId) => parentId.startsWith(prefix)) || null;
}

function unitHash(value: string): number {
    return hash(value) / 4294967295;
}

function unitPhase(value: number): number {
    const finite = Number.isFinite(value) ? value : 0;
    return ((finite % 1) + 1) % 1;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function hash(value: string): number {
    let out = 2166136261;
    for (let index = 0; index < value.length; index++) {
        out ^= value.charCodeAt(index);
        out = Math.imul(out, 16777619);
    }
    return out >>> 0;
}
