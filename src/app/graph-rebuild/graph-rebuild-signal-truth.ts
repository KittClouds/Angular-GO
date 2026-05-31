import type {
    GraphRebuildEmbeddingTarget,
    GraphRebuildEntityLinkSuggestion,
    GraphRebuildLinkSuggestion,
    GraphRebuildRelationship,
    GraphRebuildResolutionSuggestion,
    GraphRebuildSnapshot,
} from './graph-rebuild-snapshot';

export type GraphSignalTruthStatus =
    | 'accepted'
    | 'review'
    | 'evidence'
    | 'deferred'
    | 'hidden'
    | 'stale';

export type GraphSignalTruthKind =
    | 'target'
    | 'relationship'
    | 'graph_link_suggestion'
    | 'entity_link_suggestion'
    | 'shadow_link_suggestion'
    | 'final_link_patch'
    | 'resolution_suggestion';

export interface GraphSignalTruthRecord {
    id: string;
    kind: GraphSignalTruthKind;
    status: GraphSignalTruthStatus;
    reason: string;
    confidence?: number;
    sourceId?: string;
}

export interface GraphSignalTruthSummary {
    total: number;
    accepted: number;
    review: number;
    evidence: number;
    deferred: number;
    hidden: number;
    stale: number;
    targetAccepted: number;
    targetReview: number;
    targetEvidence: number;
    targetDeferred: number;
    targetHidden: number;
    targetStale: number;
    suggestionReview: number;
}

export function buildGraphSignalTruthIndex(snapshot: GraphRebuildSnapshot): Map<string, GraphSignalTruthRecord> {
    const relationshipById = new Map((snapshot.relationships || []).map((relationship) => [relationship.id, relationship]));
    const index = new Map<string, GraphSignalTruthRecord>();
    for (const target of snapshot.embeddingTargets || []) {
        index.set(target.id, graphTruthForEmbeddingTarget(target, relationshipById.get(target.sourceId)));
    }
    return index;
}

export function graphSignalTruthCounters(snapshot: GraphRebuildSnapshot): Record<string, number> {
    const summary = buildGraphSignalTruthSummary(snapshot);
    return {
        graphTruthTotal: summary.total,
        graphTruthAccepted: summary.accepted,
        graphTruthReview: summary.review,
        graphTruthEvidence: summary.evidence,
        graphTruthDeferred: summary.deferred,
        graphTruthHidden: summary.hidden,
        graphTruthStale: summary.stale,
        targetAccepted: summary.targetAccepted,
        targetReview: summary.targetReview,
        targetEvidence: summary.targetEvidence,
        targetDeferred: summary.targetDeferred,
        targetHidden: summary.targetHidden,
        targetStale: summary.targetStale,
        suggestionReview: summary.suggestionReview,
    };
}

export function buildGraphSignalTruthSummary(snapshot: GraphRebuildSnapshot): GraphSignalTruthSummary {
    const summary: GraphSignalTruthSummary = {
        total: 0,
        accepted: 0,
        review: 0,
        evidence: 0,
        deferred: 0,
        hidden: 0,
        stale: 0,
        targetAccepted: 0,
        targetReview: 0,
        targetEvidence: 0,
        targetDeferred: 0,
        targetHidden: 0,
        targetStale: 0,
        suggestionReview: 0,
    };
    const add = (record: GraphSignalTruthRecord) => {
        summary.total += 1;
        summary[record.status] += 1;
        if (record.kind === 'target') {
            const key = `target${record.status.slice(0, 1).toUpperCase()}${record.status.slice(1)}` as keyof GraphSignalTruthSummary;
            summary[key] += 1;
        } else if (record.kind !== 'relationship' && record.status === 'review') {
            summary.suggestionReview += 1;
        }
    };

    const relationshipById = new Map((snapshot.relationships || []).map((relationship) => [relationship.id, relationship]));
    for (const target of snapshot.embeddingTargets || []) add(graphTruthForEmbeddingTarget(target, relationshipById.get(target.sourceId)));
    for (const relationship of snapshot.relationships || []) add(graphTruthForRelationship(relationship));
    for (const suggestion of snapshot.graphAwareLinkSuggestions || []) add(graphTruthForGraphLinkSuggestion(suggestion));
    for (const suggestion of snapshot.shadowLinkSuggestions || snapshot.entityLinkSuggestions || []) {
        add(graphTruthForEntityLinkSuggestion(suggestion));
    }
    for (const patch of snapshot.finalLinkPatchLog?.patches || []) add({
        id: patch.id,
        kind: 'final_link_patch',
        status: patch.status === 'applied' ? 'accepted' : patch.status === 'reverted' ? 'hidden' : 'review',
        reason: patch.operation,
        confidence: patch.confidence,
        sourceId: patch.sourceShadowLinkId,
    });
    for (const suggestion of snapshot.resolutionSuggestions || []) add(graphTruthForResolutionSuggestion(suggestion));
    return summary;
}

export function graphTruthForEmbeddingTarget(
    target: GraphRebuildEmbeddingTarget,
    relationship?: GraphRebuildRelationship,
): GraphSignalTruthRecord {
    if (target.admissionStatus === 'deferred') {
        return truth(target.id, 'target', 'deferred', target.deferReason || 'target deferred by signal admission policy', target);
    }
    if (relationship) {
        return truthForAdjudicated(target.id, 'target', relationship.status, relationship.rationale || 'relationship adjudication', relationship.confidence, target.sourceId);
    }
    if (target.kind === 'anchor' || target.lane === 'anchor_evidence') {
        return truth(target.id, 'target', 'evidence', 'raw mention evidence, promoted only through accepted targets', target);
    }
    if (target.lane === 'cooccurrence_weak') {
        return truth(target.id, 'target', 'evidence', 'weak co-occurrence evidence', target);
    }
    if (isStructuralSpine(target) || target.kind === 'entity') {
        return truth(target.id, 'target', 'accepted', target.admissionReason || 'canonical structural or accepted entity target', target);
    }
    if (isExpressiveSignal(target)) {
        const confidence = targetConfidence(target);
        return truth(target.id, 'target', confidence >= 0.7 ? 'accepted' : 'review', 'expressive graph signal target', target, confidence);
    }
    return truth(target.id, 'target', 'review', target.admissionReason || 'ungoverned target requires review', target);
}

export function graphTruthForRelationship(relationship: GraphRebuildRelationship): GraphSignalTruthRecord {
    return truthForAdjudicated(
        relationship.id,
        'relationship',
        relationship.status,
        relationship.rationale || 'relationship adjudication',
        relationship.confidence,
        relationship.id,
    );
}

export function graphTruthForGraphLinkSuggestion(suggestion: GraphRebuildLinkSuggestion): GraphSignalTruthRecord {
    return truth(
        suggestion.id,
        'graph_link_suggestion',
        suggestion.status === 'confirmed' ? 'accepted' : 'review',
        suggestion.rationale[0] || 'graph-aware link suggestion',
        undefined,
        suggestion.confidence,
    );
}

export function graphTruthForEntityLinkSuggestion(suggestion: GraphRebuildEntityLinkSuggestion): GraphSignalTruthRecord {
    const status: GraphSignalTruthStatus = suggestion.decision === 'reject'
        ? 'hidden'
        : suggestion.status === 'confirmed'
            ? 'accepted'
            : 'review';
    return truth(
        suggestion.id,
        'phase' in suggestion && suggestion.phase === 'shadow' ? 'shadow_link_suggestion' : 'entity_link_suggestion',
        status,
        suggestion.rationale[0] || 'entity-link suggestion',
        undefined,
        suggestion.confidence,
    );
}

export function graphTruthForResolutionSuggestion(suggestion: GraphRebuildResolutionSuggestion): GraphSignalTruthRecord {
    return {
        id: suggestion.id,
        kind: 'resolution_suggestion',
        status: 'review',
        reason: suggestion.rationale || 'resolution suggestion',
        sourceId: suggestion.surface,
    };
}

function truthForAdjudicated(
    id: string,
    kind: GraphSignalTruthKind,
    status: GraphRebuildRelationship['status'],
    reason: string,
    confidence: number,
    sourceId?: string,
): GraphSignalTruthRecord {
    if (status === 'accepted') return { id, kind, status: 'accepted', reason, confidence, sourceId };
    if (status === 'rejected') return { id, kind, status: 'hidden', reason, confidence, sourceId };
    return { id, kind, status: 'review', reason, confidence, sourceId };
}

function truth(
    id: string,
    kind: GraphSignalTruthKind,
    status: GraphSignalTruthStatus,
    reason: string,
    target?: GraphRebuildEmbeddingTarget,
    confidence = target ? targetConfidence(target) : undefined,
): GraphSignalTruthRecord {
    return { id, kind, status, reason, confidence, sourceId: target?.sourceId };
}

function isStructuralSpine(target: GraphRebuildEmbeddingTarget): boolean {
    return target.kind === 'note'
        || target.kind === 'chunk'
        || target.lane === 'document_spine'
        || target.lane === 'chunk_spine';
}

function isExpressiveSignal(target: GraphRebuildEmbeddingTarget): boolean {
    return target.lane === 'relationship_fact'
        || target.lane === 'temporal_fact'
        || target.lane === 'causal_fact'
        || target.lane === 'memory_state'
        || target.lane === 'event_identity'
        || target.lane === 'story_signal';
}

function targetConfidence(target: GraphRebuildEmbeddingTarget): number {
    const match = target.text.match(/\bconfidence:([0-9.]+)/i);
    if (match) return clamp01(Number(match[1]));
    return target.evidenceIds.length ? 0.74 : 0.62;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}
