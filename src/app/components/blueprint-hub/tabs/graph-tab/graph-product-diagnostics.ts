import type { RegisteredEntity } from '../../../../lib/registry';
import type {
    GraphRebuildEmbeddingTargetPostProcess,
    GraphRebuildLinkSuggestion,
    GraphRebuildSnapshot,
} from '../../../../graph-rebuild/graph-rebuild-snapshot';

export interface ProductDiagnosticsView {
    snapshotId: string;
    modelLabel: string;
    dimensionLabel: string;
    selected?: ProductDiagnosticsTarget;
    summary: ProductDiagnosticsSummary;
    suggestions: ProductDiagnosticsSuggestion[];
}

export interface ProductDiagnosticsTarget {
    label: string;
    targetId: string;
    region: string;
    lane: string;
    cluster: string;
    medoid: string;
    outlierScore: number;
    hubScore: number;
    neighborCount: number;
    confidence: number;
    laneWeights: Array<{ lane: string; value: number }>;
}

export interface ProductDiagnosticsSummary {
    targetCount: number;
    clusterCount: number;
    regionCount: number;
    backboneEdges: number;
    bridgeEdges: number;
    outliers: number;
    topRegions: Array<{ role: string; lane: string; count: number }>;
}

export interface ProductDiagnosticsSuggestion {
    id: string;
    label: string;
    confidence: number;
    region: string;
    lane: string;
    signals: string[];
}

export function buildProductDiagnosticsView(
    snapshot: GraphRebuildSnapshot | null,
    selectedEntity: RegisteredEntity | null,
): ProductDiagnosticsView | null {
    const embedding = snapshot?.embeddingGraphPostProcess;
    if (!snapshot || !embedding) return null;
    const target = selectedEntity ? targetForEntity(embedding.targets, selectedEntity.id) : undefined;
    return {
        snapshotId: snapshot.id,
        modelLabel: embedding.profile.modelLabel || embedding.profile.modelId,
        dimensionLabel: embedding.profile.dimensionLabel || `${embedding.vectorDimensions}d`,
        selected: target ? targetView(target, selectedEntity?.label || target.targetId) : undefined,
        summary: {
            targetCount: embedding.targetCount,
            clusterCount: embedding.metrics.clusterCount,
            regionCount: embedding.productTopologyRegions.length,
            backboneEdges: embedding.metrics.backboneEdgeCount,
            bridgeEdges: embedding.metrics.bridgeEdgeCount,
            outliers: embedding.metrics.outlierCount,
            topRegions: topRegions(embedding.targets),
        },
        suggestions: selectedEntity
            ? suggestionViews(snapshot.graphAwareLinkSuggestions || [], selectedEntity.id)
            : suggestionViews(snapshot.graphAwareLinkSuggestions || [], ''),
    };
}

function targetForEntity(rows: GraphRebuildEmbeddingTargetPostProcess[], entityId: string): GraphRebuildEmbeddingTargetPostProcess | undefined {
    const exact = rows.find((row) => row.targetId === `embed:entity:${entityId}`);
    if (exact) return exact;
    return rows.find((row) => row.targetId.endsWith(`:${entityId}`));
}

function targetView(row: GraphRebuildEmbeddingTargetPostProcess, label: string): ProductDiagnosticsTarget {
    const region = row.productTopologyRegion;
    return {
        label,
        targetId: row.targetId,
        region: region.role,
        lane: region.laneKind,
        cluster: row.clusterId,
        medoid: row.medoidTargetId,
        outlierScore: row.outlierScore,
        hubScore: row.hubScore,
        neighborCount: row.neighborCount,
        confidence: row.productLaneFeatures.confidence,
        laneWeights: Object.entries(row.productLaneFeatures.laneWeights)
            .map(([lane, value]) => ({ lane, value }))
            .sort((left, right) => right.value - left.value),
    };
}

function topRegions(rows: GraphRebuildEmbeddingTargetPostProcess[]): Array<{ role: string; lane: string; count: number }> {
    const counts = new Map<string, { role: string; lane: string; count: number }>();
    for (const row of rows) {
        const role = row.productTopologyRegion.role;
        const lane = row.productTopologyRegion.laneKind;
        const key = `${role}:${lane}`;
        const current = counts.get(key) || { role, lane, count: 0 };
        current.count += 1;
        counts.set(key, current);
    }
    return [...counts.values()]
        .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role) || left.lane.localeCompare(right.lane))
        .slice(0, 5);
}

function suggestionViews(suggestions: GraphRebuildLinkSuggestion[], entityId: string): ProductDiagnosticsSuggestion[] {
    return suggestions
        .filter((suggestion) => !entityId || suggestion.sourceEntityId === entityId || suggestion.targetEntityId === entityId)
        .sort((left, right) => (right.rerankScore || right.confidence) - (left.rerankScore || left.confidence))
        .slice(0, 6)
        .map((suggestion) => ({
            id: suggestion.id,
            label: `${suggestion.sourceEntityId} -> ${suggestion.targetEntityId}`,
            confidence: suggestion.rerankScore || suggestion.confidence,
            region: suggestion.productRegionRole || suggestion.structuralRole,
            lane: suggestion.productLane || 'mixed',
            signals: suggestion.rerankSignals || [],
        }));
}
