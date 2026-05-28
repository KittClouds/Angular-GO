import type { RegisteredEntity } from '../../../../lib/registry';
import type {
    GraphRebuildEntityLinkSuggestion,
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
    reviewClusters: ProductDiagnosticsReviewCluster[];
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

export interface ProductDiagnosticsReviewCluster {
    id: string;
    label: string;
    kind: 'entity-link' | 'graph-link';
    count: number;
    representativeCount: number;
    confidence: number;
    impact: number;
    conflicts: number;
    action: string;
    examples: string[];
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
        reviewClusters: reviewClusterViews(snapshot, selectedEntity?.id),
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

export function buildReviewClusterViews(
    snapshot: GraphRebuildSnapshot | null,
    entityId?: string,
): ProductDiagnosticsReviewCluster[] {
    if (!snapshot) return [];
    return reviewClusterViews(snapshot, entityId);
}

function reviewClusterViews(snapshot: GraphRebuildSnapshot, entityId?: string): ProductDiagnosticsReviewCluster[] {
    return [
        ...entityLinkClusters(snapshot.entityLinkSuggestions || [], entityId),
        ...graphLinkClusters(snapshot.graphAwareLinkSuggestions || [], entityId),
    ]
        .sort((left, right) =>
            right.impact - left.impact
            || right.conflicts - left.conflicts
            || right.count - left.count
            || left.label.localeCompare(right.label)
        )
        .slice(0, 6);
}

function entityLinkClusters(
    suggestions: GraphRebuildEntityLinkSuggestion[],
    entityId?: string,
): ProductDiagnosticsReviewCluster[] {
    const groups = new Map<string, GraphRebuildEntityLinkSuggestion[]>();
    for (const suggestion of suggestions) {
        if (entityId && suggestion.candidateEntityId !== entityId && !suggestion.competingEntityIds.includes(entityId)) continue;
        const key = [
            suggestion.decision,
            suggestion.normalizedSurface || suggestion.surface.toLowerCase(),
            suggestion.candidateEntityId || suggestion.candidateKind || 'new',
        ].join(':');
        groups.set(key, [...(groups.get(key) || []), suggestion]);
    }
    return [...groups.entries()].map(([key, rows]) => {
        const sample = rankedEntityLinks(rows);
        const first = sample[0];
        const conflicts = rows.filter((row) => row.decision === 'ambiguous' || row.competingEntityIds.length > 1).length;
        const confidence = mean(rows.map((row) => row.rerankScore || row.confidence));
        return {
            id: `entity:${key}`,
            label: `${decisionLabel(first.decision)}: ${first.surface}`,
            kind: 'entity-link',
            count: rows.length,
            representativeCount: sample.length,
            confidence,
            impact: confidence + Math.min(0.35, rows.length / 20) + Math.min(0.35, conflicts / 6),
            conflicts,
            action: entityClusterAction(first),
            examples: sample.map((row) => row.candidateLabel ? `${row.surface} -> ${row.candidateLabel}` : row.surface),
            signals: unique(sample.flatMap((row) => row.rerankSignals || []).slice(0, 6)),
        };
    });
}

function graphLinkClusters(
    suggestions: GraphRebuildLinkSuggestion[],
    entityId?: string,
): ProductDiagnosticsReviewCluster[] {
    const groups = new Map<string, GraphRebuildLinkSuggestion[]>();
    for (const suggestion of suggestions) {
        if (entityId && suggestion.sourceEntityId !== entityId && suggestion.targetEntityId !== entityId) continue;
        const key = [
            suggestion.kind,
            suggestion.suggestedRelationType,
            suggestion.structuralRole,
            suggestion.productLane || 'mixed',
        ].join(':');
        groups.set(key, [...(groups.get(key) || []), suggestion]);
    }
    return [...groups.entries()].map(([key, rows]) => {
        const sample = rankedGraphLinks(rows);
        const first = sample[0];
        const conflicts = rows.filter((row) => row.semanticStatus === 'rejected' || row.embeddingRole === 'outlier' || row.productRegionRole === 'cross_region').length;
        const confidence = mean(rows.map((row) => row.rerankScore || row.confidence));
        return {
            id: `graph:${key}`,
            label: `${linkKindLabel(first.kind)}: ${first.suggestedRelationType}`,
            kind: 'graph-link',
            count: rows.length,
            representativeCount: sample.length,
            confidence,
            impact: confidence + Math.min(0.4, rows.length / 16) + Math.min(0.25, conflicts / 5),
            conflicts,
            action: first.kind === 'backbone_promotion' ? 'Promote family' : 'Review family',
            examples: sample.map((row) => `${row.sourceEntityId} -> ${row.targetEntityId}`),
            signals: unique(sample.flatMap((row) => row.rerankSignals || []).slice(0, 6)),
        };
    });
}

function rankedEntityLinks(rows: GraphRebuildEntityLinkSuggestion[]): GraphRebuildEntityLinkSuggestion[] {
    return [...rows]
        .sort((left, right) => (right.rerankScore || right.confidence) - (left.rerankScore || left.confidence) || left.surface.localeCompare(right.surface))
        .slice(0, 3);
}

function rankedGraphLinks(rows: GraphRebuildLinkSuggestion[]): GraphRebuildLinkSuggestion[] {
    return [...rows]
        .sort((left, right) => (right.rerankScore || right.confidence) - (left.rerankScore || left.confidence) || left.id.localeCompare(right.id))
        .slice(0, 3);
}

function decisionLabel(decision: GraphRebuildEntityLinkSuggestion['decision']): string {
    if (decision === 'same_entity') return 'Same entity';
    if (decision === 'alias_of') return 'Alias family';
    if (decision === 'new_entity') return 'New entity';
    if (decision === 'ambiguous') return 'Conflict';
    return 'Reject';
}

function entityClusterAction(row: GraphRebuildEntityLinkSuggestion): string {
    if (row.decision === 'same_entity' || row.decision === 'alias_of') return 'Apply merge';
    if (row.decision === 'new_entity') return 'Create family';
    if (row.decision === 'ambiguous') return 'Resolve conflict';
    return 'Drop family';
}

function linkKindLabel(kind: GraphRebuildLinkSuggestion['kind']): string {
    return kind.replace(/_/g, ' ');
}

function mean(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}
