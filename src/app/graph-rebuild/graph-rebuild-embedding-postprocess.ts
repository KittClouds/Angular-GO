import type {
    GraphRebuildEmbeddingBackboneEdge,
    GraphRebuildEmbeddingCluster,
    GraphRebuildEmbeddingClusterRole,
    GraphRebuildEmbeddingGraphPostProcess,
    GraphRebuildEmbeddingProfile,
    GraphRebuildEmbeddingTarget,
    GraphRebuildEmbeddingTargetPostProcess,
    GraphRebuildProductLaneFeatures,
} from './graph-rebuild-snapshot';
import {
    normalizeEmbeddingProfile,
    sparseCosine,
    sparseEmbeddingSignature,
    type SparseEmbeddingSignature,
} from './graph-rebuild-embedding-signatures';

const NEIGHBOR_LIMIT = 6;
const BACKBONE_MIN_SCORE = 0.18;
const BRIDGE_MIN_SCORE = 0.13;

interface Neighbor {
    target: number;
    score: number;
}

export function buildGraphRebuildEmbeddingGraphPostProcess(
    targets: GraphRebuildEmbeddingTarget[],
    profileInput?: Partial<GraphRebuildEmbeddingProfile>,
): GraphRebuildEmbeddingGraphPostProcess {
    const profile = normalizeEmbeddingProfile(profileInput);
    const signatures = targets.map((target) => sparseEmbeddingSignature(target, profile.selectedDimensions));
    const neighbors = buildMutualNeighbors(signatures);
    const clusters = clusterTargets(targets, neighbors);
    const targetRows = buildTargetRows(targets, clusters, neighbors);
    const backboneEdges = buildBackboneEdges(targets, targetRows, neighbors);
    const bridgeEdges = backboneEdges.filter((edge) => edge.role === 'bridge');
    const outlierTargetIds = targetRows.filter((row) => row.outlierScore >= 0.72).map((row) => row.targetId);
    const largestClusterSize = clusters.reduce((max, cluster) => Math.max(max, cluster.size), 0);
    const meanNeighborCount = targetRows.length
        ? targetRows.reduce((sum, row) => sum + row.neighborCount, 0) / targetRows.length
        : 0;

    return {
        schemaVersion: 'phoenix-embedding-graph-postprocess/v1',
        profile,
        targetCount: targets.length,
        vectorDimensions: profile.selectedDimensions,
        clusters,
        targets: targetRows,
        backboneEdges,
        bridgeEdges,
        outlierTargetIds,
        metrics: {
            clusterCount: clusters.length,
            singletonCount: clusters.filter((cluster) => cluster.size === 1).length,
            largestClusterSize,
            largestClusterRatio: targets.length ? round(largestClusterSize / targets.length) : 0,
            backboneEdgeCount: backboneEdges.length,
            bridgeEdgeCount: bridgeEdges.length,
            outlierCount: outlierTargetIds.length,
            maxHubScore: targetRows.reduce((max, row) => Math.max(max, row.hubScore), 0),
            meanNeighborCount: round(meanNeighborCount),
        },
    };
}

function buildMutualNeighbors(signatures: SparseEmbeddingSignature[]): Neighbor[][] {
    const directed = signatures.map((): Neighbor[] => []);
    for (let i = 0; i < signatures.length; i += 1) {
        for (let j = i + 1; j < signatures.length; j += 1) {
            const score = sparseCosine(signatures[i], signatures[j]);
            if (score < BRIDGE_MIN_SCORE) continue;
            pushTopNeighbor(directed[i], { target: j, score });
            pushTopNeighbor(directed[j], { target: i, score });
        }
    }
    return directed.map((list, index) =>
        list.filter((neighbor) => directed[neighbor.target].some((other) => other.target === index)),
    );
}

function pushTopNeighbor(list: Neighbor[], neighbor: Neighbor): void {
    list.push(neighbor);
    list.sort((left, right) => right.score - left.score || left.target - right.target);
    if (list.length > NEIGHBOR_LIMIT) list.length = NEIGHBOR_LIMIT;
}

function clusterTargets(
    targets: GraphRebuildEmbeddingTarget[],
    neighbors: Neighbor[][],
): GraphRebuildEmbeddingCluster[] {
    const visited = new Uint8Array(targets.length);
    const clusters: GraphRebuildEmbeddingCluster[] = [];
    for (let index = 0; index < targets.length; index += 1) {
        if (visited[index]) continue;
        const members = collectComponent(index, neighbors, visited);
        const medoid = medoidIndex(members, neighbors);
        const density = clusterDensity(members, neighbors);
        const outliers = members.filter((member) => outlierScore(member, neighbors) >= 0.72);
        clusters.push({
            id: `embedding-cluster:${clusters.length}`,
            role: clusterRole(members.map((member) => targets[member])),
            targetIds: members.map((member) => targets[member].id),
            medoidTargetId: targets[medoid]?.id || targets[index]?.id || '',
            size: members.length,
            density,
            confidence: round(Math.min(1, 0.42 + density * 0.48 + Math.min(members.length, 8) * 0.012)),
            topKinds: topKinds(members.map((member) => targets[member])),
            outlierTargetIds: outliers.map((member) => targets[member].id),
        });
    }
    return clusters.sort((left, right) => right.size - left.size || left.id.localeCompare(right.id));
}

function collectComponent(start: number, neighbors: Neighbor[][], visited: Uint8Array): number[] {
    const stack = [start];
    const members: number[] = [];
    visited[start] = 1;
    while (stack.length) {
        const current = stack.pop()!;
        members.push(current);
        for (const neighbor of neighbors[current]) {
            if (neighbor.score < BACKBONE_MIN_SCORE || visited[neighbor.target]) continue;
            visited[neighbor.target] = 1;
            stack.push(neighbor.target);
        }
    }
    return members.sort((left, right) => left - right);
}

function buildTargetRows(
    targets: GraphRebuildEmbeddingTarget[],
    clusters: GraphRebuildEmbeddingCluster[],
    neighbors: Neighbor[][],
): GraphRebuildEmbeddingTargetPostProcess[] {
    const clusterByTarget = new Map<string, GraphRebuildEmbeddingCluster>();
    for (const cluster of clusters) {
        for (const targetId of cluster.targetIds) clusterByTarget.set(targetId, cluster);
    }
    return targets.map((target, index) => {
        const cluster = clusterByTarget.get(target.id)!;
        const hubScore = round(Math.min(1, neighbors[index].length / NEIGHBOR_LIMIT));
        const outlier = outlierScore(index, neighbors);
        return {
            targetId: target.id,
            clusterId: cluster.id,
            clusterRole: cluster.role,
            medoidTargetId: cluster.medoidTargetId,
            outlierScore: outlier,
            hubScore,
            neighborCount: neighbors[index].length,
            productLaneFeatures: productLaneFeatures(target, cluster, outlier, hubScore),
        };
    });
}

function buildBackboneEdges(
    targets: GraphRebuildEmbeddingTarget[],
    rows: GraphRebuildEmbeddingTargetPostProcess[],
    neighbors: Neighbor[][],
): GraphRebuildEmbeddingBackboneEdge[] {
    const rowsByIndex = rows;
    const edges: GraphRebuildEmbeddingBackboneEdge[] = [];
    const seen = new Set<string>();
    for (let source = 0; source < neighbors.length; source += 1) {
        for (const neighbor of neighbors[source]) {
            const target = neighbor.target;
            const key = source < target ? `${source}:${target}` : `${target}:${source}`;
            if (seen.has(key) || neighbor.score < BRIDGE_MIN_SCORE) continue;
            seen.add(key);
            const sameCluster = rowsByIndex[source].clusterId === rowsByIndex[target].clusterId;
            const role = sameCluster ? (neighbor.score >= 0.34 ? 'backbone' : 'local') : 'bridge';
            edges.push({
                id: `embedding-backbone:${targets[source].id}:${targets[target].id}`,
                sourceTargetId: targets[source].id,
                targetTargetId: targets[target].id,
                role,
                score: round(neighbor.score),
                semanticScore: round(neighbor.score),
                structuralScore: sameCluster ? 0.7 : 0.42,
                reason: [
                    sameCluster ? 'mutual semantic neighborhood' : 'semantic bridge across clusters',
                    `source_kind:${targets[source].kind}`,
                    `target_kind:${targets[target].kind}`,
                ],
            });
        }
    }
    return edges.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function productLaneFeatures(
    target: GraphRebuildEmbeddingTarget,
    cluster: GraphRebuildEmbeddingCluster,
    outlierScoreValue: number,
    hubScore: number,
): GraphRebuildProductLaneFeatures {
    const kind = normalizeKind(target.kind);
    const relationDepth = /fact|event|memory|causal|temporal/.test(kind) ? 0.78 : kind === 'entity' ? 0.42 : 0.34;
    const documentDepth = target.chunkId ? 0.82 : target.noteId ? 0.68 : 0.22;
    return {
        semanticDepth: round(Math.max(0.12, 1 - outlierScoreValue * 0.72)),
        documentDepth,
        relationDepth,
        clusterRadius: round(Math.min(1, Math.sqrt(cluster.size) / 6)),
        fiberPhase: phase(target.id),
        confidence: round(Math.min(1, cluster.confidence * 0.72 + hubScore * 0.28)),
    };
}

function medoidIndex(members: number[], neighbors: Neighbor[][]): number {
    return members
        .map((member) => ({
            member,
            score: neighbors[member].reduce((sum, neighbor) => sum + neighbor.score, 0),
        }))
        .sort((left, right) => right.score - left.score || left.member - right.member)[0]?.member ?? members[0];
}

function clusterDensity(members: number[], neighbors: Neighbor[][]): number {
    if (members.length <= 1) return 0;
    const set = new Set(members);
    let links = 0;
    for (const member of members) links += neighbors[member].filter((neighbor) => set.has(neighbor.target)).length;
    return round(links / (members.length * (members.length - 1)));
}

function outlierScore(index: number, neighbors: Neighbor[][]): number {
    const list = neighbors[index];
    if (!list.length) return 1;
    const mean = list.reduce((sum, neighbor) => sum + neighbor.score, 0) / list.length;
    return round(Math.max(0, 1 - mean * 2.2));
}

function clusterRole(targets: GraphRebuildEmbeddingTarget[]): GraphRebuildEmbeddingClusterRole {
    const counts = kindCounts(targets);
    const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || '';
    if (/note|chunk|anchor/.test(top)) return 'document_region';
    if (/entity/.test(top)) return 'entity_region';
    if (/fact|memory/.test(top)) return 'fact_region';
    if (/event|temporal|causal/.test(top)) return 'event_region';
    return 'mixed_region';
}

function topKinds(targets: GraphRebuildEmbeddingTarget[]): string[] {
    return [...kindCounts(targets).entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 4)
        .map(([kind]) => kind);
}

function kindCounts(targets: GraphRebuildEmbeddingTarget[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const target of targets) {
        const kind = normalizeKind(target.kind);
        counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    return counts;
}

function normalizeKind(kind: string): string {
    return String(kind || 'target').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function phase(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return round((hash >>> 0) / 4294967295);
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
