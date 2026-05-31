import type {
    GraphRebuildEntityLinkSuggestion,
    GraphRebuildNode,
    GraphRebuildRelationship,
    GraphRebuildShadowLink,
    GraphRebuildShadowLinkKind,
} from './graph-rebuild-snapshot';
import type { GraphModelV2FactBundle } from './graph-model-v2';

export function shadowEntityLink(
    suggestion: GraphRebuildEntityLinkSuggestion,
    shadowKind: GraphRebuildShadowLinkKind,
    extras: Partial<Pick<GraphRebuildShadowLink, 'relatedBundleIds' | 'relatedRelationIds' | 'clusterHintIds'>> = {},
): GraphRebuildShadowLink {
    const blocked = promotionBlockedReasons(suggestion, shadowKind);
    return {
        ...suggestion,
        phase: 'shadow',
        shadowKind,
        mutationAllowed: false,
        promotionState: blocked.length ? 'blocked' : 'shadow',
        promotionBlockedReasons: blocked,
        ...extras,
    };
}

export function buildRelationDuplicateShadowLinks(
    relationships: GraphRebuildRelationship[],
    nodes: GraphRebuildNode[],
): GraphRebuildShadowLink[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const buckets = new Map<string, GraphRebuildRelationship[]>();
    for (const relationship of relationships) {
        if (relationship.status === 'rejected') continue;
        const key = [
            pairKey(relationship.sourceEntityId, relationship.targetEntityId),
            normalizeRelation(relationship.relationType),
        ].join('\u0000');
        buckets.set(key, [...(buckets.get(key) || []), relationship]);
    }

    const links: GraphRebuildShadowLink[] = [];
    for (const rows of buckets.values()) {
        if (rows.length < 2) continue;
        const ranked = [...rows].sort((left, right) =>
            relationshipRank(right) - relationshipRank(left) || left.id.localeCompare(right.id)
        );
        const canonical = ranked[0];
        const duplicateIds = ranked.slice(1).map((row) => row.id);
        const source = nodeById.get(canonical.sourceEntityId);
        const target = nodeById.get(canonical.targetEntityId);
        const confidence = Math.min(0.96, Math.max(...ranked.map((row) => row.confidence)) + 0.04);
        links.push(shadowEntityLink({
            id: `shadow-link:relation-duplicate:${canonical.id}`,
            surface: `${source?.label || canonical.sourceEntityId} ${canonical.relationType} ${target?.label || canonical.targetEntityId}`,
            normalizedSurface: normalizeRelation(canonical.relationType),
            candidateEntityId: canonical.sourceEntityId,
            candidateLabel: source?.label || canonical.sourceEntityId,
            candidateKind: source?.kind,
            decision: 'ambiguous',
            status: 'review',
            confidence,
            rerankScore: confidence,
            competingEntityIds: [canonical.targetEntityId],
            evidenceIds: unique(ranked.flatMap((row) => row.evidenceAnchorIds)),
            rerankSignals: [
                `relation_duplicate:canonical:${canonical.id}`,
                `relation_duplicate:duplicates:${duplicateIds.length}`,
            ],
            rationale: [
                'shadow: duplicate relationship candidates share the same pair and relation family',
                'shadow: review only; final linker does not mutate relation truth',
            ],
        }, 'relation_duplicate_suspicion', {
            relatedRelationIds: ranked.map((row) => row.id),
        }));
    }
    return links;
}

export function buildBundleDedupeShadowLinks(bundles: GraphModelV2FactBundle[]): GraphRebuildShadowLink[] {
    const byId = new Map(bundles.map((bundle) => [bundle.id, bundle]));
    const links: GraphRebuildShadowLink[] = [];
    for (const bundle of bundles) {
        const compression = bundle.compression;
        if (!compression?.duplicateOfBundleId) continue;
        const duplicateOfBundleId = compression.duplicateOfBundleId;
        const canonical = byId.get(duplicateOfBundleId);
        const relatedBundleIds = unique([bundle.id, duplicateOfBundleId]);
        const confidence = Math.min(0.97, Math.max(
            bundle.confidence,
            canonical?.confidence || 0,
            compression.rerankScore || 0,
        ));
        links.push(shadowEntityLink({
            id: `shadow-link:bundle-dedupe:${bundle.id}:to:${duplicateOfBundleId}`,
            surface: `${bundle.relationType} bundle duplicate`,
            normalizedSurface: normalizeRelation(bundle.groupKey || bundle.relationType),
            decision: 'ambiguous',
            status: 'review',
            confidence,
            rerankScore: compression.rerankScore || confidence,
            competingEntityIds: [],
            evidenceIds: unique([
                ...bundle.evidenceIds,
                ...(canonical?.evidenceIds || []),
            ]),
            rerankSignals: unique([
                `bundle_dedupe:canonical:${duplicateOfBundleId}`,
                `bundle_dedupe:cluster:${compression.clusterId}`,
                ...compression.signals,
            ]),
            rationale: [
                'shadow: compressed bundle points at a canonical duplicate target',
                'shadow: review only; FinalLinker does not mutate fact bundles from entity-link receipts',
            ],
        }, 'bundle_dedupe', {
            relatedBundleIds,
            clusterHintIds: [compression.clusterId],
        }));
    }
    return links;
}

function promotionBlockedReasons(
    suggestion: GraphRebuildEntityLinkSuggestion,
    shadowKind: GraphRebuildShadowLinkKind,
): string[] {
    const reasons: string[] = [];
    if (shadowKind === 'relation_duplicate_suspicion' || shadowKind === 'bundle_dedupe') {
        reasons.push('shadow_only_non_identity_candidate');
    }
    if (suggestion.decision === 'ambiguous' || suggestion.decision === 'reject' || suggestion.decision === 'new_entity') {
        reasons.push(`decision_${suggestion.decision}`);
    }
    if (suggestion.competingEntityIds.length > 1) {
        reasons.push('multiple_competing_entities');
    }
    if (suggestion.confidence < 0.88) {
        reasons.push('confidence_below_final_threshold');
    }
    return unique(reasons);
}

function relationshipRank(relationship: GraphRebuildRelationship): number {
    const status = relationship.status === 'accepted' ? 2 : relationship.status === 'review' ? 1 : 0;
    return status * 10 + relationship.confidence;
}

function normalizeRelation(value: string): string {
    return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function pairKey(left: string, right: string): string {
    return [left, right].sort().join('\u0000');
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values.filter(Boolean))];
}
