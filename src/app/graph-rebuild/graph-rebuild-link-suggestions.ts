import type {
    GraphRebuildEdge,
    GraphRebuildEmbeddingBackboneEdge,
    GraphRebuildEmbeddingGraphPostProcess,
    GraphRebuildEmbeddingTargetPostProcess,
    GraphRebuildLinkSuggestion,
    GraphRebuildNode,
    GraphRebuildProductLaneKind,
    GraphRebuildProductTopologyRegionRole,
    GraphRebuildRelationship,
    GraphRebuildStructuralPostProcess,
} from './graph-rebuild-snapshot';

const MAX_SUGGESTIONS = 24;

export function buildGraphAwareLinkSuggestions(
    nodes: GraphRebuildNode[],
    edges: GraphRebuildEdge[],
    relationships: GraphRebuildRelationship[],
    structure: GraphRebuildStructuralPostProcess,
    embedding?: GraphRebuildEmbeddingGraphPostProcess,
): GraphRebuildLinkSuggestion[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const relationshipByPair = strongestRelationshipByPair(relationships);
    const edgeStructure = new Map(structure.edges.map((edge) => [edge.edgeId, edge]));
    const suggestions: GraphRebuildLinkSuggestion[] = [];

    for (const edge of edges) {
        const structural = edgeStructure.get(edge.id);
        if (!structural) continue;
        const relationship = relationshipByPair.get(pairKey(edge.sourceId, edge.targetId));
        if (structural.role === 'bridge' && (!relationship || relationship.status !== 'accepted')) {
            suggestions.push(edgeSuggestion('bridge_review', edge, relationship, 'verify_bridge_relation', 'bridge', [
                semanticLine(relationship),
                'structure: bridge edge controls graph reachability between neighborhoods',
            ]));
        }
        if (structural.role === 'backbone' && relationship?.status === 'review' && edge.weight >= 2) {
            suggestions.push(edgeSuggestion('backbone_promotion', edge, relationship, relationship.relationType, 'backbone', [
                'semantic: relationship is still review status',
                'structure: repeated backbone edge connects high-degree nodes',
            ]));
        }
        const hubAffiliation = hubAffiliationSuggestion(edge, relationship, structural.role, nodeById, structure);
        if (hubAffiliation) suggestions.push(hubAffiliation);
    }

    for (const structuralNode of structure.nodes) {
        if (structuralNode.role !== 'leaf') continue;
        const edge = edges.find((candidate) => candidate.sourceId === structuralNode.entityId || candidate.targetId === structuralNode.entityId);
        if (!edge || !structure.bridgeEdgeIds.includes(edge.id)) continue;
        const relationship = relationshipByPair.get(pairKey(edge.sourceId, edge.targetId));
        if (relationship?.status === 'accepted') continue;
        suggestions.push(edgeSuggestion('suspicious_leaf', edge, relationship, 'verify_single_bridge', 'leaf', [
            semanticLine(relationship),
            `structure: ${structuralNode.entityId} is a leaf held by one bridge edge`,
        ]));
    }

    suggestions.push(...missingTriangleSuggestions(nodes, edges, relationshipByPair, structure));
    return rerankSuggestions(uniqueSuggestions(suggestions), embedding)
        .sort((left, right) => (right.rerankScore ?? right.confidence) - (left.rerankScore ?? left.confidence)
            || right.confidence - left.confidence
            || left.kind.localeCompare(right.kind)
            || left.id.localeCompare(right.id))
        .slice(0, MAX_SUGGESTIONS);
}

function edgeSuggestion(
    kind: GraphRebuildLinkSuggestion['kind'],
    edge: GraphRebuildEdge,
    relationship: GraphRebuildRelationship | undefined,
    relationType: string,
    structuralRole: GraphRebuildLinkSuggestion['structuralRole'],
    rationale: string[],
): GraphRebuildLinkSuggestion {
    const confidence = clamp((relationship?.confidence || edge.confidence || 0.45) + (structuralRole === 'backbone' ? 0.08 : 0.04), 0.35, 0.96);
    return {
        id: `link-suggestion:${kind}:${edge.sourceId}:${edge.targetId}`,
        kind,
        sourceEntityId: edge.sourceId,
        targetEntityId: edge.targetId,
        suggestedRelationType: relationType,
        status: relationship?.status === 'accepted' ? 'confirmed' : 'review',
        confidence,
        semanticStatus: relationship?.status || 'none',
        structuralRole,
        rationale,
        evidenceIds: unique([...(relationship?.evidenceAnchorIds || []), ...edge.evidenceAnchorIds, edge.id]),
    };
}

function hubAffiliationSuggestion(
    edge: GraphRebuildEdge,
    relationship: GraphRebuildRelationship | undefined,
    structuralRole: GraphRebuildLinkSuggestion['structuralRole'],
    nodeById: Map<string, GraphRebuildNode>,
    structure: GraphRebuildStructuralPostProcess,
): GraphRebuildLinkSuggestion | null {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target || relationship?.status === 'rejected') return null;
    const sourceNetwork = isNetwork(source);
    const targetNetwork = isNetwork(target);
    if (sourceNetwork === targetNetwork) return null;
    const network = sourceNetwork ? source : target;
    if (!structure.hubEntityIds.includes(network.id) && structuralRole !== 'backbone' && structuralRole !== 'bridge') return null;
    const other = sourceNetwork ? target : source;
    return edgeSuggestion('hub_affiliation', edge, relationship, affiliationRelation(other.kind), structuralRole, [
        semanticLine(relationship),
        `structure: ${network.label} is a network hub touching ${other.label}`,
    ]);
}

function missingTriangleSuggestions(
    nodes: GraphRebuildNode[],
    edges: GraphRebuildEdge[],
    relationshipByPair: Map<string, GraphRebuildRelationship>,
    structure: GraphRebuildStructuralPostProcess,
): GraphRebuildLinkSuggestion[] {
    const neighbors = new Map<string, Set<string>>();
    const edgePairs = new Set<string>();
    for (const edge of edges) {
        edgePairs.add(pairKey(edge.sourceId, edge.targetId));
        mapSet(neighbors, edge.sourceId).add(edge.targetId);
        mapSet(neighbors, edge.targetId).add(edge.sourceId);
    }
    const nodeIds = nodes.map((node) => node.id).sort();
    const suggestions: GraphRebuildLinkSuggestion[] = [];
    for (let i = 0; i < nodeIds.length; i += 1) {
        for (let j = i + 1; j < nodeIds.length; j += 1) {
            const left = nodeIds[i];
            const right = nodeIds[j];
            const key = pairKey(left, right);
            if (edgePairs.has(key) || relationshipByPair.has(key)) continue;
            if (componentId(left, structure) !== componentId(right, structure)) continue;
            const shared = intersection(neighbors.get(left), neighbors.get(right));
            if (shared.length < 2) continue;
            suggestions.push({
                id: `link-suggestion:missing_triangle:${left}:${right}`,
                kind: 'missing_triangle',
                sourceEntityId: left,
                targetEntityId: right,
                suggestedRelationType: 'possible_association',
                status: 'review',
                confidence: clamp(0.42 + shared.length * 0.08, 0.42, 0.78),
                semanticStatus: 'none',
                structuralRole: 'shared_component',
                rationale: [
                    'semantic: no direct accepted or review edge exists yet',
                    `structure: shares ${shared.length} graph neighbor(s) inside the same component`,
                ],
                evidenceIds: shared.slice(0, 4).map((id) => `shared_neighbor:${id}`),
            });
        }
    }
    return suggestions.slice(0, 8);
}

function strongestRelationshipByPair(relationships: GraphRebuildRelationship[]): Map<string, GraphRebuildRelationship> {
    const byPair = new Map<string, GraphRebuildRelationship>();
    for (const relationship of relationships) {
        const key = pairKey(relationship.sourceEntityId, relationship.targetEntityId);
        const current = byPair.get(key);
        if (!current || relationshipRank(relationship) > relationshipRank(current)) byPair.set(key, relationship);
    }
    return byPair;
}

function relationshipRank(relationship: GraphRebuildRelationship): number {
    const status = relationship.status === 'accepted' ? 2 : relationship.status === 'review' ? 1 : 0;
    return status * 10 + relationship.confidence;
}

function semanticLine(relationship: GraphRebuildRelationship | undefined): string {
    if (!relationship) return 'semantic: graph edge has no relationship row yet';
    return `semantic: ${relationship.relationType} is ${relationship.status} at ${Math.round(relationship.confidence * 100)}%`;
}

function rerankSuggestions(
    suggestions: GraphRebuildLinkSuggestion[],
    embedding: GraphRebuildEmbeddingGraphPostProcess | undefined,
): GraphRebuildLinkSuggestion[] {
    if (!suggestions.length) return suggestions;
    const embeddingIndex = embedding ? buildEmbeddingIndex(embedding) : null;
    return suggestions.map((suggestion) => rerankSuggestion(suggestion, embeddingIndex));
}

interface EmbeddingRerankIndex {
    rowsByEntityId: Map<string, GraphRebuildEmbeddingTargetPostProcess>;
    edgeByPair: Map<string, GraphRebuildEmbeddingBackboneEdge>;
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
        const region = productRegionCompatibility(source, target, embeddingEdge?.role);
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
    edgeRole?: GraphRebuildEmbeddingBackboneEdge['role'],
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
    if (sameLane && sourceLane) {
        weight += 0.028;
        signals.push(`product_lane:${sourceLane}`);
    } else if (sourceLane || targetLane) {
        signals.push('product_lane:mixed');
    }
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

function affiliationRelation(kind: string): string {
    const normalized = kind.toUpperCase();
    if (normalized === 'CHARACTER' || normalized === 'NPC' || normalized === 'PERSON') return 'affiliated_with';
    if (normalized === 'LOCATION') return 'operates_in';
    return 'associated_with';
}

function isNetwork(node: GraphRebuildNode): boolean {
    return String(node.kind || '').toUpperCase() === 'NETWORK';
}

function componentId(nodeId: string, structure: GraphRebuildStructuralPostProcess): string {
    return structure.nodes.find((node) => node.entityId === nodeId)?.componentId || '';
}

function pairKey(left: string, right: string): string {
    return [left, right].sort().join('\u0000');
}

function mapSet(map: Map<string, Set<string>>, key: string): Set<string> {
    const current = map.get(key);
    if (current) return current;
    const created = new Set<string>();
    map.set(key, created);
    return created;
}

function intersection(left?: Set<string>, right?: Set<string>): string[] {
    if (!left || !right) return [];
    return [...left].filter((value) => right.has(value)).sort();
}

function uniqueSuggestions(suggestions: GraphRebuildLinkSuggestion[]): GraphRebuildLinkSuggestion[] {
    const byId = new Map<string, GraphRebuildLinkSuggestion>();
    for (const suggestion of suggestions) {
        const current = byId.get(suggestion.id);
        if (!current || suggestion.confidence > current.confidence) byId.set(suggestion.id, suggestion);
    }
    return [...byId.values()];
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
