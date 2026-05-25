import type {
    GraphRebuildEmbeddingBackboneEdge,
    GraphRebuildEmbeddingGraphPostProcess,
    GraphRebuildEmbeddingTargetPostProcess,
    GraphRebuildLinkSuggestion,
    GraphRebuildProductLaneKind,
    GraphRebuildProductTopologyRegionRole,
} from './graph-rebuild-snapshot';

export type GraphRebuildTopologyIntent =
    | 'balanced'
    | 'causal_upstream'
    | 'causal_downstream'
    | 'same_entity_context'
    | 'chapter_structure'
    | 'bridge_importance';

interface EmbeddingRerankIndex {
    rowsByEntityId: Map<string, GraphRebuildEmbeddingTargetPostProcess>;
    edgeByPair: Map<string, GraphRebuildEmbeddingBackboneEdge>;
}

export function rerankGraphRebuildLinkSuggestions(
    suggestions: GraphRebuildLinkSuggestion[],
    embedding: GraphRebuildEmbeddingGraphPostProcess | undefined,
    intent: GraphRebuildTopologyIntent = 'balanced',
): GraphRebuildLinkSuggestion[] {
    if (!suggestions.length) return suggestions;
    const embeddingIndex = embedding ? buildEmbeddingIndex(embedding) : null;
    return suggestions.map((suggestion) => rerankSuggestion(suggestion, embeddingIndex, intent));
}

function buildEmbeddingIndex(embedding: GraphRebuildEmbeddingGraphPostProcess): EmbeddingRerankIndex {
    const rowsByTarget = new Map(embedding.targets.map((row) => [row.targetId, row]));
    const rowsByEntityId = new Map<string, GraphRebuildEmbeddingTargetPostProcess>();
    for (const row of embedding.targets) {
        const entityId = entityIdFromTargetId(row.targetId);
        if (!entityId) continue;
        const current = rowsByEntityId.get(entityId);
        if (!current || row.hubScore > current.hubScore || row.outlierScore < current.outlierScore) {
            rowsByEntityId.set(entityId, row);
        }
    }
    const edgeByPair = new Map<string, GraphRebuildEmbeddingBackboneEdge>();
    for (const edge of embedding.backboneEdges) {
        const left = entityIdFromTargetId(edge.sourceTargetId);
        const right = entityIdFromTargetId(edge.targetTargetId);
        if (!left || !right) continue;
        const source = rowsByTarget.get(edge.sourceTargetId);
        const target = rowsByTarget.get(edge.targetTargetId);
        if (!source || !target) continue;
        const key = pairKey(left, right);
        const current = edgeByPair.get(key);
        if (!current || embeddingRoleWeight(edge.role) + edge.score > embeddingRoleWeight(current.role) + current.score) {
            edgeByPair.set(key, edge);
        }
    }
    return { rowsByEntityId, edgeByPair };
}

function rerankSuggestion(
    suggestion: GraphRebuildLinkSuggestion,
    embeddingIndex: EmbeddingRerankIndex | null,
    intent: GraphRebuildTopologyIntent,
): GraphRebuildLinkSuggestion {
    const signals: string[] = [];
    let score = suggestion.confidence * 0.56;
    score += semanticWeight(suggestion.semanticStatus);
    score += structuralWeight(suggestion.structuralRole);
    score += Math.min(0.08, suggestion.evidenceIds.length * 0.012);
    if (suggestion.semanticStatus !== 'none') signals.push(`semantic:${suggestion.semanticStatus}`);
    signals.push(`structure:${suggestion.structuralRole}`);

    let embeddingRole: GraphRebuildLinkSuggestion['embeddingRole'];
    let productRegionRole: GraphRebuildLinkSuggestion['productRegionRole'];
    let productLane: GraphRebuildLinkSuggestion['productLane'];
    if (embeddingIndex) {
        const source = embeddingIndex.rowsByEntityId.get(suggestion.sourceEntityId);
        const target = embeddingIndex.rowsByEntityId.get(suggestion.targetEntityId);
        const embeddingEdge = embeddingIndex.edgeByPair.get(pairKey(suggestion.sourceEntityId, suggestion.targetEntityId));
        if (embeddingEdge) {
            embeddingRole = embeddingEdge.role;
            score += embeddingRoleWeight(embeddingEdge.role) + embeddingEdge.score * 0.12;
            signals.push(`embedding:${embeddingEdge.role}:${Math.round(embeddingEdge.score * 100)}%`);
        } else if (source && target && source.clusterId === target.clusterId) {
            embeddingRole = 'same_cluster';
            score += 0.055 + Math.min(source.hubScore, target.hubScore) * 0.035;
            signals.push(`embedding:same_cluster:${source.clusterId}`);
        } else if (source && target) {
            embeddingRole = 'cross_cluster';
            score += 0.018;
            signals.push('embedding:cross_cluster');
        }
        if ((source?.outlierScore ?? 0) >= 0.72 || (target?.outlierScore ?? 0) >= 0.72) {
            embeddingRole = embeddingRole || 'outlier';
            score -= 0.035;
            signals.push('embedding:outlier_review');
        }
        const region = productRegionCompatibility(source, target, embeddingEdge?.role, intent);
        score += region.weight;
        productRegionRole = region.role;
        productLane = region.lane;
        signals.push(...region.signals);
    }

    const rerankScore = clamp(score, 0.22, 0.98);
    return {
        ...suggestion,
        confidence: rerankScore,
        rerankScore,
        embeddingRole,
        productRegionRole,
        productLane,
        rerankSignals: signals,
        rationale: unique([...suggestion.rationale, ...signals.map((signal) => `rerank: ${signal}`)]),
    };
}

function productRegionCompatibility(
    source: GraphRebuildEmbeddingTargetPostProcess | undefined,
    target: GraphRebuildEmbeddingTargetPostProcess | undefined,
    edgeRole: GraphRebuildEmbeddingBackboneEdge['role'] | undefined,
    intent: GraphRebuildTopologyIntent,
): { weight: number; role?: GraphRebuildProductTopologyRegionRole | 'cross_region'; lane?: GraphRebuildProductLaneKind | 'mixed'; signals: string[] } {
    if (!source && !target) return { weight: 0, signals: [] };
    const sourceRegion = source?.productTopologyRegion;
    const targetRegion = target?.productTopologyRegion;
    const sourceLane = sourceRegion?.laneKind || source?.productLaneFeatures.dominantLane;
    const targetLane = targetRegion?.laneKind || target?.productLaneFeatures.dominantLane;
    const sameRegion = Boolean(sourceRegion && targetRegion && sourceRegion.id === targetRegion.id);
    const sameLane = Boolean(sourceLane && targetLane && sourceLane === targetLane);
    const bridgeLike = edgeRole === 'bridge' || sourceRegion?.role === 'bridge' || targetRegion?.role === 'bridge';
    const backboneLike = edgeRole === 'backbone' || sourceRegion?.role === 'backbone' || targetRegion?.role === 'backbone';
    const outlier = sourceRegion?.role === 'outlier' || targetRegion?.role === 'outlier';
    const signals: string[] = [];
    let weight = 0;
    if (sameRegion && sourceRegion) {
        weight += sourceRegion.role === 'core' ? 0.05 : 0.038;
        signals.push(`product_region:${sourceRegion.role}`);
    } else if (sourceRegion && targetRegion) {
        weight += bridgeLike ? 0.034 : 0.012;
        signals.push('product_region:cross');
    }
    if (bridgeLike) {
        weight += 0.034;
        signals.push('product_region:bridge');
    } else if (backboneLike) {
        weight += 0.026;
        signals.push('product_region:backbone');
    }
    const lane = laneCompatibility(sourceLane, targetLane, source, target, intent);
    weight += lane.weight;
    signals.push(...lane.signals);
    if (outlier && !bridgeLike) {
        weight -= 0.025;
        signals.push('product_region:outlier_review');
    }
    const confidence = Math.max(source?.productLaneFeatures.confidence || 0, target?.productLaneFeatures.confidence || 0);
    if (confidence) weight += Math.min(0.028, confidence * 0.024);
    return {
        weight,
        role: sameRegion ? sourceRegion?.role : bridgeLike ? 'bridge' : backboneLike ? 'backbone' : sourceRegion || targetRegion ? 'cross_region' : undefined,
        lane: sameLane ? sourceLane : sourceLane || targetLane ? 'mixed' : undefined,
        signals,
    };
}

function laneCompatibility(
    sourceLane: GraphRebuildProductLaneKind | undefined,
    targetLane: GraphRebuildProductLaneKind | undefined,
    source: GraphRebuildEmbeddingTargetPostProcess | undefined,
    target: GraphRebuildEmbeddingTargetPostProcess | undefined,
    intent: GraphRebuildTopologyIntent,
): { weight: number; signals: string[] } {
    const signals: string[] = [];
    let weight = 0;
    if (sourceLane && targetLane && sourceLane === targetLane) {
        weight += 0.028;
        signals.push(`product_lane:${sourceLane}`);
    } else if (sourceLane || targetLane) {
        signals.push('product_lane:mixed');
    }
    const focus = intentLaneWeights(intent);
    for (const lane of Object.keys(focus) as GraphRebuildProductLaneKind[]) {
        const laneWeight = focus[lane] || 0;
        const value = Math.max(
            source?.productLaneFeatures.laneWeights[lane] || 0,
            target?.productLaneFeatures.laneWeights[lane] || 0,
        );
        const boost = value * laneWeight;
        if (boost <= 0) continue;
        weight += boost;
        if (boost >= 0.018) signals.push(`intent_lane:${lane}`);
    }
    return { weight, signals };
}

function intentLaneWeights(intent: GraphRebuildTopologyIntent): Partial<Record<GraphRebuildProductLaneKind, number>> {
    if (intent === 'causal_upstream' || intent === 'causal_downstream') return { causal: 0.044, temporal: 0.024, semantic: 0.012 };
    if (intent === 'same_entity_context') return { entity: 0.042, semantic: 0.026, document: 0.014 };
    if (intent === 'chapter_structure') return { document: 0.042, evidence: 0.026, temporal: 0.018 };
    if (intent === 'bridge_importance') return { relation: 0.032, evidence: 0.024, semantic: 0.018 };
    return { semantic: 0.012, relation: 0.01 };
}

function semanticWeight(status: GraphRebuildLinkSuggestion['semanticStatus']): number {
    if (status === 'accepted') return 0.18;
    if (status === 'review') return 0.1;
    if (status === 'rejected') return -0.16;
    return 0.03;
}

function structuralWeight(role: GraphRebuildLinkSuggestion['structuralRole']): number {
    if (role === 'backbone' || role === 'hub') return 0.14;
    if (role === 'bridge') return 0.11;
    if (role === 'shared_component' || role === 'connector') return 0.075;
    if (role === 'leaf') return 0.045;
    return 0.025;
}

function embeddingRoleWeight(role: GraphRebuildEmbeddingBackboneEdge['role']): number {
    if (role === 'backbone') return 0.12;
    if (role === 'bridge') return 0.095;
    return 0.045;
}

function entityIdFromTargetId(targetId: string): string {
    const prefix = 'embed:entity:';
    return targetId.startsWith(prefix) ? targetId.slice(prefix.length) : '';
}

function pairKey(left: string, right: string): string {
    return [left, right].sort().join('\u0000');
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
