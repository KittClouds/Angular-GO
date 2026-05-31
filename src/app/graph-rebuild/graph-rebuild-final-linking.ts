import type {
    GraphRebuildFinalLinkPatch,
    GraphRebuildFinalLinkPatchKind,
    GraphRebuildFinalLinkPatchLog,
    GraphRebuildFinalLinkReceipt,
    GraphRebuildShadowLink,
} from './graph-rebuild-snapshot';

const FINAL_LINK_CONFIDENCE = 0.88;

export function buildGraphRebuildFinalLinkPatchLog(
    shadowLinks: GraphRebuildShadowLink[],
    generatedAt: number,
): GraphRebuildFinalLinkPatchLog {
    const receipts: GraphRebuildFinalLinkReceipt[] = [];
    const patches: GraphRebuildFinalLinkPatch[] = [];

    for (const link of shadowLinks) {
        if (link.promotionState !== 'promoted') continue;
        const linkReceipts = finalLinkReceipts(link);
        receipts.push(...linkReceipts);
        if (linkReceipts.some((receipt) => receipt.status === 'failed')) continue;
        patches.push(finalLinkPatch(link, linkReceipts, generatedAt));
    }

    const failedReceipts = receipts.filter((receipt) => receipt.status === 'failed').length;
    return {
        schemaVersion: 'phoenix-final-linker-patch-log/v1',
        generatedAt,
        patches,
        receipts,
        counters: {
            planned: patches.filter((patch) => patch.status === 'planned').length,
            applied: patches.filter((patch) => patch.status === 'applied').length,
            reverted: patches.filter((patch) => patch.status === 'reverted').length,
            blocked: receipts.length ? new Set(receipts.filter((receipt) => receipt.status === 'failed').map((receipt) => receipt.sourceShadowLinkId)).size : 0,
            failedReceipts,
        },
    };
}

function finalLinkReceipts(link: GraphRebuildShadowLink): GraphRebuildFinalLinkReceipt[] {
    return [
        receipt(link, 'explicit_promotion', link.promotionState === 'promoted', 'candidate was explicitly promoted'),
        receipt(link, 'shadow_layer_only', link.mutationAllowed === false, 'source was produced by non-mutating ShadowLinker'),
        receipt(link, 'clean_promotion_path', link.promotionBlockedReasons.length === 0, `${link.promotionBlockedReasons.length} blocked reasons`),
        receipt(link, 'identity_decision', link.decision === 'same_entity' || link.decision === 'alias_of', `decision ${link.decision}`),
        receipt(link, 'single_target', hasSingleTarget(link), 'candidate has exactly one canonical target'),
        receipt(link, 'clean_confidence', link.confidence >= FINAL_LINK_CONFIDENCE, `confidence ${link.confidence.toFixed(3)}`),
        receipt(link, 'evidence_present', link.evidenceIds.length > 0, `${link.evidenceIds.length} evidence refs`),
        receipt(link, 'reversible_patch', true, 'patch includes undo operation and created identifiers'),
    ];
}

function finalLinkPatch(
    link: GraphRebuildShadowLink,
    receipts: GraphRebuildFinalLinkReceipt[],
    createdAt: number,
): GraphRebuildFinalLinkPatch {
    const kind = patchKind(link);
    const canonicalEntityId = link.candidateEntityId;
    const sourceEntityId = link.decision === 'same_entity' ? link.competingEntityIds[0] : undefined;
    const alias = link.decision === 'alias_of' ? link.surface : undefined;
    const mergeRecordId = kind === 'same_as' ? `merge:${sourceEntityId}:into:${canonicalEntityId}` : undefined;
    const id = `final-link:${kind}:${link.id}`;
    return {
        id,
        kind,
        status: 'planned',
        sourceShadowLinkId: link.id,
        operation: operationFor(kind),
        canonicalEntityId,
        sourceEntityId,
        targetEntityId: canonicalEntityId,
        alias,
        mergeRecordId,
        confidence: link.confidence,
        evidenceIds: link.evidenceIds,
        receipts,
        reversiblePatch: {
            undoOperation: undoOperationFor(kind),
            targetId: canonicalEntityId,
            createdEdgeId: kind === 'same_as' ? `same_as:${sourceEntityId}:${canonicalEntityId}` : undefined,
            createdAlias: alias,
        },
        createdAt,
    };
}

function patchKind(link: GraphRebuildShadowLink): GraphRebuildFinalLinkPatchKind {
    if (link.decision === 'alias_of') return 'alias_of';
    if (link.competingEntityIds.length === 1) return 'same_as';
    return 'canonical_identity';
}

function hasSingleTarget(link: GraphRebuildShadowLink): boolean {
    if (!link.candidateEntityId) return false;
    return link.decision === 'alias_of' || link.competingEntityIds.length <= 1;
}

function operationFor(kind: GraphRebuildFinalLinkPatchKind): string {
    if (kind === 'alias_of') return 'write_alias_of';
    if (kind === 'same_as') return 'write_same_as_and_merge_record';
    if (kind === 'merge_record') return 'write_merge_record';
    return 'write_canonical_identity';
}

function undoOperationFor(kind: GraphRebuildFinalLinkPatchKind): string {
    if (kind === 'alias_of') return 'remove_alias_of';
    if (kind === 'same_as') return 'remove_same_as_and_merge_record';
    if (kind === 'merge_record') return 'remove_merge_record';
    return 'remove_canonical_identity_link';
}

function receipt(
    link: GraphRebuildShadowLink,
    invariant: string,
    passed: boolean,
    detail: string,
): GraphRebuildFinalLinkReceipt {
    return {
        id: `receipt:${link.id}:${invariant}`,
        sourceShadowLinkId: link.id,
        invariant,
        status: passed ? 'passed' : 'failed',
        detail,
    };
}
