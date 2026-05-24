import type {
    LorentzMembershipRecord,
    LorentzTreeKind,
    LorentzTreeRecord,
    ManifoldAtlasSnapshot,
} from '../../../../../services/manifold-atlas.types';
import type { SemanticAtlasEmbeddingAtlas, SemanticAtlasEmbeddingNode } from '../../../../../services/phoenix-ui-api.service';
import type { EmbeddingAtlasData, EmbeddingAtlasSearchItem } from './graph-embedding-atlas';
import type { GalaxyInputEdge, GalaxyRenderableNode } from './graph-galaxy-engine';
import { GRAPH_RELATION_FAMILY_HSL } from './graph-relation-visual-style';

export interface LorentzKleinProjection {
    coords: [number, number, number, number, number];
    klein: [number, number, number, number];
    radius: number;
    valid: boolean;
}

interface LorentzMembershipView extends LorentzMembershipRecord {
    treeKind: LorentzTreeKind | string;
    treeLabel: string;
}

const KLEIN_BOUND = 0.96;
const KLEIN_SCENE_RADIUS = 2.18;
const LORENTZ_SEARCH_DIMS = 8;

export const LORENTZ_TREE_KIND_COLORS: Record<string, string> = {
    identity: '188 80% 66%',
    relationship: '326 76% 66%',
    location: '166 66% 58%',
    event: '42 88% 62%',
    temporal: '260 76% 68%',
    causal: '24 82% 62%',
    mechanical: '206 76% 62%',
    emotional: '318 74% 66%',
    political: '356 72% 62%',
    evidence: '136 70% 62%',
    provenance: '92 58% 60%',
    contradiction: '2 86% 65%',
    abstraction: '228 66% 66%',
    species: '286 64% 66%',
    powerSystem: '292 80% 66%',
    documentStructure: '214 78% 62%',
    ...GRAPH_RELATION_FAMILY_HSL,
};

export function projectLorentzKlein(values: readonly number[]): LorentzKleinProjection {
    const coords = lorentzCoordsFromVector(values);
    const t = Math.max(1, Math.abs(coords[0]));
    let kx = coords[1] / t;
    let ky = coords[2] / t;
    let kz = coords[3] / t;
    let kw = coords[4] / t;
    const radius4 = Math.hypot(kx, ky, kz, kw);
    if (!Number.isFinite(radius4) || radius4 <= 1e-8) {
        return { coords, klein: [0, 0, 0, 0], radius: 0, valid: true };
    }
    const scale = radius4 > KLEIN_BOUND ? KLEIN_BOUND / radius4 : 1;
    kx *= scale;
    ky *= scale;
    kz *= scale;
    kw *= scale;
    const radius = Math.hypot(kx, ky, kz, kw);
    return { coords, klein: [kx, ky, kz, kw], radius, valid: isValidLorentzPoint(coords) };
}

export function buildLorentzAtlas(snapshot: ManifoldAtlasSnapshot<SemanticAtlasEmbeddingAtlas>): EmbeddingAtlasData {
    const payload = snapshot.payload;
    const selected = payload.nodes
        .filter((node) => Array.isArray(node.vector) && node.vector.length > 0)
        .slice(0, 360)
        .sort((left, right) => left.id.localeCompare(right.id));
    const nodeIds = new Set(selected.map((node) => node.id));
    const trees = normalizeTrees(payload.lorentzTrees, selected, snapshot.geometryVersion);
    const memberships = normalizeMemberships(payload.lorentzMemberships, trees, selected, snapshot.geometryVersion);
    const treeById = new Map(trees.map((tree) => [tree.treeId, tree]));
    const membershipByNode = new Map<string, LorentzMembershipView[]>();
    for (const membership of memberships) {
        if (!nodeIds.has(membership.nodeId)) continue;
        const tree = treeById.get(membership.treeId);
        const view = {
            ...membership,
            treeKind: tree?.treeKind ?? 'identity',
            treeLabel: tree?.label ?? membership.treeId,
        };
        const list = membershipByNode.get(membership.nodeId) ?? [];
        list.push(view);
        membershipByNode.set(membership.nodeId, list);
    }
    for (const list of membershipByNode.values()) {
        list.sort(compareMembership);
    }
    const nodes = selected.map((node, index) => lorentzNode(node, index, selected.length, membershipByNode));
    const edges = lorentzEdges(payload.edges || [], memberships, nodeIds, treeById);
    return {
        nodes,
        edges,
        sourceLabel: snapshot.sourceLabel || payload.sourceLabel || 'lorentz h4 forest',
        searchIndex: lorentzSearchIndex(nodes),
    };
}

function lorentzNode(
    node: SemanticAtlasEmbeddingNode,
    index: number,
    total: number,
    membershipByNode: Map<string, LorentzMembershipView[]>,
): GalaxyRenderableNode {
    const projection = projectLorentzKlein(node.vector);
    const memberships = membershipByNode.get(node.id) ?? [];
    const primary = memberships[0];
    const colorHsl = LORENTZ_TREE_KIND_COLORS[String(primary?.treeKind || 'identity')] ?? '198 74% 64%';
    const [kx, ky, kz, kw] = projection.klein;
    const point = projection.radius > 1e-6
        ? { x: kx * KLEIN_SCENE_RADIUS, y: ky * KLEIN_SCENE_RADIUS, z: kz * KLEIN_SCENE_RADIUS }
        : fallbackPoint(node.id, index, total);
    return {
        id: node.id,
        label: node.label || node.id,
        kind: node.kind || `LORENTZ:${String(primary?.treeKind || 'identity').toUpperCase()}`,
        atlasX: point.x,
        atlasY: point.y,
        atlasZ: point.z,
        totalMentions: Math.max(1, memberships.length + Math.round((primary?.sourceCount ?? 1) * 0.8)),
        colorHsl,
        metadata: {
            sourceType: node.sourceType || 'lorentz_node',
            sourceId: node.id,
            documentId: node.documentId,
            narrativeId: node.narrativeId,
            folderId: node.folderId,
            preview: node.preview || `${node.label || node.id} in Lorentz H4 forest space.`,
            lorentz: {
                coords: projection.coords,
                klein: projection.klein,
                w: kw,
                radius: projection.radius,
                valid: projection.valid,
                primaryTreeKind: primary?.treeKind ?? 'identity',
                level: primary?.level ?? 0,
                memberships: memberships.map(membershipView),
            },
        },
    };
}

function normalizeTrees(
    trees: LorentzTreeRecord[] | undefined,
    nodes: SemanticAtlasEmbeddingNode[],
    geometryVersion: string,
): LorentzTreeRecord[] {
    const existing = (trees || []).filter((tree) => tree.treeId).sort((left, right) => left.treeId.localeCompare(right.treeId));
    if (existing.length) return existing;
    return [{
        treeId: 'lorentz:identity',
        treeKind: 'identity',
        label: 'Identity',
        rootNodeId: nodes[0]?.id ?? null,
        geometryVersion,
    }];
}

function normalizeMemberships(
    memberships: LorentzMembershipRecord[] | undefined,
    trees: LorentzTreeRecord[],
    nodes: SemanticAtlasEmbeddingNode[],
    geometryVersion: string,
): LorentzMembershipRecord[] {
    const existing = (memberships || [])
        .filter((membership) => membership.treeId && membership.nodeId)
        .sort(compareMembership);
    if (existing.length) return existing;
    const tree = trees[0];
    const rootId = nodes[0]?.id ?? '';
    return nodes.map((node, index) => ({
        treeId: tree.treeId,
        nodeId: node.id,
        parentNodeId: index === 0 ? null : rootId,
        level: index === 0 ? 0 : 1,
        localRank: index,
        pathKey: index === 0 ? `${tree.treeId}/${node.id}` : `${tree.treeId}/${rootId}/${node.id}`,
        branchWeight: 1,
        confidence: 1,
        sourceCount: 1,
        geometryVersion,
    }));
}

function lorentzEdges(
    sourceEdges: GalaxyInputEdge[],
    memberships: LorentzMembershipRecord[],
    nodeIds: Set<string>,
    treeById: Map<string, LorentzTreeRecord>,
): GalaxyInputEdge[] {
    const out: GalaxyInputEdge[] = [];
    const seen = new Set<string>();
    const push = (edge: GalaxyInputEdge) => {
        if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId) || edge.sourceId === edge.targetId) return;
        const key = `${edge.sourceId}->${edge.targetId}:${edge.type}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(edge);
    };
    for (const edge of sourceEdges) {
        if (String(edge.type || '').startsWith('lorentz-tree')) push(edge);
    }
    for (const membership of memberships) {
        if (!membership.parentNodeId) continue;
        const tree = treeById.get(membership.treeId);
        push({
            id: `lorentz:membership:${membership.treeId}:${membership.parentNodeId}:${membership.nodeId}`,
            sourceId: membership.parentNodeId,
            targetId: membership.nodeId,
            type: `lorentz-tree:${tree?.treeKind ?? 'identity'}`,
            confidence: Math.max(0.15, (Number(membership.confidence) || 0.5) * (Number(membership.branchWeight) || 1)),
        });
    }
    return out.sort((left, right) => left.id.localeCompare(right.id));
}

function membershipView(membership: LorentzMembershipView): Record<string, unknown> {
    return {
        treeId: membership.treeId,
        treeKind: membership.treeKind,
        treeLabel: membership.treeLabel,
        parentNodeId: membership.parentNodeId ?? null,
        level: membership.level,
        localRank: membership.localRank,
        pathKey: membership.pathKey,
        branchWeight: membership.branchWeight,
        confidence: membership.confidence,
        sourceCount: membership.sourceCount,
    };
}

function lorentzSearchIndex(nodes: GalaxyRenderableNode[]): EmbeddingAtlasSearchItem[] {
    return nodes.map((node) => {
        const lorentz = node.metadata?.['lorentz'] as Record<string, unknown> | undefined;
        const klein = Array.isArray(lorentz?.['klein']) ? lorentz['klein'] as number[] : [];
        const level = Number(lorentz?.['level'] ?? 0);
        const memberships = Array.isArray(lorentz?.['memberships']) ? lorentz['memberships'].length : 0;
        const vector = new Float32Array(LORENTZ_SEARCH_DIMS);
        for (let index = 0; index < 4; index++) vector[index] = finite(klein[index]);
        vector[4] = Math.min(1, Math.max(0, level / 12));
        vector[5] = Math.min(1, memberships / 8);
        vector[6] = finite(node.atlasX) * 0.25;
        vector[7] = finite(node.atlasZ) * 0.25;
        normalize(vector);
        return { nodeId: node.id, vector };
    });
}

function lorentzCoordsFromVector(values: readonly number[]): [number, number, number, number, number] {
    const firstFive = [0, 1, 2, 3, 4].map((index) => finite(values[index]));
    const direct: [number, number, number, number, number] = [firstFive[0], firstFive[1], firstFive[2], firstFive[3], firstFive[4]];
    if (isValidLorentzPoint(direct)) return direct;
    const tangent: [number, number, number, number] = [firstFive[0], firstFive[1], firstFive[2], firstFive[3]];
    const norm = Math.hypot(...tangent);
    if (!Number.isFinite(norm) || norm <= 1e-8) return [1, 0, 0, 0, 0];
    const radius = Math.min(1.82, norm);
    const sinh = Math.sinh(radius);
    const inv = 1 / norm;
    return [Math.cosh(radius), tangent[0] * inv * sinh, tangent[1] * inv * sinh, tangent[2] * inv * sinh, tangent[3] * inv * sinh];
}

function isValidLorentzPoint(coords: [number, number, number, number, number]): boolean {
    if (!coords.every(Number.isFinite) || coords[0] < 1) return false;
    const norm = -coords[0] * coords[0] + coords[1] * coords[1] + coords[2] * coords[2] + coords[3] * coords[3] + coords[4] * coords[4];
    return Math.abs(norm + 1) <= 0.08;
}

function compareMembership(left: LorentzMembershipRecord, right: LorentzMembershipRecord): number {
    return left.treeId.localeCompare(right.treeId)
        || left.level - right.level
        || left.localRank - right.localRank
        || left.pathKey.localeCompare(right.pathKey)
        || left.nodeId.localeCompare(right.nodeId);
}

function fallbackPoint(id: string, index: number, total: number): { x: number; y: number; z: number } {
    const y = 1 - ((index + 0.5) / Math.max(1, total)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * 2.399963229728653 + stableUnit(id) * 0.31;
    return { x: Math.cos(angle) * radial * 0.42, y: y * 0.36, z: Math.sin(angle) * radial * 0.42 };
}

function stableUnit(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

function finite(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function normalize(vector: Float32Array): void {
    let sum = 0;
    for (let index = 0; index < vector.length; index++) sum += vector[index] * vector[index];
    if (sum <= 1e-12) {
        vector[0] = 1;
        return;
    }
    const scale = 1 / Math.sqrt(sum);
    for (let index = 0; index < vector.length; index++) vector[index] *= scale;
}
